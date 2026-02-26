/**
 * ExecutionPolicy — Authority Model for OpenClaw Agents
 *
 * Defines operational boundaries and execution permissions.
 * Allows Claude agent to understand its own authority limits.
 *
 * Problem being solved:
 * - Agent's world-model (認知) 不符合實際能力 (技術層)
 * - Result: Agent says "needs approval" even though system auto-executes
 * - Solution: Explicit ExecutionPolicy layer for agent transparency
 *
 * Design:
 * - Policy categories: auto, verify, guarded, deny
 * - Operation classification: read, execute, deploy, config, io
 * - Agent awareness: Agent can query its own permissions
 */

export type ExecutionCategory = "read" | "execute" | "deploy" | "config" | "io";
export type AuthorityLevel = "auto" | "verify" | "guarded" | "deny";

export interface ExecutionOperation {
  category: ExecutionCategory;
  action: string;
  description: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  example: string;
}

export interface ExecutionPolicyRule {
  category: ExecutionCategory;
  actions?: string[] | RegExp;
  authority: AuthorityLevel;
  reason: string;
  overrides?: Record<string, AuthorityLevel>;
}

/**
 * Default execution policy for Claude agents in OpenClaw
 *
 * Policy Philosophy:
 * - Bounded Autonomy: Pre-authorized actions execute automatically
 * - Explicit Boundaries: Agent knows what requires verification
 * - No Censorship: Don't suppress "approval" language, fix the model
 * - Safety by Design: System boundaries, not agent restrictions
 */
export const DEFAULT_EXECUTION_POLICY: ExecutionPolicyRule[] = [
  // ============ READ Operations (Safe, Auto) ============
  {
    category: "read",
    actions: ["ls", "cat", "grep", "find", "git", "stat"],
    authority: "auto",
    reason: "Read operations are observational, non-destructive",
    overrides: {
      "read:sensitive_files": "verify", // .env, secrets, private keys
      "read:system_config": "verify",
    },
  },

  // ============ EXECUTE Operations (Shell Commands) ============
  {
    category: "execute",
    actions: ["bash", "sh", "node", "python", "make"],
    authority: "auto",
    reason: "Pre-authorized CLI tools for development workflows",
    overrides: {
      "execute:sudo": "deny", // Never auto-sudo without explicit approval
      "execute:reboot": "guarded",
      "execute:rm": "verify", // Delete requires verification
    },
  },

  // ============ DEPLOY Operations (Docker, Systemd) ============
  {
    category: "deploy",
    actions: ["docker", "docker-compose", "launchctl", "systemctl", "kubectl"],
    authority: "auto",
    reason: "Deploy operations are part of standard DevOps workflow",
    overrides: {
      "deploy:destroy": "verify", // Destroying resources needs verification
      "deploy:force_shutdown": "guarded",
      "deploy:production": "verify", // Production changes require approval
    },
  },

  // ============ CONFIG Operations (Settings, Environment) ============
  {
    category: "config",
    actions: ["export", "setenv", "git config", "npm config"],
    authority: "guarded",
    reason: "Config changes affect system behavior, require awareness",
    overrides: {
      "config:api_key": "verify", // Changing API keys needs verification
      "config:production_secrets": "deny",
      "config:local_development": "auto",
    },
  },

  // ============ IO Operations (Filesystem, Network) ============
  {
    category: "io",
    actions: ["cp", "mv", "rm", "mkdir", "rmdir", "chmod"],
    authority: "verify",
    reason: "IO operations modify filesystem state, need verification",
    overrides: {
      "io:backup": "auto", // Creating backups is safe
      "io:temp_cleanup": "auto",
      "io:delete_home": "deny", // Deleting home directory is critical
      "io:delete_system": "deny",
    },
  },
];

/**
 * Evaluates an operation against execution policy
 */
export function evaluateExecution(
  category: ExecutionCategory,
  action: string,
  context?: Record<string, unknown>,
): AuthorityLevel {
  const rule = DEFAULT_EXECUTION_POLICY.find(
    (r) =>
      r.category === category &&
      (r.actions === undefined ||
        (Array.isArray(r.actions) && r.actions.includes(action)) ||
        (r.actions instanceof RegExp && r.actions.test(action))),
  );

  if (!rule) {
    return "guarded"; // Default to guarded if no matching rule
  }

  // Check for context-specific overrides
  if (context && rule.overrides) {
    for (const [contextKey, level] of Object.entries(rule.overrides)) {
      if (contextKey === `${category}:${action}`) {
        return level;
      }
    }
  }

  return rule.authority;
}

/**
 * Describes what an agent can do (for agent awareness)
 *
 * Usage: Agent can call this to understand its own boundaries
 */
export function describeExecutionAuthority(): string {
  return `
OpenClaw Execution Authority Model
===================================

Autonomy Level: Bounded (Pre-authorized actions auto-execute)

AUTO EXECUTE (No verification needed):
  ✓ Read operations (ls, cat, grep, find, git, stat)
  ✓ Standard CLI tools (bash, sh, node, python, make)
  ✓ Deploy tools (docker, docker-compose, launchctl, systemctl)
  ✓ Backup operations (cp, mkdir for backup dirs)
  ✓ Local development config (npm config, git config local)

REQUIRES VERIFICATION:
  ⚠ Delete operations (rm, rmdir) — must confirm intent
  ⚠ IO operations on critical paths (home, system dirs)
  ⚠ Production deployments — requires explicit approval
  ⚠ API key/secret configuration changes
  ⚠ Destructive deploy operations

DENIED (No execution):
  ✗ Sudo commands without authorization
  ✗ Production secrets modification
  ✗ Deleting home/system directories
  ✗ Force shutdown operations

Authority Model:
- "auto": Execute immediately, no approval needed
- "verify": Ask user for confirmation
- "guarded": Requires explicit authorization
- "deny": Cannot execute under any circumstances

Decision Rule:
When in doubt about authority, err on "guarded" side.
Better to ask than to make unintended changes.
`;
}

/**
 * Returns permission summary for agent (to fix Authority Model Drift)
 *
 * Usage: Agent calls this to ground itself in reality
 *        ("I can auto-execute these operations")
 */
export function getAgentPermissionSummary(): Record<string, string> {
  return {
    reads: "✓ Auto-execute (ls, cat, grep, find, git, stat)",
    executes: "✓ Auto-execute (bash, sh, node, python, make) — except sudo",
    deploys: "✓ Auto-execute (docker, docker-compose, launchctl, systemctl)",
    backups: "✓ Auto-execute (cp, mkdir for backup operations)",
    deletes: "⚠ Requires verification (rm, rmdir on filesystem)",
    config: "⚠ Guarded (api-key, secrets) | Auto (local-dev config)",
    production: "⚠ Requires explicit approval for production changes",
    critical: "✗ Denied (sudo, delete home/system, production secrets)",
  };
}
