import argon2 from "argon2";
import type { AuthUser, LoginResponse } from "@leonel-platform/shared";
import type { UserRepository } from "../../infrastructure/auth/user-repository.js";
import type { TokenService } from "../../infrastructure/auth/token-service.js";
import { UnauthorizedError } from "../../shared/errors.js";

function toAuthUser(user: {
  id: string;
  email: string;
  name: string;
  roleSlug: AuthUser["roleSlug"];
  permissions: string[];
}): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    roleSlug: user.roleSlug,
    permissions: user.permissions,
  };
}

export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: TokenService,
  ) {}

  async login(email: string, password: string): Promise<LoginResponse> {
    const user = await this.users.findActiveByEmail(email.trim().toLowerCase());
    if (!user) {
      throw new UnauthorizedError("Credenciales inválidas");
    }

    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) {
      throw new UnauthorizedError("Credenciales inválidas");
    }

    const accessToken = await this.tokens.issueAccessToken({
      sub: user.id,
      email: user.email,
      roleSlug: user.roleSlug,
      permissions: user.permissions,
    });
    const refresh = this.tokens.createRefreshToken();
    await this.users.storeRefreshToken(user.id, refresh.hash, refresh.expiresAt);
    await this.users.writeAudit({
      actorUserId: user.id,
      action: "auth.login",
      entityType: "user",
      entityId: user.id,
    });

    return {
      user: toAuthUser(user),
      tokens: {
        accessToken,
        refreshToken: refresh.raw,
      },
    };
  }

  async refresh(refreshToken: string): Promise<LoginResponse> {
    const stored = await this.users.findValidRefreshToken(refreshToken);
    if (!stored) {
      throw new UnauthorizedError("Sesión inválida o expirada");
    }

    const user = await this.users.findActiveById(stored.userId);
    if (!user) {
      throw new UnauthorizedError("Sesión inválida o expirada");
    }

    await this.users.revokeRefreshToken(refreshToken);
    const accessToken = await this.tokens.issueAccessToken({
      sub: user.id,
      email: user.email,
      roleSlug: user.roleSlug,
      permissions: user.permissions,
    });
    const nextRefresh = this.tokens.createRefreshToken();
    await this.users.storeRefreshToken(user.id, nextRefresh.hash, nextRefresh.expiresAt);

    return {
      user: toAuthUser(user),
      tokens: {
        accessToken,
        refreshToken: nextRefresh.raw,
      },
    };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) {
      return;
    }
    await this.users.revokeRefreshToken(refreshToken);
  }

  async me(userId: string): Promise<AuthUser> {
    const user = await this.users.findActiveById(userId);
    if (!user) {
      throw new UnauthorizedError();
    }
    return toAuthUser(user);
  }
}
