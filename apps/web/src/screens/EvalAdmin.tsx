import type { EvalCaseResult, EvalRun } from "@bi-agent/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  ArrowLeft,
  Bot,
  CheckCircle2,
  Clock3,
  Database,
  FlaskConical,
  Play,
  Settings2,
  ShieldCheck,
  Wrench,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  getAgentConfig,
  getEvalDataset,
  getEvalDatasets,
  getEvalOverview,
  getEvalRun,
  getEvalRuns,
  startEvalRun,
} from "../api.js";

const percent = (value: number | null) => (value === null ? "--" : `${(value * 100).toFixed(1)}%`);

export function EvalAdmin() {
  const queryClient = useQueryClient();
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");

  const overview = useQuery({ queryKey: ["eval-overview"], queryFn: getEvalOverview });
  const config = useQuery({ queryKey: ["agent-config"], queryFn: getAgentConfig });
  const datasets = useQuery({ queryKey: ["eval-datasets"], queryFn: getEvalDatasets });
  const runs = useQuery({
    queryKey: ["eval-runs"],
    queryFn: getEvalRuns,
    refetchInterval: (query) =>
      (query.state.data as EvalRun[] | undefined)?.some((run) => run.status === "queued" || run.status === "running")
        ? 1_000
        : false,
  });

  useEffect(() => {
    if (!selectedDatasetId && datasets.data?.[0]) setSelectedDatasetId(datasets.data[0].id);
  }, [datasets.data, selectedDatasetId]);
  useEffect(() => {
    if (!selectedProfileId && config.data) setSelectedProfileId(config.data.selectedProfileId);
  }, [config.data, selectedProfileId]);
  useEffect(() => {
    if (!selectedRunId && runs.data?.[0]) setSelectedRunId(runs.data[0].id);
  }, [runs.data, selectedRunId]);

  const dataset = useQuery({
    queryKey: ["eval-dataset", selectedDatasetId],
    queryFn: () => getEvalDataset(selectedDatasetId!),
    enabled: Boolean(selectedDatasetId),
  });
  const runDetail = useQuery({
    queryKey: ["eval-run", selectedRunId],
    queryFn: () => getEvalRun(selectedRunId!),
    enabled: Boolean(selectedRunId),
    refetchInterval: (query) => {
      const run = query.state.data;
      return run?.status === "queued" || run?.status === "running" ? 1_000 : false;
    },
  });

  const startMutation = useMutation({
    mutationFn: () =>
      startEvalRun({
        datasetId: selectedDatasetId!,
        ...(config.data?.mode === "pi" && selectedProfileId ? { profileId: selectedProfileId } : {}),
        concurrency: 3,
      }),
    onSuccess: async (run) => {
      setSelectedRunId(run.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["eval-runs"] }),
        queryClient.invalidateQueries({ queryKey: ["eval-overview"] }),
      ]);
    },
  });

  const categorySummary = useMemo(
    () =>
      overview.data?.categoryCounts.map((item) => `${item.category} ${item.count}`).join(" · ") ?? "",
    [overview.data],
  );

  if (overview.isLoading || config.isLoading || datasets.isLoading) {
    return <div className="loading">正在加载 Agent Eval 控制台…</div>;
  }
  if (!overview.data || !config.data || !datasets.data) {
    return <div className="loading error">Eval 控制台无法连接，请确认 API 与 Agent 服务已启动。</div>;
  }

  return (
    <div className="eval-shell">
      <header className="eval-header">
        <div className="eval-title-row">
          <Link to="/conversations/$conversationId" params={{ conversationId: "conv_demo" }} className="back-link">
            <ArrowLeft size={16} /> 返回经营分析
          </Link>
          <div className="eval-title">
            <div className="brand-mark"><FlaskConical size={19} /></div>
            <div><span className="eyebrow">Agent Quality</span><h1>Eval 管理控制台</h1></div>
          </div>
        </div>
        <div className="eval-mode"><Activity size={15} /> Runtime：{config.data.mode}<strong>{config.data.selectedProfileId}</strong></div>
      </header>

      <main className="eval-main">
        <section className="eval-stat-grid">
          <StatCard icon={<Database size={18} />} label="评测集" value={overview.data.datasetCount} />
          <StatCard icon={<FlaskConical size={18} />} label="案例" value={overview.data.caseCount} />
          <StatCard icon={<Activity size={18} />} label="执行次数" value={overview.data.runCount} />
          <StatCard icon={<CheckCircle2 size={18} />} label="最近得分" value={percent(overview.data.latestPassRate)} />
        </section>

        <section className="eval-section">
          <div className="section-heading"><div><span className="eyebrow">Configuration</span><h2>Agent 配置</h2></div><span className="readonly-badge"><ShieldCheck size={13} /> 版本化只读</span></div>
          <div className="profile-grid">
            {config.data.profiles.map((profile) => (
              <button
                key={profile.id}
                className={`profile-card ${selectedProfileId === profile.id ? "selected" : ""}`}
                onClick={() => setSelectedProfileId(profile.id)}
                disabled={config.data.mode === "pi" && !profile.configured}
              >
                <div className="profile-card-title"><Bot size={17} /><strong>{profile.id}</strong><span>{profile.configured ? "已配置" : "未配置"}</span></div>
                <dl>
                  <div><dt>Prompt</dt><dd>{profile.promptId}@{profile.promptVersion}</dd></div>
                  <div><dt>Thinking</dt><dd>{profile.thinkingLevel}</dd></div>
                  <div><dt>Context</dt><dd>{profile.contextWindow.toLocaleString()}</dd></div>
                  <div><dt>Timeout</dt><dd>{profile.timeoutMs / 1_000}s</dd></div>
                </dl>
              </button>
            ))}
          </div>
          <div className="policy-strip"><Settings2 size={15} /> 工具：{config.data.policy.toolName} · 查询范围：{config.data.policy.minQueryDays}–{config.data.policy.maxQueryDays} 天 · 禁止原始 SQL · 必须使用权限快照</div>
        </section>

        <div className="eval-two-column">
          <section className="eval-section dataset-section">
            <div className="section-heading">
              <div><span className="eyebrow">Golden Dataset</span><h2>评测集</h2><p>{categorySummary}</p></div>
              <button className="run-eval-button" disabled={!selectedDatasetId || startMutation.isPending} onClick={() => startMutation.mutate()}>
                <Play size={15} /> {startMutation.isPending ? "正在创建" : "运行评测"}
              </button>
            </div>
            <div className="dataset-tabs">
              {datasets.data.map((item) => <button key={item.id} className={selectedDatasetId === item.id ? "active" : ""} onClick={() => setSelectedDatasetId(item.id)}>{item.name}<span>v{item.version} · {item.caseCount}</span></button>)}
            </div>
            {dataset.data && (
              <div className="case-table-wrap">
                <p className="dataset-description">{dataset.data.description}</p>
                <table className="eval-table">
                  <thead><tr><th>案例</th><th>分类</th><th>预期</th><th>天数</th></tr></thead>
                  <tbody>{dataset.data.cases.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><span>{item.input}</span></td><td><span className="category-tag">{item.category}</span></td><td>{item.expectations.expectedIntent}</td><td>{item.expectations.expectedDays}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </section>

          <section className="eval-section runs-section">
            <div className="section-heading"><div><span className="eyebrow">History</span><h2>评测结果</h2></div></div>
            <div className="run-list">
              {(runs.data ?? []).map((run) => (
                <button key={run.id} className={`run-row ${selectedRunId === run.id ? "selected" : ""}`} onClick={() => setSelectedRunId(run.id)}>
                  <StatusIcon status={run.status} />
                  <div><strong>{run.datasetName}</strong><span>{new Date(run.createdAt).toLocaleString()} · {run.mode}{run.requestedProfileId ? ` · ${run.requestedProfileId}` : ""}</span></div>
                  <div className="run-score"><strong>{percent(run.score)}</strong><span>{run.passedCases}/{run.totalCases}</span></div>
                </button>
              ))}
              {!runs.data?.length && <div className="empty-list">还没有评测记录。</div>}
            </div>
          </section>
        </div>

        {runDetail.data && <RunDetail run={runDetail.data} />}
      </main>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: ReactNode; label: string; value: string | number }) {
  return <div className="eval-stat"><div>{icon}<span>{label}</span></div><strong>{value}</strong></div>;
}

function StatusIcon({ status }: { status: EvalRun["status"] }) {
  if (status === "completed") return <CheckCircle2 className="status-icon success" size={19} />;
  if (status === "failed") return <XCircle className="status-icon failed" size={19} />;
  return <Clock3 className="status-icon running" size={19} />;
}

function RunDetail({ run }: { run: Awaited<ReturnType<typeof getEvalRun>> }) {
  return (
    <section className="eval-section result-detail">
      <div className="section-heading"><div><span className="eyebrow">Run Detail</span><h2>逐案例结果</h2><p>{run.id} · {run.status} · 得分 {percent(run.score)}</p></div></div>
      <div className="result-list">
        {run.results.map((result) => <CaseResult key={result.id} result={result} />)}
        {!run.results.length && <div className="empty-list">评测正在执行，结果会自动刷新。</div>}
      </div>
    </section>
  );
}

function CaseResult({ result }: { result: EvalCaseResult }) {
  return (
    <details className={`case-result ${result.status}`}>
      <summary>
        {result.status === "passed" ? <CheckCircle2 size={17} /> : <XCircle size={17} />}
        <div><strong>{result.caseName}</strong><span>{result.category} · {result.durationMs}ms · {result.agentRunId}</span></div>
        <strong>{percent(result.score)}</strong>
      </summary>
      <div className="case-result-body">
        <div className="assertion-grid">
          {result.assertions.map((assertion) => <div key={assertion.key} className={assertion.passed ? "pass" : "fail"}>{assertion.passed ? <CheckCircle2 size={14} /> : <XCircle size={14} />}<span>{assertion.label}</span><code>{JSON.stringify(assertion.actual)}</code></div>)}
        </div>
        <div className="trace-panel">
          <h3><Wrench size={15} /> Tool Trace</h3>
          {result.attempts.map((attempt) => <div className="attempt-row" key={attempt.id}><Bot size={14} /><strong>Attempt {attempt.attempt}</strong><span>{attempt.config.profileId}@{attempt.config.profileVersion}</span><span className={attempt.status}>{attempt.status}</span></div>)}
          {result.traces.map((trace, index) => <div className="trace-row" key={`${trace.toolCallId}-${trace.type}-${index}`}><span>{trace.type}</span><strong>{trace.toolName}</strong><code>{trace.type === "tool.started" ? JSON.stringify(trace.arguments) : `${trace.status} · ${trace.durationMs}ms`}</code></div>)}
          {!result.traces.length && <p className="muted">没有捕获到 Tool Call。</p>}
        </div>
        {result.answer && <div className="eval-answer"><h3>最终回答</h3><p>{result.answer.summary}</p></div>}
        {result.errorCode && <div className="eval-error">{result.errorCode}</div>}
      </div>
    </details>
  );
}
