/**
 * OpenClaw Agent - RAG Monitoring Adapter
 *
 * 適配層，用於在 Agent 中集成 RAG 性能監控
 * 可用於任何使用向量搜尋或文檔檢索的地方
 */

import { ragMonitor } from './rag-monitor';
import { exporter } from './prometheus-exporter';

/**
 * RAG 搜尋包裝器 - 用於 Agent 工具執行
 */
export class AgentRAGAdapter {
  /**
   * 執行受監控的搜尋操作
   * @param searchFn 實際搜尋函數
   * @param queryType 查詢類型 (general, technical, financial, etc.)
   * @param query 搜尋查詢
   * @param topK 返回結果數量
   */
  static async executeSearch<T>(
    searchFn: (query: string, topK: number) => Promise<T>,
    queryType: string,
    query: string,
    topK: number = 5
  ): Promise<T> {
    try {
      // 執行監控的搜尋
      const result = await ragMonitor.search({
        queryType,
        query,
        topK
      });

      // 如果搜尋成功，執行實際的搜尋函數
      if (result.success) {
        return await searchFn(query, topK);
      } else {
        throw new Error(`RAG search failed: ${result.error}`);
      }
    } catch (error) {
      console.error('Agent RAG search error:', error);
      throw error;
    }
  }

  /**
   * 初始化 RAG 監控（在 Agent 啟動時調用）
   */
  static async initialize(): Promise<void> {
    try {
      // 啟動 Prometheus exporter
      await exporter.start();
      console.log('✅ RAG Monitor initialized');
      console.log('   Metrics: http://127.0.0.1:9091/metrics');
      console.log('   Health: http://127.0.0.1:9091/health');
    } catch (error) {
      console.error('Failed to initialize RAG monitor:', error);
      // 不阻止 Agent 啟動
    }
  }

  /**
   * 更新索引元數據（當 RAG 索引更新時調用）
   */
  static updateIndexMetadata(sizeBytes: number, vectorCount: number): void {
    ragMonitor.setIndexMetadata(sizeBytes, vectorCount);
  }

  /**
   * 取得監控統計
   */
  static async getMetrics(): Promise<string> {
    try {
      const response = await fetch('http://127.0.0.1:9091/metrics');
      return await response.text();
    } catch (error) {
      console.error('Failed to fetch metrics:', error);
      return '';
    }
  }
}

/**
 * 使用範例
 *
 * 在 Agent tool executor 中：
 *
 * async function executeSearchTool(params) {
 *   return await AgentRAGAdapter.executeSearch(
 *     async (query, topK) => {
 *       // 實際搜尋實現
 *       return await vectorDB.search(query, topK);
 *     },
 *     'general',           // queryType
 *     params.query,        // query
 *     params.topK || 5     // topK
 *   );
 * }
 *
 * 在 Agent 啟動時：
 *
 * async function initializeAgent() {
 *   await AgentRAGAdapter.initialize();
 *   // ... rest of initialization
 * }
 *
 * 更新索引大小：
 *
 * async function updateRAGIndex() {
 *   const stats = await vectorDB.getStats();
 *   AgentRAGAdapter.updateIndexMetadata(stats.sizeBytes, stats.vectorCount);
 * }
 */

// 導出 singleton 實例方便使用
export const agentRAG = AgentRAGAdapter;
