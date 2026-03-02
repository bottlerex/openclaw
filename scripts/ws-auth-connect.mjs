#!/usr/bin/env node
/**
 * OpenClaw WebSocket Authentication Client
 *
 * Authenticates to the local OpenClaw gateway via ED25519 device identity.
 *
 * Prerequisites:
 *   - /home/node/.openclaw/identity/device.json (keypair + deviceId)
 *   - /home/node/.openclaw/openclaw.json with gateway.auth.token set
 *   - Device must be paired (approve via Control UI or devices/paired.json)
 *
 * Usage:
 *   node ws-auth-connect.mjs              # connect and stay alive
 *   node ws-auth-connect.mjs --once       # connect, print status, exit
 */
import WebSocket from "ws";
import crypto from "crypto";
import fs from "fs";

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || "ws://127.0.0.1:18789";
const IDENTITY_DIR = process.env.OPENCLAW_IDENTITY_DIR || "/home/node/.openclaw/identity";
const CONFIG_PATH = process.env.OPENCLAW_CONFIG || "/home/node/.openclaw/openclaw.json";
const once = process.argv.includes("--once");

const deviceConfig = JSON.parse(fs.readFileSync(`${IDENTITY_DIR}/device.json`, "utf-8"));
const openclawConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));

const { deviceId, privateKeyPem, publicKeyPem } = deviceConfig;
const gatewayToken = openclawConfig.gateway?.auth?.token;
if (!gatewayToken) {
  console.error("[FATAL] gateway.auth.token not set in " + CONFIG_PATH);
  process.exit(1);
}

// Extract raw 32-byte ED25519 public key → base64url
const spkiDer = crypto.createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
const rawKey = spkiDer.subarray(spkiDer.length - 32);
const pubKeyB64Url = rawKey.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

function connect() {
  const ws = new WebSocket(GATEWAY_URL);

  ws.on("message", (data) => {
    const msg = JSON.parse(data);

    if (msg.event === "connect.challenge") {
      const nonce = msg.payload.nonce;
      const signedAtMs = Date.now();
      const role = "operator";
      const scopes = ["operator.admin"];
      const platform = process.platform;

      // V3 payload: v3|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce|platform|deviceFamily
      const payload = [
        "v3", deviceId, "cli", "cli", role,
        scopes.join(","),
        String(signedAtMs),
        gatewayToken,
        nonce,
        platform.toLowerCase(),
        ""
      ].join("|");

      const signature = crypto
        .sign(null, Buffer.from(payload), { key: privateKeyPem, format: "pem" })
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");

      ws.send(JSON.stringify({
        type: "req",
        id: crypto.randomUUID(),
        method: "connect",
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: { id: "cli", version: "dev", platform, mode: "cli" },
          role,
          scopes,
          auth: { token: gatewayToken },
          device: { id: deviceId, publicKey: pubKeyB64Url, signature, signedAt: signedAtMs, nonce },
        },
      }));
    } else if (msg.type === "res" && msg.ok === true) {
      const connId = msg.payload?.server?.connId || "?";
      console.log("[OK] authenticated connId=" + connId + " protocol=" + msg.payload?.protocol);
      if (once) { ws.close(); process.exit(0); }
    } else if (msg.type === "res" && msg.ok === false) {
      console.error("[FAIL]", msg.error?.code, msg.error?.message);
      ws.close();
      process.exit(1);
    } else {
      console.log("[event]", msg.event, msg.payload ? JSON.stringify(msg.payload).substring(0, 120) : "");
    }
  });

  ws.on("error", (e) => console.error("[ERR]", e.message));
  ws.on("close", (code, reason) => {
    console.log("[CLOSED]", code, String(reason));
    if (!once) { console.log("[RECONNECT] in 3s..."); setTimeout(connect, 3000); }
  });
}

connect();
