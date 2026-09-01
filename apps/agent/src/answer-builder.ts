import type {
  BiAnswer,
  BiConversationState,
  BiQueryIntent,
  BiQueryResult,
  MetricCard,
} from "@bi-agent/contracts";

function percentChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

function metricCard(
  key: string,
  label: string,
  current: number,
  previous: number,
  formatter: (value: number) => string,
): MetricCard {
  const change = percentChange(current, previous);
  return {
    key,
    label,
    value: current,
    formattedValue: formatter(current),
    changePercent: change,
    trend: change === null || Math.abs(change) < 0.1 ? "flat" : change > 0 ? "up" : "down",
  };
}

const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });

function buildMetrics(result: BiQueryResult): MetricCard[] {
  const totals = result.totals;
  const previous = result.previousTotals;
  const refundRate = totals.orders ? ((totals.refunds ?? 0) / totals.orders) * 100 : 0;
  const previousRefundRate = previous.orders
    ? ((previous.refunds ?? 0) / previous.orders) * 100
    : 0;
  return [
    metricCard("revenue", "销售额", totals.revenue ?? 0, previous.revenue ?? 0, (value) =>
      `${result.scope.currency} ${number.format(value)}`,
    ),
    metricCard("orders", "订单量", totals.orders ?? 0, previous.orders ?? 0, (value) =>
      number.format(value),
    ),
    metricCard("refundRate", "退款率", refundRate, previousRefundRate, (value) =>
      `${value.toFixed(2)}%`,
    ),
    metricCard(
      "avgResponseMinutes",
      "平均响应时长",
      totals.avgResponseMinutes ?? 0,
      previous.avgResponseMinutes ?? 0,
      (value) => `${decimal.format(value)} 分钟`,
    ),
  ];
}

function buildSummary(intent: BiQueryIntent, result: BiQueryResult, modelSummary?: string): string {
  if (modelSummary?.trim()) return modelSummary.trim();
  const first = result.rows[0];
  if (!first) return "当前查询范围内没有可用于分析的数据。";
  if (intent === "refund-ranking") {
    return `${String(first.shopName)} 的退款率最高，为 ${Number(first.refundRate).toFixed(2)}%。这是贡献分析结果，不能直接视为退款上升的根因。`;
  }
  if (intent === "response-ranking") {
    return `${String(first.shopName)} 的平均响应时长最长，为 ${Number(first.avgResponseMinutes).toFixed(1)} 分钟，建议优先检查高峰时段排班。`;
  }
  if (intent === "complaint-analysis") {
    return `${String(first.shopName)} 的投诉量最高，共 ${number.format(Number(first.complaints))} 次，建议结合投诉类型和关联订单进一步排查。`;
  }
  if (intent === "revenue-trend") {
    const revenue = result.totals.revenue ?? 0;
    const change = percentChange(revenue, result.previousTotals.revenue ?? 0);
    return `最近 ${result.rows.length} 天销售额为 ${result.scope.currency} ${number.format(revenue)}，较上一周期${change === null ? "暂无可比数据" : `${change >= 0 ? "增长" : "下降"} ${Math.abs(change)}%`}。`;
  }
  const revenue = result.totals.revenue ?? 0;
  return `授权店铺最近一个周期共完成 ${number.format(result.totals.orders ?? 0)} 个订单，销售额 ${result.scope.currency} ${number.format(revenue)}。`;
}

export function buildAnswer(
  intent: BiQueryIntent,
  result: BiQueryResult,
  modelSummary?: string,
): { answer: BiAnswer; biState: BiConversationState } {
  const titles: Record<BiQueryIntent, string> = {
    overview: "经营概览",
    "refund-ranking": "店铺退款率排名",
    "revenue-trend": "销售额趋势",
    "response-ranking": "客服响应时长排名",
    "complaint-analysis": "投诉情况分析",
  };
  const chart =
    intent === "revenue-trend"
      ? {
          type: "line" as const,
          xKey: "date",
          series: [{ key: "revenue", label: "销售额", color: "#6d5dfc" }],
          data: result.rows,
        }
      : {
          type: "bar" as const,
          xKey: "shopName",
          series: [
            intent === "refund-ranking"
              ? { key: "refundRate", label: "退款率（%）", color: "#f26b5b" }
              : intent === "response-ranking"
                ? { key: "avgResponseMinutes", label: "平均响应时长（分钟）", color: "#f5a524" }
                : intent === "complaint-analysis"
                  ? { key: "complaints", label: "投诉量", color: "#e0568a" }
                  : { key: "revenue", label: "销售额", color: "#32a982" },
          ],
          data: result.rows,
        };

  const topShop = result.rows[0];
  const recommendations =
    intent === "refund-ranking"
      ? [
          {
            priority: "high" as const,
            title: "拆分高退款商品和退款原因",
            description: `优先检查 ${String(topShop?.shopName ?? "高退款店铺")} 的商品、物流和退款原因分布。`,
            validationMetric: "未来 14 天退款率",
          },
        ]
      : intent === "response-ranking"
        ? [
            {
              priority: "high" as const,
              title: "检查高峰时段排班",
              description: "按小时拆分首次响应时长，确认是否集中在夜间或直播高峰。",
              validationMetric: "首次响应时长 P90",
            },
          ]
        : [
            {
              priority: "medium" as const,
              title: "持续观察异常店铺",
              description: "将变化最大的店铺加入下一个周期的重点观察列表。",
              validationMetric: "销售额、退款率和投诉量",
            },
          ];

  return {
    answer: {
      answerType:
        intent === "revenue-trend"
          ? "trend"
          : intent === "overview"
            ? "overview"
            : intent.includes("ranking")
              ? "ranking"
              : "analysis",
      title: titles[intent],
      summary: buildSummary(intent, result, modelSummary),
      scope: result.scope,
      metrics: buildMetrics(result),
      chart,
      evidence: [
        `查询覆盖 ${result.scope.shopIds.length} 个授权店铺。`,
        `数据时间范围：${result.scope.dateRange.start} 至 ${result.scope.dateRange.end}。`,
        `数据最新同步至：${result.scope.dataFreshness}。`,
      ],
      recommendations,
      caveats: [
        "金额已按演示报表币种归一化；该 Demo 不包含真实汇率换算。",
        "归因结论仅代表数据贡献与待验证假设，不代表因果关系。",
      ],
      suggestedQuestions: [
        "只看 TikTok 店铺会有什么变化？",
        "进一步分析退款率最高的店铺",
        "换成最近 7 天再看一次",
      ],
    },
    biState: {
      intent,
      metric:
        intent === "refund-ranking"
          ? "refund_rate"
          : intent === "response-ranking"
            ? "avg_response_minutes"
            : "revenue",
      dimension: intent === "revenue-trend" ? "date" : "shop",
      dateRange: result.scope.dateRange,
      shopIds: result.scope.shopIds,
      platforms: result.scope.platforms,
      previousDatasetId: result.datasetId,
    },
  };
}
