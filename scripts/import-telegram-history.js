#!/usr/bin/env node
/**
 * Import Telegram history into OpenClaw Mem0 metrics.
 *
 * Usage:
 *   1. Export chat from Telegram Desktop: Settings > Advanced > Export Telegram data
 *      - Select JSON format
 *      - Save to ~/Downloads/telegram-export/
 *   2. Run: node import-telegram-history.js [path-to-result.json]
 *
 * Default path: ~/Downloads/telegram-export/result.json
 *
 * This script reads the exported JSON, extracts meaningful messages,
 * and writes them to the memory-metrics.jsonl file for dashboard tracking.
 * Actual memory storage requires OpenClaw's memory_store tool.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const METRICS_DIR = path.join(os.homedir(), ".openclaw", "memory", "metrics");
const METRICS_FILE = path.join(METRICS_DIR, "memory-metrics.jsonl");
const DEFAULT_EXPORT = path.join(os.homedir(), "Downloads", "telegram-export", "result.json");

// Memory trigger patterns (same as plugin)
const MEMORY_TRIGGERS = [
  /remember|zapamatuj/i,
  /prefer|like|love|hate|want|need|use|choose/i,
  /always|never|important|favorite/i,
  /decided|will use|switched|migrated|chose/i,
  /deploy|config|api.?key|database|server|docker|version/i,
  /install|setup|migrate|upgrade/i,
  /bug|fix|issue|error|crash|timeout/i,
  /喜歡|偏好|決定|選擇|使用|設定|記住|部署|問題|解決/,
  /不要|總是|從不|重要|必須|應該/,
  /project|repo|branch|commit|release/i,
  /deadline|schedule|plan|meeting/i,
  /i am|i'm a|i work|i live/i,
  /my\s+\w+\s+is/i,
];

function shouldImport(text) {
  if (!text || text.length < 5 || text.length > 1000) return false;
  if (text.startsWith("/")) return false; // Skip bot commands
  return MEMORY_TRIGGERS.some((r) => r.test(text));
}

function detectCategory(text) {
  const lower = text.toLowerCase();
  if (/prefer|like|love|hate|want|favorite|喜歡|偏好|不要|總是|從不/i.test(lower)) return "preference";
  if (/decided|will use|chose|switched|migrated|決定|選擇|改用/i.test(lower)) return "decision";
  if (/\+\d{10,}|@[\w.-]+\.\w+|named|叫做/i.test(lower)) return "entity";
  if (/deploy|config|server|version|setup|install|部署|設定|問題|解決/i.test(lower)) return "fact";
  return "other";
}

function main() {
  const exportPath = process.argv[2] || DEFAULT_EXPORT;

  if (!fs.existsSync(exportPath)) {
    console.error(`Export file not found: ${exportPath}`);
    console.error("");
    console.error("To export Telegram history:");
    console.error("  1. Open Telegram Desktop");
    console.error("  2. Settings > Advanced > Export Telegram data");
    console.error("  3. Select JSON format");
    console.error("  4. Save to ~/Downloads/telegram-export/");
    console.error("");
    console.error(`Or specify a path: node ${path.basename(__filename)} /path/to/result.json`);
    process.exit(1);
  }

  console.log(`Reading: ${exportPath}`);
  const data = JSON.parse(fs.readFileSync(exportPath, "utf-8"));

  // Telegram Desktop exports chats in data.chats.list[]
  const chats = data.chats?.list || [];
  if (chats.length === 0) {
    console.error("No chats found in export.");
    process.exit(1);
  }

  // Filter: only personal/direct chats, last 3 months
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  let imported = 0;
  let skipped = 0;
  let total = 0;
  const records = [];

  for (const chat of chats) {
    const messages = chat.messages || [];
    for (const msg of messages) {
      total++;
      // Extract text content
      let text = "";
      if (typeof msg.text === "string") {
        text = msg.text;
      } else if (Array.isArray(msg.text)) {
        text = msg.text
          .map((part) => (typeof part === "string" ? part : part.text || ""))
          .join("");
      }

      if (!text) { skipped++; continue; }

      // Date filter
      const msgDate = new Date(msg.date);
      if (msgDate < threeMonthsAgo) { skipped++; continue; }

      // Content filter
      if (!shouldImport(text)) { skipped++; continue; }

      const category = detectCategory(text);
      records.push(
        JSON.stringify({
          ts: msgDate.toISOString(),
          event: "memory_add",
          category,
          textLen: text.length,
          source: "telegram_import",
        })
      );
      imported++;
    }
  }

  if (records.length === 0) {
    console.log(`Processed ${total} messages, none matched import criteria.`);
    return;
  }

  // Write to metrics
  fs.mkdirSync(METRICS_DIR, { recursive: true });
  fs.appendFileSync(METRICS_FILE, records.join("\n") + "\n");

  console.log(`Processed ${total} messages:`);
  console.log(`  Imported: ${imported}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Metrics written to: ${METRICS_FILE}`);
  console.log("");
  console.log("NOTE: This imports metadata to the dashboard metrics.");
  console.log("To actually store memories in LanceDB, use 'openclaw ltm' or the memory_store tool.");
}

main();
