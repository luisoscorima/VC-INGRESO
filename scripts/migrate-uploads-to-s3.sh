#!/usr/bin/env bash
# Migra archivos de server/uploads (o volumen Docker) a S3 bajo vc-ingreso/media/.
# No modifica la BD: los paths /uploads/... se mapean a keys S3.
#
# Uso (en el servidor de prod, desde el repo):
#   ./scripts/migrate-uploads-to-s3.sh --dry-run
#   ./scripts/migrate-uploads-to-s3.sh
#
# Variables: S3_BUCKET, S3_KEY_PREFIX, AWS_REGION (o .env del proyecto).
# Requiere: aws CLI.
set -Eeuo pipefail

PROJECT_DIR="${VC_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
DRY_RUN=0
UPLOADS_SRC=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --uploads=*) UPLOADS_SRC="${arg#*=}" ;;
    -h|--help)
      echo "Uso: $0 [--dry-run] [--uploads=/ruta/a/uploads]"
      exit 0
      ;;
  esac
done

cd "$PROJECT_DIR"

if [[ -f "$PROJECT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(grep -E '^(AWS_|S3_|STORAGE_)' "$PROJECT_DIR/.env" | sed 's/\r$//' || true)
  set +a
fi

S3_BUCKET="${S3_BUCKET:-crearttech-storage}"
S3_KEY_PREFIX="${S3_KEY_PREFIX:-vc-ingreso}"

if ! command -v aws >/dev/null 2>&1; then
  echo "Error: aws CLI no encontrado." >&2
  exit 1
fi

# Preferir copia local del volumen si no se pasó --uploads
if [[ -z "$UPLOADS_SRC" ]]; then
  if [[ -d "$PROJECT_DIR/server/uploads" ]]; then
    UPLOADS_SRC="$PROJECT_DIR/server/uploads"
  else
    TMP_DIR="$(mktemp -d)"
    trap 'rm -rf "$TMP_DIR"' EXIT
    echo "==> Exportando volumen vc-ingreso_uploads_data → $TMP_DIR"
    docker run --rm \
      -v vc-ingreso_uploads_data:/data:ro \
      -v "$TMP_DIR:/out" \
      alpine \
      sh -c 'cp -a /data/. /out/'
    UPLOADS_SRC="$TMP_DIR"
  fi
fi

if [[ ! -d "$UPLOADS_SRC" ]]; then
  echo "Error: no existe directorio de uploads: $UPLOADS_SRC" >&2
  exit 1
fi

echo "==> Origen: $UPLOADS_SRC"
echo "==> Destino: s3://${S3_BUCKET}/${S3_KEY_PREFIX}/media/"
[[ "$DRY_RUN" == "1" ]] && echo "==> MODO DRY-RUN (no sube)"

uploaded=0
skipped=0
failed=0

# Mapeo:
#   incidents/X          → media/incidents/X
#   public/{subdir}/X    → media/{subdir}/X
#   pets/X               → media/pets/X
#   resto bajo uploads   → media/...
while IFS= read -r -d '' file; do
  rel="${file#"$UPLOADS_SRC"/}"
  rel="${rel#./}"

  if [[ "$rel" == public/* ]]; then
    # public/vehicles/x.jpg → media/vehicles/x.jpg
    key="${S3_KEY_PREFIX}/media/${rel#public/}"
  elif [[ "$rel" == incidents/* || "$rel" == pets/* ]]; then
    key="${S3_KEY_PREFIX}/media/${rel}"
  else
    key="${S3_KEY_PREFIX}/media/${rel}"
  fi

  if [[ "$DRY_RUN" == "1" ]]; then
    echo "  WOULD UPLOAD  $rel  →  s3://${S3_BUCKET}/${key}"
    uploaded=$((uploaded + 1))
    continue
  fi

  if aws s3 cp "$file" "s3://${S3_BUCKET}/${key}" --only-show-errors; then
    uploaded=$((uploaded + 1))
  else
    echo "  FAIL  $rel" >&2
    failed=$((failed + 1))
  fi
done < <(find "$UPLOADS_SRC" -type f -print0)

echo ""
echo "Listo. uploaded/planned=$uploaded skipped=$skipped failed=$failed"
[[ "$failed" -eq 0 ]] || exit 1
