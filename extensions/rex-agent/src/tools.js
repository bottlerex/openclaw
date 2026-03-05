import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";

// ─── Configuration ─────────────────────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SESSION_BRIDGE_URL = process.env.SESSION_BRIDGE_URL || "http://localhost:7788";
const AGENTD_URL = "http://127.0.0.1:7777";

// Read token for mac-agentd (sync for startup)
function getAgentdToken() {
  try {
    return fs.readFileSync(
      path.join(process.env.HOME || "/Users/rexmacmini", ".agentd-token"),
      "utf8"
    ).trim();
  } catch {
    console.warn("[rex-agent] Warning: .agentd-token not found");
    return null;
  }
}

const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

// ─── System Prompt ─────────────────────────────────────────────
const SYSTEM_PROMPT = `你是 Rex Bot，Rex 的個人 AI 助手，運行在 Mac mini 上。

你的能力：
1. run_command — 執行 shell 命令（Docker 管理、檔案操作、系統監控、Git 等）
2. analyze_code — 代碼分析/解釋/review（會交給 Gemini 處理）
3. dev_task — 複雜開發任務（會交給 Claude 處理）

環境資訊：
- 系統: macOS Mac mini (Apple Silicon)
- Docker: OrbStack
- 外接硬碟: /Volumes/Black\\ Rex/
- 專案目錄: /Users/rexmacmini/
- 主要專案: taiwan-stock-mvp, personal-ai-assistant, openclaw, rex-ai, rex-bot
- Ollama 模型路徑: ~/.ollama/models/
- Ollama 列出模型: ollama list
- Ollama 模型資訊: ollama show <model>

規則：
- 如果用戶要求執行系統命令、查看狀態、操作檔案 → 使用 run_command
- 如果用戶要求分析代碼、解釋技術概念、review → 使用 analyze_code
- 如果用戶要求寫程式、修 bug、重構 → 使用 dev_task
- 如果是閒聊或簡單問答 → 直接回答，不要使用工具
- 回答用繁體中文
- 回答簡短直接，不要冗長解釋
- /no_think`;

// ─── Tools Definition ─────────────────────────────────────────
const TOOLS = [
  {
    type: "function",
    function: {
      name: "run_command",
      description: "在 Mac mini 上執行 shell 命令（系統管理、檔案操作、Docker、Git、磁碟空間等）",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "要執行的 shell 命令" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_code",
      description: "分析/解釋/review 代碼，回答技術問題（交給 Gemini 處理）",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "要分析的問題或需求" },
          file_path: { type: "string", description: "相關檔案路徑（可選）" },
        },
        required: ["question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "dev_task",
      description: "複雜開發任務：寫程式、修 bug、重構、多檔案修改（交給 Claude 處理）",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "開發任務描述" },
          project: { type: "string", description: "專案名稱（可選）" },
        },
        required: ["task"],
      },
    },
  },
];

// ─── Helpers ───────────────────────────────────────────────────

function stripThinking(text) {
  if (!text) return text;
  return text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
}

function truncate(text, max = 4000) {
  if (!text || text.length <= max) return text;
  const head = text.slice(0, 2000);
  const tail = text.slice(-1500);
  return `${head}\n\n... (截斷 ${text.length} 字元) ...\n\n${tail}`;
}

// ─── Shell Execution via mac-agentd ────────────────────────────

async function runCommandViaAgentd(command) {
  const token = getAgentdToken();
  if (!token) {
    return { ok: false, output: "ERROR: .agentd-token not configured" };
  }

  try {
    const res = await fetch(`${AGENTD_URL}/shell/exec`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command }),
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, output: `HTTP ${res.status}: ${text}` };
    }

    const data = await res.json();
    return data;
  } catch (err) {
    return { ok: false, output: `Network error: ${err.message}` };
  }
}

// ─── Gemini Code Analysis ──────────────────────────────────────

async function callGemini(question, fileContent) {
  if (!genAI) return "未設定 GEMINI_API_KEY，無法使用代碼分析功能。";
  try {
    console.log("[GEMINI] Calling with question:", question.slice(0, 100));
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    let prompt = question;
    if (fileContent) {
      prompt = `${question}\n\n檔案內容：\n\`\`\`\n${fileContent}\n\`\`\``;
    }
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    console.log("[GEMINI] Response length:", text.length);
    return text;
  } catch (err) {
    console.error("[GEMINI ERROR]", err.message);
    return `❌ Gemini 呼叫失敗: ${err.message}`;
  }
}

// ─── Claude Session Bridge ────────────────────────────────────

async function callSessionBridge(task, project) {
  const cwd = project
    ? `/Users/rexmacmini/${project}`
    : "/Users/rexmacmini";

  console.log(`[SESSION] Spawning: cwd=${cwd}, prompt=${task.slice(0, 80)}`);
  try {
    const createRes = await fetch(`${SESSION_BRIDGE_URL}/session/spawn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "claude",
        cwd,
        prompt: task,
        mode: "remote",
        permissionMode: "bypassPermissions",
        maxTurns: 20,
      }),
    });
    if (!createRes.ok) {
      const errBody = await createRes.text();
      throw new Error(
        `Session Bridge spawn error: ${createRes.status} ${errBody}`
      );
    }
    const session = await createRes.json();
    const sessionId = session.sessionId;
    console.log(`[SESSION] Spawned: ${sessionId}, pid=${session.pid}`);

    return (
      `🚀 開發任務已派發給 Claude\n\n` +
      `Session: ${sessionId}\n` +
      `目錄: ${cwd}\n` +
      `任務: ${task}\n\n` +
      `Claude 完成後會透過 Telegram 通知你。`
    );
  } catch (err) {
    return `❌ Session Bridge 失敗: ${err.message}`;
  }
}

// ─── Tool Executors ────────────────────────────────────────────

async function executeTool(name, args) {
  switch (name) {
    case "run_command": {
      const { command } = args;
      const result = await runCommandViaAgentd(command);
      const prefix = result.ok ? "✅" : "❌";
      return `${prefix} \`${command}\`\n\n${truncate(result.output)}`;
    }

    case "analyze_code": {
      const { question, file_path } = args;
      let fileContent = null;
      if (file_path) {
        try {
          fileContent = await fsPromises.readFile(file_path, "utf-8");
          if (fileContent.length > 10000) {
            fileContent = fileContent.slice(0, 10000) + "\n... (截斷)";
          }
        } catch {
          fileContent = `(無法讀取檔案: ${file_path})`;
        }
      }
      return await callGemini(question, fileContent);
    }

    case "dev_task": {
      const { task, project } = args;
      return await callSessionBridge(task, project);
    }

    default:
      return `❌ Unknown tool: ${name}`;
  }
}

// ─── Export ────────────────────────────────────────────────────

export function createRexTools() {
  return TOOLS.map((tool) => ({
    ...tool,
    execute: (args) => executeTool(tool.function.name, args),
  }));
}

export const systemPrompt = SYSTEM_PROMPT;
export { stripThinking, truncate, callGemini, callSessionBridge };
