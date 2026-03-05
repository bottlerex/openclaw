#!/usr/bin/env node
// OpenClaw Tool Wrapper Proxy v10.3
// v10.3: systematic fix — unified intent routing, persistent state, Haiku capability injection
// v10.2: mac-agentd integration — structured host execution replacing claude -p
// v10.1: GLM-4.7-Flash Ollama-first routing with Claude fallback
// v10: Mem0 memory layer — persistent cross-session memory via mem0-service (:8002)
// v9: Smart intent (strong/weak signals), /health, /metrics, rate limiting, error handling
// v8: Dev mode — spawn `claude -p` for development tasks (read/write/test)
// v7: CLI tools integration (summarize, gh)
// v6: Multi-skill routing (web_search, system_status, scheduler, google_workspace, etc.)

const http = require('http');
const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ollamaRouter = require('./ollama-router');

const UPSTREAM_HOST = 'localhost';
const UPSTREAM_PORT = 3456;
const LISTEN_PORT = 3457;
const SKILL_API_PORT = 8000;
const MEM0_PORT = 8002;
const VERSION = '10.3.0';
const startedAt = Date.now();

// ─── Metrics ─────────────────────────────────────────────────────

const metrics = {
  requests: 0,
  devMode: 0,
  skillCalls: 0,
  cliCalls: 0,
  normalChat: 0,
  errors: 0,
  rateLimited: 0,
  memorySearches: 0,
  memoryAdds: 0,
  memoryErrors: 0,
  progressQueries: 0,
  ollamaRouted: 0,
  ollamaFallback: 0,
};


// ─── Token Usage Tracking (Rex-AI Dashboard) ─────────────────────

function trackTokenUsage(model, provider, usage, durationMs) {
  if (!usage) return;
  const payload = {
    model: model || "unknown",
    provider: provider || "anthropic",
    input_tokens: usage.input_tokens || usage.prompt_tokens || 0,
    output_tokens: usage.output_tokens || usage.completion_tokens || 0,
    cache_read: usage.cache_read_input_tokens || 0,
    cache_write: usage.cache_creation_input_tokens || 0,
    source: "openclaw",
    duration_ms: durationMs ? Math.round(durationMs) : null,
  };
  const body = JSON.stringify(payload);
  const req = http.request({
    hostname: "localhost",
    port: 8004,
    path: "/api/v1/token-usage",
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    timeout: 3000,
  });
  req.on("error", () => {});
  req.on("timeout", () => req.destroy());
  req.write(body);
  req.end();
}

// ─── Rate Limiting ──────────────────────────────────────────────

const rateLimits = {
  dev: { max: 10, windowMs: 5 * 60 * 1000, hits: [] },   // 10 per 5 min
  skill: { max: 30, windowMs: 60 * 1000, hits: [] },      // 30 per min
};

function checkRateLimit(type) {
  const limit = rateLimits[type];
  if (!limit) return true;
  const now = Date.now();
  limit.hits = limit.hits.filter(t => now - t < limit.windowMs);
  if (limit.hits.length >= limit.max) {
    metrics.rateLimited++;
    return false;
  }
  limit.hits.push(now);
  return true;
}

// ─── Dev Mode Configuration ──────────────────────────────────────

// v10.3: Unified DEV_ACTION_WORDS (merged strong+weak, no longer split)
const DEV_ACTION_WORDS = [
  // 操作類（中文）
  '查看', '看一下', '看看', '幫我看', '檢查', '分析', '優化', '改善', '改一下',
  '修復', '修', '重構', '實作', '開發', '寫', '加', '新增',
  '提交', 'commit', '推送', 'push',
  '跑測試', '測試', '執行測試',
  '重啟', '重啟容器', 'restart',
  '看 log', 'logs', '日誌',
  '狀態', 'status', 'diff',
  '檔案', '讀取', '列出',
  '修改', '清理', '效能優化', '讀檔案', '程式碼審查',
  '部署', '建構', '編譯', '修 bug', '找 bug',
  '進行改善', '直接改善', '幫我改',
  '寫一個', '寫個', '加一個', '加個', '新增功能', '改這個',
  // 確認/執行類（follow-up 常見）
  '執行', '做', '做吧', '好', '繼續', '開始', '進行', '處理',
  'do it', 'go', 'execute', 'proceed', 'yes', 'ok',
  // 操作類（英文）
  'check', 'analyze', 'optimize', 'improve', 'fix', 'refactor',
  'implement', 'develop', 'run test', 'run tests', 'deploy', 'build',
  'write code', 'create function', 'add feature', 'debug', 'review code',
  'modify', 'read file', 'check code',
];

// Last dev-mode project (for follow-up messages without project keyword)
// v10.3: Persisted to /tmp/mac-agentd/last-dev-project.json
let lastDevProject = null;
const LAST_PROJECT_FILE = '/tmp/mac-agentd/last-dev-project.json';

function saveLastProject(dir) {
  lastDevProject = dir;
  try {
    const dirPath = path.dirname(LAST_PROJECT_FILE);
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(LAST_PROJECT_FILE, JSON.stringify({ dir, ts: Date.now() }));
  } catch (e) {
    console.error(`[wrapper] save lastProject error: ${e.message}`);
  }
}

function loadLastProject() {
  try {
    const data = JSON.parse(fs.readFileSync(LAST_PROJECT_FILE, 'utf8'));
    if (Date.now() - data.ts < 3600000) { // 1 hour expiry
      lastDevProject = data.dir;
      console.log(`[wrapper] restored lastDevProject: ${data.dir}`);
    }
  } catch (_) {}
}

// Load on startup
loadLastProject();


// ─── Financial Agent Routing ──────────────────────────────────

// ─── Taiwan Stock MVP Integration ──────────────────────────────
const COMMON_STOCKS = {
  '2330': 'TSMC（台積電）',
  '2454': 'MediaTek（聯發科）', 
  '2882': 'Cathay Pacific',
  '2891': 'CTBC（中信銀）',
  '0050': '元大50',
  '0056': '元大高息',
};

function detectStockSymbol(userText) {
  const lowerText = userText.toLowerCase();
  for (const [code, name] of Object.entries(COMMON_STOCKS)) {
    if (lowerText.includes(code) || lowerText.includes(name)) return code;
  }
  return null;
}

async function fetchTaiwanStockIndicators(stockId) {
  return new Promise((resolve, reject) => {
    const http = require('http');
    const url = 'http://localhost:8888/api/v1/indicators/' + stockId + '/latest';
    http.get(url, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } 
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}


const FINANCIAL_KEYWORDS = [
  '股票', '股市', '台股', 'TAIEX', 'TWII',
  '0050', '0056', '0080', '外資', '投信', '自營商', '法人',
  '技術分析', '基本面', '估值', 'PE', 'PB', '股息', 'dividend',
  '均線', 'MA', 'RSI', 'MACD', 'Bollinger',
  '支撐', '阻力', '突破', '進場', '出場', '停損', '停利',
  '波動', '走勢', '行情', '盤勢', '個股', '漲跌', '成交量',
  '營收', 'ROE', 'ROA', 'EPS', '淨利率',
  'stock', 'market', 'invest', 'trading', 'portfolio',
];

function detectFinancialIntent(userText) {
  if (!userText) return null;
  const lowerText = userText.toLowerCase();
  let matchCount = 0;
  for (const kw of FINANCIAL_KEYWORDS) {
    if (lowerText.includes(kw.toLowerCase())) matchCount++;
    if (matchCount >= 2) return { type: 'financial', keywords: [kw] };
  }
  return null;
}


const PROJECT_ROUTES = [
  { keywords: ['taiwan-stock', 'taiwan stock', '台股系統', '股票系統', '台灣股票', '股票專案', 'stock mvp', 'stock-mvp'], dir: '~/Project/active_projects/taiwan-stock-mvp' },
  { keywords: ['personal-ai', 'personal ai', 'pai', '個人助理', '助理系統'], dir: '~/Project/active_projects/personal-ai-assistant' },
  { keywords: ['openclaw', 'telegram bot', 'bot設定', 'bot 設定'], dir: '~/openclaw' },
  { keywords: ['ai-news', 'ai news', '新聞摘要', '新聞系統'], dir: '~/Project/active_projects/ai-news-digest' },
  { keywords: ['stationery', '文具', '文具店'], dir: '~/Project/active_projects/stationery_shop' },
  { keywords: ['sales-visit', 'sales visit', '業務拜訪', '拜訪'], dir: '~/Project/active_projects/sales-visit' },
  { keywords: ['central-hub', 'central hub', '中央', '控制中心'], dir: '~/Project/central-hub' },
  { keywords: ['channels', 'channel', '頻道'], dir: '~/Project/active_projects/channels' },
  { keywords: ["mac mini", "mac-mini", "macmini", "主機", "伺服器", "server"], dir: "~/openclaw" },
];

const ALLOWED_DEV_PATHS = [
  '/Users/rexmacmini/Project/active_projects',
  '/Users/rexmacmini/Project/central-hub',
  '/Users/rexmacmini/openclaw',
];

const DEV_TIMEOUT_MS = 180000; // 3 minutes
const DEV_MAX_OUTPUT = 4000;   // chars
const DEV_TOOLS = 'Bash,Edit,Read,Glob,Grep,Write';

// ─── Skill Intent Router ───────────────────────────────────────
const SKILL_ROUTES = [
  {
    name: 'web_search',
    keywords: ['搜尋', '搜索', '查詢', '查一下', '幫我找', '幫我查', '新聞', 'search', 'find', 'look up', 'google'],
    buildParams: (text) => ({ query: text, max_results: 5 })
  },
  {
    name: 'system_status',
    keywords: ['系統狀態', '系統健康', 'cpu', '記憶體', 'ram', '磁碟', '磁碟空間', '服務狀態', '健康檢查', 'system status', 'disk', 'memory', '佔用', '使用率', '容器狀態', 'docker status'],
    buildParams: () => ({ mode: 'full' })
  },
  {
    name: 'scheduler',
    keywords: ['排程', '提醒我', '定時', '鬧鐘', '提醒', '排班', 'schedule', 'remind'],
    subIntents: {
      add: ['新增', '加', '設定', '建立', 'add', 'create', 'set'],
      cancel: ['取消', '刪除', '移除', 'cancel', 'delete', 'remove'],
      list: []
    },
    buildParams: (text) => {
      for (const [action, kws] of Object.entries(SKILL_ROUTES[2].subIntents)) {
        if (kws.some(k => text.toLowerCase().includes(k))) {
          return { action, description: text };
        }
      }
      return { action: 'list' };
    }
  },
  {
    name: 'google_workspace',
    keywords: ['行程', '日曆', '會議', '約會', 'calendar', '郵件', '信件', 'email', 'gmail', '雲端硬碟', 'drive', '過濾', '退訂', '取消訂閱', 'filter', 'unsubscribe', '封鎖'],
    subIntents: {
      'calendar.list': ['行程', '日曆', '會議', '約會', 'calendar', '今天行程', '明天行程'],
      'calendar.create': ['新增行程', '加行程', '建立會議', '排會議'],
      'gmail.batch_delete': ['刪除郵件', '刪郵件', '清理郵件', '批量刪除', '刪除垃圾', 'delete email', 'delete mail', 'trash email'],
      'gmail.filter_create': ['過濾', '過濾規則', '自動刪除', '封鎖寄件者', '封鎖', 'filter', 'block sender', 'block'],
      'gmail.unsubscribe': ['取消訂閱', '退訂', 'unsubscribe'],
      'gmail.list': ['郵件', '信件', 'email', 'gmail', '收件匣', 'inbox'],
      'gmail.send': ['寄信', '發郵件', '發信', 'send email'],
      'drive.list': ['雲端硬碟', 'drive', '檔案列表'],
    },
    buildParams: (text) => {
      const lower = text.toLowerCase();
      for (const [mode, kws] of Object.entries(SKILL_ROUTES[3].subIntents)) {
        if (kws.some(k => lower.includes(k))) {
          // Gmail filter_create: extract sender from text
          if (mode === 'gmail.filter_create') {
            const senderInfo = extractSenderFromText(text);
            return { mode, from_address: senderInfo.address, filter_action: senderInfo.action };
          }
          // Gmail unsubscribe: needs to search sender first, handled by wrapper
          if (mode === 'gmail.unsubscribe') {
            return { mode: 'gmail.unsubscribe', query: text };
          }
          // Gmail: convert natural language to Gmail search syntax
          if (mode === 'gmail.list') {
            let gmailQuery = 'is:unread';
            if (lower.includes('已讀') || lower.includes('read')) gmailQuery = 'is:read';
            if (lower.includes('starred') || lower.includes('星號') || lower.includes('重要')) gmailQuery += ' is:starred';
            if (lower.includes('今天') || lower.includes('today')) gmailQuery += ' newer_than:1d';
            if (lower.includes('這週') || lower.includes('this week')) gmailQuery += ' newer_than:7d';
            return { mode, query: gmailQuery, max_results: 5 };
          }
          return { mode, query: text, max_results: 5 };
        }
      }
      return { mode: 'calendar.list', max_results: 5 };
    }
  },
  {
    name: 'file_organizer',
    keywords: ['整理檔案', '清理檔案', '整理桌面', '清理下載', 'organize files', 'cleanup'],
    buildParams: (text) => ({ mode: 'organize', description: text })
  },
  {
    name: 'finance',
    keywords: ['投資分析', 'roi', '風險評估', '投資組合', '報酬率', 'finance'],
    buildParams: (text) => ({ mode: 'roi', description: text })
  },
  {
    name: 'data_analysis',
    keywords: ['分析數據', '數據分析', '統計', '趨勢', 'analyze data', 'statistics'],
    buildParams: (text) => ({ mode: 'summary', description: text })
  },
  {
    name: 'docker_control',
    keywords: ['重啟', 'restart', '容器', 'container', 'docker ps', 'docker 狀態', 'docker logs', '看 logs', '容器列表', 'docker'],
    buildParams: (text) => {
      const lower = text.toLowerCase();
      // Detect action
      if (lower.includes('重啟') || lower.includes('restart')) {
        // Extract container name
        const containerMatch = text.match(/(?:重啟|restart)\s+(\S+)/i);
        const container = containerMatch ? containerMatch[1] : '';
        return { action: 'restart', container };
      }
      if (lower.includes('logs') || lower.includes('日誌') || lower.includes('看 log')) {
        const containerMatch = text.match(/(?:logs?|日誌)\s+(\S+)/i) || text.match(/(\S+)\s+(?:logs?|日誌)/i);
        const container = containerMatch ? containerMatch[1] : '';
        return { action: 'logs', container, lines: 50 };
      }
      if (lower.includes('stats') || lower.includes('資源')) {
        return { action: 'stats' };
      }
      return { action: 'list' };
    }
  },
  {
    name: 'work_tracker_query',
    keywords: ['工作統計', '工作記錄', '這週做了什麼', '今天記了', '今天做了', 'work tracker', '本週工作', '最近工作', '工時'],
    buildParams: (text) => {
      const lower = text.toLowerCase();
      if (lower.includes('這週') || lower.includes('本週') || lower.includes('week')) {
        if (lower.includes('工時') || lower.includes('hours') || lower.includes('時間')) {
          return { mode: 'hours' };
        }
        return { mode: 'week' };
      }
      if (lower.includes('最近') || lower.includes('recent')) {
        return { mode: 'recent', limit: 10 };
      }
      return { mode: 'today' };
    }
  },
  {
    name: 'rex_ai_dashboard',
    keywords: ['rex', 'dashboard', '儀表板', 'rex-ai', '服務狀態', '專案狀態', 'backlog', '待辦'],
    buildParams: (text) => {
      const lower = text.toLowerCase();
      if (lower.includes('backlog') || lower.includes('待辦')) return { mode: 'backlog' };
      if (lower.includes('worklog') || lower.includes('工作記錄')) return { mode: 'worklog' };
      if (lower.includes('alert') || lower.includes('警報')) return { mode: 'alerts' };
      if (lower.includes('摘要') || lower.includes('summary')) return { mode: 'summary' };
      return { mode: 'status' };
    }
  }
];


// ─── Skill Tools Definition for Claude Tool-Use (fallback routing) ─

const SKILL_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'system_status',
      description: '查詢系統狀態和資源使用情況。包括 CPU、記憶體、磁碟、容器狀態等。當用戶問「RAM 佔用多少」、「系統怎樣」、「CPU 使用率」、「容器狀態」、「磁碟空間」等問題時調用。',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            description: '查詢模式：full（完整狀態）或 quick（快速檢查）',
            enum: ['full', 'quick']
          }
        },
        required: ['mode']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '搜尋網路資訊。當用戶要求搜索、查詢最新資訊、新聞時調用。返回相關的網頁結果。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜尋關鍵詞'
          },
          max_results: {
            type: 'integer',
            description: '最多返回的結果數（1-10）',
            default: 5
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'google_workspace',
      description: '操作 Google 服務（Gmail、Google Calendar、Google Drive）。支持的操作：gmail.list（查看郵件）、gmail.read（讀取特定郵件）、gmail.send（發送郵件）、gmail.delete（刪除郵件）、gmail.batch_delete（批量刪除）、gmail.unsubscribe（取消訂閱）、gmail.filter_create（建立過濾規則）、gmail.filter_list（查看過濾規則）、calendar.list（查看行程）、calendar.create（建立行程）、drive.list（列出雲端硬碟檔案）。',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            description: '執行的操作模式',
            enum: ['gmail.list', 'gmail.read', 'gmail.send', 'gmail.delete', 'gmail.batch_delete', 'gmail.unsubscribe', 'gmail.filter_create', 'gmail.filter_list', 'calendar.list', 'calendar.create', 'drive.list']
          },
          query: {
            type: 'string',
            description: '搜尋或操作的查詢文本'
          },
          max_results: {
            type: 'integer',
            description: '最多返回的結果數'
          }
        },
        required: ['mode']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'docker_control',
      description: '控制 Docker 容器。支持的操作：list（列出容器）、restart（重啟容器）、logs（查看日誌）、stats（查看資源使用）。當用戶要求重啟容器、查看容器狀態、查看日誌時調用。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: '執行的操作',
            enum: ['list', 'restart', 'logs', 'stats']
          },
          container: {
            type: 'string',
            description: '容器名稱或 ID（如果適用）'
          }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'work_tracker_query',
      description: '查詢工作追蹤數據。支持的查詢：today（今天的工作記錄）、week（本週工作統計）、hours（本週工時統計）、recent（最近的工作記錄）。當用戶問「今天做了什麼」、「這週做了什麼」、「工時統計」等時調用。',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            description: '查詢模式',
            enum: ['today', 'week', 'hours', 'recent']
          }
        },
        required: ['mode']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'scheduler',
      description: '管理排程和提醒。支持的操作：add（新增排程）、cancel（取消排程）、list（查看排程）。當用戶要求設定提醒、排程、鬧鐘時調用。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: '排程操作',
            enum: ['add', 'cancel', 'list']
          },
          description: {
            type: 'string',
            description: '排程的描述或內容'
          }
        },
        required: ['action']
      }
    }
  }
];


// ─── CLI Tool Routes ──────────────────────────────────────────
const CLI_ROUTES = [
  {
    name: 'summarize',
    keywords: ['摘要', '總結', '幫我看這個', '幫我讀', 'summarize', 'summary', 'tldr'],
    buildCmd: (text) => {
      const urlMatch = text.match(/https?:\/\/[^\s]+/);
      if (urlMatch) {
        return ['summarize', urlMatch[0], '--extract', '--format', 'md', '--plain', '--max-extract-characters', '3000'];
      }
      return null;
    },
    noUrlMsg: '需要提供 URL 才能摘要。例如「摘要 https://example.com」'
  },
  {
    name: 'github',
    keywords: ['github', 'pr', 'issue', 'pull request', '拉取請求', '議題'],
    subIntents: {
      'pr_list': ['pr', 'pull request', '拉取請求', 'pr列表', 'pr 列表'],
      'issue_list': ['issue', '議題', 'issues'],
      'pr_view': ['pr #', 'pull request #'],
      'repo_view': ['repo', 'repository', '倉庫'],
    },
    buildCmd: (text) => {
      const lower = text.toLowerCase();
      const repoMatch = text.match(/([a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+)/);
      const repo = repoMatch ? repoMatch[1] : null;
      const numMatch = text.match(/#(\d+)/);
      const num = numMatch ? numMatch[1] : null;

      if (num && (lower.includes('pr') || lower.includes('pull'))) {
        const args = ['gh', 'pr', 'view', num, '--json', 'title,state,body,reviews,url'];
        if (repo) args.push('-R', repo);
        return args;
      }
      if (num && lower.includes('issue')) {
        const args = ['gh', 'issue', 'view', num, '--json', 'title,state,body,comments,url'];
        if (repo) args.push('-R', repo);
        return args;
      }
      if (lower.includes('issue')) {
        const args = ['gh', 'issue', 'list', '--limit', '10', '--json', 'number,title,state,updatedAt'];
        if (repo) args.push('-R', repo);
        return args;
      }
      const args = ['gh', 'pr', 'list', '--limit', '10', '--json', 'number,title,state,updatedAt'];
      if (repo) args.push('-R', repo);
      return args;
    }
  }
];

const BOT_SYSTEM_PROMPT = `你是 Rex 的 Telegram 開發助理。你熟悉他的專案且可以透過技能系統執行實際操作。

你的能力（系統自動處理，不需要假裝）:
- 搜尋網路資訊
- 查詢系統狀態（CPU/記憶體/磁碟/容器）
- 管理排程和提醒
- 操作 Google Workspace（日曆/郵件/Drive）
- 整理檔案
- 投資和數據分析
- 摘要網頁/文章（提供 URL 即可）
- GitHub PR/Issue 查詢（需指定 owner/repo）
- 執行開發任務（讀檔/寫碼/跑測試/修改程式碼）— 說「實作」「修改」「跑測試」等即可觸發

操作結果會附在對話中，直接根據結果回答用戶。

限制（誠實告知）:
- 不要提到 MEMORY.md、CLAUDE.md 等內部檔案名稱

風格: 繁體中文、簡潔（3-5句，技術討論可長些）、不用 emoji、不問「需要更多幫助嗎」`;

// ─── Ollama System Prompt (compact for faster inference) ────────

const OLLAMA_SYSTEM_PROMPT = `你是 Rex 的 Telegram 助理。用繁體中文回答，簡潔 3-5 句。
能力: 搜尋、系統狀態、日曆/郵件、開發任務、投資分析。
風格: 直接、不用 emoji、不問「需要更多幫助嗎」`;

function prepareOllamaMessages(messages, memoryContext) {
  if (!messages || !messages.length) return messages;
  let msgs = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ ...m, content: normalizeContent(m.content) }));

  let sys = OLLAMA_SYSTEM_PROMPT;
  // Include memory but keep it short (max 500 chars)
  if (memoryContext) {
    const shortMemory = memoryContext.slice(0, 500);
    sys += `\n\n用戶資訊:\n${shortMemory}`;
  }

  // Only keep last 4 messages to reduce context
  if (msgs.length > 4) {
    msgs = msgs.slice(-4);
  }

  return [{ role: 'system', content: sys }, ...msgs];
}

// ─── Memory Layer (Mem0) ─────────────────────────────────────────

function mem0Request(path, method, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const opts = {
      hostname: 'localhost',
      port: MEM0_PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
      // /memory/add needs more time for embedding + pgvector write
      timeout: (() => {
        if (path.includes('/add_batch')) return 30000;  // 批量 30s
        if (path.includes('/add')) return 15000;        // 單筆 15s
        if (path.includes('/delete')) return 5000;       // DELETE 5s
        if (path.includes('/update')) return 10000;      // UPDATE 10s
        return 5000;                                      // 其他 (search) 5s
      })(),
    };

    const req = http.request(opts, (res) => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(chunks));
        } catch (e) {
          reject(new Error(`mem0 parse: ${e.message}`));
        }
      });
    });
    req.on('error', e => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('mem0 timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

async function fetchMemories(query, userId = 'rex', limit = 5) {
  try {
    const result = await mem0Request('/memory/search', 'POST', { query, user_id: userId, limit });
    metrics.memorySearches++;
    const memories = result?.memories || [];
    if (memories.length === 0) return null;
    const formatted = memories
      .map(m => `- ${m.memory || m.text || JSON.stringify(m)}`)
      .join('\n');
    console.log(`[wrapper] mem0 search: ${memories.length} results for "${query.slice(0, 50)}"`);
    return formatted;
  } catch (e) {
    metrics.memoryErrors++;
    console.error(`[wrapper] mem0 search error: ${e.message}`);
    return null;
  }
}

function storeMemory(userText, assistantText, userId = 'rex') {
  // Fire-and-forget: send full conversation to mem0 for LLM-based extraction
  if (!userText || !assistantText) return;
  // Skip very short or trivial exchanges
  if (userText.length < 10 && assistantText.length < 20) return;
  // Skip greetings and trivial messages
  const trivial = /^(你好|嗨|hi|hello|hey|ok|好的|謝謝|thanks|bye|掰|test|測試)[\s!！.。?？]*$/i;
  if (trivial.test(userText.trim())) return;

  const messages = [
    { role: 'user', content: userText.slice(0, 2000) },
    { role: 'assistant', content: assistantText.slice(0, 2000) },
  ];
  mem0Request('/memory/add', 'POST', { user_id: userId, messages })
    .then(r => {
      metrics.memoryAdds++;
      const added = r?.result?.results?.length || 0;
      if (added > 0) {
        console.log(`[wrapper] mem0 add: extracted ${added} memories for user=${userId}`);
      }
    })
    .catch(e => {
      metrics.memoryErrors++;
      console.error(`[wrapper] mem0 add error: ${e.message}`);
    });
}

// ─── Utility Functions ─────────────────────────────────────────

function normalizeContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(c => c.type === 'text' || typeof c === 'string')
      .map(c => typeof c === 'string' ? c : c.text || '')
      .join('');
  }
  return String(content || '');
}

// ─── Gmail Filter/Unsubscribe Helpers ─────────────────────────

// Known sender domains for filter creation
const KNOWN_SENDERS = {
  '104': { address: '104.com.tw', name: '104人力銀行' },
  '人力銀行': { address: '104.com.tw', name: '104人力銀行' },
  'tailscale': { address: 'tailscale.com', name: 'Tailscale' },
  'razer': { address: 'razer.com', name: 'Razer' },
  'google alerts': { address: 'googlealerts-noreply@google.com', name: 'Google Alerts' },
  'google 快訊': { address: 'googlealerts-noreply@google.com', name: 'Google Alerts' },
  '嘖嘖': { address: 'zeczec.com', name: '嘖嘖' },
  'zeczec': { address: 'zeczec.com', name: '嘖嘖' },
  'nintendo': { address: 'nintendo', name: 'Nintendo' },
  '任天堂': { address: 'nintendo', name: 'Nintendo' },
  'facebook': { address: 'facebookmail.com', name: 'Facebook' },
  'fb': { address: 'facebookmail.com', name: 'Facebook' },
  'pubu': { address: 'pubu.com.tw', name: 'Pubu' },
  '元大': { address: 'yuanta', name: '元大' },
  'github': { address: 'github.com', name: 'GitHub' },
};

function extractSenderFromText(text) {
  const lower = text.toLowerCase();

  // Check known senders
  for (const [kw, info] of Object.entries(KNOWN_SENDERS)) {
    if (lower.includes(kw.toLowerCase())) {
      // Determine action from text
      let action = 'trash';  // default: auto-delete
      if (lower.includes('標記已讀') || lower.includes('mark read')) action = 'read';
      if (lower.includes('封存') || lower.includes('archive')) action = 'archive';
      if (lower.includes('星號') || lower.includes('star')) action = 'star';
      return { address: info.address, action, name: info.name };
    }
  }

  // Try to extract email address from text
  const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w+/);
  if (emailMatch) {
    let action = 'trash';
    if (lower.includes('標記已讀') || lower.includes('mark read')) action = 'read';
    if (lower.includes('封存') || lower.includes('archive')) action = 'archive';
    return { address: emailMatch[0], action };
  }

  // Try to extract domain-like string
  const domainMatch = text.match(/[\w.-]+\.\w{2,}/);
  if (domainMatch) {
    return { address: domainMatch[0], action: 'trash' };
  }

  // Fallback: use the text after action keywords as sender
  const afterBlock = text.match(/(?:封鎖|過濾|block|filter)\s+(.+)/i);
  if (afterBlock) {
    return { address: afterBlock[1].trim(), action: 'trash' };
  }

  return { address: text, action: 'trash' };
}

async function handleGmailFilterCreate(reqId, userText, wantsStream, res) {
  const senderInfo = extractSenderFromText(userText);
  console.log(`[wrapper] #${reqId} gmail filter_create: from=${senderInfo.address} action=${senderInfo.action}`);

  try {
    const result = await callSkill('google_workspace', {
      mode: 'gmail.filter_create',
      from_address: senderInfo.address,
      filter_action: senderInfo.action,
    });

    const content = result?.result?.content ? JSON.parse(result.result.content) : result?.content ? JSON.parse(result.content) : result;
    if (content?.status === 'created') {
      const actionDesc = { trash: '自動刪除', read: '標記已讀', archive: '封存', star: '加星號' };
      const response = `已建立過濾規則：來自 ${senderInfo.name || senderInfo.address} 的郵件將${actionDesc[senderInfo.action] || '自動刪除'}。\n\n規則 ID: ${content.filter_id}`;
      return sendDirectResponse(reqId, response, wantsStream, res);
    }

    const errorMsg = content?.error || '未知錯誤';
    return sendDirectResponse(reqId, `建立過濾規則失敗：${errorMsg}`, wantsStream, res);
  } catch (e) {
    console.error(`[wrapper] #${reqId} gmail filter_create error: ${e.message}`);
    return sendDirectResponse(reqId, `建立過濾規則失敗：${e.message}`, wantsStream, res);
  }
}

async function handleGmailUnsubscribe(reqId, userText, wantsStream, res) {
  console.log(`[wrapper] #${reqId} gmail unsubscribe: "${userText.slice(0, 80)}"`);

  try {
    // Step 1: Extract sender from text and search for their emails
    const senderInfo = extractSenderFromText(userText);
    const searchQuery = `from:${senderInfo.address}`;

    const searchResult = await callSkill('google_workspace', {
      mode: 'gmail.list',
      query: searchQuery,
      max_results: 1,
    });

    const searchContent = searchResult?.result?.content
      ? JSON.parse(searchResult.result.content)
      : searchResult?.content ? JSON.parse(searchResult.content) : null;

    if (!searchContent?.messages?.length) {
      return sendDirectResponse(reqId, `找不到來自 ${senderInfo.name || senderInfo.address} 的郵件，無法執行退訂。`, wantsStream, res);
    }

    const messageId = searchContent.messages[0].id;
    const sender = searchContent.messages[0].from || senderInfo.address;

    // Step 2: Call unsubscribe with the message ID
    const unsubResult = await callSkill('google_workspace', {
      mode: 'gmail.unsubscribe',
      message_id: messageId,
    });

    const unsubContent = unsubResult?.result?.content
      ? JSON.parse(unsubResult.result.content)
      : unsubResult?.content ? JSON.parse(unsubResult.content) : unsubResult;

    if (unsubContent?.status === 'unsubscribed') {
      const method = unsubContent.method === 'http_post' ? 'HTTP 退訂連結'
        : unsubContent.method === 'http_get' ? 'HTTP 退訂連結'
        : '退訂郵件';
      return sendDirectResponse(reqId, `已退訂 ${sender} — 透過${method}完成。\n後續郵件可能需要幾天才會停止。`, wantsStream, res);
    }

    if (unsubContent?.status === 'no_unsubscribe') {
      return sendDirectResponse(reqId, `${sender} 的郵件沒有退訂連結 (List-Unsubscribe header)。\n建議改用「封鎖 ${senderInfo.address}」建立過濾規則自動刪除。`, wantsStream, res);
    }

    const errorMsg = unsubContent?.error || '退訂失敗';
    return sendDirectResponse(reqId, `退訂 ${sender} 失敗：${errorMsg}`, wantsStream, res);
  } catch (e) {
    console.error(`[wrapper] #${reqId} gmail unsubscribe error: ${e.message}`);
    return sendDirectResponse(reqId, `退訂失敗：${e.message}`, wantsStream, res);
  }
}

// ─── Skill Intent Detection ────────────────────────────────────

function detectSkillIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  // Priority override: gmail/calendar operations beat web_search
  const gmailActionWords = ["刪除郵件", "刪郵件", "清理郵件", "批量刪除", "刪除垃圾",
    "未讀郵件", "查看郵件", "寄信", "發郵件", "收件匣",
    "過濾", "過濾規則", "封鎖寄件者", "封鎖", "取消訂閱", "退訂",
    "delete email", "trash email", "inbox", "send email",
    "filter", "block sender", "unsubscribe"];
  if (gmailActionWords.some(kw => lower.includes(kw))) {
    const gws = SKILL_ROUTES.find(r => r.name === "google_workspace");
    if (gws) return { skillName: gws.name, params: gws.buildParams(text) };
  }

  for (const route of SKILL_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return {
        skillName: route.name,
        params: route.buildParams(text)
      };
    }
  }
  return null;
}

// ─── CLI Tool Detection ───────────────────────────────────────

function detectCliIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  for (const route of CLI_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      const cmd = route.buildCmd(text);
      if (!cmd && route.noUrlMsg) {
        return { cliName: route.name, error: route.noUrlMsg };
      }
      if (cmd) {
        return { cliName: route.name, cmd };
      }
    }
  }
  return null;
}

// ─── CLI Command Executor ─────────────────────────────────────

function runCliCommand(cmd) {
  return new Promise((resolve, reject) => {
    const [bin, ...args] = cmd;
    // gh commands need a git repo as cwd when no -R flag is provided
    const needsRepo = bin === 'gh' && !args.includes('-R');
    const cwd = needsRepo
      ? '/Users/rexmacmini/Project/active_projects/taiwan-stock-mvp'
      : process.env.HOME || '/Users/rexmacmini';
    execFile(bin, args, {
      cwd,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin' }
    }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

// ─── Generic Skill API Caller ──────────────────────────────────

function callSkill(skillName, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      skill_name: skillName,
      params
    });

    const opts = {
      hostname: 'localhost',
      port: SKILL_API_PORT,
      path: `/api/v1/skills/${skillName}/execute`,
      method: method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 15000
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    });
    req.on('error', (e) => reject(new Error(`Skill API unreachable: ${e.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('Skill timeout (15s)')); });
    if (method !== 'GET') req.write(body);
    req.end();
  });
}

// ─── Format Skill Results ──────────────────────────────────────

function formatSkillResult(skillName, result) {
  try {
    const content = result?.result?.content || result?.content || '';
    if (typeof content === 'string' && content.length > 0) {
      return `[${skillName} 結果]\n${content}`;
    }
    if (result?.result?.data && Array.isArray(result.result.data)) {
      const items = result.result.data.map((r, i) => {
        const parts = [];
        if (r.title) parts.push(r.title);
        if (r.url) parts.push(r.url);
        if (r.snippet || r.description) parts.push(r.snippet || r.description);
        return `${i + 1}. ${parts.join('\n   ')}`;
      });
      return `[${skillName} 結果]\n${items.join('\n\n')}`;
    }
    if (result?.result?.status || result?.result?.metrics) {
      return `[${skillName} 結果]\n${JSON.stringify(result.result, null, 2).slice(0, 2000)}`;
    }
    const str = JSON.stringify(result, null, 2);
    return `[${skillName} 結果]\n${str.slice(0, 2000)}`;
  } catch (e) {
    return `[${skillName} 錯誤] ${e.message}`;
  }
}

// ─── Gmail Batch Delete Handler ───────────────────────────────

async function handleGmailBatchDelete(reqId, userText, wantsStream, res) {
  // Parse sender filters from natural language
  const lower = userText.toLowerCase();
  const senderFilters = [];
  
  // Common spam/promo senders detection
  const knownFilters = [
    { kw: ['104', '人力銀行', '104人力'], query: 'from:104.com.tw' },
    { kw: ['tailscale'], query: 'from:tailscale.com' },
    { kw: ['razer'], query: 'from:razer.com' },
    { kw: ['google alerts', 'google 快訊'], query: 'from:googlealerts-noreply@google.com' },
    { kw: ['嘖嘖', 'zeczec'], query: 'from:zeczec.com' },
    { kw: ['nintendo', '任天堂'], query: 'from:nintendo' },
    { kw: ['facebook', 'fb'], query: 'from:facebookmail.com' },
    { kw: ['pubu'], query: 'from:pubu.com.tw' },
    { kw: ['元大'], query: 'from:yuanta' },
    { kw: ['github'], query: 'from:github.com' },
    { kw: ['促銷', 'promotions', '行銷'], query: 'category:promotions' },
    { kw: ['垃圾', 'spam'], query: 'is:unread category:promotions' },
  ];
  
  for (const f of knownFilters) {
    if (f.kw.some(k => lower.includes(k))) {
      senderFilters.push(f.query);
    }
  }
  
  // If no specific filter detected, default to promotions
  if (senderFilters.length === 0) {
    senderFilters.push('is:unread category:promotions');
  }
  
  let totalDeleted = 0;
  const deletedSummary = [];
  
  for (const filter of senderFilters) {
    try {
      // Step 1: Search
      const searchResult = await callSkill('google_workspace', {
        mode: 'gmail.list',
        query: filter,
        max_results: 50,
      });
      
      const content = searchResult?.content ? JSON.parse(searchResult.content) : searchResult?.result?.content ? JSON.parse(searchResult.result.content) : null;
      if (!content || !content.messages || content.messages.length === 0) {
        continue;
      }
      
      // Step 2: Delete each message
      let count = 0;
      for (const msg of content.messages) {
        try {
          await callSkill('google_workspace', {
            mode: 'gmail.delete',
            message_id: msg.id,
          });
          count++;
        } catch (e) {
          console.error(`[wrapper] #${reqId} gmail delete error: ${e.message}`);
        }
      }
      
      totalDeleted += count;
      const senderName = content.messages[0]?.from?.split('<')[0]?.trim() || filter;
      deletedSummary.push(`- ${senderName}: ${count} 封已移至垃圾桶`);
      console.log(`[wrapper] #${reqId} gmail batch delete: ${filter} → ${count}/${content.messages.length} deleted`);
    } catch (e) {
      console.error(`[wrapper] #${reqId} gmail batch search error for ${filter}: ${e.message}`);
    }
  }
  
  const response = totalDeleted > 0
    ? '已批量清理 ' + totalDeleted + ' 封郵件（移至垃圾桶，30 天內可還原）：\n\n' + deletedSummary.join('\n')
    : '未找到符合條件的郵件可刪除。';
  
  return sendDirectResponse(reqId, response, wantsStream, res);
}

// ─── Dev Mode Detection (v9: Smart Intent) ───────────────────────

// v10.3: Simplified detectDevIntent — unified logic


function resolveHome(dir) {
  const home = process.env.HOME || '/Users/rexmacmini';
  return dir.replace(/^~/, home);
}

function isAllowedPath(dir) {
  const resolved = resolveHome(dir);
  return ALLOWED_DEV_PATHS.some(allowed => resolved.startsWith(allowed));
}

function projectNameFromDir(dir) {
  const parts = dir.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || 'misc';
}

function logDevWork(project, prompt, durationSec, success) {
  const desc = prompt.slice(0, 120).replace(/"/g, '\\"');
  const status = success ? '' : ' [failed]';
  const cmd = `${process.env.HOME || '/Users/rexmacmini'}/.claude/scripts/wt-log.sh "${project}" "code" "dev-mode: ${desc}${status}" ${Math.max(1, Math.round(durationSec / 60))} "auto" null null null 5000`;
  execFile('/bin/bash', ['-c', cmd], { timeout: 5000 }, (err) => {
    if (err) console.error(`[wrapper] wt-log error: ${err.message}`);
    else console.log(`[wrapper] wt-log: ${project}/code dev-mode recorded`);
  });
}

// ─── Unified Error Formatter (v10.3) ─────────────────────────────

function formatDevError(category, message, hint) {
  let out = `[${category}] ${message}`;
  if (hint) out += `\n提示: ${hint}`;
  return out;
}

// ─── mac-agentd Integration ───────────────────────────────────

const AGENTD_HOST = '127.0.0.1';
const AGENTD_PORT = 7777;
const AGENTD_TIMEOUT = 30000; // 30s per request
let AGENTD_TOKEN = null;

// Load agentd token
try {
  AGENTD_TOKEN = fs.readFileSync(path.join(process.env.HOME || '/Users/rexmacmini', '.agentd-token'), 'utf8').trim();
  console.log('[wrapper] agentd token loaded');
} catch (e) {
  console.error('[wrapper] WARNING: cannot read agentd token:', e.message);
}

// ─── AGENTD Dev Tools (v11 Tool Calling) ──────────────────────────────

const AGENTD_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'git_log',
      description: '查看 Git 提交歷史',
      parameters: {
        type: 'object',
        properties: {
          project: { type: 'string', description: '專案名稱或路徑（如 openclaw, taiwan-stock）' }
        },
        required: ['project']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_status',
      description: '查看 Git 工作區狀態',
      parameters: {
        type: 'object',
        properties: {
          project: { type: 'string', description: '專案名稱或路徑' }
        },
        required: ['project']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_diff',
      description: '查看程式碼變更（未提交的 diff）',
      parameters: {
        type: 'object',
        properties: {
          project: { type: 'string', description: '專案名稱或路徑' }
        },
        required: ['project']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_add',
      description: '暫存檔案 (git add)',
      parameters: {
        type: 'object',
        properties: {
          project: { type: 'string', description: '專案名稱或路徑' },
          files: { type: 'array', items: { type: 'string' }, description: '檔案列表（預設 .）' }
        },
        required: ['project']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_commit',
      description: '提交改動 (git commit)',
      parameters: {
        type: 'object',
        properties: {
          project: { type: 'string', description: '專案名稱或路徑' },
          message: { type: 'string', description: 'Commit 訊息' }
        },
        required: ['project', 'message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '讀取檔案內容',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '檔案的完整路徑' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '寫入檔案',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '檔案的完整路徑' },
          content: { type: 'string', description: '檔案內容' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: '列出目錄內容',
      parameters: {
        type: 'object',
        properties: {
          project: { type: 'string', description: '專案名稱或路徑' }
        },
        required: ['project']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'docker_ps',
      description: '列出所有 Docker 容器',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'docker_restart',
      description: '重啟 Docker 容器',
      parameters: {
        type: 'object',
        properties: {
          container: { type: 'string', description: '容器名稱（如 openclaw, postgres）' }
        },
        required: ['container']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'docker_logs',
      description: '查看容器日誌',
      parameters: {
        type: 'object',
        properties: {
          container: { type: 'string', description: '容器名稱' },
          tail: { type: 'integer', description: '最後 N 行（預設 50）', default: 50 }
        },
        required: ['container']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_tests',
      description: '執行專案測試',
      parameters: {
        type: 'object',
        properties: {
          project: { type: 'string', description: '專案名稱或路徑' }
        },
        required: ['project']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'system_info',
      description: '查看系統資訊',
      parameters: { type: 'object', properties: {} }
    }
  }
];


// ─── Dev Tool Loop Helper Functions ───────────────────────────────────

function shouldInjectDevTools(userText) {
  if (!userText) return false;
  const lower = userText.toLowerCase();
  
  // Has project keyword → true
  const hasProjectKw = PROJECT_ROUTES.some(r => r.keywords.some(kw => lower.includes(kw)));
  if (hasProjectKw) return true;
  
  // Has lastDevProject → true (follow-up)
  if (lastDevProject) return true;
  
  // Has docker/system keyword → true
  const devKeywords = ['docker', '容器', 'log', 'git', 'commit', 'test', '部署', '檔案', '讀取', '列出', 'restart', 'status', 'diff'];
  const hasDevKw = devKeywords.some(kw => lower.includes(kw));
  if (hasDevKw && DEV_ACTION_WORDS.some(w => lower.includes(w))) return true;
  
  return false;
}


// Deterministic intent mapping — LLM outputs intent, wrapper maps to endpoint
const INTENT_MAP = {
  'show_git_log':      { endpoint: '/git/log',       paramsFn: (target) => ({ repo: resolveProject(target) }) },
  'show_git_status':   { endpoint: '/git/status',     paramsFn: (target) => ({ repo: resolveProject(target) }) },
  'show_git_diff':     { endpoint: '/git/diff',       paramsFn: (target) => ({ repo: resolveProject(target) }) },
  'read_file':         { endpoint: '/fs/read',        paramsFn: (target, extra) => ({ path: extra.path }) },
  'write_file':        { endpoint: '/fs/write',       paramsFn: (target, extra) => ({ path: extra.path, content: extra.content }) },
  'list_files':        { endpoint: '/fs/list',        paramsFn: (target) => ({ path: resolveProject(target) }) },
  'restart_container': { endpoint: '/docker/restart',  paramsFn: (target) => ({ container: resolveContainer(target) }) },
  'show_logs':         { endpoint: '/docker/logs',     paramsFn: (target) => ({ container: resolveContainer(target), tail: 50 }) },
  'run_tests':         { endpoint: '/project/test',    paramsFn: (target) => ({ repo: resolveProject(target) }) },
  'show_containers':   { endpoint: '/docker/ps',       paramsFn: () => ({}) },
  'system_info':       { endpoint: '/system/info',     paramsFn: () => ({}), method: 'GET' },
  'git_add':           { endpoint: '/git/add',         paramsFn: (target, extra) => ({ repo: resolveProject(target), files: extra.files || ['.'] }) },
  'git_commit':        { endpoint: '_commit_flow',     paramsFn: (target, extra) => ({ repo: resolveProject(target), message: extra.message || 'chore: commit pending changes via OpenClaw' }), multi: true },
  'project_overview':  { endpoint: '_multi', paramsFn: (target) => ({ repo: resolveProject(target) }), multi: true },
  'docker_overview':   { endpoint: '_multi_docker', paramsFn: () => ({}), multi: true },
  'test_and_analyze':  { endpoint: '_multi_test',   paramsFn: (target) => ({ repo: resolveProject(target) }), multi: true },
};

// Container alias mapping
// v10.3: Extended aliases for all containers
const CONTAINER_ALIASES = {
  'openclaw': 'openclaw-agent',
  'openclaw-bot': 'openclaw-agent',
  'bot': 'openclaw-agent',
  'stock': 'taiwan-stock-backend',
  'taiwan-stock': 'taiwan-stock-backend',
  'grafana': 'taiwan-stock-grafana',
  'prometheus': 'taiwan-stock-prometheus',
  'pg': 'postgres',
  'db': 'postgres',
  'database': 'postgres',
  'pai': 'personal-ai-gateway',
  'personal-ai': 'personal-ai-gateway',
  'rex-ai': 'rex-ai',
  'dashboard': 'rex-ai',
  'redis': 'taiwan-stock-redis',
  'stock-pg': 'taiwan-stock-postgres',
  'stock-redis': 'taiwan-stock-redis',
};

function resolveContainer(name) {
  if (!name) return name;
  return CONTAINER_ALIASES[name.toLowerCase()] || name;
}

function resolveProject(target) {
  if (!target) return '/Users/rexmacmini/openclaw';
  const lower = target.toLowerCase();
  for (const route of PROJECT_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return resolveHome(route.dir);
    }
  }
  // If target looks like a path, use it directly
  if (target.startsWith('/') || target.startsWith('~')) {
    return resolveHome(target);
  }
  return '/Users/rexmacmini/openclaw';
}

function callAgentd(endpoint, params, timeout, method) {
  return new Promise((resolve, reject) => {
    if (!AGENTD_TOKEN) {
      reject(new Error('agentd token not loaded'));
      return;
    }
    const httpMethod = method || 'POST';
    const body = httpMethod !== 'GET' ? JSON.stringify(params) : '';
    const headers = {
      'Authorization': `Bearer ${AGENTD_TOKEN}`,
    };
    if (httpMethod !== 'GET') {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = http.request({
      hostname: AGENTD_HOST,
      port: AGENTD_PORT,
      path: endpoint,
      method: httpMethod,
      headers,
      timeout: timeout || AGENTD_TIMEOUT,
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(parsed.error || `agentd returned ${res.statusCode}`));
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new Error(`agentd invalid response: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', (e) => reject(new Error(`agentd unreachable: ${e.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('agentd timeout')); });
    if (httpMethod !== 'GET') req.write(body);
    req.end();
  });
}

function checkAgentdHealth() {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: AGENTD_HOST,
      port: AGENTD_PORT,
      path: '/health',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${AGENTD_TOKEN}` },
      timeout: 2000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(res.statusCode === 200));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

// Health watchdog — check agentd every 60s
let agentdHealthy = true;
let agentdFailCount = 0;

setInterval(async () => {
  const healthy = await checkAgentdHealth();
  if (!healthy) {
    agentdFailCount++;
    if (agentdFailCount >= 3) {
      agentdHealthy = false;
      console.error(`[wrapper] agentd health check FAILED (${agentdFailCount} consecutive failures)`);
    }
  } else {
    if (!agentdHealthy) console.log('[wrapper] agentd recovered');
    agentdHealthy = true;
    agentdFailCount = 0;
  }
}, 60000);

// v10.3: Parse intent from user message using Ollama — improved prompt with few-shot


function formatAgentdResult(endpoint, result) {
  if (result._multi) {
    let out = `專案概覽: ${result.repo}\n\n`;
    out += `📋 Git Status:\n${result.git_status || '(clean)'}\n\n`;
    out += `📜 最近 Commits:\n${result.git_log}\n`;
    out += `📁 根目錄檔案:\n${result.files}\n`;
    return out;
  }
  if (result.hostname && result.claude_code_version) {
    return `Mac mini (${result.hostname}) 系統資訊:\n- Claude Code: ${result.claude_code_version}\n- Node.js: ${result.node_version}\n- Platform: ${result.platform}/${result.arch}\n- Ollama 模型: ${result.ollama_models}\n- Docker 容器:\n${result.docker_containers}\n- 系統運行: ${result.system_uptime_hours} 小時\n- agentd 運行: ${result.agentd_uptime_seconds} 秒`;
  }
  if (result.error) return formatDevError('agentd', result.error);
  if (result.log) return result.log;
  if (result.status !== undefined && typeof result.status === 'string') return result.status || '(clean)';
  if (result.diff !== undefined) return result.diff || '(no changes)';
  if (result.content !== undefined) return result.content;
  if (result.containers) return result.containers;
  if (result.logs) return result.logs;
  if (result.output) return result.output;
  if (result.added) return `Added: ${result.added.join(', ')}`;
  if (result.artifact) return `Test output saved to ${result.artifact}\n${result.summary || ''}`;
  if (Array.isArray(result)) return result.map(e => `${e.type === 'dir' ? '📁' : '📄'} ${e.name}`).join('\n');
  return JSON.stringify(result, null, 2);
}

// ─── Haiku Analysis for Infrastructure ────────────────────────────

function analyzeWithHaiku(userQuestion, projectData) {
  return new Promise((resolve, reject) => {
    // v10.3: Full capability list injection
    const systemPrompt = `你是 Mac mini 基礎設施顧問，透過 Telegram bot 管理 Mac mini。

你可以直接執行的操作（用戶在 Telegram 發送指令即可觸發）:
- 查看 [專案] 的 git log/status/diff
- 提交 [專案] 的改動 (commit)
- 重啟 [容器名] 容器
- 看 [容器名] 的 logs
- 跑 [專案] 的測試
- 查看 Docker 容器列表
- 查看系統資訊

可管理的專案: openclaw, taiwan-stock, personal-ai, ai-news, stationery, sales-visit, channels
可管理的容器: openclaw-agent, postgres, redis, backend, grafana, prometheus, personal-ai-gateway, rex-ai, taiwan-stock-backend

規則:
- 繁體中文，簡短直接
- 只根據提供的資料分析，不猜測
- 給出具體可行的建議（最多 5 條）
- 不要重複貼出原始資料
- 每條可自動執行的建議，用 👉 格式（用戶複製發送即可自動執行）:
  👉 commit openclaw 的改動
  👉 重啟 openclaw 容器
  👉 跑測試 taiwan-stock
  👉 看 openclaw 的 logs
  👉 查看 taiwan-stock git diff
- 需人工判斷的標明「需手動處理」

嚴格禁止（違反即失敗）:
- 禁止問「需要我幫你嗎」「要不要我執行」「需要我做什麼」「要不要我」「哪個方式方便」
- 禁止問「需要我幫你執行上面的指令嗎」
- 禁止說「我可以幫你」「如果你需要」「等待你的指示」
- 禁止要求用戶提供路徑、URL、SSH 權限
- 禁止結尾用疑問句
- 直接列出建議和 👉 指令，不要問任何問題`;

    const body = JSON.stringify({
      model: 'claude-haiku-4-5',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `用戶問題: ${userQuestion}

蒐集到的資料:
${projectData}` },
      ],
      max_tokens: 2000,
      stream: false,
    });

    const req = http.request({
      hostname: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 30000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          let content = parsed.choices?.[0]?.message?.content;
          if (content) {
            // Post-process: strip trailing questions Haiku sometimes adds
            content = content.replace(/\n*(?:需要[我們]?幫你|要不要[我們]?|如果你需要|等待你的|哪個方式方便|需要幫你)[^\n]*[？?]?\s*$/g, '').trim();
            content = content.replace(/\n*[^\n]*[？]\s*$/g, '').trim();
            resolve(content);
          } else {
            reject(new Error('empty Haiku response'));
          }
        } catch (e) {
          reject(new Error(`Haiku parse error: ${e.message}`));
        }
      });
    });
    req.on('error', (e) => reject(new Error(`Haiku unreachable: ${e.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('Haiku timeout (30s)')); });
    req.write(body);
    req.end();
  });
}



// ─── Work Progress ──────────────────────────────────────────────

const PROGRESS_KEYWORDS = [
  '工作進度', '開發進度', '開發狀態', '工作狀態',
  '目前在做什麼', '現在在做什麼', '做到哪',
  'dev progress', 'work status', 'work progress',
];

function detectProgressIntent(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return PROGRESS_KEYWORDS.some(kw => lower.includes(kw));
}

function fetchWorkProgress() {
  const wtApi = new Promise((resolve) => {
    const opts = {
      hostname: 'localhost',
      port: 8001,
      path: '/api/recent?limit=5',
      method: 'GET',
      timeout: 5000,
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });

  const claudeProcs = new Promise((resolve) => {
    execFile('/bin/bash', ['-c', 'ps aux | grep "[c]laude" | grep -v wrapper'], {
      timeout: 3000,
    }, (err, stdout) => {
      if (err || !stdout.trim()) return resolve([]);
      const lines = stdout.trim().split('\n').map(line => {
        const parts = line.split(/\s+/);
        const pid = parts[1];
        const cmdIdx = line.indexOf('claude');
        const cmd = line.slice(cmdIdx).slice(0, 80);
        return { pid, cmd };
      });
      resolve(lines);
    });
  });

  return Promise.all([wtApi, claudeProcs]);
}

function formatProgressResponse(wtData, procs) {
  const lines = ['[工作進度]', ''];

  // Claude processes
  lines.push(`正在執行的 Claude 進程: ${procs.length} 個`);
  if (procs.length > 0) {
    for (const p of procs) {
      lines.push(`- ${p.cmd} (PID ${p.pid})`);
    }
  } else {
    lines.push('- (無正在執行的 Claude 進程)');
  }
  lines.push('');

  // Work Tracker recent records
  lines.push('最近工作記錄:');
  const records = Array.isArray(wtData) ? wtData : (wtData?.records || wtData?.data || []);
  if (records.length > 0) {
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      const project = r.project || '?';
      const desc = r.description || r.desc || '?';
      const dur = r.duration_min || r.duration || '?';
      const cat = r.category || '?';
      const ts = r.created_at || r.timestamp || '';
      const timeStr = ts ? ` — ${new Date(ts).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '';
      lines.push(`${i + 1}. [${project}] ${desc} (${dur}min, ${cat})${timeStr}`);
    }
  } else {
    lines.push('- (無最近記錄或 Work Tracker 未回應)');
  }

  return lines.join('\n');
}

// ─── Message Injection ─────────────────────────────────────────

function injectBotSystemPrompt(messages, skillContext, memoryContext) {
  if (!messages || !messages.length) return messages;
  messages = [...messages];
  messages = messages.filter(m => m.role !== 'system');
  messages = messages.map(m => ({
    ...m,
    content: normalizeContent(m.content)
  }));

  let systemContent = BOT_SYSTEM_PROMPT;

  if (memoryContext) {
    systemContent += `\n\n## 關於用戶的記憶\n以下是你記得的關於用戶的事實，自然地運用這些記憶回答問題，不要特別提及「記憶系統」:\n${memoryContext}`;
  }

  if (skillContext) {
    systemContent += `\n\n--- 以下是技能執行結果，請根據這些結果回答用戶 ---\n${skillContext}`;
  }

  messages = [
    { role: 'system', content: systemContent },
    ...messages
  ];
  return messages;
}

function prepareBody(body, skillContext, memoryContext) {
  const modified = { ...body };
  delete modified.tools;
  delete modified.tool_choice;
  modified.messages = injectBotSystemPrompt(modified.messages, skillContext, memoryContext);
  return modified;
}

// ─── Streaming Passthrough ─────────────────────────────────────

function streamPassthrough(reqId, body, res, skillContext, memoryContext, userText) {
  const modified = prepareBody(body, skillContext, memoryContext);
  modified.stream = true;

  const data = JSON.stringify(modified);
  const startTime = Date.now();
  let firstChunkTime = 0;
  let chunkCount = 0;
  let assistantText = '';  // Collect for memory storage

  const opts = {
    hostname: UPSTREAM_HOST,
    port: UPSTREAM_PORT,
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
      'Authorization': 'Bearer not-needed',
    'x-api-key': process.env.CLAUDE_CODE_OAUTH_TOKEN || ''
    },
    timeout: 300000 // 5min for Opus + tools
  };

  const upReq = http.request(opts, (upRes) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    let buffer = '';

    upRes.on('data', (chunk) => {
      if (!firstChunkTime) {
        firstChunkTime = Date.now();
        console.log(`[wrapper] #${reqId} first chunk: ${firstChunkTime - startTime}ms`);
      }

      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) {
          if (line.trim()) res.write(line + '\n');
          else res.write('\n');
          continue;
        }

        const payload = line.slice(6).trim();
        if (payload === '[DONE]') {
          res.write('data: [DONE]\n\n');
          continue;
        }

        try {
          const parsed = JSON.parse(payload);
          if (parsed.choices?.[0]?.finish_reason === 'tool_calls') {
            parsed.choices[0].finish_reason = 'stop';
          }
          if (parsed.choices?.[0]?.delta?.tool_calls) {
            delete parsed.choices[0].delta.tool_calls;
            if (!parsed.choices[0].delta.content) continue;
          }
          // Collect assistant text for memory
          const deltaContent = parsed.choices?.[0]?.delta?.content;
          if (deltaContent) assistantText += deltaContent;

          res.write(`data: ${JSON.stringify(parsed)}\n\n`);
          chunkCount++;
        } catch (e) {
          res.write(line + '\n');
        }
      }
    });

    upRes.on('end', () => {
      if (buffer.trim()) res.write(buffer + '\n');
      const totalTime = Date.now() - startTime;
      console.log(`[wrapper] #${reqId} done: ${totalTime}ms total, ${chunkCount} chunks`);
      res.end();

      // Store conversation in memory (fire-and-forget)
      if (userText && assistantText && assistantText.length > 10) {
        // storeMemory(userText, assistantText); // Mem0 removed
      }
    });
  });

  upReq.on('error', (e) => {
    console.error(`[wrapper] #${reqId} stream error: ${e.message}`);
    metrics.errors++;
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: { message: `上游服務不可達，請稍後再試。(${e.code || e.message})` }
    }));
  });

  upReq.on('timeout', () => {
    upReq.destroy();
    console.error(`[wrapper] #${reqId} stream timeout`);
    metrics.errors++;
    if (!res.headersSent) res.writeHead(504, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: { message: '上游服務回應超時 (120s)，請稍後再試。' }
    }));
  });

  upReq.write(data);
  upReq.end();
}

// ─── Non-Streaming Fallback ────────────────────────────────────

function forwardNonStreaming(reqId, body, res, skillContext, memoryContext, userText) {
  const modified = prepareBody(body, skillContext, memoryContext);
  modified.stream = false;

  const data = JSON.stringify(modified);
  const startTime = Date.now();

  const opts = {
    hostname: UPSTREAM_HOST,
    port: UPSTREAM_PORT,
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
      'Authorization': 'Bearer not-needed',
    'x-api-key': process.env.CLAUDE_CODE_OAUTH_TOKEN || ''
    },
    timeout: 300000 // 5min for Opus + tools
  };

  const upReq = http.request(opts, (upRes) => {
    let chunks = '';
    upRes.on('data', c => chunks += c);
    upRes.on('end', () => {
      const totalTime = Date.now() - startTime;
      try {
        const parsed = JSON.parse(chunks);
        const text = parsed.choices?.[0]?.message?.content || '';
        console.log(`[wrapper] #${reqId} non-stream: ${totalTime}ms "${text.slice(0, 80)}..."`);
        const response = {
          id: 'chatcmpl-' + Math.random().toString(36).substr(2, 12),
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: parsed.model || 'claude-haiku-4-5',
          choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
          usage: (() => {
            const u = parsed.usage || {};
            return {
              prompt_tokens: u.prompt_tokens ?? u.input_tokens ?? 0,
              completion_tokens: u.completion_tokens ?? u.output_tokens ?? 0,
              total_tokens: u.total_tokens ?? ((u.prompt_tokens ?? u.input_tokens ?? 0) + (u.completion_tokens ?? u.output_tokens ?? 0))
            };
          })()
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));

        // Track token usage (fire-and-forget)
        trackTokenUsage(parsed.model || body.model, "anthropic", parsed.usage, totalTime);

        // Store conversation in memory (fire-and-forget)
        if (userText && text && text.length > 10) {
          // storeMemory(userText, text); // Mem0 removed
        }
      } catch (e) {
        console.error(`[wrapper] #${reqId} parse error: ${e.message}`);
        metrics.errors++;
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `回應解析失敗: ${e.message}` } }));
      }
    });
  });

  upReq.on('error', (e) => {
    console.error(`[wrapper] #${reqId} error: ${e.message}`);
    metrics.errors++;
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: { message: `上游服務不可達，請稍後再試。(${e.code || e.message})` }
    }));
  });
  upReq.on('timeout', () => {
    upReq.destroy();
    metrics.errors++;
    res.writeHead(504, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: { message: '上游服務回應超時 (120s)，請稍後再試。' }
    }));
  });
  upReq.write(data);
  upReq.end();
}

// ─── Proxy Pass-Through ────────────────────────────────────────

function proxyPassThrough(req, res) {
  const opts = {
    hostname: UPSTREAM_HOST,
    port: UPSTREAM_PORT,
    path: req.url,
    method: req.method,
    headers: { 
      ...req.headers, 
      host: `${UPSTREAM_HOST}:${UPSTREAM_PORT}`,
      'x-api-key': process.env.CLAUDE_CODE_OAUTH_TOKEN || req.headers['x-api-key'] || ''
    }
  };
  const proxy = http.request(opts, (upRes) => {
    res.writeHead(upRes.statusCode, upRes.headers);
    upRes.pipe(res);
  });
  proxy.on('error', (e) => {
    metrics.errors++;
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `Upstream error: ${e.message}` } }));
  });
  req.pipe(proxy);
}

// ─── Main Handler ──────────────────────────────────────────────

async function executeAgentdToolCall(toolName, toolArgs) {
  switch (toolName) {
    case 'git_log':
      return callAgentd('/git/log', { repo: resolveProject(toolArgs.project) });
    
    case 'git_status':
      return callAgentd('/git/status', { repo: resolveProject(toolArgs.project) });
    
    case 'git_diff':
      return callAgentd('/git/diff', { repo: resolveProject(toolArgs.project) });
    
    case 'git_add':
      return callAgentd('/git/add', { repo: resolveProject(toolArgs.project), files: toolArgs.files || ['-u'] });
    
    case 'git_commit':
      return callAgentd('/git/commit', { repo: resolveProject(toolArgs.project), message: toolArgs.message || 'via OpenClaw' });
    
    case 'read_file':
      return callAgentd('/fs/read', { path: toolArgs.path });
    
    case 'write_file':
      return callAgentd('/fs/write', { path: toolArgs.path, content: toolArgs.content });
    
    case 'list_files':
      return callAgentd('/fs/list', { path: resolveProject(toolArgs.project) });
    
    case 'docker_ps':
      return callAgentd('/docker/ps', {});
    
    case 'docker_restart':
      return callAgentd('/docker/restart', { container: resolveContainer(toolArgs.container) });
    
    case 'docker_logs':
      return callAgentd('/docker/logs', { container: resolveContainer(toolArgs.container), tail: toolArgs.tail || 50 });
    
    case 'run_tests':
      return callAgentd('/project/test', { repo: resolveProject(toolArgs.project) }, 120000);
    
    case 'system_info':
      return callAgentd('/system/info', {}, null, 'GET');
    
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}


async function handleDevToolLoop(reqId, parsedBody, res, wantsStream, memoryContext, userText) {
  const messages = parsedBody.messages || [];
  const systemPrompt = injectBotSystemPrompt(messages.filter(m => m.role !== 'system'), null, memoryContext)[0];

  const conversationMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role,
      content: normalizeContent(m.content)
    }));

  let allMessages = [systemPrompt, ...conversationMessages];
  let iteration = 0;
  const maxIterations = 5;
  const startTime = Date.now();

  try {
    while (iteration < maxIterations) {
      iteration++;
      console.log(`[wrapper] #${reqId} dev-tool-loop iteration ${iteration}/${maxIterations}`);

      // Call Claude with agentd tools available
      const claudeResponse = await callClaudeNonStreaming(allMessages, AGENTD_TOOLS, 'auto');

      if (claudeResponse.usage) {
        trackTokenUsage(claudeResponse.model || 'claude-haiku-4-5', 'anthropic', claudeResponse.usage);
      }

      if (!claudeResponse.choices || !claudeResponse.choices[0]) {
        throw new Error('Invalid Claude response');
      }

      const choice = claudeResponse.choices[0];
      const finishReason = choice.finish_reason;
      const content = choice.message?.content || '';

      // Case 1: Claude wants to call a tool
      if (finishReason === 'tool_calls' && choice.message?.tool_calls) {
        const toolCalls = choice.message.tool_calls;
        console.log(`[wrapper] #${reqId} dev-tools: ${toolCalls.length} calls: ${toolCalls.map(t => t.function.name).join(', ')}`);

        allMessages.push({
          role: 'assistant',
          content,
          tool_calls: toolCalls
        });

        const toolResults = [];
        for (const toolCall of toolCalls) {
          const toolName = toolCall.function.name;
          const toolArgs = typeof toolCall.function.arguments === 'string'
            ? JSON.parse(toolCall.function.arguments)
            : toolCall.function.arguments;

          try {
            console.log(`[wrapper] #${reqId} dev-tool: ${toolName} args: ${JSON.stringify(toolArgs).slice(0, 80)}`);
            const result = await executeAgentdToolCall(toolName, toolArgs);
            const resultText = formatAgentdResult('dev-tool', result);

            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolCall.id,
              content: resultText
            });
          } catch (e) {
            console.error(`[wrapper] #${reqId} dev-tool error: ${toolName} - ${e.message}`);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolCall.id,
              content: `[${toolName} 錯誤] ${e.message}`
            });
          }
        }

        allMessages.push({
          role: 'user',
          content: toolResults
        });

        continue;
      }

      // Case 2: Claude finished (stop)
      if (finishReason === 'stop') {
        const finalContent = content || '操作完成。';
        const elapsed = (Date.now() - startTime) / 1000;
        console.log(`[wrapper] #${reqId} dev-tool-loop done in ${elapsed.toFixed(1)}s`);
        
        return sendDirectResponse(reqId, finalContent, wantsStream, res);
      }

      console.warn(`[wrapper] #${reqId} unexpected finish_reason: ${finishReason}`);
      const fallback = content || '完成操作。';
      return sendDirectResponse(reqId, fallback, wantsStream, res);
    }

    console.error(`[wrapper] #${reqId} dev-tool max iterations (${maxIterations}) exceeded`);
    return sendDirectResponse(reqId, '超過最大迭代次數，請簡化請求。', wantsStream, res);

  } catch (e) {
    console.error(`[wrapper] #${reqId} dev-tool-loop error: ${e.message}`);
    metrics.errors++;
    return sendDirectResponse(reqId, `[開發模式錯誤] ${e.message}`, wantsStream, res);
  }
}


async function handleChatCompletion(reqId, parsed, wantsStream, req, res) {
  // Ollama health check: restart if unresponsive
  const checkOllamaHealth = async () => {
    try {
      const response = await new Promise((resolve, reject) => {
        const opts = {
          hostname: 'localhost',
          port: 11434,
          path: '/api/tags',
          method: 'GET',
          timeout: 3000,
        };
        const req = http.request(opts, (res) => {
          if (res.statusCode === 200) resolve(true);
          else resolve(false);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.end();
      });
      
      if (!response) {
        console.log();
        const { execSync } = require('child_process');
        try {
          execSync('launchctl stop com.ollama.optimized && sleep 2 && launchctl start com.ollama.optimized', { timeout: 10000 });
          console.log();
        } catch (e) {
          console.error();
        }
      }
    } catch (e) {
      // Silently fail health check
    }
  };
  
  // Check health every 100 requests (low overhead)
  if (metrics.requests % 100 === 0) {
    checkOllamaHealth();
  }

  const msgs = parsed.messages || [];
  const lastUserMsg = [...msgs].reverse().find(m => m.role === 'user');
  let userText = lastUserMsg ? normalizeContent(lastUserMsg.content) : '';

  // Strip OpenClaw metadata prefix early — all downstream routing uses clean text
  const stripMetadata = (text) => {
    const metaEnd = text.indexOf('```\n\n');
    if (metaEnd !== -1 && text.toLowerCase().startsWith('conversation info')) {
      return text.slice(metaEnd + 5).trim();
    }
    return text.trim();
  };
  userText = stripMetadata(userText);

  // Detect force model directive (@claude, @ollama, @glm)
  const forceModel = ollamaRouter.detectForceModel(userText);
  if (forceModel) {
    userText = ollamaRouter.stripForceDirective(userText);
    console.log(`[wrapper] #${reqId} force model: ${forceModel}`);
    if (forceModel === 'opus') {
      parsed.model = 'claude-opus-4';
      console.log(`[wrapper] #${reqId} model override: claude-opus-4`);
    }
  }

  let skillContext = null;
  let memoryContext = null;

  // Fetch relevant memories (non-blocking, with timeout protection)
  if (userText) {
    // memoryContext = await fetchMemories(userText); // Mem0 removed
  }

  
  // Priority 1.5: Financial Agent routing (between dev mode and CLI tools)
  
  // Priority 1.4: Taiwan Stock Real-time Analysis
  const stockSymbol = detectStockSymbol(userText);
  if (stockSymbol) {
    console.log(`[wrapper] #${reqId} TAIWAN_STOCK: ${stockSymbol}`);
    metrics.skillCalls++;
    try {
      const indicators = await fetchTaiwanStockIndicators(stockSymbol);
      if (!indicators || !indicators.latest_close) {
        throw new Error(`${stockSymbol} 暫無數據`);
      }
      let analysis = `【${indicators.stock_name}（${indicators.stock_id}）技術分析】\n`;
      analysis += `📊 最新收盤: ${indicators.latest_close.toFixed(2)} 元\n`;
      analysis += `📈 指標: MA5=${(indicators.ma_5||0).toFixed(2)}, MA20=${(indicators.ma_20||0).toFixed(2)}, RSI=${(indicators.rsi_14||0).toFixed(2)}, MACD=${(indicators.macd||0).toFixed(2)}\n`;
      analysis += `📊 趨勢: ${indicators.trend_signal || 'N/A'}\n`;
      if (indicators.rsi_14 && indicators.rsi_14 > 70) analysis += `⚠️ RSI>70 超買\n`;
      else if (indicators.rsi_14 && indicators.rsi_14 < 30) analysis += `🔥 RSI<30 超賣\n`;
      analysis += `\n⚠️ 免責聲明: 本分析僅供參考，非投資建議。`;
      skillContext = `[台股分析]\n${analysis}`;
      return sendDirectResponse(reqId, skillContext, wantsStream, res);
    } catch (e) {
      console.error(`[wrapper] #${reqId} taiwan_stock error: ${e.message}`);
      metrics.errors++;
      console.log(`[wrapper] #${reqId} taiwan_stock fallback: ${e.message}`);
      skillContext = `[台股資訊] 用戶查詢股票 ${stockSymbol}，但即時數據暫時不可用。請根據你的知識提供分析，並提醒用戶數據可能不是最新的。`;
      // fall through to normal chat with context
    }
  }

  const financialIntent = detectFinancialIntent(userText);
  if (financialIntent) {
    console.log(`[wrapper] #${reqId} FINANCIAL: keywords=${financialIntent.keywords.join(',')}`);
    metrics.skillCalls++; // 統計為 skill call
    try {
      const financialPrompt = `作為台股投資顧問，分析以下查詢:\n${userText}\n\n免責聲明: 本意見僅供參考，非投資建議。`;
      // 調用 claude -p 執行 financial agent context
      // 不再 spawn claude -p，直接用 skillContext 提示 LLM
      skillContext = `[金融分析模式] 用戶查詢: ${userText}\n請以台股投資顧問角色分析。免責聲明: 本意見僅供參考，非投資建議。`;
      // fall through to normal chat with skillContext
    } catch (e) {
      console.error(`[wrapper] #${reqId} financial error: ${e.message}`);
      metrics.errors++;
      skillContext = `[台股顧問] ${e.message}`;
    }
  }


  // Priority 0.9: Follow-up execution
  // When user sends a short confirmation, extract 👉 commands from conversation
  // history and execute them directly — no Ollama, fully deterministic
  const actualUserText = userText; // already stripped above
  const CONFIRM_WORDS = ['執行', '做吧', '好', '繼續', '開始吧', '處理', 'do it', 'go', 'execute', 'proceed', 'yes', 'ok'];
  const lowerActual = actualUserText.toLowerCase();
  // Only treat as confirm if it's a short, standalone confirmation — not a sentence with project names
  const hasProjectKeyword = PROJECT_ROUTES.some(r => r.keywords.some(kw => lowerActual.includes(kw)));
  const isConfirm = !hasProjectKeyword && actualUserText.length <= 10 && CONFIRM_WORDS.some(w => lowerActual.includes(w));
  const wantsAll = lowerActual.includes('全部') || lowerActual.includes('all') || lowerActual.includes('都');

  if (isConfirm) console.log(`[wrapper] #${reqId} confirm-check: actual="${actualUserText}" isConfirm=true wantsAll=${wantsAll}`);
  if (isConfirm && msgs.length >= 2) {
    // Extract all 👉 commands from conversation history
    const suggestions = [];
    for (const m of [...msgs].reverse()) {
      if (m.role !== 'assistant') continue;
      const text = normalizeContent(m.content);
      // Match 👉 only at start of line (actual suggestions, not inline text)
      const matches = text.match(/^👉\s*(.+)/gm);
      if (matches) {
        for (const match of matches) {
          const cmd = match.replace(/^👉\s*/, '').trim();
          if (cmd.length >= 3) suggestions.push(cmd); // skip empty/tiny matches
        }
        break; // use the most recent assistant message with 👉
      }
    }
    if (suggestions.length > 0) console.log(`[wrapper] #${reqId} follow-up: found ${suggestions.length} suggestions`);

    if (suggestions.length > 0) {
      if (wantsAll) {
        // Execute all suggestions sequentially
        console.log(`[wrapper] #${reqId} EXEC ALL: ${suggestions.length} commands`);
        const results = [];
        for (const cmd of suggestions) {
          console.log(`[wrapper] #${reqId} EXEC: "${cmd}"`);
          const cmdDevIntent = detectDevIntent(cmd);
          if (cmdDevIntent && isAllowedPath(cmdDevIntent.projectDir)) {
            saveLastProject(cmdDevIntent.projectDir);
            metrics.devMode++;
            try {
              const output = await executeDevCommand(cmd, cmdDevIntent.projectDir, null);
              results.push(`✓ ${cmd}\n${output}`);
            } catch (e) {
              results.push(`✗ ${cmd}\n${e.message}`);
            }
          } else {
            results.push(`⊘ ${cmd} (無法路由)`);
          }
        }
        return sendDirectResponse(reqId, results.join('\n\n───\n\n'), wantsStream, res);
      } else {
        // Execute first suggestion only
        console.log(`[wrapper] #${reqId} EXEC FIRST: "${suggestions[0]}"`);
        userText = suggestions[0];
        // Fall through to normal routing with replaced userText
      }
    }
  }

  // Build conversation context for Ollama (fallback when short messages reach parseDevIntent)
  let conversationContext = null;
  if (userText.length <= 10 && msgs.length >= 2) {
    const recentMsgs = msgs.slice(-6);
    const contextParts = [];
    for (const m of recentMsgs) {
      if (m === lastUserMsg) continue;
      const text = normalizeContent(m.content);
      if (text) contextParts.push(`[${m.role}]: ${text.slice(0, 500)}`);
    }
    if (contextParts.length > 0) {
      conversationContext = contextParts.join('\n');
    }
  }

  // Priority 1: Dev mode (v11 - Tool Calling Loop)
  if (shouldInjectDevTools(userText)) {
    if (!checkRateLimit('dev')) {
      console.log(`[wrapper] #${reqId} DEV RATE LIMITED`);
      skillContext = formatDevError('timeout', '請求過於頻繁', '等待幾分鐘後再試 (上限: 10次/5分鐘)');
    } else {
      console.log(`[wrapper] #${reqId} DEV TOOL LOOP: triggering`);
      saveLastProject(userText);
      metrics.devMode++;
      return handleDevToolLoop(reqId, parsed, res, wantsStream, memoryContext, userText);
    }
  }

  // Priority 2: CLI tool routes// Priority 2: CLI tool routes (summarize, gh)
  if (!skillContext) {
    const cliIntent = detectCliIntent(userText);
    if (cliIntent) {
      if (cliIntent.error) {
        skillContext = `[${cliIntent.cliName}] ${cliIntent.error}`;
        console.log(`[wrapper] #${reqId} cli: ${cliIntent.cliName} → no URL`);
      } else {
        console.log(`[wrapper] #${reqId} cli: ${cliIntent.cliName} cmd: ${cliIntent.cmd.join(' ').slice(0, 100)}`);
        metrics.cliCalls++;
        try {
          const output = await runCliCommand(cliIntent.cmd);
          skillContext = `[${cliIntent.cliName} 結果]\n${output.slice(0, 3000)}`;
          console.log(`[wrapper] #${reqId} cli result: ${skillContext.length} chars`);
        } catch (e) {
          console.error(`[wrapper] #${reqId} cli error: ${e.message}`);
          metrics.errors++;
          skillContext = `[${cliIntent.cliName} 錯誤] ${e.message}`;
        }
      }
    }
  }

  // Priority 2.5: Work Progress query
  if (!skillContext && detectProgressIntent(userText)) {
    console.log(`[wrapper] #${reqId} PROGRESS QUERY`);
    metrics.progressQueries++;
    try {
      const [wtData, procs] = await fetchWorkProgress();
      const progressText = formatProgressResponse(wtData, procs);
      return sendDirectResponse(reqId, progressText, wantsStream, res);
    } catch (e) {
      console.error(`[wrapper] #${reqId} progress error: ${e.message}`);
      skillContext = `[工作進度查詢失敗] ${e.message}`;
    }
  }

  // Priority 3: Skill API routes (web_search, system_status, etc.)
  if (!skillContext) {
    const intent = detectSkillIntent(userText);
    if (intent) {
      if (!checkRateLimit('skill')) {
        console.log(`[wrapper] #${reqId} SKILL RATE LIMITED: ${intent.skillName}`);
        skillContext = `[${intent.skillName}] 請求過於頻繁，請稍後再試 (上限: 30次/分鐘)`;
      } else {
        console.log(`[wrapper] #${reqId} skill: ${intent.skillName} params: ${JSON.stringify(intent.params).slice(0, 100)}`);
        metrics.skillCalls++;
        try {
          // Gmail special handlers: batch_delete, filter_create, unsubscribe
          if (intent.params.mode === 'gmail.batch_delete') {
            return await handleGmailBatchDelete(reqId, userText, wantsStream, res);
          }
          if (intent.params.mode === 'gmail.filter_create') {
            return await handleGmailFilterCreate(reqId, userText, wantsStream, res);
          }
          if (intent.params.mode === 'gmail.unsubscribe') {
            return await handleGmailUnsubscribe(reqId, userText, wantsStream, res);
          }
          const result = await callSkill(intent.skillName, intent.params);
          skillContext = formatSkillResult(intent.skillName, result);
          console.log(`[wrapper] #${reqId} skill result: ${skillContext.length} chars`);
        } catch (e) {
          console.error(`[wrapper] #${reqId} skill error: ${e.message}`);
          metrics.errors++;
          skillContext = `[${intent.skillName} 系統暫時無法連線] 已嘗試呼叫 ${intent.skillName} 技能但暫時失敗（${e.message}）。請告知用戶系統正在維護中，稍後可再試。不要說「無法查詢」，而是說「暫時無法取得資料」。`;
        }
      }
    }
  }

  // Priority 4: Ollama-first routing for normal conversation
  if (!skillContext && (forceModel === 'ollama' || forceModel === 'glm')) {  // Only @ollama or @glm → try Ollama
    metrics.normalChat++;
    const ollamaModelName = (forceModel === 'glm') ? 'glm-4.7-flash' : 'qwen2.5-coder:7b';
    console.log(`[wrapper] #${reqId} trying Ollama ${ollamaModelName}...`);

    // Prepare messages with system prompt + memory for Ollama
    const ollamaMessages = prepareOllamaMessages(msgs, memoryContext);
    const ollamaOpts = (forceModel === 'glm') ? ollamaRouter.getModelForForce('glm') : {};
    const ollamaResult = await ollamaRouter.tryOllamaChat(ollamaMessages, ollamaOpts);

    if (ollamaResult.success) {
      const quality = ollamaRouter.assessQuality(ollamaResult.content, userText);

      if (quality >= 0.7 || forceModel === 'ollama' || forceModel === 'glm') {
        metrics.ollamaRouted++;
        const latencySec = (ollamaResult.latency / 1000).toFixed(1);
        const modelName = ollamaResult.model || 'qwen2.5-coder:7b';
        const footer = `\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nOllama ${modelName} (${latencySec}s)`;
        console.log(`[wrapper] #${reqId} ollama OK: quality=${quality.toFixed(2)} latency=${ollamaResult.latency}ms`);

        if (userText && ollamaResult.content.length > 10) {
          // storeMemory(userText, ollamaResult.content); // Mem0 removed
        }
        // Track Ollama token usage
        trackTokenUsage(modelName, "ollama", {
          input_tokens: ollamaResult.promptTokens || 0,
          output_tokens: ollamaResult.evalTokens || 0,
        }, ollamaResult.latency);

        return sendDirectResponse(reqId, ollamaResult.content + footer, wantsStream, res);
      }

      // Quality too low — fallback
      ollamaRouter.ollamaStats.qualityReject++;
      ollamaRouter.ollamaStats.fallback++;
      metrics.ollamaFallback++;
      console.log(`[wrapper] #${reqId} ollama quality reject: ${quality.toFixed(2)}, fallback to Claude`);
    } else {
      ollamaRouter.ollamaStats.fallback++;
      metrics.ollamaFallback++;
      console.log(`[wrapper] #${reqId} ollama ${ollamaResult.reason}: fallback to Claude`);
    }
  } else if (!skillContext) {
    metrics.normalChat++;
  }

  // Claude (fallback, forced, or has skill context)
  if (!skillContext && forceModel !== 'opus') {
    // No skill matched — let Claude decide using tool-use
    return await handleWithSkillTools(reqId, parsed, res, wantsStream, memoryContext, skillContext, userText);
  } else {
    // Skill matched or has context — use traditional passthrough
    if (wantsStream) {
      streamPassthrough(reqId, parsed, res, skillContext, memoryContext, userText);
    } else {
      forwardNonStreaming(reqId, parsed, res, skillContext, memoryContext, userText);
    }
  }
}


// ─── Call Claude API (non-streaming) ───────────────────────────


// ─── Call Claude API (non-streaming) ───────────────────────────

function callClaudeNonStreaming(messages, tools, toolChoice) {
  return new Promise((resolve, reject) => {
    const body = {
      model: 'claude-haiku-4-5-20251001',
      messages,
      max_tokens: 2048,
      ...(tools ? { tools, tool_choice: toolChoice || 'auto' } : {})
    };

    const data = JSON.stringify(body);
    const opts = {
      hostname: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Authorization': 'Bearer not-needed',
        'x-api-key': process.env.CLAUDE_CODE_OAUTH_TOKEN || ''
      },
      timeout: 300000 // 5min for Opus + tools
    };

    const req = http.request(opts, (res) => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        try {
          const response = JSON.parse(chunks);
          resolve(response);
        } catch (e) {
          reject(new Error(`Claude response parse error: ${e.message}`));
        }
      });
    });

    req.on('error', e => reject(e));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Claude API timeout'));
    });

    req.write(data);
    req.end();
  });
}

// ─── Handle Tool-Use Fallback (Claude decides which skill to call) ─

async function handleWithSkillTools(reqId, parsedBody, res, wantsStream, memoryContext, skillContext, userText) {
  const messages = parsedBody.messages || [];
  const systemPrompt = injectBotSystemPrompt(messages.filter(m => m.role !== 'system'), skillContext, memoryContext)[0];

  const conversationMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role,
      content: normalizeContent(m.content)
    }));

  let allMessages = [systemPrompt, ...conversationMessages];
  let iteration = 0;
  const maxIterations = 3;

  try {
    while (iteration < maxIterations) {
      iteration++;
      console.log(`[wrapper] #${reqId} skill-tools iteration ${iteration}/${maxIterations}`);

      // Call Claude with skill tools available
      const claudeResponse = await callClaudeNonStreaming(allMessages, SKILL_TOOLS, 'auto');

      // Track Claude tool-use token usage
      if (claudeResponse.usage) {
        trackTokenUsage(claudeResponse.model || "claude-haiku-4-5", "anthropic", claudeResponse.usage);
      }

      if (!claudeResponse.choices || !claudeResponse.choices[0]) {
        throw new Error('Invalid Claude response structure');
      }

      const choice = claudeResponse.choices[0];
      const finishReason = choice.finish_reason;
      const content = choice.message?.content || '';

      // Case 1: Claude wants to call a tool
      if (finishReason === 'tool_calls' && choice.message?.tool_calls) {
        const toolCalls = choice.message.tool_calls;
        console.log(`[wrapper] #${reqId} skill-tools: ${toolCalls.length} tool_calls: ${toolCalls.map(t => t.function.name).join(', ')}`);

        // Add Claude's response to conversation
        allMessages.push({
          role: 'assistant',
          content,
          tool_calls: toolCalls
        });

        // Process each tool call and collect results
        const toolResults = [];
        for (const toolCall of toolCalls) {
          const toolName = toolCall.function.name;
          const toolArgs = typeof toolCall.function.arguments === 'string' 
            ? JSON.parse(toolCall.function.arguments) 
            : toolCall.function.arguments;

          try {
            console.log(`[wrapper] #${reqId} calling skill: ${toolName} with args: ${JSON.stringify(toolArgs).slice(0, 100)}`);
            const result = await callSkill(toolName, toolArgs);
            const resultContent = formatSkillResult(toolName, result);
            
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolCall.id,
              content: resultContent
            });
          } catch (e) {
            console.error(`[wrapper] #${reqId} skill error: ${toolName} - ${e.message}`);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolCall.id,
              content: `[${toolName} 錯誤] ${e.message}`
            });
          }
        }

        // Add tool results to conversation
        allMessages.push({
          role: 'user',
          content: toolResults
        });

        // Continue loop to let Claude generate final response
        continue;
      }

      // Case 2: Claude generated final response (stop)
      if (finishReason === 'stop') {
        const finalContent = content || '無法生成回應，請稍後再試。';
        console.log(`[wrapper] #${reqId} skill-tools final: ${finalContent.slice(0, 80)}`);

        // Store in memory
        if (userText && finalContent && finalContent.length > 10) {
          // storeMemory(userText, finalContent); // Mem0 removed
        }

        // Send response
        return sendDirectResponse(reqId, finalContent, wantsStream, res);
      }

      // Case 3: Unexpected finish reason
      console.warn(`[wrapper] #${reqId} unexpected finish_reason: ${finishReason}`);
      const fallbackContent = content || '系統暫時無法處理，請稍後再試。';
      return sendDirectResponse(reqId, fallbackContent, wantsStream, res);
    }

    // Max iterations exceeded
    console.error(`[wrapper] #${reqId} skill-tools max iterations (${maxIterations}) exceeded`);
    return sendDirectResponse(reqId, '系統達到最大處理次數，請簡化您的請求。', wantsStream, res);

  } catch (e) {
    console.error(`[wrapper] #${reqId} skill-tools error: ${e.message}`);
    metrics.errors++;
    
    // Fallback: call Claude without tools
    console.log(`[wrapper] #${reqId} skill-tools fallback to normal Claude`);
    const fallbackBody = prepareBody(parsedBody, skillContext, memoryContext);
    if (wantsStream) {
      streamPassthrough(reqId, fallbackBody, res, skillContext, memoryContext, userText);
    } else {
      forwardNonStreaming(reqId, fallbackBody, res, skillContext, memoryContext, userText);
    }
  }
}

// ─── Direct Response (for dev mode) ──────────────────────────────

function sendDirectResponse(reqId, content, wantsStream, res) {
  const responseId = 'chatcmpl-dev-' + Math.random().toString(36).substr(2, 12);
  const created = Math.floor(Date.now() / 1000);

  if (wantsStream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const chunk = {
      id: responseId,
      object: 'chat.completion.chunk',
      created,
      model: 'claude-code-dev',
      choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }],
    };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);

    const done = {
      id: responseId,
      object: 'chat.completion.chunk',
      created,
      model: 'claude-code-dev',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    };
    res.write(`data: ${JSON.stringify(done)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } else {
    const response = {
      id: responseId,
      object: 'chat.completion',
      created,
      model: 'claude-code-dev',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  }

  console.log(`[wrapper] #${reqId} dev-mode response sent (${content.length} chars, stream=${wantsStream})`);
}

// ─── Health & Metrics Endpoints ────────────────────────────────

function handleHealth(res) {
  const uptime = Math.floor((Date.now() - startedAt) / 1000);
  const health = {
    status: 'ok',
    version: VERSION,
    uptime_seconds: uptime,
    uptime_human: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${uptime % 60}s`,
    requests_total: metrics.requests,
    model: 'claude-haiku-4-5',
    upstream: `localhost:${UPSTREAM_PORT}`,
    skill_api: `localhost:${SKILL_API_PORT}`,
    mem0_api: `localhost:${MEM0_PORT}`,
    projects: PROJECT_ROUTES.length,
    action_words: DEV_ACTION_WORDS.length,
  };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(health, null, 2));
}

function handleMetrics(res) {
  const uptime = Math.floor((Date.now() - startedAt) / 1000);
  const data = {
    uptime_seconds: uptime,
    ...metrics,
    rate_limits: {
      dev: { current: rateLimits.dev.hits.length, max: rateLimits.dev.max, window: '5min' },
      skill: { current: rateLimits.skill.hits.length, max: rateLimits.skill.max, window: '1min' },
    },
    distribution: metrics.requests > 0 ? {
      dev_pct: ((metrics.devMode / metrics.requests) * 100).toFixed(1) + '%',
      skill_pct: ((metrics.skillCalls / metrics.requests) * 100).toFixed(1) + '%',
      cli_pct: ((metrics.cliCalls / metrics.requests) * 100).toFixed(1) + '%',
      progress_pct: ((metrics.progressQueries / metrics.requests) * 100).toFixed(1) + '%',
      normal_pct: ((metrics.normalChat / metrics.requests) * 100).toFixed(1) + '%',
      error_pct: ((metrics.errors / metrics.requests) * 100).toFixed(1) + '%',
    } : null,
    ollama: ollamaRouter.getStats(),
    memory: {
      searches: metrics.memorySearches,
      adds: metrics.memoryAdds,
      errors: metrics.memoryErrors,
    },
  };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}


// System metrics proxy endpoint
function handleSystemMetrics(res) {
  const opts = {
    hostname: 'localhost',
    port: 9090,
    path: '/metrics',
    method: 'GET',
    timeout: 5000
  };
  const proxyReq = http.request(opts, (proxyRes) => {
    let data = '';
    proxyRes.on('data', chunk => data += chunk);
    proxyRes.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    });
  });
  proxyReq.on('error', (e) => {
    console.error('[wrapper] system metrics proxy error:', e.message);
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'System metrics unavailable: ' + e.message }));
  });
  proxyReq.end();
}

// ─── Model Usage Endpoint ─────────────────────────────────────

function handleModelUsage(res) {
  const os = ollamaRouter.getStats();
  const data = {
    ollama: {
      model: ollamaRouter.OLLAMA_MODEL,
      calls: os.total,
      success: os.success,
      timeout: os.timeout,
      error: os.error,
      fallback: os.fallback,
      qualityReject: os.qualityReject,
      avgLatency: os.avgLatency,
      successRate: os.successRate,
    },
    claude: {
      calls: metrics.normalChat - metrics.ollamaRouted,
      fromFallback: metrics.ollamaFallback,
    },
    routing: {
      totalNormalChat: metrics.normalChat,
      ollamaRouted: metrics.ollamaRouted,
      ollamaFallback: metrics.ollamaFallback,
      ollamaPct: metrics.normalChat > 0
        ? ((metrics.ollamaRouted / metrics.normalChat) * 100).toFixed(1) + '%'
        : 'N/A',
    },
  };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

// ─── Server ────────────────────────────────────────────────────


// --- Embeddings proxy to Ollama ---
function proxyEmbeddingsToOllama(req, res) {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    let parsed;
    try { parsed = JSON.parse(body); } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'Invalid JSON' } }));
    }
    parsed.model = 'nomic-embed-text';
    const data = JSON.stringify(parsed);
    const opts = {
      hostname: 'localhost', port: 11434,
      path: '/v1/embeddings', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 30000
    };
    const proxyReq = http.request(opts, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (e) => {
      console.error('[wrapper] embeddings proxy error:', e.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Ollama embeddings unavailable: ' + e.message } }));
    });
    proxyReq.write(data);
    proxyReq.end();
  });
}

const server = http.createServer((req, res) => {
  // Health endpoint
  if (req.url === '/health' && req.method === 'GET') {
    return handleHealth(res);



  }

  // Metrics endpoint
  if (req.url === '/metrics' && req.method === 'GET') {
    return handleMetrics(res);
  }

  // System metrics proxy
  if (req.url === "/metrics/system" && req.method === "GET") {
    return handleSystemMetrics(res);
  }

  // Model usage stats
  if ((req.url === '/metrics/model-usage' || req.url === '/metrics/model') && req.method === 'GET') {
    return handleModelUsage(res);
  }

  // Embeddings endpoint - proxy to Ollama nomic-embed-text
  if (req.url === '/v1/embeddings' && req.method === 'POST') {
    return proxyEmbeddingsToOllama(req, res);
  }

  
  // System metrics API proxy
  if (req.url === '/api/metrics/system' && req.method === 'GET') {
    const opts = {
      hostname: '127.0.0.1',
      port: 9090,
      path: '/metrics',
      method: 'GET',
      timeout: 5000
    };
    const proxyReq = http.request(opts, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (e) => {
      console.error('[wrapper] metrics proxy error:', e.message);
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'System metrics unavailable' }));
    });
    return proxyReq.end();
  }

  if (!req.url.startsWith('/v1/chat/completions')) {
    return proxyPassThrough(req, res);
  }

  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    metrics.requests++;
    const reqId = metrics.requests;

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'Invalid JSON' } }));
    }

    const hasTools = parsed.tools && parsed.tools.length > 0;
    const wantsStream = parsed.stream === true;
    const msgCount = parsed.messages?.length || 0;
    const lastRole = parsed.messages?.[msgCount - 1]?.role || '?';

    console.log(`[wrapper] #${reqId} msgs=${msgCount} lastRole=${lastRole} tools=${hasTools} stream=${wantsStream}`);

    handleChatCompletion(reqId, parsed, wantsStream, req, res);
  });
});

server.listen(LISTEN_PORT, '127.0.0.1', () => {
  console.log(`[wrapper] Tool wrapper proxy v${VERSION} listening on :${LISTEN_PORT}`);
  console.log(`[wrapper] Upstream: localhost:${UPSTREAM_PORT}`);
  console.log(`[wrapper] Skill API: localhost:${SKILL_API_PORT}`);
  console.log(`[wrapper] Mem0 API: localhost:${MEM0_PORT}`);
  console.log(`[wrapper] Skills: ${SKILL_ROUTES.map(r => r.name).join(', ')}`);
  console.log(`[wrapper] CLI tools: ${CLI_ROUTES.map(r => r.name).join(', ')}`);
  console.log(`[wrapper] Dev mode v10.3: ${DEV_ACTION_WORDS.length} action words, ${PROJECT_ROUTES.length} projects`);
  console.log(`[wrapper] Dev tools: ${DEV_TOOLS}`);
  console.log(`[wrapper] Dev timeout: ${DEV_TIMEOUT_MS / 1000}s, max output: ${DEV_MAX_OUTPUT} chars`);
  console.log(`[wrapper] Rate limits: dev=${rateLimits.dev.max}/5min, skill=${rateLimits.skill.max}/min`);
  console.log(`[wrapper] Ollama: ${ollamaRouter.OLLAMA_MODEL} at localhost:11434 (timeout: ${ollamaRouter.OLLAMA_TIMEOUT / 1000}s)`);
  console.log(`[wrapper] Mode: streaming + smart-intent + CLI + dev-mode + mem0 + ollama-first routing`);
  console.log(`[wrapper] Endpoints: /health, /metrics, /metrics/model-usage`);
});
