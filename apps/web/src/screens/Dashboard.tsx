import type { AgentEvent, BiAnswer, StoredMessage } from "@bi-agent/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  Bot,
  Check,
  CircleDollarSign,
  Clock3,
  FlaskConical,
  MessageSquareText,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Store,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cancelRun, createConversation, getBootstrap, getMessages, streamMessage } from "../api.js";

export function Dashboard() {
  const { conversationId } = useParams({ from: "/conversations/$conversationId" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const bootstrap = useQuery({ queryKey: ["bootstrap"], queryFn: getBootstrap });
  const messages = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: () => getMessages(conversationId),
  });
  const [input, setInput] = useState("");
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [streamedText, setStreamedText] = useState("");
  const [liveAnswer, setLiveAnswer] = useState<BiAnswer | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const localAbort = useRef<AbortController | null>(null);

  const createConversationMutation = useMutation({
    mutationFn: createConversation,
    onSuccess: async (conversation) => {
      await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
      await navigate({ to: "/conversations/$conversationId", params: { conversationId: conversation.id } });
    },
  });

  const sendMutation = useMutation({
    mutationFn: async (message: string) => {
      const controller = new AbortController();
      localAbort.current = controller;
      setEvents([]);
      setStreamedText("");
      setLiveAnswer(null);
      await streamMessage({
        conversationId,
        message,
        signal: controller.signal,
        onEvent: (event) => {
          setEvents((current) => [...current, event]);
          if (event.type === "run.started") setRunId(event.runId);
          if (event.type === "answer.delta") setStreamedText((current) => current + event.delta);
          if (event.type === "answer.completed") setLiveAnswer(event.answer);
        },
      });
    },
    onSuccess: async () => {
      setInput("");
      setRunId(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["messages", conversationId] }),
        queryClient.invalidateQueries({ queryKey: ["bootstrap"] }),
      ]);
    },
    onSettled: () => {
      localAbort.current = null;
    },
  });

  const lastStoredAnswer = useMemo(
    () => [...(messages.data ?? [])].reverse().find((message) => message.answer)?.answer ?? null,
    [messages.data],
  );
  const answer = liveAnswer ?? lastStoredAnswer;
  const runningSteps = events.filter((event) => event.type === "analysis.step");
  const submit = (message = input) => {
    if (!message.trim() || sendMutation.isPending) return;
    sendMutation.mutate(message.trim());
  };
  const stop = async () => {
    if (runId) await cancelRun(runId).catch(() => undefined);
    localAbort.current?.abort();
  };

  if (bootstrap.isLoading || messages.isLoading) {
    return <div className="loading">正在准备 Duoke BI Agent Demo…</div>;
  }
  if (bootstrap.error || messages.error || !bootstrap.data) {
    return <div className="loading error">无法连接本地服务，请确认 API 与 Agent 服务已经启动。</div>;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Sparkles size={19} /></div>
          <div><strong>Duoke BI</strong><span>Agent Demo</span></div>
        </div>
        <button className="new-chat" onClick={() => createConversationMutation.mutate()}>
          <Plus size={17} /> 新建分析
        </button>
        <Link to="/admin/evals" className="eval-admin-link">
          <FlaskConical size={16} /> Eval 管理控制台
        </Link>
        <div className="section-label">历史对话</div>
        <nav className="conversation-list">
          {bootstrap.data.conversations.map((conversation) => (
            <Link
              key={conversation.id}
              to="/conversations/$conversationId"
              params={{ conversationId: conversation.id }}
              className={`conversation-link ${conversation.id === conversationId ? "active" : ""}`}
            >
              <MessageSquareText size={16} />
              <span>{conversation.title}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="quota-row"><CircleDollarSign size={17} /><span>剩余积分</span><strong>{bootstrap.data.quotaBalance}</strong></div>
          <div className="user-card"><div className="avatar">C</div><div><strong>{bootstrap.data.user.name}</strong><span>演示租户</span></div></div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div><span className="eyebrow">跨境电商经营分析</span><h1>{answer?.title ?? "经营数据驾驶舱"}</h1></div>
          <div className="scope-pills">
            <span><ShieldCheck size={15} /> 权限已校验</span>
            <span><Store size={15} /> {bootstrap.data.shops.length} 个店铺</span>
            <span><Clock3 size={15} /> 截至昨日</span>
          </div>
        </header>

        <section className="analysis-panel">
          {answer ? <AnswerView answer={answer} /> : <EmptyAnalysis onAsk={submit} />}
        </section>
      </main>

      <aside className="chat-panel">
        <div className="chat-header"><div><Bot size={18} /><strong>经营分析助手</strong></div><span className="online-dot">在线</span></div>
        <div className="messages">
          {(messages.data ?? []).map((message) => <MessageBubble key={message.id} message={message} />)}
          {sendMutation.isPending && (
            <div className="assistant-run">
              <div className="assistant-label"><Bot size={15} /> Agent 正在处理</div>
              <div className="run-steps">
                {runningSteps.map((event, index) =>
                  event.type === "analysis.step" ? (
                    <div className="run-step" key={`${event.step}-${event.status}-${index}`}>
                      {event.status === "completed" ? <Check size={13} /> : <span className="spinner" />}
                      {event.label}
                    </div>
                  ) : null,
                )}
              </div>
              {streamedText && <p className="streamed-text">{streamedText}</p>}
            </div>
          )}
        </div>
        <div className="suggestions">
          {bootstrap.data.suggestedQuestions.slice(0, 3).map((question) => (
            <button key={question} onClick={() => submit(question)} disabled={sendMutation.isPending}>{question}</button>
          ))}
        </div>
        <div className="composer">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="询问销售额、退款率、客服响应…"
            rows={3}
          />
          <div className="composer-footer">
            <span>Enter 发送 · Shift+Enter 换行</span>
            {sendMutation.isPending ? (
              <button className="send-button stop" onClick={stop} aria-label="停止"><Square size={15} /></button>
            ) : (
              <button className="send-button" onClick={() => submit()} disabled={!input.trim()} aria-label="发送"><Send size={16} /></button>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function EmptyAnalysis({ onAsk }: { onAsk: (question: string) => void }) {
  return (
    <div className="empty-analysis">
      <div className="empty-icon"><Sparkles size={26} /></div>
      <h2>从经营数据开始提问</h2>
      <p>Agent 只会查询当前用户有权访问的店铺，并展示指标口径、查询范围和数据新鲜度。</p>
      <button onClick={() => onAsk("总结最近 30 天的经营情况")}>生成经营概览</button>
    </div>
  );
}

function AnswerView({ answer }: { answer: BiAnswer }) {
  return (
    <>
      <div className="metric-grid">
        {answer.metrics.map((metric) => (
          <article className="metric-card" key={metric.key}>
            <span>{metric.label}</span><strong>{metric.formattedValue}</strong>
            <small className={metric.trend === "up" ? "positive" : metric.trend === "down" ? "negative" : "neutral"}>
              {metric.trend === "up" ? <TrendingUp size={14} /> : metric.trend === "down" ? <TrendingDown size={14} /> : null}
              {metric.changePercent === null ? "暂无同比" : `${metric.changePercent >= 0 ? "+" : ""}${metric.changePercent}% 较上一周期`}
            </small>
          </article>
        ))}
      </div>
      <div className="insight-card">
        <div className="insight-heading"><Sparkles size={17} /><strong>Agent 结论</strong></div>
        <p>{answer.summary}</p>
      </div>
      {answer.chart && <ChartView answer={answer} />}
      <div className="bottom-grid">
        <section className="evidence-card"><h3>分析依据</h3>{answer.evidence.map((item) => <p key={item}><Check size={14} />{item}</p>)}</section>
        <section className="recommendation-card"><h3>建议行动</h3>{answer.recommendations.map((item) => <div key={item.title}><span>{item.priority === "high" ? "高优先级" : "建议"}</span><strong>{item.title}</strong><p>{item.description}</p><small>验证指标：{item.validationMetric}</small></div>)}</section>
      </div>
    </>
  );
}

function ChartView({ answer }: { answer: BiAnswer }) {
  const chart = answer.chart;
  if (!chart) return null;
  const series = chart.series[0];
  if (!series) return null;
  return (
    <section className="chart-card">
      <div className="card-title"><div><strong>{answer.title}</strong><span>{answer.scope.dateRange.start} — {answer.scope.dateRange.end}</span></div><span className="currency">{answer.scope.currency}</span></div>
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height="100%">
          {chart.type === "line" ? (
            <LineChart data={chart.data} margin={{ top: 12, right: 18, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e9ecf2" />
              <XAxis dataKey={chart.xKey} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
              <Tooltip /><Line type="monotone" dataKey={series.key} stroke={series.color} strokeWidth={3} dot={false} />
            </LineChart>
          ) : (
            <BarChart data={chart.data} margin={{ top: 12, right: 18, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e9ecf2" />
              <XAxis dataKey={chart.xKey} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
              <Tooltip /><Bar dataKey={series.key} fill={series.color} radius={[7, 7, 0, 0]} maxBarSize={52} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function MessageBubble({ message }: { message: StoredMessage }) {
  return (
    <div className={`message-row ${message.role}`}>
      {message.role === "assistant" && <div className="bot-avatar"><Bot size={14} /></div>}
      <div className="message-bubble">{message.text ?? message.answer?.summary}</div>
    </div>
  );
}
