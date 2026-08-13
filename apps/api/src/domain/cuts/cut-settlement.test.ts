import { describe, expect, it } from "vitest";
import { computeCutSettlementMetrics } from "./cut-settlement.js";

describe("computeCutSettlementMetrics", () => {
  it("marks cut as squared when all received is finalized and assigned", () => {
    const metrics = computeCutSettlementMetrics({
      cutId: "c1",
      cutNumber: "C-1",
      totalReceivedByCut: 100,
      totalAssignedByCut: 100,
      allocations: [
        { type: "PARTIAL_EXIT", quantity: 80, cancelled: false },
        { type: "SHRINKAGE", quantity: 10, cancelled: false },
        { type: "SOBRANTE_LINEA", quantity: 10, cancelled: false },
      ],
    });
    expect(metrics.squared).toBe(true);
    expect(metrics.pendingByCut).toBe(0);
    expect(metrics.inRepairByCut).toBe(0);
    expect(metrics.unassignedByCut).toBe(0);
    expect(metrics.reasons).toEqual([]);
  });

  it("is not squared when garments remain in repair or unassigned", () => {
    const metrics = computeCutSettlementMetrics({
      cutId: "c1",
      cutNumber: "C-1",
      totalReceivedByCut: 100,
      totalAssignedByCut: 90,
      allocations: [
        { type: "PARTIAL_EXIT", quantity: 50, cancelled: false },
        { type: "SEND_TO_REPAIR", quantity: 10, cancelled: false },
        { type: "RETURN_FROM_REPAIR", quantity: 5, cancelled: false },
      ],
    });
    expect(metrics.squared).toBe(false);
    expect(metrics.inRepairByCut).toBe(5);
    expect(metrics.unassignedByCut).toBe(10);
    expect(metrics.reasons.length).toBeGreaterThan(0);
  });

  it("ignores cancelled allocations", () => {
    const metrics = computeCutSettlementMetrics({
      cutId: "c1",
      cutNumber: "C-1",
      totalReceivedByCut: 10,
      totalAssignedByCut: 10,
      allocations: [
        { type: "PARTIAL_EXIT", quantity: 10, cancelled: false },
        { type: "PARTIAL_EXIT", quantity: 5, cancelled: true },
      ],
    });
    expect(metrics.deliveredByCut).toBe(10);
    expect(metrics.squared).toBe(true);
  });
});
