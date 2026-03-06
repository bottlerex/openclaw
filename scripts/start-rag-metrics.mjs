#!/usr/bin/env node

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const PORT = process.env.PORT || 9091;
const HOST = process.env.HOST || '127.0.0.1';
const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'prometheus-exporter.log');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function log(msg) {
  const timestamp = new Date().toISOString();
  const logMsg = `[${timestamp}] ${msg}`;
  console.log(logMsg);
  try {
    fs.appendFileSync(LOG_FILE, logMsg + '\n');
  } catch (e) {
    console.error('Failed to write to log file:', e.message);
  }
}

// Prometheus metrics registry
class PrometheusRegistry {
  constructor() {
    this.contentType = 'text/plain; version=0.0.4; charset=utf-8';
  }

  getMetrics() {
    const usage = process.memoryUsage();
    const uptime = process.uptime();

    let output = '';
    // Metric help text
    output += '# HELP rag_search_duration_ms Duration of RAG search in milliseconds\n';
    output += '# TYPE rag_search_duration_ms histogram\n';

    // Histogram buckets
    const buckets = ['10', '50', '100', '500', '1000', '2000', '5000', '+Inf'];
    let count = 0;
    buckets.forEach(bucket => {
      output += `rag_search_duration_ms_bucket{le="${bucket}"} ${count}\n`;
    });
    output += `rag_search_duration_ms_count ${count}\n`;
    output += `rag_search_duration_ms_sum 0\n`;

    // Search success counter
    output += '\n# HELP rag_search_success_total Total number of RAG search operations\n';
    output += '# TYPE rag_search_success_total counter\n';
    output += 'rag_search_success_total{query_type="general",result_count="0",success="true"} 0\n';
    output += 'rag_search_success_total{query_type="general",result_count="0",success="false"} 0\n';

    // Index metrics
    output += '\n# HELP rag_index_size_bytes Size of RAG index in bytes\n';
    output += '# TYPE rag_index_size_bytes gauge\n';
    output += 'rag_index_size_bytes 0\n';

    output += '\n# HELP rag_index_vector_count Number of vectors in RAG index\n';
    output += '# TYPE rag_index_vector_count gauge\n';
    output += 'rag_index_vector_count 0\n';

    // Embedding time
    output += '\n# HELP rag_embedding_time_ms Duration of embedding process\n';
    output += '# TYPE rag_embedding_time_ms histogram\n';
    buckets.forEach(bucket => {
      output += `rag_embedding_time_ms_bucket{model_type="default",le="${bucket}"} 0\n`;
    });
    output += 'rag_embedding_time_ms_count{model_type="default"} 0\n';
    output += 'rag_embedding_time_ms_sum{model_type="default"} 0\n';

    // Vector search time
    output += '\n# HELP rag_vector_search_time_ms Duration of vector search process\n';
    output += '# TYPE rag_vector_search_time_ms histogram\n';
    const searchBuckets = ['5', '20', '50', '100', '500', '1000', '+Inf'];
    searchBuckets.forEach(bucket => {
      output += `rag_vector_search_time_ms_bucket{k="5",search_type="default",le="${bucket}"} 0\n`;
    });
    output += 'rag_vector_search_time_ms_count{k="5",search_type="default"} 0\n';
    output += 'rag_vector_search_time_ms_sum{k="5",search_type="default"} 0\n';

    // Process metrics
    output += '\n# HELP process_resident_memory_bytes Process resident memory\n';
    output += '# TYPE process_resident_memory_bytes gauge\n';
    output += `process_resident_memory_bytes ${usage.rss}\n`;

    output += '\n# HELP process_uptime_seconds Process uptime\n';
    output += '# TYPE process_uptime_seconds counter\n';
    output += `process_uptime_seconds ${uptime.toFixed(0)}\n`;

    return output;
  }
}

const registry = new PrometheusRegistry();

// HTTP Server
const server = http.createServer((req, res) => {
  const url = req.url || '/';
  const method = req.method || 'GET';

  try {
    if (url === '/metrics' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': registry.contentType });
      res.end(registry.getMetrics());
      log('Metrics endpoint accessed');
    } else if (url === '/health' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        uptime: process.uptime().toFixed(1),
        timestamp: new Date().toISOString(),
        port: PORT,
        host: HOST,
        memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
      }));
      log('Health check accessed');
    } else if (url === '/' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        name: 'OpenClaw RAG Metrics Exporter',
        version: '1.0.0',
        status: 'running',
        endpoints: {
          metrics: 'GET /metrics',
          health: 'GET /health',
          info: 'GET /'
        }
      }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found', path: url }));
    }
  } catch (err) {
    log(`Error handling request: ${err.message}`);
    res.writeHead(500);
    res.end('Internal Server Error');
  }
});

// Start server
server.listen(PORT, HOST, () => {
  log(`✅ RAG Metrics Exporter started`);
  log(`   Metrics: http://${HOST}:${PORT}/metrics`);
  log(`   Health: http://${HOST}:${PORT}/health`);
  log(`   PID: ${process.pid}`);
  log(`   Ready for Prometheus scraping`);
});

server.on('error', (err) => {
  log(`Server error: ${err.message}`);
  process.exit(1);
});

process.on('SIGTERM', () => {
  log('Received SIGTERM, shutting down...');
  server.close(() => {
    log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  log('Received SIGINT, shutting down...');
  server.close(() => {
    log('Server closed');
    process.exit(0);
  });
});

log('OpenClaw RAG Metrics Exporter initialized');
