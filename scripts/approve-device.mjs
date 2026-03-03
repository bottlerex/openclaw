#!/usr/bin/env node
/**
 * Approve a pending device pairing request from within the container.
 * Usage: node approve-device.mjs [deviceId-prefix]
 */
import WebSocket from "ws";
import crypto from "crypto";
import fs from "fs";

const IDENTITY_DIR = "/home/node/.openclaw/identity";
const CONFIG_PATH = "/home/node/.openclaw/openclaw.json";
const targetPrefix = process.argv[2] || "";

const deviceConfig = JSON.parse(fs.readFileSync(`${IDENTITY_DIR}/device.json`, "utf-8"));
const openclawConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));

const { deviceId, privateKeyPem, publicKeyPem } = deviceConfig;
const gatewayToken = openclawConfig.gateway?.auth?.token;

const spkiDer = crypto.createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
const rawKey = spkiDer.subarray(spkiDer.length - 32);
const pubKeyB64Url = rawKey.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

const ws = new WebSocket("ws://127.0.0.1:18789");
let authed = false;

ws.on("message", (data) => {
  const msg = JSON.parse(data);

  if (msg.event === "connect.challenge") {
    const nonce = msg.payload.nonce;
    const signedAtMs = Date.now();
    const payload = [
      "v3", deviceId, "cli", "cli", "operator", "operator.admin,operator.pairing",
      String(signedAtMs), gatewayToken, nonce, "linux", ""
    ].join("|");
    const signature = crypto
      .sign(null, Buffer.from(payload), { key: privateKeyPem, format: "pem" })
      .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    ws.send(JSON.stringify({
      type: "req", id: crypto.randomUUID(), method: "connect",
      params: {
        minProtocol: 3, maxProtocol: 3,
        client: { id: "cli", version: "dev", platform: "linux", mode: "cli" },
        role: "operator", scopes: ["operator.admin", "operator.pairing"],
        auth: { token: gatewayToken },
        device: { id: deviceId, publicKey: pubKeyB64Url, signature, signedAt: signedAtMs, nonce },
      },
    }));
    return;
  }

  if (msg.type === "res" && !authed) {
    if (msg.ok) {
      authed = true;
      ws.send(JSON.stringify({
        type: "req", id: crypto.randomUUID(), method: "device.pair.list", params: {},
      }));
    } else {
      console.error("[FAIL] auth:", msg.error?.message || msg.error);
      ws.close(); process.exit(1);
    }
    return;
  }

  if (msg.type === "res" && authed) {
    if (msg.payload?.pending || msg.payload?.requests) {
      const requests = msg.payload.pending || msg.payload.requests;
      console.log(`[INFO] ${requests.length} pending pairing request(s)`);
      let approved = 0;
      for (const req of requests) {
        if (targetPrefix && !req.deviceId.startsWith(targetPrefix)) {
          console.log(`[SKIP] ${req.deviceId.substring(0, 16)}... (no match)`);
          continue;
        }
        console.log(`[APPROVE] ${req.deviceId.substring(0, 16)}... requestId=${req.requestId}`);
        ws.send(JSON.stringify({
          type: "req", id: crypto.randomUUID(), method: "device.pair.approve",
          params: {
            requestId: req.requestId,
            role: "operator",
            scopes: ["operator.admin", "operator.read", "operator.write", "operator.approvals", "operator.pairing"],
          },
        }));
        approved++;
      }
      if (approved === 0) {
        console.log("[INFO] nothing to approve");
        ws.close();
      }
    } else {
      console.log("[OK] approved:", JSON.stringify(msg.payload || {}));
      ws.close();
    }
    return;
  }
});

ws.on("error", (e) => console.error("[ERR]", e.message));
ws.on("close", () => process.exit(0));
setTimeout(() => { console.log("[TIMEOUT]"); ws.close(); process.exit(1); }, 10000);
