#!/usr/bin/env node
/**
 * OpenClaw Phase 4.5 — Cost Tracking Analyzer
 *
 * 全路徑成本追蹤：
 * - Ollama vs Claude token 使用量
 * - 實時成本計算
 * - 成本與性能的權衡分析
 * - 目標達成率 (85% Ollama / 15% Claude)
 */

const fs = require('fs')
const path = require('path')

const METRICS_DIR = path.join(process.env.HOME, '.claude/metrics')
const COST_LOG = path.join(METRICS_DIR, 'cost_tracking.jsonl')
const OUTPUT = path.join(METRICS_DIR, 'cost_analysis.jsonl')

// Token 成本估算 (基於 Anthropic 定價，後期調整)
const COSTS = {
  ollama: 0,              // Ollama 本地運行，成本為 0
  haiku_input: 0.80 / 1e6,
  haiku_output: 4.0 / 1e6,
  opus_input: 15.0 / 1e6,
  opus_output: 75.0 / 1e6,
}

/**
 * 解析成本日誌
 */
function parseCostLog() {
  if (!fs.existsSync(COST_LOG)) {
    console.log('[cost-tracker] Log file not found:', COST_LOG)
    return []
  }

  const content = fs.readFileSync(COST_LOG, 'utf-8')
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
 * 計算成本
 */
function calculateCost(log) {
  if (log.model === 'ollama') {
    return { model: 'ollama', input_cost: 0, output_cost: 0, total: 0 }
  }

  const isOpus = log.model.includes('opus')
  const inputCost = isOpus ? COSTS.opus_input : COSTS.haiku_input
  const outputCost = isOpus ? COSTS.opus_output : COSTS.haiku_output

  const inCost = (log.input_tokens || 0) * inputCost
  const outCost = (log.output_tokens || 0) * outputCost

  return {
    model: log.model,
    input_cost: inCost,
    output_cost: outCost,
    total: inCost + outCost
  }
}

/**
 * 分析成本
 */
function analyzeCost(logs) {
  if (logs.length === 0) {
    return {
      ts: new Date().toISOString(),
      total_requests: 0,
      ollama_requests: 0,
      claude_requests: 0,
      total_cost_usd: 0,
      ollama_ratio: 0,
      claude_ratio: 0,
      goal_ollama_ratio: 85,
      goal_claude_ratio: 15,
      status: 'no_data'
    }
  }

  const ollamaLogs = logs.filter(l => l.model === 'ollama')
  const claudeLogs = logs.filter(l => l.model !== 'ollama')

  let totalCost = 0
  claudeLogs.forEach(log => {
    const cost = calculateCost(log)
    totalCost += cost.total
  })

  const ollamaRatio = Math.round(
    (ollamaLogs.length / logs.length) * 10000
  ) / 100
  const claudeRatio = Math.round(
    (claudeLogs.length / logs.length) * 10000
  ) / 100

  // 計算與目標的偏差
  const ollama_deviation = ollamaRatio - 85
  const claude_deviation = claudeRatio - 15

  return {
    ts: new Date().toISOString(),
    total_requests: logs.length,
    ollama_requests: ollamaLogs.length,
    claude_requests: claudeLogs.length,
    ollama_ratio: ollamaRatio,
    claude_ratio: claudeRatio,
    total_cost_usd: Math.round(totalCost * 1e6) / 1e6,
    avg_cost_per_request: Math.round((totalCost / logs.length) * 1e6) / 1e6,
    goal_ollama_ratio: 85,
    goal_claude_ratio: 15,
    ollama_deviation: ollama_deviation,
    claude_deviation: claude_deviation,
    status: Math.abs(ollama_deviation) <= 5 ? 'on_target' : 'needs_tuning'
  }
}

/**
 * 主流程
 */
async function main() {
  try {
    console.log('[cost-tracker] Starting analysis...')

    const logs = parseCostLog()
    const analysis = analyzeCost(logs)

    // 寫入分析結果
    fs.appendFileSync(OUTPUT, JSON.stringify(analysis) + '\n')

    console.log('[cost-tracker] Analysis complete')
    console.log(JSON.stringify(analysis, null, 2))

    process.exit(0)
  } catch (err) {
    console.error('[cost-tracker] Error:', err.message)
    process.exit(1)
  }
}

main()
