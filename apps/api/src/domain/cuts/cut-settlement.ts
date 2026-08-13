import type { CutSettlementMetrics, MovementType } from "@leonel-platform/shared";

export type CutSettlementAllocation = {
  type: MovementType;
  quantity: number;
  cancelled: boolean;
};

export function computeCutSettlementMetrics(input: {
  cutId: string;
  cutNumber: string;
  totalReceivedByCut: number;
  totalAssignedByCut: number;
  allocations: CutSettlementAllocation[];
}): CutSettlementMetrics {
  let deliveredByCut = 0;
  let shrinkageByCut = 0;
  let lineSurplusByCut = 0;
  let sentToRepairByCut = 0;
  let returnedFromRepairByCut = 0;

  for (const row of input.allocations) {
    if (row.cancelled) continue;
    switch (row.type) {
      case "PARTIAL_EXIT":
      case "FINAL_EXIT":
        deliveredByCut += row.quantity;
        break;
      case "SHRINKAGE":
        shrinkageByCut += row.quantity;
        break;
      case "SOBRANTE_LINEA":
        lineSurplusByCut += row.quantity;
        break;
      case "SEND_TO_REPAIR":
        sentToRepairByCut += row.quantity;
        break;
      case "RETURN_FROM_REPAIR":
        returnedFromRepairByCut += row.quantity;
        break;
      default:
        break;
    }
  }

  const finalizedByCut = deliveredByCut + shrinkageByCut + lineSurplusByCut;
  const inRepairByCut = Math.max(0, sentToRepairByCut - returnedFromRepairByCut);
  const unassignedByCut = input.totalReceivedByCut - input.totalAssignedByCut;
  const pendingByCut =
    input.totalReceivedByCut - finalizedByCut - inRepairByCut;

  const reasons: string[] = [];
  if (input.totalAssignedByCut > input.totalReceivedByCut) {
    reasons.push("La cantidad asignada supera lo recibido.");
  }
  if (finalizedByCut > input.totalReceivedByCut) {
    reasons.push("Lo finalizado supera lo recibido.");
  }
  if (returnedFromRepairByCut > sentToRepairByCut) {
    reasons.push("Hay más regresos de compostura que envíos.");
  }
  if (unassignedByCut !== 0) {
    reasons.push(
      unassignedByCut > 0
        ? `Quedan ${unassignedByCut} prendas sin asignar.`
        : `Hay ${Math.abs(unassignedByCut)} prendas asignadas de más.`,
    );
  }
  if (inRepairByCut !== 0) {
    reasons.push(`Hay ${inRepairByCut} prendas en compostura.`);
  }
  if (pendingByCut !== 0) {
    reasons.push(`Hay ${pendingByCut} prendas pendientes de destino final.`);
  }
  if (finalizedByCut !== input.totalReceivedByCut) {
    reasons.push(
      `Finalizado (${finalizedByCut}) ≠ recibido (${input.totalReceivedByCut}).`,
    );
  }

  const squared =
    finalizedByCut === input.totalReceivedByCut &&
    pendingByCut === 0 &&
    inRepairByCut === 0 &&
    unassignedByCut === 0 &&
    input.totalAssignedByCut <= input.totalReceivedByCut &&
    finalizedByCut <= input.totalReceivedByCut &&
    returnedFromRepairByCut <= sentToRepairByCut;

  return {
    cutId: input.cutId,
    cutNumber: input.cutNumber,
    totalReceivedByCut: input.totalReceivedByCut,
    deliveredByCut,
    shrinkageByCut,
    lineSurplusByCut,
    finalizedByCut,
    sentToRepairByCut,
    returnedFromRepairByCut,
    inRepairByCut,
    totalAssignedByCut: input.totalAssignedByCut,
    unassignedByCut,
    pendingByCut,
    squared,
    reasons: squared ? [] : [...new Set(reasons)],
  };
}
