import { and, asc, eq, isNull } from "drizzle-orm";
import argon2 from "argon2";
import type { RoleSlug } from "@leonel-platform/shared";
import type { AppDb } from "../../infrastructure/db/client.js";
import { writeAudit } from "../../infrastructure/db/audit.js";
import { roles, users } from "../../infrastructure/db/schema.js";
import { AppError, ConflictError, NotFoundError } from "../../shared/errors.js";

export type UserDto = {
  id: string;
  email: string;
  name: string;
  roleSlug: RoleSlug;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export class UsersService {
  constructor(private readonly db: AppDb) {}

  async list(): Promise<UserDto[]> {
    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        roleSlug: roles.slug,
        isActive: users.isActive,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(isNull(users.deletedAt))
      .orderBy(asc(users.email));

    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      roleSlug: r.roleSlug as RoleSlug,
      isActive: r.isActive,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async create(
    input: {
      email: string;
      name: string;
      password: string;
      roleSlug: RoleSlug;
    },
    actorUserId: string,
  ): Promise<UserDto> {
    const email = input.email.trim().toLowerCase();
    const name = input.name.trim();
    if (!email || !name || input.password.length < 8) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Email, nombre y password (≥8) son obligatorios",
      );
    }

    const role = await this.db.query.roles.findFirst({
      where: eq(roles.slug, input.roleSlug),
    });
    if (!role) throw new AppError("VALIDATION_ERROR", "Rol inválido");

    const existing = await this.db.query.users.findFirst({
      where: eq(users.email, email),
    });
    if (existing) throw new ConflictError("El email ya está registrado");

    const passwordHash = await argon2.hash(input.password);
    const [created] = await this.db
      .insert(users)
      .values({
        email,
        name,
        passwordHash,
        roleId: role.id,
        isActive: true,
      })
      .returning();

    await writeAudit(this.db, {
      actorUserId,
      action: "users.create",
      entityType: "user",
      entityId: created.id,
      metadata: { email, roleSlug: input.roleSlug },
    });

    return {
      id: created.id,
      email: created.email,
      name: created.name,
      roleSlug: input.roleSlug,
      isActive: created.isActive,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    };
  }

  async setActive(id: string, isActive: boolean, actorUserId: string): Promise<UserDto> {
    const row = await this.db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        roleSlug: roles.slug,
        isActive: users.isActive,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!row) throw new NotFoundError("Usuario no encontrado");

    if (!isActive && row.roleSlug === "admin") {
      const activeAdmins = await this.db
        .select({ id: users.id })
        .from(users)
        .innerJoin(roles, eq(users.roleId, roles.id))
        .where(
          and(
            eq(roles.slug, "admin"),
            eq(users.isActive, true),
            isNull(users.deletedAt),
          ),
        );
      if (activeAdmins.length <= 1) {
        throw new ConflictError("No se puede desactivar el último administrador");
      }
    }

    const [updated] = await this.db
      .update(users)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();

    await writeAudit(this.db, {
      actorUserId,
      action: isActive ? "users.activate" : "users.deactivate",
      entityType: "user",
      entityId: id,
    });

    return {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      roleSlug: row.roleSlug as RoleSlug,
      isActive: updated.isActive,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }
}
