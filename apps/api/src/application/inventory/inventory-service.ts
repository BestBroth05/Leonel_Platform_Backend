import { and, asc, eq, isNull } from "drizzle-orm";
import type { MovementType, OrderBalance, OrderStatus } from "@leonel-platform/shared";
import {
  computeOrderBalance,
  movementDeltaOnAvailable,
} from "../../domain/inventory/balance.js";
import type { OrdersService } from "../orders/orders-service.js";
import type { AppDb } from "../../infrastructure/db/client.js";
import { writeAudit } from "../../infrastructure/db/audit.js";
import {
  destinations,
  inventoryMovements,
  orders,
} from "../../infrastructure/db/schema.js";
import { AppError, ForbiddenError, NotFoundError } from "../../shared/errors.js";

const ENTRY_TYPES: MovementType[] = ["RECEPTION", "ADDITIONAL_ENTRY"];
const EXIT_TYPES: MovementType[] = ["PARTIAL_EXIT", "FINAL_EXIT"];
const POSITIVE_ONLY: MovementType[] = [
  "RECEPTION",
  "ADDITIONAL_ENTRY",
  "RECEPTION_SHORTAGE",
  "SEND_TO_REPAIR",
  "RETURN_FROM_REPAIR",
  "SHRINKAGE",
  "PARTIAL_EXIT",
  "FINAL_EXIT",
];

export type MovementDto = {
  id: string;
  orderId: string;
  type: MovementType;
  quantity: number;
  note: string | null;
  destinationId: string | null;
  cancelsMovementId: string | null;
  idempotencyKey: string | null;
  cancelledAt: string | null;
  createdAt: string;
  createdBy: string | null;
};

export class InventoryService {
  constructor(
    private readonly db: AppDb,
    private readonly ordersService: OrdersService,
  ) {}

  async getBalance(orderId: string): Promise<{ orderId: string; balance: OrderBalance }> {
    const order = await this.requireOrder(orderId);
    const movements = await this.loadMovements(orderId);
    return {
      orderId,
      balance: computeOrderBalance(
        order.expectedQuantity,
        movements.map((m) => ({
          type: m.type as MovementType,
          quantity: m.quantity,
          cancelled: Boolean(m.cancelledAt),
        })),
      ),
    };
  }

  async listMovements(orderId: string): Promise<MovementDto[]> {
    await this.requireOrder(orderId);
    const rows = await this.loadMovements(orderId);
    return rows.map(this.toDto);
  }

  async createMovement(
    input: {
      orderId: string;
      type: MovementType;
      quantity: number;
      note?: string | null;
      destinationId?: string | null;
      idempotencyKey?: string | null;
    },
    actorUserId: string,
    permissions: string[],
  ): Promise<{ movement: MovementDto; balance: OrderBalance; replayed: boolean }> {
    if (input.type === "CORRECTION" && !permissions.includes("inventory.correct")) {
      throw new ForbiddenError("Sin permiso para correcciones de inventario");
    }
    if (input.type === "CANCELLATION") {
      throw new AppError(
        "VALIDATION_ERROR",
        "Use POST /orders/:id/movements/:movementId/cancel para cancelar",
      );
    }

    if (input.idempotencyKey) {
      const existing = await this.db.query.inventoryMovements.findFirst({
        where: and(
          eq(inventoryMovements.createdBy, actorUserId),
          eq(inventoryMovements.idempotencyKey, input.idempotencyKey),
        ),
      });
      if (existing) {
        const balance = (await this.getBalance(input.orderId)).balance;
        return { movement: this.toDto(existing), balance, replayed: true };
      }
    }

    return this.db.transaction(async (tx) => {
      const order = await tx.query.orders.findFirst({
        where: and(eq(orders.id, input.orderId), isNull(orders.deletedAt)),
      });
      if (!order) throw new NotFoundError("Pedido no encontrado");
      const status = order.status as OrderStatus;
      if (status === "CANCELLED" || status === "COMPLETED") {
        throw new AppError(
          "INVALID_STATE",
          "No se pueden registrar movimientos en un pedido cerrado o cancelado",
        );
      }

      this.validateQuantity(input.type, input.quantity);

      if (input.destinationId) {
        const dest = await tx.query.destinations.findFirst({
          where: and(
            eq(destinations.id, input.destinationId),
            isNull(destinations.deletedAt),
            eq(destinations.isActive, true),
          ),
        });
        if (!dest) throw new AppError("VALIDATION_ERROR", "Destino inexistente o inactivo");
      }

      const currentMovements = await tx
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.orderId, input.orderId));

      const balance = computeOrderBalance(
        order.expectedQuantity,
        currentMovements.map((m) => ({
          type: m.type as MovementType,
          quantity: m.quantity,
          cancelled: Boolean(m.cancelledAt),
        })),
      );

      this.assertBusinessRules(input.type, input.quantity, balance);

      const nextAvailable =
        balance.available + movementDeltaOnAvailable(input.type, input.quantity);
      if (nextAvailable < 0 && input.type !== "CORRECTION") {
        throw new AppError(
          "INSUFFICIENT_STOCK",
          `Saldo insuficiente: disponible ${balance.available}, solicitado efecto ${Math.abs(movementDeltaOnAvailable(input.type, input.quantity))}`,
        );
      }
      if (input.type === "CORRECTION" && nextAvailable < 0) {
        throw new AppError("INSUFFICIENT_STOCK", "La corrección dejaría saldo negativo");
      }
      if (input.type === "RETURN_FROM_REPAIR" && input.quantity > balance.inRepair) {
        throw new AppError(
          "INSUFFICIENT_STOCK",
          `No hay suficientes piezas en reparación (actual: ${balance.inRepair})`,
        );
      }

      const [created] = await tx
        .insert(inventoryMovements)
        .values({
          orderId: input.orderId,
          type: input.type,
          quantity: input.quantity,
          note: input.note?.trim() || null,
          destinationId: input.destinationId ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
          createdBy: actorUserId,
        })
        .returning();

      await this.bumpOrderStatus(tx, order, input.type, actorUserId);

      await writeAudit(tx, {
        actorUserId,
        action: "inventory.movement.create",
        entityType: "inventory_movement",
        entityId: created.id,
        metadata: {
          orderId: input.orderId,
          type: input.type,
          quantity: input.quantity,
        },
      });

      const refreshed = await tx
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.orderId, input.orderId));

      const nextBalance = computeOrderBalance(
        order.expectedQuantity,
        refreshed.map((m) => ({
          type: m.type as MovementType,
          quantity: m.quantity,
          cancelled: Boolean(m.cancelledAt),
        })),
      );

      return { movement: this.toDto(created), balance: nextBalance, replayed: false };
    });
  }

  async cancelMovement(
    orderId: string,
    movementId: string,
    actorUserId: string,
    permissions: string[],
    note?: string,
  ): Promise<{ cancellation: MovementDto; balance: OrderBalance }> {
    if (
      !permissions.includes("inventory.correct") &&
      !permissions.includes("inventory.write")
    ) {
      throw new ForbiddenError();
    }

    return this.db.transaction(async (tx) => {
      const order = await tx.query.orders.findFirst({
        where: and(eq(orders.id, orderId), isNull(orders.deletedAt)),
      });
      if (!order) throw new NotFoundError("Pedido no encontrado");

      const original = await tx.query.inventoryMovements.findFirst({
        where: and(
          eq(inventoryMovements.id, movementId),
          eq(inventoryMovements.orderId, orderId),
        ),
      });
      if (!original) throw new NotFoundError("Movimiento no encontrado");
      if (original.cancelledAt) {
        throw new AppError("INVALID_STATE", "El movimiento ya está cancelado");
      }
      if (original.type === "CANCELLATION") {
        throw new AppError("VALIDATION_ERROR", "No se puede cancelar una cancelación");
      }

      await tx
        .update(inventoryMovements)
        .set({ cancelledAt: new Date() })
        .where(eq(inventoryMovements.id, movementId));

      const [cancellation] = await tx
        .insert(inventoryMovements)
        .values({
          orderId,
          type: "CANCELLATION",
          quantity: original.quantity,
          note: note?.trim() || `Cancela ${original.id}`,
          cancelsMovementId: original.id,
          createdBy: actorUserId,
        })
        .returning();

      await writeAudit(tx, {
        actorUserId,
        action: "inventory.movement.cancel",
        entityType: "inventory_movement",
        entityId: original.id,
        metadata: { cancellationId: cancellation.id },
      });

      const refreshed = await tx
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.orderId, orderId));

      const balance = computeOrderBalance(
        order.expectedQuantity,
        refreshed.map((m) => ({
          type: m.type as MovementType,
          quantity: m.quantity,
          cancelled: Boolean(m.cancelledAt),
        })),
      );

      return { cancellation: this.toDto(cancellation), balance };
    });
  }

  private validateQuantity(type: MovementType, quantity: number) {
    if (type === "CORRECTION") {
      if (!Number.isInteger(quantity) || quantity === 0) {
        throw new AppError(
          "VALIDATION_ERROR",
          "La corrección requiere cantidad entera distinta de cero",
        );
      }
      return;
    }
    if (POSITIVE_ONLY.includes(type)) {
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new AppError("VALIDATION_ERROR", "La cantidad debe ser un entero > 0");
      }
    }
  }

  private assertBusinessRules(
    type: MovementType,
    quantity: number,
    balance: OrderBalance,
  ) {
    if (type === "SEND_TO_REPAIR" && quantity > balance.available) {
      throw new AppError(
        "INSUFFICIENT_STOCK",
        `No hay saldo disponible suficiente (actual: ${balance.available})`,
      );
    }
    if (
      (type === "SHRINKAGE" || EXIT_TYPES.includes(type)) &&
      quantity > balance.available
    ) {
      throw new AppError(
        "INSUFFICIENT_STOCK",
        `No hay saldo disponible suficiente (actual: ${balance.available})`,
      );
    }
  }

  private async bumpOrderStatus(
    tx: Pick<AppDb, "query" | "update" | "insert">,
    order: typeof orders.$inferSelect,
    type: MovementType,
    actorUserId: string,
  ) {
    const status = order.status as OrderStatus;

    if (ENTRY_TYPES.includes(type) && status === "DRAFT") {
      await this.ordersService.applyStatusIfAllowed(
        tx,
        order.id,
        "RECEIVING",
        actorUserId,
        "Recepción/entrada registrada",
      );
    } else if (ENTRY_TYPES.includes(type) && status === "RECEIVING") {
      await this.ordersService.applyStatusIfAllowed(
        tx,
        order.id,
        "IN_PROCESS",
        actorUserId,
        "Pedido en proceso tras movimientos",
      );
    }

    if (type === "PARTIAL_EXIT") {
      await this.ordersService.applyStatusIfAllowed(
        tx,
        order.id,
        "PARTIALLY_SHIPPED",
        actorUserId,
        "Salida parcial",
      );
    }

    if (type === "FINAL_EXIT") {
      await this.ordersService.applyStatusIfAllowed(
        tx,
        order.id,
        "COMPLETED",
        actorUserId,
        "Salida final",
      );
    }
  }

  private async requireOrder(orderId: string) {
    const order = await this.db.query.orders.findFirst({
      where: and(eq(orders.id, orderId), isNull(orders.deletedAt)),
    });
    if (!order) throw new NotFoundError("Pedido no encontrado");
    return order;
  }

  private async loadMovements(orderId: string) {
    return this.db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.orderId, orderId))
      .orderBy(asc(inventoryMovements.createdAt));
  }

  private toDto = (row: typeof inventoryMovements.$inferSelect): MovementDto => ({
    id: row.id,
    orderId: row.orderId,
    type: row.type as MovementType,
    quantity: row.quantity,
    note: row.note,
    destinationId: row.destinationId,
    cancelsMovementId: row.cancelsMovementId,
    idempotencyKey: row.idempotencyKey,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  });
}
