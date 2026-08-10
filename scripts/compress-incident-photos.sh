#!/usr/bin/env bash
# Comprime fotos histÃ³ricas de incidencias en el volumen Docker uploads.
# One-shot / mantenimiento. Por defecto: dry-run de las 10 mÃ¡s antiguas.
#
# Uso (en el servidor, desde ~/vc-ingreso):
#   chmod +x scripts/compress-incident-photos.sh
#   ./scripts/compress-incident-photos.sh                 # dry-run, 10 primeras
#   ./scripts/compress-incident-photos.sh --limit 5       # dry-run, 5
#   ./scripts/compress-incident-photos.sh --limit 10 --apply
#   ./scripts/compress-incident-photos.sh --all --apply   # todo el histÃ³rico
#
# No cambia photo_url en BD: sobrescribe el mismo archivo (.jpg/.jpeg).
# El backup de uploads ya corre en cada deploy (scripts/deploy-prod.sh).
# RecomendaciÃ³n: desplegar (con backup) antes de --apply masivo.
set -Eeuo pipefail

LIMIT=10
APPLY=0
ALL=0
MAX_EDGE="${VC_COMPRESS_MAX_EDGE:-1600}"
QUALITY="${VC_COMPRESS_QUALITY:-82}"
# No tocar archivos ya pequeÃ±os (bytes). 400 KiB por defecto.
MIN_BYTES="${VC_COMPRESS_MIN_BYTES:-409600}"
VOLUME_NAME="${VC_UPLOADS_VOLUME:-}"
INCIDENTS_DIR="incidents"

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
    --max-edge)
      MAX_EDGE="${2:?Falta valor de --max-edge}"
      shift 2
      ;;
    --quality)
      QUALITY="${2:?Falta valor de --quality}"
      shift 2
      ;;
    --volume)
      VOLUME_NAME="${2:?Falta valor de --volume}"
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "OpciÃ³n desconocida: $1" >&2
      usage
      ;;
  esac
done

if [[ -z "$VOLUME_NAME" ]]; then
  if docker volume inspect vc-ingreso_uploads_data >/dev/null 2>&1; then
    VOLUME_NAME="vc-ingreso_uploads_data"
  elif docker volume inspect uploads_data >/dev/null 2>&1; then
    VOLUME_NAME="uploads_data"
  else
    echo "No se encontrÃ³ el volumen de uploads. PÃ¡salo con --volume NOMBRE" >&2
    echo "VolÃºmenes disponibles:" >&2
    docker volume ls --format '{{.Name}}' | grep -i upload || true
    exit 1
  fi
fi

if ! docker volume inspect "$VOLUME_NAME" >/dev/null 2>&1; then
  echo "Volumen inexistente: $VOLUME_NAME" >&2
  exit 1
fi

MODE_LABEL="DRY-RUN"
[[ "$APPLY" == "1" ]] && MODE_LABEL="APPLY"

echo "==> Volumen: $VOLUME_NAME"
echo "==> Modo: $MODE_LABEL | max_edge=${MAX_EDGE}px | quality=${QUALITY} | min_bytes=${MIN_BYTES}"
if [[ "$ALL" == "1" ]]; then
  echo "==> Alcance: TODAS las fotos jpg/jpeg"
else
  echo "==> Alcance: primeras ${LIMIT} (mÃ¡s antiguas por nombre)"
fi
echo ""

docker run --rm \
  -e APPLY="$APPLY" \
  -e ALL="$ALL" \
  -e LIMIT="$LIMIT" \
  -e MAX_EDGE="$MAX_EDGE" \
  -e QUALITY="$QUALITY" \
  -e MIN_BYTES="$MIN_BYTES" \
  -e INCIDENTS_DIR="$INCIDENTS_DIR" \
  -v "${VOLUME_NAME}:/data" \
  alpine:3.20 \
  sh -c '
set -eu
apk add --no-cache imagemagick >/dev/null

if command -v magick >/dev/null 2>&1; then
  IM="magick"
elif command -v convert >/dev/null 2>&1; then
  IM="convert"
else
  echo "ImageMagick no disponible en el contenedor" >&2
  exit 1
fi

DIR="/data/${INCIDENTS_DIR}"
if [ ! -d "$DIR" ]; then
  echo "No existe $DIR dentro del volumen" >&2
  exit 1
fi

LIST_FILE=$(mktemp)
find "$DIR" -maxdepth 1 -type f \( -iname "*.jpg" -o -iname "*.jpeg" \) | sort > "$LIST_FILE"
TOTAL=$(wc -l < "$LIST_FILE" | tr -d " ")
echo "Archivos jpg/jpeg encontrados: $TOTAL"

WORK_FILE=$(mktemp)
if [ "$ALL" = "1" ]; then
  cp "$LIST_FILE" "$WORK_FILE"
else
  head -n "$LIMIT" "$LIST_FILE" > "$WORK_FILE"
fi

TMPDIR=$(mktemp -d)
trap "rm -rf \"$TMPDIR\" \"$LIST_FILE\" \"$WORK_FILE\"" EXIT

CHANGED=0
SKIPPED=0
FAILED=0
SAVED=0

while IFS= read -r f; do
  [ -n "$f" ] || continue
  name=$(basename "$f")
  size=$(wc -c < "$f" | tr -d " ")

  if [ "$size" -lt "$MIN_BYTES" ]; then
    echo "[skip]  $name  (${size} bytes < min ${MIN_BYTES})"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  out="$TMPDIR/out.jpg"
  if ! "$IM" "$f" -auto-orient -resize "${MAX_EDGE}x${MAX_EDGE}>" -strip -quality "$QUALITY" "$out" 2>/tmp/im.err; then
    echo "[fail]  $name  ($(cat /tmp/im.err 2>/dev/null || true))"
    FAILED=$((FAILED + 1))
    continue
  fi

  newsize=$(wc -c < "$out" | tr -d " ")
  if [ "$newsize" -ge "$size" ]; then
    echo "[skip]  $name  (${size} â†’ ${newsize}, no mejora)"
    SKIPPED=$((SKIPPED + 1))
    rm -f "$out"
    continue
  fi

  saved=$((size - newsize))
  pct=$(( saved * 100 / size ))

  if [ "$APPLY" = "1" ]; then
    mv "$out" "$f"
    echo "[ok]    $name  ${size} â†’ ${newsize}  (-${pct}%)"
  else
    echo "[dry]   $name  ${size} â†’ ${newsize}  (-${pct}%)"
    rm -f "$out"
  fi
  CHANGED=$((CHANGED + 1))
  SAVED=$((SAVED + saved))
done < "$WORK_FILE"

echo ""
echo "==> Resumen: cambiadas=$CHANGED  omitidas=$SKIPPED  fallidas=$FAILED  ahorroâ‰ˆ${SAVED} bytes"
if [ "$APPLY" != "1" ]; then
  echo "    Dry-run: no se modificÃ³ nada. Para aplicar: aÃ±ade --apply (mismo --limit o --all)."
fi
'

echo ""
echo "Hecho."
