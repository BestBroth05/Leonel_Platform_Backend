# Deploy Leonel Platform API on PathBus EC2 (AWS)

Target host: `api-test.path-bus.com` (`3.141.247.138`, instance `i-0877ac6f5aaecbffa`, `us-east-2`).

Does **not** modify PathBus (`127.0.0.1:3000` / SQL Server). Leonel uses its own Postgres 16 container and API on `127.0.0.1:3001`, published as `https://api-test.path-bus.com/leonel/`.

## Precheck (do before first deploy)

1. **EC2 snapshot / AMI** from the AWS console (instance role cannot create snapshots).
2. Confirm resources (last check): ~3.8 GiB RAM with ~1.7 GiB available, ~16 GiB free disk, 2 vCPU, load ~0 — enough for API + Postgres.
3. User `deploy` needs Docker access:
   ```bash
   sudo usermod -aG docker deploy
   # re-login, then: docker ps
   ```
4. Prefer passwordless sudo for nginx reload only, or run nginx edits as an admin once.

## Layout on server

```text
/opt/leonel-platform/          # git clone of Leonel_Platform_Backend (develop)
  infrastructure/aws/
    docker-compose.yml
    .env                       # from .env.example (secrets)
    nginx-leonel.conf.snippet
    scripts/backup-pg.sh
  apps/api/Dockerfile
```

## First deploy

```bash
sudo mkdir -p /opt/leonel-platform
sudo chown deploy:deploy /opt/leonel-platform
git clone git@github.com:BestBroth05/Leonel_Platform_Backend.git /opt/leonel-platform
cd /opt/leonel-platform
git checkout develop
cp infrastructure/aws/.env.example infrastructure/aws/.env
# edit .env — strong POSTGRES_PASSWORD, JWT_ACCESS_SECRET, ADMIN_PASSWORD

docker compose -f infrastructure/aws/docker-compose.yml --env-file infrastructure/aws/.env up -d --build
docker compose -f infrastructure/aws/docker-compose.yml --env-file infrastructure/aws/.env ps
curl -sS http://127.0.0.1:3001/health
```

## Nginx

Insert the contents of `nginx-leonel.conf.snippet` **inside** the existing HTTPS `server` for `api-test.path-bus.com`, **before** `location /` (PathBus stays on `/`).

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -sS https://api-test.path-bus.com/leonel/health
curl -sS https://api-test.path-bus.com/   # must still be PathBus OK
```

## Firewall

Do **not** open 3001 or 5432 publicly. Only 80/443.

## Backups

```bash
chmod +x infrastructure/aws/scripts/backup-pg.sh
# daily 03:15 UTC example
crontab -e
# 15 3 * * * BACKUP_DIR=/opt/leonel-platform/backups /opt/leonel-platform/infrastructure/aws/scripts/backup-pg.sh >> /var/log/leonel-pg-backup.log 2>&1
```

Optional: set `S3_BACKUP_URI=s3://bucket/leonel-platform/pg` in `.env` / cron env (requires `s3:PutObject` on the instance role).

## Frontend

After smoke tests pass, set GitHub Actions variable on the frontend repo:

`VITE_API_URL=https://api-test.path-bus.com/leonel`

Redeploy Pages. Keep Render running until AWS is validated.

## Smoke checklist

1. `GET /leonel/health`
2. Login admin
3. Create / list / edit (e.g. client)
4. `docker compose ... restart` API + db → data still present
5. PathBus `/` still OK
