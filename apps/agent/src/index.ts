import { serve } from "@hono/node-server";
import { AgentRunRequestSchema, type AgentEvent } from "@bi-agent/contracts";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { Hono } from "hono";
import {
  getSelectedProfileId,
  isProfileConfigured,
  listModelProfiles,
} from "./config/model-profiles.js";
import { BI_AGENT_POLICY } from "./config/policy.js";
import { runAgent } from "./runtime.js";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const port = Number(process.env.AGENT_PORT ?? 4001);
const internalToken = process.env.INTERNAL_SERVICE_TOKEN ?? "local-demo-token";
const agentMode = process.env.AGENT_MODE ?? "mock";
const app = new Hono();

app.get("/health", (c) =>
  c.json({
    service: "bi-agent",
    status: "ok",
    mode: agentMode,
    profile: agentMode === "pi" ? getSelectedProfileId() : "deterministic-demo-v1",
  }),
);

app.get("/internal/config", (c) => {
  if (c.req.header("x-internal-token") !== internalToken) {
    return c.json({ error: "UNAUTHORIZED" }, 401);
  }
  return c.json({
    mode: agentMode,
    selectedProfileId: agentMode === "pi" ? getSelectedProfileId() : "deterministic-demo-v1",
    profiles: listModelProfiles().map((profile) => ({
      id: profile.id,
      version: profile.version,
      adapter: profile.adapter,
      promptId: profile.prompt.id,
      promptVersion: profile.prompt.version,
      thinkingLevel: profile.agent.thinkingLevel,
      contextWindow: profile.model.contextWindow,
      maxTokens: profile.model.maxTokens,
      recentMessageLimit: profile.agent.recentMessageLimit,
      timeoutMs: profile.reliability.timeoutMs,
      fallbackProfileId: profile.reliability.fallbackProfileId,
      configured: isProfileConfigured(profile.id),
    })),
    policy: BI_AGENT_POLICY,
  });
});

app.post("/internal/runs", async (c) => {
  if (c.req.header("x-internal-token") !== internalToken) {
    return c.json({ error: "UNAUTHORIZED" }, 401);
  }
  const parsed = AgentRunRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: "INVALID_REQUEST", details: parsed.error.flatten() }, 400);
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of runAgent(parsed.data, c.req.raw.signal)) {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
      } catch (error) {
        const failed: AgentEvent = {
          type: "run.failed",
          runId: parsed.data.runId,
          timestamp: new Date().toISOString(),
          code: error instanceof DOMException && error.name === "AbortError" ? "RUN_CANCELLED" : "AGENT_FAILED",
          message: error instanceof Error ? error.message : "Unknown agent error",
          retryable: !(error instanceof DOMException && error.name === "AbortError"),
        };
        controller.enqueue(encoder.encode(`${JSON.stringify(failed)}\n`));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
    },
  });
});

serve({ fetch: app.fetch, port }, () => {
  console.log(`BI Agent service listening on http://localhost:${port}`);
});
