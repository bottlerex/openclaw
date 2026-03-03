#!/usr/bin/env node
/**
 * OpenClaw Gateway Client
 *
 * Authenticated WebSocket client for interacting with the OpenClaw gateway.
 * Supports RPC commands via CLI args or interactive stdin.
 *
 * Usage:
 *   node ws-gateway-client.mjs                          # interactive mode
 *   node ws-gateway-client.mjs --once                   # auth check only
 *   node ws-gateway-client.mjs chat.send "hello"        # send message
 *   node ws-gateway-client.mjs sessions.list            # list sessions
 *   node ws-gateway-client.mjs chat.history              # get chat history
 *   node ws-gateway-client.mjs channels.status           # channel status
 *   node ws-gateway-client.mjs config.get gateway        # get config
 *   echo '{"method":"chat.send","params":{"text":"hi"}}' | node ws-gateway-client.mjs --stdin
 *
 * Environment:
 *   OPENCLAW_GATEWAY_URL   ws://127.0.0.1:18789
 *   OPENCLAW_IDENTITY_FILE device.json path (overrides IDENTITY_DIR)
 *   OPENCLAW_IDENTITY_DIR  /home/node/.openclaw/identity
 *   OPENCLAW_CONFIG        /home/node/.openclaw/openclaw.json
 */
import WebSocket from "ws";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import readline from "readline";

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || "ws://127.0.0.1:18789";
const IDENTITY_FILE = process.env.OPENCLAW_IDENTITY_FILE || "";
const IDENTITY_DIR = process.env.OPENCLAW_IDENTITY_DIR || "/home/node/.openclaw/identity";
const CONFIG_PATH = process.env.OPENCLAW_CONFIG || "/home/node/.openclaw/openclaw.json";

const args = process.argv.slice(2);
const flagOnce = args.includes("--once");
const flagStdin = args.includes("--stdin");
const flagQuiet = args.includes("-q") || args.includes("--quiet");
const positional = args.filter(a => !a.startsWith("-"));

// --- Auth setup ---

const devicePath = IDENTITY_FILE || path.join(IDENTITY_DIR, "device.json");
const deviceConfig = JSON.parse(fs.readFileSync(devicePath, "utf-8"));
const openclawConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));

const { deviceId, privateKeyPem, publicKeyPem } = deviceConfig;
const gatewayToken = openclawConfig.gateway?.auth?.token;
if (!gatewayToken) { console.error("[FATAL] gateway.auth.token not set"); process.exit(1); }

const spkiDer = crypto.createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
const rawKey = spkiDer.subarray(spkiDer.length - 32);
const pubKeyB64Url = rawKey.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

// --- RPC helpers ---

const pending = new Map();

function rpc(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    pending.set(id, { resolve, reject, method });
    ws.send(JSON.stringify({ type: "req", id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error("timeout")); }
    }, 30000);
  });
}

// --- Shorthand command parser ---

function parseCommand(parts) {
  const method = parts[0];
  if (!method) return null;

  switch (method) {
    case "chat.send":
      return { method, params: { sessionKey: "agent:main:main", message: parts.slice(1).join(" ") || "ping", idempotencyKey: crypto.randomUUID() } };
    case "chat.history":
      return { method, params: { limit: parseInt(parts[1]) || 20 } };
    case "chat.abort":
      return { method, params: {} };
    case "sessions.list":
      return { method, params: {} };
    case "sessions.preview":
      return { method, params: { sessionId: parts[1] || "main" } };
    case "channels.status":
      return { method, params: {} };
    case "agents.list":
      return { method, params: {} };
    case "config.get":
      return { method, params: { path: parts[1] || "" } };
    case "config.patch":
      return { method, params: { path: parts[1], value: JSON.parse(parts[2] || "null") } };
    case "skills.status":
      return { method, params: {} };
    case "cron.list":
      return { method, params: {} };
    case "tools.catalog":
      return { method, params: {} };
    default:
      // Generic: treat remaining args as JSON params
      try {
        const params = parts[1] ? JSON.parse(parts.slice(1).join(" ")) : {};
        return { method, params };
      } catch {
        return { method, params: {} };
      }
  }
}

// --- Connection ---

function connect() {
  const ws = new WebSocket(GATEWAY_URL);
  let authenticated = false;

  ws.on("message", (data) => {
    const msg = JSON.parse(data);

    // --- Auth handshake ---
    if (msg.event === "connect.challenge") {
      const nonce = msg.payload.nonce;
      const signedAtMs = Date.now();
      const role = "operator";
      const scopes = ["operator.admin"];
      const platform = process.platform;

      const payload = [
        "v3", deviceId, "cli", "cli", role, scopes.join(","),
        String(signedAtMs), gatewayToken, nonce, platform.toLowerCase(), ""
      ].join("|");

      const signature = crypto
        .sign(null, Buffer.from(payload), { key: privateKeyPem, format: "pem" })
        .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

      ws.send(JSON.stringify({
        type: "req", id: crypto.randomUUID(), method: "connect",
        params: {
          minProtocol: 3, maxProtocol: 3,
          client: { id: "cli", version: "dev", platform, mode: "cli" },
          role, scopes, auth: { token: gatewayToken },
          device: { id: deviceId, publicKey: pubKeyB64Url, signature, signedAt: signedAtMs, nonce },
        },
      }));
      return;
    }

    // --- RPC response ---
    if (msg.type === "res") {
      if (!authenticated && msg.ok) {
        authenticated = true;
        if (!flagQuiet) console.error("[OK] connected " + (msg.payload?.server?.connId || ""));
        if (flagOnce) { ws.close(); process.exit(0); }
        afterAuth(ws);
        return;
      }
      if (!authenticated && !msg.ok) {
        console.error("[FAIL]", msg.error?.code, msg.error?.message);
        ws.close(); process.exit(1);
      }
      // Resolve pending RPC
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.payload ?? msg);
        else p.reject(new Error(`${p.method}: ${msg.error?.message || "error"}`));
      }
      return;
    }

    // --- Events ---
    if (msg.type === "event") {
      if (flagQuiet && (msg.event === "tick" || msg.event === "health")) return;
      if (!flagQuiet) console.error("[event]", msg.event);
      if (msg.event === "chat.completion.chunk") {
        process.stdout.write(msg.payload?.text || msg.payload?.delta || "");
      } else if (msg.event === "chat.completion") {
        if (!flagQuiet) console.error("[done]");
      }
    }
  });

  ws.on("error", (e) => console.error("[ERR]", e.message));
  ws.on("close", (code) => {
    if (!flagOnce && authenticated) {
      console.error("[RECONNECT] in 3s...");
      setTimeout(connect, 3000);
    } else if (!authenticated) {
      process.exit(1);
    }
  });
}

// --- Post-auth actions ---

async function afterAuth(ws) {
  // One-shot command from CLI args
  if (positional.length > 0) {
    const cmd = parseCommand(positional);
    if (cmd) {
      try {
        const result = await rpc(ws, cmd.method, cmd.params);
        console.log(JSON.stringify(result, null, 2));
      } catch (e) {
        console.error("[ERROR]", e.message);
      }
      ws.close(); process.exit(0);
    }
  }

  // Piped stdin (JSON lines)
  if (flagStdin) {
    const rl = readline.createInterface({ input: process.stdin });
    for await (const line of rl) {
      try {
        const { method, params } = JSON.parse(line);
        const result = await rpc(ws, method, params);
        console.log(JSON.stringify(result));
      } catch (e) {
        console.error("[ERROR]", e.message);
      }
    }
    ws.close(); process.exit(0);
  }

  // Interactive mode
  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr, prompt: "openclaw> " });
    rl.prompt();
    rl.on("line", async (line) => {
      const parts = line.trim().split(/\s+/);
      if (!parts[0] || parts[0] === "exit" || parts[0] === "quit") { ws.close(); process.exit(0); }
      if (parts[0] === "help") {
        console.error("Commands: chat.send <msg>, chat.history [n], sessions.list, channels.status,");
        console.error("          agents.list, config.get [path], skills.status, cron.list, tools.catalog,");
        console.error("          <any.method> [json_params], exit");
        rl.prompt(); return;
      }
      const cmd = parseCommand(parts);
      if (cmd) {
        try {
          const result = await rpc(ws, cmd.method, cmd.params);
          console.log(JSON.stringify(result, null, 2));
        } catch (e) { console.error("[ERROR]", e.message); }
      }
      rl.prompt();
    });
  }
}

connect();
