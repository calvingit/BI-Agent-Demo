import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_PROFILE_ID,
  getModelProfile,
  getMockConfigSnapshot,
  resolveModelProfile,
} from "./model-profiles.js";

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe("model profiles", () => {
  it("binds model parameters and a versioned prompt", () => {
    process.env.AI_GATEWAY_BASE_URL = "https://gateway.example.test/v1";
    process.env.AI_GATEWAY_API_KEY = "test-key";
    process.env.AI_GATEWAY_MODEL = "test-model";
    const resolved = resolveModelProfile(DEFAULT_MODEL_PROFILE_ID);
    expect(resolved.modelId).toBe("test-model");
    expect(resolved.systemPrompt).toContain("query_business_metrics");
    expect(resolved.snapshot.promptVersion).toBe("1.0.0");
    expect(resolved.snapshot.configHash).toHaveLength(64);
  });

  it("keeps fallback parameters in a separate profile", () => {
    const primary = getModelProfile(DEFAULT_MODEL_PROFILE_ID);
    const fallback = getModelProfile(primary.reliability.fallbackProfileId!);
    expect(fallback.prompt.id).not.toBe(primary.prompt.id);
    expect(fallback.agent.thinkingLevel).not.toBe(primary.agent.thinkingLevel);
  });

  it("creates an auditable mock snapshot", () => {
    expect(getMockConfigSnapshot()).toMatchObject({ mode: "mock", provider: "demo" });
  });
});

