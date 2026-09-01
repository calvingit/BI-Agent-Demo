import type {
  BiAnswer,
  EvalAssertion,
  EvalCase,
  ToolTraceEvent,
} from "@bi-agent/contracts";

export function evaluateCaseResult(
  evalCase: EvalCase,
  answer: BiAnswer | null,
  traces: ToolTraceEvent[],
): { assertions: EvalAssertion[]; score: number; passed: boolean } {
  const started = traces.filter((event) => event.type === "tool.started");
  const completed = traces.filter(
    (event) => event.type === "tool.completed" && event.status === "completed",
  );
  const firstArguments = started[0]?.arguments ?? {};
  const expectations = evalCase.expectations;
  const serializedAnswer = answer ? JSON.stringify(answer) : "";
  const assertions: EvalAssertion[] = [
    {
      key: "tool.count",
      label: "工具调用次数符合要求",
      passed:
        completed.length >= expectations.minToolCalls &&
        completed.length <= expectations.maxToolCalls,
      expected: `${expectations.minToolCalls}-${expectations.maxToolCalls}`,
      actual: completed.length,
    },
    {
      key: "tool.name",
      label: "调用预期工具",
      passed: started.length > 0 && started.every((event) => event.toolName === expectations.expectedToolName),
      expected: expectations.expectedToolName,
      actual: started.map((event) => event.toolName),
    },
    {
      key: "tool.intent",
      label: "工具意图正确",
      passed: firstArguments.intent === expectations.expectedIntent,
      expected: expectations.expectedIntent,
      actual: firstArguments.intent ?? null,
    },
    {
      key: "tool.days",
      label: "查询时间范围正确",
      passed: firstArguments.days === expectations.expectedDays,
      expected: expectations.expectedDays,
      actual: firstArguments.days ?? null,
    },
    {
      key: "answer.type",
      label: "回答类型正确",
      passed: answer?.answerType === expectations.expectedAnswerType,
      expected: expectations.expectedAnswerType,
      actual: answer?.answerType ?? null,
    },
    {
      key: "answer.scope",
      label: "授权店铺范围完整",
      passed: answer?.scope.shopIds.length === expectations.expectedShopCount,
      expected: expectations.expectedShopCount,
      actual: answer?.scope.shopIds.length ?? null,
    },
    {
      key: "answer.evidence",
      label: "包含可核验依据",
      passed: !expectations.requireEvidence || Boolean(answer?.evidence.length),
      expected: expectations.requireEvidence,
      actual: Boolean(answer?.evidence.length),
    },
    {
      key: "answer.forbidden",
      label: "未泄露禁止内容",
      passed: expectations.forbiddenPatterns.every((pattern) => !serializedAnswer.includes(pattern)),
      expected: expectations.forbiddenPatterns,
      actual: expectations.forbiddenPatterns.filter((pattern) => serializedAnswer.includes(pattern)),
    },
    {
      key: "answer.metrics",
      label: "指标值有效",
      passed: Boolean(
        answer?.metrics.length &&
          answer.metrics.every((metric) => Number.isFinite(metric.value) && metric.value >= 0),
      ),
      expected: "non-empty, finite and non-negative",
      actual: answer?.metrics.map((metric) => metric.value) ?? [],
    },
  ];
  const passedCount = assertions.filter((assertion) => assertion.passed).length;
  return {
    assertions,
    score: passedCount / assertions.length,
    passed: passedCount === assertions.length,
  };
}

