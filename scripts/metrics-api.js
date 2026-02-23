const http = require('http');
const { execSync } = require('child_process');
const fs = require('fs');

const PORT = 9090;
const LOG = '/Users/rexmacmini/openclaw/logs/metrics-api.log';

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
  fs.appendFileSync(LOG, `[${ts}] ${msg}\n`);
}

function getSystemMetrics() {
  try {
    const cpuCount = parseInt(execSync('sysctl -n hw.ncpu').toString());
    const memUsage = execSync('vm_stat | grep "Pages active"').toString();
    const diskUsage = execSync('df -h / | tail -1').toString();
    
    return {
      timestamp: new Date().toISOString(),
      cpu: {
        cores: cpuCount,
        usage: execSync('top -l 1 | grep "CPU usage"').toString().trim()
      },
      memory: memUsage.trim(),
      disk: diskUsage.trim(),
      services: {
        postgres: execSync('brew services list 2>/dev/null | grep postgresql@15 || echo "unknown"').toString().trim(),
        redis: execSync('brew services list 2>/dev/null | grep redis || echo "unknown"').toString().trim(),
        ollama: execSync('pgrep -f ollama > /dev/null && echo "running" || echo "stopped"').toString().trim()
      }
    };
  } catch (e) {
    return { error: e.message };
  }
}

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  
  if (req.url === '/metrics' && req.method === 'GET') {
    const metrics = getSystemMetrics();
    res.writeHead(200);
    res.end(JSON.stringify(metrics, null, 2));
    log(`Metrics request: ${JSON.stringify(metrics).slice(0, 100)}`);
  } else if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', port: PORT }));
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  log(`Metrics API listening on :${PORT}`);
});

process.on('SIGTERM', () => {
  log('Shutting down');
  process.exit(0);
});
