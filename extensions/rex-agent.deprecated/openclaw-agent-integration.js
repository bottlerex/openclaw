/**
 * OpenClaw Agent Integration for Rex-Agent Tools
 * 
 * This module integrates rex-agent tools into OpenClaw's main agent
 * by providing tool definitions and system prompt injection.
 */

import { createRexTools, systemPrompt as rexSystemPrompt } from './src/tools.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Integration strategy for OpenClaw:
 * 
 * 1. Agent-level: Add to system prompt (immediate)
 * 2. Plugin-level: Register via plugin API (auto-discovery)
 * 3. Config-level: Update agent config files (persistent)
 */

export class RexAgentIntegrator {
  constructor() {
    this.tools = createRexTools();
    this.agentConfigPath = '/Users/rexmacmini/openclaw/config/agents/main/agent';
  }

  /**
   * Get tool definitions for agent registration
   */
  getTools() {
    return this.tools;
  }

  /**
   * Get enriched system prompt with rex-agent capabilities
   */
  getSystemPrompt() {
    return `${rexSystemPrompt}

Additional Capabilities (REX-AGENT):
You have access to three specialized tools:

1. run_command(command, cwd?)
   - Execute shell commands on Mac mini
   - Examples: docker ps, git status, ls -la /Users/rexmacmini/
   - Safety: 12 dangerous patterns blocked
   
2. analyze_code(question, file_path?)
   - Analyze code using Gemini 2.5 Flash
   - Examples: Review this function, Explain the architecture
   
3. dev_task(task, project?)
   - Dispatch complex development work to Claude
   - Examples: Add error handling, Fix the bug, Refactor the auth system

When to use:
- System/status questions → run_command
- Code understanding → analyze_code
- Implementation work → dev_task`;
  }

  /**
   * Strategy 1: Direct agent prompt injection (works immediately)
   */
  async injectSystemPrompt() {
    console.log('[rex-agent] Injecting system prompt into agent...');
    // This would be called by openclaw agent on startup
    return this.getSystemPrompt();
  }

  /**
   * Strategy 2: Register as OpenClaw plugin
   */
  async registerAsPlugin(api) {
    if (api && typeof api.registerAgentTool === 'function') {
      console.log('[rex-agent] Registering tools via plugin API...');
      this.tools.forEach(tool => {
        try {
          api.registerAgentTool(tool);
          console.log(`[rex-agent] Registered tool: ${tool.function.name}`);
        } catch (err) {
          console.error(`[rex-agent] Failed to register ${tool.function.name}: ${err.message}`);
        }
      });
      return true;
    }
    console.log('[rex-agent] Plugin API not available');
    return false;
  }

  /**
   * Strategy 3: Update agent configuration files
   */
  async updateAgentConfig() {
    console.log('[rex-agent] Updating agent configuration...');
    try {
      // Read current config
      const configFile = path.join(this.agentConfigPath, 'config.json');
      let config = {};
      
      try {
        const content = await fs.readFile(configFile, 'utf-8');
        config = JSON.parse(content);
      } catch {
        console.log('[rex-agent] Config file not found, creating new...');
      }

      // Add rex-agent tools to config
      if (!config.tools) {
        config.tools = [];
      }

      const rexToolNames = this.tools.map(t => t.function.name);
      config.tools = [...new Set([...config.tools, ...rexToolNames])];

      // Add system prompt
      config.systemPrompt = this.getSystemPrompt();

      // Write updated config
      await fs.writeFile(configFile, JSON.stringify(config, null, 2));
      console.log('[rex-agent] Agent config updated');
      return true;
    } catch (err) {
      console.error(`[rex-agent] Failed to update config: ${err.message}`);
      return false;
    }
  }

  /**
   * Health check: Verify all components are accessible
   */
  async healthCheck() {
    const results = {};

    // Check 1: mac-agentd
    try {
      const { execSync } = require('child_process');
      const output = execSync('pgrep -f mac-agentd.cjs').toString();
      results.macAgentd = output.length > 0 ? 'healthy' : 'not running';
    } catch {
      results.macAgentd = 'error';
    }

    // Check 2: Gemini API
    if (process.env.GEMINI_API_KEY) {
      results.geminiApi = 'configured';
    } else {
      results.geminiApi = 'not configured';
    }

    // Check 3: Session Bridge
    try {
      const fetch = (await import('node-fetch')).default;
      const res = await fetch('http://localhost:7788/health');
      results.sessionBridge = res.ok ? 'healthy' : 'unhealthy';
    } catch {
      results.sessionBridge = 'unavailable';
    }

    return results;
  }

  /**
   * Get integration status
   */
  getStatus() {
    return {
      toolsAvailable: this.tools.length,
      toolNames: this.tools.map(t => t.function.name),
      systemPromptLength: this.getSystemPrompt().length,
      configPath: this.agentConfigPath,
    };
  }
}

// Export singleton instance
export const integrator = new RexAgentIntegrator();

// CLI support
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];

  switch (command) {
    case 'status':
      console.log(JSON.stringify(integrator.getStatus(), null, 2));
      break;
    case 'health':
      integrator.healthCheck().then(h => console.log(JSON.stringify(h, null, 2)));
      break;
    case 'inject':
      console.log(integrator.getSystemPrompt());
      break;
    case 'register':
      console.log('[rex-agent] Use this to register with OpenClaw plugin API');
      console.log('Example: api.registerAgentTool(...). See index.js');
      break;
    default:
      console.log('Usage: node openclaw-agent-integration.js [status|health|inject|register]');
  }
}
