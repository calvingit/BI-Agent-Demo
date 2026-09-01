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
