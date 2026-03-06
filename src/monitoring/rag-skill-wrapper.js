// RAG Performance Monitoring Skill Wrapper for OpenClaw
// Integration: Replace callSkill() calls in tool-wrapper-proxy.js

import { ragMonitor } from './rag-monitor.js';

export async function createMonitoredSkillCall(skillName, params, originalCallSkill) {
  const queryType = mapSkillToQueryType(skillName);
  if (!queryType) return originalCallSkill(skillName, params);

  const query = extractQuery(skillName, params);
  const topK = params?.max_results || 5;
  const startTime = Date.now();

  try {
    const result = await originalCallSkill(skillName, params);
    const duration = Date.now() - startTime;
    const resultCount = countResults(skillName, result);
    const relevanceScore = estimateRelevance(skillName, result);

    await ragMonitor.recordSearch({
      queryType, query, topK, duration,
      success: true, resultCount, relevanceScore
    });
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    await ragMonitor.recordSearch({
      queryType, query, topK, duration,
      success: false, error: error.message
    });
    throw error;
  }
}

function mapSkillToQueryType(skillName) {
  const typeMap = {
    web_search: 'general',
    google_workspace: 'email',
    data_analysis: 'financial'
  };
  return typeMap[skillName];
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

export { ragMonitor };
