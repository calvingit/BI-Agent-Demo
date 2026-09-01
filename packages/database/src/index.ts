import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AgentRunConfigSnapshot,
  AgentRunAttempt,
  BiAnswer,
  BiConversationState,
  BiQueryRequest,
  BiQueryResult,
  Conversation,
  EvalAssertion,
  EvalCase,
  EvalCaseResult,
  EvalDataset,
  EvalDatasetDetail,
  EvalOverview,
  EvalRun,
  EvalRunDetail,
  Shop,
  StoredMessage,
  ToolTraceEvent,
  User,
} from "@bi-agent/contracts";
import { DEFAULT_EVAL_DATASET } from "./eval-seed.js";

const defaultDatabasePath = fileURLToPath(
  new URL("../../../data/bi-agent-demo.db", import.meta.url),
);
const databasePath = resolve(process.env.DATABASE_PATH ?? defaultDatabasePath);
mkdirSync(dirname(databasePath), { recursive: true });

export const sqlite = new Database(databasePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;

export function initializeDatabase(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      locale TEXT NOT NULL,
      timezone TEXT NOT NULL,
      currency TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shops (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      platform TEXT NOT NULL CHECK(platform IN ('shopee', 'tiktok')),
      country TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_shop_permissions (
      user_id TEXT NOT NULL REFERENCES users(id),
      shop_id TEXT NOT NULL REFERENCES shops(id),
      PRIMARY KEY (user_id, shop_id)
    );

    CREATE TABLE IF NOT EXISTS quota_accounts (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      balance INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quota_ledger (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      run_id TEXT,
      reservation_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('reserve', 'settle', 'release', 'refund')),
      amount INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      bi_state_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id),
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      status TEXT NOT NULL CHECK(status IN ('completed', 'incomplete', 'failed')),
      text TEXT,
      answer_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id),
      user_message_id TEXT NOT NULL REFERENCES messages(id),
      assistant_message_id TEXT,
      status TEXT NOT NULL,
      reserved_credits INTEGER NOT NULL,
      used_credits INTEGER,
      error_code TEXT,
      agent_mode TEXT,
      model_profile_id TEXT,
      model_profile_version TEXT,
      prompt_id TEXT,
      prompt_version TEXT,
      provider TEXT,
      model_id TEXT,
      config_hash TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_trace_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      tool_call_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      duration_ms INTEGER,
      status TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(run_id, sequence)
    );

    CREATE TABLE IF NOT EXISTS agent_run_attempts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      config_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
      error_code TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE(run_id, attempt)
    );

    CREATE TABLE IF NOT EXISTS eval_datasets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      version TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('draft', 'published', 'archived')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS eval_cases (
      id TEXT PRIMARY KEY,
      dataset_id TEXT NOT NULL REFERENCES eval_datasets(id),
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      input TEXT NOT NULL,
      context_json TEXT NOT NULL,
      expectations_json TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS eval_runs (
      id TEXT PRIMARY KEY,
      dataset_id TEXT NOT NULL REFERENCES eval_datasets(id),
      mode TEXT NOT NULL CHECK(mode IN ('mock', 'pi')),
      requested_profile_id TEXT,
      status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed')),
      total_cases INTEGER NOT NULL DEFAULT 0,
      passed_cases INTEGER NOT NULL DEFAULT 0,
      failed_cases INTEGER NOT NULL DEFAULT 0,
      score REAL,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS eval_case_results (
      id TEXT PRIMARY KEY,
      eval_run_id TEXT NOT NULL REFERENCES eval_runs(id),
      case_id TEXT NOT NULL REFERENCES eval_cases(id),
      agent_run_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('passed', 'failed', 'error')),
      score REAL NOT NULL,
      duration_ms INTEGER NOT NULL,
      answer_json TEXT,
      assertions_json TEXT NOT NULL,
      error_code TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(eval_run_id, case_id)
    );

    CREATE TABLE IF NOT EXISTS permission_snapshots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      tenant_id TEXT NOT NULL,
      shop_ids_json TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_shop_metrics (
      date TEXT NOT NULL,
      shop_id TEXT NOT NULL REFERENCES shops(id),
      orders INTEGER NOT NULL,
      revenue REAL NOT NULL,
      refunds INTEGER NOT NULL,
      complaints INTEGER NOT NULL,
      avg_response_minutes REAL NOT NULL,
      PRIMARY KEY (date, shop_id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_metrics_date_shop
      ON daily_shop_metrics(date, shop_id);
    CREATE INDEX IF NOT EXISTS idx_trace_events_run
      ON agent_trace_events(run_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_run_attempts_run
      ON agent_run_attempts(run_id, attempt);
    CREATE INDEX IF NOT EXISTS idx_eval_cases_dataset
      ON eval_cases(dataset_id, category);
    CREATE INDEX IF NOT EXISTS idx_eval_runs_created
      ON eval_runs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_eval_results_run
      ON eval_case_results(eval_run_id, created_at);
  `);

  const runColumns = new Set(
    (sqlite.prepare("PRAGMA table_info(agent_runs)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  const configColumns = [
    ["agent_mode", "TEXT"],
    ["model_profile_id", "TEXT"],
    ["model_profile_version", "TEXT"],
    ["prompt_id", "TEXT"],
    ["prompt_version", "TEXT"],
    ["provider", "TEXT"],
    ["model_id", "TEXT"],
    ["config_hash", "TEXT"],
  ] as const;
  for (const [column, type] of configColumns) {
    if (!runColumns.has(column)) sqlite.exec(`ALTER TABLE agent_runs ADD COLUMN ${column} ${type}`);
  }
}

export function seedDemoData(force = false): void {
  initializeDatabase();
  const existing = sqlite.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
  if (existing.count > 0 && !force) {
    seedDefaultEvalDataset();
    return;
  }

  const seed = sqlite.transaction(() => {
    sqlite.exec(`
      DELETE FROM eval_case_results;
      DELETE FROM eval_runs;
      DELETE FROM eval_cases;
      DELETE FROM eval_datasets;
      DELETE FROM agent_run_attempts;
      DELETE FROM agent_trace_events;
      DELETE FROM quota_ledger;
      DELETE FROM agent_runs;
      DELETE FROM messages;
      DELETE FROM conversations;
      DELETE FROM permission_snapshots;
      DELETE FROM daily_shop_metrics;
      DELETE FROM user_shop_permissions;
      DELETE FROM quota_accounts;
      DELETE FROM shops;
      DELETE FROM users;
    `);

    sqlite
      .prepare(
        "INSERT INTO users (id, tenant_id, name, locale, timezone, currency) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("user_demo", "tenant_duoke_demo", "Calvin Demo", "zh-CN", "Asia/Singapore", "SGD");

    const shops: Array<[string, string, string, string, string]> = [
      ["shop_shopee_sg", "tenant_duoke_demo", "Shopee 新加坡旗舰店", "shopee", "SG"],
      ["shop_tiktok_th", "tenant_duoke_demo", "TikTok 泰国直播店", "tiktok", "TH"],
      ["shop_shopee_my", "tenant_duoke_demo", "Shopee 马来西亚店", "shopee", "MY"],
    ];
    const insertShop = sqlite.prepare(
      "INSERT INTO shops (id, tenant_id, name, platform, country) VALUES (?, ?, ?, ?, ?)",
    );
    const insertPermission = sqlite.prepare(
      "INSERT INTO user_shop_permissions (user_id, shop_id) VALUES (?, ?)",
    );
    for (const shop of shops) {
      insertShop.run(...shop);
      insertPermission.run("user_demo", shop[0]);
    }

    sqlite.prepare("INSERT INTO quota_accounts (user_id, balance) VALUES (?, ?)").run("user_demo", 500);

    const createdAt = now();
    sqlite
      .prepare(
        "INSERT INTO conversations (id, user_id, title, bi_state_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("conv_demo", "user_demo", "经营分析示例", "{}", createdAt, createdAt);

    const insertMetric = sqlite.prepare(`
      INSERT INTO daily_shop_metrics
        (date, shop_id, orders, revenue, refunds, complaints, avg_response_minutes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const shopFactors = [
      { id: "shop_shopee_sg", base: 148, price: 22.6, refundRate: 0.038, response: 4.8 },
      { id: "shop_tiktok_th", base: 118, price: 17.4, refundRate: 0.071, response: 12.4 },
      { id: "shop_shopee_my", base: 92, price: 19.8, refundRate: 0.052, response: 8.2 },
    ];

    const today = new Date();
    for (let offset = 60; offset >= 1; offset -= 1) {
      const date = new Date(today);
      date.setUTCDate(today.getUTCDate() - offset);
      const dateText = date.toISOString().slice(0, 10);
      const weekday = date.getUTCDay();
      const weekendLift = weekday === 0 || weekday === 6 ? 1.18 : 1;
      for (const [shopIndex, shop] of shopFactors.entries()) {
        const wave = 1 + Math.sin((offset + shopIndex * 2) / 4) * 0.08;
        const growth = 1 + (60 - offset) * (shopIndex === 1 ? -0.0012 : 0.0018);
        const orders = Math.max(20, Math.round(shop.base * weekendLift * wave * growth));
        const refunds = Math.max(0, Math.round(orders * shop.refundRate * (1 + Math.cos(offset / 5) * 0.12)));
        const complaints = Math.max(0, Math.round(refunds * (shopIndex === 1 ? 0.34 : 0.2)));
        const revenue = Number((orders * shop.price * (0.94 + Math.sin(offset / 7) * 0.03)).toFixed(2));
        const response = Number((shop.response * (1 + Math.sin(offset / 6) * 0.15)).toFixed(1));
        insertMetric.run(dateText, shop.id, orders, revenue, refunds, complaints, response);
      }
    }
  });

  seed();
  seedDefaultEvalDataset();
}

export function seedDefaultEvalDataset(): void {
  const existing = sqlite
    .prepare("SELECT 1 AS found FROM eval_datasets WHERE id = ?")
    .get(DEFAULT_EVAL_DATASET.id) as { found: number } | undefined;
  if (existing) return;
  const insert = sqlite.transaction(() => {
    const createdAt = now();
    sqlite
      .prepare(`
        INSERT INTO eval_datasets (id, name, description, version, status, created_at)
        VALUES (?, ?, ?, ?, 'published', ?)
      `)
      .run(
        DEFAULT_EVAL_DATASET.id,
        DEFAULT_EVAL_DATASET.name,
        DEFAULT_EVAL_DATASET.description,
        DEFAULT_EVAL_DATASET.version,
        createdAt,
      );
    const insertCase = sqlite.prepare(`
      INSERT INTO eval_cases
        (id, dataset_id, name, category, input, context_json, expectations_json, tags_json, enabled, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);
    for (const evalCase of DEFAULT_EVAL_DATASET.cases) {
      insertCase.run(
        evalCase.id,
        DEFAULT_EVAL_DATASET.id,
        evalCase.name,
        evalCase.category,
        evalCase.input,
        JSON.stringify(evalCase.context ?? { recentMessages: [], biState: {} }),
        JSON.stringify(evalCase.expectations),
        JSON.stringify(evalCase.tags),
        createdAt,
      );
    }
  });
  insert();
}

initializeDatabase();
seedDemoData();

export function getUser(userId: string): User | null {
  const row = sqlite
    .prepare(
      "SELECT id, tenant_id AS tenantId, name, locale, timezone, currency FROM users WHERE id = ?",
    )
    .get(userId) as User | undefined;
  return row ?? null;
}

export function getUserShops(userId: string): Shop[] {
  return sqlite
    .prepare(`
      SELECT s.id, s.name, s.platform, s.country
      FROM shops s
      JOIN user_shop_permissions p ON p.shop_id = s.id
      WHERE p.user_id = ?
      ORDER BY s.name
    `)
    .all(userId) as Shop[];
}

export function getQuotaBalance(userId: string): number {
  const row = sqlite.prepare("SELECT balance FROM quota_accounts WHERE user_id = ?").get(userId) as
    | { balance: number }
    | undefined;
  return row?.balance ?? 0;
}

export function listConversations(userId: string): Conversation[] {
  return sqlite
    .prepare(`
      SELECT id, title, created_at AS createdAt, updated_at AS updatedAt
      FROM conversations WHERE user_id = ? ORDER BY updated_at DESC
    `)
    .all(userId) as Conversation[];
}

export function getConversation(userId: string, conversationId: string): Conversation | null {
  const row = sqlite
    .prepare(`
      SELECT id, title, created_at AS createdAt, updated_at AS updatedAt
      FROM conversations WHERE id = ? AND user_id = ?
    `)
    .get(conversationId, userId) as Conversation | undefined;
  return row ?? null;
}

export function createConversation(userId: string, title = "新的经营分析"): Conversation {
  const conversationId = id("conv");
  const timestamp = now();
  sqlite
    .prepare(`
      INSERT INTO conversations (id, user_id, title, bi_state_json, created_at, updated_at)
      VALUES (?, ?, ?, '{}', ?, ?)
    `)
    .run(conversationId, userId, title, timestamp, timestamp);
  return { id: conversationId, title, createdAt: timestamp, updatedAt: timestamp };
}

export function getConversationState(conversationId: string): BiConversationState {
  const row = sqlite
    .prepare("SELECT bi_state_json AS state FROM conversations WHERE id = ?")
    .get(conversationId) as { state: string } | undefined;
  return row ? (JSON.parse(row.state) as BiConversationState) : {};
}

export function updateConversationState(
  conversationId: string,
  state: BiConversationState,
): void {
  sqlite
    .prepare("UPDATE conversations SET bi_state_json = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(state), now(), conversationId);
}

export function listMessages(conversationId: string, limit = 50): StoredMessage[] {
  const rows = sqlite
    .prepare(`
      SELECT id, conversation_id AS conversationId, role, status, text,
             answer_json AS answerJson, created_at AS createdAt
      FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?
    `)
    .all(conversationId, limit) as Array<{
    id: string;
    conversationId: string;
    role: "user" | "assistant";
    status: "completed" | "incomplete" | "failed";
    text: string | null;
    answerJson: string | null;
    createdAt: string;
  }>;
  return rows.map(({ answerJson, ...row }) => ({
    ...row,
    answer: answerJson ? (JSON.parse(answerJson) as BiAnswer) : null,
  }));
}

export function createMessage(input: {
  conversationId: string;
  role: "user" | "assistant";
  status?: "completed" | "incomplete" | "failed";
  text?: string | null;
  answer?: BiAnswer | null;
}): string {
  const messageId = id("msg");
  const timestamp = now();
  sqlite
    .prepare(`
      INSERT INTO messages (id, conversation_id, role, status, text, answer_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      messageId,
      input.conversationId,
      input.role,
      input.status ?? "completed",
      input.text ?? null,
      input.answer ? JSON.stringify(input.answer) : null,
      timestamp,
    );
  sqlite
    .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
    .run(timestamp, input.conversationId);
  return messageId;
}

export function createPermissionSnapshot(userId: string): string {
  const user = getUser(userId);
  if (!user) throw new Error("USER_NOT_FOUND");
  const snapshotId = id("perm");
  const shopIds = getUserShops(userId).map((shop) => shop.id);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + 15 * 60_000);
  sqlite
    .prepare(`
      INSERT INTO permission_snapshots
        (id, user_id, tenant_id, shop_ids_json, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(
      snapshotId,
      userId,
      user.tenantId,
      JSON.stringify(shopIds),
      expiresAt.toISOString(),
      createdAt.toISOString(),
    );
  return snapshotId;
}

export function getPermissionSnapshot(snapshotId: string): {
  userId: string;
  tenantId: string;
  shopIds: string[];
} | null {
  const row = sqlite
    .prepare(`
      SELECT user_id AS userId, tenant_id AS tenantId, shop_ids_json AS shopIdsJson, expires_at AS expiresAt
      FROM permission_snapshots WHERE id = ?
    `)
    .get(snapshotId) as
    | { userId: string; tenantId: string; shopIdsJson: string; expiresAt: string }
    | undefined;
  if (!row || new Date(row.expiresAt).getTime() < Date.now()) return null;
  return { userId: row.userId, tenantId: row.tenantId, shopIds: JSON.parse(row.shopIdsJson) as string[] };
}

export function reserveQuota(userId: string, runId: string, amount: number): string {
  const reservationId = id("quota");
  const reserve = sqlite.transaction(() => {
    const balance = getQuotaBalance(userId);
    if (balance < amount) throw new Error("INSUFFICIENT_QUOTA");
    sqlite.prepare("UPDATE quota_accounts SET balance = balance - ? WHERE user_id = ?").run(amount, userId);
    sqlite
      .prepare(`
        INSERT INTO quota_ledger (id, user_id, run_id, reservation_id, kind, amount, created_at)
        VALUES (?, ?, ?, ?, 'reserve', ?, ?)
      `)
      .run(id("ledger"), userId, runId, reservationId, -amount, now());
  });
  reserve();
  return reservationId;
}

export function settleQuota(input: {
  userId: string;
  runId: string;
  reservationId: string;
  reserved: number;
  used: number;
}): void {
  const release = Math.max(0, input.reserved - input.used);
  const settle = sqlite.transaction(() => {
    if (release > 0) {
      sqlite.prepare("UPDATE quota_accounts SET balance = balance + ? WHERE user_id = ?").run(release, input.userId);
      sqlite
        .prepare(`
          INSERT INTO quota_ledger (id, user_id, run_id, reservation_id, kind, amount, created_at)
          VALUES (?, ?, ?, ?, 'release', ?, ?)
        `)
        .run(id("ledger"), input.userId, input.runId, input.reservationId, release, now());
    }
    sqlite
      .prepare(`
        INSERT INTO quota_ledger (id, user_id, run_id, reservation_id, kind, amount, created_at)
        VALUES (?, ?, ?, ?, 'settle', 0, ?)
      `)
      .run(id("ledger"), input.userId, input.runId, input.reservationId, now());
  });
  settle();
}

export function refundQuota(input: {
  userId: string;
  runId: string;
  reservationId: string;
  amount: number;
}): void {
  const refund = sqlite.transaction(() => {
    sqlite.prepare("UPDATE quota_accounts SET balance = balance + ? WHERE user_id = ?").run(input.amount, input.userId);
    sqlite
      .prepare(`
        INSERT INTO quota_ledger (id, user_id, run_id, reservation_id, kind, amount, created_at)
        VALUES (?, ?, ?, ?, 'refund', ?, ?)
      `)
      .run(id("ledger"), input.userId, input.runId, input.reservationId, input.amount, now());
  });
  refund();
}

export function createAgentRun(input: {
  runId: string;
  conversationId: string;
  userMessageId: string;
  reservedCredits: number;
}): void {
  sqlite
    .prepare(`
      INSERT INTO agent_runs
        (id, conversation_id, user_message_id, status, reserved_credits, created_at)
      VALUES (?, ?, ?, 'queued', ?, ?)
    `)
    .run(input.runId, input.conversationId, input.userMessageId, input.reservedCredits, now());
}

export function updateAgentRun(input: {
  runId: string;
  status: "running" | "completed" | "failed" | "cancelled";
  assistantMessageId?: string;
  usedCredits?: number;
  errorCode?: string;
}): void {
  sqlite
    .prepare(`
      UPDATE agent_runs
      SET status = ?, assistant_message_id = COALESCE(?, assistant_message_id),
          used_credits = COALESCE(?, used_credits), error_code = COALESCE(?, error_code),
          completed_at = CASE WHEN ? IN ('completed', 'failed', 'cancelled') THEN ? ELSE completed_at END
      WHERE id = ?
    `)
    .run(
      input.status,
      input.assistantMessageId ?? null,
      input.usedCredits ?? null,
      input.errorCode ?? null,
      input.status,
      now(),
      input.runId,
    );
}

export function updateAgentRunConfig(runId: string, config: AgentRunConfigSnapshot): void {
  sqlite
    .prepare(`
      UPDATE agent_runs
      SET agent_mode = ?, model_profile_id = ?, model_profile_version = ?,
          prompt_id = ?, prompt_version = ?, provider = ?, model_id = ?, config_hash = ?
      WHERE id = ?
    `)
    .run(
      config.mode,
      config.profileId,
      config.profileVersion,
      config.promptId,
      config.promptVersion,
      config.provider,
      config.model,
      config.configHash,
      runId,
    );
}

export function getAgentRunConfig(runId: string): AgentRunConfigSnapshot | null {
  const row = sqlite
    .prepare(`
      SELECT agent_mode AS mode, model_profile_id AS profileId,
             model_profile_version AS profileVersion, prompt_id AS promptId,
             prompt_version AS promptVersion, provider, model_id AS model,
             config_hash AS configHash
      FROM agent_runs WHERE id = ?
    `)
    .get(runId) as AgentRunConfigSnapshot | undefined;
  return row?.mode ? row : null;
}

export function appendAgentRunAttempt(runId: string, config: AgentRunConfigSnapshot): void {
  const append = sqlite.transaction(() => {
    const row = sqlite
      .prepare("SELECT COALESCE(MAX(attempt), 0) AS attempt FROM agent_run_attempts WHERE run_id = ?")
      .get(runId) as { attempt: number };
    sqlite
      .prepare(`
        INSERT INTO agent_run_attempts
          (id, run_id, attempt, config_json, status, started_at)
        VALUES (?, ?, ?, ?, 'running', ?)
      `)
      .run(id("attempt"), runId, row.attempt + 1, JSON.stringify(config), now());
  });
  append();
}

export function completeLatestAgentRunAttempt(
  runId: string,
  status: "completed" | "failed",
  errorCode?: string,
): void {
  sqlite
    .prepare(`
      UPDATE agent_run_attempts SET status = ?, error_code = ?, completed_at = ?
      WHERE run_id = ? AND attempt = (
        SELECT MAX(attempt) FROM agent_run_attempts WHERE run_id = ?
      )
    `)
    .run(status, errorCode ?? null, now(), runId, runId);
}

export function listAgentRunAttempts(runId: string): AgentRunAttempt[] {
  const rows = sqlite
    .prepare(`
      SELECT id, run_id AS runId, attempt, config_json AS configJson,
             status, error_code AS errorCode, started_at AS startedAt,
             completed_at AS completedAt
      FROM agent_run_attempts WHERE run_id = ? ORDER BY attempt
    `)
    .all(runId) as Array<Omit<AgentRunAttempt, "config"> & { configJson: string }>;
  return rows.map(({ configJson, ...row }) => ({
    ...row,
    config: JSON.parse(configJson) as AgentRunConfigSnapshot,
  }));
}

export function appendAgentTraceEvent(runId: string, event: ToolTraceEvent): void {
  const append = sqlite.transaction(() => {
    const row = sqlite
      .prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM agent_trace_events WHERE run_id = ?")
      .get(runId) as { sequence: number };
    sqlite
      .prepare(`
        INSERT INTO agent_trace_events
          (id, run_id, sequence, event_type, tool_call_id, tool_name, payload_json,
           duration_ms, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id("trace"),
        runId,
        row.sequence + 1,
        event.type,
        event.toolCallId,
        event.toolName,
        JSON.stringify(event),
        event.type === "tool.completed" ? event.durationMs : null,
        event.type === "tool.completed" ? event.status : null,
        event.timestamp,
      );
  });
  append();
}

export function listAgentTraceEvents(runId: string): ToolTraceEvent[] {
  const rows = sqlite
    .prepare("SELECT payload_json AS payload FROM agent_trace_events WHERE run_id = ? ORDER BY sequence")
    .all(runId) as Array<{ payload: string }>;
  return rows.map((row) => JSON.parse(row.payload) as ToolTraceEvent);
}

function mapEvalCase(row: {
  id: string;
  datasetId: string;
  name: string;
  category: EvalCase["category"];
  input: string;
  contextJson: string;
  expectationsJson: string;
  tagsJson: string;
  enabled: number;
}): EvalCase {
  return {
    id: row.id,
    datasetId: row.datasetId,
    name: row.name,
    category: row.category,
    input: row.input,
    context: JSON.parse(row.contextJson) as EvalCase["context"],
    expectations: JSON.parse(row.expectationsJson) as EvalCase["expectations"],
    tags: JSON.parse(row.tagsJson) as string[],
    enabled: Boolean(row.enabled),
  };
}

export function listEvalDatasets(): EvalDataset[] {
  return sqlite
    .prepare(`
      SELECT d.id, d.name, d.description, d.version, d.status,
             COUNT(c.id) AS caseCount, d.created_at AS createdAt
      FROM eval_datasets d
      LEFT JOIN eval_cases c ON c.dataset_id = d.id AND c.enabled = 1
      GROUP BY d.id
      ORDER BY d.created_at DESC
    `)
    .all() as EvalDataset[];
}

export function getEvalDataset(datasetId: string): EvalDatasetDetail | null {
  const dataset = listEvalDatasets().find((item) => item.id === datasetId);
  if (!dataset) return null;
  const rows = sqlite
    .prepare(`
      SELECT id, dataset_id AS datasetId, name, category, input,
             context_json AS contextJson, expectations_json AS expectationsJson,
             tags_json AS tagsJson, enabled
      FROM eval_cases WHERE dataset_id = ? ORDER BY category, id
    `)
    .all(datasetId) as Parameters<typeof mapEvalCase>[0][];
  return { ...dataset, cases: rows.map(mapEvalCase) };
}

export function getEvalOverview(): EvalOverview {
  const counts = sqlite.prepare(`
    SELECT (SELECT COUNT(*) FROM eval_datasets) AS datasetCount,
           (SELECT COUNT(*) FROM eval_cases WHERE enabled = 1) AS caseCount,
           (SELECT COUNT(*) FROM eval_runs) AS runCount
  `).get() as Pick<EvalOverview, "datasetCount" | "caseCount" | "runCount">;
  const latest = sqlite
    .prepare("SELECT score FROM eval_runs WHERE status = 'completed' ORDER BY created_at DESC LIMIT 1")
    .get() as { score: number | null } | undefined;
  const categories = sqlite
    .prepare(`
      SELECT category, COUNT(*) AS count FROM eval_cases
      WHERE enabled = 1 GROUP BY category ORDER BY category
    `)
    .all() as EvalOverview["categoryCounts"];
  return { ...counts, latestPassRate: latest?.score ?? null, categoryCounts: categories };
}

type EvalRunRow = Omit<EvalRun, "score"> & { score: number | null };

export function listEvalRuns(limit = 30): EvalRun[] {
  return sqlite
    .prepare(`
      SELECT r.id, r.dataset_id AS datasetId, d.name AS datasetName,
             d.version AS datasetVersion, r.mode,
             r.requested_profile_id AS requestedProfileId, r.status,
             r.total_cases AS totalCases, r.passed_cases AS passedCases,
             r.failed_cases AS failedCases, r.score,
             r.created_at AS createdAt, r.completed_at AS completedAt
      FROM eval_runs r JOIN eval_datasets d ON d.id = r.dataset_id
      ORDER BY r.created_at DESC LIMIT ?
    `)
    .all(limit) as EvalRunRow[];
}

export function createEvalRun(input: {
  datasetId: string;
  mode: "mock" | "pi";
  requestedProfileId?: string;
}): EvalRun {
  const dataset = getEvalDataset(input.datasetId);
  if (!dataset) throw new Error("EVAL_DATASET_NOT_FOUND");
  const runId = id("evalrun");
  const createdAt = now();
  sqlite
    .prepare(`
      INSERT INTO eval_runs
        (id, dataset_id, mode, requested_profile_id, status, total_cases, created_at)
      VALUES (?, ?, ?, ?, 'queued', ?, ?)
    `)
    .run(
      runId,
      input.datasetId,
      input.mode,
      input.requestedProfileId ?? null,
      dataset.cases.filter((item) => item.enabled).length,
      createdAt,
    );
  return listEvalRuns().find((run) => run.id === runId)!;
}

export function markEvalRunRunning(runId: string): void {
  sqlite.prepare("UPDATE eval_runs SET status = 'running' WHERE id = ?").run(runId);
}

export function saveEvalCaseResult(input: {
  evalRunId: string;
  caseId: string;
  agentRunId: string;
  status: "passed" | "failed" | "error";
  score: number;
  durationMs: number;
  answer: BiAnswer | null;
  assertions: EvalAssertion[];
  errorCode?: string;
}): void {
  sqlite
    .prepare(`
      INSERT INTO eval_case_results
        (id, eval_run_id, case_id, agent_run_id, status, score, duration_ms,
         answer_json, assertions_json, error_code, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      id("evalresult"),
      input.evalRunId,
      input.caseId,
      input.agentRunId,
      input.status,
      input.score,
      input.durationMs,
      input.answer ? JSON.stringify(input.answer) : null,
      JSON.stringify(input.assertions),
      input.errorCode ?? null,
      now(),
    );
}

export function completeEvalRun(runId: string): void {
  const aggregate = sqlite
    .prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) AS passed,
             SUM(CASE WHEN status != 'passed' THEN 1 ELSE 0 END) AS failed,
             AVG(score) AS score
      FROM eval_case_results WHERE eval_run_id = ?
    `)
    .get(runId) as { total: number; passed: number; failed: number; score: number | null };
  sqlite
    .prepare(`
      UPDATE eval_runs SET status = 'completed', total_cases = ?, passed_cases = ?,
        failed_cases = ?, score = ?, completed_at = ? WHERE id = ?
    `)
    .run(aggregate.total, aggregate.passed, aggregate.failed, aggregate.score, now(), runId);
}

export function failEvalRun(runId: string): void {
  sqlite.prepare("UPDATE eval_runs SET status = 'failed', completed_at = ? WHERE id = ?").run(now(), runId);
}

export function getEvalRun(runId: string): EvalRunDetail | null {
  const run = listEvalRuns(100).find((item) => item.id === runId);
  if (!run) return null;
  const rows = sqlite
    .prepare(`
      SELECT r.id, r.eval_run_id AS evalRunId, r.case_id AS caseId,
             c.name AS caseName, c.category, r.agent_run_id AS agentRunId,
             r.status, r.score, r.duration_ms AS durationMs,
             r.answer_json AS answerJson, r.assertions_json AS assertionsJson,
             r.error_code AS errorCode
      FROM eval_case_results r JOIN eval_cases c ON c.id = r.case_id
      WHERE r.eval_run_id = ? ORDER BY c.category, c.id
    `)
    .all(runId) as Array<{
      id: string;
      evalRunId: string;
      caseId: string;
      caseName: string;
      category: EvalCaseResult["category"];
      agentRunId: string;
      status: EvalCaseResult["status"];
      score: number;
      durationMs: number;
      answerJson: string | null;
      assertionsJson: string;
      errorCode: string | null;
    }>;
  return {
    ...run,
    results: rows.map(({ answerJson, assertionsJson, ...row }) => ({
      ...row,
      answer: answerJson ? (JSON.parse(answerJson) as BiAnswer) : null,
      assertions: JSON.parse(assertionsJson) as EvalAssertion[],
      attempts: listAgentRunAttempts(row.agentRunId),
      traces: listAgentTraceEvents(row.agentRunId),
    })),
  };
}

function isoDateDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function executeBiQuery(request: BiQueryRequest): BiQueryResult {
  const permission = getPermissionSnapshot(request.permissionSnapshotId);
  if (!permission || permission.shopIds.length === 0) throw new Error("PERMISSION_DENIED");
  const placeholders = permission.shopIds.map(() => "?").join(",");
  const start = isoDateDaysAgo(request.days);
  const end = isoDateDaysAgo(1);
  const previousStart = isoDateDaysAgo(request.days * 2);
  const previousEnd = isoDateDaysAgo(request.days + 1);
  const shops = sqlite
    .prepare(`SELECT id, name, platform, country FROM shops WHERE id IN (${placeholders}) ORDER BY name`)
    .all(...permission.shopIds) as Shop[];

  const totalsFor = (rangeStart: string, rangeEnd: string) =>
    sqlite
      .prepare(`
        SELECT COALESCE(SUM(orders), 0) AS orders,
               COALESCE(SUM(revenue), 0) AS revenue,
               COALESCE(SUM(refunds), 0) AS refunds,
               COALESCE(SUM(complaints), 0) AS complaints,
               COALESCE(SUM(avg_response_minutes * orders) / NULLIF(SUM(orders), 0), 0) AS avgResponseMinutes
        FROM daily_shop_metrics
        WHERE date BETWEEN ? AND ? AND shop_id IN (${placeholders})
      `)
      .get(rangeStart, rangeEnd, ...permission.shopIds) as Record<string, number>;

  const totals = totalsFor(start, end);
  const previousTotals = totalsFor(previousStart, previousEnd);
  let rows: Array<Record<string, string | number>>;

  if (request.intent === "revenue-trend") {
    rows = sqlite
      .prepare(`
        SELECT date, ROUND(SUM(revenue), 2) AS revenue, SUM(orders) AS orders
        FROM daily_shop_metrics
        WHERE date BETWEEN ? AND ? AND shop_id IN (${placeholders})
        GROUP BY date ORDER BY date
      `)
      .all(start, end, ...permission.shopIds) as Array<Record<string, string | number>>;
  } else {
    rows = sqlite
      .prepare(`
        SELECT s.id AS shopId, s.name AS shopName, s.platform,
               SUM(m.orders) AS orders, ROUND(SUM(m.revenue), 2) AS revenue,
               SUM(m.refunds) AS refunds,
               ROUND(100.0 * SUM(m.refunds) / NULLIF(SUM(m.orders), 0), 2) AS refundRate,
               SUM(m.complaints) AS complaints,
               ROUND(SUM(m.avg_response_minutes * m.orders) / NULLIF(SUM(m.orders), 0), 1) AS avgResponseMinutes
        FROM daily_shop_metrics m
        JOIN shops s ON s.id = m.shop_id
        WHERE m.date BETWEEN ? AND ? AND m.shop_id IN (${placeholders})
        GROUP BY s.id, s.name, s.platform
        ORDER BY CASE ?
          WHEN 'refund-ranking' THEN 100.0 * SUM(m.refunds) / NULLIF(SUM(m.orders), 0)
          WHEN 'response-ranking' THEN SUM(m.avg_response_minutes * m.orders) / NULLIF(SUM(m.orders), 0)
          WHEN 'complaint-analysis' THEN SUM(m.complaints)
          ELSE SUM(m.revenue)
        END DESC
      `)
      .all(start, end, ...permission.shopIds, request.intent) as Array<
      Record<string, string | number>
    >;
  }

  return {
    datasetId: id("ds"),
    intent: request.intent,
    scope: {
      dateRange: { start, end },
      shopIds: permission.shopIds,
      platforms: [...new Set(shops.map((shop) => shop.platform))],
      timezone: request.timezone,
      currency: request.currency,
      dataFreshness: `${end}T23:59:59+08:00`,
    },
    shops,
    rows,
    totals,
    previousTotals,
  };
}

export function getDatabasePath(): string {
  return databasePath;
}
