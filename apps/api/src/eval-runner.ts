import {
  AgentConfigCatalogSchema,
  AgentEventSchema,
  AgentRunRequestSchema,
  DEMO_USER_ID,
  type AgentConfigCatalog,
  type AgentEvent,
  type BiAnswer,
  type EvalCase,
  type ToolTraceEvent,
} from "@bi-agent/contracts";
import {
  appendAgentRunAttempt,
  appendAgentTraceEvent,
  completeEvalRun,
  completeLatestAgentRunAttempt,
  createPermissionSnapshot,
  failEvalRun,
  getEvalDataset,
  getEvalRun,
  getUser,
  markEvalRunRunning,
  saveEvalCaseResult,
} from "@bi-agent/database";
import { randomUUID } from "node:crypto";
import { evaluateCaseResult } from "./eval-assertions.js";

export interface EvalRuntimeOptions {
  agentBaseUrl: string;
  internalToken: string;
}

export async function getAgentConfig(options: EvalRuntimeOptions): Promise<AgentConfigCatalog> {
  const response = await fetch(`${options.agentBaseUrl}/internal/config`, {
    headers: { "x-internal-token": options.internalToken },
  });
  if (!response.ok) throw new Error(`AGENT_CONFIG_UNAVAILABLE:${response.status}`);
  return AgentConfigCatalogSchema.parse(await response.json());
}

async function readAgentEvents(response: Response): Promise<AgentEvent[]> {
  if (!response.ok || !response.body) {
    throw new Error(`AGENT_UNAVAILABLE:${response.status}:${await response.text()}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: AgentEvent[] = [];
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) events.push(AgentEventSchema.parse(JSON.parse(line)));
    }
  }
  if (buffer.trim()) events.push(AgentEventSchema.parse(JSON.parse(buffer)));
  return events;
}

async function executeEvalCase(
  evalRunId: string,
  evalCase: EvalCase,
  mode: "mock" | "pi",
  requestedProfileId: string | null,
  options: EvalRuntimeOptions,
): Promise<void> {
  const startedAt = Date.now();
  const agentRunId = `evalagent_${randomUUID()}`;
  const user = getUser(DEMO_USER_ID);
  if (!user) throw new Error("DEMO_USER_NOT_FOUND");
  const permissionSnapshotId = createPermissionSnapshot(DEMO_USER_ID);
  const request = AgentRunRequestSchema.parse({
    requestId: `evalreq_${randomUUID()}`,
    runId: agentRunId,
    conversationId: `eval:${evalRunId}:${evalCase.id}`,
    principal: {
      userId: user.id,
      tenantId: user.tenantId,
      permissionSnapshotId,
    },
    entitlement: {
      quotaReservationId: "eval-no-charge",
      capabilities: ["overview", "ranking", "trend", "analysis"],
    },
    preferences: {
      locale: user.locale,
      timezone: user.timezone,
      currency: user.currency,
    },
    message: evalCase.input,
    context: evalCase.context,
    ...(mode === "pi" && requestedProfileId
      ? { execution: { modelProfileId: requestedProfileId } }
      : {}),
  });

  let answer: BiAnswer | null = null;
  let errorCode: string | undefined;
  let traces: ToolTraceEvent[] = [];
  try {
    const events = await readAgentEvents(
      await fetch(`${options.agentBaseUrl}/internal/runs`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-token": options.internalToken,
        },
        body: JSON.stringify(request),
      }),
    );
    for (const event of events) {
      if (event.type === "run.configured") {
        completeLatestAgentRunAttempt(agentRunId, "failed", "MODEL_FALLBACK");
        appendAgentRunAttempt(agentRunId, event.config);
      }
      if (event.type === "tool.started" || event.type === "tool.completed") {
        appendAgentTraceEvent(agentRunId, event);
      }
      if (event.type === "answer.completed") {
        answer = event.answer;
        completeLatestAgentRunAttempt(agentRunId, "completed");
      }
      if (event.type === "run.failed") {
        errorCode = event.code;
        completeLatestAgentRunAttempt(agentRunId, "failed", event.code);
      }
    }
    traces = events.filter(
      (event): event is ToolTraceEvent => event.type === "tool.started" || event.type === "tool.completed",
    );
    if (!answer && !errorCode) errorCode = "AGENT_STREAM_INCOMPLETE";
  } catch (error) {
    errorCode = error instanceof Error ? error.message.split(":", 1)[0] : "EVAL_EXECUTION_FAILED";
    completeLatestAgentRunAttempt(agentRunId, "failed", errorCode);
  }

  const evaluation = evaluateCaseResult(evalCase, answer, traces);
  saveEvalCaseResult({
    evalRunId,
    caseId: evalCase.id,
    agentRunId,
    status: errorCode ? "error" : evaluation.passed ? "passed" : "failed",
    score: evaluation.score,
    durationMs: Date.now() - startedAt,
    answer,
    assertions: evaluation.assertions,
    ...(errorCode ? { errorCode } : {}),
  });
}

export async function executeEvalRun(
  evalRunId: string,
  concurrency: number,
  options: EvalRuntimeOptions,
): Promise<void> {
  const run = getEvalRun(evalRunId);
  if (!run) throw new Error("EVAL_RUN_NOT_FOUND");
  const dataset = getEvalDataset(run.datasetId);
  if (!dataset) throw new Error("EVAL_DATASET_NOT_FOUND");
  const cases = dataset.cases.filter((evalCase) => evalCase.enabled);
  markEvalRunRunning(evalRunId);
  let nextIndex = 0;
  try {
    const workers = Array.from(
      { length: Math.min(Math.max(1, concurrency), 5, cases.length) },
      async () => {
        while (true) {
          const currentIndex = nextIndex;
          nextIndex += 1;
          const evalCase = cases[currentIndex];
          if (!evalCase) return;
          await executeEvalCase(
            evalRunId,
            evalCase,
            run.mode,
            run.requestedProfileId,
            options,
          );
        }
      },
    );
    await Promise.all(workers);
    completeEvalRun(evalRunId);
  } catch (error) {
    console.error(`Eval run ${evalRunId} failed`, error);
    failEvalRun(evalRunId);
  }
}
