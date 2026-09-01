import { describe, expect, it } from "vitest";
import { inferDays, inferIntent } from "./intent.js";

describe("intent and date parsing", () => {
  it("maps supported Chinese questions to bounded BI intents", () => {
    expect(inferIntent("最近 30 天哪些店铺退款率最高？")).toBe("refund-ranking");
    expect(inferIntent("分析销售额趋势")).toBe("revenue-trend");
    expect(inferIntent("客服回复是不是变慢了？")).toBe("response-ranking");
    expect(inferIntent("最近投诉最多的是哪个店铺？")).toBe("complaint-analysis");
  });

  it("bounds explicit date ranges", () => {
    expect(inferDays("最近 3 天")).toBe(7);
    expect(inferDays("最近 30 天")).toBe(30);
    expect(inferDays("最近 99 天")).toBe(90);
    expect(inferDays("总结经营情况")).toBe(30);
  });

  it("inherits the previous intent for short follow-ups", () => {
    expect(inferIntent("换成最近 7 天", "refund-ranking")).toBe("refund-ranking");
  });
});
