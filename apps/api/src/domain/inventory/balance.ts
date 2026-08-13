import type { MovementType, OrderBalance } from "@leonel-platform/shared";

export type BalanceMovement = {
  type: MovementType;
  quantity: number;
  cancelled: boolean;
};

export type BalanceOptions = {
  /**
   * When true, RECEPTION/ADDITIONAL_ENTRY do not increase the baseline.
   * Cut receipts + assignedQuantity are the physical intake source of truth.
   */
  useAssignedBaseline?: boolean;
};

/**
 * Order balance:
 * - New flow: initial = assignedQuantity; operational movements apply against it.
 * - Legacy (no assigned baseline): RECEPTION/ADDITIONAL_ENTRY still increase stock.
 * - inRepair = sentToRepair − returnedFromRepair (net; return is not a new entry).
 * - available = received − inRepair − shrinkage − shipped − lineSurplus
 */
export function computeOrderBalance(
  assignedQuantity: number,
  movements: BalanceMovement[],
  options: BalanceOptions = {},
): OrderBalance {
  const useAssigned = options.useAssignedBaseline ?? assignedQuantity > 0;
  let entryFromMovements = 0;
  let sentToRepair = 0;
  let returnedFromRepair = 0;
  let shrinkage = 0;
  let shipped = 0;
  let shortage = 0;
  let lineSurplus = 0;

  for (const movement of movements) {
    if (movement.cancelled) continue;
    const qty = movement.quantity;

    switch (movement.type) {
      case "RECEPTION":
      case "ADDITIONAL_ENTRY":
        if (!useAssigned) {
          entryFromMovements += qty;
        }
        break;
      case "RECEPTION_SHORTAGE":
        shortage += qty;
        break;
      case "SEND_TO_REPAIR":
        sentToRepair += qty;
        break;
      case "RETURN_FROM_REPAIR":
        returnedFromRepair += qty;
        break;
      case "SHRINKAGE":
        shrinkage += qty;
        break;
      case "PARTIAL_EXIT":
      case "FINAL_EXIT":
        shipped += qty;
        break;
      case "SOBRANTE_LINEA":
        lineSurplus += qty;
        break;
      case "CORRECTION":
        if (qty >= 0) {
          entryFromMovements += qty;
        } else {
          shrinkage += Math.abs(qty);
        }
        break;
      case "CANCELLATION":
        break;
      default:
        break;
    }
  }

  const received = useAssigned
    ? assignedQuantity + entryFromMovements
    : entryFromMovements;
  const inRepair = Math.max(0, sentToRepair - returnedFromRepair);
  const available = received - inRepair - shrinkage - shipped - lineSurplus;
  const pendingToAccount = Math.max(0, available);

  const warnings: string[] = [];
  if (available < 0) {
    warnings.push(
      `Los movimientos superan la cantidad asignada (disponible ${available.toLocaleString("es-MX")}).`,
    );
  }
  if (returnedFromRepair > sentToRepair) {
    warnings.push("Hay más regresos de compostura que envíos.");
  }
  if (shipped + shrinkage + lineSurplus > received) {
    warnings.push(
      "Las salidas finales (entregas + merma + sobrante) superan la cantidad asignada.",
    );
  }
  if (useAssigned && pendingToAccount > 0) {
    warnings.push(
      `Quedan ${pendingToAccount.toLocaleString("es-MX")} prendas pendientes de contabilizar o entregar.`,
    );
  }

  return {
    assignedQuantity: useAssigned ? assignedQuantity : received,
    expectedQuantity: useAssigned ? assignedQuantity : received,
    received,
    inRepair,
    shrinkage,
    shipped,
    lineSurplus,
    available,
    shortage,
    pendingToAccount,
    warnings,
  };
}

export function movementDeltaOnAvailable(
  type: MovementType,
  quantity: number,
  options: BalanceOptions = {},
): number {
  const useAssigned = options.useAssignedBaseline ?? true;
  switch (type) {
    case "RECEPTION":
    case "ADDITIONAL_ENTRY":
      return useAssigned ? 0 : quantity;
    case "SEND_TO_REPAIR":
    case "SHRINKAGE":
    case "PARTIAL_EXIT":
    case "FINAL_EXIT":
    case "SOBRANTE_LINEA":
      return -quantity;
    case "RETURN_FROM_REPAIR":
      return quantity;
    case "CORRECTION":
      return quantity;
    case "RECEPTION_SHORTAGE":
    case "CANCELLATION":
      return 0;
    default:
      return 0;
  }
}
