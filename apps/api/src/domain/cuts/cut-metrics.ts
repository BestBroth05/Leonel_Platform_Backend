import type { CutStatus } from "@leonel-platform/shared";

export function computeCutStatus(
  expectedQuantity: number,
  receivedQuantity: number,
): CutStatus {
  if (receivedQuantity <= 0) return "PENDING";
  if (receivedQuantity < expectedQuantity) return "PARTIAL";
  if (receivedQuantity === expectedQuantity) return "COMPLETE";
  return "SURPLUS";
}

export function computeCutMetrics(input: {
  expectedQuantity: number;
  totalReceived: number;
  totalAssigned: number;
}) {
  const pendingQuantity = Math.max(0, input.expectedQuantity - input.totalReceived);
  const availableToAssign = input.totalReceived - input.totalAssigned;
  return {
    totalReceived: input.totalReceived,
    totalAssigned: input.totalAssigned,
    availableToAssign,
    pendingQuantity,
    status: computeCutStatus(input.expectedQuantity, input.totalReceived),
  };
}
