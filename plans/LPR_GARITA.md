# Plan: LPR en garita (cámara fija IP)

## Decisiones de producto

| # | Decisión | Elección |
|---|----------|----------|
| 1 | Origen de imagen | Cámara IP (RTSP y/o snapshot HTTP) leída por un servicio en servidor |
| 2 | Acción al leer placa | Auto-registrar ingreso si está autorizada; alertar si no |
| 3 | Push / PR | No (por instrucción explícita) |

## Stack tecnológica elegida

### Captura y OCR (nuevo servicio)

- **Lenguaje:** Python 3.11
- **Contenedor Docker:** servicio `lpr-worker` en `docker-compose.*.yml`
- **Captura de frames:**
  - **OpenCV** (`opencv-python-headless`) para RTSP
  - **HTTP snapshot** (URL de foto de la cámara) como alternativa más estable en muchas IP cams
- **OCR / detección de placa:**
  - Motor principal: **RapidOCR** (`rapidocr-onnxruntime`) — ONNX, sin GPU, tamaño razonable en Docker
  - Filtro post-OCR de placas peruanas (normalización A–Z/0–9, misma regla que `normalize_license_plate`)
  - Confianza mínima configurable por cámara
- **Orquestación del worker:** bucle periódico (p. ej. 1–2 fps efectivos), debounce por placa+cámara, reintentos de stream

### Backend (existente + extensión)

- **PHP 8.2** (API actual en `server/`)
- **MySQL 8** — tablas nuevas:
  - `lpr_cameras` (stream/snapshot, `access_point_id`, dirección INGRESO/EGRESO, umbrales, enabled)
  - `lpr_events` (placa, confianza, resultado, snapshot, vínculo a `access_logs` / `temporary_access_logs`)
- **Auth del worker:** token de servicio `LPR_SERVICE_TOKEN` (Bearer), no JWT de usuario
- **Reutilización de negocio:**
  - Misma resolución de placa que `POST /api/v1/access-qr/scan` (vehículo residente / visita externa)
  - Si `allow_entry`: crear log como hoy (`access-logs` o `access-logs/temporary`)
  - Si denegado / multi-casa pendiente: solo `lpr_events` + alerta (sin registro automático)
  - Observación de auditoría: origen `LPR`

### Frontend (existente + extensión)

- **Angular 18** + Material/Tailwind (mismo patrón de `access-points` / escáner)
- Módulo admin **Cámaras LPR** (CRUD de cámaras ligadas a punto de acceso)
- Vista operativa en garita: **últimos eventos LPR** + alerta visual/toastr en denegados (poll corto)

### Infra

- Docker Compose incluye `lpr-worker` para **dev / mismo host** (pruebas).
- **Producción recomendada: enfoque híbrido (edge)** — ver sección siguiente.
- Variables: `LPR_SERVICE_TOKEN`, `LPR_API_BASE_URL`, opcionales de intervalo/confianza
- Snapshots (JPEG opcional) bajo `server/uploads/public/lpr/` en el servidor API

## Despliegue híbrido (recomendado en garita real)

Sí: es el modelo profesional previsto. El código ya lo permite porque el worker es un contenedor independiente.

```mermaid
flowchart LR
  subgraph localLan [Red_local_estacionamiento]
    cam[Camara_o_DVR_RTSP]
    worker[lpr-worker_edge]
    cam -->|RTSP_o_snapshot_LAN| worker
  end
  subgraph aws [EC2_nube]
    api[API_PHP_HTTPS]
    db[(MySQL)]
    ui[Angular]
    api --> db
    ui --> api
  end
  worker -->|"POST JSON + token HTTPS"| api
```

**Cómo funciona**

1. `lpr-worker` corre en un mini-PC / PC de garita / host local en la **misma LAN** que cámara o DVR.
2. Consume RTSP/snapshot **solo en red local** (sin publicar el DVR a internet).
3. Envía a la nube únicamente `POST https://tu-sistema.com/api/v1/lpr/events` (placa, confianza, JPEG opcional) con `LPR_SERVICE_TOKEN`.
4. En el edge: `LPR_API_BASE_URL=https://tu-sistema.com/api/v1` (mismo token que en el `.env` de la API EC2).
5. En Compose de EC2 **no es obligatorio** levantar `lpr-worker` si ya corre en la garita.

**Ventajas (las que mencionan):** cero port-forward del DVR, poco ancho de banda, video no sale a internet.

**Matices a tener en cuenta**

- Las URLs de cámara en Admin LPR deben ser **IPs/hostnames LAN** visibles para el worker edge (p. ej. `rtsp://192.168.1.10/...`), no para EC2.
- El snapshot JPEG opcional **sí sale** a la API (pocos KB–cientos de KB); el video continuo no. Si se quiere máxima privacidad, se puede desactivar el envío de imagen más adelante.
- Hardware edge: preferible **mini-PC x86** con 8 GB RAM. Raspberry Pi 5 puede ir justa con RapidOCR; hay que probar FPS reales.
- El token LPR debe ser secreto fuerte y solo en edge + API (rotar si se filtra).

## Flujo lógico (negocio)

```mermaid
flowchart LR
  cam[CamaraIP_RTSP_o_HTTP] --> worker[lpr-worker_Python]
  worker -->|frame_OCR| plate[Placa_normalizada]
  plate -->|POST_lpr_events_token| api[API_PHP]
  api --> resolve[Resolver_vehiculo_o_visita]
  resolve -->|autorizado| log[access_logs_auto]
  resolve -->|denegado_o_ambigua| alert[lpr_events_alerta]
  log --> ui[UI_garita_eventos]
  alert --> ui
```

## Alcance V1 (incluido)

1. Migración `009_lpr_cameras.sql` + permisos de nav
2. `LprController` + rutas `/api/v1/lpr/*`
3. Worker Python + Dockerfile + compose
4. UI admin cámaras + panel eventos/alertas
5. Debounce servidor + worker; snapshots; auto-INGRESO/EGRESO según cámara
6. Visita externa con una sola casa → auto; multi-casa → alerta sin auto-registro

## Fuera de V1

- Apertura de barrera/relé (opción C)
- OCR en navegador / webcam de portería
- APIs cloud de placas de pago (Plate Recognizer, etc.)
- Entrenamiento de modelo propio

## Archivos principales a tocar

- `database/migrations/009_lpr_cameras.sql`
- `server/controllers/LprController.php`, `server/index.php`, `server/auth_middleware.php`
- `lpr-worker/` (nuevo: `Dockerfile`, `requirements.txt`, `main.py`)
- `docker-compose.dev.yml` (+ stage/prod si aplica)
- `.env.example`
- `src/app/lpr/` (nuevo), `nav-modules.config.ts`, `app-routing.module.ts`, `app.module.ts`

## Criterio de listo

- Con cámara configurada (RTSP o snapshot), una placa autorizada genera `access_logs` sin intervención del guardia
- Placa no autorizada aparece como evento denegado en UI de garita
- No se hace push ni PR en esta fase

## Estado de implementación

- [x] Migración `009_lpr_cameras.sql`
- [x] Auth `requireLprServiceAuth` + `LprController` + rutas
- [x] `AccessQrController::resolveLicensePlate` reutilizado por LPR
- [x] Worker Python (`lpr-worker/`) con RapidOCR + Compose (dev/stage/prod)
- [x] UI Angular `/lpr` (eventos + CRUD cámaras)
- [ ] Probar con cámara IP real (URL pendiente del cliente)
- [ ] Push / PR (explícitamente fuera de alcance por ahora)

### Cómo activar en un entorno

1. Definir `LPR_SERVICE_TOKEN` en `.env` (mismo valor para API y worker).
2. Aplicar migración:  
   `docker exec -i vc-ingreso-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" vc_db' < database/migrations/009_lpr_cameras.sql`
3. `docker compose -f docker-compose.dev.yml up -d --build lpr-worker`
4. En la UI (Admin → Cámaras LPR), crear cámara con `snapshot_url` y/o `stream_url` ligada a Garita Principal.

## Recomendaciones de cámara a adquirir (garita fija)

El software ya acepta **snapshot HTTP** (preferido) y/o **RTSP**. No hace falta cámara “con LPR embebido”, pero sí buena óptica y red local estable.

### Requisitos mínimos (checklist de compra)

- IP PoE (o 12 V + Ethernet); **evitar solo Wi‑Fi** en garita
- **RTSP** documentado (ONVIF Profile S ayuda)
- Resolución **1080p** mínimo; ideal **2–4 MP**
- Exterior IP66 + IR / buen nocturno (placas reflectivas)
- Varifocal o lente adecuada a la distancia real de lectura (típicamente **3–8 m** al frente del vehículo)
- Acceso a **snapshot JPEG por HTTP** (muchas Hikvision/Dahua lo traen) — el worker lo prioriza sobre RTSP

### Rangos sugeridos

| Uso | Tipo | Ejemplos orientativos (verificar stock local PE) |
|-----|------|---------------------------------------------------|
| Buena relación costo/beneficio | Bullet/dome IP 2–4 MP PoE, IR, varifocal | Hikvision / Dahua / Uniview serie “Pro” o “Easy” 2–4 MP con RTSP |
| Mejor lectura de placa | Cámara **LPR / ANPR** o “capture” con obturador global / WDR fuerte | Hikvision LPR / Dahua ANPR / equivalentes de captura de acceso |
| Presupuesto ajustado | 1080p PoE fija con buen IR y RTSP | Marca conocida con firmware estable; probar snapshot HTTP |

### Qué evitar

- Cámaras de consumo sin RTSP (solo app cloud)
- Solo Wi‑Fi en poste de garita (cortes y latencia)
- Lente muy angular a distancia corta (placa sale chica o distorsionada)
- Confiar solo en “IA en la cámara” si no se puede integrar por RTSP/HTTP con nuestro worker

### Instalación recomendada (cuando llegue)

1. Fija, mirando la zona donde el auto **se detiene** (no en movimiento a 40 km/h).
2. Altura ~1.2–2.0 m, ángulo casi frontal a la placa.
3. Cable Ethernet PoE al switch del cuarto técnico / NVR.
4. Anotar: IP estática, usuario/clave, URL snapshot y RTSP.
5. Cargar esas URLs en **Admin → Cámaras LPR** (punto de acceso Garita, dirección INGRESO).
