# LPR Worker

Servicio Python que lee cámaras IP (HTTP snapshot o RTSP), reconoce placas con RapidOCR y envía detecciones a la API VC-INGRESO.

## Despliegue híbrido (recomendado en producción)

Corre este contenedor en la **red local de la garita** (misma LAN que cámara/DVR). El video no sale a internet; solo se envía un POST HTTPS con la placa a la API en EC2.

```bash
# En el mini-PC / host de garita
export LPR_SERVICE_TOKEN='el_mismo_secreto_que_en_EC2'
export LPR_API_BASE_URL='https://tu-sistema.com/api/v1'

docker build -t vc-lpr-worker .
docker run -d --name vc-ingreso-lpr-worker --restart unless-stopped \
  -e LPR_SERVICE_TOKEN \
  -e LPR_API_BASE_URL \
  -e LPR_LOG_LEVEL=INFO \
  vc-lpr-worker
```

En ese modo **no** hace falta el servicio `lpr-worker` del Compose de EC2.

## Variables

| Variable | Descripción |
|----------|-------------|
| `LPR_SERVICE_TOKEN` | Mismo token que en la API PHP |
| `LPR_API_BASE_URL` | Dev: `http://api/api/v1` · Edge: `https://tu-dominio/api/v1` |
| `LPR_REFRESH_CAMERAS_SEC` | Recarga de cámaras (default 30) |
| `LPR_LOG_LEVEL` | `INFO` / `DEBUG` |

## Arranque (dev, mismo Compose que la API)

```bash
docker compose -f docker-compose.dev.yml up -d --build lpr-worker
```

Las cámaras se configuran en la UI **Admin → Cámaras LPR** (URLs LAN si el worker está en la garita).
