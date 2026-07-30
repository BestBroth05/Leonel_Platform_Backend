# Leonel Platform — Backend

API Node/Fastify (`@leonel-platform/api`) + Compose local para **Leonel Platform**.

Repositorio: [Leonel_Platform_Backend](https://github.com/BestBroth05/Leonel_Platform_Backend.git)

## Layout local (carpetas hermanas)

```text
leonel-platform-workspace/
├── leonel-platform-backend/   # este repo (API + Compose + Postgres)
└── leonel-platform-frontend/  # repo Frontend (Vite/React)
```

`compose.local.yaml` construye el web desde `../leonel-platform-frontend`.

## Paquetes (este repo)

| Uso | Valor |
| --- | ----- |
| Backend | `@leonel-platform/api` |
| Contratos internos API | `@leonel-platform/shared` (solo backend; no se publica entre repos) |
| ORM | **Drizzle** + Drizzle Kit (PostgreSQL) |

## Requisitos

- Node.js 22+
- pnpm 9 (`corepack enable`)
- Docker Desktop
- Frontend hermano en `../leonel-platform-frontend`

## Arranque local

```bash
cp .env.example .env
pnpm install
pnpm local:up
```

URLs:

- Web: http://localhost:5173
- API: http://localhost:3000
- Health: http://localhost:3000/health

Usuario seed (solo local/CI):

- Email: `admin@leonel-platform.local`
- Password: `ChangeMeLocalOnly!`

## Comandos

```bash
pnpm local:up      # Docker: Postgres + API + Web (migrate + seed en API)
pnpm local:down
pnpm local:reset   # borra volúmenes y levanta de nuevo
pnpm local:logs
pnpm local:test    # typecheck + tests (+ smoke si el stack está arriba)
pnpm typecheck
pnpm test
pnpm build
```

## Persistencia

- Esquemas y consultas: Drizzle ORM en `apps/api/src/infrastructure/db`
- Migraciones versionadas: `apps/api/drizzle` vía Drizzle Kit
- Sin sync automático de esquema en producción
- Seeds de prueba: solo local/CI (`LEONEL_PLATFORM_ENV` ≠ production)

## API (Fase 1 + 2)

| Área | Endpoints |
| ---- | --------- |
| Auth | `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me` |
| Users | `GET/POST /users`, `PATCH /users/:id/active` |
| Clients | `GET/POST /clients`, `GET/PATCH /clients/:id` |
| Catalogs | `GET/POST /catalogs/:kind`, `PATCH /catalogs/:kind/:id` (`brands` \| `pant-types` \| `destinations`) |
| Orders | `GET/POST /orders`, `GET/PATCH /orders/:id`, `POST /orders/:id/transition`, `GET /orders/:id/status-history` |
| Inventory | `GET /orders/:id/balance`, `GET/POST /orders/:id/movements`, `POST /orders/:id/movements/:movementId/cancel` |

Reglas de saldo e idempotencia (`Idempotency-Key`) son **provisionales** hasta validar con el taller.

## Documentación

- Contexto: [LEONEL_PLATFORM_CONTEXT_AND_PLAN.md](./LEONEL_PLATFORM_CONTEXT_AND_PLAN.md)
- CI develop: `.github/workflows/develop-ci.yml`
- Deploy AWS (SAM/OIDC): pendiente bloque 3
