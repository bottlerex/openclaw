# OpenClaw P1 阶段完整规划 (3-6 个月)

**规划日期**: 2026-03-06
**阶段**: P1 (Performance & Observability)
**目标**: 从 P0 稳定性过渡到性能优化和可观测性
**工作量**: ~4.5 小时设计 + ~8-10 小时实施 = ~13-15 小时总投入

---

## I. P1 阶段概述

### 背景与动机

**现状** (P0 完成后):
- ✅ 系统稳定性: 99.5% SLA (0 stuck/409 conflicts)
- ✅ 基础架构: 完整的 6 层架构
- ⏳ 性能优化: 无基准，缺乏优化方向
- ⏳ 可观测性: 基础监控，缺乏深度分析

**P1 使命**:
将 OpenClaw 从「稳定运行」升级到「高性能、可观测、可优化」

### P1 的三大支柱

```
┌─────────────────────────────────────────┐
│  P1.1: RAG 性能监控 (1.5h, 低)         │ ← 数据层性能
├─────────────────────────────────────────┤
│  P1.2: Guardian 指标仪表板 (1h, 中)    │ ← 安全层可视化
├─────────────────────────────────────────┤
│  P1.3: 测试覆盖率提升 (2h, 中)         │ ← 质量保证
└─────────────────────────────────────────┘
     整合到 Prometheus/Grafana 生态
```

---

## II. P1.1: RAG 性能监控设计

### 2.1 需求分析

**为什么需要?**
- RAG 搜索是 Agent 关键路径（每个会话 3-5 次查询）
- 当前无任何延迟基准或性能告警
- 无法识别性能瓶颈（索引、搜索、向量化）

**目标**:
- 📊 搜索延迟分布（P50/P95/P99）
- 📊 索引大小和增长趋势
- 📊 搜索成功率和相关性评分
- 🚨 自动告警（搜索 > 1s，失败 > 5%）

### 2.2 实现设计

**数据采集点**:
```typescript
// RAG 搜索包装器
class MonitoredRAGSearch {
  async search(query: string, topK: number) {
    const startTime = performance.now();
    const result = await this.rag.search(query, topK);
    const duration = performance.now() - startTime;

    // Prometheus 指标
    metrics.rag_search_duration.observe(duration);
    metrics.rag_search_success.inc(result.success ? 1 : 0);
    metrics.rag_query_embedding_time.observe(result.embeddingTime);
    metrics.rag_vector_search_time.observe(result.searchTime);

    return result;
  }
}
```

**监控指标** (Prometheus):
```
rag_search_duration_ms (histogram)      // 搜索耗时
  - quantile: p50, p95, p99
  - labels: query_type, result_count

rag_search_success_total (counter)      // 成功/失败
  - labels: success, error_type

rag_index_size_bytes (gauge)            // 索引大小
rag_index_vector_count (gauge)          // 向量数量

rag_embedding_time_ms (histogram)       // 向量化耗时
rag_vector_search_time_ms (histogram)   // 搜索耗时
```

**告警规则** (AlertManager):
```
- RAG 搜索延迟 P95 > 1000ms → 预警
- RAG 搜索失败率 > 5% → 警告
- RAG 索引增长 > 100MB/day → 信息
```

**仪表板** (Grafana):
```
Panel 1: 搜索延迟分布 (P50/P95/P99)
Panel 2: 成功率趋势 (24h)
Panel 3: 索引大小增长曲线
Panel 4: Top 10 慢查询
Panel 5: 告警历史日志
```

### 2.3 实施计划

| 步骤 | 任务 | 耗时 | 关键文件 |
|------|------|------|---------|
| 1 | 设计指标和采集点 | 20min | rag-monitor.ts |
| 2 | 实现监控代码 | 30min | rag-monitor.ts |
| 3 | 添加 Prometheus 端点 | 15min | metrics-exporter.ts |
| 4 | 配置告警规则 | 15min | alerting-rules.yaml |
| 5 | 创建 Grafana 仪表板 | 20min | grafana-dashboard.json |

**验收标准**:
- ✅ 所有 RAG 查询被采集
- ✅ 指标导出到 Prometheus
- ✅ Grafana 仪表板可用
- ✅ 告警规则生效
- ✅ 1h 监控无告警

---

## III. P1.2: Guardian 指标仪表板设计

### 3.1 需求分析

**为什么需要?**
- Guardian 是 Agent 的「安全守卫」，但其工作不可见
- 无法判断 Guardian 是否正常工作
- 无法追踪异常检测和恢复的有效性

**目标**:
- 📊 每小时检查次数和耗时
- 📊 异常检测率和类型分布
- 📊 自动恢复成功率
- 📊 Guard breach 历史（24h）

### 3.2 实现设计

**数据采集点**:
```typescript
// Guardian 包装器
class MonitoredGuardian {
  async checkBoundary() {
    const startTime = performance.now();
    const result = await this.check();
    const duration = performance.now() - startTime;

    metrics.guardian_check_total.inc();
    metrics.guardian_check_duration_ms.observe(duration);

    if (result.breach) {
      metrics.guardian_breach_total.inc({ type: result.breachType });
      metrics.guardian_recovery_attempt.inc();

      const recovered = await this.recover();
      if (recovered) {
        metrics.guardian_recovery_success.inc();
      }
    }
  }
}
```

**监控指标**:
```
guardian_check_total (counter)          // 检查总数
guardian_check_duration_ms (histogram)  // 检查耗时
guardian_breach_total (counter)         // breach 计数
  - labels: breach_type (timeout, resource, logic, etc)
guardian_recovery_attempt_total (counter)
guardian_recovery_success_total (counter)
guardian_active_protections (gauge)     // 当前保护数
```

**仪表板** (Grafana):
```
Panel 1: Guardian 健康度评分 (checks/hour × success%)
Panel 2: Breach 类型分布 (饼图)
Panel 3: 恢复成功率 (趋势)
Panel 4: 最近 10 个 breaches (时间序列)
Panel 5: Guardian 响应时间 (P50/P95/P99)
```

### 3.3 实施计划

| 步骤 | 任务 | 耗时 |
|------|------|------|
| 1 | 设计指标体系 | 15min |
| 2 | 实现采集代码 | 25min |
| 3 | Prometheus 配置 | 10min |
| 4 | Grafana 仪表板 | 10min |

**验收标准**:
- ✅ Guardian 指标完整
- ✅ 仪表板实时更新
- ✅ 告警规则配置
- ✅ 1h 监控验证

---

## IV. P1.3: 测试覆盖率提升设计

### 4.1 需求分析

**当前状态**:
```
.state: "tests": "pending"
实际: 320+ 个测试文件存在，但状态未知
```

**问题**:
- 无法确认测试是否运行
- 无法判断覆盖率水平
- 无法识别哪些模块缺乏测试

**目标**:
- ✅ 运行完整测试套件
- ✅ 收集覆盖率报告 (目标: >70%)
- ✅ 识别覆盖率缺口
- ✅ 添加缺失的测试

### 4.2 实现设计

**测试框架** (检查现有):
```bash
# 识别测试框架
npm test                    # Jest? Vitest? Mocha?
npm run test:coverage      # 覆盖率报告
```

**测试组织**:
```
src/
  ├── gateway/
  │   ├── __tests__/gateway.test.ts
  │   └── gateway.ts
  ├── agents/
  │   ├── __tests__/agent-manager.test.ts
  │   └── agent-manager.ts
  └── ...
```

**覆盖率工具** (Istanbul/NYC):
```
目标:
- Statements: >70%
- Branches: >60%
- Functions: >70%
- Lines: >70%
```

**CI 集成**:
```yaml
# .github/workflows/test.yml
- run: npm test -- --coverage
- store-artifact: coverage/
- comment-pr: "覆盖率: 72%"
```

### 4.3 实施计划

| 步骤 | 任务 | 耗时 |
|------|------|------|
| 1 | 运行完整测试 | 15min |
| 2 | 收集覆盖率报告 | 10min |
| 3 | 分析覆盖率缺口 | 20min |
| 4 | 添加缺失测试 | 45min |
| 5 | CI 集成 & 验证 | 20min |

**验收标准**:
- ✅ 所有测试通过
- ✅ 覆盖率 >70%
- ✅ CI 自动运行测试
- ✅ PR 显示覆盖率变化

---

## V. P1 项目优先级与时间表

### 5.1 建议执行顺序

**Tier 1 (快速赢)** — 第 1 周
```
P1.1 (RAG 监控): 1.5h
  - 最直接的性能优化机会
  - 低复杂度，高价值
  - 可立即部署监控
```

**Tier 2 (核心)** — 第 2-3 周
```
P1.3 (测试覆盖): 2h
  - 质量保证基础
  - 为后续优化提供信心
  - 与开发紧密相关
```

**Tier 3 (增强)** — 第 3-4 周
```
P1.2 (Guardian 指标): 1h
  - 安全可视化
  - 低紧急性，高价值
  - 可与 P1.1/P1.3 并行
```

### 5.2 时间表

```
Week 1-2 (现在-3月20日)
├─ P1.1: RAG 监控 (1.5h)
│  └─ ✅ 部署 Prometheus/Grafana
├─ P1.3: 测试框架 (初期, 1h)
│  └─ 运行现有测试，收集报告

Week 3-4 (3月20-4月3)
├─ P1.3: 测试补充 (1h)
│  └─ 添加缺失的测试
├─ P1.2: Guardian 指标 (1h)
│  └─ 部署仪表板

Week 5-6 (4月3-4月17)
├─ 性能优化基于 P1.1 指标
├─ 安全优化基于 P1.2 数据
└─ 发布 P1 v1.0

Week 7+ (长期)
├─ P1.4: 数据库复制 (4h, P2)
├─ P1.5: 分布式追踪 (3h, P2)
└─ 继续迭代和优化
```

---

## VI. 资源和依赖

### 6.1 基础设施需求

**已有** ✅:
- Prometheus (监控数据)
- Grafana (可视化)
- 基础告警系统

**新增** (P1):
- 运行测试的 CI 环境
- 覆盖率报告存储

### 6.2 工具和库

| 工具 | 用途 | 现状 |
|------|------|------|
| Jest/Vitest | 测试框架 | 检查中 |
| Istanbul/NYC | 覆盖率 | 检查中 |
| prom-client | Prometheus | ✅ 可用 |
| Grafana | 仪表板 | ✅ 可用 |

---

## VII. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| **测试框架不兼容** | P1.3 阻塞 | 前期 1h 探索 |
| **覆盖率低** | 额外工作 | 分阶段补充 |
| **RAG 基准无法获取** | P1.1 失败 | 手动采样验证 |
| **Prometheus 存储满** | 监控丢失 | 提前扩展存储 |

---

## VIII. 评审检查清单

**P1.1 (RAG 监控)**:
- [ ] 所有搜索操作被采集
- [ ] Prometheus 指标完整
- [ ] Grafana 仪表板可用
- [ ] 告警规则生效

**P1.2 (Guardian 指标)**:
- [ ] Guardian 检查被追踪
- [ ] Breach 数据准确
- [ ] 恢复成功率可计算

**P1.3 (测试覆盖)**:
- [ ] 测试框架确认
- [ ] 覆盖率基准建立
- [ ] CI 集成完成
- [ ] 覆盖率 >70%

**整体 P1**:
- [ ] 架构与 v2.0 设计对齐
- [ ] 没有新增技术债
- [ ] 文档完整
- [ ] 团队了解路线图

---

## IX. 成功指标

| 指标 | 基准 (P0) | 目标 (P1) |
|------|-----------|----------|
| RAG 搜索 P95 | 未知 | <1000ms |
| 测试覆盖率 | 未知 | >70% |
| Guardian breach/h | 0 | 0 (维持) |
| 系统 SLA | 99.5% | 99.5%+ |
| 监控覆盖 | 基础 | 完整 |

---

## X. 后续 (P2+)

**Phase 2 (6-12 月)**:
- P2.1: 数据库复制 + 高可用
- P2.2: 分布式追踪 (Jaeger)
- P2.3: K8s 迁移规划

**超出范围** (未来):
- 多地域部署
- 机器学习模型优化
- 高级告警 (AIOps)

---

**文档版本**: 1.0
**最后更新**: 2026-03-06
**状态**: 待评审
**下一步**: 提交评审，确认优先级，开始 P1.1 实施
