import { z } from "zod";

export const PlatformSchema = z.enum(["shopee", "tiktok"]);
export type Platform = z.infer<typeof PlatformSchema>;

export const UserSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  locale: z.string(),
  timezone: z.string(),
  currency: z.string(),
});
export type User = z.infer<typeof UserSchema>;

export const ShopSchema = z.object({
  id: z.string(),
  name: z.string(),
  platform: PlatformSchema,
  country: z.string(),
});
export type Shop = z.infer<typeof ShopSchema>;

export const ConversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const ScopeSchema = z.object({
  dateRange: z.object({ start: z.string(), end: z.string() }),
  shopIds: z.array(z.string()),
  platforms: z.array(PlatformSchema),
  timezone: z.string(),
  currency: z.string(),
  dataFreshness: z.string(),
});
export type Scope = z.infer<typeof ScopeSchema>;

export const MetricCardSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.number(),
  formattedValue: z.string(),
  changePercent: z.number().nullable(),
  trend: z.enum(["up", "down", "flat"]),
});
export type MetricCard = z.infer<typeof MetricCardSchema>;

export const ChartSchema = z.object({
  type: z.enum(["bar", "line"]),
  xKey: z.string(),
  series: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      color: z.string(),
    }),
  ),
  data: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
});
export type Chart = z.infer<typeof ChartSchema>;

export const BiAnswerSchema = z.object({
  answerType: z.enum(["overview", "ranking", "trend", "analysis"]),
  title: z.string(),
  summary: z.string(),
  scope: ScopeSchema,
  metrics: z.array(MetricCardSchema),
  chart: ChartSchema.nullable(),
  evidence: z.array(z.string()),
  recommendations: z.array(
    z.object({
      priority: z.enum(["high", "medium", "low"]),
      title: z.string(),
      description: z.string(),
      validationMetric: z.string(),
    }),
  ),
  caveats: z.array(z.string()),
  suggestedQuestions: z.array(z.string()),
});
export type BiAnswer = z.infer<typeof BiAnswerSchema>;

export const StoredMessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  role: z.enum(["user", "assistant"]),
  status: z.enum(["completed", "incomplete", "failed"]),
  text: z.string().nullable(),
  answer: BiAnswerSchema.nullable(),
  createdAt: z.string(),
});
export type StoredMessage = z.infer<typeof StoredMessageSchema>;

export const BiConversationStateSchema = z.object({
  intent: z.string().optional(),
  metric: z.string().optional(),
  dimension: z.string().optional(),
  dateRange: z.object({ start: z.string(), end: z.string() }).optional(),
  shopIds: z.array(z.string()).optional(),
  platforms: z.array(PlatformSchema).optional(),
  previousDatasetId: z.string().optional(),
});
export type BiConversationState = z.infer<typeof BiConversationStateSchema>;

export const AgentRunRequestSchema = z.object({
  requestId: z.string(),
  runId: z.string(),
  conversationId: z.string(),
  principal: z.object({
    userId: z.string(),
    tenantId: z.string(),
    permissionSnapshotId: z.string(),
  }),
  entitlement: z.object({
    quotaReservationId: z.string(),
    capabilities: z.array(z.string()),
  }),
  preferences: z.object({
    locale: z.string(),
    timezone: z.string(),
    currency: z.string(),
  }),
  message: z.string().min(1).max(2_000),
  context: z.object({
    recentMessages: z.array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string(),
      }),
    ),
    biState: BiConversationStateSchema,
  }),
  execution: z
    .object({
      modelProfileId: z.string().min(1).optional(),
    })
    .optional(),
});
export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>;

export const AgentRunConfigSnapshotSchema = z.object({
  mode: z.enum(["mock", "pi"]),
  profileId: z.string(),
  profileVersion: z.string(),
  promptId: z.string(),
  promptVersion: z.string(),
  provider: z.string(),
  model: z.string(),
  configHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type AgentRunConfigSnapshot = z.infer<typeof AgentRunConfigSnapshotSchema>;

export const AgentRunAttemptSchema = z.object({
  id: z.string(),
  runId: z.string(),
  attempt: z.number().int().positive(),
  config: AgentRunConfigSnapshotSchema,
  status: z.enum(["running", "completed", "failed"]),
  errorCode: z.string().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
});
export type AgentRunAttempt = z.infer<typeof AgentRunAttemptSchema>;

export const BiQueryIntentSchema = z.enum([
  "overview",
  "refund-ranking",
  "revenue-trend",
  "response-ranking",
  "complaint-analysis",
]);
export type BiQueryIntent = z.infer<typeof BiQueryIntentSchema>;

export const BiQueryRequestSchema = z.object({
  permissionSnapshotId: z.string(),
  intent: BiQueryIntentSchema,
  days: z.number().int().min(7).max(90),
  currency: z.string(),
  timezone: z.string(),
});
export type BiQueryRequest = z.infer<typeof BiQueryRequestSchema>;

export const BiQueryResultSchema = z.object({
  datasetId: z.string(),
  intent: BiQueryIntentSchema,
  scope: ScopeSchema,
  shops: z.array(ShopSchema),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
  totals: z.record(z.string(), z.number()),
  previousTotals: z.record(z.string(), z.number()),
});
export type BiQueryResult = z.infer<typeof BiQueryResultSchema>;

export const ToolStartedEventSchema = z.object({
  type: z.literal("tool.started"),
  runId: z.string(),
  timestamp: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  arguments: z.record(z.string(), z.unknown()),
});

export const ToolCompletedEventSchema = z.object({
  type: z.literal("tool.completed"),
  runId: z.string(),
  timestamp: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  status: z.enum(["completed", "failed"]),
  durationMs: z.number().int().nonnegative(),
  output: z.unknown().optional(),
  error: z.string().optional(),
});

export const AgentEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("run.started"),
    runId: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("run.configured"),
    runId: z.string(),
    timestamp: z.string(),
    config: AgentRunConfigSnapshotSchema,
  }),
  z.object({
    type: z.literal("analysis.step"),
    runId: z.string(),
    timestamp: z.string(),
    step: z.enum(["intent", "permission", "query", "analysis", "render"]),
    label: z.string(),
    status: z.enum(["running", "completed"]),
  }),
  z.object({
    type: z.literal("answer.delta"),
    runId: z.string(),
    timestamp: z.string(),
    delta: z.string(),
  }),
  ToolStartedEventSchema,
  ToolCompletedEventSchema,
  z.object({
    type: z.literal("answer.completed"),
    runId: z.string(),
    timestamp: z.string(),
    answer: BiAnswerSchema,
    biState: BiConversationStateSchema,
    usage: z.object({
      provider: z.string(),
      model: z.string(),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      credits: z.number().int().nonnegative(),
    }),
  }),
  z.object({
    type: z.literal("run.failed"),
    runId: z.string(),
    timestamp: z.string(),
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }),
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;

export const ToolTraceEventSchema = z.union([ToolStartedEventSchema, ToolCompletedEventSchema]);
export type ToolTraceEvent = z.infer<typeof ToolTraceEventSchema>;

export const EvalCategorySchema = z.enum([
  "overview",
  "ranking",
  "trend",
  "follow-up",
  "boundary",
  "security",
  "multilingual",
]);
export type EvalCategory = z.infer<typeof EvalCategorySchema>;

export const EvalExpectationsSchema = z.object({
  expectedIntent: BiQueryIntentSchema,
  expectedDays: z.number().int().min(7).max(90),
  expectedAnswerType: z.enum(["overview", "ranking", "trend", "analysis"]),
  expectedToolName: z.string(),
  minToolCalls: z.number().int().nonnegative(),
  maxToolCalls: z.number().int().nonnegative(),
  expectedShopCount: z.number().int().nonnegative(),
  requireEvidence: z.boolean(),
  forbiddenPatterns: z.array(z.string()),
});
export type EvalExpectations = z.infer<typeof EvalExpectationsSchema>;

export const EvalCaseSchema = z.object({
  id: z.string(),
  datasetId: z.string(),
  name: z.string(),
  category: EvalCategorySchema,
  input: z.string(),
  context: z.object({
    recentMessages: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string() })),
    biState: BiConversationStateSchema,
  }),
  expectations: EvalExpectationsSchema,
  tags: z.array(z.string()),
  enabled: z.boolean(),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const EvalDatasetSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string(),
  status: z.enum(["draft", "published", "archived"]),
  caseCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type EvalDataset = z.infer<typeof EvalDatasetSchema>;

export const EvalDatasetDetailSchema = EvalDatasetSchema.extend({ cases: z.array(EvalCaseSchema) });
export type EvalDatasetDetail = z.infer<typeof EvalDatasetDetailSchema>;

export const EvalAssertionSchema = z.object({
  key: z.string(),
  label: z.string(),
  passed: z.boolean(),
  expected: z.unknown(),
  actual: z.unknown(),
});
export type EvalAssertion = z.infer<typeof EvalAssertionSchema>;

export const EvalRunSchema = z.object({
  id: z.string(),
  datasetId: z.string(),
  datasetName: z.string(),
  datasetVersion: z.string(),
  mode: z.enum(["mock", "pi"]),
  requestedProfileId: z.string().nullable(),
  status: z.enum(["queued", "running", "completed", "failed"]),
  totalCases: z.number().int().nonnegative(),
  passedCases: z.number().int().nonnegative(),
  failedCases: z.number().int().nonnegative(),
  score: z.number().min(0).max(1).nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type EvalRun = z.infer<typeof EvalRunSchema>;

export const EvalCaseResultSchema = z.object({
  id: z.string(),
  evalRunId: z.string(),
  caseId: z.string(),
  caseName: z.string(),
  category: EvalCategorySchema,
  agentRunId: z.string(),
  status: z.enum(["passed", "failed", "error"]),
  score: z.number().min(0).max(1),
  durationMs: z.number().int().nonnegative(),
  answer: BiAnswerSchema.nullable(),
  assertions: z.array(EvalAssertionSchema),
  attempts: z.array(AgentRunAttemptSchema),
  traces: z.array(ToolTraceEventSchema),
  errorCode: z.string().nullable(),
});
export type EvalCaseResult = z.infer<typeof EvalCaseResultSchema>;

export const EvalRunDetailSchema = EvalRunSchema.extend({ results: z.array(EvalCaseResultSchema) });
export type EvalRunDetail = z.infer<typeof EvalRunDetailSchema>;

export const EvalOverviewSchema = z.object({
  datasetCount: z.number().int().nonnegative(),
  caseCount: z.number().int().nonnegative(),
  runCount: z.number().int().nonnegative(),
  latestPassRate: z.number().min(0).max(1).nullable(),
  categoryCounts: z.array(z.object({ category: EvalCategorySchema, count: z.number().int() })),
});
export type EvalOverview = z.infer<typeof EvalOverviewSchema>;

export const AgentConfigCatalogSchema = z.object({
  mode: z.enum(["mock", "pi"]),
  selectedProfileId: z.string(),
  profiles: z.array(
    z.object({
      id: z.string(),
      version: z.string(),
      adapter: z.string(),
      promptId: z.string(),
      promptVersion: z.string(),
      thinkingLevel: z.string(),
      contextWindow: z.number().int(),
      maxTokens: z.number().int(),
      recentMessageLimit: z.number().int(),
      timeoutMs: z.number().int(),
      fallbackProfileId: z.string().nullable(),
      configured: z.boolean(),
    }),
  ),
  policy: z.object({
    toolName: z.string(),
    minQueryDays: z.number().int(),
    maxQueryDays: z.number().int(),
    allowedIntents: z.array(BiQueryIntentSchema),
    allowRawSql: z.boolean(),
    requirePermissionSnapshot: z.boolean(),
  }),
});
export type AgentConfigCatalog = z.infer<typeof AgentConfigCatalogSchema>;

export const BootstrapResponseSchema = z.object({
  user: UserSchema,
  quotaBalance: z.number(),
  shops: z.array(ShopSchema),
  conversations: z.array(ConversationSchema),
  suggestedQuestions: z.array(z.string()),
});
export type BootstrapResponse = z.infer<typeof BootstrapResponseSchema>;

export const DEMO_USER_ID = "user_demo";
export const DEFAULT_SUGGESTED_QUESTIONS = [
  "最近 30 天哪些店铺退款率最高？",
  "分析最近 30 天销售额趋势",
  "哪些店铺的客服响应时间需要关注？",
  "总结最近 30 天的经营情况",
];
