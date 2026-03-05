/**
 * Unified Logger - TypeScript/Node.js Implementation
 * 用於 OpenClaw + 其他 TypeScript 項目
 *
 * 支持 INFO / WARNING / ERROR / DEBUG 四層級
 * 本地文件系統存儲 + JSON 導出
 */

import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

enum LogLevel {
  INFO = 'INFO',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  DEBUG = 'DEBUG',
}

interface LogContext {
  [key: string]: any;
}

interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  module?: string;
  operation?: string;
  message: string;
  context?: LogContext;
  createdAt: string;
}

interface LoggerConfig {
  project: string;
  logsDir?: string;
  enableConsole?: boolean;
  enableFile?: boolean;
  fileFormat?: 'jsonl' | 'json'; // jsonl = JSON Lines (append), json = single file
}

interface LogStats {
  totalLogs: number;
  byLevel: Record<string, number>;
  latestTimestamp?: string;
  filePath: string;
}

/**
 * Unified Logger for TypeScript/Node.js
 *
 * 用途:
 * - OpenClaw: P0.1-P0.3 驗證碼、登入、診斷日誌
 * - 其他 TS 項目: API 調用、操作日誌
 *
 * 存儲: JSONL (JSON Lines) + 可選本地 JSON 文件
 */
export class UnifiedLogger {
  private project: string;
  private logsDir: string;
  private logFile: string;
  private enableConsole: boolean;
  private enableFile: boolean;
  private fileFormat: 'jsonl' | 'json';
  private logBuffer: LogEntry[] = [];
  private mutex: Promise<void> = Promise.resolve();

  constructor(config: LoggerConfig) {
    this.project = config.project;
    this.enableConsole = config.enableConsole !== false;
    this.enableFile = config.enableFile !== false;
    this.fileFormat = config.fileFormat || 'jsonl';

    // 設置日誌目錄
    if (config.logsDir) {
      this.logsDir = config.logsDir;
    } else {
      const homeDir = process.env.HOME || process.env.USERPROFILE || '';
      this.logsDir = path.join(homeDir, '.claude', 'logs');
    }

    // 建立日誌目錄
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }

    // 日誌文件路徑
    this.logFile = path.join(
      this.logsDir,
      `${this.project}.${this.fileFormat}`
    );
  }

  /**
   * 級別 1: INFO - 正常操作
   */
  info(
    message: string,
    context?: LogContext,
    options?: { module?: string; operation?: string }
  ): void {
    this.log(LogLevel.INFO, message, context, options);
  }

  /**
   * 級別 2: WARNING - 降級/重試
   */
  warning(
    message: string,
    context?: LogContext,
    options?: { module?: string; operation?: string }
  ): void {
    this.log(LogLevel.WARNING, message, context, options);
  }

  /**
   * 級別 3: ERROR - 故障
   */
  error(
    message: string,
    context?: LogContext,
    options?: { module?: string; operation?: string }
  ): void {
    this.log(LogLevel.ERROR, message, context, options);
  }

  /**
   * 級別 4: DEBUG - 詳細追蹤
   */
  debug(
    message: string,
    context?: LogContext,
    options?: { module?: string; operation?: string }
  ): void {
    this.log(LogLevel.DEBUG, message, context, options);
  }

  /**
   * 內部日誌記錄邏輯
   */
  private log(
    level: LogLevel,
    message: string,
    context?: LogContext,
    options?: { module?: string; operation?: string }
  ): void {
    const entry: LogEntry = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      level,
      message,
      module: options?.module,
      operation: options?.operation,
      context,
      createdAt: new Date().toISOString(),
    };

    // 控制台輸出
    if (this.enableConsole) {
      this.logToConsole(entry);
    }

    // 文件存儲 (異步，不阻塞)
    if (this.enableFile) {
      this.logToFile(entry).catch(err => {
        console.error(`Failed to write log to file: ${err.message}`);
      });
    }
  }

  /**
   * 控制台輸出
   */
  private logToConsole(entry: LogEntry): void {
    const colorCodes: Record<LogLevel, string> = {
      [LogLevel.INFO]: '\x1b[36m', // Cyan
      [LogLevel.WARNING]: '\x1b[33m', // Yellow
      [LogLevel.ERROR]: '\x1b[31m', // Red
      [LogLevel.DEBUG]: '\x1b[35m', // Magenta
    };

    const reset = '\x1b[0m';
    const color = colorCodes[entry.level];

    let output = `${color}[${entry.timestamp}] [${entry.level}]${reset}`;

    if (entry.module) {
      output += ` [${entry.module}]`;
    }

    output += ` ${entry.message}`;

    if (entry.context) {
      output += ` | ${JSON.stringify(entry.context)}`;
    }

    console.log(output);
  }

  /**
   * 文件存儲 (thread-safe via mutex)
   */
  private async logToFile(entry: LogEntry): Promise<void> {
    // 簡單的 mutex 實現
    await new Promise<void>(resolve => {
      this.mutex = this.mutex.then(async () => {
        try {
          if (this.fileFormat === 'jsonl') {
            // JSONL 格式: 每行一個 JSON 對象
            const line = JSON.stringify(entry) + '\n';
            await promisify(fs.appendFile)(this.logFile, line);
          } else {
            // JSON 格式: 整個數組
            const existingLogs = this.readLogsSync();
            existingLogs.push(entry);
            await promisify(fs.writeFile)(
              this.logFile,
              JSON.stringify(existingLogs, null, 2)
            );
          }
        } catch (err) {
          console.error(`Failed to write log: ${err}`);
        }
        resolve();
      });
    });
  }

  /**
   * 同步讀取日誌 (用於查詢)
   */
  private readLogsSync(): LogEntry[] {
    if (!fs.existsSync(this.logFile)) {
      return [];
    }

    try {
      if (this.fileFormat === 'jsonl') {
        const content = fs.readFileSync(this.logFile, 'utf-8');
        return content
          .split('\n')
          .filter(line => line.trim())
          .map(line => JSON.parse(line));
      } else {
        const content = fs.readFileSync(this.logFile, 'utf-8');
        return JSON.parse(content);
      }
    } catch (err) {
      console.error(`Failed to read logs: ${err}`);
      return [];
    }
  }

  /**
   * 查詢日誌
   */
  query(options?: {
    level?: LogLevel;
    module?: string;
    startTime?: string;
    endTime?: string;
    limit?: number;
  }): LogEntry[] {
    const logs = this.readLogsSync();

    let filtered = logs;

    // 按級別過濾
    if (options?.level) {
      filtered = filtered.filter(log => log.level === options.level);
    }

    // 按模組過濾
    if (options?.module) {
      filtered = filtered.filter(log => log.module === options.module);
    }

    // 按時間範圍過濾
    if (options?.startTime) {
      filtered = filtered.filter(
        log => log.timestamp >= options.startTime!
      );
    }

    if (options?.endTime) {
      filtered = filtered.filter(log => log.timestamp <= options.endTime!);
    }

    // 排序 (最新的在前)
    filtered.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    // 限制數量
    const limit = options?.limit || 100;
    return filtered.slice(0, limit);
  }

  /**
   * 獲取統計信息
   */
  getStats(): LogStats {
    const logs = this.readLogsSync();

    const stats: LogStats = {
      totalLogs: logs.length,
      byLevel: {
        [LogLevel.INFO]: 0,
        [LogLevel.WARNING]: 0,
        [LogLevel.ERROR]: 0,
        [LogLevel.DEBUG]: 0,
      },
      filePath: this.logFile,
    };

    for (const log of logs) {
      stats.byLevel[log.level]++;
    }

    if (logs.length > 0) {
      stats.latestTimestamp = logs[logs.length - 1].timestamp;
    }

    return stats;
  }

  /**
   * 匯出為 JSON
   */
  exportJson(filePath: string): boolean {
    try {
      const logs = this.readLogsSync();
      fs.writeFileSync(filePath, JSON.stringify(logs, null, 2));
      return true;
    } catch (err) {
      console.error(`Export failed: ${err}`);
      return false;
    }
  }

  /**
   * 清理舊日誌 (早於指定天數)
   */
  clearOldLogs(days: number = 30): number {
    try {
      const logs = this.readLogsSync();
      const cutoffTime = new Date();
      cutoffTime.setDate(cutoffTime.getDate() - days);

      const filtered = logs.filter(
        log => new Date(log.timestamp) > cutoffTime
      );

      const removed = logs.length - filtered.length;

      if (this.fileFormat === 'jsonl') {
        // JSONL: 重寫文件
        fs.writeFileSync(
          this.logFile,
          filtered.map(log => JSON.stringify(log)).join('\n')
        );
      } else {
        // JSON: 寫入數組
        fs.writeFileSync(this.logFile, JSON.stringify(filtered, null, 2));
      }

      return removed;
    } catch (err) {
      console.error(`Clear old logs failed: ${err}`);
      return 0;
    }
  }

  /**
   * 生成日誌 ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// 全局 logger 實例
const loggers: Record<string, UnifiedLogger> = {};

/**
 * 獲取或創建項目的 logger 實例
 */
export function getLogger(project: string, config?: Partial<LoggerConfig>): UnifiedLogger {
  if (!loggers[project]) {
    loggers[project] = new UnifiedLogger({
      project,
      ...config,
    });
  }
  return loggers[project];
}

// 便捷函數 (全局使用)
let defaultLogger: UnifiedLogger | null = null;

export function initDefaultLogger(project: string): void {
  defaultLogger = getLogger(project);
}

export function info(
  message: string,
  context?: LogContext,
  options?: { module?: string; operation?: string }
): void {
  defaultLogger?.info(message, context, options);
}

export function warning(
  message: string,
  context?: LogContext,
  options?: { module?: string; operation?: string }
): void {
  defaultLogger?.warning(message, context, options);
}

export function error(
  message: string,
  context?: LogContext,
  options?: { module?: string; operation?: string }
): void {
  defaultLogger?.error(message, context, options);
}

export function debug(
  message: string,
  context?: LogContext,
  options?: { module?: string; operation?: string }
): void {
  defaultLogger?.debug(message, context, options);
}

export default UnifiedLogger;
