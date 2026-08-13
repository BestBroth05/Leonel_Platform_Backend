import { describe, expect, it } from "vitest";
import { computeOrderBalance, movementDeltaOnAvailable } from "./balance.js";

describe("computeOrderBalance", () => {
  it("uses assignedQuantity as baseline and ignores RECEPTION movements", () => {
    const balance = computeOrderBalance(
      1000,
      [
        { type: "RECEPTION", quantity: 1000, cancelled: false },
        { type: "SEND_TO_REPAIR", quantity: 20, cancelled: false },
        { type: "RETURN_FROM_REPAIR", quantity: 5, cancelled: false },
        { type: "SHRINKAGE", quantity: 10, cancelled: false },
        { type: "PARTIAL_EXIT", quantity: 200, cancelled: false },
        { type: "SOBRANTE_LINEA", quantity: 15, cancelled: false },
      ],
      { useAssignedBaseline: true },
    );

    expect(balance.assignedQuantity).toBe(1000);
    expect(balance.received).toBe(1000);
    expect(balance.inRepair).toBe(15);
    expect(balance.shrinkage).toBe(10);
    expect(balance.shipped).toBe(200);
    expect(balance.lineSurplus).toBe(15);
    // 1000 - 15 - 10 - 200 - 15 = 760
    expect(balance.available).toBe(760);
  });

  it("computes net inRepair without treating return as new entry", () => {
    const balance = computeOrderBalance(
      100,
      [
        { type: "SEND_TO_REPAIR", quantity: 30, cancelled: false },
        { type: "RETURN_FROM_REPAIR", quantity: 12, cancelled: false },
      ],
      { useAssignedBaseline: true },
    );
    expect(balance.inRepair).toBe(18);
    expect(balance.available).toBe(82);
    expect(balance.received).toBe(100);
  });

  it("ignores cancelled movements", () => {
    const balance = computeOrderBalance(
      100,
      [
        { type: "PARTIAL_EXIT", quantity: 10, cancelled: false },
        { type: "PARTIAL_EXIT", quantity: 30, cancelled: true },
      ],
      { useAssignedBaseline: true },
    );
    expect(balance.shipped).toBe(10);
    expect(balance.available).toBe(90);
  });

  it("supports legacy reception-based baseline when not using assigned", () => {
    const balance = computeOrderBalance(
      0,
      [
        { type: "RECEPTION", quantity: 900, cancelled: false },
        { type: "RECEPTION_SHORTAGE", quantity: 100, cancelled: false },
        { type: "SEND_TO_REPAIR", quantity: 20, cancelled: false },
        { type: "RETURN_FROM_REPAIR", quantity: 5, cancelled: false },
        { type: "SHRINKAGE", quantity: 10, cancelled: false },
        { type: "PARTIAL_EXIT", quantity: 200, cancelled: false },
      ],
      { useAssignedBaseline: false },
    );

    expect(balance.received).toBe(900);
    expect(balance.shortage).toBe(100);
    expect(balance.inRepair).toBe(15);
    expect(balance.available).toBe(675);
  });
});

describe("movementDeltaOnAvailable", () => {
  it("maps operational effects under assigned baseline", () => {
    expect(movementDeltaOnAvailable("RECEPTION", 10, { useAssignedBaseline: true })).toBe(0);
    expect(movementDeltaOnAvailable("SEND_TO_REPAIR", 4)).toBe(-4);
    expect(movementDeltaOnAvailable("RETURN_FROM_REPAIR", 4)).toBe(4);
    expect(movementDeltaOnAvailable("SOBRANTE_LINEA", 7)).toBe(-7);
    expect(movementDeltaOnAvailable("PARTIAL_EXIT", 7)).toBe(-7);
  });
});
