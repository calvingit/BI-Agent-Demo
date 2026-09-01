import {
  AgentEventSchema,
  AgentConfigCatalogSchema,
  BootstrapResponseSchema,
  EvalDatasetDetailSchema,
  EvalDatasetSchema,
  EvalOverviewSchema,
  EvalRunDetailSchema,
  EvalRunSchema,
  StoredMessageSchema,
  type AgentEvent,
  type AgentConfigCatalog,
  type BootstrapResponse,
  type Conversation,
  type EvalDataset,
  type EvalDatasetDetail,
  type EvalOverview,
  type EvalRun,
  type EvalRunDetail,
  type StoredMessage,
} from "@bi-agent/contracts";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const headers = {
  "content-type": "application/json",
  "x-demo-user-id": "user_demo",
};

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

export async function getBootstrap(): Promise<BootstrapResponse> {
  return BootstrapResponseSchema.parse(
    await json(await fetch(`${API_BASE}/api/bootstrap`, { headers })),
  );
}

export async function getMessages(conversationId: string): Promise<StoredMessage[]> {
  const result = await json<unknown[]>(
    await fetch(`${API_BASE}/api/conversations/${conversationId}/messages`, { headers }),
  );
  return result.map((item) => StoredMessageSchema.parse(item));
}

export async function createConversation(): Promise<Conversation> {
  return json(
    await fetch(`${API_BASE}/api/conversations`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "新的经营分析" }),
    }),
  );
}

export async function streamMessage(input: {
  conversationId: string;
  message: string;
  onEvent: (event: AgentEvent) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const response = await fetch(
    `${API_BASE}/api/conversations/${input.conversationId}/messages`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ message: input.message }),
      ...(input.signal ? { signal: input.signal } : {}),
    },
  );
  if (!response.ok || !response.body) {
    throw new Error(`${response.status}: ${await response.text()}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) input.onEvent(AgentEventSchema.parse(JSON.parse(line)));
    }
  }
}

export async function cancelRun(runId: string): Promise<void> {
  await json(
    await fetch(`${API_BASE}/api/runs/${runId}/cancel`, {
      method: "POST",
      headers,
    }),
  );
}

export async function getAgentConfig(): Promise<AgentConfigCatalog> {
  return AgentConfigCatalogSchema.parse(
    await json(await fetch(`${API_BASE}/api/admin/agent-config`, { headers })),
  );
}

export async function getEvalOverview(): Promise<EvalOverview> {
  return EvalOverviewSchema.parse(
    await json(await fetch(`${API_BASE}/api/admin/evals/overview`, { headers })),
  );
}

export async function getEvalDatasets(): Promise<EvalDataset[]> {
  const result = await json<unknown[]>(
    await fetch(`${API_BASE}/api/admin/evals/datasets`, { headers }),
  );
  return result.map((item) => EvalDatasetSchema.parse(item));
}

export async function getEvalDataset(datasetId: string): Promise<EvalDatasetDetail> {
  return EvalDatasetDetailSchema.parse(
    await json(await fetch(`${API_BASE}/api/admin/evals/datasets/${datasetId}`, { headers })),
  );
}

export async function getEvalRuns(): Promise<EvalRun[]> {
  const result = await json<unknown[]>(
    await fetch(`${API_BASE}/api/admin/evals/runs`, { headers }),
  );
  return result.map((item) => EvalRunSchema.parse(item));
}

export async function getEvalRun(runId: string): Promise<EvalRunDetail> {
  return EvalRunDetailSchema.parse(
    await json(await fetch(`${API_BASE}/api/admin/evals/runs/${runId}`, { headers })),
  );
}

export async function startEvalRun(input: {
  datasetId: string;
  profileId?: string;
  concurrency?: number;
}): Promise<EvalRun> {
  return EvalRunSchema.parse(
    await json(
      await fetch(`${API_BASE}/api/admin/evals/runs`, {
        method: "POST",
        headers,
        body: JSON.stringify(input),
      }),
    ),
  );
}
