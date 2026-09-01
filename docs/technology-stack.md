# 技术栈与选型

版本是仓库初始化时验证的基线，最终安装结果由 `package-lock.json` 固定。

| 层 | 技术 | 基线版本 | 选择理由 |
|---|---|---:|---|
| Runtime | Node.js | >=22.19 | 满足当前 Pi Engine 要求，前后端共享 TypeScript |
| 语言 | TypeScript | 7.0.2 | 严格类型和跨服务协议复用 |
| Monorepo | npm workspaces | npm 10+ | 无额外工作区工具，Demo 启动成本低 |
| Web | React | 19.2.8 | 组件生态成熟 |
| Router | TanStack Router | 1.170.32 | 类型安全路由和 URL 状态 |
| Server State | TanStack Query | 5.102.8 | 请求缓存、失效和 Mutation 生命周期 |
| 图表 | Recharts | 3.10.1 | React 集成简单，满足折线图和柱状图 Demo |
| API | Hono | 4.13.5 | Web Standards API、类型简洁、Node 适配明确 |
| Agent Runtime | Pi Agent Core | 0.84.4 | 工具调用、事件流、状态、Abort 和 Provider 抽象 |
| Model Adapter | Pi AI | 0.84.4 | 多厂商模型协议和 OpenAI-compatible Gateway |
| Contract | Zod | 4.5.4 | 跨进程运行时校验和 TypeScript 推导 |
| Database | SQLite + better-sqlite3 | 13.0.3 | 单文件、事务可靠、本地调试简单 |
| Build | Vite + tsup | 8.2.2 / 8.5.1 | 分别构建浏览器和 Node 服务 |
| Test | Vitest | 4.1.11 | 与 Vite/TypeScript 体系一致 |

## 前端为什么使用 TanStack Router，而不是 TanStack Start

这个 Demo 明确拆分业务 API 和 Agent 服务，前端没有独立 SSR、Server Functions 或 BFF 需求。TanStack Router + Query 已经覆盖：

- 会话路由；
- 异步服务端状态；
- 消息发送 Mutation；
- 缓存失效；
- 后续筛选条件 URL 化。

如果产品需要 SEO、服务端首屏或把 BFF 合并到前端应用，再升级为 TanStack Start。当前拆分更能展示真实的多客后端边界。

官方资料：

- [TanStack Router](https://tanstack.com/router/latest)
- [TanStack Query](https://tanstack.com/query/latest)
- [TanStack Start](https://tanstack.com/start/latest)

## 后端为什么选择 Hono

- 前后端统一使用 Fetch API、Request、Response 和 Web Streams；
- NDJSON 流可以直接使用标准 `ReadableStream`；
- 相比完整企业框架，Demo 中间件和样板代码更少；
- 后续可以部署到 Node、Bun 或 Serverless 环境。

官方资料：[Hono Node.js](https://hono.dev/docs/getting-started/nodejs)

## 为什么直接使用 Pi Agent Core

不使用 `pi-coding-agent`，因为它默认包含文件、Shell 和代码编辑工具，不适合用户经营数据场景。

`pi-agent-core` 在这里负责：

- Agent Loop；
- TypeBox Tool Schema；
- 串行工具执行；
- 生命周期事件；
- AbortSignal；
- 上下文状态；
- AI Provider Stream。

业务系统自行负责认证、权限、会话、积分和数据查询。

官方资料：[Pi Agent Harness](https://github.com/earendil-works/pi)

## 为什么不使用 MCP

当前只有一个进程内受限 BI 工具，直接使用 Pi `AgentTool` 更简单：

- 参数和权限闭包在同一 TypeScript 代码中；
- 不增加独立 MCP Server 生命周期；
- 更容易贯穿 AbortSignal 和内部认证；
- 减少工具发现与协议层开销。

当指标服务需要被多个 Agent Runtime 或外部团队复用时，再将稳定工具封装为 MCP。

## 为什么使用 SQLite

SQLite 适合验证：

- 业务表和经营指标共存；
- 积分事务；
- 会话与消息恢复；
- 权限快照；
- 本地可重复种子数据。

生产环境不建议把大规模 BI 聚合放在业务 PostgreSQL，更不建议继续使用 SQLite。生产应拆分事务库与 OLAP 数据层。

## 模型策略

Demo 提供两种 Runtime：

### Mock

- 默认开启；
- 不需要网络和 API Key；
- 使用同一工具、权限、查询和回答 Schema；
- 适合 UI、业务链路和自动化测试。

### Pi

- 经 OpenAI-compatible AI Gateway 调用真实模型；
- 模型只负责把自然语言映射到受支持的查询工具并解释结果；
- 不向模型暴露 SQL、数据库凭证和权限列表；
- 模型调用失败时不能绕过业务查询服务。
- 通过 Model Profile 同时切换 Prompt、上下文、推理参数和部署；
- Profile 与 Prompt 使用独立版本，实际配置保存到 Agent Run；
- 备用模型加载独立 Profile，不继承主模型参数。

具体配置见[模型配置与 Prompt 管理](model-profiles.md)。

## 暂不采用的技术

| 技术 | 原因 |
|---|---|
| Sub-agent | MVP 没有独立并行专家任务，增加成本和调试复杂度 |
| LangChain/LangGraph | Pi 已提供所需 Agent Loop；重复引入抽象无收益 |
| GraphQL | API 数量少，NDJSON Streaming 使用 REST 更直接 |
| Kafka/队列 | Demo Run 较短；生产可恢复执行阶段再引入 |
| Vector Database | 产品知识 RAG 尚未进入本轮 Demo |
| 任意 SQL Agent | 无法可靠保证租户权限、查询预算和指标口径 |
