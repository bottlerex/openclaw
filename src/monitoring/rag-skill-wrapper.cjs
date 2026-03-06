// RAG Performance Monitoring Skill Wrapper for OpenClaw (CommonJS version)
// Integrates with Prometheus exporter via HTTP

const http = require('http');

const EXPORTER_HOST = 'localhost';
const EXPORTER_PORT = 9091;

// Map skill names to RAG query types
const skillToQueryType = {
  web_search: 'general',
  google_workspace: 'email',
  data_analysis: 'financial'
};

function mapSkillToQueryType(skillName) {
  return skillToQueryType[skillName] || 'general';
}

function extractQuery(skillName, params) {
  return params?.query || params?.description || params?.task || `[${skillName} query]`;
}

function countResults(skillName, result) {
  if (Array.isArray(result?.result?.data)) return result.result.data.length;
  if (Array.isArray(result?.data)) return result.data.length;
  if (result?.result?.content) return 1;
  return 0;
}

function estimateRelevance(skillName, result) {
  const count = countResults(skillName, result);
  return count > 0 ? Math.min(0.95, 0.7 + count * 0.05) : 0.0;
}

// Call Prometheus exporter to record metrics
function recordRAGMetric(queryType, duration, success) {
  try {
    const data = JSON.stringify({ queryType, duration, success });
    const opts = {
      hostname: EXPORTER_HOST,
      port: EXPORTER_PORT,
      path: '/api/rag/search',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 2000
    };

    const req = http.request(opts, (res) => {
      // Fire and forget - don't block on metrics
      res.on('data', () => {});
    });
    req.on('error', () => {});
    req.write(data);
    req.end();
  } catch (e) {
    // Silently fail metrics recording - don't interrupt skill execution
  }
}

async function createMonitoredSkillCall(skillName, params, originalCallSkill) {
  const queryType = mapSkillToQueryType(skillName);
  const query = extractQuery(skillName, params);
  const startTime = Date.now();

  try {
    const result = await originalCallSkill(skillName, params);
    const duration = Date.now() - startTime;
    
    // Record metrics asynchronously
    recordRAGMetric(queryType, duration, true);
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    recordRAGMetric(queryType, duration, false);
    throw error;
  }
}

module.exports = {
  createMonitoredSkillCall
};
