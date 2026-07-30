import { and, desc, eq, ilike, isNull, sql } from "drizzle-orm";
import type { OrderStatus } from "@leonel-platform/shared";
import type { AppDb } from "../../infrastructure/db/client.js";
import { writeAudit } from "../../infrastructure/db/audit.js";
import {
  brands,
  clients,
  orderStatusHistory,
  orders,
  pantTypes,
} from "../../infrastructure/db/schema.js";
import { AppError, ConflictError, NotFoundError } from "../../shared/errors.js";

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

export type OrderDto = {
  id: string;
  number: string;
  clientId: string;
  clientName: string;
  brandId: string | null;
  brandName: string | null;
  pantTypeId: string | null;
  pantTypeName: string | null;
  expectedQuantity: number;
  status: OrderStatus;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export class OrdersService {
  constructor(private readonly db: AppDb) {}

  async list(input: {
    q?: string;
    status?: OrderStatus;
    clientId?: string;
    page: number;
    pageSize: number;
  }) {
    const conditions = [isNull(orders.deletedAt)];
    if (input.status) conditions.push(eq(orders.status, input.status));
    if (input.clientId) conditions.push(eq(orders.clientId, input.clientId));
    if (input.q?.trim()) {
      conditions.push(ilike(orders.number, `%${input.q.trim()}%`));
    }
    const where = and(...conditions);
    const offset = (input.page - 1) * input.pageSize;

    const [rows, countRow] = await Promise.all([
      this.db
        .select({
          id: orders.id,
          number: orders.number,
          clientId: orders.clientId,
          clientName: clients.name,
          brandId: orders.brandId,
          brandName: brands.name,
          pantTypeId: orders.pantTypeId,
          pantTypeName: pantTypes.name,
          expectedQuantity: orders.expectedQuantity,
          status: orders.status,
          notes: orders.notes,
          version: orders.version,
          createdAt: orders.createdAt,
          updatedAt: orders.updatedAt,
        })
        .from(orders)
        .innerJoin(clients, eq(orders.clientId, clients.id))
        .leftJoin(brands, eq(orders.brandId, brands.id))
        .leftJoin(pantTypes, eq(orders.pantTypeId, pantTypes.id))
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

    return {
      items: rows.map(this.toDto),
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
      clientId: string;
      brandId?: string | null;
      pantTypeId?: string | null;
      expectedQuantity: number;
      notes?: string | null;
    },
    actorUserId: string,
  ): Promise<OrderDto> {
    const number = input.number.trim();
    if (!number) throw new ConflictError("El número de pedido es obligatorio");
    if (!Number.isInteger(input.expectedQuantity) || input.expectedQuantity <= 0) {
      throw new AppError("VALIDATION_ERROR", "La cantidad esperada debe ser un entero > 0");
    }

    const client = await this.db.query.clients.findFirst({
      where: and(
        eq(clients.id, input.clientId),
        isNull(clients.deletedAt),
        eq(clients.isActive, true),
      ),
    });
    if (!client) {
      throw new AppError("VALIDATION_ERROR", "Cliente inexistente o inactivo");
    }

    await this.assertCatalogs(input.brandId, input.pantTypeId);

    const duplicate = await this.db.query.orders.findFirst({
      where: and(
        eq(orders.clientId, input.clientId),
        eq(orders.number, number),
        isNull(orders.deletedAt),
      ),
    });
    if (duplicate) {
      throw new ConflictError("Ya existe un pedido con ese número para el cliente");
    }

    const [created] = await this.db
      .insert(orders)
      .values({
        number,
        clientId: input.clientId,
        brandId: input.brandId ?? null,
        pantTypeId: input.pantTypeId ?? null,
        expectedQuantity: input.expectedQuantity,
        status: "DRAFT",
        notes: input.notes?.trim() || null,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      })
      .returning();

    await this.db.insert(orderStatusHistory).values({
      orderId: created.id,
      fromStatus: null,
      toStatus: "DRAFT",
      note: "Pedido creado",
      actorUserId,
    });

    await writeAudit(this.db, {
      actorUserId,
      action: "orders.create",
      entityType: "order",
      entityId: created.id,
      metadata: { number, clientId: input.clientId },
    });

    return this.getById(created.id);
  }

  async update(
    id: string,
    input: {
      brandId?: string | null;
      pantTypeId?: string | null;
      expectedQuantity?: number;
      notes?: string | null;
    },
    actorUserId: string,
  ): Promise<OrderDto> {
    const existing = await this.db.query.orders.findFirst({
      where: and(eq(orders.id, id), isNull(orders.deletedAt)),
    });
    if (!existing) throw new NotFoundError("Pedido no encontrado");
    if (TERMINAL.includes(existing.status as OrderStatus)) {
      throw new AppError("INVALID_STATE", "No se puede editar un pedido cerrado o cancelado");
    }

    if (input.expectedQuantity !== undefined) {
      if (!Number.isInteger(input.expectedQuantity) || input.expectedQuantity <= 0) {
        throw new AppError(
          "VALIDATION_ERROR",
          "La cantidad esperada debe ser un entero > 0",
        );
      }
    }

    await this.assertCatalogs(
      input.brandId === undefined ? existing.brandId : input.brandId,
      input.pantTypeId === undefined ? existing.pantTypeId : input.pantTypeId,
    );

    await this.db
      .update(orders)
      .set({
        brandId: input.brandId !== undefined ? input.brandId : existing.brandId,
        pantTypeId:
          input.pantTypeId !== undefined ? input.pantTypeId : existing.pantTypeId,
        expectedQuantity: input.expectedQuantity ?? existing.expectedQuantity,
        notes: input.notes !== undefined ? input.notes?.trim() || null : existing.notes,
        updatedAt: new Date(),
        updatedBy: actorUserId,
        version: existing.version + 1,
      })
      .where(eq(orders.id, id));

    await writeAudit(this.db, {
      actorUserId,
      action: "orders.update",
      entityType: "order",
      entityId: id,
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

  /** Used by inventory service for automatic status bumps */
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

  private async assertCatalogs(
    brandId: string | null | undefined,
    pantTypeId: string | null | undefined,
  ) {
    if (brandId) {
      const brand = await this.db.query.brands.findFirst({
        where: and(eq(brands.id, brandId), isNull(brands.deletedAt), eq(brands.isActive, true)),
      });
      if (!brand) throw new AppError("VALIDATION_ERROR", "Marca inexistente o inactiva");
    }
    if (pantTypeId) {
      const pantType = await this.db.query.pantTypes.findFirst({
        where: and(
          eq(pantTypes.id, pantTypeId),
          isNull(pantTypes.deletedAt),
          eq(pantTypes.isActive, true),
        ),
      });
      if (!pantType) throw new AppError("VALIDATION_ERROR", "Tipo inexistente o inactivo");
    }
  }

  private async fetchJoined(id: string) {
    return this.db
      .select({
        id: orders.id,
        number: orders.number,
        clientId: orders.clientId,
        clientName: clients.name,
        brandId: orders.brandId,
        brandName: brands.name,
        pantTypeId: orders.pantTypeId,
        pantTypeName: pantTypes.name,
        expectedQuantity: orders.expectedQuantity,
        status: orders.status,
        notes: orders.notes,
        version: orders.version,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
      })
      .from(orders)
      .innerJoin(clients, eq(orders.clientId, clients.id))
      .leftJoin(brands, eq(orders.brandId, brands.id))
      .leftJoin(pantTypes, eq(orders.pantTypeId, pantTypes.id))
      .where(and(eq(orders.id, id), isNull(orders.deletedAt)))
      .limit(1)
      .then((rows) => rows[0] ?? null);
  }

  private toDto = (row: {
    id: string;
    number: string;
    clientId: string;
    clientName: string;
    brandId: string | null;
    brandName: string | null;
    pantTypeId: string | null;
    pantTypeName: string | null;
    expectedQuantity: number;
    status: string;
    notes: string | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }): OrderDto => ({
    id: row.id,
    number: row.number,
    clientId: row.clientId,
    clientName: row.clientName,
    brandId: row.brandId,
    brandName: row.brandName,
    pantTypeId: row.pantTypeId,
    pantTypeName: row.pantTypeName,
    expectedQuantity: row.expectedQuantity,
    status: row.status as OrderStatus,
    notes: row.notes,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
