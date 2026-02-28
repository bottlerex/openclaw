// ─── Drift Detection ──────────────────────────────────────────────
// Extracted from tool-wrapper-proxy.cjs — monitors routing quality drift
"use strict";

const DRIFT_ALPHA = 0.1;
const DRIFT_BASELINE_MIN = 30;

const _driftState = {
  baselinePredAcc: null,
  baselineLatency: null,
  baselineSessionRatio: null,
  baselineFalseWarm: null,
  samplesForBaseline: 0,
  currentPredAcc: null,
  currentLatency: null,
  currentSessionRatio: null,
  currentFalseWarm: null,
  recentModes: [],
  lastStatsUpdate: Date.now(),
  alerts: [],
};

function updateDrift(event) {
  const s = _driftState;
  s.samplesForBaseline++;
  s.lastStatsUpdate = Date.now();
  if (event.predicted) {
    const hit = event.predicted === event.executor ? 1 : 0;
    s.currentPredAcc =
      s.currentPredAcc === null ? hit : s.currentPredAcc * (1 - DRIFT_ALPHA) + hit * DRIFT_ALPHA;
  }
  const isSes = event.executor === "session_bridge" ? 1 : 0;
  s.currentSessionRatio =
    s.currentSessionRatio === null
      ? isSes
      : s.currentSessionRatio * (1 - DRIFT_ALPHA) + isSes * DRIFT_ALPHA;
  if (event.mode) {
    s.recentModes.push(event.mode);
    if (s.recentModes.length > 20) {
      s.recentModes.shift();
    }
  }
  if (s.samplesForBaseline === DRIFT_BASELINE_MIN) {
    s.baselinePredAcc = s.currentPredAcc;
    s.baselineSessionRatio = s.currentSessionRatio;
  }
  if (s.samplesForBaseline > DRIFT_BASELINE_MIN) {
    checkDriftAlerts();
  }
}

function recordLatencyDrift(latencyMs) {
  const s = _driftState;
  s.currentLatency =
    s.currentLatency === null
      ? latencyMs
      : s.currentLatency * (1 - DRIFT_ALPHA) + latencyMs * DRIFT_ALPHA;
  if (s.samplesForBaseline === DRIFT_BASELINE_MIN && s.baselineLatency === null) {
    s.baselineLatency = s.currentLatency;
  }
}

function recordFalseWarmDrift(isFalseWarm) {
  const s = _driftState;
  const v = isFalseWarm ? 1 : 0;
  s.currentFalseWarm =
    s.currentFalseWarm === null ? v : s.currentFalseWarm * (1 - DRIFT_ALPHA) + v * DRIFT_ALPHA;
  if (s.samplesForBaseline === DRIFT_BASELINE_MIN && s.baselineFalseWarm === null) {
    s.baselineFalseWarm = s.currentFalseWarm;
  }
}

function checkDriftAlerts() {
  const s = _driftState;
  const now = Date.now();
  const alerts = [];
  if (s.baselinePredAcc !== null && s.currentPredAcc !== null) {
    const drop = s.baselinePredAcc - s.currentPredAcc;
    if (drop > 0.15) {
      alerts.push({
        type: "pred_accuracy",
        severity: drop > 0.25 ? "critical" : "warning",
        msg: "預測準確率下降 " + (drop * 100).toFixed(0) + "%",
        baseline: s.baselinePredAcc,
        current: s.currentPredAcc,
      });
    }
  }
  if (s.baselineLatency !== null && s.currentLatency !== null) {
    const inc = (s.currentLatency - s.baselineLatency) / s.baselineLatency;
    if (inc > 0.3) {
      alerts.push({
        type: "latency",
        severity: inc > 0.5 ? "critical" : "warning",
        msg: "延遲上升 " + (inc * 100).toFixed(0) + "%",
        baseline: s.baselineLatency,
        current: s.currentLatency,
      });
    }
  }
  if (s.recentModes.length >= 10) {
    let sw = 0;
    for (let i = 1; i < s.recentModes.length; i++) {
      if (s.recentModes[i] !== s.recentModes[i - 1]) {
        sw++;
      }
    }
    const rate = sw / (s.recentModes.length - 1);
    if (rate > 0.25) {
      alerts.push({
        type: "mode_oscillation",
        severity: rate > 0.4 ? "critical" : "warning",
        msg: "模式震盪率 " + (rate * 100).toFixed(0) + "%",
        rate,
      });
    }
  }
  if (s.baselineSessionRatio !== null && s.currentSessionRatio !== null) {
    const shift = Math.abs(s.currentSessionRatio - s.baselineSessionRatio);
    if (shift > 0.2) {
      alerts.push({
        type: "executor_imbalance",
        severity: shift > 0.35 ? "critical" : "warning",
        msg: "執行器比例偏移 " + (shift * 100).toFixed(0) + "%",
        baseline: s.baselineSessionRatio,
        current: s.currentSessionRatio,
      });
    }
  }
  if (now - s.lastStatsUpdate > 2 * 3600 * 1000) {
    alerts.push({
      type: "staleness",
      severity: "warning",
      msg: "學習數據已 " + ((now - s.lastStatsUpdate) / 3600000).toFixed(1) + "h 未更新",
    });
  }
  if (s.currentFalseWarm !== null && s.currentFalseWarm > 0.3) {
    alerts.push({
      type: "false_warm",
      severity: s.currentFalseWarm > 0.45 ? "critical" : "warning",
      msg: "誤預熱率 " + (s.currentFalseWarm * 100).toFixed(0) + "%",
      rate: s.currentFalseWarm,
    });
  }
  for (const a of alerts) {
    a.ts = now;
    const idx = s.alerts.findIndex((x) => x.type === a.type);
    if (idx !== -1) {
      s.alerts[idx] = a;
    } else {
      s.alerts.push(a);
    }
    if (s.alerts.length > 50) {
      s.alerts.shift();
    }
  }
  const activeTypes = new Set(alerts.map((a) => a.type));
  s.alerts = s.alerts.filter((a) => activeTypes.has(a.type) || now - a.ts < 600000);
}

function getDriftAnalysis() {
  const s = _driftState;
  const msr =
    s.recentModes.length >= 2
      ? (() => {
          let sw = 0;
          for (let i = 1; i < s.recentModes.length; i++) {
            if (s.recentModes[i] !== s.recentModes[i - 1]) {
              sw++;
            }
          }
          return ((sw / (s.recentModes.length - 1)) * 100).toFixed(1) + "%";
        })()
      : null;
  return {
    status: s.alerts.some((a) => a.severity === "critical")
      ? "critical"
      : s.alerts.length > 0
        ? "warning"
        : "healthy",
    samples: s.samplesForBaseline,
    baselineEstablished: s.samplesForBaseline >= DRIFT_BASELINE_MIN,
    baselines: {
      predAccuracy: s.baselinePredAcc !== null ? (s.baselinePredAcc * 100).toFixed(1) + "%" : null,
      latency: s.baselineLatency !== null ? Math.round(s.baselineLatency) + "ms" : null,
      sessionRatio:
        s.baselineSessionRatio !== null ? (s.baselineSessionRatio * 100).toFixed(1) + "%" : null,
      falseWarmRate:
        s.baselineFalseWarm !== null ? (s.baselineFalseWarm * 100).toFixed(1) + "%" : null,
    },
    current: {
      predAccuracy: s.currentPredAcc !== null ? (s.currentPredAcc * 100).toFixed(1) + "%" : null,
      latency: s.currentLatency !== null ? Math.round(s.currentLatency) + "ms" : null,
      sessionRatio:
        s.currentSessionRatio !== null ? (s.currentSessionRatio * 100).toFixed(1) + "%" : null,
      falseWarmRate:
        s.currentFalseWarm !== null ? (s.currentFalseWarm * 100).toFixed(1) + "%" : null,
      modeSwitchRate: msr,
    },
    alerts: s.alerts,
    lastUpdate: s.lastStatsUpdate,
  };
}

module.exports = {
  updateDrift,
  recordLatencyDrift,
  recordFalseWarmDrift,
  getDriftAnalysis,
};
