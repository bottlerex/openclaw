#!/usr/bin/env node
// OpenClaw Tool Wrapper Proxy v10.1
// v10.1: GLM-4.7-Flash Ollama-first routing with Claude fallback
// v10: Mem0 memory layer — persistent cross-session memory via mem0-service (:8002)
// v9: Smart intent (strong/weak signals), /health, /metrics, rate limiting, error handling
// v8: Dev mode — spawn `claude -p` for development tasks (read/write/test)
// v7: CLI tools integration (summarize, gh)
// v6: Multi-skill routing (web_search, system_status, scheduler, google_workspace, etc.)

const http = require('http');
const { execFile, spawn } = require('child_process');
const path = require('path');
const ollamaRouter = require('./ollama-router');

const UPSTREAM_HOST = 'localhost';
const UPSTREAM_PORT = 3456;
const LISTEN_PORT = 3457;
const SKILL_API_PORT = 8000;
const MEM0_PORT = 8002;
const VERSION = '10.1.0';
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

// Strong signals: trigger dev mode regardless of project keyword
const STRONG_DEV_KEYWORDS = [
  // Explicit dev commands (Chinese)
  '實作', '開發', '重構', '修復', '寫一個', '寫個',
  '加一個', '加個', '新增功能', '改一下', '改這個',
  '跑測試', '執行測試', '測試一下',
  '部署', '建構', '編譯',
  '修 bug', '找 bug', '程式碼審查',
  // Explicit dev commands (English)
  'implement', 'develop', 'refactor', 'fix bug', 'find bug',
  'run test', 'run tests', 'write code', 'create function',
  'add feature', 'debug', 'review code',
];

// Weak signals: only trigger dev mode when combined with a project keyword
const WEAK_DEV_KEYWORDS = [
  // Chinese
  '修改', '讀取', '看一下', '查看', '讀檔案',
  '檢查', '優化', '效能優化', '清理',
  '分析', '看看', '幫我看',
  // English
  'modify', 'read file', 'check code', 'optimize', 'analyze',
];


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
  { keywords: ['taiwan-stock', 'taiwan stock', '台股系統', '股票系統'], dir: '~/Project/active_projects/taiwan-stock-mvp' },
  { keywords: ['personal-ai', 'personal ai', 'pai', '個人助理', '助理系統'], dir: '~/Project/active_projects/personal-ai-assistant' },
  { keywords: ['openclaw', 'telegram bot', 'bot設定', 'bot 設定'], dir: '~/openclaw' },
  { keywords: ['ai-news', 'ai news', '新聞摘要', '新聞系統'], dir: '~/Project/active_projects/ai-news-digest' },
  { keywords: ['stationery', '文具', '文具店'], dir: '~/Project/active_projects/stationery_shop' },
  { keywords: ['sales-visit', 'sales visit', '業務拜訪', '拜訪'], dir: '~/Project/active_projects/sales-visit' },
  { keywords: ['central-hub', 'central hub', '中央', '控制中心'], dir: '~/Project/central-hub' },
  { keywords: ['channels', 'channel', '頻道'], dir: '~/Project/active_projects/channels' },
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
    keywords: ['系統狀態', '系統健康', 'cpu', '記憶體', '磁碟', '服務狀態', '健康檢查', 'system status'],
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
    keywords: ['行程', '日曆', '會議', '約會', 'calendar', '郵件', '信件', 'email', 'gmail', '雲端硬碟', 'drive'],
    subIntents: {
      'calendar.list': ['行程', '日曆', '會議', '約會', 'calendar', '今天行程', '明天行程'],
      'calendar.create': ['新增行程', '加行程', '建立會議', '排會議'],
      'gmail.list': ['郵件', '信件', 'email', 'gmail', '收件匣', 'inbox'],
      'gmail.send': ['寄信', '發郵件', '發信', 'send email'],
      'drive.list': ['雲端硬碟', 'drive', '檔案列表'],
    },
    buildParams: (text) => {
      const lower = text.toLowerCase();
      for (const [mode, kws] of Object.entries(SKILL_ROUTES[3].subIntents)) {
        if (kws.some(k => lower.includes(k))) {
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

// ─── Skill Intent Detection ────────────────────────────────────

function detectSkillIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

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
      method: 'POST',
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
    req.write(body);
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

// ─── Dev Mode Detection (v9: Smart Intent) ───────────────────────

function detectDevIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  // Check for strong signal (triggers dev mode even without project keyword)
  const hasStrongSignal = STRONG_DEV_KEYWORDS.some(kw => lower.includes(kw));

  // Check for weak signal
  const hasWeakSignal = WEAK_DEV_KEYWORDS.some(kw => lower.includes(kw));

  // Check for project keyword
  let projectDir = null;
  for (const route of PROJECT_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      projectDir = route.dir;
      break;
    }
  }

  // Decision logic:
  // Strong signal → always dev mode (use project dir if found, else generic)
  // Weak signal + project keyword → dev mode with specific project
  // Weak signal alone → NOT dev mode (normal chat)
  if (hasStrongSignal) {
    return { prompt: text, projectDir: projectDir || '~/Project/active_projects', signal: 'strong' };
  }
  if (hasWeakSignal && projectDir) {
    return { prompt: text, projectDir, signal: 'weak+project' };
  }

  return null;
}

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

function executeDevCommand(prompt, projectDir) {
  return new Promise((resolve, reject) => {
    const resolvedDir = resolveHome(projectDir);
    const claudePath = '/opt/homebrew/bin/claude';
    const startTime = Date.now();

    console.log(`[wrapper] dev-mode: spawning claude -p in ${resolvedDir}`);
    console.log(`[wrapper] dev-mode: prompt="${prompt.slice(0, 120)}..."`);

    const args = [
      '-p', prompt,
      '--allowedTools', DEV_TOOLS,
      '--max-turns', '25',
    ];

    const env = {
      ...process.env,
      HOME: process.env.HOME || '/Users/rexmacmini',
      PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
    };

    if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      env.CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    }

    let stdout = '';
    let stderr = '';
    let finished = false;

    const child = spawn(claudePath, args, {
      cwd: resolvedDir,
      env,
      timeout: DEV_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        child.kill('SIGTERM');
        const partial = stdout.slice(-DEV_MAX_OUTPUT) || '(timeout, no output)';
        resolve(`[dev-mode timeout after ${DEV_TIMEOUT_MS / 1000}s]\n${partial}`);
      }
    }, DEV_TIMEOUT_MS + 5000);

    child.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);

      const elapsed = (Date.now() - startTime) / 1000;
      const project = projectNameFromDir(projectDir);

      if (code !== 0 && !stdout) {
        const errMsg = stderr.slice(-1000) || `exit code ${code}`;
        console.error(`[wrapper] dev-mode error: ${errMsg.slice(0, 200)}`);
        logDevWork(project, prompt, elapsed, false);
        resolve(`[dev-mode error (exit ${code})]\n${errMsg.slice(0, DEV_MAX_OUTPUT)}`);
      } else {
        let output = stdout;
        if (output.length > DEV_MAX_OUTPUT) {
          output = output.slice(0, DEV_MAX_OUTPUT) + `\n... (truncated, total ${stdout.length} chars)`;
        }
        console.log(`[wrapper] dev-mode done: exit=${code} output=${stdout.length} chars`);
        logDevWork(project, prompt, elapsed, true);
        resolve(output);
      }
    });

    child.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      console.error(`[wrapper] dev-mode spawn error: ${err.message}`);
      resolve(`[dev-mode error] ${err.message}`);
    });

    child.stdin.end();
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
    timeout: 120000
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
        storeMemory(userText, assistantText);
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
    timeout: 120000
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
          usage: parsed.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));

        // Store conversation in memory (fire-and-forget)
        if (userText && text && text.length > 10) {
          storeMemory(userText, text);
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

async function handleChatCompletion(reqId, parsed, wantsStream, req, res) {
  const msgs = parsed.messages || [];
  const lastUserMsg = [...msgs].reverse().find(m => m.role === 'user');
  let userText = lastUserMsg ? normalizeContent(lastUserMsg.content) : '';

  // Detect force model directive (@claude, @ollama, @glm)
  const forceModel = ollamaRouter.detectForceModel(userText);
  if (forceModel) {
    userText = ollamaRouter.stripForceDirective(userText);
    console.log(`[wrapper] #${reqId} force model: ${forceModel}`);
  }

  let skillContext = null;
  let memoryContext = null;

  // Fetch relevant memories (non-blocking, with timeout protection)
  if (userText) {
    memoryContext = await fetchMemories(userText);
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

  
  // Priority 1: Dev mode (highest) — smart intent with strong/weak signals
  const devIntent = detectDevIntent(userText);
  if (devIntent && isAllowedPath(devIntent.projectDir)) {
    if (!checkRateLimit('dev')) {
      console.log(`[wrapper] #${reqId} DEV RATE LIMITED`);
      skillContext = '[dev-mode] 請求過於頻繁，請等待幾分鐘後再試 (上限: 10次/5分鐘)';
    } else {
      console.log(`[wrapper] #${reqId} DEV MODE [${devIntent.signal}]: project=${devIntent.projectDir}`);
      metrics.devMode++;
      try {
        const output = await executeDevCommand(devIntent.prompt, devIntent.projectDir);
        // Store dev interaction in memory too
        if (userText && output) storeMemory(userText, output.slice(0, 500));
        return sendDirectResponse(reqId, output, wantsStream, res);
      } catch (e) {
        console.error(`[wrapper] #${reqId} dev error: ${e.message}`);
        metrics.errors++;
        skillContext = `[dev-mode 錯誤] ${e.message}`;
      }
    }
  } else if (devIntent && !isAllowedPath(devIntent.projectDir)) {
    console.log(`[wrapper] #${reqId} dev BLOCKED: path not allowed: ${devIntent.projectDir}`);
    skillContext = `[dev-mode] 路徑不在白名單中: ${devIntent.projectDir}`;
  }

  // Priority 2: CLI tool routes (summarize, gh)
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
  if (!skillContext && forceModel !== 'claude') {  // 'ollama', 'glm', or null → try Ollama
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
          storeMemory(userText, ollamaResult.content);
        }
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
  if (wantsStream) {
    streamPassthrough(reqId, parsed, res, skillContext, memoryContext, userText);
  } else {
    forwardNonStreaming(reqId, parsed, res, skillContext, memoryContext, userText);
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
    strong_keywords: STRONG_DEV_KEYWORDS.length,
    weak_keywords: WEAK_DEV_KEYWORDS.length,
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

const server = http.createServer((req, res) => {
  // Health endpoint
  if (req.url === '/health' && req.method === 'GET') {
    return handleHealth(res);
  }

  // Metrics endpoint
  if (req.url === '/metrics' && req.method === 'GET') {
    return handleMetrics(res);
  }

  // Model usage stats
  if ((req.url === '/metrics/model-usage' || req.url === '/metrics/model') && req.method === 'GET') {
    return handleModelUsage(res);
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

server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(`[wrapper] Tool wrapper proxy v${VERSION} listening on :${LISTEN_PORT}`);
  console.log(`[wrapper] Upstream: localhost:${UPSTREAM_PORT}`);
  console.log(`[wrapper] Skill API: localhost:${SKILL_API_PORT}`);
  console.log(`[wrapper] Mem0 API: localhost:${MEM0_PORT}`);
  console.log(`[wrapper] Skills: ${SKILL_ROUTES.map(r => r.name).join(', ')}`);
  console.log(`[wrapper] CLI tools: ${CLI_ROUTES.map(r => r.name).join(', ')}`);
  console.log(`[wrapper] Dev mode: ${STRONG_DEV_KEYWORDS.length} strong + ${WEAK_DEV_KEYWORDS.length} weak keywords, ${PROJECT_ROUTES.length} projects`);
  console.log(`[wrapper] Dev tools: ${DEV_TOOLS}`);
  console.log(`[wrapper] Dev timeout: ${DEV_TIMEOUT_MS / 1000}s, max output: ${DEV_MAX_OUTPUT} chars`);
  console.log(`[wrapper] Rate limits: dev=${rateLimits.dev.max}/5min, skill=${rateLimits.skill.max}/min`);
  console.log(`[wrapper] Ollama: ${ollamaRouter.OLLAMA_MODEL} at localhost:11434 (timeout: ${ollamaRouter.OLLAMA_TIMEOUT / 1000}s)`);
  console.log(`[wrapper] Mode: streaming + smart-intent + CLI + dev-mode + mem0 + ollama-first routing`);
  console.log(`[wrapper] Endpoints: /health, /metrics, /metrics/model-usage`);
});
