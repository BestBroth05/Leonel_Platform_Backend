import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import type { AuthService } from "../application/auth/auth-service.js";
import type { ClientsService } from "../application/clients/clients-service.js";
import type { CatalogsService } from "../application/catalogs/catalogs-service.js";
import type { OrdersService } from "../application/orders/orders-service.js";
import type { InventoryService } from "../application/inventory/inventory-service.js";
import type { UsersService } from "../application/users/users-service.js";
import type { TokenService } from "../infrastructure/auth/token-service.js";
import type { AppConfig } from "../shared/config.js";
import { AppError, UnauthorizedError } from "../shared/errors.js";
import { registerDomainRoutes } from "./register-routes.js";

export type AppDeps = {
  config: AppConfig;
  authService: AuthService;
  tokenService: TokenService;
  usersService: UsersService;
  clientsService: ClientsService;
  catalogsService: CatalogsService;
  ordersService: OrdersService;
  inventoryService: InventoryService;
};

export async function createApp(deps: AppDeps) {
  const app = Fastify({
    logger: {
      level: deps.config.LEONEL_PLATFORM_LOG_LEVEL,
    },
  });

  await app.register(cors, {
    origin: deps.config.CORS_ORIGIN,
    credentials: true,
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
    }
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: error.issues[0]?.message ?? "Datos inválidos",
        },
      });
    }
    app.log.error(error);
    return reply.status(500).send({
      error: { code: "INTERNAL_ERROR", message: "Error interno" },
    });
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "Leonel Platform API",
    env: deps.config.LEONEL_PLATFORM_ENV,
  }));

  const loginBody = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  });

  app.post("/auth/login", async (request) => {
    const body = loginBody.parse(request.body);
    return deps.authService.login(body.email, body.password);
  });

  app.post("/auth/refresh", async (request) => {
    const body = z.object({ refreshToken: z.string().min(1) }).parse(request.body);
    return deps.authService.refresh(body.refreshToken);
  });

  app.post("/auth/logout", async (request) => {
    const body = z
      .object({ refreshToken: z.string().optional() })
      .parse(request.body ?? {});
    await deps.authService.logout(body.refreshToken);
    return { ok: true };
  });

  app.get("/auth/me", async (request) => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedError();
    }
    const token = header.slice("Bearer ".length);
    try {
      const claims = await deps.tokenService.verifyAccessToken(token);
      return deps.authService.me(claims.sub);
    } catch {
      throw new UnauthorizedError();
    }
  });

  await registerDomainRoutes(app, {
    tokenService: deps.tokenService,
    usersService: deps.usersService,
    clientsService: deps.clientsService,
    catalogsService: deps.catalogsService,
    ordersService: deps.ordersService,
    inventoryService: deps.inventoryService,
  });

  return app;
}
