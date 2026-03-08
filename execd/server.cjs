#!/usr/bin/env node
// OpenClaw execd — HTTP RPC daemon replacing SSH forced command
// Runs on host, listens on port 19800, executes commands with policy checks
'use strict';

const http = require('http');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 19800;
const MAX_BODY = 64 * 1024;
const MAX_OUTPUT = 1024 * 1024;
const DEFAULT_TIMEOUT = 30000;
const MAX_TIMEOUT = 300000;

const TOKEN_PATH = path.join(os.homedir(), 'openclaw/config/execd-token.txt');
const DENY_PATH = path.join(os.homedir(), 'etc/openclaw-gateway-deny.txt');
const AUDIT_PATH = path.join(os.homedir(), 'openclaw/logs/exec-audit.jsonl');

let AUTH_TOKEN = '';
let DENY_PATTERNS = [];

function loadToken() {
  try {
    AUTH_TOKEN = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
  } catch (e) {
    console.error('FATAL: Cannot read token file:', e.message);
    process.exit(1);
  }
}

function loadDenyPatterns() {
  try {
    const lines = fs.readFileSync(DENY_PATH, 'utf8').split('\n');
    DENY_PATTERNS = lines
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));
  } catch {
    DENY_PATTERNS = [];
  }
}

// Reload config on SIGHUP
process.on('SIGHUP', () => {
  loadToken();
  loadDenyPatterns();
  console.log('Config reloaded');
});

loadToken();
loadDenyPatterns();

// IP ACL — only allow Docker bridge, localhost
const ALLOWED_NETS = [
  /^127\.0\.0\.1$/,
  /^::1$/,
  /^::ffff:127\.0\.0\.1$/,
  /^192\.168\.107\.\d+$/,
  /^::ffff:192\.168\.107\.\d+$/,
  /^192\.168\.65\.\d+$/,
  /^::ffff:192\.168\.65\.\d+$/,
];

function isAllowedIP(ip) {
  return ALLOWED_NETS.some(re => re.test(ip));
}

function checkPolicy(cmd) {
  // Split compound commands
  const subcmds = cmd.split(/[;&|]+/);
  // Check backtick substitution
  const backticks = cmd.match(/`([^`]*)`/g) || [];
  const all = [...subcmds, ...backticks.map(s => s.slice(1, -1)), cmd];

  for (const sub of all) {
    const trimmed = sub.trim();
    if (!trimmed) continue;
    for (const pattern of DENY_PATTERNS) {
      if (trimmed.includes(pattern)) {
        return { denied: true, pattern, subcmd: trimmed.slice(0, 80) };
      }
    }
  }

  // Pipe-to-shell detection
  const dangerousPipes = [
    /base64.*\|.*(?:bash|sh|python|perl)/i,
    /curl.*\|.*(?:bash|sh|python|perl)/i,
    /wget.*\|.*(?:bash|sh|python|perl)/i,
  ];
  for (const re of dangerousPipes) {
    if (re.test(cmd)) {
      return { denied: true, pattern: 'pipe_to_shell', subcmd: cmd.slice(0, 80) };
    }
  }

  return { denied: false };
}

function audit(entry) {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry });
  fs.appendFile(AUDIT_PATH, line + '\n', () => {});
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('Body too large'));
        req.destroy();
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const clientIP = req.socket.remoteAddress || '';

  // Health check — no auth needed, but still IP restricted
  if (req.method === 'GET' && req.url === '/health') {
    if (!isAllowedIP(clientIP)) {
      return sendJSON(res, 403, { error: 'forbidden' });
    }
    return sendJSON(res, 200, { status: 'ok', uptime: process.uptime() | 0 });
  }

  // IP ACL
  if (!isAllowedIP(clientIP)) {
    audit({ action: 'denied', reason: 'ip_acl', ip: clientIP });
    return sendJSON(res, 403, { error: 'forbidden' });
  }

  // Auth
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token || token !== AUTH_TOKEN) {
    audit({ action: 'denied', reason: 'auth', ip: clientIP });
    return sendJSON(res, 401, { error: 'unauthorized' });
  }

  if (req.method !== 'POST' || req.url !== '/exec') {
    return sendJSON(res, 404, { error: 'not found' });
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (e) {
    return sendJSON(res, 400, { error: 'invalid json' });
  }

  const { command, agent = 'unknown', timeout = DEFAULT_TIMEOUT } = body;
  if (!command || typeof command !== 'string') {
    return sendJSON(res, 400, { error: 'command required' });
  }

  const effectiveTimeout = Math.min(Math.max(timeout, 1000), MAX_TIMEOUT);

  // Policy check
  const policy = checkPolicy(command);
  if (policy.denied) {
    audit({
      action: 'denied',
      reason: 'policy',
      command,
      agent,
      ip: clientIP,
      detail: policy,
    });
    return sendJSON(res, 403, { error: 'command denied by policy', detail: policy });
  }

  // Alert patterns
  const alertPatterns = /push --force|chmod 777|eval |exec /i;
  const alert = alertPatterns.test(command);

  // Execute
  const start = Date.now();
  execFile('bash', ['-c', command], {
    timeout: effectiveTimeout,
    maxBuffer: MAX_OUTPUT,
    env: { ...process.env, HOME: os.homedir() },
  }, (err, stdout, stderr) => {
    const duration = Date.now() - start;
    const exitCode = err ? (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 137 : (err.code || 1)) : 0;
    const status = exitCode === 0 ? 'success' : 'failure';

    audit({
      action: 'exec',
      command,
      agent,
      ip: clientIP,
      status,
      exit_code: exitCode,
      duration_ms: duration,
      alert,
      executor: 'execd',
    });

    sendJSON(res, 200, {
      exitCode: typeof exitCode === 'number' ? exitCode : 1,
      stdout: stdout ? stdout.slice(0, MAX_OUTPUT) : '',
      stderr: stderr ? stderr.slice(0, MAX_OUTPUT) : '',
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`openclaw-execd listening on :${PORT}`);
});
