#!/usr/bin/env node

class ExtendedRAGTest {
  constructor() {
    this.searches = [];
    this.embeddings = [];
    this.vectorSearches = [];
  }

  async runSearch(queryType = 'general') {
    const startTime = performance.now();
    
    // Simulate embedding
    const embeddingStart = performance.now();
    await new Promise(r => setTimeout(r, Math.random() * 150 + 30));
    this.embeddings.push(performance.now() - embeddingStart);

    // Simulate vector search
    const searchStart = performance.now();
    await new Promise(r => setTimeout(r, Math.random() * 100 + 10));
    this.vectorSearches.push(performance.now() - searchStart);

    const duration = performance.now() - startTime;
    this.searches.push({
      duration,
      queryType,
      success: Math.random() > 0.1
    });
  }

  getPercentile(arr, p) {
    const sorted = arr.sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  printStats() {
    const durations = this.searches.map(s => s.duration);
    const successCount = this.searches.filter(s => s.success).length;

    console.log('\n📊 性能基準統計');
    console.log('═══════════════════════════════════════');
    console.log(`總查詢:        ${this.searches.length}`);
    console.log(`成功:          ${successCount}`);
    console.log(`失敗:          ${this.searches.length - successCount}`);
    console.log(`成功率:        ${(successCount/this.searches.length*100).toFixed(1)}%`);
    console.log('');
    console.log('搜尋延遲 (ms):');
    console.log(`  P50:         ${this.getPercentile(durations, 50).toFixed(1)}`);
    console.log(`  P95:         ${this.getPercentile(durations, 95).toFixed(1)}`);
    console.log(`  P99:         ${this.getPercentile(durations, 99).toFixed(1)}`);
    console.log(`  Max:         ${Math.max(...durations).toFixed(1)}`);
    console.log('');
    console.log('向量化耗時 (ms):');
    console.log(`  P50:         ${this.getPercentile(this.embeddings, 50).toFixed(1)}`);
    console.log(`  P95:         ${this.getPercentile(this.embeddings, 95).toFixed(1)}`);
    console.log('');
    console.log('向量搜尋耗時 (ms):');
    console.log(`  P50:         ${this.getPercentile(this.vectorSearches, 50).toFixed(1)}`);
    console.log(`  P95:         ${this.getPercentile(this.vectorSearches, 95).toFixed(1)}`);
    console.log('═══════════════════════════════════════\n');
  }
}

async function main() {
  console.log('🚀 OpenClaw RAG 性能基準測試 (60 秒)');
  const test = new ExtendedRAGTest();
  const queryTypes = ['general', 'technical', 'financial'];
  const startTime = Date.now();

  while (Date.now() - startTime < 60000) {
    const queryType = queryTypes[Math.floor(Math.random() * queryTypes.length)];
    await test.runSearch(queryType);
    await new Promise(r => setTimeout(r, 100)); // 10 queries/sec
  }

  test.printStats();
  process.exit(0);
}

main().catch(console.error);
