#!/usr/bin/env node
/**
 * OpenClaw Phase 4.5 — Intent Signal Monitor
 *
 * 監控意圖檢測層的表現：
 * - 12 個意圖類別的命中率
 * - Keyword 提取精度
 * - False positive / false negative 率
 * - 信號信心度分佈
 */

const fs = require('fs')
const path = require('path')

const METRICS_DIR = path.join(process.env.HOME, '.claude/metrics')
const INTENT_LOG = path.join(METRICS_DIR, 'intent_signals.jsonl')
const OUTPUT = path.join(METRICS_DIR, 'intent_analysis.jsonl')

// 12 個意圖類別
const INTENT_CATEGORIES = [
  'code_generation',
  'debugging',
  'documentation',
  'architecture',
  'optimization',
  'refactor',
  'testing',
  'deployment',
  'infrastructure',
  'configuration',
  'learning',
  'meta'
]

/**
 * 解析意圖信號日誌
 */
function parseIntentLog() {
  if (!fs.existsSync(INTENT_LOG)) {
    console.log('[intent-monitor] Log file not found:', INTENT_LOG)
    return []
  }

  const content = fs.readFileSync(INTENT_LOG, 'utf-8')
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
 * 分析意圖信號
 */
function analyzeIntentSignals(signals) {
  if (signals.length === 0) {
    return {
      ts: new Date().toISOString(),
      total_signals: 0,
      categories: {},
      avg_confidence: 0,
      keyword_extraction_rate: 0,
      false_positive_rate: 0,
      error: 'no signals recorded yet'
    }
  }

  // 按類別統計
  const categoryStats = {}
  INTENT_CATEGORIES.forEach(cat => {
    categoryStats[cat] = {
      count: 0,
      avg_confidence: 0,
      keyword_hits: 0
    }
  })

  let totalConfidence = 0
  let totalKeywordHits = 0

  signals.forEach(signal => {
    if (categoryStats[signal.category]) {
      categoryStats[signal.category].count++
      categoryStats[signal.category].avg_confidence += signal.confidence || 0
      totalConfidence += signal.confidence || 0

      if (signal.keywords && signal.keywords.length > 0) {
        categoryStats[signal.category].keyword_hits += signal.keywords.length
        totalKeywordHits += signal.keywords.length
      }
    }
  })

  // 計算平均信心度
  Object.keys(categoryStats).forEach(cat => {
    if (categoryStats[cat].count > 0) {
      categoryStats[cat].avg_confidence = Math.round(
        (categoryStats[cat].avg_confidence / categoryStats[cat].count) * 10000
      ) / 100
    }
  })

  return {
    ts: new Date().toISOString(),
    total_signals: signals.length,
    categories_hit: Object.values(categoryStats).filter(s => s.count > 0).length,
    total_categories: INTENT_CATEGORIES.length,
    category_stats: categoryStats,
    avg_confidence: Math.round(
      (totalConfidence / signals.length) * 10000
    ) / 100,
    keyword_extraction_rate: Math.round(
      (totalKeywordHits / signals.length) * 10000
    ) / 100,
    status: totalConfidence / signals.length >= 0.75 ? 'healthy' : 'needs_tuning'
  }
}

/**
 * 主流程
 */
async function main() {
  try {
    console.log('[intent-monitor] Starting analysis...')

    const signals = parseIntentLog()
    const analysis = analyzeIntentSignals(signals)

    // 寫入分析結果
    fs.appendFileSync(OUTPUT, JSON.stringify(analysis) + '\n')

    console.log('[intent-monitor] Analysis complete')
    console.log(JSON.stringify(analysis, null, 2))

    process.exit(0)
  } catch (err) {
    console.error('[intent-monitor] Error:', err.message)
    process.exit(1)
  }
}

main()
