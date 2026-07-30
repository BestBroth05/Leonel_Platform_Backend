import { describe, expect, it } from "vitest";
import { computeOrderBalance, movementDeltaOnAvailable } from "./balance.js";

describe("computeOrderBalance", () => {
  it("computes available from provisional formula", () => {
    const balance = computeOrderBalance(1000, [
      { type: "RECEPTION", quantity: 900, cancelled: false },
      { type: "RECEPTION_SHORTAGE", quantity: 100, cancelled: false },
      { type: "SEND_TO_REPAIR", quantity: 20, cancelled: false },
      { type: "RETURN_FROM_REPAIR", quantity: 5, cancelled: false },
      { type: "SHRINKAGE", quantity: 10, cancelled: false },
      { type: "PARTIAL_EXIT", quantity: 200, cancelled: false },
    ]);

    expect(balance.expectedQuantity).toBe(1000);
    expect(balance.received).toBe(900);
    expect(balance.shortage).toBe(100);
    expect(balance.inRepair).toBe(15);
    expect(balance.shrinkage).toBe(10);
    expect(balance.shipped).toBe(200);
    expect(balance.available).toBe(675);
  });

  it("ignores cancelled movements", () => {
    const balance = computeOrderBalance(100, [
      { type: "RECEPTION", quantity: 50, cancelled: false },
      { type: "RECEPTION", quantity: 30, cancelled: true },
      { type: "PARTIAL_EXIT", quantity: 10, cancelled: false },
    ]);
    expect(balance.received).toBe(50);
    expect(balance.available).toBe(40);
  });

  it("applies signed corrections", () => {
    const balance = computeOrderBalance(100, [
      { type: "RECEPTION", quantity: 40, cancelled: false },
      { type: "CORRECTION", quantity: 5, cancelled: false },
      { type: "CORRECTION", quantity: -3, cancelled: false },
    ]);
    expect(balance.received).toBe(45);
    expect(balance.shrinkage).toBe(3);
    expect(balance.available).toBe(42);
  });
});

describe("movementDeltaOnAvailable", () => {
  it("maps entry and exit effects", () => {
    expect(movementDeltaOnAvailable("RECEPTION", 10)).toBe(10);
    expect(movementDeltaOnAvailable("SEND_TO_REPAIR", 4)).toBe(-4);
    expect(movementDeltaOnAvailable("RETURN_FROM_REPAIR", 4)).toBe(4);
    expect(movementDeltaOnAvailable("PARTIAL_EXIT", 7)).toBe(-7);
    expect(movementDeltaOnAvailable("RECEPTION_SHORTAGE", 9)).toBe(0);
  });
});
