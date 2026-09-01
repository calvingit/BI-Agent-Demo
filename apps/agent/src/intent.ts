import type { BiQueryIntent } from "@bi-agent/contracts";

export function inferIntent(message: string, previousIntent?: string): BiQueryIntent {
  if (/退款|退货/.test(message)) return "refund-ranking";
  if (/回复|响应|客服时长/.test(message)) return "response-ranking";
  if (/投诉|差评/.test(message)) return "complaint-analysis";
  if (/趋势|销售额|营收|GMV/i.test(message)) return "revenue-trend";
  if (previousIntent && message.length < 24) return previousIntent as BiQueryIntent;
  return "overview";
}

export function inferDays(message: string): number {
  const explicit = message.match(/(?:最近|近)?\s*(\d{1,2})\s*天/);
  if (explicit?.[1]) return Math.min(90, Math.max(7, Number(explicit[1])));
  if (/本周|一周|7\s*天/.test(message)) return 7;
  return 30;
}
