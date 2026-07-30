import { describe, expect, it, vi } from "vitest";
import argon2 from "argon2";
import { AuthService } from "./auth-service.js";
import { UnauthorizedError } from "../../shared/errors.js";

describe("AuthService", () => {
  it("rejects invalid credentials without revealing which field failed", async () => {
    const users = {
      findActiveByEmail: vi.fn().mockResolvedValue(null),
    };
    const tokens = {
      issueAccessToken: vi.fn(),
      createRefreshToken: vi.fn(),
    };
    const service = new AuthService(users as never, tokens as never);

    await expect(service.login("a@b.com", "x")).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("issues tokens for a valid user", async () => {
    const passwordHash = await argon2.hash("secret");
    const users = {
      findActiveByEmail: vi.fn().mockResolvedValue({
        id: "u1",
        email: "a@b.com",
        name: "Admin",
        passwordHash,
        roleSlug: "admin",
        permissions: ["users.read"],
        isActive: true,
      }),
      storeRefreshToken: vi.fn(),
      writeAudit: vi.fn(),
    };
    const tokens = {
      issueAccessToken: vi.fn().mockResolvedValue("access"),
      createRefreshToken: vi.fn().mockReturnValue({
        raw: "refresh",
        hash: "hash",
        expiresAt: new Date(),
      }),
    };
    const service = new AuthService(users as never, tokens as never);
    const result = await service.login("a@b.com", "secret");
    expect(result.tokens.accessToken).toBe("access");
    expect(result.tokens.refreshToken).toBe("refresh");
    expect(result.user.email).toBe("a@b.com");
  });
});
