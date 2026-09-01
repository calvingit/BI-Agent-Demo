import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import {
  Type,
  contentText,
  createModels,
  createProvider,
  envApiKeyAuth,
  type Model,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type {
  AgentEvent as DuokeAgentEvent,
  AgentRunRequest,
  BiQueryIntent,
  BiQueryResult,
} from "@bi-agent/contracts";
import { buildAnswer } from "./answer-builder.js";
import { queryBusinessData } from "./bi-client.js";
import { inferDays, inferIntent } from "./intent.js";

const intents = [
  "overview",
  "refund-ranking",
  "revenue-trend",
  "response-ranking",
  "complaint-analysis",
] as const;

function timestamp(): string {
  return new Date().toISOString();
}

function createGatewayModel(): {
  model: Model<"openai-completions">;
  streamFn: ReturnType<typeof createModels>["streamSimple"];
} {
  const baseUrl = process.env.AI_GATEWAY_BASE_URL;
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  const modelId = process.env.AI_GATEWAY_MODEL;
  if (!baseUrl || !apiKey || !modelId) {
    throw new Error("PI_CONFIG_MISSING: AI_GATEWAY_BASE_URL, AI_GATEWAY_API_KEY and AI_GATEWAY_MODEL are required");
  }
  const model: Model<"openai-completions"> = {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider: "duoke-ai-gateway",
    baseUrl,
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  };
  const models = createModels();
  models.setProvider(
    createProvider({
      id: "duoke-ai-gateway",
      name: "Duoke AI Gateway",
      baseUrl,
      auth: { apiKey: envApiKeyAuth("Duoke AI Gateway key", ["AI_GATEWAY_API_KEY"]) },
      models: [model],
      api: openAICompletionsApi(),
    }),
  );
  return { model, streamFn: models.streamSimple.bind(models) };
}

function extractLastAssistantText(agent: Agent): string | undefined {
  const assistant = [...agent.state.messages].reverse().find((message) => message.role === "assistant");
  return assistant?.role === "assistant" ? contentText(assistant.content) : undefined;
}

export async function* runWithPi(
  request: AgentRunRequest,
  signal?: AbortSignal,
): AsyncGenerator<DuokeAgentEvent> {
  yield { type: "run.started", runId: request.runId, timestamp: timestamp() };
  yield {
    type: "analysis.step",
    runId: request.runId,
    timestamp: timestamp(),
    step: "intent",
    label: "Pi 正在规划受限 BI 工具调用",
    status: "running",
  };

  const { model, streamFn } = createGatewayModel();
  let queryResult: BiQueryResult | undefined;
  let selectedIntent: BiQueryIntent | undefined;
  const queryParameters = Type.Object({
    intent: Type.Union(intents.map((intent) => Type.Literal(intent))),
    days: Type.Integer({ minimum: 7, maximum: 90 }),
  });
  const queryTool: AgentTool<typeof queryParameters, BiQueryResult> = {
    name: "query_business_metrics",
    label: "查询经营指标",
    description: "查询用户有权访问的经营指标。必须选择一个受支持的意图和 7 到 90 天的时间范围。",
    parameters: queryParameters,
    executionMode: "sequential",
    execute: async (_toolCallId, params, toolSignal) => {
      selectedIntent = params.intent as BiQueryIntent;
      queryResult = await queryBusinessData({
        permissionSnapshotId: request.principal.permissionSnapshotId,
        intent: selectedIntent,
        days: params.days,
        currency: request.preferences.currency,
        timezone: request.preferences.timezone,
        ...(toolSignal ? { signal: toolSignal } : {}),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(queryResult) }],
        details: queryResult,
      };
    },
  };

  const agent = new Agent({
    initialState: {
      systemPrompt: `你是多客 BI 分析编排器。你不能直接查询数据库，也不能编造指标。
对每个用户问题必须调用 query_business_metrics 恰好一次。
工具返回后，用中文给出不超过 120 字的结论，只陈述工具数据支持的事实。
归因只能表述为贡献或待验证假设，不得声称因果关系。不要展示内部思考过程。`,
      model,
      thinkingLevel: "medium",
      tools: [queryTool],
      messages: request.context.recentMessages.map((message) => ({
        role: "user" as const,
        content: `${message.role === "assistant" ? "上一轮回答" : "用户"}：${message.text}`,
        timestamp: Date.now(),
      })),
    },
    streamFn,
    sessionId: request.conversationId,
    toolExecution: "sequential",
    beforeToolCall: async ({ toolCall }) =>
      toolCall.name === "query_business_metrics"
        ? undefined
        : { block: true, reason: "Tool is not allowed", terminate: true },
  });
  signal?.addEventListener("abort", () => agent.abort(), { once: true });
  await agent.prompt(request.message);

  if (!queryResult || !selectedIntent) {
    selectedIntent = inferIntent(request.message, request.context.biState.intent);
    queryResult = await queryBusinessData({
      permissionSnapshotId: request.principal.permissionSnapshotId,
      intent: selectedIntent,
      days: inferDays(request.message),
      currency: request.preferences.currency,
      timezone: request.preferences.timezone,
      ...(signal ? { signal } : {}),
    });
  }
  const { answer, biState } = buildAnswer(selectedIntent, queryResult, extractLastAssistantText(agent));
  yield {
    type: "analysis.step",
    runId: request.runId,
    timestamp: timestamp(),
    step: "analysis",
    label: "Pi 工具调用和分析已完成",
    status: "completed",
  };
  yield {
    type: "answer.completed",
    runId: request.runId,
    timestamp: timestamp(),
    answer,
    biState,
    usage: {
      provider: "duoke-ai-gateway",
      model: model.id,
      inputTokens: 0,
      outputTokens: 0,
      credits: 5,
    },
  };
}
