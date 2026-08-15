import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import type { AuthService } from "../application/auth/auth-service.js";
import type { ClientsService } from "../application/clients/clients-service.js";
import type { CatalogsService } from "../application/catalogs/catalogs-service.js";
import type { ClientWeeksService } from "../application/client-weeks/client-weeks-service.js";
import type { ProductionFormatsService } from "../application/production-formats/production-formats-service.js";
import type { CutsService } from "../application/cuts/cuts-service.js";
import type { OrdersService } from "../application/orders/orders-service.js";
import type { InventoryService } from "../application/inventory/inventory-service.js";
import type { UsersService } from "../application/users/users-service.js";
import type { TokenService } from "../infrastructure/auth/token-service.js";
import type { AppConfig } from "../shared/config.js";
import { AppError, UnauthorizedError } from "../shared/errors.js";
import { registerDomainRoutes } from "./register-routes.js";

function isAppErrorLike(error: unknown): error is AppError {
  if (!error || typeof error !== "object") return false;
  const e = error as {
    code?: unknown;
    message?: unknown;
    statusCode?: unknown;
    details?: unknown;
  };
  return (
    typeof e.code === "string" &&
    typeof e.message === "string" &&
    typeof e.statusCode === "number"
  );
}

export type AppDeps = {
  config: AppConfig;
  authService: AuthService;
  tokenService: TokenService;
  usersService: UsersService;
  clientsService: ClientsService;
  catalogsService: CatalogsService;
  clientWeeksService: ClientWeeksService;
  productionFormatsService: ProductionFormatsService;
  cutsService: CutsService;
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
    const appError =
      error instanceof AppError
        ? error
        : isAppErrorLike(error)
          ? error
          : null;

    if (appError) {
      return reply.status(appError.statusCode).send({
        error: {
          code: appError.code,
          message: appError.message,
          ...(appError.details !== undefined ? { details: appError.details } : {}),
        },
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
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Error interno";
    return reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message:
          deps.config.LEONEL_PLATFORM_ENV === "production"
            ? "Error interno"
            : message,
      },
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
    clientWeeksService: deps.clientWeeksService,
    productionFormatsService: deps.productionFormatsService,
    cutsService: deps.cutsService,
    ordersService: deps.ordersService,
    inventoryService: deps.inventoryService,
  });

  return app;
}
