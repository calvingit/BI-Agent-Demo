import type { BiQueryIntent } from "@bi-agent/contracts";

/**
 * Security and business invariants are deliberately kept outside model profiles.
 * A prompt or deployment configuration must never weaken these values.
 */
export const BI_AGENT_POLICY = {
  toolName: "query_business_metrics",
  minQueryDays: 7,
  maxQueryDays: 90,
  allowedIntents: [
    "overview",
    "refund-ranking",
    "revenue-trend",
    "response-ranking",
    "complaint-analysis",
  ] satisfies readonly BiQueryIntent[],
  allowRawSql: false,
  requirePermissionSnapshot: true,
} as const;

