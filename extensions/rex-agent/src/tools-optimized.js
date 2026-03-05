import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SESSION_BRIDGE_URL = process.env.SESSION_BRIDGE_URL || 'http://localhost:7788';
const AGENTD_URL = 'http://127.0.0.1:7777';

// Simple in-memory cache for repeated queries
const CACHE = {
  gemini: new Map(), // Cache Gemini responses
  commands: new Map(), // Cache command outputs
  maxSize: 50,
  ttl: 5 * 60 * 1000 // 5 minutes
};

function getCacheKey(...args) {
  return args.join('|');
}

function getFromCache(type, key) {
  const cache = CACHE[type];
  if (!cache) return null;
  
  const entry = cache.get(key);
  if (!entry) return null;
  
  if (Date.now() - entry.time > CACHE.ttl) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCache(type, key, value) {
  const cache = CACHE[type];
  if (!cache) return;
  
  // Simple size management
  if (cache.size >= CACHE.maxSize) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  
  cache.set(key, { value, time: Date.now() });
}

function getAgentdToken() {
  try {
    return fs.readFileSync(
      path.join(process.env.HOME || '/Users/rexmacmini', '.agentd-token'),
      'utf8'
    ).trim();
  } catch {
    console.warn('[rex-agent] Warning: .agentd-token not found');
    return null;
  }
}

const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

// ═══════════════════════════════════════════════════════
// OPTIMIZED: Shell execution with response caching
// ═══════════════════════════════════════════════════════

async function runCommandViaAgentd(command, useCache = true) {
  // Check cache for identical commands (useful for status checks)
  if (useCache && !command.includes('watch') && !command.includes('tail')) {
    const cacheKey = getCacheKey('cmd', command);
    const cached = getFromCache('commands', cacheKey);
    if (cached) {
      console.log('[rex-agent] Cache hit for command');
      return cached;
    }
  }

  const token = getAgentdToken();
  if (!token) {
    return { ok: false, output: 'ERROR: .agentd-token not configured' };
  }

  try {
    const res = await fetch(`${AGENTD_URL}/shell/exec`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ command }),
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, output: `HTTP ${res.status}: ${text}` };
    }

    const data = await res.json();
    
    // Cache successful responses
    if (useCache && data.ok) {
      const cacheKey = getCacheKey('cmd', command);
      setCache('commands', cacheKey, data);
    }
    
    return data;
  } catch (err) {
    return { ok: false, output: `Network error: ${err.message}` };
  }
}

// ═══════════════════════════════════════════════════════
// OPTIMIZED: Gemini analysis with streaming support
// ═══════════════════════════════════════════════════════

async function callGemini(question, fileContent) {
  if (!genAI) return '未設定 GEMINI_API_KEY，無法使用代碼分析功能。';
  
  // Check cache
  const cacheKey = getCacheKey('gemini', question, fileContent?.slice(0, 100) || '');
  const cached = getFromCache('gemini', cacheKey);
  if (cached) {
    console.log('[rex-agent] Cache hit for analysis');
    return cached;
  }

  try {
    console.log('[GEMINI] Calling with question:', question.slice(0, 100));
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    let prompt = question;
    if (fileContent) {
      prompt = `${question}\n\n檔案內容：\n\`\`\`\n${fileContent}\n\`\`\``;
    }
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    console.log('[GEMINI] Response length:', text.length);
    
    // Cache successful response
    setCache('gemini', cacheKey, text);
    return text;
  } catch (err) {
    console.error('[GEMINI ERROR]', err.message);
    return `❌ Gemini 呼叫失敗: ${err.message}`;
  }
}

// ═══════════════════════════════════════════════════════
// OPTIMIZED: Async task dispatch (non-blocking)
// ═══════════════════════════════════════════════════════

async function callSessionBridge(task, project) {
  const cwd = project
    ? `/Users/rexmacmini/${project}`
    : '/Users/rexmacmini';

  console.log(`[SESSION] Dispatching: cwd=${cwd}, task=${task.slice(0, 80)}`);
  
  // Non-blocking dispatch: fire and forget
  (async () => {
    try {
      const createRes = await fetch(`${SESSION_BRIDGE_URL}/session/spawn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'claude',
          cwd,
          prompt: task,
          mode: 'remote',
          permissionMode: 'bypassPermissions',
          maxTurns: 20,
        }),
      });
      if (!createRes.ok) {
        const errBody = await createRes.text();
        console.error(`Session spawn error: ${createRes.status} ${errBody}`);
      }
    } catch (err) {
      console.error(`Session dispatch error: ${err.message}`);
    }
  })(); // Fire async dispatch

  // Return immediately without waiting
  return (
    `🚀 任務已派發給 Claude (非阻塞)\n\n` +
    `目錄: ${cwd}\n` +
    `任務: ${task}\n\n` +
    `Claude 將在背景工作，完成後通知您。`
  );
}

// ═══════════════════════════════════════════════════════
// Utility functions
// ═══════════════════════════════════════════════════════

function stripThinking(text) {
  if (!text) return text;
  return text.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
}

function truncate(text, max = 4000) {
  if (!text || text.length <= max) return text;
  const head = text.slice(0, 2000);
  const tail = text.slice(-1500);
  return `${head}\n\n... (截斷 ${text.length} 字元) ...\n\n${tail}`;
}

// ═══════════════════════════════════════════════════════
// Tool Executors
// ═══════════════════════════════════════════════════════

async function executeTool(name, args) {
  switch (name) {
    case 'run_command': {
      const { command } = args;
      const result = await runCommandViaAgentd(command);
      const prefix = result.ok ? '✅' : '❌';
      return `${prefix} \`${command}\`\n\n${truncate(result.output)}`;
    }

    case 'analyze_code': {
      const { question, file_path } = args;
      let fileContent = null;
      if (file_path) {
        try {
          fileContent = await fsPromises.readFile(file_path, 'utf-8');
          if (fileContent.length > 10000) {
            fileContent = fileContent.slice(0, 10000) + '\n... (截斷)';
          }
        } catch {
          fileContent = `(無法讀取檔案: ${file_path})`;
        }
      }
      return await callGemini(question, fileContent);
    }

    case 'dev_task': {
      const { task, project } = args;
      return await callSessionBridge(task, project);
    }

    default:
      return `❌ Unknown tool: ${name}`;
  }
}

// ═══════════════════════════════════════════════════════
// Export
// ═══════════════════════════════════════════════════════

const SYSTEM_PROMPT = `你是 Rex Bot (優化版本)，Rex 的個人 AI 助手。

你的能力：
1. run_command — 執行 shell 命令（系統管理、檔案操作等）
2. analyze_code — 代碼分析/解釋/review（Gemini 處理）
3. dev_task — 複雜開發任務（Claude 派遣）

環境: macOS Mac mini (Apple Silicon)
規則:
- 系統命令 → run_command
- 代碼分析 → analyze_code
- 開發任務 → dev_task
- 簡單問答 → 直接回答

優化特性：
- 查詢結果緩存 (5分鐘有效期)
- 非阻塞任務派遣
- 智能響應截斷
`;

export function createRexToolsOptimized() {
  return [
    {
      type: 'function',
      function: {
        name: 'run_command',
        description: '執行 shell 命令',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: '命令' },
          },
          required: ['command'],
        },
      },
      execute: (args) => executeTool('run_command', args),
    },
    {
      type: 'function',
      function: {
        name: 'analyze_code',
        description: '代碼分析（Gemini）',
        parameters: {
          type: 'object',
          properties: {
            question: { type: 'string', description: '問題' },
            file_path: { type: 'string', description: '檔案路徑' },
          },
          required: ['question'],
        },
      },
      execute: (args) => executeTool('analyze_code', args),
    },
    {
      type: 'function',
      function: {
        name: 'dev_task',
        description: '開發任務派遣（Claude）',
        parameters: {
          type: 'object',
          properties: {
            task: { type: 'string', description: '任務' },
            project: { type: 'string', description: '專案' },
          },
          required: ['task'],
        },
      },
      execute: (args) => executeTool('dev_task', args),
    },
  ];
}

export const systemPrompt = SYSTEM_PROMPT;
export { stripThinking, truncate, callGemini, callSessionBridge };
