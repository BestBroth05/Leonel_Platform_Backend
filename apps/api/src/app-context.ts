import { AuthService } from "./application/auth/auth-service.js";
import { ClientsService } from "./application/clients/clients-service.js";
import { CatalogsService } from "./application/catalogs/catalogs-service.js";
import { ClientWeeksService } from "./application/client-weeks/client-weeks-service.js";
import { ProductionFormatsService } from "./application/production-formats/production-formats-service.js";
import { CutsService } from "./application/cuts/cuts-service.js";
import { OrdersService } from "./application/orders/orders-service.js";
import { InventoryService } from "./application/inventory/inventory-service.js";
import { UsersService } from "./application/users/users-service.js";
import { TokenService } from "./infrastructure/auth/token-service.js";
import { UserRepository } from "./infrastructure/auth/user-repository.js";
import { getDb } from "./infrastructure/db/client.js";
import { loadConfig } from "./shared/config.js";
import { createApp } from "./http/create-app.js";

export async function buildApp() {
  const config = loadConfig();
  const db = getDb();
  const users = new UserRepository(db);
  const tokenService = new TokenService(config);
  const authService = new AuthService(users, tokenService);
  const usersService = new UsersService(db);
  const clientsService = new ClientsService(db);
  const catalogsService = new CatalogsService(db);
  const clientWeeksService = new ClientWeeksService(db);
  const productionFormatsService = new ProductionFormatsService(db);
  const cutsService = new CutsService(db);
  const ordersService = new OrdersService(db);
  const inventoryService = new InventoryService(db, ordersService);

  const app = await createApp({
    config,
    authService,
    tokenService,
    usersService,
    clientsService,
    catalogsService,
    clientWeeksService,
    productionFormatsService,
    cutsService,
    ordersService,
    inventoryService,
  });

  return { app, config };
}
