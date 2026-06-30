#!/usr/bin/env bash
# Despliegue en producción usando imágenes precompiladas en GHCR.
# Requiere: docker login ghcr.io (una vez) si los paquetes son privados.
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE_FILE="docker-compose.prod.yml"
IMAGE_TAG="${VC_IMAGE_TAG:-main}"

echo "==> 1. Backup de BD"
docker exec vc-ingreso-mysql \
  sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" vc_db --single-transaction' \
  > "backup_vc_db_$(date +%F_%H-%M-%S).sql"

echo "==> 2. Actualizar repo (migraciones y compose)"
git fetch origin
git checkout main
git pull --ff-only origin main

if [[ -d database/migrations ]]; then
  echo "==> 3. Migraciones pendientes (ejecutar manualmente si aplica)"
  echo "    Revisa database/migrations/*.sql nuevos desde el último deploy."
fi

echo "==> 4. Descargar imágenes (${IMAGE_TAG})"
export VC_IMAGE_TAG="${IMAGE_TAG}"
docker compose -f "${COMPOSE_FILE}" pull api frontend

echo "==> 5. Reiniciar API y frontend"
docker compose -f "${COMPOSE_FILE}" up -d api frontend --remove-orphans

echo "==> 6. Estado"
docker compose -f "${COMPOSE_FILE}" ps
echo "Deploy listo. Los usuarios con pestaña abierta verán aviso de actualización en unos minutos."
