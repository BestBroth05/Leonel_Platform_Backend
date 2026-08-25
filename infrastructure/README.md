# Deploy — Render (backend) — legacy until AWS cutover

> Prefer AWS EC2 docs: [`infrastructure/aws/README.md`](aws/README.md).  
> Keep Render live until AWS smoke tests and frontend cutover succeed.

## Qué elegir en Render

| Opción en Render | ¿Para el backend? |
| --- | --- |
| **Web Service** | **Sí** — API Node/Fastify con HTTP público |
| **Postgres** | **Sí** — base de datos (créala junto al Web Service) |
| Static Sites | No — eso es para el frontend (GitHub Pages ya lo cubre) |
| Private Services | No — sin URL pública |
| Background Workers | No — no atiende HTTP |
| Cron Jobs | No — solo tareas programadas |
| Key Value | No — Redis, no lo usamos aún |
| Workflows | No — orquestación extra, innecesaria ahora |

Necesitas **2 cosas**: `Web Service` (API) + `Postgres` (DB).

---

## Opción recomendada: Blueprint

1. Entra a [Render](https://dashboard.render.com) → **New → Blueprint**
2. Conecta el repo `Leonel_Platform_Backend`, rama **`develop`**
3. Usa el archivo `render.yaml` de la raíz del repo
4. Cuando pida variables manuales (`sync: false`):
   - `ADMIN_PASSWORD` → una contraseña fuerte
   - `CORS_ORIGIN` → URL del front en Pages, ej.  
     `https://bestbroth05.github.io`
5. Deploy

URL de la API (ejemplo):

`https://leonel-platform-api.onrender.com`

Health check: `GET /health`

---

## Variables de entorno (Web Service)

| Variable | Valor |
| --- | --- |
| `DATABASE_URL` | La pone Render desde Postgres (`connectionString`) |
| `JWT_ACCESS_SECRET` | Auto o genera uno largo |
| `ADMIN_EMAIL` | ej. `admin@tu-dominio.com` |
| `ADMIN_PASSWORD` | tu password de admin |
| `CORS_ORIGIN` | origen del front Pages (sin path), ej. `https://bestbroth05.github.io` |
| `SEED_ON_BOOT` | `true` solo la primera vez / demo; luego `false` |
| `PORT` | Lo asigna Render solo (el código ya lo lee) |

---

## GitHub Actions → Render

Workflow: `.github/workflows/deploy-render.yml`

1. En Render: Web Service → **Settings → Deploy Hook** → copiar URL  
2. En GitHub (repo Backend): **Settings → Secrets and variables → Actions**  
   - Secret `RENDER_DEPLOY_HOOK_URL` = esa URL  
3. Cada push a `develop` (tras CI OK) dispara el redeploy en Render  

Si activaste **Auto-Deploy** en el Web Service al conectar GitHub, el hook es opcional (ambos funcionan; el hook fuerza deploy tras CI).

---

## Conectar el frontend (GitHub Pages)

En el repo Frontend, variable de Actions:

`VITE_API_URL` = `https://leonel-platform-api.onrender.com`

(sin slash final)

Luego rebuild/redeploy del front.

---

## Notas

- Plan free: el Web Service puede “dormirse”; el primer request tarda ~30–60s.
- No uses Static Site para este backend.
- Migraciones corren al arrancar el contenedor (`pnpm db:migrate`).
