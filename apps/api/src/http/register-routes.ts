import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  MOVEMENT_TYPES,
  ORDER_STATUSES,
  PACKAGING_TYPES,
  PERMISSIONS,
  WEEKDAYS,
  type MovementType,
  type OrderStatus,
  type PackagingType,
  type RoleSlug,
} from "@leonel-platform/shared";
import type { ClientsService } from "../application/clients/clients-service.js";
import type { CatalogsService } from "../application/catalogs/catalogs-service.js";
import type { ClientWeeksService } from "../application/client-weeks/client-weeks-service.js";
import type { ProductionFormatsService } from "../application/production-formats/production-formats-service.js";
import type { CutsService } from "../application/cuts/cuts-service.js";
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
  clientWeeksService: ClientWeeksService;
  productionFormatsService: ProductionFormatsService;
  cutsService: CutsService;
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

  const weekdaySchema = z.enum(WEEKDAYS).nullable().optional();

  app.post(
    "/clients",
    { preHandler: requirePermission(PERMISSIONS.CLIENTS_WRITE) },
    async (request) => {
      const body = z
        .object({
          name: z.string().min(1),
          contactName: z.string().nullable().optional(),
          email: z.string().email().nullable().optional().or(z.literal("")),
          rfc: z.string().nullable().optional(),
          notes: z.string().nullable().optional(),
          weekOpensOn: weekdaySchema,
          weekClosesOn: weekdaySchema,
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
          email: z.string().email().nullable().optional().or(z.literal("")),
          rfc: z.string().nullable().optional(),
          notes: z.string().nullable().optional(),
          weekOpensOn: weekdaySchema,
          weekClosesOn: weekdaySchema,
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

  // —— Client weeks / settlement ——
  app.get(
    "/clients/:id/weeks",
    { preHandler: requirePermission(PERMISSIONS.CLIENTS_READ) },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      return deps.clientWeeksService.listByClient(params.id);
    },
  );

  app.get(
    "/clients/:id/weeks/open",
    { preHandler: requirePermission(PERMISSIONS.CLIENTS_READ) },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      return deps.clientWeeksService.getOpenWeek(params.id);
    },
  );

  app.post(
    "/clients/:id/weeks/open",
    { preHandler: requirePermission(PERMISSIONS.CLIENTS_WRITE) },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z
        .object({ startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
        .parse(request.body ?? {});
      return deps.clientWeeksService.openWeek(params.id, request.auth!.sub, body);
    },
  );

  app.get(
    "/client-weeks/:id",
    { preHandler: requirePermission(PERMISSIONS.CLIENTS_READ) },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      return deps.clientWeeksService.getById(params.id);
    },
  );

  app.get(
    "/client-weeks/:id/close-preview",
    { preHandler: requirePermission(PERMISSIONS.CLIENTS_READ) },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      return deps.clientWeeksService.previewClose(params.id);
    },
  );

  app.post(
    "/client-weeks/:id/close",
    { preHandler: requirePermission(PERMISSIONS.CLIENTS_WRITE) },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      return deps.clientWeeksService.closeWeek(params.id, request.auth!.sub);
    },
  );

  app.post(
    "/client-weeks/:id/reopen",
    { preHandler: requirePermission(PERMISSIONS.CLIENTS_WRITE) },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      return deps.clientWeeksService.reopenWeek(params.id, request.auth!.sub);
    },
  );

  app.get(
    "/client-weeks/:id/snapshots",
    { preHandler: requirePermission(PERMISSIONS.CLIENTS_READ) },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      return deps.clientWeeksService.listSnapshots(params.id);
    },
  );

  app.get(
    "/client-weeks/:id/snapshots/current",
    { preHandler: requirePermission(PERMISSIONS.CLIENTS_READ) },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      return deps.clientWeeksService.getCurrentSnapshot(params.id);
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

  // —— Production formats ——
  app.get(
    "/production-formats",
    { preHandler: requirePermission(PERMISSIONS.ORDERS_READ) },
    async (request) => {
      const query = pagination.extend({ q: z.string().optional() }).parse(request.query);
      return deps.productionFormatsService.list(query);
    },
  );

  app.get(
    "/production-formats/:id",
    { preHandler: requirePermission(PERMISSIONS.ORDERS_READ) },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      return deps.productionFormatsService.getById(params.id);
    },
  );

  app.post(
    "/production-formats",
    { preHandler: requirePermission(PERMISSIONS.ORDERS_WRITE) },
    async (request) => {
      const body = z
        .object({
          number: z.string().min(1),
          clientId: z.string().uuid(),
        })
        .parse(request.body);
      return deps.productionFormatsService.create(body, request.auth!.sub);
    },
  );

  app.patch(
    "/production-formats/:id",
    { preHandler: requirePermission(PERMISSIONS.ORDERS_WRITE) },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z
        .object({
          number: z.string().min(1).optional(),
          clientId: z.string().uuid().optional(),
        })
        .parse(request.body);
      return deps.productionFormatsService.update(params.id, body, request.auth!.sub);
    },
  );

  app.get(
    "/production-formats/:id/cuts",
    { preHandler: requirePermission(PERMISSIONS.ORDERS_READ) },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      return deps.cutsService.listByFormat(params.id);
    },
  );

  app.post(
    "/production-formats/:id/cuts",
    { preHandler: requirePermission(PERMISSIONS.ORDERS_WRITE) },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z
        .object({
          number: z.string().min(1),
          workPlan: z.string().min(1),
          style: z.string().min(1),
          expectedQuantity: z.number().int().positive(),
        })
        .parse(request.body);
      return deps.cutsService.create(params.id, body, request.auth!.sub);
    },
  );

  app.get(
    "/production-formats/:id/orders",
    { preHandler: requirePermission(PERMISSIONS.ORDERS_READ) },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const query = pagination
        .extend({
          q: z.string().optional(),
          status: z.enum(ORDER_STATUSES).optional(),
        })
        .parse(request.query);
      return deps.ordersService.list({
        ...query,
        productionFormatId: params.id,
      });
    },
  );

  // —— Cuts ——
  app.get(
    "/cuts/:id",
    { preHandler: requirePermission(PERMISSIONS.ORDERS_READ) },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      return deps.cutsService.getById(params.id);
    },
  );

  app.get(
    "/cuts/:id/orders",
    { preHandler: requirePermission(PERMISSIONS.ORDERS_READ) },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      return deps.cutsService.listOrdersUsingCut(params.id);
    },
  );

  app.patch(
    "/cuts/:id",
    { preHandler: requirePermission(PERMISSIONS.ORDERS_WRITE) },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z
        .object({
          number: z.string().min(1).optional(),
          workPlan: z.string().min(1).optional(),
          style: z.string().min(1).optional(),
          expectedQuantity: z.number().int().positive().optional(),
        })
        .parse(request.body);
      return deps.cutsService.update(params.id, body, request.auth!.sub);
    },
  );

  app.get(
    "/cuts/:id/receipts",
    { preHandler: requirePermission(PERMISSIONS.ORDERS_READ) },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      return deps.cutsService.listReceipts(params.id);
    },
  );

  app.post(
    "/cuts/:id/receipts",
    { preHandler: requirePermission(PERMISSIONS.ORDERS_WRITE) },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z
        .object({
          folioNumber: z.string().min(1),
          quantity: z.number().int().positive(),
          receivedAt: z.string().datetime().optional(),
          notes: z.string().nullable().optional(),
        })
        .parse(request.body);
      return deps.cutsService.createReceipt(params.id, body, request.auth!.sub);
    },
  );

  app.patch(
    "/cut-receipts/:id",
    { preHandler: requirePermission(PERMISSIONS.ORDERS_WRITE) },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z
        .object({
          folioNumber: z.string().min(1).optional(),
          quantity: z.number().int().positive().optional(),
          receivedAt: z.string().datetime().optional(),
          notes: z.string().nullable().optional(),
        })
        .parse(request.body);
      return deps.cutsService.updateReceipt(params.id, body, request.auth!.sub);
    },
  );

  app.delete(
    "/cut-receipts/:id",
    { preHandler: requirePermission(PERMISSIONS.ORDERS_WRITE) },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      await deps.cutsService.deleteReceipt(params.id, request.auth!.sub);
      return { ok: true };
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
          productionFormatId: z.string().uuid().optional(),
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

  const cutAssignmentSchema = z.object({
    cutId: z.string().uuid(),
    assignedQuantity: z.number().int().positive(),
  });

  const packagingTypeSchema = z.enum(PACKAGING_TYPES).nullable().optional();
  const sizeBreakdownSchema = z.object({
    sizeLabel: z.string().min(1),
    quantity: z.number().int().positive(),
  });

  app.post(
    "/orders",
    { preHandler: requirePermission(PERMISSIONS.ORDERS_WRITE) },
    async (request) => {
      const body = z
        .object({
          number: z.string().min(1),
          clientId: z.string().uuid().optional(),
          productionFormatId: z.string().uuid(),
          cuts: z.array(cutAssignmentSchema).min(1),
          brandId: z.string().uuid().nullable().optional(),
          pantTypeId: z.string().uuid().nullable().optional(),
          purchaseOrder: z.string().nullable().optional(),
          costPerGarment: z.union([z.string(), z.number()]).nullable().optional(),
          packagingType: packagingTypeSchema,
          packageCount: z.number().int().positive().nullable().optional(),
          unitsPerPackage: z.number().int().positive().nullable().optional(),
          sizes: z.array(sizeBreakdownSchema).optional(),
          notes: z.string().nullable().optional(),
        })
        .parse(request.body);
      return deps.ordersService.create(
        {
          ...body,
          packagingType: body.packagingType as PackagingType | null | undefined,
          costPerGarment:
            body.costPerGarment == null ? null : String(body.costPerGarment),
        },
        request.auth!.sub,
      );
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
          cuts: z.array(cutAssignmentSchema).min(1).optional(),
          purchaseOrder: z.string().nullable().optional(),
          costPerGarment: z.union([z.string(), z.number()]).nullable().optional(),
          notes: z.string().nullable().optional(),
        })
        .parse(request.body);
      return deps.ordersService.update(
        params.id,
        {
          ...body,
          costPerGarment:
            body.costPerGarment === undefined
              ? undefined
              : body.costPerGarment == null
                ? null
                : String(body.costPerGarment),
        },
        request.auth!.sub,
      );
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
          quantity: z.number().int().optional(),
          packagingType: packagingTypeSchema,
          packageCount: z.number().int().positive().nullable().optional(),
          unitsPerPackage: z.number().int().positive().nullable().optional(),
          note: z.string().nullable().optional(),
          destinationId: z.string().uuid().nullable().optional(),
          idempotencyKey: z.string().min(1).max(128).optional(),
          occurredAt: z.string().datetime().optional(),
          cutAllocations: z
            .array(
              z.object({
                orderCutId: z.string().uuid(),
                quantity: z.number().int().positive(),
              }),
            )
            .optional(),
          sizes: z.array(sizeBreakdownSchema).optional(),
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
          packagingType: body.packagingType as PackagingType | null | undefined,
          packageCount: body.packageCount,
          unitsPerPackage: body.unitsPerPackage,
          note: body.note,
          destinationId: body.destinationId,
          idempotencyKey: body.idempotencyKey ?? idempotencyHeader,
          occurredAt: body.occurredAt,
          cutAllocations: body.cutAllocations,
          sizes: body.sizes,
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

  void requireAuth;
}
