// OpenClaw Ollama Router — Ollama-first routing with model selection
// Default: qwen2.5-coder:7b (fast), @glm: glm-4.7-flash (powerful)

const http = require('http');

const OLLAMA_HOST = 'localhost';
const OLLAMA_PORT = 11434;
const OLLAMA_MODEL = 'qwen2.5-coder:7b';
const OLLAMA_MODEL_GLM = 'glm-4.7-flash';
const OLLAMA_TIMEOUT = 30000; // 30 seconds (7B model is fast, no need for 60s)

// ─── Stats ───────────────────────────────────────────────────────

const ollamaStats = {
  total: 0,
  success: 0,
  timeout: 0,
  error: 0,
  fallback: 0,
  qualityReject: 0,
  totalLatency: 0,
};

// ─── Force Model Detection ───────────────────────────────────────

function detectForceModel(userText) {
  if (!userText) return null;
  const lower = userText.toLowerCase();
  if (lower.includes('@opus')) return 'opus';
  if (lower.includes('@claude') || lower.includes('@haiku')) return 'claude';
  if (lower.includes('@glm')) return 'glm';       // GLM-4.7-Flash specifically
  if (lower.includes('@ollama')) return 'ollama';  // default Ollama model
  return null;
}

function stripForceDirective(userText) {
  return userText.replace(/@(?:claude|haiku|opus|ollama|glm)\b/gi, '').trim();
}

// ─── Quality Assessment ──────────────────────────────────────────

function assessQuality(response, userText) {
  if (!response || response.length < 5) return 0;

  let score = 0.8; // base score

  // Too short for a meaningful response
  if (response.length < 20) score -= 0.3;

  // Has structure (code blocks, lists)
  if (response.includes('```')) score += 0.1;
  if (response.includes('\n- ') || response.includes('\n1.')) score += 0.05;

  // Repetitive content detection
  const words = response.split(/\s+/);
  if (words.length > 20) {
    const uniqueRatio = new Set(words).size / words.length;
    if (uniqueRatio < 0.3) score -= 0.4; // very repetitive
  }

  // Truncated or incomplete
  if (response.endsWith('...') && response.length < 100) score -= 0.2;


  // Language mismatch: user wrote Chinese but response is mostly non-Chinese
  const hasChinese = (t) => /[一-鿿]/.test(t);
  if (userText && hasChinese(userText)) {
    const chineseChars = (response.match(/[一-鿿]/g) || []).length;
    const totalChars = response.replace(/\s/g, "").length;
    if (totalChars > 20 && chineseChars / totalChars < 0.1) {
      score -= 0.3; // response should contain Chinese if user asked in Chinese
    }
  }

  // Refuse/deflect detection (model says it cant help)
  const deflect = /i cannot|i can't|as an ai|i'm unable|i don't have/i;
  if (deflect.test(response) && response.length < 200) score -= 0.2;

  return Math.max(0, Math.min(1, score));
}

// ─── Ollama Chat ─────────────────────────────────────────────────

function tryOllamaChat(messages, options) {
  const model = (options && options.model) || OLLAMA_MODEL;
  const timeout = (options && options.timeout) || OLLAMA_TIMEOUT;

  return new Promise((resolve) => {
    const startTime = Date.now();
    ollamaStats.total++;

    const body = JSON.stringify({
      model: model,
      messages: messages,
      keep_alive: '1h',
      stream: false,
    });

    const opts = {
      hostname: OLLAMA_HOST,
      port: OLLAMA_PORT,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: timeout,
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        const latency = Date.now() - startTime;
        ollamaStats.totalLatency += latency;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.message?.content || '';

          if (!content) {
            ollamaStats.error++;
            resolve({ success: false, reason: 'empty_response', latency });
            return;
          }

          ollamaStats.success++;
          resolve({
            success: true,
            content: content,
            model: model,
            latency: latency,
            usage: parsed.usage || {},
          });
        } catch (e) {
          ollamaStats.error++;
          resolve({ success: false, reason: 'parse_error', error: e.message, latency });
        }
      });
    });

    req.on('error', (e) => {
      const latency = Date.now() - startTime;
      ollamaStats.error++;
      resolve({ success: false, reason: 'connection_error', error: e.message, latency });
    });

    req.on('timeout', () => {
      req.destroy();
      const latency = Date.now() - startTime;
      ollamaStats.timeout++;
      resolve({ success: false, reason: 'timeout', latency });
    });

    req.write(body);
    req.end();
  });
}

// ─── Model Selection Helper ──────────────────────────────────────

function getModelForForce(forceModel) {
  if (forceModel === 'glm') return { model: OLLAMA_MODEL_GLM, timeout: 60000 };
  return { model: OLLAMA_MODEL, timeout: OLLAMA_TIMEOUT };
}

// ─── Stats API ───────────────────────────────────────────────────

function getStats() {
  return {
    ...ollamaStats,
    defaultModel: OLLAMA_MODEL,
    glmModel: OLLAMA_MODEL_GLM,
    avgLatency: ollamaStats.total > 0
      ? Math.round(ollamaStats.totalLatency / ollamaStats.total)
      : 0,
    successRate: ollamaStats.total > 0
      ? ((ollamaStats.success / ollamaStats.total) * 100).toFixed(1) + '%'
      : 'N/A',
  };
}

module.exports = {
  tryOllamaChat,
  assessQuality,
  detectForceModel,
  stripForceDirective,
  getModelForForce,
  getStats,
  ollamaStats,
  OLLAMA_MODEL,
  OLLAMA_MODEL_GLM,
  OLLAMA_TIMEOUT,
};
