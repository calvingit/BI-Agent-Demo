import { z } from "zod";

export const ThinkingLevelSchema = z.enum([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export const ModelProfileSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  adapter: z.literal("openai-completions"),
  deployment: z.object({
    providerId: z.string().min(1),
    providerName: z.string().min(1),
    baseUrlEnv: z.string().min(1),
    apiKeyEnv: z.string().min(1),
    modelIdEnv: z.string().min(1),
  }),
  prompt: z.object({
    id: z.string().min(1),
    version: z.string().min(1),
  }),
  model: z.object({
    reasoning: z.boolean(),
    contextWindow: z.number().int().positive(),
    maxTokens: z.number().int().positive(),
  }),
  agent: z.object({
    thinkingLevel: ThinkingLevelSchema,
    recentMessageLimit: z.number().int().min(0).max(20),
    maxSummaryCharacters: z.number().int().min(50).max(1_000),
    maxRetryDelayMs: z.number().int().positive(),
  }),
  tools: z.object({
    executionMode: z.literal("sequential"),
    requireBusinessMetricsTool: z.literal(true),
  }),
  reliability: z.object({
    timeoutMs: z.number().int().min(1_000).max(120_000),
    fallbackProfileId: z.string().min(1).nullable(),
  }),
});

export type ModelProfile = z.infer<typeof ModelProfileSchema>;

export const PromptDefinitionSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  template: z.string().min(1),
});

export type PromptDefinition = z.infer<typeof PromptDefinitionSchema>;

