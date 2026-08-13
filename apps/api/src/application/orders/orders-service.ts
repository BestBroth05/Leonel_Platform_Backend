import { and, asc, desc, eq, ilike, inArray, isNull, ne, sql } from "drizzle-orm";
import type { OrderStatus, PackagingType } from "@leonel-platform/shared";
import type { AppDb } from "../../infrastructure/db/client.js";
import { writeAudit } from "../../infrastructure/db/audit.js";
import {
  brands,
  clients,
  cutReceipts,
  cuts,
  orderCuts,
  orderSizeBreakdowns,
  orderStatusHistory,
  orders,
  pantTypes,
  productionFormats,
} from "../../infrastructure/db/schema.js";
import { AppError, ConflictError, NotFoundError } from "../../shared/errors.js";
import { resolveGarmentQuantity } from "../../domain/weeks/packaging.js";
import { lockOpenWeekForClient } from "../client-weeks/week-lock.js";

const TERMINAL: OrderStatus[] = ["COMPLETED", "CANCELLED"];

const ALLOWED: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ["RECEIVING", "CANCELLED"],
  RECEIVING: ["IN_PROCESS", "PARTIALLY_SHIPPED", "CANCELLED"],
  IN_PROCESS: ["PARTIALLY_SHIPPED", "COMPLETED", "ON_HOLD", "CANCELLED"],
  PARTIALLY_SHIPPED: ["PARTIALLY_SHIPPED", "COMPLETED", "ON_HOLD"],
  ON_HOLD: ["IN_PROCESS"],
  COMPLETED: [],
  CANCELLED: [],
};

export type OrderCutAssignmentDto = {
  id: string;
  cutId: string;
  cutNumber: string;
  cutStyle: string;
  cutWorkPlan: string;
  assignedQuantity: number;
};

export type OrderDto = {
  id: string;
  number: string;
  clientId: string;
  clientName: string;
  brandId: string | null;
  brandName: string | null;
  pantTypeId: string | null;
  pantTypeName: string | null;
  productionFormatId: string | null;
  productionFormatNumber: string | null;
  cuts: OrderCutAssignmentDto[];
  /** SUM(order_cuts.assignedQuantity) — source of truth */
  orderQuantity: number;
  /** @deprecated Legacy mirror of orderQuantity */
  expectedQuantity: number;
  /** @deprecated Legacy; prefer orderQuantity */
  assignedQuantity: number;
  purchaseOrder: string | null;
  costPerGarment: string | null;
  estimatedAmount: string | null;
  packagingType: PackagingType | null;
  packageCount: number | null;
  unitsPerPackage: number | null;
  createdInClientWeekId: string | null;
  sizes: { sizeLabel: string; quantity: number }[];
  status: OrderStatus;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CutAssignmentInput = {
  cutId: string;
  assignedQuantity: number;
};

type Tx = Pick<
  AppDb,
  "execute" | "select" | "insert" | "update" | "delete" | "query"
>;

function parseCost(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new AppError("VALIDATION_ERROR", "El costo por prenda no puede ser negativo");
  }
  return n.toFixed(4);
}

function estimatedAmount(qty: number, cost: string | null): string | null {
  if (cost == null) return null;
  return (qty * Number(cost)).toFixed(2);
}

export class OrdersService {
  constructor(private readonly db: AppDb) {}

  async list(input: {
    q?: string;
    status?: OrderStatus;
    clientId?: string;
    productionFormatId?: string;
    page: number;
    pageSize: number;
  }) {
    const conditions = [isNull(orders.deletedAt)];
    if (input.status) conditions.push(eq(orders.status, input.status));
    if (input.clientId) conditions.push(eq(orders.clientId, input.clientId));
    if (input.productionFormatId) {
      conditions.push(eq(orders.productionFormatId, input.productionFormatId));
    }
    if (input.q?.trim()) {
      conditions.push(ilike(orders.number, `%${input.q.trim()}%`));
    }
    const where = and(...conditions);
    const offset = (input.page - 1) * input.pageSize;

    const [rows, countRow] = await Promise.all([
      this.db
        .select(this.baseSelectFields())
        .from(orders)
        .innerJoin(clients, eq(orders.clientId, clients.id))
        .leftJoin(brands, eq(orders.brandId, brands.id))
        .leftJoin(pantTypes, eq(orders.pantTypeId, pantTypes.id))
        .leftJoin(productionFormats, eq(orders.productionFormatId, productionFormats.id))
        .where(where)
        .orderBy(desc(orders.createdAt))
        .limit(input.pageSize)
        .offset(offset),
      this.db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(orders)
        .where(where)
        .then((r) => r[0]),
    ]);

    const items = await Promise.all(rows.map((row) => this.toDto(row)));
    return {
      items,
      page: input.page,
      pageSize: input.pageSize,
      total: countRow?.count ?? 0,
    };
  }

  async getById(id: string): Promise<OrderDto> {
    const row = await this.fetchJoined(id);
    if (!row) throw new NotFoundError("Pedido no encontrado");
    return this.toDto(row);
  }

  async create(
    input: {
      number: string;
      clientId?: string;
      productionFormatId: string;
      cuts: CutAssignmentInput[];
      brandId?: string | null;
      pantTypeId?: string | null;
      purchaseOrder?: string | null;
      costPerGarment?: string | null;
      packagingType?: PackagingType | null;
      packageCount?: number | null;
      unitsPerPackage?: number | null;
      sizes?: { sizeLabel: string; quantity: number }[];
      notes?: string | null;
    },
    actorUserId: string,
  ): Promise<OrderDto> {
    const number = input.number.trim();
    if (!number) throw new ConflictError("El número de pedido es obligatorio");
    const costPerGarment = parseCost(input.costPerGarment ?? null);
    const assignments = this.normalizeAssignments(input.cuts);

    const createdId = await this.db.transaction(async (tx) => {
      const format = await tx.query.productionFormats.findFirst({
        where: and(
          eq(productionFormats.id, input.productionFormatId),
          isNull(productionFormats.deletedAt),
        ),
      });
      if (!format) throw new AppError("VALIDATION_ERROR", "Formato de producción inexistente");
      if (!format.clientId) {
        throw new AppError(
          "INVALID_STATE",
          "El formato no tiene cliente asignado. Corrija el formato antes de crear pedidos.",
        );
      }

      const clientId = format.clientId;
      if (input.clientId && input.clientId !== clientId) {
        throw new AppError(
          "VALIDATION_ERROR",
          "El cliente del pedido debe coincidir con el cliente del formato",
        );
      }

      const client = await tx.query.clients.findFirst({
        where: and(
          eq(clients.id, clientId),
          isNull(clients.deletedAt),
          eq(clients.isActive, true),
        ),
      });
      if (!client) {
        throw new AppError("VALIDATION_ERROR", "Cliente inexistente o inactivo");
      }

      const week = await lockOpenWeekForClient(tx, clientId);

      await this.assertCatalogs(input.brandId, input.pantTypeId, tx);

      const duplicate = await tx.query.orders.findFirst({
        where: and(
          eq(orders.clientId, clientId),
          eq(orders.number, number),
          isNull(orders.deletedAt),
        ),
      });
      if (duplicate) {
        throw new ConflictError("Ya existe un pedido con ese número para el cliente");
      }

      const orderQuantity = await this.validateAndPrepareAssignments(
        tx,
        input.productionFormatId,
        assignments,
      );

      let packagingType: PackagingType | null = null;
      let packageCount: number | null = null;
      let unitsPerPackage: number | null = null;
      if (input.packagingType) {
        try {
          const resolved = resolveGarmentQuantity({
            packagingType: input.packagingType,
            packageCount: input.packageCount,
            unitsPerPackage: input.unitsPerPackage,
            quantity: orderQuantity,
          });
          packagingType = resolved.packagingType;
          packageCount = resolved.packageCount;
          unitsPerPackage = resolved.unitsPerPackage;
        } catch (error) {
          throw new AppError(
            "VALIDATION_ERROR",
            error instanceof Error ? error.message : "Empaque inválido",
          );
        }
      }

      if (input.sizes?.length) {
        const sizeSum = input.sizes.reduce((s, x) => s + x.quantity, 0);
        if (sizeSum !== orderQuantity) {
          throw new AppError(
            "VALIDATION_ERROR",
            `La suma de tallas (${sizeSum}) debe igualar la cantidad del pedido (${orderQuantity})`,
          );
        }
      }

      const primaryCutId = assignments[0]!.cutId;

      const [created] = await tx
        .insert(orders)
        .values({
          number,
          clientId,
          brandId: input.brandId ?? null,
          pantTypeId: input.pantTypeId ?? null,
          productionFormatId: input.productionFormatId,
          // Legacy columns kept for migration compatibility
          cutId: primaryCutId,
          assignedQuantity: orderQuantity,
          expectedQuantity: orderQuantity,
          purchaseOrder: input.purchaseOrder?.trim() || null,
          costPerGarment,
          packagingType,
          packageCount,
          unitsPerPackage,
          createdInClientWeekId: week.id,
          status: "DRAFT",
          notes: input.notes?.trim() || null,
          createdBy: actorUserId,
          updatedBy: actorUserId,
        })
        .returning();

      await tx.insert(orderCuts).values(
        assignments.map((a) => ({
          orderId: created.id,
          cutId: a.cutId,
          assignedQuantity: a.assignedQuantity,
        })),
      );

      if (input.sizes?.length) {
        await tx.insert(orderSizeBreakdowns).values(
          input.sizes.map((s) => ({
            orderId: created.id,
            sizeLabel: s.sizeLabel.trim(),
            quantity: s.quantity,
          })),
        );
      }

      await tx.insert(orderStatusHistory).values({
        orderId: created.id,
        fromStatus: null,
        toStatus: "DRAFT",
        note: "Pedido creado",
        actorUserId,
      });

      await writeAudit(tx, {
        actorUserId,
        action: "orders.create",
        entityType: "order",
        entityId: created.id,
        metadata: {
          number,
          clientId,
          orderQuantity,
          cuts: assignments,
          createdInClientWeekId: week.id,
        },
      });

      return created.id;
    });

    return this.getById(createdId);
  }

  async update(
    id: string,
    input: {
      brandId?: string | null;
      pantTypeId?: string | null;
      cuts?: CutAssignmentInput[];
      purchaseOrder?: string | null;
      costPerGarment?: string | null;
      notes?: string | null;
    },
    actorUserId: string,
  ): Promise<OrderDto> {
    await this.db.transaction(async (tx) => {
      const existing = await tx.query.orders.findFirst({
        where: and(eq(orders.id, id), isNull(orders.deletedAt)),
      });
      if (!existing) throw new NotFoundError("Pedido no encontrado");
      if (TERMINAL.includes(existing.status as OrderStatus)) {
        throw new AppError("INVALID_STATE", "No se puede editar un pedido cerrado o cancelado");
      }
      if (!existing.productionFormatId) {
        throw new AppError("VALIDATION_ERROR", "El pedido no tiene formato de producción");
      }

      await this.assertCatalogs(
        input.brandId === undefined ? existing.brandId : input.brandId,
        input.pantTypeId === undefined ? existing.pantTypeId : input.pantTypeId,
        tx,
      );

      let orderQuantity =
        existing.assignedQuantity ?? existing.expectedQuantity;
      let primaryCutId = existing.cutId;

      if (input.cuts !== undefined) {
        const assignments = this.normalizeAssignments(input.cuts);
        orderQuantity = await this.validateAndPrepareAssignments(
          tx,
          existing.productionFormatId,
          assignments,
          id,
        );
        primaryCutId = assignments[0]!.cutId;

        await tx.delete(orderCuts).where(eq(orderCuts.orderId, id));
        await tx.insert(orderCuts).values(
          assignments.map((a) => ({
            orderId: id,
            cutId: a.cutId,
            assignedQuantity: a.assignedQuantity,
          })),
        );
      }

      const costPerGarment =
        input.costPerGarment !== undefined
          ? parseCost(input.costPerGarment)
          : existing.costPerGarment;

      await tx
        .update(orders)
        .set({
          brandId: input.brandId !== undefined ? input.brandId : existing.brandId,
          pantTypeId:
            input.pantTypeId !== undefined ? input.pantTypeId : existing.pantTypeId,
          cutId: primaryCutId,
          assignedQuantity: orderQuantity,
          expectedQuantity: orderQuantity,
          purchaseOrder:
            input.purchaseOrder !== undefined
              ? input.purchaseOrder?.trim() || null
              : existing.purchaseOrder,
          costPerGarment,
          notes:
            input.notes !== undefined ? input.notes?.trim() || null : existing.notes,
          updatedAt: new Date(),
          updatedBy: actorUserId,
          version: existing.version + 1,
        })
        .where(eq(orders.id, id));

      await writeAudit(tx, {
        actorUserId,
        action: "orders.update",
        entityType: "order",
        entityId: id,
      });
    });

    return this.getById(id);
  }

  async transition(
    id: string,
    toStatus: OrderStatus,
    actorUserId: string,
    note?: string,
  ): Promise<OrderDto> {
    const existing = await this.db.query.orders.findFirst({
      where: and(eq(orders.id, id), isNull(orders.deletedAt)),
    });
    if (!existing) throw new NotFoundError("Pedido no encontrado");

    const from = existing.status as OrderStatus;
    const allowed = ALLOWED[from] ?? [];
    if (!allowed.includes(toStatus) && !(from === toStatus && toStatus === "PARTIALLY_SHIPPED")) {
      throw new AppError(
        "INVALID_TRANSITION",
        `Transición no permitida: ${from} → ${toStatus}`,
      );
    }

    if (from === toStatus) {
      return this.getById(id);
    }

    await this.db
      .update(orders)
      .set({
        status: toStatus,
        updatedAt: new Date(),
        updatedBy: actorUserId,
        version: existing.version + 1,
      })
      .where(eq(orders.id, id));

    await this.db.insert(orderStatusHistory).values({
      orderId: id,
      fromStatus: from,
      toStatus,
      note: note?.trim() || null,
      actorUserId,
    });

    await writeAudit(this.db, {
      actorUserId,
      action: "orders.transition",
      entityType: "order",
      entityId: id,
      metadata: { from, to: toStatus },
    });

    return this.getById(id);
  }

  async statusHistory(orderId: string) {
    await this.getById(orderId);
    const rows = await this.db
      .select()
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, orderId))
      .orderBy(desc(orderStatusHistory.createdAt));
    return rows.map((r) => ({
      id: r.id,
      fromStatus: r.fromStatus,
      toStatus: r.toStatus,
      note: r.note,
      actorUserId: r.actorUserId,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async applyStatusIfAllowed(
    tx: Pick<AppDb, "query" | "update" | "insert">,
    orderId: string,
    toStatus: OrderStatus,
    actorUserId: string,
    note: string,
  ) {
    const existing = await tx.query.orders.findFirst({
      where: and(eq(orders.id, orderId), isNull(orders.deletedAt)),
    });
    if (!existing) return;
    const from = existing.status as OrderStatus;
    if (from === toStatus) return;
    const allowed = ALLOWED[from] ?? [];
    if (!allowed.includes(toStatus)) return;

    await tx
      .update(orders)
      .set({
        status: toStatus,
        updatedAt: new Date(),
        updatedBy: actorUserId,
        version: existing.version + 1,
      })
      .where(eq(orders.id, orderId));

    await tx.insert(orderStatusHistory).values({
      orderId,
      fromStatus: from,
      toStatus,
      note,
      actorUserId,
    });
  }

  async getOrderQuantity(orderId: string, db: Tx | AppDb = this.db): Promise<number> {
    const row = await db
      .select({
        total: sql<number>`coalesce(sum(${orderCuts.assignedQuantity}), 0)::int`,
      })
      .from(orderCuts)
      .where(eq(orderCuts.orderId, orderId))
      .then((r) => r[0]);
    return row?.total ?? 0;
  }

  private normalizeAssignments(cutsInput: CutAssignmentInput[]): CutAssignmentInput[] {
    if (!cutsInput.length) {
      throw new AppError("VALIDATION_ERROR", "El pedido debe tener al menos un corte asignado");
    }
    const seen = new Set<string>();
    const normalized: CutAssignmentInput[] = [];
    for (const item of cutsInput) {
      if (seen.has(item.cutId)) {
        throw new AppError("VALIDATION_ERROR", "No se puede seleccionar el mismo corte dos veces");
      }
      seen.add(item.cutId);
      if (!Number.isInteger(item.assignedQuantity) || item.assignedQuantity <= 0) {
        throw new AppError(
          "VALIDATION_ERROR",
          "La cantidad asignada por corte debe ser un entero > 0",
        );
      }
      normalized.push({
        cutId: item.cutId,
        assignedQuantity: item.assignedQuantity,
      });
    }
    return normalized;
  }

  private async validateAndPrepareAssignments(
    tx: Tx,
    productionFormatId: string,
    assignments: CutAssignmentInput[],
    excludeOrderId?: string,
  ): Promise<number> {
    const cutIds = [...assignments.map((a) => a.cutId)].sort();

    // Deterministic lock order to avoid deadlocks
    for (const cutId of cutIds) {
      await tx.execute(
        sql`select id from cuts where id = ${cutId} and deleted_at is null for update`,
      );
    }

    const cutRows = await tx
      .select()
      .from(cuts)
      .where(and(inArray(cuts.id, cutIds), isNull(cuts.deletedAt)))
      .orderBy(asc(cuts.id));

    if (cutRows.length !== cutIds.length) {
      throw new AppError("VALIDATION_ERROR", "Uno o más cortes no existen");
    }

    for (const cut of cutRows) {
      if (cut.productionFormatId !== productionFormatId) {
        throw new AppError(
          "VALIDATION_ERROR",
          `El corte ${cut.number} no pertenece al formato del pedido`,
        );
      }
    }

    let orderQuantity = 0;
    for (const assignment of assignments) {
      const cut = cutRows.find((c) => c.id === assignment.cutId)!;
      const totalReceived = await this.sumReceived(tx, assignment.cutId);
      const totalAssigned = await this.sumAssigned(tx, assignment.cutId, excludeOrderId);
      const available = totalReceived - totalAssigned;
      if (assignment.assignedQuantity > available) {
        throw new ConflictError(
          `Corte ${cut.number}: solicitado ${assignment.assignedQuantity}, disponible ${available} (recibido ${totalReceived}, asignado ${totalAssigned})`,
        );
      }
      orderQuantity += assignment.assignedQuantity;
    }

    return orderQuantity;
  }

  private async sumReceived(tx: Tx, cutId: string) {
    const row = await tx
      .select({
        total: sql<number>`coalesce(sum(${cutReceipts.quantity}), 0)::int`,
      })
      .from(cutReceipts)
      .where(eq(cutReceipts.cutId, cutId))
      .then((r) => r[0]);
    return row?.total ?? 0;
  }

  private async sumAssigned(tx: Tx, cutId: string, excludeOrderId?: string) {
    const conditions = [
      eq(orderCuts.cutId, cutId),
      isNull(orders.deletedAt),
      ne(orders.status, "CANCELLED"),
    ];
    if (excludeOrderId) {
      conditions.push(ne(orderCuts.orderId, excludeOrderId));
    }
    const row = await tx
      .select({
        total: sql<number>`coalesce(sum(${orderCuts.assignedQuantity}), 0)::int`,
      })
      .from(orderCuts)
      .innerJoin(orders, eq(orderCuts.orderId, orders.id))
      .where(and(...conditions))
      .then((r) => r[0]);
    return row?.total ?? 0;
  }

  private async assertCatalogs(
    brandId: string | null | undefined,
    pantTypeId: string | null | undefined,
    db: Pick<AppDb, "query"> = this.db,
  ) {
    if (brandId) {
      const brand = await db.query.brands.findFirst({
        where: and(eq(brands.id, brandId), isNull(brands.deletedAt), eq(brands.isActive, true)),
      });
      if (!brand) throw new AppError("VALIDATION_ERROR", "Marca inexistente o inactiva");
    }
    if (pantTypeId) {
      const pantType = await db.query.pantTypes.findFirst({
        where: and(
          eq(pantTypes.id, pantTypeId),
          isNull(pantTypes.deletedAt),
          eq(pantTypes.isActive, true),
        ),
      });
      if (!pantType) throw new AppError("VALIDATION_ERROR", "Tipo inexistente o inactivo");
    }
  }

  private baseSelectFields() {
    return {
      id: orders.id,
      number: orders.number,
      clientId: orders.clientId,
      clientName: clients.name,
      brandId: orders.brandId,
      brandName: brands.name,
      pantTypeId: orders.pantTypeId,
      pantTypeName: pantTypes.name,
      productionFormatId: orders.productionFormatId,
      productionFormatNumber: productionFormats.number,
      expectedQuantity: orders.expectedQuantity,
      purchaseOrder: orders.purchaseOrder,
      costPerGarment: orders.costPerGarment,
      packagingType: orders.packagingType,
      packageCount: orders.packageCount,
      unitsPerPackage: orders.unitsPerPackage,
      createdInClientWeekId: orders.createdInClientWeekId,
      status: orders.status,
      notes: orders.notes,
      version: orders.version,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
    };
  }

  private async fetchJoined(id: string) {
    return this.db
      .select(this.baseSelectFields())
      .from(orders)
      .innerJoin(clients, eq(orders.clientId, clients.id))
      .leftJoin(brands, eq(orders.brandId, brands.id))
      .leftJoin(pantTypes, eq(orders.pantTypeId, pantTypes.id))
      .leftJoin(productionFormats, eq(orders.productionFormatId, productionFormats.id))
      .where(and(eq(orders.id, id), isNull(orders.deletedAt)))
      .limit(1)
      .then((rows) => rows[0] ?? null);
  }

  private async loadAssignments(orderId: string): Promise<OrderCutAssignmentDto[]> {
    const rows = await this.db
      .select({
        id: orderCuts.id,
        cutId: orderCuts.cutId,
        cutNumber: cuts.number,
        cutStyle: cuts.style,
        cutWorkPlan: cuts.workPlan,
        assignedQuantity: orderCuts.assignedQuantity,
      })
      .from(orderCuts)
      .innerJoin(cuts, eq(orderCuts.cutId, cuts.id))
      .where(eq(orderCuts.orderId, orderId))
      .orderBy(asc(cuts.number));
    return rows;
  }

  private async toDto(row: {
    id: string;
    number: string;
    clientId: string;
    clientName: string;
    brandId: string | null;
    brandName: string | null;
    pantTypeId: string | null;
    pantTypeName: string | null;
    productionFormatId: string | null;
    productionFormatNumber: string | null;
    expectedQuantity: number;
    purchaseOrder: string | null;
    costPerGarment: string | null;
    packagingType: string | null;
    packageCount: number | null;
    unitsPerPackage: number | null;
    createdInClientWeekId: string | null;
    status: string;
    notes: string | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }): Promise<OrderDto> {
    const cutAssignments = await this.loadAssignments(row.id);
    const orderQuantity =
      cutAssignments.reduce((sum, c) => sum + c.assignedQuantity, 0) ||
      row.expectedQuantity;
    const sizes = await this.db
      .select({
        sizeLabel: orderSizeBreakdowns.sizeLabel,
        quantity: orderSizeBreakdowns.quantity,
      })
      .from(orderSizeBreakdowns)
      .where(eq(orderSizeBreakdowns.orderId, row.id))
      .orderBy(asc(orderSizeBreakdowns.sizeLabel));
    return {
      id: row.id,
      number: row.number,
      clientId: row.clientId,
      clientName: row.clientName,
      brandId: row.brandId,
      brandName: row.brandName,
      pantTypeId: row.pantTypeId,
      pantTypeName: row.pantTypeName,
      productionFormatId: row.productionFormatId,
      productionFormatNumber: row.productionFormatNumber,
      cuts: cutAssignments,
      orderQuantity,
      expectedQuantity: orderQuantity,
      assignedQuantity: orderQuantity,
      purchaseOrder: row.purchaseOrder,
      costPerGarment: row.costPerGarment,
      estimatedAmount: estimatedAmount(orderQuantity, row.costPerGarment),
      packagingType: (row.packagingType as PackagingType | null) ?? null,
      packageCount: row.packageCount,
      unitsPerPackage: row.unitsPerPackage,
      createdInClientWeekId: row.createdInClientWeekId,
      sizes,
      status: row.status as OrderStatus,
      notes: row.notes,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
