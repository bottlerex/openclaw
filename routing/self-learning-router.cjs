// ─── Self-Learning Router — adaptive routing based on execution history ────
// Extracted from tool-wrapper-proxy.cjs — intent extraction + cost-based routing
"use strict";

const path = require("path");
const fs = require("fs");
const { getActiveMode, getModeAdjustments } = require("./intent-momentum.cjs");

const ROUTING_STATS_PATH = path.join(
  process.env.OPENCLAW_CONFIG_DIR || "/Users/rexmacmini/.openclaw",
  "routing-stats.json",
);
const MIN_SAMPLES_FOR_LEARNING = 5; // fallback to rule-based below this
const SESSION_COOLDOWN_MS = 20000; // 20s between session spawns
const SWITCH_THRESHOLD = 1.35; // hysteresis: 35% cost difference needed to switch
const FAILURE_PENALTY = 1.8; // multiply cost by this on recent failure

let _lastSessionSpawn = 0;
const _lastRouteByIntent = {}; // track last route per intent for hysteresis

function loadRoutingStats() {
  try {
    if (fs.existsSync(ROUTING_STATS_PATH)) {
      return JSON.parse(fs.readFileSync(ROUTING_STATS_PATH, "utf8"));
    }
  } catch (e) {
    console.error("[wrapper] Failed to load routing stats:", e.message);
  }
  return {};
}

function saveRoutingStats(stats) {
  try {
    fs.writeFileSync(ROUTING_STATS_PATH, JSON.stringify(stats, null, 2), "utf8");
  } catch (e) {
    console.error("[wrapper] Failed to save routing stats:", e.message);
  }
}

// Intent fingerprint — stable, explainable, near-zero cost
function extractIntent(text) {
  const lower = text.toLowerCase();
  if (/docker|container|image|volume/.test(lower)) {
    return "docker";
  }
  if (/git|commit|diff|branch|push|pull|merge/.test(lower)) {
    return "git";
  }
  if (/endpoint|api|feature|module|component/.test(lower)) {
    return "implementation";
  }
  if (/memory|disk|process|cpu|系統|system_info/.test(lower)) {
    return "system";
  }
  if (/deploy|部署|上線|release/.test(lower)) {
    return "deploy";
  }
  if (/cleanup|清理|刪除|remove|prune/.test(lower)) {
    return "cleanup";
  }
  if (/config|設定|configure/.test(lower)) {
    return "config";
  }
  if (/test|測試|spec/.test(lower)) {
    return "test";
  }
  if (/file|檔案|read|write|list|目錄|directory|backup|備份/.test(lower)) {
    return "file_ops";
  }
  if (/install|安裝|update|更新|upgrade/.test(lower)) {
    return "install";
  }
  if (/restart|重啟|start|stop|啟動|停止/.test(lower)) {
    return "service_ops";
  }
  if (/refactor|重構|migrate|遷移|整合|integrate/.test(lower)) {
    return "refactor";
  }
  if (/design|設計|architecture|架構/.test(lower)) {
    return "design";
  }
  return "general";
}

// Expected cost = latency / success_rate (lower is better)
function expectedCost(stats) {
  if (!stats || stats.success + stats.fail === 0) {
    return Infinity;
  }
  const successRate = stats.success / Math.max(1, stats.success + stats.fail);
  return stats.avg_latency / Math.max(successRate, 0.2);
}

// Decide routing based on historical performance
// Includes: hysteresis (anti-thrashing), failure penalty, cooldown enforcement
// Returns: { route: "dev_loop"|"session_bridge", reason: string }
function learningRoute(intent, ruleBasedDecision) {
  const allStats = loadRoutingStats();
  const intentStats = allStats[intent];

  // Safety guard: not enough data -> fallback to rule-based
  if (!intentStats) {
    return { route: ruleBasedDecision, reason: "no_history" };
  }
  const devSamples = intentStats.dev_loop
    ? intentStats.dev_loop.success + intentStats.dev_loop.fail
    : 0;
  const sesSamples = intentStats.session_bridge
    ? intentStats.session_bridge.success + intentStats.session_bridge.fail
    : 0;

  if (devSamples < MIN_SAMPLES_FOR_LEARNING && sesSamples < MIN_SAMPLES_FOR_LEARNING) {
    return { route: ruleBasedDecision, reason: `low_samples(dev=${devSamples},ses=${sesSamples})` };
  }

  // Compute costs with failure penalty
  let devCost = expectedCost(intentStats.dev_loop);
  let sesCost = expectedCost(intentStats.session_bridge);

  // Apply failure penalty: if recent failure rate > 30%, increase cost
  if (intentStats.dev_loop && intentStats.dev_loop.fail > 0) {
    const devFailRate =
      intentStats.dev_loop.fail / (intentStats.dev_loop.success + intentStats.dev_loop.fail);
    if (devFailRate > 0.3) {
      devCost *= FAILURE_PENALTY;
    }
  }
  if (intentStats.session_bridge && intentStats.session_bridge.fail > 0) {
    const sesFailRate =
      intentStats.session_bridge.fail /
      (intentStats.session_bridge.success + intentStats.session_bridge.fail);
    if (sesFailRate > 0.3) {
      sesCost *= FAILURE_PENALTY;
    }
  }

  // Mode bias: coding mode reduces session cost (favors Claude), ops mode increases it
  const _lrMode = getActiveMode();
  if (_lrMode) {
    const _adj = getModeAdjustments(_lrMode);
    sesCost *= _adj.sessionCostMultiplier;
  }

  // Cooldown enforcement: if session was spawned recently, bias toward dev_loop
  const effectiveCooldown =
    (_lrMode && getModeAdjustments(_lrMode).cooldownOverride) || SESSION_COOLDOWN_MS;
  const timeSinceLastSession = Date.now() - _lastSessionSpawn;
  if (timeSinceLastSession < effectiveCooldown) {
    return {
      route: "dev_loop",
      reason: `cooldown(${Math.round((SESSION_COOLDOWN_MS - timeSinceLastSession) / 1000)}s remaining)`,
    };
  }

  // Hysteresis: require SWITCH_THRESHOLD cost ratio to change from last route
  const lastRoute = _lastRouteByIntent[intent];
  let route;
  if (lastRoute === "dev_loop" && sesCost < devCost / SWITCH_THRESHOLD) {
    route = "session_bridge";
  } else if (lastRoute === "session_bridge" && devCost < sesCost / SWITCH_THRESHOLD) {
    route = "dev_loop";
  } else if (lastRoute) {
    // Not enough difference — stay on current route (stability)
    route = lastRoute;
  } else {
    // No history — use cost comparison
    route = devCost <= sesCost ? "dev_loop" : "session_bridge";
  }

  _lastRouteByIntent[intent] = route;
  const switched = route !== ruleBasedDecision;
  return {
    route,
    reason: `${switched ? "learned" : "confirmed"}(dev=${devCost.toFixed(1)},ses=${sesCost.toFixed(1)},hysteresis=${SWITCH_THRESHOLD},last=${lastRoute || "none"})`,
  };
}

// Record execution outcome — called after task completes
function recordRoutingOutcome(intent, executor, success, latencyMs) {
  const allStats = loadRoutingStats();
  if (!allStats[intent]) {
    allStats[intent] = {};
  }
  if (!allStats[intent][executor]) {
    allStats[intent][executor] = { success: 0, fail: 0, avg_latency: 0, samples: 0 };
  }
  const s = allStats[intent][executor];
  s.samples = (s.samples || 0) + 1;
  if (success) {
    s.success++;
  } else {
    s.fail++;
  }
  // Exponential moving average for latency (alpha=0.3 for responsiveness)
  const alpha = 0.3;
  s.avg_latency = s.avg_latency === 0 ? latencyMs : s.avg_latency * (1 - alpha) + latencyMs * alpha;
  saveRoutingStats(allStats);
  console.log(
    `[wrapper] ROUTING_FEEDBACK: intent=${intent} executor=${executor} success=${success} latency=${latencyMs}ms avg=${s.avg_latency.toFixed(0)}ms samples=${s.samples}`,
  );
}

function getLastSessionSpawn() {
  return _lastSessionSpawn;
}

function setLastSessionSpawn(ts) {
  _lastSessionSpawn = ts;
}

module.exports = {
  extractIntent,
  expectedCost,
  learningRoute,
  recordRoutingOutcome,
  loadRoutingStats,
  getLastSessionSpawn,
  setLastSessionSpawn,
};
