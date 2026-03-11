import fs from "node:fs";
import path from "node:path";

const SESSION_BRIDGE_URL = process.env.SESSION_BRIDGE_URL || "http://host.docker.internal:7788";
const HOME = process.env.HOME || "/home/node";
const TASKS_FILE = path.join(HOME, ".openclaw/dev-tasks.jsonl");
const PROJECTS_FILE = path.join(HOME, ".openclaw/projects.json");
const MAX_SESSIONS = 2;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const POLL_INTERVAL_MS = 30 * 1000; // 30 seconds

// Rate limiter: max 20 tasks per hour
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const _taskTimestamps = [];

function checkRateLimit() {
  const now = Date.now();
  // Remove timestamps outside the window
  while (_taskTimestamps.length > 0 && _taskTimestamps[0] < now - RATE_LIMIT_WINDOW_MS) {
    _taskTimestamps.shift();
  }
  if (_taskTimestamps.length >= RATE_LIMIT_MAX) {
    return false;
  }
  _taskTimestamps.push(now);
  return true;
}

// Telegram notification config
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = "150944774";

// ── projects.json with 5s TTL cache ──

let _projCache = null;
let _projCacheTs = 0;

function loadProjectMap() {
  if (_projCache && Date.now() - _projCacheTs < 5000) return _projCache;
  try {
    _projCache = JSON.parse(fs.readFileSync(PROJECTS_FILE, "utf8"));
    _projCacheTs = Date.now();
  } catch {
    _projCache = {};
  }
  return _projCache;
}

function getSpawnToken() {
  try {
    return fs.readFileSync(path.join(HOME, ".openclaw/.spawn-token"), "utf8").trim();
  } catch {
    return null;
  }
}

function resolveProjectCwd(project) {
  if (!project) return "/Users/rexmacmini";
  const key = project.toLowerCase().trim();
  const map = loadProjectMap();
  return map[key] || `/Users/rexmacmini/${project}`;
}

function resolveProjectName(project) {
  if (!project) return "misc";
  const key = project.toLowerCase().trim();
  const map = loadProjectMap();
  const targetPath = map[key];
  if (targetPath) {
    let shortest = key;
    for (const [k, v] of Object.entries(map)) {
      if (v === targetPath && k.length < shortest.length) shortest = k;
    }
    return shortest;
  }
  return key;
}

// ── Session timeout tracking ──

const _timeoutTimers = new Map();

function startSessionTimeout(sessionId) {
  const timer = setTimeout(async () => {
    _timeoutTimers.delete(sessionId);
    try {
      await bridgeFetch(`/session/${sessionId}/stop`, {
        method: "POST",
        body: JSON.stringify({ force: false }),
      });
    } catch { /* ignore */ }
  }, SESSION_TIMEOUT_MS);
  timer.unref();
  _timeoutTimers.set(sessionId, timer);
}

function clearSessionTimeout(sessionId) {
  const timer = _timeoutTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    _timeoutTimers.delete(sessionId);
  }
}

// ── JSONL Task Registry ──

function readTaskEvents() {
  try {
    const raw = fs.readFileSync(TASKS_FILE, "utf8").trim();
    if (!raw) return [];
    return raw.split("\n").map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function appendTaskEvent(event) {
  const line = JSON.stringify(event) + "\n";
  fs.appendFileSync(TASKS_FILE, line);
}

function getNextTaskNum(events) {
  let max = 0;
  for (const e of events) {
    if (e.taskNum > max) max = e.taskNum;
  }
  return max + 1;
}

function reconstructTasks(events) {
  const map = new Map();
  for (const e of events) {
    if (e.event === "create") {
      map.set(e.taskNum, {
        taskNum: e.taskNum,
        project: e.project,
        task: e.task,
        sessionId: e.sessionId,
        status: "running",
        createdAt: e.ts,
        completedAt: null,
        filesChanged: null,
        reviewStatus: null,
      });
    } else if (e.event === "complete") {
      const t = map.get(e.taskNum);
      if (t) {
        t.status = "pending_review";
        t.completedAt = e.ts;
        t.filesChanged = e.filesChanged || null;
        t.reviewStatus = "pending";
      }
    } else if (e.event === "cancel") {
      const t = map.get(e.taskNum);
      if (t) {
        t.status = "cancelled";
        t.completedAt = e.ts;
      }
    } else if (e.event === "review") {
      const t = map.get(e.taskNum);
      if (t) {
        t.reviewStatus = e.decision; // "approved" or "rejected"
        t.status = e.decision === "approved" ? "completed" : "rejected";
      }
    }
  }
  return map;
}

// ── Session Bridge helpers ──

let _spawnLock = false;

async function bridgeFetch(urlPath, options = {}) {
  const token = getSpawnToken();
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers["X-Spawn-Token"] = token;
  return fetch(`${SESSION_BRIDGE_URL}${urlPath}`, { ...options, headers });
}

async function getRunningSessionCount() {
  try {
    const res = await bridgeFetch("/session/list");
    const data = await res.json();
    return data.sessions.filter((s) => s.state !== "stopped").length;
  } catch {
    return 0;
  }
}

function formatDuration(ms) {
  const min = Math.round(ms / 60000);
  if (min < 1) return "<1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ── Change 2: Get files changed via git ──

async function getFilesChanged(project) {
  const cwd = resolveProjectCwd(project);
  try {
    // Use host-exec to run git diff on the host
    const hostExec = path.join(HOME, ".openclaw/scripts/host-exec.sh");
    const { execSync } = await import("node:child_process");
    const output = execSync(
      `bash ${hostExec} "cd ${cwd} && git diff --name-only HEAD~1 HEAD 2>/dev/null || echo ''"`,
      { timeout: 10000, encoding: "utf8" }
    ).trim();
    if (!output) return [];
    return output.split("\n").filter(Boolean).slice(0, 50); // cap at 50 files
  } catch {
    return [];
  }
}

// ── Change 3: Telegram notification ──

async function sendTelegramNotification(task, filesChanged) {
  if (!TELEGRAM_BOT_TOKEN) return;

  const fileList = filesChanged.length > 0
    ? filesChanged.slice(0, 15).map(f => `  ${f}`).join("\n") +
      (filesChanged.length > 15 ? `\n  ... +${filesChanged.length - 15} more` : "")
    : "  (no file changes detected)";

  const text = [
    `📋 Dev Task #${task.taskNum} completed`,
    `Project: ${task.project}`,
    `Task: ${task.task.substring(0, 200)}`,
    `Duration: ${formatDuration(Date.now() - new Date(task.createdAt).getTime())}`,
    ``,
    `Files changed:`,
    fileList,
    ``,
    `Reply "approve #${task.taskNum}" or "reject #${task.taskNum}" to review.`,
  ].join("\n");

  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: undefined,
      }),
    });
  } catch { /* best effort */ }
}

// ── Change 2+3: Periodic completion checker ──

let _pollTimer = null;

async function pollTaskCompletions() {
  let liveSessions;
  try {
    const res = await bridgeFetch("/session/list");
    const data = await res.json();
    liveSessions = new Set(
      data.sessions.filter((s) => s.state !== "stopped").map((s) => s.id)
    );
  } catch {
    return; // bridge unreachable, skip this cycle
  }

  const events = readTaskEvents();
  const tasks = reconstructTasks(events);

  for (const [, t] of tasks) {
    if (t.status !== "running") continue;
    if (liveSessions.has(t.sessionId)) continue;

    // Task just completed — get files changed
    const filesChanged = await getFilesChanged(t.project);

    clearSessionTimeout(t.sessionId);
    appendTaskEvent({
      event: "complete",
      taskNum: t.taskNum,
      ts: new Date().toISOString(),
      filesChanged,
    });

  }
}

function startPoller() {
  if (_pollTimer) return;
  _pollTimer = setInterval(pollTaskCompletions, POLL_INTERVAL_MS);
  _pollTimer.unref();
}

// ── Plugin Registration ──

export default function register(api) {
  // Start background poller for task completions
  startPoller();

  // ── dev_task ──
  api.registerTool({
    name: "dev_task",
    label: "Dev Task",
    description:
      "Dispatch a development task (write code, fix bugs, add features, refactor) to Claude Code running on the host. " +
      "Use this for ANY task that requires modifying source code files. " +
      "The task runs asynchronously — you'll be notified via Telegram when done.",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Development task description (what to implement/fix/change)",
        },
        project: {
          type: "string",
          description: "Project name: taiwan-stock, openclaw, rex-ai (or aliases: stock, oc, ai)",
        },
      },
      required: ["task"],
    },

    async execute(_id, params) {
      const task = typeof params.task === "string" ? params.task.trim() : "";
      if (!task) {
        return { content: [{ type: "text", text: "task is required" }] };
      }

      const project = typeof params.project === "string" ? params.project.trim() : "";
      const cwd = resolveProjectCwd(project);
      const projectName = resolveProjectName(project);

      const token = getSpawnToken();
      if (!token) {
        return {
          content: [{ type: "text", text: "Session Bridge spawn token not configured (.spawn-token missing)" }],
        };
      }

      // Rate limit check
      if (!checkRateLimit()) {
        return {
          content: [{
            type: "text",
            text: `Rate limit: max ${RATE_LIMIT_MAX} tasks per hour reached. Wait before dispatching more.`,
          }],
        };
      }

      if (_spawnLock) {
        return { content: [{ type: "text", text: "Another task is being dispatched, please wait." }] };
      }
      _spawnLock = true;
      try {
        const running = await getRunningSessionCount();
        if (running >= MAX_SESSIONS) {
          return {
            content: [{
              type: "text",
              text: `Already ${running} dev tasks running (max ${MAX_SESSIONS}). Wait for completion or cancel with dev_cancel.`,
            }],
          };
        }

        const events = readTaskEvents();
        const taskNum = getNextTaskNum(events);

        const res = await bridgeFetch("/session/spawn", {
          method: "POST",
          body: JSON.stringify({
            provider: "claude",
            cwd,
            prompt: task,
            mode: "remote",
            maxTurns: 20,
            _taskMeta: { project: projectName, taskNum },
          }),
        });

        if (!res.ok) {
          const errBody = await res.text();
          return {
            content: [{ type: "text", text: `Session Bridge error: ${res.status} ${errBody}` }],
          };
        }

        const session = await res.json();
        startSessionTimeout(session.sessionId);

        appendTaskEvent({
          event: "create",
          taskNum,
          project: projectName,
          task,
          sessionId: session.sessionId,
          ts: new Date().toISOString(),
        });

        return {
          content: [{
            type: "text",
            text: [
              `Dev task #${taskNum} dispatched.`,
              ``,
              `Project: ${projectName}`,
              `Directory: ${cwd}`,
              `Task: ${task}`,
              ``,
              `Claude Code is working on it. You'll be notified via Telegram when done.`,
            ].join("\n"),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Session Bridge connection failed: ${err.message}` }],
        };
      } finally {
        _spawnLock = false;
      }
    },
  }, { optional: false });

  // ── dev_status ──
  api.registerTool({
    name: "dev_status",
    label: "Dev Status",
    description:
      "Show current and recent dev tasks dispatched to Claude Code. " +
      "Use this when the user asks about task status, running tasks, or what Claude Code is working on.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },

    async execute() {
      const events = readTaskEvents();
      const tasks = reconstructTasks(events);
      const now = Date.now();

      let liveSessions = new Set();
      try {
        const res = await bridgeFetch("/session/list");
        const data = await res.json();
        liveSessions = new Set(data.sessions.filter((s) => s.state !== "stopped").map((s) => s.id));
      } catch { /* ignore */ }

      // Reconcile running tasks (poller might have missed some)
      for (const [, t] of tasks) {
        if (t.status === "running" && !liveSessions.has(t.sessionId)) {
          const filesChanged = await getFilesChanged(t.project);
          t.status = "pending_review";
          t.completedAt = new Date().toISOString();
          t.filesChanged = filesChanged;
          t.reviewStatus = "pending";
          appendTaskEvent({ event: "complete", taskNum: t.taskNum, ts: t.completedAt, filesChanged });
        }
      }

      const sorted = [...tasks.values()].sort((a, b) => b.taskNum - a.taskNum);
      const running = sorted.filter((t) => t.status === "running");
      const pendingReview = sorted.filter((t) => t.status === "pending_review");
      const recent = sorted.filter((t) => !["running", "pending_review"].includes(t.status)).slice(0, 5);

      const lines = [];

      if (running.length === 0 && pendingReview.length === 0 && recent.length === 0) {
        return { content: [{ type: "text", text: "No dev tasks recorded." }] };
      }

      if (running.length > 0) {
        lines.push(`Running (${running.length}/${MAX_SESSIONS}):`);
        for (const t of running) {
          const elapsed = formatDuration(now - new Date(t.createdAt).getTime());
          lines.push(`  #${t.taskNum} [${t.project}] ${t.task.substring(0, 60)} (${elapsed})`);
        }
      } else {
        lines.push("No tasks currently running.");
      }

      if (pendingReview.length > 0) {
        lines.push("");
        lines.push("Pending review:");
        for (const t of pendingReview) {
          const fileCount = t.filesChanged ? t.filesChanged.length : 0;
          lines.push(`  #${t.taskNum} [${t.project}] ${t.task.substring(0, 50)} (${fileCount} files)`);
        }
      }

      if (recent.length > 0) {
        lines.push("");
        lines.push("Recent:");
        for (const t of recent) {
          const icon = t.status === "completed" ? "approved" :
                       t.status === "rejected" ? "rejected" :
                       t.status === "cancelled" ? "cancelled" : t.status;
          lines.push(`  #${t.taskNum} [${t.project}] ${t.task.substring(0, 60)} — ${icon}`);
        }
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  }, { optional: false });

  // ── dev_cancel ──
  api.registerTool({
    name: "dev_cancel",
    label: "Dev Cancel",
    description:
      "Cancel a running dev task by its task number (from dev_status). " +
      "Use when user wants to stop/cancel a development task.",
    parameters: {
      type: "object",
      properties: {
        task_number: {
          type: "number",
          description: "Task number to cancel (from dev_status)",
        },
      },
      required: ["task_number"],
    },

    async execute(_id, params) {
      const taskNum = params.task_number;
      const events = readTaskEvents();
      const tasks = reconstructTasks(events);
      const task = tasks.get(taskNum);

      if (!task) {
        return { content: [{ type: "text", text: `Task #${taskNum} not found.` }] };
      }

      if (task.status !== "running") {
        return { content: [{ type: "text", text: `Task #${taskNum} is already ${task.status}.` }] };
      }

      try {
        const res = await bridgeFetch(`/session/${task.sessionId}/stop`, {
          method: "POST",
          body: JSON.stringify({ force: false }),
        });

        if (!res.ok) {
          const errBody = await res.text();
          return { content: [{ type: "text", text: `Failed to stop session: ${res.status} ${errBody}` }] };
        }

        clearSessionTimeout(task.sessionId);
        appendTaskEvent({ event: "cancel", taskNum, ts: new Date().toISOString() });

        return {
          content: [{
            type: "text",
            text: `Task #${taskNum} [${task.project}] cancelled.`,
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to cancel: ${err.message}` }],
        };
      }
    },
  }, { optional: false });

  // ── dev_review (Change 3) ──
  api.registerTool({
    name: "dev_review",
    label: "Dev Review",
    description:
      "Approve or reject a completed dev task. " +
      "Use when user says 'approve #N' or 'reject #N' for a pending review task.",
    parameters: {
      type: "object",
      properties: {
        task_number: {
          type: "number",
          description: "Task number to review",
        },
        decision: {
          type: "string",
          enum: ["approved", "rejected"],
          description: "Review decision: approved or rejected",
        },
        reason: {
          type: "string",
          description: "Optional reason for the decision",
        },
      },
      required: ["task_number", "decision"],
    },

    async execute(_id, params) {
      const taskNum = params.task_number;
      const decision = params.decision;
      const reason = params.reason || "";
      const events = readTaskEvents();
      const tasks = reconstructTasks(events);
      const task = tasks.get(taskNum);

      if (!task) {
        return { content: [{ type: "text", text: `Task #${taskNum} not found.` }] };
      }

      if (task.status !== "pending_review") {
        return {
          content: [{
            type: "text",
            text: `Task #${taskNum} is ${task.status}, not pending review.`,
          }],
        };
      }

      appendTaskEvent({
        event: "review",
        taskNum,
        decision,
        reason,
        ts: new Date().toISOString(),
      });

      const emoji = decision === "approved" ? "✅" : "❌";
      const lines = [
        `${emoji} Task #${taskNum} [${task.project}] ${decision}.`,
      ];
      if (reason) lines.push(`Reason: ${reason}`);
      if (decision === "rejected" && task.filesChanged && task.filesChanged.length > 0) {
        lines.push(``, `To revert, run: git -C ${resolveProjectCwd(task.project)} revert HEAD`);
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  }, { optional: false });
}
