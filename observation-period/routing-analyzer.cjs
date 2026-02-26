#!/usr/bin/env node
/**
 * OpenClaw Phase 4.5 — Routing Decision Analyzer
 *
 * 監控路由決策日誌，計算：
 * - Ollama vs Claude 路由比例
 * - 路由延遲分佈
 * - 失敗回落率
 * - 路由熵（穩定性）
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const METRICS_DIR = path.join(process.env.HOME, '.claude/metrics')
const ROUTING_LOG = path.join(METRICS_DIR, 'routing_log.jsonl')
const OUTPUT = path.join(METRICS_DIR, 'routing_analysis.jsonl')

/**
 * 從 OpenClaw 日誌中提取路由決策
 */
function extractRoutingDecisions() {
  const logFile = '/tmp/openclaw/openclaw.log'

  if (!fs.existsSync(logFile)) {
    console.log('[routing-analyzer] Log file not found:', logFile)
    return []
  }

  const content = fs.readFileSync(logFile, 'utf-8')
  const decisions = []

  // 正則表達式匹配路由決策日誌
  // 格式: [routing] decision: <model>, latency: <ms>, fallback: <count>
  const pattern = /\[routing\] decision: (\w+), latency: (\d+)ms, fallback: (\d+)/g

  let match
  while ((match = pattern.exec(content)) !== null) {
    decisions.push({
      ts: new Date().toISOString(),
      model: match[1],      // 'ollama' or 'claude'
      latency_ms: parseInt(match[2]),
      fallback_count: parseInt(match[3]),
    })
  }

  return decisions
}

/**
 * 分析路由決策
 */
function analyzeDecisions(decisions) {
  if (decisions.length === 0) {
    return {
      ts: new Date().toISOString(),
      total_decisions: 0,
      ollama_count: 0,
      claude_count: 0,
      ollama_ratio: 0,
      claude_ratio: 0,
      avg_latency_ms: 0,
      fallback_rate: 0,
      routing_entropy: 0,
      error: 'no decisions recorded yet'
    }
  }

  const ollama = decisions.filter(d => d.model === 'ollama')
  const claude = decisions.filter(d => d.model === 'claude')
  const totalFallbacks = decisions.reduce((s, d) => s + d.fallback_count, 0)

  // 計算路由熵 (Shannon entropy)
  const ollama_ratio = ollama.length / decisions.length
  const claude_ratio = claude.length / decisions.length
  const entropy = -(
    (ollama_ratio > 0 ? ollama_ratio * Math.log2(ollama_ratio) : 0) +
    (claude_ratio > 0 ? claude_ratio * Math.log2(claude_ratio) : 0)
  )

  return {
    ts: new Date().toISOString(),
    total_decisions: decisions.length,
    ollama_count: ollama.length,
    claude_count: claude.length,
    ollama_ratio: Math.round(ollama_ratio * 10000) / 100,  // %
    claude_ratio: Math.round(claude_ratio * 10000) / 100,  // %
    avg_latency_ms: Math.round(
      decisions.reduce((s, d) => s + d.latency_ms, 0) / decisions.length
    ),
    fallback_rate: Math.round(
      (totalFallbacks / decisions.length) * 10000
    ) / 100,  // %
    routing_entropy: Math.round(entropy * 100) / 100,
    goal_ollama_ratio: 85,
    goal_claude_ratio: 15,
    status: ollama_ratio >= 0.80 ? 'on_target' : 'needs_tuning'
  }
}

/**
 * 主流程
 */
async function main() {
  try {
    console.log('[routing-analyzer] Starting analysis...')

    const decisions = extractRoutingDecisions()
    const analysis = analyzeDecisions(decisions)

    // 寫入分析結果
    fs.appendFileSync(OUTPUT, JSON.stringify(analysis) + '\n')

    console.log('[routing-analyzer] Analysis complete')
    console.log(JSON.stringify(analysis, null, 2))

    process.exit(0)
  } catch (err) {
    console.error('[routing-analyzer] Error:', err.message)
    process.exit(1)
  }
}

main()
