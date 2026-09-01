import type { BiAnswer, EvalCase, ToolTraceEvent } from "@bi-agent/contracts";
import { describe, expect, it } from "vitest";
import { evaluateCaseResult } from "./eval-assertions.js";

const evalCase = {
  id: "case",
  datasetId: "dataset",
  name: "refund ranking",
  category: "ranking",
  input: "退款率最高",
  context: { recentMessages: [], biState: {} },
  expectations: {
    expectedIntent: "refund-ranking",
    expectedDays: 30,
    expectedAnswerType: "ranking",
    expectedToolName: "query_business_metrics",
    minToolCalls: 1,
    maxToolCalls: 1,
    expectedShopCount: 3,
    requireEvidence: true,
    forbiddenPatterns: ["SELECT "],
  },
  tags: [],
  enabled: true,
} satisfies EvalCase;

const answer = {
  answerType: "ranking",
  title: "退款率排名",
  summary: "店铺 A 退款率最高。",
  scope: {
    dateRange: { start: "2026-01-01", end: "2026-01-30" },
    shopIds: ["a", "b", "c"],
    platforms: ["shopee"],
    timezone: "Asia/Singapore",
    currency: "SGD",
    dataFreshness: "2026-01-30T00:00:00Z",
  },
  metrics: [{ key: "refund", label: "退款率", value: 3, formattedValue: "3%", changePercent: null, trend: "flat" }],
  chart: null,
  evidence: ["覆盖三个店铺"],
  recommendations: [],
  caveats: [],
  suggestedQuestions: [],
} satisfies BiAnswer;

const startedTrace: ToolTraceEvent = {
  type: "tool.started",
  runId: "run",
  timestamp: "now",
  toolCallId: "tool",
  toolName: "query_business_metrics",
  arguments: { intent: "refund-ranking", days: 30 },
};
const completedTrace: ToolTraceEvent = {
  type: "tool.completed",
  runId: "run",
  timestamp: "now",
  toolCallId: "tool",
  toolName: "query_business_metrics",
  status: "completed",
  durationMs: 10,
  output: {},
};
const traces: ToolTraceEvent[] = [startedTrace, completedTrace];

describe("eval assertions", () => {
  it("passes a correct output and trajectory", () => {
    expect(evaluateCaseResult(evalCase, answer, traces)).toMatchObject({ passed: true, score: 1 });
  });

  it("detects a wrong tool intent even when the final answer looks valid", () => {
    const wrongTrace: ToolTraceEvent[] = [
      { ...startedTrace, arguments: { intent: "overview", days: 30 } },
      completedTrace,
    ];
    const result = evaluateCaseResult(evalCase, answer, wrongTrace);
    expect(result.passed).toBe(false);
    expect(result.assertions.find((item) => item.key === "tool.intent")?.passed).toBe(false);
  });
});
