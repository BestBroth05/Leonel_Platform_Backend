import type { MovementType, OrderBalance } from "@leonel-platform/shared";

export type BalanceMovement = {
  type: MovementType;
  quantity: number;
  cancelled: boolean;
};

/**
 * Provisional balance formula (plan §5):
 * available = received − inRepair − shrinkage − shipped
 * RECEPTION_SHORTAGE is informational only.
 */
export function computeOrderBalance(
  expectedQuantity: number,
  movements: BalanceMovement[],
): OrderBalance {
  let received = 0;
  let inRepair = 0;
  let shrinkage = 0;
  let shipped = 0;
  let shortage = 0;

  for (const movement of movements) {
    if (movement.cancelled) continue;
    const qty = movement.quantity;

    switch (movement.type) {
      case "RECEPTION":
      case "ADDITIONAL_ENTRY":
        received += qty;
        break;
      case "RECEPTION_SHORTAGE":
        shortage += qty;
        break;
      case "SEND_TO_REPAIR":
        inRepair += qty;
        break;
      case "RETURN_FROM_REPAIR":
        inRepair -= qty;
        break;
      case "SHRINKAGE":
        shrinkage += qty;
        break;
      case "PARTIAL_EXIT":
      case "FINAL_EXIT":
        shipped += qty;
        break;
      case "CORRECTION":
        // Signed quantity: positive increases available stock (as received),
        // negative decreases via shrinkage semantics for simplicity.
        if (qty >= 0) {
          received += qty;
        } else {
          shrinkage += Math.abs(qty);
        }
        break;
      case "CANCELLATION":
        // Compensating rows are applied via cancelled flag on originals
        // or as opposite effects stored by the service before insert.
        break;
      default:
        break;
    }
  }

  const available = received - inRepair - shrinkage - shipped;

  return {
    expectedQuantity,
    received,
    inRepair,
    shrinkage,
    shipped,
    available,
    shortage,
  };
}

export function movementDeltaOnAvailable(type: MovementType, quantity: number): number {
  switch (type) {
    case "RECEPTION":
    case "ADDITIONAL_ENTRY":
      return quantity;
    case "SEND_TO_REPAIR":
    case "SHRINKAGE":
    case "PARTIAL_EXIT":
    case "FINAL_EXIT":
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
