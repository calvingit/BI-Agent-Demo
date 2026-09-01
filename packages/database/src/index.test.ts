import { describe, expect, it } from "vitest";
import {
  createPermissionSnapshot,
  executeBiQuery,
  getPermissionSnapshot,
  getUserShops,
  seedDemoData,
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
});
