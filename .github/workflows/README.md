# GitHub Actions

| Workflow | Estado |
| -------- | ------ |
| `develop-ci.yml` | Activo — typecheck, tests, migrate/seed, build API/Docker |
| `deploy-render.yml` | Activo — CI + Deploy Hook a Render en push a `develop` |
| `integration-ci.yml` | Pendiente (checkout dual Frontend) |
| `deploy-production.yml` | Pendiente (bloque 3 — SAM/OIDC) |

## Render (backend)

Ver también [`../render.yaml`](../render.yaml) y la guía en [`../infrastructure/README.md`](../infrastructure/README.md).
