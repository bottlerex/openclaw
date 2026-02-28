// ─── Predictive Routing — task transition tracking + executor prediction ───
// Extracted from tool-wrapper-proxy.cjs — transition recording + pre-warming
"use strict";

const http = require("http");
const path = require("path");
const fs = require("fs");

const TRANSITIONS_PATH = path.join(
  process.env.OPENCLAW_CONFIG_DIR || "/Users/rexmacmini/.openclaw",
  "task-transitions.json",
);
const PREDICTION_CONFIDENCE = 0.6; // minimum probability to act on prediction
const MIN_SAMPLES = 5; // matches MIN_SAMPLES_FOR_LEARNING in self-learning-router

const SESSION_BRIDGE_PORT = 7788;
const SESSION_BRIDGE_TIMEOUT = 180000; // 3 min max

let _lastIntent = null;

function loadTransitions() {
  try {
    if (fs.existsSync(TRANSITIONS_PATH)) {
      return JSON.parse(fs.readFileSync(TRANSITIONS_PATH, "utf8"));
    }
  } catch (e) {
    console.error("[wrapper] Failed to load transitions:", e.message);
  }
  return {};
}

function saveTransitions(data) {
  try {
    fs.writeFileSync(TRANSITIONS_PATH, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error("[wrapper] Failed to save transitions:", e.message);
  }
}

// Record intent-to-executor transition (not intent-to-intent)
function recordTransition(intent, executor) {
  if (!intent) {
    return;
  }
  const data = loadTransitions();
  if (!data[intent]) {
    data[intent] = { dev_loop: 0, session_bridge: 0 };
  }
  data[intent][executor] = (data[intent][executor] || 0) + 1;
  saveTransitions(data);
}

// Predict which executor the next task for this intent will need
// Returns: "session_bridge" | null (null = no prediction / not confident enough)
function predictExecutor(intent) {
  const data = loadTransitions();
  const stats = data[intent];
  if (!stats) {
    return null;
  }

  const total = (stats.dev_loop || 0) + (stats.session_bridge || 0);
  if (total < MIN_SAMPLES) {
    return null;
  }

  const probSession = (stats.session_bridge || 0) / total;
  if (probSession > PREDICTION_CONFIDENCE) {
    return "session_bridge";
  }
  return null;
}

// Soft pre-warm: notify session bridge to prepare (non-blocking)
function softPreWarm(project) {
  // Fire-and-forget: just ping session bridge health to keep connection warm
  callSessionBridgeAPI("GET", "/health", null).catch(() => {});
  console.log(
    "[wrapper] PREDICTIVE_PREWARM: pinged session-bridge" + (project ? " for " + project : ""),
  );
}

function callSessionBridgeAPI(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const postBody = body ? JSON.stringify(body) : "";
    const opts = {
      hostname: "127.0.0.1",
      port: SESSION_BRIDGE_PORT,
      path: apiPath,
      method,
      headers: { "Content-Type": "application/json" },
      timeout: SESSION_BRIDGE_TIMEOUT,
    };
    if (method !== "GET") {
      opts.headers["Content-Length"] = Buffer.byteLength(postBody);
    }
    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          resolve({ ...JSON.parse(data), _status: res.statusCode });
        } catch {
          reject(new Error("session-bridge invalid response"));
        }
      });
    });
    req.on("error", (e) => reject(new Error(`session-bridge unreachable: ${e.message}`)));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("session-bridge timeout"));
    });
    if (method !== "GET") {
      req.write(postBody);
    }
    req.end();
  });
}

function getLastIntent() {
  return _lastIntent;
}

function setLastIntent(intent) {
  _lastIntent = intent;
}

module.exports = {
  recordTransition,
  predictExecutor,
  softPreWarm,
  callSessionBridgeAPI,
  loadTransitions,
  getLastIntent,
  setLastIntent,
  PREDICTION_CONFIDENCE,
};
