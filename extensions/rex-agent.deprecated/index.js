import { createRexTools, systemPrompt } from "./src/tools.js";

// Export as OpenClaw plugin
export default {
  id: "rex-agent",
  name: "Rex Agent Tools",
  
  // Register agent tools with OpenClaw
  getAgentTools() {
    return createRexTools();
  },
  
  // System prompt for Rex agent
  getSystemPrompt() {
    return systemPrompt;
  },
  
  // Plugin lifecycle (if OpenClaw calls this)
  async register(api) {
    if (api && typeof api.registerAgentTool === "function") {
      const tools = createRexTools();
      tools.forEach((tool) => api.registerAgentTool(tool));
      console.log("[rex-agent] Registered", tools.length, "tools");
    } else {
      console.log("[rex-agent] OpenClaw API does not support registerAgentTool");
      console.log("[rex-agent] Tools available via getAgentTools()");
    }
  },
};
