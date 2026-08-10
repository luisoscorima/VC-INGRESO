#!/usr/bin/env bash
# LEGACY: comprimía fotos en el volumen Docker uploads local.
# El media ya vive en S3. Este script reenvía a compress-s3-media.sh.
#
# Uso recomendado:
#   ./scripts/compress-s3-media.sh --limit 10
#   ./scripts/compress-s3-media.sh --folder=incidents --all --apply
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "AVISO: compress-incident-photos.sh es legacy (volumen local)." >&2
echo "       Reenviando a compress-s3-media.sh (folder=incidents)." >&2

# Mapear flags conocidos; --volume se ignora.
ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --volume)
      shift 2
      ;;
    --volume=*)
      shift
      ;;
    *)
      ARGS+=("$1")
      shift
      ;;
  esac
done

exec "$SCRIPT_DIR/compress-s3-media.sh" --folder=incidents "${ARGS[@]}"
