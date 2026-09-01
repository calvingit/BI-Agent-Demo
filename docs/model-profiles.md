# 模型配置与 Prompt 管理

## 1. 设计目标

模型切换以完整 `ModelProfile` 为单位，不单独替换 `modelId`。一个 Profile 同时确定：

- 模型部署和协议适配器；
- System Prompt 及其版本；
- 推理等级和模型 Token 上限；
- 上下文窗口和历史消息数量；
- 工具执行模式；
- 超时、重试等待上限和备用 Profile。

权限、租户隔离、工具白名单和 BI 查询范围不属于 Model Profile，不能通过模型配置修改。

## 2. 配置分层

| 配置 | 示例 | 位置 | 是否随模型切换 |
|---|---|---|---|
| Model Profile | Prompt、thinking level、context window、timeout | `apps/agent/src/config/model-profiles.ts` | 是 |
| Prompt Registry | System Prompt 模板和版本 | `apps/agent/src/config/prompts.ts` | 是 |
| Business Policy | 工具白名单、查询范围、禁止原始 SQL | `apps/agent/src/config/policy.ts` | 否 |
| Deployment Secret | Gateway 地址、API Key、模型 ID | `.env` / Secret Manager | 由 Profile 引用 |
| Runtime Context | 用户、租户、权限快照、币种、时区 | 业务 API 请求 | 每次请求注入 |

`ModelProfileSchema` 使用 Zod 校验配置结构，避免为某个模型误传不受支持或类型错误的参数。当前 Demo 只实现 `openai-completions` 适配器；增加其他协议时应扩展为按 `adapter` 区分的联合 Schema。

## 3. 内置 Profile

### `openai-compatible-bi-v1`

默认 Pi Profile：

- Prompt：`bi-analyst-openai@1.0.0`；
- Thinking Level：`medium`；
- 最近消息：6 条；
- 模型超时：30 秒；
- 模型级失败时可切换到 `deepseek-compatible-bi-v1`。

部署变量：

```dotenv
AI_GATEWAY_BASE_URL=https://gateway.example.com/v1
AI_GATEWAY_API_KEY=secret
AI_GATEWAY_MODEL=your-model-id
```

### `deepseek-compatible-bi-v1`

可直接选择，也可作为备用 Profile：

- Prompt：`bi-analyst-deepseek@1.0.0`；
- Thinking Level：`low`；
- 最近消息：4 条；
- 模型超时：30 秒；
- 没有下一级备用 Profile。

部署变量：

```dotenv
DEEPSEEK_GATEWAY_BASE_URL=https://gateway.example.com/v1
DEEPSEEK_GATEWAY_API_KEY=secret
DEEPSEEK_GATEWAY_MODEL=your-model-id
```

这些参数是 Demo 基线，不代表对应模型厂商的通用最佳值。接入真实模型前必须根据模型能力、AI Gateway 协议和评测结果调整。

## 4. 选择 Profile

```dotenv
AGENT_MODE=pi
AGENT_MODEL_PROFILE=openai-compatible-bi-v1
```

Agent 启动时加载 Registry；执行 Run 时解析选中的 Profile 和对应环境变量。`AGENT_MODE=mock` 时不读取模型凭证，使用固定的 `deterministic-demo-v1` 快照。

不建议通过环境变量分别覆盖 `thinkingLevel`、上下文窗口等 Profile 字段。独立覆盖会破坏模型、Prompt 和参数之间的绑定关系。需要调整时新增 Profile 版本。

## 5. Prompt Registry

Prompt 使用 `id + version` 唯一标识，并通过受控变量组合业务工具信息：

```text
{{TOOL_NAME}}
{{MIN_DAYS}}
{{MAX_DAYS}}
{{MAX_SUMMARY_CHARACTERS}}
```

工具名和查询范围来自固定 Business Policy；Profile 只能配置回答长度等模型行为，不能扩大业务权限。

修改 Prompt 时不要覆盖原版本。推荐：

1. 新增 Prompt 版本；
2. 新增或升级 Model Profile 版本；
3. 运行固定评测集；
4. 修改 `AGENT_MODEL_PROFILE` 进行灰度；
5. 保留旧 Profile 以便回滚和复现历史 Run。

## 6. 备用模型

备用模型必须使用自己的完整 Profile。当前只在以下模型级错误时降级：

- `MODEL_TIMEOUT`；
- `MODEL_PROVIDER_ERROR`。

以下错误不会触发模型降级：

- 用户取消；
- 权限失效；
- BI 查询失败；
- 请求 Schema 错误；
- 主 Profile 配置缺失。

只有备用 Profile 所引用的三个部署变量都存在时才会切换。每次尝试前 Agent 都发送新的 `run.configured` 事件，因此业务数据库最终记录实际使用或最后尝试的 Profile。

## 7. Run 配置快照

`agent_runs` 保存：

```text
agent_mode
model_profile_id
model_profile_version
prompt_id
prompt_version
provider
model_id
config_hash
```

`config_hash` 是以下非敏感信息的 SHA-256：

- 完整 Model Profile；
- 实际模型 ID；
- 渲染后的 System Prompt。

API Key 和 Gateway 地址不进入快照。该快照用于问题追溯和结果复现，不用于恢复密钥或重新执行历史请求。

## 8. 增加新模型

1. 在 `prompts.ts` 增加版本化 Prompt；
2. 在 `model-profiles.ts` 增加 Profile，并声明独立部署变量；
3. 如果协议不同，先实现对应 Pi AI Adapter 和可辨识配置 Schema；
4. 添加 Profile 解析、Prompt 渲染和失败策略测试；
5. 用真实模型验证工具调用率、数值忠实度、延迟和 Token 成本；
6. 通过 `AGENT_MODEL_PROFILE` 选择新 Profile。

模型 ID 本身不会自动证明其能力与 Profile 相符。配置维护者必须确保上下文窗口、推理能力和工具调用能力与实际 Gateway 模型一致。

