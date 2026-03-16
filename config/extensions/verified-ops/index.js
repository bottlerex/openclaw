/**
 * verified-ops: Verified stateful operations
 * Pattern: operation → verify → return {success, verified, message}
 * LLM only sees structured results, never judges success from raw output.
 */

const HOME = process.env.HOME || "/home/node";

async function hostExec(cmd) {
  const { execSync } = await import("node:child_process");
  const hostExecPath = `${HOME}/.openclaw/scripts/host-exec.sh`;
  try {
    const output = execSync(`bash ${hostExecPath} "${cmd.replace(/"/g, '\\"')}"`, {
      timeout: 30000,
      encoding: "utf8",
    });
    return { exitCode: 0, stdout: output.trim(), stderr: "" };
  } catch (err) {
    return {
      exitCode: err.status || 1,
      stdout: (err.stdout || "").trim(),
      stderr: (err.stderr || "").trim(),
    };
  }
}

export default function register(api) {

  // ── email_delete: Delete emails with verification ──
  api.registerTool({
    name: "email_delete",
    label: "Delete Email (Verified)",
    description:
      "Delete Gmail threads by moving to trash. Automatically verifies deletion. " +
      "Use this instead of running gog commands directly when deleting emails.",
    parameters: {
      type: "object",
      properties: {
        thread_ids: {
          type: "array",
          items: { type: "string" },
          description: "Array of Gmail thread IDs to delete",
        },
        reason: {
          type: "string",
          description: "Why these emails are being deleted",
        },
      },
      required: ["thread_ids"],
    },

    async execute(_id, params) {
      const threadIds = params.thread_ids || [];
      const reason = params.reason || "";

      if (threadIds.length === 0) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, verified: false, message: "No thread IDs provided" }) }] };
      }

      if (threadIds.length > 20) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, verified: false, message: "Max 20 threads per operation" }) }] };
      }

      const results = [];

      for (const tid of threadIds) {
        // Step 1: Operation - trash the thread
        const op = await hostExec(`gog gmail thread modify ${tid} --add-labels TRASH`);

        // Step 2: Verify - check thread now has TRASH label
        const verify = await hostExec(`gog gmail thread get ${tid} --format json`);

        let verified = false;
        if (verify.exitCode === 0) {
          try {
            // Check if TRASH label is present
            verified = verify.stdout.includes("TRASH");
          } catch { /* parse error = not verified */ }
        }

        results.push({
          threadId: tid,
          operationExitCode: op.exitCode,
          verified,
        });
      }

      const successCount = results.filter(r => r.verified).length;
      const failCount = results.filter(r => !r.verified).length;

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: failCount === 0,
            verified: true,
            message: `${successCount}/${threadIds.length} threads trashed and verified.` +
              (failCount > 0 ? ` ${failCount} failed: ${results.filter(r => !r.verified).map(r => r.threadId).join(", ")}` : ""),
            details: results,
          }, null, 2),
        }],
      };
    },
  }, { optional: false });

  // ── email_search: Search emails (read-only, still structured) ──
  api.registerTool({
    name: "email_search",
    label: "Search Email",
    description:
      "Search Gmail with structured results. Use this instead of raw gog commands.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Gmail search query (e.g. 'is:unread', 'from:someone@email.com')",
        },
        max_results: {
          type: "number",
          description: "Maximum results to return (default 10)",
        },
      },
      required: ["query"],
    },

    async execute(_id, params) {
      const query = params.query || "";
      const max = params.max_results || 10;

      const result = await hostExec(`gog gmail search '${query.replace(/'/g, "\\'")}' --max ${max}`);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: result.exitCode === 0,
            verified: true,
            message: result.exitCode === 0
              ? result.stdout || "(no results)"
              : `Search failed: ${result.stderr || result.stdout}`,
          }),
        }],
      };
    },
  }, { optional: false });

  // ── verified_exec: Generic operation + verification ──
  api.registerTool({
    name: "verified_exec",
    label: "Verified Execute",
    description:
      "Run a command AND a verification command. Returns structured {success, verified} result. " +
      "Use this for any stateful operation that needs proof of success. " +
      "Example: operation='gog gmail thread modify X --add TRASH' verify='gog gmail search is:trash id:X'",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          description: "The command to execute (the action)",
        },
        verify: {
          type: "string",
          description: "The command to verify success (independent check)",
        },
        expect: {
          type: "string",
          description: "What the verify output should contain to confirm success",
        },
      },
      required: ["operation", "verify", "expect"],
    },

    async execute(_id, params) {
      const { operation, verify, expect } = params;

      // Step 1: Execute operation
      const opResult = await hostExec(operation);

      // Step 2: Verify
      const verifyResult = await hostExec(verify);

      const verified = verifyResult.exitCode === 0 &&
        verifyResult.stdout.includes(expect);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: opResult.exitCode === 0 && verified,
            verified,
            operationExitCode: opResult.exitCode,
            verifyExitCode: verifyResult.exitCode,
            message: verified
              ? `Operation succeeded and verified (found "${expect}" in verification output)`
              : `Operation may have failed. Exit code: ${opResult.exitCode}. Verification: ${verified ? "passed" : "FAILED - expected '" + expect + "' not found"}`,
          }, null, 2),
        }],
      };
    },
  }, { optional: false });
}
