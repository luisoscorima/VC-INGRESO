#!/usr/bin/env bash
# Despliegue en producción: backup → (S3) → pull GHCR → reinicio API/frontend.
#
# Uso:
#   ./scripts/deploy-prod.sh
#   VC_IMAGE_TAG=main-7dec253 ./scripts/deploy-prod.sh   # pin por commit
#   VC_SKIP_BACKUP=1 ./scripts/deploy-prod.sh            # prueba rápida (sin backup)
#   VC_SKIP_S3_BACKUP=1 ./scripts/deploy-prod.sh         # backup local sin subir a S3
#
# Requiere (una vez): docker login ghcr.io  si los paquetes GHCR son privados.
# Para S3: AWS CLI + credenciales (mismo usuario IAM de docs/aws-s3-setup.md).
set -Eeuo pipefail

PROJECT_DIR="${VC_PROJECT_DIR:-$HOME/vc-ingreso}"
BACKUP_DIR="${VC_BACKUP_DIR:-$HOME/backups/vc-ingreso}"
COMPOSE_FILE="docker-compose.prod.yml"
IMAGE_TAG="${VC_IMAGE_TAG:-main}"
KEEP_BACKUPS="${VC_KEEP_BACKUPS:-3}"
S3_BUCKET="${S3_BUCKET:-crearttech-storage}"
S3_KEY_PREFIX="${S3_KEY_PREFIX:-vc-ingreso}"
TS="$(date +%F_%H-%M-%S)"

trap 'echo "Falló en línea $LINENO"' ERR

mkdir -p "$BACKUP_DIR"
cd "$PROJECT_DIR"

# Cargar .env del proyecto si existe (AWS_*, S3_*)
if [[ -f "$PROJECT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(grep -E '^(AWS_|S3_|STORAGE_)' "$PROJECT_DIR/.env" | sed 's/\r$//' || true)
  set +a
  S3_BUCKET="${S3_BUCKET:-crearttech-storage}"
  S3_KEY_PREFIX="${S3_KEY_PREFIX:-vc-ingreso}"
fi

DB_BACKUP_SQL="$BACKUP_DIR/backup_vc_db_$TS.sql"
DB_BACKUP_GZ="$DB_BACKUP_SQL.gz"
UPLOADS_BACKUP="$BACKUP_DIR/uploads_$TS.tar.gz"

if [[ "${VC_SKIP_BACKUP:-0}" != "1" ]]; then
  echo "==> 1. Backup de BD → $BACKUP_DIR"
  docker exec vc-ingreso-mysql \
    sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" vc_db --single-transaction --quick' \
    > "$DB_BACKUP_SQL"
  gzip -kf "$DB_BACKUP_SQL"

  echo "==> 2. Backup de imágenes (volumen uploads) → $BACKUP_DIR"
  docker run --rm \
    --user "$(id -u):$(id -g)" \
    -v vc-ingreso_uploads_data:/data:ro \
    -v "$BACKUP_DIR:/backup" \
    alpine \
    tar czf "/backup/uploads_$TS.tar.gz" -C /data .

  if [[ "${VC_SKIP_S3_BACKUP:-0}" != "1" ]]; then
    if command -v aws >/dev/null 2>&1; then
      echo "==> 2b. Subir backups a S3 (s3://${S3_BUCKET}/${S3_KEY_PREFIX}/backups/)"
      aws s3 cp "$DB_BACKUP_GZ" "s3://${S3_BUCKET}/${S3_KEY_PREFIX}/backups/db/"
      aws s3 cp "$UPLOADS_BACKUP" "s3://${S3_BUCKET}/${S3_KEY_PREFIX}/backups/uploads/"
    else
      echo "    AVISO: aws CLI no encontrado; backups solo en disco local."
    fi
  else
    echo "==> 2b. Subida S3 omitida (VC_SKIP_S3_BACKUP=1)"
  fi
else
  echo "==> 1–2. Backup omitido (VC_SKIP_BACKUP=1)"
fi

echo "==> 3. Actualizar repo"
git fetch origin
git checkout main
if ! git diff --quiet -- scripts/deploy-prod.sh 2>/dev/null; then
  echo "    Restaurando scripts/deploy-prod.sh (cambios locales descartados para permitir el pull)"
  git restore -- scripts/deploy-prod.sh 2>/dev/null || git checkout -- scripts/deploy-prod.sh
fi
git pull --ff-only origin main

echo "==> 4. Migraciones SQL"
echo "    Si hay archivos nuevos en database/migrations/, ejecútalos antes de continuar."
echo "    Ejemplo (cámaras LPR → BD):"
echo "    docker exec -i vc-ingreso-mysql sh -c 'mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" vc_db' < database/migrations/009_camera_lpr_access.sql"

echo "==> 5. Descargar imágenes GHCR (tag: ${IMAGE_TAG})"
export VC_IMAGE_TAG="${IMAGE_TAG}"
docker compose -f "$COMPOSE_FILE" pull api frontend

echo "==> 6. Reiniciar API y frontend"
docker compose -f "$COMPOSE_FILE" up -d api frontend --remove-orphans

echo "==> 7. Estado"
docker compose -f "$COMPOSE_FILE" ps

if [[ "${VC_SKIP_BACKUP:-0}" != "1" ]]; then
  echo "==> 8. Limpieza (mantener últimos ${KEEP_BACKUPS} backups)"
  ls -1t "$BACKUP_DIR"/backup_vc_db_*.sql 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f
  ls -1t "$BACKUP_DIR"/backup_vc_db_*.sql.gz 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f
  ls -1t "$BACKUP_DIR"/uploads_*.tar.gz 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f
fi

echo ""
echo "Deploy listo."
if [[ "${VC_SKIP_BACKUP:-0}" != "1" ]]; then
  echo "Backup BD:      $DB_BACKUP_SQL (+ .gz)"
  echo "Backup uploads: $UPLOADS_BACKUP"
  if [[ "${VC_SKIP_S3_BACKUP:-0}" != "1" ]] && command -v aws >/dev/null 2>&1; then
    echo "S3 BD:          s3://${S3_BUCKET}/${S3_KEY_PREFIX}/backups/db/$(basename "$DB_BACKUP_GZ")"
    echo "S3 uploads:     s3://${S3_BUCKET}/${S3_KEY_PREFIX}/backups/uploads/$(basename "$UPLOADS_BACKUP")"
  fi
fi
echo "Los usuarios con pestaña abierta verán aviso de actualización al detectar version.json nuevo."
