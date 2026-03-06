import * as http from 'http';
import { register } from 'prom-client';
import * as fs from 'fs';

const PORT = 9091;
const HOST = '127.0.0.1';
const LOG_FILE = '/Users/rexmacmini/openclaw/logs/prometheus-exporter.log';

// Ensure log directory exists
const logDir = '/Users/rexmacmini/openclaw/logs';
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

function log(msg: string) {
  const timestamp = new Date().toISOString();
  const logMsg = `[${timestamp}] ${msg}`;
  console.log(logMsg);
  fs.appendFileSync(LOG_FILE, logMsg + '\n');
}

/**
 * Prometheus HTTP Exporter
 * Exports metrics in Prometheus text format
 */
export class PrometheusExporter {
  private server: http.Server;
  private isRunning: boolean = false;

  constructor() {
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  /**
   * Handle incoming HTTP requests
   */
  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!req.url) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    // Health check endpoint
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
          port: PORT,
          host: HOST
        })
      );
      return;
    }

    // Prometheus metrics endpoint
    if (url.pathname === '/metrics') {
      try {
        res.writeHead(200, { 'Content-Type': register.contentType });
        register.metrics().then(metrics => {
          res.end(metrics);
          log(`Metrics scraped: ${metrics.split('\n').length - 1} lines`);
        });
      } catch (error) {
        log(`Error generating metrics: ${error}`);
        res.writeHead(500);
        res.end('Internal Server Error');
      }
      return;
    }

    // Root endpoint - provide API documentation
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          name: 'OpenClaw Prometheus Exporter',
          version: '1.0.0',
          endpoints: {
            metrics: 'GET /metrics - Prometheus metrics in text format',
            health: 'GET /health - Health check',
            api: 'GET / - This message'
          }
        })
      );
      return;
    }

    // 404 for unknown paths
    res.writeHead(404);
    res.end(
      JSON.stringify({
        error: 'Not Found',
        message: `Unknown endpoint: ${url.pathname}`,
        availableEndpoints: ['/metrics', '/health', '/']
      })
    );
  }

  /**
   * Start the exporter server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server.listen(PORT, HOST, () => {
          this.isRunning = true;
          log(`Prometheus exporter started on http://${HOST}:${PORT}/metrics`);
          resolve();
        });

        this.server.on('error', (error: Error) => {
          log(`Server error: ${error.message}`);
          reject(error);
        });
      } catch (error) {
        log(`Failed to start exporter: ${error}`);
        reject(error);
      }
    });
  }

  /**
   * Stop the exporter server
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.isRunning) {
        resolve();
        return;
      }

      this.server.close(() => {
        this.isRunning = false;
        log('Prometheus exporter stopped');
        resolve();
      });

      setTimeout(() => {
        log('Warning: Exporter did not stop gracefully within 5 seconds');
        reject(new Error('Exporter shutdown timeout'));
      }, 5000);
    });
  }

  /**
   * Check if exporter is running
   */
  isActive(): boolean {
    return this.isRunning;
  }
}

// Singleton instance
export const exporter = new PrometheusExporter();

// Auto-start if running directly
if (require.main === module) {
  exporter.start().catch(error => {
    console.error('Failed to start exporter:', error);
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    log('Received SIGTERM, shutting down gracefully...');
    await exporter.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    log('Received SIGINT, shutting down gracefully...');
    await exporter.stop();
    process.exit(0);
  });
}
