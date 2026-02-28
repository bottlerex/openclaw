// ─── Intent Momentum — adaptive mode system with decay ────────────────
// Extracted from tool-wrapper-proxy.cjs — mode scoring + control plane event logging
"use strict";

const path = require("path");
const fs = require("fs");
const { updateDrift, recordFalseWarmDrift } = require("./drift-detector.cjs");

const MODE_DECAY = 0.85; // decay factor per task
const MODE_BOOST = 2; // boost for matching intent
const MODE_PENALTY = -0.5; // penalty for non-matching
const MODE_THRESHOLD = 3; // minimum score to activate mode

const _modeScores = {
  coding: 0, // implementation, refactor, design
  ops: 0, // docker, service_ops, deploy, cleanup
  debugging: 0, // git (diff/log), system, test
  research: 0, // general, config, file_ops, install
};

// Map intents to modes
const INTENT_TO_MODE = {
  implementation: "coding",
  refactor: "coding",
  design: "coding",
  docker: "ops",
  service_ops: "ops",
  deploy: "ops",
  cleanup: "ops",
  git: "debugging",
  system: "debugging",
  test: "debugging",
  general: "research",
  config: "research",
  file_ops: "research",
  install: "research",
};

function updateMomentum(intent) {
  const targetMode = INTENT_TO_MODE[intent] || "research";

  // Decay all scores
  for (const mode of Object.keys(_modeScores)) {
    _modeScores[mode] *= MODE_DECAY;
  }
  // Boost matching mode
  _modeScores[targetMode] += MODE_BOOST;
  // Small penalty to others (keeps modes competitive)
  for (const mode of Object.keys(_modeScores)) {
    if (mode !== targetMode) {
      _modeScores[mode] += MODE_PENALTY;
    }
    if (_modeScores[mode] < 0) {
      _modeScores[mode] = 0;
    }
  }
}

function getActiveMode() {
  let best = null;
  let bestScore = MODE_THRESHOLD; // must exceed threshold
  for (const [mode, score] of Object.entries(_modeScores)) {
    if (score > bestScore) {
      best = mode;
      bestScore = score;
    }
  }
  return best; // null = no dominant mode
}

// Mode effects on routing parameters (only touches control plane)
function getModeAdjustments(mode) {
  switch (mode) {
    case "coding":
      return { sessionCostMultiplier: 0.8, cooldownOverride: 5000, predictionThreshold: 0.45 };
    case "ops":
      return { sessionCostMultiplier: 1.5, cooldownOverride: null, predictionThreshold: 0.7 };
    case "debugging":
      return { sessionCostMultiplier: 1.0, cooldownOverride: null, predictionThreshold: 0.6 };
    case "research":
      return { sessionCostMultiplier: 1.2, cooldownOverride: null, predictionThreshold: 0.65 };
    default:
      return { sessionCostMultiplier: 1.0, cooldownOverride: null, predictionThreshold: 0.6 };
  }
}

function getModeScores() {
  return _modeScores;
}

// ─── Control Plane Event Logging — append-only observability ──────────
const CP_EVENTS_PATH = path.join(
  process.env.OPENCLAW_CONFIG_DIR || "/Users/rexmacmini/.openclaw",
  "routing-events.jsonl",
);
const CP_MODE_HISTORY_PATH = path.join(
  process.env.OPENCLAW_CONFIG_DIR || "/Users/rexmacmini/.openclaw",
  "mode-history.jsonl",
);
const _predictionTracker = { hits: 0, misses: 0, total: 0, falseWarms: 0 };
const _routingEvents = []; // in-memory ring buffer (last 200)
const MAX_EVENTS = 200;

function recordRoutingEvent(event) {
  event.ts = Date.now();
  _routingEvents.push(event);
  if (_routingEvents.length > MAX_EVENTS) {
    _routingEvents.shift();
  }
  // Append to file (non-blocking)
  try {
    fs.appendFile(CP_EVENTS_PATH, JSON.stringify(event) + "\n", () => {});
  } catch {}
  updateDrift(event);
}

// lastIntent is passed from caller (owned by predictive-router module)
function recordModeSnapshot(lastIntent) {
  const snapshot = {
    ts: Date.now(),
    mode: getActiveMode(),
    scores: { ..._modeScores },
    lastIntent: lastIntent || null,
  };
  try {
    fs.appendFile(CP_MODE_HISTORY_PATH, JSON.stringify(snapshot) + "\n", () => {});
  } catch {}
  return snapshot;
}

function trackPrediction(predicted, actual) {
  if (!predicted) {
    return;
  } // no prediction made
  _predictionTracker.total++;
  if (predicted === actual) {
    _predictionTracker.hits++;
  } else {
    _predictionTracker.misses++;
    if (predicted === "session_bridge" && actual === "dev_loop") {
      _predictionTracker.falseWarms++;
    }
  }
  recordFalseWarmDrift(predicted === "session_bridge" && actual === "dev_loop");
}

module.exports = {
  updateMomentum,
  getActiveMode,
  getModeAdjustments,
  getModeScores,
  recordRoutingEvent,
  recordModeSnapshot,
  trackPrediction,
};
