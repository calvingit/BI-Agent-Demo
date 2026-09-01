import { describe, expect, it } from "vitest";
import {
  createAgentRun,
  appendAgentRunAttempt,
  appendAgentTraceEvent,
  createMessage,
  createPermissionSnapshot,
  executeBiQuery,
  getAgentRunConfig,
  getEvalDataset,
  getEvalOverview,
  getPermissionSnapshot,
  getUserShops,
  seedDemoData,
  updateAgentRunConfig,
  listAgentRunAttempts,
  listAgentTraceEvents,
} from "./index.js";

describe("BI query authorization", () => {
  seedDemoData(true);

  it("resolves shop scope only through a permission snapshot", () => {
    const snapshotId = createPermissionSnapshot("user_demo");
    const snapshot = getPermissionSnapshot(snapshotId);
    expect(snapshot?.shopIds).toHaveLength(3);
    expect(snapshot?.shopIds).toEqual(getUserShops("user_demo").map((shop) => shop.id));
  });

  it("returns deterministic aggregates and visible query scope", () => {
    const permissionSnapshotId = createPermissionSnapshot("user_demo");
    const result = executeBiQuery({
      permissionSnapshotId,
      intent: "refund-ranking",
      days: 30,
      currency: "SGD",
      timezone: "Asia/Singapore",
    });
    expect(result.rows).toHaveLength(3);
    expect(result.scope.shopIds).toHaveLength(3);
    expect(result.scope.currency).toBe("SGD");
    expect(result.totals.orders).toBeGreaterThan(0);
  });

  it("rejects unknown permission snapshots", () => {
    expect(() =>
      executeBiQuery({
        permissionSnapshotId: "perm_invalid",
        intent: "overview",
        days: 30,
        currency: "SGD",
        timezone: "Asia/Singapore",
      }),
    ).toThrow("PERMISSION_DENIED");
  });

  it("stores the model and prompt configuration used by a run", () => {
    const runId = "run_config_snapshot_test";
    const userMessageId = createMessage({
      conversationId: "conv_demo",
      role: "user",
      text: "测试配置快照",
    });
    createAgentRun({
      runId,
      conversationId: "conv_demo",
      userMessageId,
      reservedCredits: 8,
    });
    updateAgentRunConfig(runId, {
      mode: "pi",
      profileId: "openai-compatible-bi-v1",
      profileVersion: "1.0.0",
      promptId: "bi-analyst-openai",
      promptVersion: "1.0.0",
      provider: "duoke-primary-gateway",
      model: "test-model",
      configHash: "a".repeat(64),
    });
    expect(getAgentRunConfig(runId)).toMatchObject({
      profileId: "openai-compatible-bi-v1",
      promptVersion: "1.0.0",
      model: "test-model",
    });
    const config = getAgentRunConfig(runId)!;
    appendAgentRunAttempt(runId, config);
    appendAgentTraceEvent(runId, {
      type: "tool.started",
      runId,
      timestamp: new Date().toISOString(),
      toolCallId: "tool_test",
      toolName: "query_business_metrics",
      arguments: { intent: "overview", days: 30 },
    });
    expect(listAgentRunAttempts(runId)).toHaveLength(1);
    expect(listAgentTraceEvents(runId)).toHaveLength(1);
  });

  it("seeds a versioned core evaluation dataset", () => {
    const overview = getEvalOverview();
    const dataset = getEvalDataset("eval_ds_core_v1");
    expect(overview.datasetCount).toBe(1);
    expect(overview.caseCount).toBe(24);
    expect(dataset?.version).toBe("1.0.0");
    expect(dataset?.cases.some((item) => item.category === "security")).toBe(true);
  });
});
