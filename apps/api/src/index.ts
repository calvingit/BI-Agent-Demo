import { serve } from "@hono/node-server";
import {
  AgentEventSchema,
  AgentRunRequestSchema,
  BiQueryRequestSchema,
  DEFAULT_SUGGESTED_QUESTIONS,
  DEMO_USER_ID,
  type AgentEvent,
  type AgentRunRequest,
} from "@bi-agent/contracts";
import {
  createAgentRun,
  createConversation,
  createMessage,
  createPermissionSnapshot,
  executeBiQuery,
  getConversation,
  getConversationState,
  getQuotaBalance,
  getUser,
  getUserShops,
  listConversations,
  listMessages,
  refundQuota,
  reserveQuota,
  settleQuota,
  updateAgentRun,
  updateConversationState,
} from "@bi-agent/database";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { cors } from "hono/cors";
import { Hono } from "hono";
import { z } from "zod";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const port = Number(process.env.API_PORT ?? 4000);
const agentBaseUrl = process.env.AGENT_BASE_URL ?? "http://localhost:4001";
const internalToken = process.env.INTERNAL_SERVICE_TOKEN ?? "local-demo-token";
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
const reservedCredits = 8;

type Variables = { userId: string };
const app = new Hono<{ Variables: Variables }>();
const activeRuns = new Map<string, { userId: string; controller: AbortController }>();

app.use(
  "*",
  cors({
    origin: webOrigin,
    allowHeaders: ["content-type", "x-demo-user-id", "x-request-id"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    exposeHeaders: ["x-request-id"],
  }),
);

app.use("/api/*", async (c, next) => {
  const userId = c.req.header("x-demo-user-id") ?? DEMO_USER_ID;
  if (!getUser(userId)) return c.json({ error: "UNAUTHENTICATED" }, 401);
  c.set("userId", userId);
  await next();
});

app.get("/health", (c) => c.json({ service: "business-api", status: "ok" }));

app.get("/api/bootstrap", (c) => {
  const userId = c.get("userId");
  const user = getUser(userId);
  if (!user) return c.json({ error: "USER_NOT_FOUND" }, 404);
  return c.json({
    user,
    quotaBalance: getQuotaBalance(userId),
    shops: getUserShops(userId),
    conversations: listConversations(userId),
    suggestedQuestions: DEFAULT_SUGGESTED_QUESTIONS,
  });
});

app.get("/api/conversations", (c) => c.json(listConversations(c.get("userId"))));

app.post("/api/conversations", async (c) => {
  const body = z.object({ title: z.string().min(1).max(80).optional() }).parse(await c.req.json());
  return c.json(createConversation(c.get("userId"), body.title), 201);
});

app.get("/api/conversations/:conversationId/messages", (c) => {
  const userId = c.get("userId");
  const conversationId = c.req.param("conversationId");
  if (!getConversation(userId, conversationId)) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json(listMessages(conversationId));
});

app.post("/api/runs/:runId/cancel", (c) => {
  const runId = c.req.param("runId");
  const run = activeRuns.get(runId);
  if (!run || run.userId !== c.get("userId")) return c.json({ error: "RUN_NOT_ACTIVE" }, 404);
  run.controller.abort();
  return c.json({ runId, status: "cancelling" });
});

app.post("/api/conversations/:conversationId/messages", async (c) => {
  const userId = c.get("userId");
  const user = getUser(userId);
  const conversationId = c.req.param("conversationId");
  if (!user || !getConversation(userId, conversationId)) return c.json({ error: "NOT_FOUND" }, 404);
  const body = z.object({ message: z.string().trim().min(1).max(2_000) }).parse(await c.req.json());
  const requestId = c.req.header("x-request-id") ?? `req_${randomUUID()}`;
  const runId = `run_${randomUUID()}`;
  const userMessageId = createMessage({ conversationId, role: "user", text: body.message });
  const permissionSnapshotId = createPermissionSnapshot(userId);
  let quotaReservationId: string;
  try {
    quotaReservationId = reserveQuota(userId, runId, reservedCredits);
  } catch (error) {
    if (error instanceof Error && error.message === "INSUFFICIENT_QUOTA") {
      return c.json({ error: "INSUFFICIENT_QUOTA" }, 402);
    }
    throw error;
  }
  createAgentRun({ runId, conversationId, userMessageId, reservedCredits });
  updateAgentRun({ runId, status: "running" });

  const recentMessages = listMessages(conversationId, 8)
    .filter((message) => message.id !== userMessageId)
    .slice(-6)
    .map((message) => ({
      role: message.role,
      text: message.text ?? message.answer?.summary ?? "",
    }));
  const agentRequest: AgentRunRequest = AgentRunRequestSchema.parse({
    requestId,
    runId,
    conversationId,
    principal: { userId, tenantId: user.tenantId, permissionSnapshotId },
    entitlement: {
      quotaReservationId,
      capabilities: ["overview", "ranking", "trend", "analysis"],
    },
    preferences: { locale: user.locale, timezone: user.timezone, currency: user.currency },
    message: body.message,
    context: { recentMessages, biState: getConversationState(conversationId) },
  });

  const runController = new AbortController();
  activeRuns.set(runId, { userId, controller: runController });
  c.req.raw.signal.addEventListener("abort", () => runController.abort(), { once: true });
  const encoder = new TextEncoder();
  const responseStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let terminal = false;
      const send = (event: AgentEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        const response = await fetch(`${agentBaseUrl}/internal/runs`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-internal-token": internalToken,
          },
          body: JSON.stringify(agentRequest),
          signal: runController.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(`AGENT_UNAVAILABLE:${response.status}:${await response.text()}`);
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
            if (!line.trim()) continue;
            const event = AgentEventSchema.parse(JSON.parse(line));
            send(event);
            if (event.type === "answer.completed") {
              const assistantMessageId = createMessage({
                conversationId,
                role: "assistant",
                text: event.answer.summary,
                answer: event.answer,
              });
              updateConversationState(conversationId, event.biState);
              settleQuota({
                userId,
                runId,
                reservationId: quotaReservationId,
                reserved: reservedCredits,
                used: event.usage.credits,
              });
              updateAgentRun({
                runId,
                status: "completed",
                assistantMessageId,
                usedCredits: event.usage.credits,
              });
              terminal = true;
            } else if (event.type === "run.failed") {
              refundQuota({ userId, runId, reservationId: quotaReservationId, amount: reservedCredits });
              updateAgentRun({ runId, status: "failed", errorCode: event.code });
              terminal = true;
            }
          }
        }
        if (!terminal) throw new Error("AGENT_STREAM_INCOMPLETE");
      } catch (error) {
        if (!terminal) {
          const cancelled = runController.signal.aborted;
          refundQuota({ userId, runId, reservationId: quotaReservationId, amount: reservedCredits });
          updateAgentRun({
            runId,
            status: cancelled ? "cancelled" : "failed",
            errorCode: cancelled ? "RUN_CANCELLED" : "AGENT_GATEWAY_ERROR",
          });
          send({
            type: "run.failed",
            runId,
            timestamp: new Date().toISOString(),
            code: cancelled ? "RUN_CANCELLED" : "AGENT_GATEWAY_ERROR",
            message: cancelled
              ? "本次分析已停止。"
              : error instanceof Error
                ? error.message
                : "Unknown gateway error",
            retryable: !cancelled,
          });
        }
      } finally {
        activeRuns.delete(runId);
        controller.close();
      }
    },
    cancel() {
      runController.abort();
    },
  });
  return new Response(responseStream, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-request-id": requestId,
    },
  });
});

app.post("/internal/bi/query", async (c) => {
  if (c.req.header("x-internal-token") !== internalToken) {
    return c.json({ error: "UNAUTHORIZED" }, 401);
  }
  const parsed = BiQueryRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "INVALID_QUERY", details: parsed.error.flatten() }, 400);
  try {
    return c.json(executeBiQuery(parsed.data));
  } catch (error) {
    const code = error instanceof Error ? error.message : "BI_QUERY_FAILED";
    return c.json({ error: code }, code === "PERMISSION_DENIED" ? 403 : 500);
  }
});

app.onError((error, c) => {
  console.error(error);
  return c.json({ error: "INTERNAL_ERROR", message: error.message }, 500);
});

serve({ fetch: app.fetch, port }, () => {
  console.log(`Business API listening on http://localhost:${port}`);
});
