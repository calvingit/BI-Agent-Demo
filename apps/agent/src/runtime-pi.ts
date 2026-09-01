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
  ToolTraceEvent,
} from "@bi-agent/contracts";
import { buildAnswer } from "./answer-builder.js";
import { queryBusinessData } from "./bi-client.js";
import {
  getModelProfile,
  getSelectedProfileId,
  isProfileConfigured,
  resolveModelProfile,
  type ResolvedModelProfile,
} from "./config/model-profiles.js";
import { BI_AGENT_POLICY } from "./config/policy.js";
import { inferDays, inferIntent } from "./intent.js";

function timestamp(): string {
  return new Date().toISOString();
}

function createGatewayRuntime(resolved: ResolvedModelProfile): {
  model: Model<"openai-completions">;
  streamFn: ReturnType<typeof createModels>["streamSimple"];
} {
  const { profile } = resolved;
  const model: Model<"openai-completions"> = {
    id: resolved.modelId,
    name: resolved.modelId,
    api: profile.adapter,
    provider: profile.deployment.providerId,
    baseUrl: resolved.baseUrl,
    reasoning: profile.model.reasoning,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: profile.model.contextWindow,
    maxTokens: profile.model.maxTokens,
  };
  const models = createModels();
  models.setProvider(
    createProvider({
      id: profile.deployment.providerId,
      name: profile.deployment.providerName,
      baseUrl: resolved.baseUrl,
      auth: {
        apiKey: envApiKeyAuth(`${profile.deployment.providerName} key`, [profile.deployment.apiKeyEnv]),
      },
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

async function executeProfileAttempt(
  request: AgentRunRequest,
  resolved: ResolvedModelProfile,
  onTrace: (event: ToolTraceEvent) => void,
  signal?: AbortSignal,
): Promise<{
  queryResult: BiQueryResult;
  selectedIntent: BiQueryIntent;
  assistantText?: string;
}> {
  const { profile } = resolved;
  const { model, streamFn } = createGatewayRuntime(resolved);
  let queryResult: BiQueryResult | undefined;
  let selectedIntent: BiQueryIntent | undefined;
  const queryParameters = Type.Object({
    intent: Type.Union(BI_AGENT_POLICY.allowedIntents.map((intent) => Type.Literal(intent))),
    days: Type.Integer({
      minimum: BI_AGENT_POLICY.minQueryDays,
      maximum: BI_AGENT_POLICY.maxQueryDays,
    }),
  });
  const queryTool: AgentTool<typeof queryParameters, BiQueryResult> = {
    name: BI_AGENT_POLICY.toolName,
    label: "查询经营指标",
    description: `查询用户有权访问的经营指标。必须选择受支持的意图和 ${BI_AGENT_POLICY.minQueryDays} 到 ${BI_AGENT_POLICY.maxQueryDays} 天的时间范围。`,
    parameters: queryParameters,
    executionMode: profile.tools.executionMode,
    execute: async (_toolCallId, params, toolSignal) => {
      const toolStartedAt = Date.now();
      onTrace({
        type: "tool.started",
        runId: request.runId,
        timestamp: timestamp(),
        toolCallId: _toolCallId,
        toolName: BI_AGENT_POLICY.toolName,
        arguments: { intent: params.intent, days: params.days },
      });
      selectedIntent = params.intent as BiQueryIntent;
      try {
        queryResult = await queryBusinessData({
          permissionSnapshotId: request.principal.permissionSnapshotId,
          intent: selectedIntent,
          days: params.days,
          currency: request.preferences.currency,
          timezone: request.preferences.timezone,
          ...(toolSignal ? { signal: toolSignal } : {}),
        });
      } catch (error) {
        onTrace({
          type: "tool.completed",
          runId: request.runId,
          timestamp: timestamp(),
          toolCallId: _toolCallId,
          toolName: BI_AGENT_POLICY.toolName,
          status: "failed",
          durationMs: Date.now() - toolStartedAt,
          error: error instanceof Error ? error.message : "Unknown tool error",
        });
        throw error;
      }
      onTrace({
        type: "tool.completed",
        runId: request.runId,
        timestamp: timestamp(),
        toolCallId: _toolCallId,
        toolName: BI_AGENT_POLICY.toolName,
        status: "completed",
        durationMs: Date.now() - toolStartedAt,
        output: queryResult,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(queryResult) }],
        details: queryResult,
      };
    },
  };

  const recentMessages = request.context.recentMessages.slice(-profile.agent.recentMessageLimit);
  const agent = new Agent({
    initialState: {
      systemPrompt: resolved.systemPrompt,
      model,
      thinkingLevel: profile.agent.thinkingLevel,
      tools: [queryTool],
      messages: recentMessages.map((message) => ({
        role: "user" as const,
        content: `${message.role === "assistant" ? "上一轮回答" : "用户"}：${message.text}`,
        timestamp: Date.now(),
      })),
    },
    streamFn,
    sessionId: request.conversationId,
    maxRetryDelayMs: profile.agent.maxRetryDelayMs,
    toolExecution: profile.tools.executionMode,
    beforeToolCall: async ({ toolCall }) =>
      toolCall.name === BI_AGENT_POLICY.toolName
        ? undefined
        : { block: true, reason: "Tool is not allowed", terminate: true },
  });

  let timedOut = false;
  const abortAgent = () => agent.abort();
  signal?.addEventListener("abort", abortAgent, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    agent.abort();
  }, profile.reliability.timeoutMs);
  try {
    await agent.prompt(request.message);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortAgent);
  }

  if (signal?.aborted) throw new DOMException("Run cancelled", "AbortError");
  if (timedOut) throw new Error(`MODEL_TIMEOUT:${profile.id}`);
  if (agent.state.errorMessage) {
    throw new Error(`MODEL_PROVIDER_ERROR:${profile.id}:${agent.state.errorMessage}`);
  }

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

  const assistantText = extractLastAssistantText(agent);
  return {
    queryResult,
    selectedIntent,
    ...(assistantText ? { assistantText } : {}),
  };
}

function canFallback(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return false;
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith("MODEL_TIMEOUT:") || message.startsWith("MODEL_PROVIDER_ERROR:");
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

  let profileId = request.execution?.modelProfileId ?? getSelectedProfileId();
  const attemptedProfiles = new Set<string>();
  let completed:
    | {
        result: Awaited<ReturnType<typeof executeProfileAttempt>>;
        resolved: ResolvedModelProfile;
      }
    | undefined;

  while (!completed) {
    if (attemptedProfiles.has(profileId)) throw new Error(`MODEL_PROFILE_FALLBACK_LOOP:${profileId}`);
    attemptedProfiles.add(profileId);
    const resolved = resolveModelProfile(profileId);
    const attemptTraces: ToolTraceEvent[] = [];
    yield {
      type: "run.configured",
      runId: request.runId,
      timestamp: timestamp(),
      config: resolved.snapshot,
    };
    try {
      const result = await executeProfileAttempt(
        request,
        resolved,
        (event) => attemptTraces.push(event),
        signal,
      );
      for (const trace of attemptTraces) yield trace;
      completed = { result, resolved };
    } catch (error) {
      for (const trace of attemptTraces) yield trace;
      const fallbackProfileId = getModelProfile(profileId).reliability.fallbackProfileId;
      if (!canFallback(error) || !fallbackProfileId || !isProfileConfigured(fallbackProfileId)) throw error;
      yield {
        type: "analysis.step",
        runId: request.runId,
        timestamp: timestamp(),
        step: "analysis",
        label: "主模型调用失败，正在切换备用模型配置",
        status: "running",
      };
      profileId = fallbackProfileId;
    }
  }

  const { result, resolved } = completed;
  const { answer, biState } = buildAnswer(
    result.selectedIntent,
    result.queryResult,
    result.assistantText,
  );
  yield {
    type: "analysis.step",
    runId: request.runId,
    timestamp: timestamp(),
    step: "intent",
    label: `已使用模型配置：${resolved.profile.id}@${resolved.profile.version}`,
    status: "completed",
  };
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
      provider: resolved.snapshot.provider,
      model: resolved.snapshot.model,
      inputTokens: 0,
      outputTokens: 0,
      credits: 5,
    },
  };
}
