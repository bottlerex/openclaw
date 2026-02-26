#!/usr/bin/env node
/**
 * OpenClaw Phase 4.5 — Streaming Metrics Analyzer
 *
 * 監控流媒體延遲：
 * - TTFT (Time To First Token) - 首個 token 延遲
 * - TPS (Tokens Per Second) - 生成速度
 * - End-to-end latency 分佈
 * - Warm-keep 對 idle 模型的影響
 */

const fs = require('fs')
const path = require('path')

const METRICS_DIR = path.join(process.env.HOME, '.claude/metrics')
const STREAMING_LOG = path.join(METRICS_DIR, 'streaming_metrics.jsonl')
const OUTPUT = path.join(METRICS_DIR, 'streaming_analysis.jsonl')

/**
 * 解析流媒體日誌
 */
function parseStreamingLog() {
  if (!fs.existsSync(STREAMING_LOG)) {
    console.log('[streaming-metrics] Log file not found:', STREAMING_LOG)
    return []
  }

  const content = fs.readFileSync(STREAMING_LOG, 'utf-8')
  const lines = content.split('\n').filter(l => l.trim())

  return lines.map(line => {
    try {
      return JSON.parse(line)
    } catch {
      return null
    }
  }).filter(Boolean)
}

/**
 * 計算百分位數
 */
function percentile(arr, p) {
  if (arr.length === 0) return 0
  const sorted = arr.sort((a, b) => a - b)
  const index = Math.ceil((sorted.length * p) / 100) - 1
  return sorted[Math.max(0, index)]
}

/**
 * 分析流媒體指標
 */
function analyzeStreamingMetrics(logs) {
  if (logs.length === 0) {
    return {
      ts: new Date().toISOString(),
      total_streams: 0,
      ollama_streams: 0,
      claude_streams: 0,
      avg_ttft_ms: 0,
      p50_ttft_ms: 0,
      p95_ttft_ms: 0,
      p99_ttft_ms: 0,
      avg_tps: 0,
      status: 'no_data'
    }
  }

  // 按模型分類
  const ollamaLogs = logs.filter(l => l.model === 'ollama')
  const claudeLogs = logs.filter(l => l.model !== 'ollama')

  // 計算 TTFT 統計
  const allTTFTs = logs.map(l => l.ttft_ms || 0).filter(t => t > 0)
  const ollamaTTFTs = ollamaLogs.map(l => l.ttft_ms || 0).filter(t => t > 0)
  const claudeTTFTs = claudeLogs.map(l => l.ttft_ms || 0).filter(t => t > 0)

  // 計算 TPS 統計
  const allTPS = logs.map(l => {
    if (l.total_tokens && l.duration_ms && l.duration_ms > 0) {
      return l.total_tokens / (l.duration_ms / 1000)
    }
    return 0
  }).filter(t => t > 0)

  return {
    ts: new Date().toISOString(),
    total_streams: logs.length,
    ollama_streams: ollamaLogs.length,
    claude_streams: claudeLogs.length,

    // TTFT 統計
    avg_ttft_ms: Math.round(
      allTTFTs.reduce((s, v) => s + v, 0) / (allTTFTs.length || 1)
    ),
    p50_ttft_ms: percentile(allTTFTs, 50),
    p95_ttft_ms: percentile(allTTFTs, 95),
    p99_ttft_ms: percentile(allTTFTs, 99),

    // 按模型的 TTFT
    ollama_avg_ttft_ms: Math.round(
      ollamaTTFTs.reduce((s, v) => s + v, 0) / (ollamaTTFTs.length || 1)
    ),
    claude_avg_ttft_ms: Math.round(
      claudeTTFTs.reduce((s, v) => s + v, 0) / (claudeTTFTs.length || 1)
    ),

    // TPS 統計
    avg_tps: Math.round(
      allTPS.reduce((s, v) => s + v, 0) / (allTPS.length || 1) * 100
    ) / 100,
    p50_tps: Math.round(percentile(allTPS, 50) * 100) / 100,
    p95_tps: Math.round(percentile(allTPS, 95) * 100) / 100,

    // Warm-keep 效果
    warm_keep_count: logs.filter(l => l.warm_kept).length,
    warm_keep_ttft_improvement: calculateWarmKeepImprovement(logs),

    status: percentile(allTTFTs, 95) < 500 ? 'healthy' : 'slow'
  }
}

/**
 * 計算 warm-keep 對 TTFT 的改善
 */
function calculateWarmKeepImprovement(logs) {
  const warmLogs = logs.filter(l => l.warm_kept)
  const coldLogs = logs.filter(l => !l.warm_kept)

  if (warmLogs.length === 0 || coldLogs.length === 0) {
    return 0
  }

  const warmAvg = warmLogs.reduce((s, l) => s + (l.ttft_ms || 0), 0) / warmLogs.length
  const coldAvg = coldLogs.reduce((s, l) => s + (l.ttft_ms || 0), 0) / coldLogs.length

  const improvement = ((coldAvg - warmAvg) / coldAvg) * 100
  return Math.round(improvement)
}

/**
 * 主流程
 */
async function main() {
  try {
    console.log('[streaming-metrics] Starting analysis...')

    const logs = parseStreamingLog()
    const analysis = analyzeStreamingMetrics(logs)

    // 寫入分析結果
    fs.appendFileSync(OUTPUT, JSON.stringify(analysis) + '\n')

    console.log('[streaming-metrics] Analysis complete')
    console.log(JSON.stringify(analysis, null, 2))

    process.exit(0)
  } catch (err) {
    console.error('[streaming-metrics] Error:', err.message)
    process.exit(1)
  }
}

main()
