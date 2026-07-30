import { and, eq, isNull } from "drizzle-orm";
import type { RoleSlug } from "@leonel-platform/shared";
import type { DomainUser } from "../../domain/auth/types.js";
import type { AppDb } from "../db/client.js";
import {
  auditLogs,
  permissions,
  refreshTokens,
  rolePermissions,
  roles,
  users,
} from "../db/schema.js";
import { hashToken } from "./token-service.js";

export class UserRepository {
  constructor(private readonly db: AppDb) {}

  async findActiveByEmail(email: string): Promise<DomainUser | null> {
    const row = await this.db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        passwordHash: users.passwordHash,
        isActive: users.isActive,
        roleSlug: roles.slug,
        roleId: users.roleId,
      })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(and(eq(users.email, email.toLowerCase()), isNull(users.deletedAt)))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    if (!row || !row.isActive) {
      return null;
    }

    return this.toDomain(row);
  }

  async findActiveById(id: string): Promise<DomainUser | null> {
    const row = await this.db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        passwordHash: users.passwordHash,
        isActive: users.isActive,
        roleSlug: roles.slug,
        roleId: users.roleId,
      })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    if (!row || !row.isActive) {
      return null;
    }

    return this.toDomain(row);
  }

  private async toDomain(row: {
    id: string;
    email: string;
    name: string;
    passwordHash: string;
    isActive: boolean;
    roleSlug: string;
    roleId: string;
  }): Promise<DomainUser> {
    const userPermissions = await this.db
      .select({ key: permissions.key })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(rolePermissions.roleId, row.roleId));

    return {
      id: row.id,
      email: row.email,
      name: row.name,
      passwordHash: row.passwordHash,
      roleSlug: row.roleSlug as RoleSlug,
      permissions: userPermissions.map((p) => p.key),
      isActive: row.isActive,
    };
  }

  async storeRefreshToken(userId: string, tokenHash: string, expiresAt: Date) {
    await this.db.insert(refreshTokens).values({
      userId,
      tokenHash,
      expiresAt,
    });
  }

  async revokeRefreshToken(rawToken: string) {
    const tokenHash = hashToken(rawToken);
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.tokenHash, tokenHash));
  }

  async findValidRefreshToken(rawToken: string) {
    const tokenHash = hashToken(rawToken);
    const row = await this.db.query.refreshTokens.findFirst({
      where: eq(refreshTokens.tokenHash, tokenHash),
    });
    if (!row || row.revokedAt || row.expiresAt.getTime() < Date.now()) {
      return null;
    }
    return row;
  }

  async writeAudit(input: {
    actorUserId: string | null;
    action: string;
    entityType: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  }) {
    await this.db.insert(auditLogs).values({
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata,
    });
  }
}
