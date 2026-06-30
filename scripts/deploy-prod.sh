#!/usr/bin/env bash
# Despliegue en producción: backup → pull GHCR → reinicio API/frontend.
#
# Uso:
#   ./scripts/deploy-prod.sh
#   VC_IMAGE_TAG=main-7dec253 ./scripts/deploy-prod.sh   # pin por commit
#   VC_SKIP_BACKUP=1 ./scripts/deploy-prod.sh            # prueba rápida (sin backup)
#
# Requiere (una vez): docker login ghcr.io  si los paquetes GHCR son privados.
set -Eeuo pipefail

PROJECT_DIR="${VC_PROJECT_DIR:-$HOME/vc-ingreso}"
BACKUP_DIR="${VC_BACKUP_DIR:-$HOME/backups/vc-ingreso}"
COMPOSE_FILE="docker-compose.prod.yml"
IMAGE_TAG="${VC_IMAGE_TAG:-main}"
KEEP_BACKUPS="${VC_KEEP_BACKUPS:-3}"
TS="$(date +%F_%H-%M-%S)"

trap 'echo "Falló en línea $LINENO"' ERR

mkdir -p "$BACKUP_DIR"
cd "$PROJECT_DIR"

if [[ "${VC_SKIP_BACKUP:-0}" != "1" ]]; then
  echo "==> 1. Backup de BD → $BACKUP_DIR"
  docker exec vc-ingreso-mysql \
    sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" vc_db --single-transaction --quick' \
    > "$BACKUP_DIR/backup_vc_db_$TS.sql"

  echo "==> 2. Backup de imágenes (volumen uploads) → $BACKUP_DIR"
  docker run --rm \
    --user "$(id -u):$(id -g)" \
    -v vc-ingreso_uploads_data:/data:ro \
    -v "$BACKUP_DIR:/backup" \
    alpine \
    tar czf "/backup/uploads_$TS.tar.gz" -C /data .
else
  echo "==> 1–2. Backup omitido (VC_SKIP_BACKUP=1)"
fi

echo "==> 3. Actualizar repo"
git fetch origin
git checkout main
git pull --ff-only origin main

echo "==> 4. Migraciones SQL"
echo "    Si hay archivos nuevos en database/migrations/, ejecútalos antes de continuar."
echo "    Ejemplo:"
echo "    docker exec -i vc-ingreso-mysql sh -c 'mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" vc_db' < database/migrations/00X_....sql"

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
  ls -1t "$BACKUP_DIR"/uploads_*.tar.gz 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f
fi

echo ""
echo "Deploy listo."
if [[ "${VC_SKIP_BACKUP:-0}" != "1" ]]; then
  echo "Backup BD:      $BACKUP_DIR/backup_vc_db_$TS.sql"
  echo "Backup uploads: $BACKUP_DIR/uploads_$TS.tar.gz"
fi
echo "Los usuarios con pestaña abierta verán aviso de actualización al detectar version.json nuevo."
