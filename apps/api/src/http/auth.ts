import type { FastifyReply, FastifyRequest } from "fastify";
import type { TokenService } from "../infrastructure/auth/token-service.js";
import { ForbiddenError, UnauthorizedError } from "../shared/errors.js";

export type AuthClaims = {
  sub: string;
  email: string;
  roleSlug: string;
  permissions: string[];
};

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthClaims;
  }
}

export function createAuthGuards(tokenService: TokenService) {
  async function requireAuth(request: FastifyRequest, _reply: FastifyReply) {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedError();
    }
    const token = header.slice("Bearer ".length);
    try {
      request.auth = await tokenService.verifyAccessToken(token);
    } catch {
      throw new UnauthorizedError();
    }
  }

  function requirePermission(...keys: string[]) {
    return async (request: FastifyRequest, _reply: FastifyReply) => {
      await requireAuth(request, _reply);
      const permissions = request.auth?.permissions ?? [];
      const ok = keys.some((key) => permissions.includes(key));
      if (!ok) {
        throw new ForbiddenError();
      }
    };
  }

  return { requireAuth, requirePermission };
}
