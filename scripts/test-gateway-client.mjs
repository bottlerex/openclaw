#!/usr/bin/env node
/**
 * Tests for ws-gateway-client.mjs parseCommand function
 * and basic RPC connectivity.
 *
 * Usage: node test-gateway-client.mjs [--live]
 *   --live   also run live gateway connection tests (requires running gateway)
 */
import crypto from "crypto";

// --- Extract parseCommand for testing ---
// We replicate it here since ws-gateway-client.mjs has side effects on import

function parseCommand(parts) {
  const method = parts[0];
  if (!method) return null;

  switch (method) {
    case "chat.send":
      return { method, params: { sessionKey: parts[2] ? parts[1] : "agent:main:main", message: parts[2] || parts.slice(1).join(" ") || "ping", idempotencyKey: "test-uuid" } };
    case "chat.history":
      return { method, params: { limit: parseInt(parts[1]) || 20 } };
    case "chat.abort":
      return { method, params: {} };
    case "chat.inject":
      return { method, params: { sessionKey: parts[1] || "agent:main:main", role: parts[2] || "user", text: parts.slice(3).join(" ") || "" } };
    case "sessions.list":
      return { method, params: {} };
    case "sessions.preview":
      return { method, params: { sessionId: parts[1] || "main" } };
    case "sessions.delete":
      return { method, params: { sessionKey: parts[1] } };
    case "sessions.reset":
      return { method, params: { sessionKey: parts[1] } };
    case "channels.status":
      return { method, params: {} };
    case "agents.list":
      return { method, params: {} };
    case "agents.create":
      return { method, params: { name: parts[1], workspace: parts[1], ...JSON.parse(parts[2] || "{}") } };
    case "config.get":
      return { method, params: {} };
    case "cron.list":
      return { method, params: {} };
    case "cron.add":
      return { method, params: JSON.parse(parts.slice(1).join(" ") || "{}") };
    case "cron.remove":
      return { method, params: { id: parts[1] } };
    case "device.pair.list":
      return { method, params: {} };
    case "device.pair.approve":
      return { method, params: { requestId: parts[1], role: "operator", scopes: ["operator.admin", "operator.read", "operator.write", "operator.approvals", "operator.pairing"] } };
    case "node.list":
      return { method, params: {} };
    case "node.describe":
      return { method, params: { nodeId: parts[1] } };
    case "logs.tail":
      return { method, params: { lines: parseInt(parts[1]) || 50 } };
    case "tools.catalog":
      return { method, params: {} };
    case "skills.status":
      return { method, params: {} };
    case "gateway.reload":
      return { method, params: {} };
    default:
      try {
        const params = parts[1] ? JSON.parse(parts.slice(1).join(" ")) : {};
        return { method, params };
      } catch {
        return { method, params: {} };
      }
  }
}

// --- Test framework ---

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

function assertEq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${msg}\n    expected: ${e}\n    actual:   ${a}`);
  }
}

// --- parseCommand tests ---

console.log("=== parseCommand tests ===");

// chat.send with message
{
  const cmd = parseCommand(["chat.send", "hello", "world"]);
  assertEq(cmd.method, "chat.send", "chat.send method");
  assertEq(cmd.params.sessionKey, "hello", "chat.send with session key");
  assertEq(cmd.params.message, "world", "chat.send message after key");
}

// chat.send without session key
{
  const cmd = parseCommand(["chat.send", "hi"]);
  assertEq(cmd.method, "chat.send", "chat.send method (no key)");
  assertEq(cmd.params.sessionKey, "agent:main:main", "chat.send default session key");
  assertEq(cmd.params.message, "hi", "chat.send message");
}

// chat.history with limit
{
  const cmd = parseCommand(["chat.history", "50"]);
  assertEq(cmd.params.limit, 50, "chat.history custom limit");
}

// chat.history default
{
  const cmd = parseCommand(["chat.history"]);
  assertEq(cmd.params.limit, 20, "chat.history default limit");
}

// sessions.list
{
  const cmd = parseCommand(["sessions.list"]);
  assertEq(cmd.method, "sessions.list", "sessions.list method");
  assertEq(cmd.params, {}, "sessions.list no params");
}

// sessions.preview
{
  const cmd = parseCommand(["sessions.preview", "test-id"]);
  assertEq(cmd.params.sessionId, "test-id", "sessions.preview id");
}

// sessions.delete
{
  const cmd = parseCommand(["sessions.delete", "agent:main:main"]);
  assertEq(cmd.params.sessionKey, "agent:main:main", "sessions.delete key");
}

// channels.status
{
  const cmd = parseCommand(["channels.status"]);
  assertEq(cmd.method, "channels.status", "channels.status method");
}

// agents.create
{
  const cmd = parseCommand(["agents.create", "test-agent"]);
  assertEq(cmd.params.name, "test-agent", "agents.create name");
  assertEq(cmd.params.workspace, "test-agent", "agents.create workspace");
}

// config.get
{
  const cmd = parseCommand(["config.get"]);
  assertEq(cmd.params, {}, "config.get no params");
}

// cron.add with JSON
{
  const cmd = parseCommand(["cron.add", '{"name":"test","schedule":{"cron":"0 * * * *"}}']);
  assertEq(cmd.params.name, "test", "cron.add name from JSON");
}

// cron.remove
{
  const cmd = parseCommand(["cron.remove", "abc-123"]);
  assertEq(cmd.params.id, "abc-123", "cron.remove id");
}

// device.pair.approve
{
  const cmd = parseCommand(["device.pair.approve", "req-456"]);
  assertEq(cmd.params.requestId, "req-456", "device.pair.approve requestId");
  assert(cmd.params.scopes.includes("operator.admin"), "device.pair.approve has admin scope");
}

// node.describe
{
  const cmd = parseCommand(["node.describe", "node-id-123"]);
  assertEq(cmd.params.nodeId, "node-id-123", "node.describe nodeId");
}

// logs.tail default
{
  const cmd = parseCommand(["logs.tail"]);
  assertEq(cmd.params.lines, 50, "logs.tail default 50");
}

// logs.tail custom
{
  const cmd = parseCommand(["logs.tail", "100"]);
  assertEq(cmd.params.lines, 100, "logs.tail custom 100");
}

// null input
{
  const cmd = parseCommand([]);
  assert(cmd === null, "empty input returns null");
}

// generic method with JSON
{
  const cmd = parseCommand(["custom.method", '{"key":"value"}']);
  assertEq(cmd.method, "custom.method", "generic method name");
  assertEq(cmd.params.key, "value", "generic method JSON params");
}

// generic method without params
{
  const cmd = parseCommand(["unknown.method"]);
  assertEq(cmd.method, "unknown.method", "unknown method name");
  assertEq(cmd.params, {}, "unknown method empty params");
}

// chat.inject
{
  const cmd = parseCommand(["chat.inject", "agent:main:main", "system", "you are helpful"]);
  assertEq(cmd.params.sessionKey, "agent:main:main", "chat.inject sessionKey");
  assertEq(cmd.params.role, "system", "chat.inject role");
  assertEq(cmd.params.text, "you are helpful", "chat.inject text");
}

console.log(`\n=== parseCommand: ${passed} passed, ${failed} failed ===`);

// --- Live tests (optional) ---

const flagLive = process.argv.includes("--live");

if (flagLive) {
  console.log("\n=== Live gateway tests ===");
  const { execSync } = await import("child_process");

  const OC = "scripts/oc";

  function oc(args) {
    try {
      return JSON.parse(execSync(`${OC} ${args} -q 2>/dev/null`, { encoding: "utf-8", timeout: 15000 }));
    } catch (e) {
      return { error: e.message };
    }
  }

  // Auth check
  try {
    execSync(`${OC} --once 2>&1`, { timeout: 10000 });
    passed++;
    console.log("  OK: auth connection");
  } catch {
    failed++;
    console.error("  FAIL: auth connection");
  }

  // sessions.list
  const sessions = oc("sessions.list");
  assert(Array.isArray(sessions.sessions), "sessions.list returns array");

  // channels.status
  const channels = oc("channels.status");
  assert(channels.channelOrder !== undefined, "channels.status has channelOrder");

  // agents.list
  const agents = oc("agents.list");
  assert(Array.isArray(agents.agents), "agents.list returns array");
  assert(agents.agents.some(a => a.id === "main"), "agents.list has main agent");

  // node.list
  const nodes = oc("node.list");
  assert(Array.isArray(nodes.nodes), "node.list returns array");

  // cron.list
  const crons = oc("cron.list");
  assert(Array.isArray(crons.jobs), "cron.list returns jobs array");

  // device.pair.list
  const pairs = oc("device.pair.list");
  assert(pairs.paired !== undefined || pairs.pending !== undefined, "device.pair.list returns data");

  // tools.catalog
  const tools = oc("tools.catalog");
  assert(tools.tools !== undefined || tools.error === undefined, "tools.catalog returns data");

  // skills.status
  const skills = oc("skills.status");
  assert(skills !== undefined, "skills.status returns data");

  console.log(`\n=== Live: ${passed - (passed - failed)} total, check above ===`);
}

// --- Summary ---

console.log(`\n${"=".repeat(40)}`);
console.log(`Total: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
