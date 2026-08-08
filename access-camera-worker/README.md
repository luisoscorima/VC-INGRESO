# Worker local de cámara LPR

Este proceso corre en la PC que tiene acceso a la cámara. Lee un stream USB/RTSP, reconoce placas con OpenCV + EasyOCR y envía capturas por HTTPS al sistema. No abre puertos entrantes.

## Preparación

1. Despliegue la migración `database/migrations/009_camera_lpr_access.sql`.
2. En el sistema abra **Cámaras**, cree una cámara vinculada a un punto de acceso y copie la clave emitida.
3. Copie `.env.example` como `.env` y complete `CAMERA_API_KEY` y `CAMERA_SOURCE`.

## Docker

```bash
docker build -t vc-lpr-worker .
docker run --restart unless-stopped --env-file .env \
  --device=/dev/video0:/dev/video0 vc-lpr-worker
```

Para RTSP no se necesita `--device`. En Docker Desktop para Windows, el acceso directo a una webcam puede depender de WSL; para cámaras IP se recomienda RTSP.

## Python sin Docker

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

Las variables se leen del entorno; Python no carga `.env` automáticamente. En PowerShell:

```powershell
$env:API_BASE="https://villa-club5.com"
$env:CAMERA_API_KEY="vclpr_..."
$env:CAMERA_SOURCE="rtsp://usuario:password@ip/stream"
python main.py
```

## Ajuste de reconocimiento

- `CAMERA_ROI`: limita el OCR a la zona donde aparecen las placas y mejora rendimiento.
- `OCR_CONFIDENCE_THRESHOLD`: umbral entre 0 y 1.
- `STABLE_READS`: lecturas consecutivas iguales antes de enviar.
- `LOCAL_DEBOUNCE_SECONDS`: evita reenviar la misma placa desde el worker.
- El servidor aplica un segundo debounce configurado por cámara.

La API guarda todas las lecturas aceptadas por el servidor en `camera_access_events`. Solo las placas autorizadas generan registros en Historial.
