#!/usr/bin/env bash
# Aplica migraciones pendientes de database/migrations/ (orden lexicográfico).
#
# Registro: tabla schema_migrations (nombre de archivo → applied_at).
#
# Uso:
#   ./scripts/run-migrations.sh              # aplica solo pendientes
#   ./scripts/run-migrations.sh --baseline   # marca TODOS los .sql actuales como aplicados (sin ejecutar)
#   ./scripts/run-migrations.sh --status     # lista pendientes / aplicadas
#
# En producción, si ya corriste 001–026 a mano, una sola vez:
#   ./scripts/run-migrations.sh --baseline
# Luego el deploy aplicará solo archivos nuevos (027+).
#
# Requiere contenedor MySQL: vc-ingreso-mysql (MYSQL_ROOT_PASSWORD en el contenedor).
set -Eeuo pipefail

PROJECT_DIR="${VC_PROJECT_DIR:-$HOME/vc-ingreso}"
MYSQL_CONTAINER="${VC_MYSQL_CONTAINER:-vc-ingreso-mysql}"
DB_NAME="${VC_DB_NAME:-vc_db}"
MIGRATIONS_DIR="${PROJECT_DIR}/database/migrations"
MODE="apply"

for arg in "$@"; do
  case "$arg" in
    --baseline) MODE="baseline" ;;
    --status) MODE="status" ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "Opción desconocida: $arg (use --baseline | --status | --help)"
      exit 1
      ;;
  esac
done

cd "$PROJECT_DIR"

if ! docker ps --format '{{.Names}}' | grep -qx "$MYSQL_CONTAINER"; then
  echo "ERROR: contenedor MySQL '$MYSQL_CONTAINER' no está en ejecución."
  exit 1
fi

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo "ERROR: no existe $MIGRATIONS_DIR"
  exit 1
fi

mysql_exec() {
  docker exec -i "$MYSQL_CONTAINER" \
    sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" --batch --skip-column-names "'"$DB_NAME"'"'
}

mysql_exec_file() {
  local file="$1"
  docker exec -i "$MYSQL_CONTAINER" \
    sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "'"$DB_NAME"'"' < "$file"
}

ensure_registry() {
  mysql_exec <<'SQL'
CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `filename` VARCHAR(255) NOT NULL,
  `applied_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`filename`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Migraciones SQL aplicadas por scripts/run-migrations.sh';
SQL
}

list_migration_files() {
  # Solo archivos .sql numerados (001_..., 025_...); orden lexicográfico = numérico con cero a la izquierda.
  find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '[0-9]*.sql' | sort
}

is_applied() {
  local name="$1"
  local found
  found="$(echo "SELECT COUNT(*) FROM schema_migrations WHERE filename = '${name}';" | mysql_exec | tr -d '[:space:]')"
  [[ "$found" == "1" ]]
}

mark_applied() {
  local name="$1"
  echo "INSERT INTO schema_migrations (filename) VALUES ('${name}') ON DUPLICATE KEY UPDATE filename = filename;" | mysql_exec >/dev/null
}

ensure_registry

mapfile -t FILES < <(list_migration_files)
if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "No hay archivos de migración en $MIGRATIONS_DIR"
  exit 0
fi

PENDING=()
APPLIED=()
for f in "${FILES[@]}"; do
  base="$(basename "$f")"
  if is_applied "$base"; then
    APPLIED+=("$base")
  else
    PENDING+=("$f")
  fi
done

echo "==> Migraciones: ${#APPLIED[@]} aplicadas, ${#PENDING[@]} pendientes"

if [[ "$MODE" == "status" ]]; then
  if [[ ${#PENDING[@]} -gt 0 ]]; then
    echo "Pendientes:"
    for f in "${PENDING[@]}"; do
      echo "  - $(basename "$f")"
    done
  else
    echo "Nada pendiente."
  fi
  exit 0
fi

if [[ "$MODE" == "baseline" ]]; then
  echo "==> Baseline: marcando todos los .sql actuales como aplicados (sin ejecutar SQL)"
  for f in "${FILES[@]}"; do
    base="$(basename "$f")"
    mark_applied "$base"
    echo "    ✓ $base"
  done
  echo "Baseline listo. Próximas migraciones nuevas se aplicarán solas en el deploy."
  exit 0
fi

# MODE=apply
if [[ ${#PENDING[@]} -eq 0 ]]; then
  echo "    Nada que aplicar."
  exit 0
fi

for f in "${PENDING[@]}"; do
  base="$(basename "$f")"
  echo "    → Aplicando $base ..."
  if ! mysql_exec_file "$f"; then
    echo "ERROR: falló la migración $base"
    echo "    Corrige el SQL o el estado de la BD antes de reintentar el deploy."
    exit 1
  fi
  mark_applied "$base"
  echo "    ✓ $base"
done

echo "==> Migraciones aplicadas correctamente."
