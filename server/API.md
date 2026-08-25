# API REST v1 — VC-INGRESO

Documentación alineada al enrutado en [`index.php`](index.php). Base URL: **`/api/v1/`**.

- **Entrada:** `server/index.php` + `server/db_connection.php`.
- **Formato:** JSON (`Content-Type: application/json`), salvo subidas `multipart/form-data`.
- **CORS:** `Access-Control-Allow-Origin: *`; métodos `GET, POST, PUT, DELETE, OPTIONS`.
- **Autenticación:** cabecera `Authorization: Bearer <JWT>` en rutas que invocan `requireAuth()` en los controladores (la mayoría salvo `auth/login`, `public/*` y la respuesta 404 documentada).

`requireAuth()` acepta opcionalmente validación CSRF vía cabecera `X-CSRF-Token` cuando el controlador use `requireAuth(true)` (ver `auth_middleware.php`).

---

## Política de roles (`role_system` × `person_type`)

Las reglas de negocio se aplican en PHP (`server/helpers/role_policy.php`, `house_permissions.php`, controladores) y en el front (guards, `AuthService`). Esta sección resume el **contrato funcional**; el detalle de pantallas está en [`../README.md`](../README.md) (matriz completa).

### Valores

- **`role_system`:** `ADMINISTRADOR`, `OPERARIO`, `USUARIO`.
- **`person_type`** (persona vinculada al usuario): `PROPIETARIO`, `RESIDENTE`, `INQUILINO`, `INVITADO`, `NULL`.

`INVITADO` es tipo de persona en padrón **sin fila en `users`** (no inicia sesión). `NULL` = sin tipo en BD (p. ej. portería sin ficha vecinal).

### Combinaciones válidas en login y negocio

Solo tres familias; **todo lo demás se rechaza** (no es caso de uso):

| | role_system | person_type permitidos |
|---|----------------|-------------------------|
| **1 + 2** | `ADMINISTRADOR` | `PROPIETARIO`, `RESIDENTE`, `NULL` |
| **3 + 4** | `OPERARIO` | `PROPIETARIO`, `RESIDENTE`, `INQUILINO`, `NULL` |
| **5 + 6** | `USUARIO` | `PROPIETARIO`, `RESIDENTE`, `INQUILINO` |

**Restricciones transversales**

- **ADMINISTRADOR + INQUILINO:** no permitido.
- **OPERARIO + NULL** y **ADMINISTRADOR + NULL:** sin contexto vecinal — no generan **QR de hogar** ni entran a **Mi casa**; sí pueden usar endpoints de **staff** (escáner, listados globales donde la política lo indique).
- Listados **staff** (historial, cumpleaños, usuarios, viviendas, vehículos, mascotas): suelen exigir `isStaffRole` en el token; el alcance (global vs casa) depende del controlador.

### Resumen por ámbito (API / producto)

| Ámbito | Notas para implementadores |
|--------|----------------------------|
| **Escáner / manual doc-placa** | Staff: `ADMINISTRADOR` (person: PROP/RES/NULL), `OPERARIO` (PROP/RES/INQ/NULL). |
| **Generar QR de ingreso (hogar)** | Requiere `person_id` y casa asociada. **ADMIN/OPERARIO/USUARIO** con **PROPIETARIO/RESIDENTE**; **USUARIO/OPERARIO** con **INQUILINO**. No aplica a **ADMIN/OPER + NULL**. |
| **Dashboard** | Staff: admin + operario (combinaciones arriba). Vecino: solo `USUARIO` + PROP/RES/INQ con casa. |
| **Historial / cumpleaños** | Staff ve global; vecino solo su casa; UI vecino **sin** documento en columnas sensibles. |
| **Mi casa** | Requiere contexto de hogar; jerarquía PROP > RES > INQ para crear/editar y QR (ver README). |
| **Reservaciones** | Calendario admin: `ADMINISTRADOR`. Vecino: `USUARIO`/`OPERARIO` + PROP/RES/INQ con casa. **OPERARIO + NULL** excluido de ambos flujos. |
| **Users / persons** | CRUD cuentas: típicamente solo **ADMINISTRADOR**. Listado `persons?without_user=1`: staff (`isStaffRole`). Operario: lectura sin datos de documento en UI según README. |
| **Houses** | CRUD: admin. Listado: también operario (lectura). |
| **Vehicles / pets (módulos gestión)** | Listado/CRUD según matriz `nav_modules`: `vehicles` y `pets`. Por defecto OPERARIO no tiene `vehicles`; sí tiene `external_visits` (ver+gestionar). |
| **Access points** | Solo **ADMINISTRADOR** + combinación admin válida. |
| **Configuración** | Todas las combinaciones válidas; permisos finos por pantalla. |

### Documentación ampliada

- Matriz detallada (pestañas Mi casa, reservas, cancelaciones, etc.): [`../README.md`](../README.md).
- Esquema y flujos BD: [`../plans/REFERENCIA_TECNICA.md`](../plans/REFERENCIA_TECNICA.md).

---

## Archivos estáticos (no son `/api/v1`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/uploads/...` | 302 a la URL pública S3 del objeto (paths lógicos en BD). |

---

## Auth (sin token)

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/v1/auth/login` | Body JSON: `username_system`, `password_system`. Respuesta: `user`, `person`, `my_houses`, `token` (JWT). TTL del token configurable con `JWT_AUTH_TTL_SECONDS` (por defecto 30 días). Errores 400/401. |

---

## Registro público (sin token)

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/v1/public/register` | Alta de vivienda + propietarios (`persons`) + vehículos + mascotas. Ver cuerpo más abajo. |
| GET | `/api/v1/public/houses` | Casas **sin** propietario (`person_type = PROPIETARIO`) — desplegables de registro. |
| GET | `/api/v1/public/check-doc?doc_number=` | `registered: true|false` si el documento ya existe en `persons`. Siempre 200. |
| POST | `/api/v1/public/upload/vehicle-photo` | `multipart/form-data`, campo **`photo`**. Máx. 5 MB; JPG, PNG, GIF. |
| POST | `/api/v1/public/upload/pet-photo` | Igual que vehículo. |

### Body `POST /public/register` (ejemplo)

```json
{
  "house": {
    "house_type": "CASA",
    "block_house": "A",
    "lot": 101,
    "apartment": null
  },
  "owners": [
    {
      "doc_number": "12345678",
      "first_name": "Juan",
      "paternal_surname": "Pérez",
      "maternal_surname": "García",
      "cel_number": "987654321",
      "email": "juan@email.com",
      "type_doc": "DNI"
    }
  ],
  "vehicles": [
    {
      "license_plate": "ABC-123",
      "type_vehicle": "AUTO",
      "brand": "Toyota",
      "color": "Blanco",
      "photo_url": null
    }
  ],
  "pets": [
    {
      "species": "PERRO",
      "name": "Max",
      "breed": "Labrador",
      "color": "Negro",
      "age_years": 3,
      "photo_url": null
    }
  ]
}
```

- **house:** obligatorio. `house_type`: CASA | DEPARTAMENTO | LOCAL COMERCIAL | OTRO. `block_house`, `lot` obligatorios; `apartment` opcional.
- **owners:** al menos uno. Obligatorios: `doc_number`, `first_name`, `paternal_surname`. Opcionales: `maternal_surname`, `cel_number`, `email`, `type_doc` (default DNI). No repetir `doc_number` en el array.
- **vehicles / pets:** opcionales; para `photo_url` subir antes con los endpoints públicos de upload.

**Respuesta 201:** típicamente `{ "success": true, "data": { "house_id", "person_ids", "vehicle_ids", "pet_ids", ... } }`.

**RENIEC:** la consulta por DNI es **solo en el frontend** (p. ej. `GET https://my.apidev.pro/api/dni/{dni}`). El backend solo recibe datos ya completos.

---

## Users (requiere token salvo donde se indique)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/v1/users` | Listar usuarios. |
| GET | `/api/v1/users/:id` | Usuario por `user_id`. |
| POST | `/api/v1/users` | Crear usuario (JSON). |
| PUT | `/api/v1/users/:id` | Actualizar usuario. |
| DELETE | `/api/v1/users/:id` | **No permitido** — responde **403** (conservación de registros). |
| POST | `/api/v1/users/me/photo` | Subir foto de perfil (`multipart/form-data`, campo **`photo`**). |
| PUT | `/api/v1/users/me/person` | Actualizar datos de la persona vinculada al usuario autenticado. |
| PUT | `/api/v1/users/me/password` | Cambiar contraseña del usuario autenticado. |
| GET | `/api/v1/users/check-username?username=` | (o `?q=`) Comprueba si el nombre de usuario está libre. Respuesta incluye `available`. |
| POST | `/api/v1/users/from-person` | Crear usuario desde persona existente. Body: `person_id`, `username_system`, `password_system`, `role_system`, opcional `force_password_change`. Reglas de rol y permisos en `UserController::createFromPerson`. |
| GET | `/api/v1/users/by-doc-number?doc_number=` | Buscar por documento (join con `persons`). |
| GET | `/api/v1/users/by-birthday?fecha_cumple=MM-DD` | Cumpleaños del día (incluye datos de casa cuando aplica). |

---

## Houses

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/v1/houses` | Listar. |
| GET | `/api/v1/houses/:id` | Una casa. |
| GET | `/api/v1/houses/:id/members` | Miembros (`house_members` + datos de persona). |
| POST | `/api/v1/houses` | Crear. |
| PUT | `/api/v1/houses/:id` | Actualizar. |
| DELETE | `/api/v1/houses/:id` | Eliminar. |

---

## Vehicles

Módulo nav `vehicles`. Listado global staff: permiso **Ver**. Crear/editar/eliminar: **Gestionar**.

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/v1/vehicles` | Listar (staff con `vehicles.view`). |
| GET | `/api/v1/vehicles/:id` | Uno. |
| GET | `/api/v1/vehicles/by-house?house_id=` | Por casa. |
| POST | `/api/v1/vehicles` | Crear (`vehicles.manage` si staff). |
| PUT | `/api/v1/vehicles/:id` | Actualizar (`vehicles.manage` si staff). |
| DELETE | `/api/v1/vehicles/:id` | Eliminar (`vehicles.manage` si staff). |

---

## Persons

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/v1/persons` | Listar (filtros vía query según `PersonController::index`). |
| GET | `/api/v1/persons/:id` | Una persona. |
| POST | `/api/v1/persons` | Crear. |
| PUT | `/api/v1/persons/:id` | Actualizar. |
| DELETE | `/api/v1/persons/:id` | Eliminar. |
| GET | `/api/v1/persons/by-doc-number?doc_number=` | Por documento. |
| GET | `/api/v1/persons/destacados` | Listado destacados. |
| GET | `/api/v1/persons/list-by-birthday` | Cumpleaños (también puede usarse `GET /api/v1/persons?fecha_cumple=...` según enrutado). |
| GET | `/api/v1/persons/observed` | Estado OBSERVADO. |
| GET | `/api/v1/persons/restricted` | Estado DENEGADO. |
| PUT | `/api/v1/persons/:id/validate` | Cambiar validación (`status_validated`, `status_reason`). |

> **Nota (enrutado):** las rutas como `persons/by-doc-number`, `persons/observed`, etc. están definidas **después** del bloque que hace `preg_match('#^persons(?:/(\d+))?#')` sin ancla `$`. Ese patrón coincide con el prefijo `persons` de cualquier path que empiece así, por lo que el bloque puede ejecutarse y hacer `exit` antes de llegar a las rutas específicas. Si alguna de esas URLs no funciona en tu entorno, hay que reordenar o restringir el regex (p. ej. exigir fin de cadena o solo dígitos en el segmento opcional) para que las rutas con nombre se resuelvan primero.

---

## Visitas externas (`temporary_visits` + `temporary_visit_assignments`)

Padrón global reutilizable (placa **o** documento; al menos uno) + asignaciones por casa con temporizador.

Módulo nav `external_visits` (separado de `vehicles`). Catálogo global staff: **Ver**. Crear/editar/eliminar padrón: **Gestionar**. Flujos de vecino (`active`/`mine` + casa) no usan esa matriz.

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/v1/external-visits` | Staff con `external_visits.view`: padrón global; cada perfil incluye `assignments[]` (convocatorias vigentes y recientes: casa, timer, quién registró). Vecino: usar query `house_id` + `active=1`. |
| GET | `/api/v1/external-visits?house_id=X&active=1` | Asignaciones vigentes en Mi casa (JOIN perfil + timer). |
| GET | `/api/v1/external-visits/lookup?plate=&doc=` | Autocompletar perfil global (coincidencia placa o DNI). |
| GET | `/api/v1/external-visits/:id` | Un perfil global (`external_visits.view` o asignación de la casa). |
| POST | `/api/v1/external-visits` | Lookup-or-create perfil. Requiere **placa o documento** (al menos uno) + nombre. **Staff** (`external_visits.manage`): sin `house_id` → solo padrón; con `house_id` + `duration_minutes` (30\|60\|120\|240) → también crea asignación ACTIVA. **Vecino:** casa accesible (body/`auth`/inferida) + duración → perfil + asignación. |
| PUT | `/api/v1/external-visits/:id` | Actualizar perfil. Staff con manage puede `photo_url`, `operator_notes`. |
| DELETE | `/api/v1/external-visits/:id` | Staff con manage: elimina perfil. Vecino: `?assignment_id=` cancela asignación activa. |

Cada ítem de `assignments[]` en el GET global incluye: `assignment_id`, `house_id`, `house_label`, `valid_from`, `valid_until`, `status`, `registered_by_user_id`, `registered_by_label`, `minutes_remaining`, `is_active`.

### Escaneo portería

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/v1/access-qr/scan` | Busca perfil + asignaciones vigentes. Multi-casa → `pending_house_selection: true`. |
| POST | `/api/v1/access-qr/scan-confirm` | Body: `temp_visit_id`, `assignment_id` — confirma casa destino. |
| POST | `/api/v1/access-logs/temporary` | Registra **entrada** en `temporary_access_logs` (staff). Body: `access_point_id`, `temp_visit_id`, `house_id?`, `assignment_id?`, `status_validated?`, `operator_notes?`. Requiere asignación vigente; rechaza 409 si hay sesión abierta. Persiste `assignment_id`, `assignment_valid_until`, `authorized_duration_minutes`, `stay_deadline`. |
| POST | `/api/v1/access-logs/temporary/denied` | Registra **intento denegado** de visita externa (auditoría, sin sesión abierta). Body: `access_point_id`, `temp_visit_id`, snapshots opcionales, `operator_notes?`. Inserta fila con `status_validated=DENEGADO` y `temp_exit_time = temp_entry_time`. |
| POST | `/api/v1/access-logs/temporary/exit` | Registra **salida** (cierra sesión abierta). Body: `access_point_id`, `temp_visit_id`, `house_id?`. Respuesta: `permanence_minutes`, `stay_exceeded`. 422 si no hay entrada abierta. |

---

## Pets

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/v1/pets` | Listar (query: `house_id`, `owner_id`, `status`, `species`, etc.). |
| GET | `/api/v1/pets/:id` | Una mascota. |
| GET | `/api/v1/pets/person/:person_id` | Por propietario (`person_id`). |
| POST | `/api/v1/pets` | Crear. |
| PUT | `/api/v1/pets/:id` | Actualizar. |
| PUT | `/api/v1/pets/:id/validate` | Cambiar estado de validación. |
| POST | `/api/v1/pets/:id/photo` | Subir foto (`multipart/form-data`, campo **`photo`**). |
| DELETE | `/api/v1/pets/:id` | Eliminar. |

---

## Access logs

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/v1/access-logs` | Listar (filtros en query: `access_point_id`, `person_id`, `type`, fechas, `page`, `limit`, etc.). |
| GET | `/api/v1/access-logs/:id` | Un registro. |
| POST | `/api/v1/access-logs` | Crear ingreso (`type: INGRESO`) o cerrar sesión (`type: EGRESO`: actualiza el último ingreso abierto del mismo punto + persona/vehículo/doc/placa; responde `closed`, `permanence_minutes`). Si no hay ingreso abierto, crea un **EGRESO observado** (`orphan_exit: true`, HTTP 201) en lugar de 422. Body opcional: `operator_notes` (texto libre del operario, separado de `observation` automática). Rechaza 409 si hay INGRESO duplicado reciente (misma identidad + punto, ~8 s). |
| PATCH | `/api/v1/access-logs/details/:logRef` | Completar detalles post-scan (staff), cuerpo JSON. |
| POST | `/api/v1/access-logs/details/:logRef` | Igual con `multipart/form-data` (nota, decisión, casa, `photos[]` máx. 5). Preferido cuando hay fotos. |
| POST | `/api/v1/access-logs/authorize-from-attempt` | Ingreso PERMITIDO en un clic tras autorización del propietario. Body: `{ "log_ref": ±id, "house_id"? }`. Requiere intento DENEGADO con `operator_decision=AUTORIZADO_POR_PROPIETARIO`. Override de asignación externa si la autorización venció. |
| GET | `/api/v1/access-logs/access-points` | Puntos de acceso activos por defecto (escáner, dashboard). Query `include_inactive=1` para historial. |
| GET | `/api/v1/access-logs/history-by-date` | Por fecha y `access_point` (unificado: `access_logs` + `temporary_access_logs`). |
| GET | `/api/v1/access-logs/history-by-range` | Por rango (`fecha_inicial`, `fecha_final`, `access_point` opcional; unificado). |
| GET | `/api/v1/access-logs/history-by-client` | Por fecha, `access_point` y `doc` (documento o placa en externas). |

`GET /api/v1/access-logs/history-by-range` incluye por fila (staff con permiso **Ver** en módulo `incidents`): `incident_count`, `incident_preview_description`, `incident_preview_photo_url`. Todas las filas incluyen `same_day_count` (movimientos del mismo documento/placa ese día; respeta filtro `access_point` si se envía).

Columnas unificadas de historial (además de las ya existentes): `log_source` (`REGISTRY` \| `EXTERNAL`), `entry_source` (`manual` \| `qr` \| `camera`), `access_photo_url`, `movement_type`, `house_id`, `temp_visit_id` (solo EXTERNAL), `operator_notes`, `operator_decision`, `assignment_valid_until`, `authorized_duration_minutes`, `stay_deadline`, `permanence_minutes`, `stay_exceeded`, `session_open`, `same_day_count`.

**`operator_decision`** (decisión humana, independiente del scan): `CONSULTADO_PROPIETARIO`, `AUTORIZADO_POR_PROPIETARIO`, `RECHAZO_CONFIRMADO`, `SIN_DOMICILIO`.

**Convención de salidas:** residentes cierran sesión actualizando la fila INGRESO o crean fila `EGRESO`; visitas externas registran salida en la misma fila (`date_exit` / `temp_exit_time`) manteniendo `movement_type=INGRESO`.

---

## Access incidents (incidencias de garita)

- **Ver** listado/detalle: staff con permiso **Ver** en módulo `incidents`.
- **Registrar** incidencia: staff con permiso **Gestionar** (`incidents.manage`).
- Alta solo con `source=scan`, ligada a un acceso (`access_log_id`, `temp_access_log_id` o snapshot DNI/placa). El modo `manual` libre está deshabilitado.
- UI: escáner post-registro e **Historial** (botón «Reportar» sobre fila existente).

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/v1/access-incidents` | Listar. Query: `fecha_inicial`, `fecha_final`, `access_point_id?`, `source?` (`scan` o `manual` solo para registros históricos). |
| GET | `/api/v1/access-incidents/:id` | Detalle con `access_context` si hay log asociado. |
| GET | `/api/v1/access-incidents/by-log/:logRef` | Incidencias de un registro (`id>0` → `access_logs`, `id<0` → `temporary_access_logs`). |
| POST | `/api/v1/access-incidents` | Crear (`multipart/form-data`). Campos: `description` (req), `access_point_id` (req), `source=scan` (req), `photos[]?`. Requiere `access_log_id` o `temp_access_log_id` (debe coincidir con `access_point_id`) o identidad snapshot. |

---

## Cámaras LPR

Las lecturas LPR se guardan en `camera_access_events` y nunca en `access_incidents`. Solo una lectura autorizada crea un ingreso en `access_logs` o `temporary_access_logs`.

| Método | Ruta | Autenticación / descripción |
|--------|------|-----------------------------|
| GET | `/api/v1/access-cameras` | JWT y permiso `cameras.view`. Lista dispositivos sin exponer la clave. |
| POST | `/api/v1/access-cameras` | JWT y `cameras.manage`. Crea cámara y devuelve `api_key` una sola vez. |
| PUT | `/api/v1/access-cameras/:id` | JWT y `cameras.manage`. Actualiza punto, estado y debounce. |
| POST | `/api/v1/access-cameras/:id/rotate-key` | JWT y `cameras.manage`. Invalida la clave anterior y devuelve la nueva una vez. |
| GET | `/api/v1/camera-access/events` | JWT y `cameras.view`. Filtros: fecha, cámara, punto, placa, resultado y paginación. |
| POST | `/api/v1/camera-access/ingest` | `X-Camera-Key` o Bearer de cámara. Multipart: `license_plate`, `confidence?`, `captured_at?`, `photo?`. |

---

## Access QR (ingreso por JWT / lectura en portería)

Autenticación con token.

- **Validar / escanear / entrada manual (documento o placa):** solo **staff** — `ADMINISTRADOR` o `OPERARIO` (con `person_type` según combinaciones válidas: admin PROP/RES/NULL; operario PROP/RES/INQ/NULL).

- **Generar “Mi código QR” de hogar:** requiere `person_id`, combinación **válida** y **contexto de casa** (`house_id` o membresías en `house_members`, según `canGenerateAccessQr` en `house_permissions.php`). Pueden generar:
  - **ADMINISTRADOR**, **OPERARIO** o **USUARIO** con **PROPIETARIO** o **RESIDENTE**;
  - **USUARIO** u **OPERARIO** con **INQUILINO**.
  - **No** generan QR de hogar: **ADMINISTRADOR + NULL** ni **OPERARIO + NULL** (sin vecindad).

- **INVITADO** no tiene login; no genera QR desde la app.

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/v1/access-qr/generate` | Body JSON: `kind`: `person` \| `vehicle`; `person_id` o `vehicle_id`. Respuesta `data`: `token`, `expires_at`, metadatos. TTL del JWT ~90 días. |
| POST | `/api/v1/access-qr/validate` | Body: `{ "token": "<JWT del QR>" }`. Respuesta unificada: persona o vehículo, `status_validated`, `allow_entry`, `is_birthday`, etc. |
| POST | `/api/v1/access-qr/scan` | Body: `{ "input": "<texto leído>" }`. Si `input` es un JWT (tres segmentos), equivale a validar QR; si no, trata como DNI (solo dígitos, longitud ≥ 8) o placa. |

Payload del JWT (referencia): `typ: vc_access_qr`, `k`: `person` \| `vehicle`, más `doc`/`pid`/`hid` o `plate`/`vid`/`hid`. El secreto es `JWT_SECRET` (ver `server/token.php`).

---

## Catalog

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/v1/catalog/dashboard-summary` | Conteos globales (usuarios, casas, vehículos, mascotas). |
| GET | `/api/v1/catalog/areas` | Lista de puntos de acceso (`access_points`). |
| POST | `/api/v1/catalog/access-points` | Crear punto de acceso (admin). |
| PUT | `/api/v1/catalog/access-points/:id` | Actualizar punto de acceso (admin). |

---

## Reservations

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/v1/reservations` | Listar (vecinos: solo casas a las que tienen acceso; admin: todas). Con `start_date` y `end_date` (YYYY-MM-DD) devuelve reservas que **intersectan** ese rango calendario. |
| GET | `/api/v1/reservations/calendar` | Vista calendario comunitaria: todas las reservas que intersectan `start_date`–`end_date`. Para filas de **otras** casas el JSON es **mínimo** (`id`, `access_point_id`, `area_name`, `area_type`, `reservation_date`, `end_date`, `status`, `house_label`), sin observación ni teléfono. |
| GET | `/api/v1/reservations/holidays` | Festivos en Perú (fuente: ICS público de Google Calendar). Query: `start_date`, `end_date` (YYYY-MM-DD). Respuesta: `{ date, summary }[]` por día; **solo informativo** (no afecta disponibilidad). |
| GET | `/api/v1/reservations/:id` | Una reservación. |
| POST | `/api/v1/reservations` | Crear. Cuerpo recomendado: `reservation_day` (YYYY-MM-DD), `access_point_id`, `house_id`, opcionales `observation`, `num_guests`, `contact_phone`. El servidor fija `reservation_date` = día a las **08:00:00** y `end_date` = día siguiente a las **08:00:00** (ventana 8–8). También se acepta `reservation_date` legacy: se usa la parte fecha (YYYY-MM-DD) para la misma normalización. |
| PUT | `/api/v1/reservations/:id` | Actualizar campos de contenido (área, día, invitados, etc.). **Administrador:** solo si la reserva es de **su** `house_id` en sesión; no puede editar solicitudes de otros domicilios (solo confirmar/rechazar/completar vía `status`). Sin `house_id` en el token, el admin no puede usar este PUT en ninguna fila. **Estado:** no se modifica por este endpoint; usar `PUT .../status`. |
| PUT | `/api/v1/reservations/:id/status` | Cambiar estado (confirmar, rechazar, completar, cancelar según reglas). **`COMPLETADA`:** solo si el estado actual es **`CONFIRMADA`**. |
| DELETE | `/api/v1/reservations/:id` | Eliminar. |
| GET | `/api/v1/reservations/areas` | Áreas (p. ej. PISCINA, CASA_CLUB). |
| GET | `/api/v1/reservations/availability` | Query: `access_point_id`, `date` (YYYY-MM-DD). Respuesta: `available` (boolean) para el **día lógico 8–8** que comienza ese día; `logical_window_start` / `logical_window_end`. |

**Reglas de negocio (resumen):**

- Una sola reserva en estado **PENDIENTE** o **CONFIRMADA** por `access_point_id` y misma ventana 8–8 (mismo `reservation_date` de inicio normalizado).
- Tope mensual de activas por casa: `RESERVATION_MAX_ACTIVE_PER_MONTH_PER_HOUSE` en `server/config/reservation_business_rules.php` (mes calendario según `reservation_date`).
- **Cierre automático al fin de ventana:** el **EVENT** `ev_vc_complete_expired_reservations` en [`database/vc_create_database.sql`](../database/vc_create_database.sql) ejecuta cada día a las **08:02** (zona `America/Lima` vía `--default-time-zone` en MySQL en Docker). Actualiza a `COMPLETADA` las filas `CONFIRMADA` con `end_date < NOW()`. Requiere `event_scheduler=ON` (activado en `docker-compose` del servicio `mysql`). **Refuerzo:** la misma lógica se llama en el **login** de `ADMINISTRADOR` mediante [`server/helpers/reservation_auto_complete.php`](helpers/reservation_auto_complete.php). Bases ya creadas sin el evento: ejecutar manualmente en MySQL el bloque `DROP EVENT` / `SET GLOBAL event_scheduler` / `CREATE EVENT` de ese SQL (o recrear volumen de datos en desarrollo).

**Checklist manual sugerido:**

1. Vecino A crea solicitud con `reservation_day`; aparece **PENDIENTE** en calendario para vecino B (tag) sin datos sensibles de A.
2. Vecino B no puede crear otra **PENDIENTE**/confirmada la misma área y mismo día lógico (error 400).
3. Admin confirma/rechaza solicitud de otra casa vía `PUT .../status`; el mismo admin **no** puede `PUT /reservations/:id` sobre esa fila (403).
4. Admin **con** `house_id` en sesión puede `PUT` solo reservas de esa casa; cancelación como admin solo su domicilio (ya existente).
5. Lista `GET /reservations` para vecino sigue acotada a sus casas; el calendario usa `GET .../calendar`.

---

## Registro de eventos (auditoría, solo ADMINISTRADOR)

Tabla `event_logs` en MySQL. Las acciones de escritura relevantes (login, CRUD, permisos, etc.) se registran mediante [`server/helpers/event_log.php`](helpers/event_log.php). **No** incluye contraseñas ni tokens en `details_json`.

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/v1/admin/event-logs` | Listado paginado. Solo `ADMINISTRADOR`. Query: `from`, `to` (YYYY-MM-DD o datetime; máx. **30 días** hacia atrás), `action`, `entity_type`, `actor_user_id`, `q` (búsqueda en resumen/usuario), `page`, `page_size` (máx. 200). |
| GET | `/api/v1/admin/event-logs/actions` | Catálogo de códigos `action` distintos ya registrados (filtro UI). |

**Retención:** el EVENT `ev_vc_purge_event_logs` elimina filas con `occurred_at` anterior a 30 días. Se ejecuta diariamente a las **03:00** (hora del servidor MySQL). Definido en [`database/vc_create_database.sql`](../database/vc_create_database.sql) y migración [`database/migrations/003_event_logs.sql`](../database/migrations/003_event_logs.sql). Requiere `event_scheduler=ON`.

**UI:** pestaña *Registro de eventos* en **Configuración** (`/settings`), visible solo para administradores.

**IP del cliente:** en Docker/producción la API está detrás de Nginx Proxy Manager. La IP se toma de `X-Forwarded-For` / `X-Real-IP` ([`server/helpers/client_ip.php`](helpers/client_ip.php)); Apache usa `mod_remoteip` con [`server/apache-remoteip.conf`](apache-remoteip.conf). Si todos los eventos muestran una IP `172.x.x.x`, el proxy no está reenviando la IP del cliente: en NPM, el proxy host hacia la API debe tener activado el reenvío de IP (por defecto suele estarlo). Tras el cambio, reconstruir la imagen `api` (`docker compose ... up -d --build`).

**Migración en BD existente:**

```bash
mysql -u ... -p vc_db < database/migrations/003_event_logs.sql
```

---

## API RENIEC (referencia frontend)

No es un endpoint de este servidor. Ejemplo de proveedor: `GET https://my.apidev.pro/api/dni/{numero_dni}`.

Campos útiles para rellenar el formulario público / `owners[]`:

| Campo API | Uso |
|-----------|-----|
| `numero` | `doc_number` |
| `nombres` | `first_name` |
| `apellido_paterno` | `paternal_surname` |
| `apellido_materno` | `maternal_surname` |

---

## Respuestas y errores

- Éxito habitual: `{ "success": true, "data": ... }` (u otra forma según `Utils\Response`).
- Error: `{ "success": false, "error": "mensaje" }` con código HTTP apropiado (400, 401, 403, 404, 409, …).
- **404** en rutas desconocidas: JSON con `documentation` apuntando a este archivo y listado orientativo en `available_routes` (ver final de `index.php`).

---

## Añadir un nuevo recurso CRUD

1. Tabla en `database/vc_create_database.sql` (y FKs).
2. `server/controllers/NuevoController.php` extendiendo `Controller` donde aplique.
3. Registrar rutas en `server/index.php` bajo `/api/v1/...`, con subrutas específicas **antes** del patrón genérico `recurso/:id`.

---

## Documentación ampliada

Contexto de negocio, bases de datos, despliegue y flujo `users` / `persons` / `house_members`: [`../plans/REFERENCIA_TECNICA.md`](../plans/REFERENCIA_TECNICA.md).

Estado del proyecto y mejoras: [`../ESTADO_Y_MEJORAS.md`](../ESTADO_Y_MEJORAS.md).
