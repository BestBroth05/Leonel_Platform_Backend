import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { AppConfig } from "../../shared/config.js";

export type AccessClaims = {
  sub: string;
  email: string;
  roleSlug: string;
  permissions: string[];
};

export class TokenService {
  private readonly secret: Uint8Array;

  constructor(private readonly config: AppConfig) {
    this.secret = new TextEncoder().encode(config.JWT_ACCESS_SECRET);
  }

  async issueAccessToken(claims: AccessClaims): Promise<string> {
    return new SignJWT({
      email: claims.email,
      roleSlug: claims.roleSlug,
      permissions: claims.permissions,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setExpirationTime(`${this.config.JWT_ACCESS_TTL_SECONDS}s`)
      .sign(this.secret);
  }

  async verifyAccessToken(token: string): Promise<AccessClaims> {
    const { payload } = await jwtVerify(token, this.secret);
    if (!payload.sub || typeof payload.email !== "string") {
      throw new Error("Invalid access token");
    }
    return {
      sub: payload.sub,
      email: payload.email,
      roleSlug: String(payload.roleSlug ?? ""),
      permissions: Array.isArray(payload.permissions)
        ? payload.permissions.map(String)
        : [],
    };
  }

  createRefreshToken(): { raw: string; hash: string; expiresAt: Date } {
    const raw = randomBytes(48).toString("base64url");
    const hash = hashToken(raw);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.config.JWT_REFRESH_TTL_DAYS);
    return { raw, hash, expiresAt };
  }
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
