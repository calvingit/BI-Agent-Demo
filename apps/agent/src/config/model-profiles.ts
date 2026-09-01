import type { AgentRunConfigSnapshot } from "@bi-agent/contracts";
import { createHash } from "node:crypto";
import { getPromptDefinition, renderPrompt } from "./prompts.js";
import { BI_AGENT_POLICY } from "./policy.js";
import { ModelProfileSchema, type ModelProfile } from "./schema.js";

export const DEFAULT_MODEL_PROFILE_ID = "openai-compatible-bi-v1";

const profileDefinitions = [
  {
    id: DEFAULT_MODEL_PROFILE_ID,
    version: "1.0.0",
    adapter: "openai-completions",
    deployment: {
      providerId: "duoke-primary-gateway",
      providerName: "Duoke Primary AI Gateway",
      baseUrlEnv: "AI_GATEWAY_BASE_URL",
      apiKeyEnv: "AI_GATEWAY_API_KEY",
      modelIdEnv: "AI_GATEWAY_MODEL",
    },
    prompt: { id: "bi-analyst-openai", version: "1.0.0" },
    model: { reasoning: true, contextWindow: 128_000, maxTokens: 8_192 },
    agent: {
      thinkingLevel: "medium",
      recentMessageLimit: 6,
      maxSummaryCharacters: 120,
      maxRetryDelayMs: 5_000,
    },
    tools: { executionMode: "sequential", requireBusinessMetricsTool: true },
    reliability: { timeoutMs: 30_000, fallbackProfileId: "deepseek-compatible-bi-v1" },
  },
  {
    id: "deepseek-compatible-bi-v1",
    version: "1.0.0",
    adapter: "openai-completions",
    deployment: {
      providerId: "duoke-deepseek-gateway",
      providerName: "Duoke DeepSeek AI Gateway",
      baseUrlEnv: "DEEPSEEK_GATEWAY_BASE_URL",
      apiKeyEnv: "DEEPSEEK_GATEWAY_API_KEY",
      modelIdEnv: "DEEPSEEK_GATEWAY_MODEL",
    },
    prompt: { id: "bi-analyst-deepseek", version: "1.0.0" },
    model: { reasoning: true, contextWindow: 64_000, maxTokens: 4_096 },
    agent: {
      thinkingLevel: "low",
      recentMessageLimit: 4,
      maxSummaryCharacters: 120,
      maxRetryDelayMs: 5_000,
    },
    tools: { executionMode: "sequential", requireBusinessMetricsTool: true },
    reliability: { timeoutMs: 30_000, fallbackProfileId: null },
  },
] satisfies ModelProfile[];

const profileRegistry = new Map(
  profileDefinitions.map((definition) => {
    const parsed = ModelProfileSchema.parse(definition);
    return [parsed.id, parsed] as const;
  }),
);

export interface ResolvedModelProfile {
  profile: ModelProfile;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  systemPrompt: string;
  snapshot: AgentRunConfigSnapshot;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`PI_CONFIG_MISSING:${name}`);
  return value;
}

export function getModelProfile(profileId: string): ModelProfile {
  const profile = profileRegistry.get(profileId);
  if (!profile) throw new Error(`MODEL_PROFILE_NOT_FOUND:${profileId}`);
  return profile;
}

export function listModelProfiles(): ModelProfile[] {
  return [...profileRegistry.values()];
}

export function isProfileConfigured(profileId: string): boolean {
  const profile = getModelProfile(profileId);
  return [
    profile.deployment.baseUrlEnv,
    profile.deployment.apiKeyEnv,
    profile.deployment.modelIdEnv,
  ].every((name) => Boolean(process.env[name]));
}

export function resolveModelProfile(profileId: string): ResolvedModelProfile {
  const profile = getModelProfile(profileId);
  const prompt = getPromptDefinition(profile.prompt.id, profile.prompt.version);
  const baseUrl = requiredEnvironment(profile.deployment.baseUrlEnv);
  const apiKey = requiredEnvironment(profile.deployment.apiKeyEnv);
  const modelId = requiredEnvironment(profile.deployment.modelIdEnv);
  const systemPrompt = renderPrompt(prompt, {
    toolName: BI_AGENT_POLICY.toolName,
    minDays: BI_AGENT_POLICY.minQueryDays,
    maxDays: BI_AGENT_POLICY.maxQueryDays,
    maxSummaryCharacters: profile.agent.maxSummaryCharacters,
  });
  const hashInput = JSON.stringify({ profile, modelId, systemPrompt });
  const configHash = createHash("sha256").update(hashInput).digest("hex");
  return {
    profile,
    baseUrl,
    apiKey,
    modelId,
    systemPrompt,
    snapshot: {
      mode: "pi",
      profileId: profile.id,
      profileVersion: profile.version,
      promptId: prompt.id,
      promptVersion: prompt.version,
      provider: profile.deployment.providerId,
      model: modelId,
      configHash,
    },
  };
}

export function getSelectedProfileId(): string {
  return process.env.AGENT_MODEL_PROFILE ?? DEFAULT_MODEL_PROFILE_ID;
}

export function getMockConfigSnapshot(): AgentRunConfigSnapshot {
  const identity = {
    mode: "mock" as const,
    profileId: "deterministic-demo-v1",
    profileVersion: "1.0.0",
    promptId: "none",
    promptVersion: "none",
    provider: "demo",
    model: "deterministic-mock",
  };
  return {
    ...identity,
    configHash: createHash("sha256").update(JSON.stringify(identity)).digest("hex"),
  };
}
