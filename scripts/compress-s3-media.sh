#!/usr/bin/env bash
# Comprime imagenes historicas YA en S3 (misma key; no toca la BD).
# Por defecto: dry-run de las 10 primeras bajo media/incidents/.
#
# Uso (servidor, desde ~/vc-ingreso, con AWS CLI y .env S3):
#   chmod +x scripts/compress-s3-media.sh
#   ./scripts/compress-s3-media.sh --limit 5
#   ./scripts/compress-s3-media.sh --limit 10 --apply
#   ./scripts/compress-s3-media.sh --folder=vehicles --limit 10 --apply
#   ./scripts/compress-s3-media.sh --all --apply
#   ./scripts/compress-s3-media.sh --folder=all --all --apply
#
# Requiere: aws CLI + Docker (Alpine + ImageMagick JPEG).
# Tras --apply, purga cache de Cloudflare/CDN si las URLs siguen grandes.
set -Eeuo pipefail

LIMIT=10
APPLY=0
ALL=0
FOLDER="incidents"
MAX_EDGE="${VC_COMPRESS_MAX_EDGE:-1600}"
QUALITY="${VC_COMPRESS_QUALITY:-82}"
MIN_BYTES="${VC_COMPRESS_MIN_BYTES:-409600}"
PROJECT_DIR="${VC_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"

usage() {
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --limit)
      LIMIT="${2:?Falta valor de --limit}"
      shift 2
      ;;
    --all)
      ALL=1
      shift
      ;;
    --apply)
      APPLY=1
      shift
      ;;
    --folder|--folder=*)
      if [[ "$1" == --folder=* ]]; then
        FOLDER="${1#*=}"
      else
        FOLDER="${2:?Falta valor de --folder}"
        shift
      fi
      shift
      ;;
    --max-edge)
      MAX_EDGE="${2:?Falta valor de --max-edge}"
      shift 2
      ;;
    --quality)
      QUALITY="${2:?Falta valor de --quality}"
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "Opcion desconocida: $1" >&2
      usage
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
AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_DEFAULT_REGION="$AWS_REGION"
export AWS_REGION

if ! command -v aws >/dev/null 2>&1; then
  echo "Error: aws CLI no encontrado." >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker no encontrado (se usa Alpine+ImageMagick)." >&2
  exit 1
fi

case "$FOLDER" in
  incidents|vehicles|pets|profiles|camera-access|announcements|readonly-docs)
    FOLDERS=("$FOLDER")
    ;;
  all)
    FOLDERS=(incidents vehicles pets profiles camera-access announcements)
    ;;
  *)
    echo "Folder invalido: $FOLDER (usa incidents|vehicles|pets|profiles|camera-access|announcements|all)" >&2
    exit 1
    ;;
esac

MODE_LABEL="DRY-RUN"
[[ "$APPLY" == "1" ]] && MODE_LABEL="APPLY"

echo "==> Bucket: s3://${S3_BUCKET}/${S3_KEY_PREFIX}/media/"
echo "==> Folders: ${FOLDERS[*]}"
echo "==> Modo: $MODE_LABEL | max_edge=${MAX_EDGE}px | quality=${QUALITY} | min_bytes=${MIN_BYTES}"
if [[ "$ALL" == "1" ]]; then
  echo "==> Alcance: TODAS las jpg/jpeg elegibles"
else
  echo "==> Alcance: primeras ${LIMIT} por folder (orden de key)"
fi
echo ""

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

CHANGED=0
SKIPPED=0
FAILED=0
SAVED=0

compress_one() {
  local key="$1"
  local size="$2"
  local name
  name=$(basename "$key")
  local in="$WORKDIR/in.jpg"
  local out="$WORKDIR/out.jpg"

  if ! aws s3 cp "s3://${S3_BUCKET}/${key}" "$in" --only-show-errors; then
    echo "[fail]  $name  (download)"
    FAILED=$((FAILED + 1))
    return
  fi

  if ! docker run --rm \
    -v "$WORKDIR:/work" \
    alpine:3.20 \
    sh -c 'apk add --no-cache imagemagick imagemagick-jpeg >/dev/null && \
      if command -v magick >/dev/null 2>&1; then IM=magick; else IM=convert; fi && \
      "$IM" /work/in.jpg -auto-orient -resize "'"${MAX_EDGE}x${MAX_EDGE}>"'" -strip -quality "'"$QUALITY"'" /work/out.jpg'; then
    echo "[fail]  $name  (imagemagick)"
    FAILED=$((FAILED + 1))
    rm -f "$in" "$out"
    return
  fi

  local newsize
  newsize=$(wc -c < "$out" | tr -d ' ')
  if [[ "$newsize" -ge "$size" ]]; then
    echo "[skip]  $name  (${size} -> ${newsize}, no mejora)"
    SKIPPED=$((SKIPPED + 1))
    rm -f "$in" "$out"
    return
  fi

  local saved=$((size - newsize))
  local pct=$((saved * 100 / size))

  if [[ "$APPLY" == "1" ]]; then
    if aws s3 cp "$out" "s3://${S3_BUCKET}/${key}" \
      --content-type image/jpeg \
      --cache-control "public, max-age=86400" \
      --only-show-errors; then
      echo "[ok]    $name  ${size} -> ${newsize}  (-${pct}%)"
      CHANGED=$((CHANGED + 1))
      SAVED=$((SAVED + saved))
    else
      echo "[fail]  $name  (upload)"
      FAILED=$((FAILED + 1))
    fi
  else
    echo "[dry]   $name  ${size} -> ${newsize}  (-${pct}%)"
    CHANGED=$((CHANGED + 1))
    SAVED=$((SAVED + saved))
  fi

  rm -f "$in" "$out"
}

for folder in "${FOLDERS[@]}"; do
  prefix="${S3_KEY_PREFIX}/media/${folder}/"
  echo "--- folder: ${folder}/ ---"

  LIST_FILE="$WORKDIR/list_${folder}.tsv"
  # key<TAB>size — solo jpg/jpeg (ls --recursive pagina solo)
  aws s3 ls "s3://${S3_BUCKET}/${prefix}" --recursive \
    | awk -v pfx="$prefix" '
        {
          size=$3
          key=""
          for (i=4; i<=NF; i++) key = (i==4 ? $i : key " " $i)
          if (key !~ "^" pfx) next
          low=tolower(key)
          if (low ~ /\.jpe?g$/) printf "%s\t%s\n", key, size
        }' \
    | sort \
    > "$LIST_FILE" || true

  TOTAL=$(wc -l < "$LIST_FILE" | tr -d ' ')
  echo "Objetos jpg/jpeg: $TOTAL"

  WORK_LIST="$WORKDIR/work_${folder}.tsv"
  if [[ "$ALL" == "1" ]]; then
    cp "$LIST_FILE" "$WORK_LIST"
  else
    head -n "$LIMIT" "$LIST_FILE" > "$WORK_LIST"
  fi

  while IFS=$'\t' read -r key size; do
    [[ -n "${key:-}" ]] || continue
    size="${size:-0}"
    if [[ "$size" -lt "$MIN_BYTES" ]]; then
      echo "[skip]  $(basename "$key")  (${size} bytes < min ${MIN_BYTES})"
      SKIPPED=$((SKIPPED + 1))
      continue
    fi
    compress_one "$key" "$size"
  done < "$WORK_LIST"

  echo ""
done

echo "==> Resumen: cambiadas/plan=$CHANGED  omitidas=$SKIPPED  fallidas=$FAILED  ahorro~=${SAVED} bytes"
if [[ "$APPLY" != "1" ]]; then
  echo "    Dry-run: no se modifico S3. Para aplicar: anade --apply."
else
  echo "    Si el navegador sigue mostrando el peso viejo, purga cache CDN/Cloudflare o abre ?v=2"
fi
echo "Hecho."
