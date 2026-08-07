# LPR Worker

Servicio Python que lee cámaras IP (HTTP snapshot o RTSP), reconoce placas con RapidOCR y envía detecciones a la API VC-INGRESO.

## Variables

| Variable | Descripción |
|----------|-------------|
| `LPR_SERVICE_TOKEN` | Mismo token que en la API PHP |
| `LPR_API_BASE_URL` | Por defecto `http://api/api/v1` |
| `LPR_REFRESH_CAMERAS_SEC` | Recarga de cámaras (default 30) |
| `LPR_LOG_LEVEL` | `INFO` / `DEBUG` |

## Arranque (dev)

```bash
docker compose -f docker-compose.dev.yml up -d --build lpr-worker
```

Las cámaras se configuran en la UI **Admin → Cámaras LPR**.
