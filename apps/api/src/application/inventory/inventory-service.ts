import { and, asc, eq, isNull } from "drizzle-orm";
import type {
  MovementType,
  OrderBalance,
  OrderStatus,
  PackagingType,
} from "@leonel-platform/shared";
import {
  computeOrderBalance,
  movementDeltaOnAvailable,
} from "../../domain/inventory/balance.js";
import { resolveGarmentQuantity } from "../../domain/weeks/packaging.js";
import type { OrdersService } from "../orders/orders-service.js";
import {
  lockOpenWeekForClient,
  validateEffectiveAgainstOpenWeek,
} from "../client-weeks/week-lock.js";
import type { AppDb } from "../../infrastructure/db/client.js";
import { writeAudit } from "../../infrastructure/db/audit.js";
import {
  destinations,
  inventoryMovements,
  movementCutAllocations,
  movementSizeBreakdowns,
  orderCuts,
  orders,
  productionFormats,
} from "../../infrastructure/db/schema.js";
import { AppError, ForbiddenError, NotFoundError } from "../../shared/errors.js";

const ENTRY_TYPES: MovementType[] = ["RECEPTION", "ADDITIONAL_ENTRY"];
const EXIT_TYPES: MovementType[] = ["PARTIAL_EXIT", "FINAL_EXIT"];
const TYPES_NEEDING_ALLOCATION: MovementType[] = [
  "SEND_TO_REPAIR",
  "RETURN_FROM_REPAIR",
  "SHRINKAGE",
  "PARTIAL_EXIT",
  "FINAL_EXIT",
  "SOBRANTE_LINEA",
];
const POSITIVE_ONLY: MovementType[] = [
  "RECEPTION",
  "ADDITIONAL_ENTRY",
  "RECEPTION_SHORTAGE",
  "SEND_TO_REPAIR",
  "RETURN_FROM_REPAIR",
  "SHRINKAGE",
  "PARTIAL_EXIT",
  "FINAL_EXIT",
  "SOBRANTE_LINEA",
];

export type MovementCutAllocationInput = {
  orderCutId: string;
  quantity: number;
};

export type MovementDto = {
  id: string;
  orderId: string;
  clientWeekId: string | null;
  type: MovementType;
  quantity: number;
  packagingType: PackagingType | null;
  packageCount: number | null;
  unitsPerPackage: number | null;
  note: string | null;
  destinationId: string | null;
  cancelsMovementId: string | null;
  idempotencyKey: string | null;
  occurredAt: string;
  cancelledAt: string | null;
  createdAt: string;
  createdBy: string | null;
  cutAllocations: { orderCutId: string; cutId: string; quantity: number }[];
  sizes: { sizeLabel: string; quantity: number }[];
};

export class InventoryService {
  constructor(
    private readonly db: AppDb,
    private readonly ordersService: OrdersService,
  ) {}

  async getBalance(orderId: string): Promise<{ orderId: string; balance: OrderBalance }> {
    const order = await this.requireOrder(orderId);
    const movements = await this.loadMovements(orderId);
    const assigned = await this.ordersService.getOrderQuantity(orderId);
    const useAssignedBaseline =
      assigned > 0 || order.assignedQuantity != null || order.cutId != null;
    return {
      orderId,
      balance: computeOrderBalance(
        assigned > 0 ? assigned : (order.assignedQuantity ?? order.expectedQuantity),
        movements.map((m) => ({
          type: m.type as MovementType,
          quantity: m.quantity,
          cancelled: Boolean(m.cancelledAt),
        })),
        { useAssignedBaseline },
      ),
    };
  }

  async listMovements(orderId: string): Promise<MovementDto[]> {
    await this.requireOrder(orderId);
    const rows = await this.loadMovements(orderId);
    return Promise.all(rows.map((r) => this.toDto(r)));
  }

  async createMovement(
    input: {
      orderId: string;
      type: MovementType;
      quantity?: number;
      packagingType?: PackagingType | null;
      packageCount?: number | null;
      unitsPerPackage?: number | null;
      note?: string | null;
      destinationId?: string | null;
      idempotencyKey?: string | null;
      occurredAt?: string | Date;
      cutAllocations?: MovementCutAllocationInput[];
      sizes?: { sizeLabel: string; quantity: number }[];
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
        return { movement: await this.toDto(existing), balance, replayed: true };
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

      if (!order.productionFormatId) {
        throw new AppError("VALIDATION_ERROR", "El pedido no tiene formato de producción");
      }
      const format = await tx.query.productionFormats.findFirst({
        where: and(
          eq(productionFormats.id, order.productionFormatId),
          isNull(productionFormats.deletedAt),
        ),
      });
      if (!format?.clientId) {
        throw new AppError("INVALID_STATE", "El formato no tiene cliente asignado");
      }
      if (format.clientId !== order.clientId) {
        throw new AppError(
          "VALIDATION_ERROR",
          "El cliente del pedido no coincide con el del formato",
        );
      }

      const week = await lockOpenWeekForClient(tx, order.clientId);
      const occurredAt = validateEffectiveAgainstOpenWeek(
        week,
        input.occurredAt ?? new Date(),
      );

      let quantity: number;
      let packagingType: PackagingType | null = null;
      let packageCount: number | null = null;
      let unitsPerPackage: number | null = null;
      try {
        const resolved = resolveGarmentQuantity({
          packagingType: input.packagingType,
          packageCount: input.packageCount,
          unitsPerPackage: input.unitsPerPackage,
          quantity: input.quantity,
        });
        quantity = resolved.quantity;
        packagingType = resolved.packagingType;
        packageCount = resolved.packageCount;
        unitsPerPackage = resolved.unitsPerPackage;
      } catch (error) {
        throw new AppError(
          "VALIDATION_ERROR",
          error instanceof Error ? error.message : "Cantidad/empaque inválido",
        );
      }

      this.validateQuantity(input.type, quantity);

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

      const orderCutRows = await tx
        .select()
        .from(orderCuts)
        .where(eq(orderCuts.orderId, input.orderId));

      let cutAllocations = input.cutAllocations ?? [];
      if (TYPES_NEEDING_ALLOCATION.includes(input.type)) {
        if (!cutAllocations.length) {
          if (orderCutRows.length === 1) {
            cutAllocations = [
              { orderCutId: orderCutRows[0]!.id, quantity },
            ];
          } else {
            throw new AppError(
              "VALIDATION_ERROR",
              "Debe indicar la distribución por corte (cutAllocations)",
            );
          }
        }
        const allocSum = cutAllocations.reduce((s, a) => s + a.quantity, 0);
        if (allocSum !== quantity) {
          throw new AppError(
            "VALIDATION_ERROR",
            `La suma de allocations (${allocSum}) debe igualar la cantidad (${quantity})`,
          );
        }
        const allowedIds = new Set(orderCutRows.map((r) => r.id));
        for (const a of cutAllocations) {
          if (!allowedIds.has(a.orderCutId)) {
            throw new AppError(
              "VALIDATION_ERROR",
              "Una allocation referencia un corte que no pertenece al pedido",
            );
          }
          if (!Number.isInteger(a.quantity) || a.quantity <= 0) {
            throw new AppError(
              "VALIDATION_ERROR",
              "Cada allocation debe tener cantidad entera > 0",
            );
          }
        }
      }

      if (input.sizes?.length) {
        const sizeSum = input.sizes.reduce((s, x) => s + x.quantity, 0);
        if (sizeSum !== quantity) {
          throw new AppError(
            "VALIDATION_ERROR",
            `La suma de tallas (${sizeSum}) debe igualar la cantidad (${quantity})`,
          );
        }
      }

      const currentMovements = await tx
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.orderId, input.orderId));

      const assignedFromCuts = await this.ordersService.getOrderQuantity(input.orderId, tx);
      const assigned =
        assignedFromCuts > 0
          ? assignedFromCuts
          : (order.assignedQuantity ?? order.expectedQuantity);
      const useAssignedBaseline =
        assignedFromCuts > 0 || order.assignedQuantity != null || order.cutId != null;
      const balanceOpts = { useAssignedBaseline };

      const balance = computeOrderBalance(
        assigned,
        currentMovements.map((m) => ({
          type: m.type as MovementType,
          quantity: m.quantity,
          cancelled: Boolean(m.cancelledAt),
        })),
        balanceOpts,
      );

      this.assertBusinessRules(input.type, quantity, balance);

      const nextAvailable =
        balance.available + movementDeltaOnAvailable(input.type, quantity, balanceOpts);
      if (nextAvailable < 0 && input.type !== "CORRECTION") {
        throw new AppError(
          "INSUFFICIENT_STOCK",
          `Saldo insuficiente: disponible ${balance.available}, solicitado efecto ${Math.abs(movementDeltaOnAvailable(input.type, quantity, balanceOpts))}`,
        );
      }
      if (input.type === "CORRECTION" && nextAvailable < 0) {
        throw new AppError("INSUFFICIENT_STOCK", "La corrección dejaría saldo negativo");
      }
      if (input.type === "RETURN_FROM_REPAIR" && quantity > balance.inRepair) {
        throw new AppError(
          "INSUFFICIENT_STOCK",
          `No hay suficientes piezas en reparación (actual: ${balance.inRepair})`,
        );
      }

      const [created] = await tx
        .insert(inventoryMovements)
        .values({
          orderId: input.orderId,
          clientWeekId: week.id,
          type: input.type,
          quantity,
          packagingType,
          packageCount,
          unitsPerPackage,
          note: input.note?.trim() || null,
          destinationId: input.destinationId ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
          occurredAt,
          createdBy: actorUserId,
        })
        .returning();

      if (cutAllocations.length) {
        await tx.insert(movementCutAllocations).values(
          cutAllocations.map((a) => ({
            movementId: created.id,
            orderCutId: a.orderCutId,
            quantity: a.quantity,
          })),
        );
      }

      if (input.sizes?.length) {
        await tx.insert(movementSizeBreakdowns).values(
          input.sizes.map((s) => ({
            movementId: created.id,
            sizeLabel: s.sizeLabel.trim(),
            quantity: s.quantity,
          })),
        );
      }

      await this.bumpOrderStatus(tx, order, input.type, actorUserId);

      await writeAudit(tx, {
        actorUserId,
        action: "inventory.movement.create",
        entityType: "inventory_movement",
        entityId: created.id,
        metadata: {
          orderId: input.orderId,
          type: input.type,
          quantity,
          clientWeekId: week.id,
        },
      });

      const refreshed = await tx
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.orderId, input.orderId));

      const nextBalance = computeOrderBalance(
        assigned,
        refreshed.map((m) => ({
          type: m.type as MovementType,
          quantity: m.quantity,
          cancelled: Boolean(m.cancelledAt),
        })),
        balanceOpts,
      );

      return {
        movement: await this.toDto(created, tx),
        balance: nextBalance,
        replayed: false,
      };
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

      const week = await lockOpenWeekForClient(tx, order.clientId);

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
      if (original.clientWeekId && original.clientWeekId !== week.id) {
        throw new AppError(
          "INVALID_STATE",
          "No se puede cancelar un movimiento de una semana cerrada sin reabrirla",
        );
      }

      await tx
        .update(inventoryMovements)
        .set({ cancelledAt: new Date() })
        .where(eq(inventoryMovements.id, movementId));

      const [cancellation] = await tx
        .insert(inventoryMovements)
        .values({
          orderId,
          clientWeekId: week.id,
          type: "CANCELLATION",
          quantity: original.quantity,
          note: note?.trim() || `Cancela ${original.id}`,
          cancelsMovementId: original.id,
          occurredAt: new Date(),
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

      const assignedFromCuts = await this.ordersService.getOrderQuantity(orderId, tx);
      const assigned =
        assignedFromCuts > 0
          ? assignedFromCuts
          : (order.assignedQuantity ?? order.expectedQuantity);
      const useAssignedBaseline =
        assignedFromCuts > 0 || order.assignedQuantity != null || order.cutId != null;
      const balance = computeOrderBalance(
        assigned,
        refreshed.map((m) => ({
          type: m.type as MovementType,
          quantity: m.quantity,
          cancelled: Boolean(m.cancelledAt),
        })),
        { useAssignedBaseline },
      );

      return { cancellation: await this.toDto(cancellation, tx), balance };
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
      (type === "SHRINKAGE" ||
        type === "SOBRANTE_LINEA" ||
        EXIT_TYPES.includes(type)) &&
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

    if (
      status === "DRAFT" &&
      (ENTRY_TYPES.includes(type) ||
        type === "SEND_TO_REPAIR" ||
        type === "SHRINKAGE" ||
        type === "PARTIAL_EXIT" ||
        type === "FINAL_EXIT" ||
        type === "SOBRANTE_LINEA")
    ) {
      await this.ordersService.applyStatusIfAllowed(
        tx,
        order.id,
        "RECEIVING",
        actorUserId,
        "Movimiento registrado",
      );
      await this.ordersService.applyStatusIfAllowed(
        tx,
        order.id,
        "IN_PROCESS",
        actorUserId,
        "Pedido en proceso tras movimientos",
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

  private async toDto(
    row: typeof inventoryMovements.$inferSelect,
    db: Pick<AppDb, "select"> = this.db,
  ): Promise<MovementDto> {
    const allocations = await db
      .select({
        orderCutId: movementCutAllocations.orderCutId,
        cutId: orderCuts.cutId,
        quantity: movementCutAllocations.quantity,
      })
      .from(movementCutAllocations)
      .innerJoin(orderCuts, eq(movementCutAllocations.orderCutId, orderCuts.id))
      .where(eq(movementCutAllocations.movementId, row.id));

    const sizes = await db
      .select({
        sizeLabel: movementSizeBreakdowns.sizeLabel,
        quantity: movementSizeBreakdowns.quantity,
      })
      .from(movementSizeBreakdowns)
      .where(eq(movementSizeBreakdowns.movementId, row.id))
      .orderBy(asc(movementSizeBreakdowns.sizeLabel));

    return {
      id: row.id,
      orderId: row.orderId,
      clientWeekId: row.clientWeekId,
      type: row.type as MovementType,
      quantity: row.quantity,
      packagingType: (row.packagingType as PackagingType | null) ?? null,
      packageCount: row.packageCount,
      unitsPerPackage: row.unitsPerPackage,
      note: row.note,
      destinationId: row.destinationId,
      cancelsMovementId: row.cancelsMovementId,
      idempotencyKey: row.idempotencyKey,
      occurredAt: row.occurredAt.toISOString(),
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy,
      cutAllocations: allocations,
      sizes,
    };
  }
}
