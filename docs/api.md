# API 与事件协议

本地地址：

- 业务 API：`http://localhost:4000`
- BI Agent：`http://localhost:4001`

## 1. 公共业务 API

Demo 使用：

```http
x-demo-user-id: user_demo
```

生产环境必须由可信 Gateway 注入身份，不能接受客户端直接指定用户 ID。

### `GET /api/bootstrap`

返回当前用户、余额、授权店铺、会话和推荐问题。

### `GET /api/conversations`

返回当前用户的历史会话。

### `POST /api/conversations`

```json
{
  "title": "新的经营分析"
}
```

### `GET /api/conversations/:conversationId/messages`

返回持久化的用户消息和已完成回答。

### `POST /api/conversations/:conversationId/messages`

```json
{
  "message": "最近 30 天哪些店铺退款率最高？"
}
```

返回 `application/x-ndjson`。每行是一个 Agent Event。

### `POST /api/runs/:runId/cancel`

取消当前进程中正在运行的 Agent Run。生产环境需要使用分布式 Run Registry。

## 2. 内部 API

内部接口使用：

```http
x-internal-token: local-demo-token
```

### `POST /internal/runs`

业务 API 调用 Agent 服务。

核心字段：

```json
{
  "requestId": "req_xxx",
  "runId": "run_xxx",
  "conversationId": "conv_xxx",
  "principal": {
    "userId": "user_demo",
    "tenantId": "tenant_duoke_demo",
    "permissionSnapshotId": "perm_xxx"
  },
  "entitlement": {
    "quotaReservationId": "quota_xxx",
    "capabilities": ["overview", "ranking", "trend", "analysis"]
  },
  "preferences": {
    "locale": "zh-CN",
    "timezone": "Asia/Singapore",
    "currency": "SGD"
  },
  "message": "最近 30 天哪些店铺退款率最高？",
  "context": {
    "recentMessages": [],
    "biState": {}
  }
}
```

### `POST /internal/bi/query`

Agent 调用业务后端的受限 BI 接口：

```json
{
  "permissionSnapshotId": "perm_xxx",
  "intent": "refund-ranking",
  "days": 30,
  "currency": "SGD",
  "timezone": "Asia/Singapore"
}
```

该接口不接受 `userId`、`tenantId` 或 `shopIds`，避免模型扩展权限范围。

支持的 `intent`：

```text
overview
refund-ranking
revenue-trend
response-ranking
complaint-analysis
```

## 3. Agent Events

### `run.started`

```json
{
  "type": "run.started",
  "runId": "run_xxx",
  "timestamp": "2026-09-01T08:00:00.000Z"
}
```

### `analysis.step`

```json
{
  "type": "analysis.step",
  "runId": "run_xxx",
  "timestamp": "2026-09-01T08:00:00.000Z",
  "step": "query",
  "label": "正在查询经营数据",
  "status": "running"
}
```

`step`：`intent | permission | query | analysis | render`。

### `run.configured`

Agent 每次尝试模型 Profile 前发送。切换备用模型时会再次发送，业务 API 使用最新事件更新 `agent_runs` 配置快照。

```json
{
  "type": "run.configured",
  "runId": "run_xxx",
  "timestamp": "2026-09-01T08:00:00.000Z",
  "config": {
    "mode": "pi",
    "profileId": "openai-compatible-bi-v1",
    "profileVersion": "1.0.0",
    "promptId": "bi-analyst-openai",
    "promptVersion": "1.0.0",
    "provider": "duoke-primary-gateway",
    "model": "configured-model-id",
    "configHash": "64-character-sha256"
  }
}
```

快照不包含 API Key 和 Gateway 地址。

### `answer.delta`

只用于即时文字反馈，不持久化为最终消息。

```json
{
  "type": "answer.delta",
  "runId": "run_xxx",
  "timestamp": "2026-09-01T08:00:00.000Z",
  "delta": "TikTok 泰国直播店"
}
```

### `answer.completed`

包含经过 Zod 校验的完整 `BiAnswer`、更新后的 BI State 和模型用量。业务后端收到该事件后保存消息并结算积分。

### `run.failed`

```json
{
  "type": "run.failed",
  "runId": "run_xxx",
  "timestamp": "2026-09-01T08:00:00.000Z",
  "code": "BI_QUERY_FAILED",
  "message": "查询超时",
  "retryable": true
}
```

## 4. Schema 来源

所有请求、响应和事件类型定义在：

```text
packages/contracts/src/index.ts
```

HTTP 边界和 NDJSON 边界必须进行运行时校验，不能只依赖 TypeScript 编译类型。
