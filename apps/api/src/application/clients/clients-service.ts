import { and, desc, eq, ilike, isNull, sql } from "drizzle-orm";
import type { AppDb } from "../../infrastructure/db/client.js";
import { writeAudit } from "../../infrastructure/db/audit.js";
import { clients } from "../../infrastructure/db/schema.js";
import { ConflictError, NotFoundError } from "../../shared/errors.js";

export type ClientDto = {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  rfc: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

function toDto(row: typeof clients.$inferSelect): ClientDto {
  return {
    id: row.id,
    name: row.name,
    contactName: row.contactName,
    phone: row.phone,
    email: row.email,
    rfc: row.rfc,
    notes: row.notes,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class ClientsService {
  constructor(private readonly db: AppDb) {}

  async list(input: {
    q?: string;
    activeOnly?: boolean;
    page: number;
    pageSize: number;
  }) {
    const conditions = [isNull(clients.deletedAt)];
    if (input.activeOnly) {
      conditions.push(eq(clients.isActive, true));
    }
    if (input.q?.trim()) {
      conditions.push(ilike(clients.name, `%${input.q.trim()}%`));
    }

    const where = and(...conditions);
    const offset = (input.page - 1) * input.pageSize;

    const [rows, countRow] = await Promise.all([
      this.db
        .select()
        .from(clients)
        .where(where)
        .orderBy(desc(clients.createdAt))
        .limit(input.pageSize)
        .offset(offset),
      this.db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(clients)
        .where(where)
        .then((r) => r[0]),
    ]);

    return {
      items: rows.map(toDto),
      page: input.page,
      pageSize: input.pageSize,
      total: countRow?.count ?? 0,
    };
  }

  async getById(id: string): Promise<ClientDto> {
    const row = await this.db.query.clients.findFirst({
      where: and(eq(clients.id, id), isNull(clients.deletedAt)),
    });
    if (!row) throw new NotFoundError("Cliente no encontrado");
    return toDto(row);
  }

  async create(
    input: {
      name: string;
      contactName?: string | null;
      phone?: string | null;
      email?: string | null;
      rfc?: string | null;
      notes?: string | null;
    },
    actorUserId: string,
  ): Promise<ClientDto> {
    const name = input.name.trim();
    if (!name) throw new ConflictError("El nombre es obligatorio");

    const [row] = await this.db
      .insert(clients)
      .values({
        name,
        contactName: input.contactName?.trim() || null,
        phone: input.phone?.trim() || null,
        email: input.email?.trim().toLowerCase() || null,
        rfc: input.rfc?.trim().toUpperCase() || null,
        notes: input.notes?.trim() || null,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      })
      .returning();

    await writeAudit(this.db, {
      actorUserId,
      action: "clients.create",
      entityType: "client",
      entityId: row.id,
      metadata: { name: row.name },
    });

    return toDto(row);
  }

  async update(
    id: string,
    input: {
      name?: string;
      contactName?: string | null;
      phone?: string | null;
      email?: string | null;
      rfc?: string | null;
      notes?: string | null;
      isActive?: boolean;
    },
    actorUserId: string,
  ): Promise<ClientDto> {
    const existing = await this.db.query.clients.findFirst({
      where: and(eq(clients.id, id), isNull(clients.deletedAt)),
    });
    if (!existing) throw new NotFoundError("Cliente no encontrado");

    const [row] = await this.db
      .update(clients)
      .set({
        name: input.name !== undefined ? input.name.trim() : existing.name,
        contactName:
          input.contactName !== undefined
            ? input.contactName?.trim() || null
            : existing.contactName,
        phone:
          input.phone !== undefined ? input.phone?.trim() || null : existing.phone,
        email:
          input.email !== undefined
            ? input.email?.trim().toLowerCase() || null
            : existing.email,
        rfc:
          input.rfc !== undefined
            ? input.rfc?.trim().toUpperCase() || null
            : existing.rfc,
        notes:
          input.notes !== undefined ? input.notes?.trim() || null : existing.notes,
        isActive: input.isActive ?? existing.isActive,
        updatedAt: new Date(),
        updatedBy: actorUserId,
      })
      .where(eq(clients.id, id))
      .returning();

    await writeAudit(this.db, {
      actorUserId,
      action: "clients.update",
      entityType: "client",
      entityId: id,
    });

    return toDto(row);
  }
}
