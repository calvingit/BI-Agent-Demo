import {
  BiQueryRequestSchema,
  BiQueryResultSchema,
  type BiQueryIntent,
  type BiQueryResult,
} from "@bi-agent/contracts";

export async function queryBusinessData(input: {
  permissionSnapshotId: string;
  intent: BiQueryIntent;
  days: number;
  currency: string;
  timezone: string;
  signal?: AbortSignal;
}): Promise<BiQueryResult> {
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4000";
  const internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN ?? "local-demo-token";
  const request = BiQueryRequestSchema.parse({
    permissionSnapshotId: input.permissionSnapshotId,
    intent: input.intent,
    days: input.days,
    currency: input.currency,
    timezone: input.timezone,
  });
  const response = await fetch(`${apiBaseUrl}/internal/bi/query`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-token": internalServiceToken,
    },
    body: JSON.stringify(request),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`BI_QUERY_FAILED:${response.status}:${body}`);
  }
  return BiQueryResultSchema.parse(await response.json());
}
