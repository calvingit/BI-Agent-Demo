import type { AgentEvent, AgentRunRequest, BiQueryResult } from "@bi-agent/contracts";
import { buildAnswer } from "./answer-builder.js";
import { queryBusinessData } from "./bi-client.js";
import { inferDays, inferIntent } from "./intent.js";
import { runWithPi } from "./runtime-pi.js";

const timestamp = () => new Date().toISOString();

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Run cancelled", "AbortError"));
      },
      { once: true },
    );
  });
}

function step(
  request: AgentRunRequest,
  name: "intent" | "permission" | "query" | "analysis" | "render",
  label: string,
  status: "running" | "completed",
): AgentEvent {
  return { type: "analysis.step", runId: request.runId, timestamp: timestamp(), step: name, label, status };
}

async function* runMock(
  request: AgentRunRequest,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  yield { type: "run.started", runId: request.runId, timestamp: timestamp() };
  yield step(request, "intent", "正在识别指标、维度和时间范围", "running");
  await wait(180, signal);
  const intent = inferIntent(request.message, request.context.biState.intent);
  const days = inferDays(request.message);
  yield step(request, "intent", `已识别查询意图：${intent}`, "completed");
  yield step(request, "permission", "正在校验店铺权限和套餐能力", "running");
  await wait(120, signal);
  yield step(request, "permission", "已应用服务端权限快照", "completed");
  yield step(request, "query", "正在查询经营数据", "running");
  const result = await queryBusinessData({
    permissionSnapshotId: request.principal.permissionSnapshotId,
    intent,
    days,
    currency: request.preferences.currency,
    timezone: request.preferences.timezone,
    ...(signal ? { signal } : {}),
  });
  yield step(request, "query", `查询完成：${result.rows.length} 条聚合结果`, "completed");
  yield step(request, "analysis", "正在生成可核验的经营分析", "running");
  await wait(220, signal);
  const { answer, biState } = buildAnswer(intent, result);
  yield step(request, "analysis", "分析完成", "completed");
  yield step(request, "render", "正在生成结构化图表", "running");
  for (const chunk of answer.summary.match(/.{1,12}/gu) ?? []) {
    await wait(35, signal);
    yield { type: "answer.delta", runId: request.runId, timestamp: timestamp(), delta: chunk };
  }
  yield step(request, "render", "答案已通过结构校验", "completed");
  yield {
    type: "answer.completed",
    runId: request.runId,
    timestamp: timestamp(),
    answer,
    biState,
    usage: {
      provider: "demo",
      model: "deterministic-mock",
      inputTokens: 0,
      outputTokens: 0,
      credits: 3,
    },
  };
}

export async function* runAgent(
  request: AgentRunRequest,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  if ((process.env.AGENT_MODE ?? "mock") === "pi") {
    yield* runWithPi(request, signal);
    return;
  }
  yield* runMock(request, signal);
}

export type { BiQueryResult };
