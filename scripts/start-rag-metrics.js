#!/usr/bin/env node

/**
 * OpenClaw RAG Metrics Exporter Startup Script
 * Starts the Prometheus metrics exporter for RAG performance monitoring
 *
 * Usage:
 *   node start-rag-metrics.js
 *
 * Environment Variables:
 *   - PORT: Exporter port (default: 9091)
 *   - HOST: Exporter host (default: 127.0.0.1)
 *   - LOG_DIR: Log directory (default: logs)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// Configuration
const PORT = process.env.PORT || 9091;
const HOST = process.env.HOST || '127.0.0.1';
const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, 'logs');
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

// Mock Prometheus registry (simplified for now)
class SimplePrometheusRegistry {
  constructor() {
    this.metrics = {
      'rag_search_duration_ms_bucket{le="10"}': '0',
      'rag_search_duration_ms_bucket{le="50"}': '0',
      'rag_search_duration_ms_bucket{le="100"}': '0',
      'rag_search_duration_ms_bucket{le="500"}': '0',
      'rag_search_duration_ms_bucket{le="1000"}': '0',
      'rag_search_duration_ms_bucket{le="2000"}': '0',
      'rag_search_duration_ms_bucket{le="5000"}': '0',
      'rag_search_duration_ms_bucket{le="+Inf"}': '0',
      'rag_search_duration_ms_count': '0',
      'rag_search_duration_ms_sum': '0',
      'rag_search_success_total{query_type="general",result_count="0",success="false"}': '0',
      'rag_search_success_total{query_type="general",result_count="0",success="true"}': '0',
      'rag_index_size_bytes': '0',
      'rag_index_vector_count': '0',
      'rag_embedding_time_ms_bucket{model_type="default",le="10"}': '0',
      'rag_embedding_time_ms_bucket{model_type="default",le="50"}': '0',
      'rag_embedding_time_ms_bucket{model_type="default",le="100"}': '0',
      'rag_embedding_time_ms_bucket{model_type="default",le="500"}': '0',
      'rag_embedding_time_ms_bucket{model_type="default",le="1000"}': '0',
      'rag_embedding_time_ms_bucket{model_type="default",le="2000"}': '0',
      'rag_embedding_time_ms_bucket{model_type="default",le="+Inf"}': '0',
      'rag_embedding_time_ms_count{model_type="default"}': '0',
      'rag_embedding_time_ms_sum{model_type="default"}': '0',
      'rag_vector_search_time_ms_bucket{k="5",search_type="default",le="5"}': '0',
      'rag_vector_search_time_ms_bucket{k="5",search_type="default",le="20"}': '0',
      'rag_vector_search_time_ms_bucket{k="5",search_type="default",le="50"}': '0',
      'rag_vector_search_time_ms_bucket{k="5",search_type="default",le="100"}': '0',
      'rag_vector_search_time_ms_bucket{k="5",search_type="default",le="500"}': '0',
      'rag_vector_search_time_ms_bucket{k="5",search_type="default",le="1000"}': '0',
      'rag_vector_search_time_ms_bucket{k="5",search_type="default",le="+Inf"}': '0',
      'rag_vector_search_time_ms_count{k="5",search_type="default"}': '0',
      'rag_vector_search_time_ms_sum{k="5",search_type="default"}': '0',
      'process_cpu_seconds_total': (process.cpuUsage().user / 1000000).toFixed(2),
      'process_resident_memory_bytes': process.memoryUsage().rss.toString(),
      'process_uptime_seconds': process.uptime().toFixed(0)
    };
    this.contentType = 'text/plain; version=0.0.4; charset=utf-8';
  }

  metrics() {
    let output = '# HELP rag_search_duration_ms Duration of RAG search in milliseconds\n';
    output += '# TYPE rag_search_duration_ms histogram\n';
    Object.entries(this.metrics).forEach(([key, value]) => {
      if (key.startsWith('rag_') || key.startsWith('process_')) {
        output += `${key} ${value}\n`;
      }
    });
    return output;
  }
}

const registry = new SimplePrometheusRegistry();

// HTTP Server
const server = http.createServer((req, res) => {
  const url = req.url || '/';

  if (url === '/metrics' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': registry.contentType });
    res.end(registry.metrics());
    log('Metrics endpoint called');
  } else if (url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      port: PORT,
      host: HOST
    }));
  } else if (url === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      name: 'OpenClaw RAG Metrics Exporter',
      version: '1.0.0',
      endpoints: {
        metrics: 'GET /metrics - Prometheus metrics',
        health: 'GET /health - Health check',
        info: 'GET / - This message'
      }
    }));
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found', path: url }));
  }
});

// Start server
server.listen(PORT, HOST, () => {
  log(`✅ RAG Metrics Exporter started on http://${HOST}:${PORT}/metrics`);
  log(`   Health check: http://${HOST}:${PORT}/health`);
  log(`   Process ID: ${process.pid}`);
  log(`   Node version: ${process.version}`);
});

// Error handling
server.on('error', (err) => {
  log(`❌ Server error: ${err.message}`);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  log('⚠️  Received SIGTERM, shutting down gracefully...');
  server.close(() => {
    log('✅ Server closed');
    process.exit(0);
  });
  setTimeout(() => {
    log('❌ Forced shutdown after 5 seconds');
    process.exit(1);
  }, 5000);
});

process.on('SIGINT', () => {
  log('⚠️  Received SIGINT, shutting down gracefully...');
  server.close(() => {
    log('✅ Server closed');
    process.exit(0);
  });
});

process.on('uncaughtException', (err) => {
  log(`❌ Uncaught exception: ${err.message}`);
  log(err.stack);
  process.exit(1);
});

log('OpenClaw RAG Metrics Exporter initialized');
