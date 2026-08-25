#!/usr/bin/env bash
# Periodic PostgreSQL backup for Leonel (Docker compose service `db`).
# Intended cron (as root or deploy with docker access):
#   15 3 * * * /opt/leonel-platform/infrastructure/aws/scripts/backup-pg.sh >> /var/log/leonel-pg-backup.log 2>&1
set -euo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/opt/leonel-platform}"
COMPOSE_FILE="${COMPOSE_FILE:-infrastructure/aws/docker-compose.yml}"
ENV_FILE="${ENV_FILE:-infrastructure/aws/.env}"
BACKUP_DIR="${BACKUP_DIR:-/opt/leonel-platform/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
S3_BACKUP_URI="${S3_BACKUP_URI:-}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${BACKUP_DIR}/leonel_platform_${STAMP}.dump"

mkdir -p "${BACKUP_DIR}"

cd "${COMPOSE_DIR}"

# Load .env for POSTGRES_* if present (do not print secrets).
if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

POSTGRES_USER="${POSTGRES_USER:-leonel_platform}"
POSTGRES_DB="${POSTGRES_DB:-leonel_platform}"

echo "[backup] dumping ${POSTGRES_DB} → ${OUT}"
docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" exec -T db \
  pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Fc > "${OUT}"

echo "[backup] size $(du -h "${OUT}" | awk '{print $1}')"

if [[ -n "${S3_BACKUP_URI}" ]]; then
  echo "[backup] uploading to ${S3_BACKUP_URI}"
  aws s3 cp "${OUT}" "${S3_BACKUP_URI}/$(basename "${OUT}")"
fi

echo "[backup] pruning dumps older than ${RETENTION_DAYS} days"
find "${BACKUP_DIR}" -type f -name 'leonel_platform_*.dump' -mtime "+${RETENTION_DAYS}" -delete

echo "[backup] done ${STAMP}"
