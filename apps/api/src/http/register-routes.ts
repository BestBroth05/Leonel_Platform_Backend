import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  MOVEMENT_TYPES,
  ORDER_STATUSES,
  PERMISSIONS,
  type MovementType,
  type OrderStatus,
  type RoleSlug,
} from "@leonel-platform/shared";
import type { ClientsService } from "../application/clients/clients-service.js";
import type { CatalogsService } from "../application/catalogs/catalogs-service.js";
import type { OrdersService } from "../application/orders/orders-service.js";
import type { InventoryService } from "../application/inventory/inventory-service.js";
import type { UsersService } from "../application/users/users-service.js";
import { createAuthGuards } from "./auth.js";
import type { TokenService } from "../infrastructure/auth/token-service.js";

export type RouteServices = {
  tokenService: TokenService;
  usersService: UsersService;
  clientsService: ClientsService;
  catalogsService: CatalogsService;
  ordersService: OrdersService;
  inventoryService: InventoryService;
};

export async function registerDomainRoutes(app: FastifyInstance, deps: RouteServices) {
  const { requireAuth, requirePermission } = createAuthGuards(deps.tokenService);

  const pagination = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  });

  // —— Users ——
  app.get(
    "/users",
    { preHandler: requirePermission(PERMISSIONS.USERS_READ) },
    async () => deps.usersService.list(),
  );

  app.post(
    "/users",
    { preHandler: requirePermission(PERMISSIONS.USERS_WRITE) },
    async (request) => {
      const body = z
        .object({
          email: z.string().email(),
          name: z.string().min(1),
          password: z.string().min(8),
          roleSlug: z.enum(["admin", "manager", "viewer"] as const),
        })
        .parse(request.body);
      return deps.usersService.create(
        { ...body, roleSlug: body.roleSlug as RoleSlug },
        request.auth!.sub,
      );
    },
  );

  app.patch(
    "/users/:id/active",
    { preHandler: requirePermission(PERMISSIONS.USERS_WRITE) },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z.object({ isActive: z.boolean() }).parse(request.body);
      return deps.usersService.setActive(params.id, body.isActive, request.auth!.sub);
    },
  );

  // —— Clients ——
  app.get(
    "/clients",
    { preHandler: requirePermission(PERMISSIONS.CLIENTS_READ) },
    async (request) => {
      const query = pagination
        .extend({
          q: z.string().optional(),
          activeOnly: z
            .enum(["true", "false"])
            .optional()
            .transform((v) => v === "true"),
        })
        .parse(request.query);
      return deps.clientsService.list(query);
    },
  );

  app.get(
    "/clients/:id",
    { preHandler: requirePermission(PERMISSIONS.CLIENTS_READ) },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      return deps.clientsService.getById(params.id);
    },
  );

  app.post(
    "/clients",
    { preHandler: requirePermission(PERMISSIONS.CLIENTS_WRITE) },
    async (request) => {
      const body = z
        .object({
          name: z.string().min(1),
          contactName: z.string().nullable().optional(),
          phone: z.string().nullable().optional(),
          email: z.string().email().nullable().optional().or(z.literal("")),
          rfc: z.string().nullable().optional(),
          notes: z.string().nullable().optional(),
        })
        .parse(request.body);
      return deps.clientsService.create(
        {
          ...body,
          email: body.email || null,
        },
        request.auth!.sub,
      );
    },
  );

  app.patch(
    "/clients/:id",
    { preHandler: requirePermission(PERMISSIONS.CLIENTS_WRITE) },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z
        .object({
          name: z.string().min(1).optional(),
          contactName: z.string().nullable().optional(),
          phone: z.string().nullable().optional(),
          email: z.string().email().nullable().optional().or(z.literal("")),
          rfc: z.string().nullable().optional(),
          notes: z.string().nullable().optional(),
          isActive: z.boolean().optional(),
        })
        .parse(request.body);
      return deps.clientsService.update(
        params.id,
        {
          ...body,
          email: body.email === "" ? null : body.email,
        },
        request.auth!.sub,
      );
    },
  );

  // —— Catalogs ——
  const catalogKind = z.enum(["brands", "pant-types", "destinations"]);

  app.get(
    "/catalogs/:kind",
    { preHandler: requirePermission(PERMISSIONS.CATALOGS_READ) },
    async (request) => {
      const params = z.object({ kind: catalogKind }).parse(request.params);
      const query = z
        .object({
          activeOnly: z
            .enum(["true", "false"])
            .optional()
            .transform((v) => v === "true"),
        })
        .parse(request.query);
      return deps.catalogsService.list(params.kind, query.activeOnly);
    },
  );

  app.post(
    "/catalogs/:kind",
    { preHandler: requirePermission(PERMISSIONS.CATALOGS_WRITE) },
    async (request) => {
      const params = z.object({ kind: catalogKind }).parse(request.params);
      const body = z.object({ name: z.string().min(1) }).parse(request.body);
      return deps.catalogsService.create(params.kind, body.name, request.auth!.sub);
    },
  );

  app.patch(
    "/catalogs/:kind/:id",
    { preHandler: requirePermission(PERMISSIONS.CATALOGS_WRITE) },
    async (request) => {
      const params = z
        .object({ kind: catalogKind, id: z.string().uuid() })
        .parse(request.params);
      const body = z
        .object({
          name: z.string().min(1).optional(),
          isActive: z.boolean().optional(),
        })
        .parse(request.body);
      return deps.catalogsService.update(
        params.kind,
        params.id,
        body,
        request.auth!.sub,
      );
    },
  );

  // —— Orders ——
  app.get(
    "/orders",
    { preHandler: requirePermission(PERMISSIONS.ORDERS_READ) },
    async (request) => {
      const query = pagination
        .extend({
          q: z.string().optional(),
          status: z.enum(ORDER_STATUSES).optional(),
          clientId: z.string().uuid().optional(),
        })
        .parse(request.query);
      return deps.ordersService.list(query);
    },
  );

  app.get(
    "/orders/:id",
    { preHandler: requirePermission(PERMISSIONS.ORDERS_READ) },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      return deps.ordersService.getById(params.id);
    },
  );

  app.get(
    "/orders/:id/status-history",
    { preHandler: requirePermission(PERMISSIONS.ORDERS_READ) },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      return deps.ordersService.statusHistory(params.id);
    },
  );

  app.post(
    "/orders",
    { preHandler: requirePermission(PERMISSIONS.ORDERS_WRITE) },
    async (request) => {
      const body = z
        .object({
          number: z.string().min(1),
          clientId: z.string().uuid(),
          brandId: z.string().uuid().nullable().optional(),
          pantTypeId: z.string().uuid().nullable().optional(),
          expectedQuantity: z.number().int().positive(),
          notes: z.string().nullable().optional(),
        })
        .parse(request.body);
      return deps.ordersService.create(body, request.auth!.sub);
    },
  );

  app.patch(
    "/orders/:id",
    { preHandler: requirePermission(PERMISSIONS.ORDERS_WRITE) },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z
        .object({
          brandId: z.string().uuid().nullable().optional(),
          pantTypeId: z.string().uuid().nullable().optional(),
          expectedQuantity: z.number().int().positive().optional(),
          notes: z.string().nullable().optional(),
        })
        .parse(request.body);
      return deps.ordersService.update(params.id, body, request.auth!.sub);
    },
  );

  app.post(
    "/orders/:id/transition",
    { preHandler: requirePermission(PERMISSIONS.ORDERS_WRITE) },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z
        .object({
          status: z.enum(ORDER_STATUSES),
          note: z.string().optional(),
        })
        .parse(request.body);
      return deps.ordersService.transition(
        params.id,
        body.status as OrderStatus,
        request.auth!.sub,
        body.note,
      );
    },
  );

  // —— Inventory ——
  app.get(
    "/orders/:id/balance",
    { preHandler: requirePermission(PERMISSIONS.INVENTORY_READ) },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      return deps.inventoryService.getBalance(params.id);
    },
  );

  app.get(
    "/orders/:id/movements",
    { preHandler: requirePermission(PERMISSIONS.INVENTORY_READ) },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      return deps.inventoryService.listMovements(params.id);
    },
  );

  app.post(
    "/orders/:id/movements",
    { preHandler: requirePermission(PERMISSIONS.INVENTORY_WRITE) },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z
        .object({
          type: z.enum(MOVEMENT_TYPES),
          quantity: z.number().int(),
          note: z.string().nullable().optional(),
          destinationId: z.string().uuid().nullable().optional(),
          idempotencyKey: z.string().min(1).max(128).optional(),
        })
        .parse(request.body);

      const idempotencyHeader =
        typeof request.headers["idempotency-key"] === "string"
          ? request.headers["idempotency-key"]
          : undefined;

      return deps.inventoryService.createMovement(
        {
          orderId: params.id,
          type: body.type as MovementType,
          quantity: body.quantity,
          note: body.note,
          destinationId: body.destinationId,
          idempotencyKey: body.idempotencyKey ?? idempotencyHeader,
        },
        request.auth!.sub,
        request.auth!.permissions,
      );
    },
  );

  app.post(
    "/orders/:id/movements/:movementId/cancel",
    {
      preHandler: requirePermission(
        PERMISSIONS.INVENTORY_CORRECT,
        PERMISSIONS.INVENTORY_WRITE,
      ),
    },
    async (request) => {
      const params = z
        .object({
          id: z.string().uuid(),
          movementId: z.string().uuid(),
        })
        .parse(request.params);
      const body = z
        .object({ note: z.string().optional() })
        .parse(request.body ?? {});
      return deps.inventoryService.cancelMovement(
        params.id,
        params.movementId,
        request.auth!.sub,
        request.auth!.permissions,
        body.note,
      );
    },
  );

  // Keep requireAuth referenced for future use without lint noise
  void requireAuth;
}
