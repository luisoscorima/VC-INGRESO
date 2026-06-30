# Referencia técnica — VC-INGRESO

Contexto ampliado: bases de datos, flujos `users`/`persons`/`house_members`, modelos TypeScript, seguridad, backup/despliegue, imágenes en registro público y refactor del frontend.

**Contrato HTTP (rutas, métodos, auth):** documento canónico **[`../server/API.md`](../server/API.md)** (alineado a `server/index.php`).

Estado, roadmap y registro de mejoras: [../ESTADO_Y_MEJORAS.md](../ESTADO_Y_MEJORAS.md).

---

## Índice

1. [Descripción y stack](#1-descripción-y-stack)
2. [Estructura del proyecto](#2-estructura-del-proyecto)
3. [Instalación y desarrollo](#3-instalación-y-desarrollo)
4. [Bases de datos](#4-bases-de-datos)
5. [Users, persons, house_members y flujos](#5-users-persons-house_members-y-flujos)
6. [Modelo house-centric y permisos (post-migración)](#6-modelo-house-centric-y-permisos-post-migración)
7. [API REST v1](#7-api-rest-v1)
8. [Modelos de datos (TypeScript)](#8-modelos-de-datos-typescript)
9. [Seguridad](#9-seguridad)
10. [Backup, despliegue y restauración](#10-backup-despliegue-y-restauración)
11. [Imágenes en registro público y almacenamiento](#11-imágenes-en-registro-público-y-almacenamiento)
12. [Refactor frontend Angular](#12-refactor-frontend-angular)
13. [Formulario de registro público — secciones UI](#13-formulario-de-registro-público--secciones-ui)
14. [Licencia](#14-licencia)

---

## 1. Descripción y stack

**VC-INGRESO** es una aplicación web para gestión y control de acceso de personas y vehículos en condominios.

### Características principales

- Control de acceso con validación de estado (PERMITIDO / OBSERVADO / DENEGADO).
- Gestión de residentes, visitantes y personal.
- Administración de viviendas y vehículos.
- Dashboard con estadísticas en tiempo real.
- Sistema de autenticación con roles.

### Stack tecnológico

| Capa | Tecnología |
|------|------------|
| Frontend | Angular 18.2.11, Angular Material 17.3.10, Tailwind CSS 3.4.1, Chart.js 4.4.7 |
| Backend | PHP 8.2, MVC, MySQL, Apache/Docker |
| API | REST, punto de entrada `server/index.php` + conexión unificada |

---

## 2. Estructura del proyecto

```
VC-INGRESO/
├── src/                          # Frontend Angular
│   ├── app/
│   │   ├── api.service.ts        # Servicio HTTP unificado
│   │   ├── error.interceptor.ts
│   │   ├── auth.service.ts
│   │   ├── auth.interceptor.ts   # Bearer token
│   │   ├── users.service.ts
│   │   ├── access-log.service.ts
│   │   ├── pets.service.ts
│   │   ├── reservations.service.ts
│   │   ├── pet.ts, reservation.ts, user.ts, accessPoint.ts
│   │   ├── pets/, reservations/, qr/, webcam/
│   │   ├── history/, birthday/, users/, houses/, vehicles/
│   │   ├── my-house/, login/, settings/, inicio/, side-nav/
│   │   └── ...
│   └── environments/
├── server/
│   ├── controllers/
│   │   ├── Controller.php
│   │   ├── UserController.php
│   │   ├── PersonController.php
│   │   ├── HouseController.php
│   │   ├── VehicleController.php
│   │   ├── ExternalVehicleController.php
│   │   ├── PetController.php
│   │   ├── AccessLogController.php
│   │   ├── ReservationController.php
│   │   └── ...
│   ├── utils/ (Response.php, Router.php, etc.)
│   ├── index.php
│   ├── db_connection.php
│   └── auth_middleware.php
├── database/
│   ├── vc_create_database.sql
│   ├── vc_dev_data.sql
│   └── crearttech_clientes_schema.sql
├── plans/
│   └── REFERENCIA_TECNICA.md
├── docker-compose.yml
├── ESTADO_Y_MEJORAS.md
└── README.md
```

**Carpeta `src/app/qr/`** (código QR unificado): `qr-access.service.ts`, `qr-scanner.component.ts`, `codigo-qr-page.component.ts`, `codigo-qr.guard.ts`. **Reservaciones:** `src/app/reservations/` (`ReservationsComponent`, ruta `#/reservations`; `#/calendar` redirige allí).

---

## 3. Instalación y desarrollo

### Docker (recomendado)

Las pruebas y el desarrollo se realizan con **Docker** para no alterar dependencias del sistema (Node, PHP, etc.).

```bash
cp .env.example .env
docker compose up --build
# Backend: http://localhost:8080
# Frontend: http://localhost:4200
```

- El servicio `frontend` suele ejecutar `npm install --legacy-peer-deps` y `ng serve` dentro del contenedor.
- El servicio `api` monta `./server` para editar PHP en caliente.

### Nota sobre migraciones en README legacy

El [README.md](../README.md) puede mencionar migraciones sueltas antiguas. Para **nuevos entornos**, usar solo **`database/vc_create_database.sql`** y **`vc_dev_data.sql`** (orden y detalle en [§4](#4-bases-de-datos)); backup y despliegue en [§10](#10-backup-despliegue-y-restauración).

### Manual (opcional)

Sin Docker: instalar Node, PHP y MySQL. Se recomienda Docker para desarrollo.

```bash
npm install --legacy-peer-deps
ng serve
# Backend: Apache + .env
```

**Windows / build en host:** el build de Angular en el host puede fallar por dependencias opcionales (p. ej. Rollup); la documentación de proyecto suele apuntar a **build dentro de Docker**.

---

## 4. Bases de datos

### Resumen

| Base de datos | Variable env | Uso | Conexión |
|---------------|--------------|-----|----------|
| **vc_db** | `DB_NAME` | Sistema principal del condominio (usuarios, casas, personas, vehículos, mascotas, reservas, access_logs, etc.). Un condominio = una instancia. | `db_connection.php` |
| **crearttech_clientes** | `DB_LICENSE_NAME` | Licencias y clientes Crearttech. Tablas: `clients`, `payment`. | `bdLicense.php` (donde exista) |

### Bases legacy

`DB_ENTRANCE_NAME` y `DB_DATA_NAME` fueron eliminados del proyecto (`.env`, docker-compose). Las BD **vc_entrance** y **vc_data** ya no se crean en `vc_create_database.sql`. Archivos como `bd.php`, `bdEntrance.php`, `bdData.php` pueden seguir en servidor con fallback; esos endpoints solo funcionan si esas BD existen manualmente.

### crearttech_clientes (licencias)

- **Objetivo**: clientes que adquieren el sistema y licencias/pagos.
- **Tablas**:
  - **clients**: client_id, client_name, client_phone, client_email, client_ruc, doc_type, client_logo, address, contact_name, notes, is_active, timestamps.
  - **payment**: payment_id, client_id, date_start, date_expire, payment_date, payment_frequency (MENSUAL|TRIMESTRAL|SEMESTRAL|ANUAL), amount, currency, status, notes, timestamps.
- **Script**: `database/crearttech_clientes_schema.sql`.
- **Endpoints legacy que la usan** (si siguen presentes): getPaymentByClientId.php, getSystemClientById.php.

### vc_db (sistema principal)

- **Scripts canónicos**:
  - **`vc_create_database.sql`**: crea BD, tablas en orden, FKs, datos iniciales de `access_points` (Garita, Entrada Peatonal, Piscina, Casa Club, según script).
  - **`vc_dev_data.sql`**: datos de prueba (después del create).

### Tablas principales (orden de dependencia conceptual)

| Tabla | Descripción breve |
|-------|-------------------|
| **houses** | Casas (block_house, lot, apartment, owner_id, status_system). |
| **users** | Usuarios del sistema (login, roles, house_id según versión, birth_date, person_id en diseño nuevo). |
| **access_points** | Puntos y áreas (GARITA, PISCINA, CASA_CLUB, etc.) con max_capacity, current_capacity. |
| **persons** | Residentes, propietarios, visitas; doc_number, house_id, status_validated, person_type. |
| **house_members** | Pertenencia persona ↔ casa (diseño house-centric). |
| **vehicles** | Placa, house_id, owner_id, status_validated, category_entry, photo_url, etc. |
| **temporary_visits** | Visitas temporales. |
| **access_logs** | Ingreso/egreso; access_point_id, person_id, doc_number, vehicle_id, type, observation; auditoría created_by_user_id donde aplique. |
| **temporary_access_logs** | Logs temporales (temp_visit_id, access_point_id, house_id, operario_id, tiempos). |
| **pets** | Mascotas; house_id obligatorio; owner_id opcional; photo_url. |
| **reservations** | Reservas de áreas; access_point_id, person_id, house_id, fechas, estado, num_guests, contact_phone. |

Las FKs se definen al final de `vc_create_database.sql`.

### Orden de ejecución (entorno de pruebas)

1. **vc_db** (esquema + datos). Sustituir placeholder de contraseña (ver DEPLOY):

```bash
sed "s#__MYSQL_ROOT_PASSWORD__#$DB_PASS#g" database/vc_create_database.sql | docker exec -i vc-ingreso-mysql mysql -uroot -p"$DB_PASS"
docker exec -i vc-ingreso-mysql mysql -uroot -p"$DB_PASS" vc_db < database/vc_dev_data.sql
```

2. **crearttech_clientes**:

```bash
docker exec -i vc-ingreso-mysql mysql -uroot -p"$DB_PASS" < database/crearttech_clientes_schema.sql
```

No se usa `vc_foreign_keys.sql` aparte si las FK están en `vc_create_database.sql`.

### Archivos en `database/`

| Archivo | Uso |
|---------|-----|
| `vc_create_database.sql` | Crear vc_db, tablas, FKs, INSERT inicial access_points. |
| `vc_dev_data.sql` | Datos de prueba. |
| `crearttech_clientes_schema.sql` | BD licencias, tablas clients y payment. |

### Variables .env

- `DB_NAME` = vc_db  
- `DB_LICENSE_NAME` = crearttech_clientes  
- `DB_ENTRANCE_NAME` y `DB_DATA_NAME` eliminados del proyecto.

---

## 5. Users, persons, house_members y flujos

### Resumen rápido (concepto clásico)

| Concepto | **users** | **persons** |
|----------|-----------|-------------|
| **Qué es** | Cuentas para **iniciar sesión** | **Personas** conocidas por el sistema |
| **¿Usuario/contraseña?** | Sí | No |
| **Uso** | Login, roles, “Mi Casa” con house_id (legacy) o vía membership | Ingresos/egresos, reservas, dueño de mascotas/vehículos |
| **Referencias** | temporary_access_logs.operario_id → users | access_logs.person_id, reservations.person_id, pets.owner_id, vehicles.owner_id → persons |
| **Registro público** | No crea users por sí solo en el flujo descrito | Crea persons (propietarios), vehículos, mascotas |

### Flujo general (diagrama textual)

- **houses** → domicilios.
- **users** → quienes entran al sistema (login); pueden tener house_id (legacy).
- **persons** → catálogo de personas físicas para ingresos, reservas, dueños.
- **access_logs** → person_id (persons), no users.
- **reservations** → person_id + house_id.

### Registro público (flujo documentado)

1. Formulario: vivienda, propietarios, vehículos, mascotas.
2. **PublicRegistrationController**: busca/crea house; inserta **persons**; vehicles y pets con house_id y owner_id → persons.
3. **No** se crea user automáticamente en ese flujo base: el propietario queda como **person** hasta que un admin cree **user** (salvo procesos adicionales con `users/from-person` o similares — ver API y código).

### “Vacío lógico” histórico

- Sin enlace user ↔ person: confusión entre endpoints “getPersonsByHouseId” que devolvían **users**.
- Registro público sin login hasta crear cuenta.
- Direcciones de cierre: `person_id` en users, `house_members`, renombrar endpoints, flujo `POST /api/v1/users/from-person`.

### Referencia rápida de tablas (vc_db)

| Tabla | Relación users/persons |
|-------|----------------------|
| houses | users.house_id, persons.house_id, vehicles.house_id, pets.house_id, reservations.house_id |
| users | Login / Mi Casa (legacy o person_id + membership) |
| persons | access_logs, reservations, pets.owner_id, vehicles.owner_id |
| vehicles / pets | house_id → houses; owner_id → persons |

---

## 6. Modelo house-centric y permisos (post-migración)

### users vs persons vs house_members

| Concepto | Descripción |
|----------|-------------|
| **persons** | Identidad real: todas las personas. Sin login. Usadas en access_logs, reservations, pets.owner_id, vehicles.owner_id. |
| **users** | Autenticación y permisos. Pueden tener `person_id` → persona real. `house_id` puede estar **deprecado**; casas accesibles vía **house_members**. |
| **house_members** | Fuente de verdad: house_id, person_id, relation_type (PROPIETARIO, RESIDENTE, INQUILINO, FAMILIAR, APODERADO, etc.), is_active, is_primary. |

**Regla**: Todos son persons; solo algunos son users. Operación (ingresos, reservas, dueños) usa persons; vistas y permisos usan users + house_members.

### House-centric: assets y “Mi Casa”

- **pets** y **vehicles**: `house_id` obligatorio; `owner_id` opcional; si se asigna, debe ser miembro activo de esa casa.
- **Mi Casa**: user → person_id → house_members (is_active=1) → houses; miembros, pets y vehicles por casa.

### Temporales

- **temporary_visits** / **temporary_access_logs**: visitas temporales (delivery, taxi, etc.).

### Permisos (backend)

- Helper típico: `server/helpers/house_permissions.php` — `canAccessHouse($pdo, $auth, $houseId)` (ADMIN o miembro activo), `validateOwnerInHouse`.
- Pets / Vehicles / Reservations: operaciones por casa exigen ADMIN o miembro activo; si no, **403**.
- **owner_id**: si se envía, validar miembro activo de la misma casa; si no, **400**.

### Endpoints renombrados / nuevos

| Antes / confuso | Nuevo / a usar |
|-----------------|----------------|
| getPersonsByHouseId (users por casa) | **GET /api/v1/houses/:id/members** (persons + relation_type) |
| Login legacy | Retorna user + person + **my_houses** (house_members; fallback house_id legacy) |
| Token | Incluye **person_id** si existe |

### Registro público (producción) — notas

- RENIEC/apidev: solo rellena nombres en pantalla; **no persistir** automáticamente gender, birth_date, address, distrito, etc. desde esa API en persons si la política es minimalista.
- **POST /api/v1/users/from-person**: crear usuario desde persona (person_id, username_system, password_system, role_system).

### Auditoría

- **access_logs**: `created_by_user_id` = guardia/operario que registró.
- **reservations**: `created_by_user_id`.
- **pets / vehicles**: opcionalmente created_by / updated_by.

### Checklist de pruebas (documento modelo)

1. Propietario y residente de la misma casa ven mismos pets/vehicles por house_id.
2. Admin sin casa puede operar el panel.
3. Guardia deja created_by_user_id en access_logs.
4. No asignar owner_id fuera de miembros activos de la casa.
5. Persona puede obtener login con user vinculado a person_id e is_active.

---

## 7. API REST v1

La lista actualizada de endpoints, cuerpos de ejemplo y notas de autenticación está en **[`../server/API.md`](../server/API.md)**. Lo siguiente resume y amplía contexto; ante divergencia, prevalece **`server/index.php`** y **`server/API.md`**.

**Base URL:** `/api/v1/`. **Entrada única:** `index.php` + conexión BD (no archivos `.php` sueltos legacy).

**Autenticación:** `Authorization: Bearer <token>` en endpoints con `requireAuth()`.

**Excepciones sin auth:** `POST /api/v1/public/register`, `POST /api/v1/auth/login`, y rutas `POST /api/v1/public/upload/*`.

**Patrón CRUD:** GET listar, GET `/:id`, POST crear, PUT `/:id`, DELETE `/:id`.

Contrato HTTP (incluye RENIEC, access-logs extendidos y catalog). Punto de entrada API: `server/index.php` + `server/db_connection.php`.

---

### Auth

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| POST | /api/v1/auth/login | No | Body: `{ "username_system", "password_system" }`. Retorna `{ user, person, my_houses, token }`. |

### Registro público

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| POST | /api/v1/public/register | No | Crea vivienda + propietario(s) + vehículos + mascotas |

**Body JSON (ejemplo):**

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

- **house**: obligatorio. `house_type`: CASA | DEPARTAMENTO | LOCAL COMERCIAL | OTRO. `block_house`, `lot` obligatorios; `apartment` opcional.
- **owners**: al menos uno. Obligatorios: doc_number, first_name, paternal_surname. Opcionales: maternal_surname, cel_number, email, type_doc (default DNI). No repetir doc_number.
- **vehicles**: opcional. Cada ítem: license_plate obligatorio; type_vehicle, brand, color, photo_url opcionales.
- **pets**: opcional. name y species (PERRO | GATO | AVE | OTRO); breed, color, age_years, photo_url opcionales.

**Respuesta 201:** `{ "success": true, "data": { "house_id", "person_ids", "vehicle_ids", "pet_ids", "created_users" }, "message": "..." }`.

**Subida de fotos (previo al register):**

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| POST | /api/v1/public/upload/vehicle-photo | No | multipart/form-data, campo **photo**. Máx. 5 MB; JPG, PNG, GIF. |
| POST | /api/v1/public/upload/pet-photo | No | Igual. |

**Respuesta 200:** `{ "success": true, "photo_url": "/uploads/public/vehicles/xxx.jpg" }` (o pets).

### API RENIEC (consulta por DNI)

API externa para autocompletar datos del propietario. Ejemplo: [my.apidev.pro](https://my.apidev.pro/api/dni/). La consulta se hace desde el **frontend** (al salir del campo DNI o botón «Buscar»).

**Petición (frontend):** `GET https://my.apidev.pro/api/dni/{numero_dni}` (revisar si el proveedor exige API key o cabeceras).

**Respuesta de ejemplo (éxito):**

```json
{
  "success": true,
  "data": {
    "numero": "70416431",
    "nombre_completo": "OSCORIMA PALOMINO, MARTIN ALEJANDRO",
    "nombres": "MARTIN ALEJANDRO",
    "apellido_paterno": "OSCORIMA",
    "apellido_materno": "PALOMINO",
    "codigo_verificacion": 4,
    "fecha_nacimiento": "1999-03-30",
    "sexo": "MASCULINO",
    "estado_civil": "SOLTERO",
    "departamento": "AYACUCHO",
    "provincia": "HUAMANGA",
    "distrito": "AYACUCHO",
    "direccion": "JR. DOS DE MAYO 710",
    "direccion_completa": "JR. DOS DE MAYO 710, AYACUCHO - HUAMANGA - AYACUCHO",
    "ubigeo_reniec": "050101",
    "ubigeo_sunat": "050101",
    "ubigeo": ["05", "0501", "050101"]
  },
  "time": 0.060066938400268555
}
```

**Campos `data` → `owners[]` en `POST /api/v1/public/register`:**

| Campo RENIEC | Uso en registro | Notas |
|--------------|-----------------|--------|
| `numero` | `doc_number` | DNI |
| `nombres` | `first_name` | Puede venir en mayúsculas |
| `apellido_paterno` | `paternal_surname` | |
| `apellido_materno` | `maternal_surname` | |
| `fecha_nacimiento` | — | Opcional futuro: `birth_date` |
| `sexo` | — | Opcional: `gender` |
| `direccion` / `direccion_completa` | — | Opcional |
| `departamento`, `provincia`, `distrito` | — | Opcional |

### Users

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | /api/v1/users | Listar |
| GET | /api/v1/users/:id | Por user_id |
| POST | /api/v1/users | Crear |
| POST | /api/v1/users/from-person | Crear usuario vinculado a `person_id` (body: person_id, username_system, password_system, role_system) — verificar en `index.php` |
| PUT | /api/v1/users/:id | Actualizar |
| DELETE | /api/v1/users/:id | Eliminar |
| POST | /api/v1/users/me/photo | Auth. Subir foto perfil. multipart **photo**. |
| GET | /api/v1/users/by-birthday?fecha_cumple=MM-DD | Cumpleaños del día (incl. block_house, lot) |

### Houses

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | /api/v1/houses | Listar |
| GET | /api/v1/houses/:id | Una casa |
| POST | /api/v1/houses | Crear |
| PUT | /api/v1/houses/:id | Actualizar |
| DELETE | /api/v1/houses/:id | Eliminar |
| GET | /api/v1/houses/:id/members | Miembros (house_members + persons) — según implementación en index.php |

### Vehicles

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | /api/v1/vehicles | Listar |
| GET | /api/v1/vehicles/:id | Uno |
| POST | /api/v1/vehicles | Crear |
| PUT | /api/v1/vehicles/:id | Actualizar |
| DELETE | /api/v1/vehicles/:id | Eliminar |
| GET | /api/v1/vehicles/by-house?house_id=:id | Por casa |

### Persons

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | /api/v1/persons | Listar |
| GET | /api/v1/persons/:id | Uno |
| POST | /api/v1/persons | Crear |
| PUT | /api/v1/persons/:id | Actualizar |
| DELETE | /api/v1/persons/:id | Eliminar |
| GET | /api/v1/persons/by-doc-number?doc_number= | Por documento |
| GET | /api/v1/persons/observed | Observados |
| GET | /api/v1/persons/restricted | Restringidos |
| PUT | /api/v1/persons/:id/validate | Estado validación |

### External vehicles

CRUD bajo `/api/v1/external-visits`.

### Pets

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | /api/v1/pets | Listar (house_id, owner_id, status, species) |
| GET | /api/v1/pets/:id | Una |
| GET | /api/v1/pets/person/:person_id | Por propietario |
| POST | /api/v1/pets | Crear |
| PUT | /api/v1/pets/:id | Actualizar |
| PUT | /api/v1/pets/:id/validate | Validación |
| POST | /api/v1/pets/:id/photo | Subir foto (auth) |
| DELETE | /api/v1/pets/:id | Eliminar |

### Access logs

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | /api/v1/access-logs | Listar (query: access_point_id, person_id, type, date, start_date, end_date, page, limit) |
| GET | /api/v1/access-logs/:id | Obtener uno |
| POST | /api/v1/access-logs | Crear registro |
| GET | /api/v1/access-logs/access-points | Puntos de acceso |
| GET | /api/v1/access-logs/stats/daily | Estadísticas diarias |
| GET | /api/v1/access-logs/entrance-by-range | Ingresos por día (date_init, date_end) |
| GET | /api/v1/access-logs/history-by-date | Por fecha y sala (fecha, sala) |
| GET | /api/v1/access-logs/history-by-range | Por rango (fecha_inicial, fecha_final, access_point) |
| GET | /api/v1/access-logs/history-by-client | Por cliente (fecha, sala, doc) |
| GET | /api/v1/access-logs/aforo | Aforo |
| GET | /api/v1/access-logs/address | Alias de aforo |
| GET | /api/v1/access-logs/total-month | Total mensual |
| GET | /api/v1/access-logs/total-month-new | Total mensual (nuevo) |
| GET | /api/v1/access-logs/hours | Por hora |
| GET | /api/v1/access-logs/age | Por edad |

### Catalog (áreas, salas, stubs)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | /api/v1/catalog/areas | Áreas (access_points) |
| GET | /api/v1/catalog/salas | Salas (access_points activos) |
| GET | /api/v1/catalog/prioridad | Prioridades (stub: []) |
| GET | /api/v1/catalog/collaborator | Por user_id (stub) |
| GET | /api/v1/catalog/personal | Por area_id (stub: []) |
| GET | /api/v1/catalog/payment-by-client | Por client_id (stub) |
| GET | /api/v1/catalog/activities-by-user | Stub [] |
| GET | /api/v1/catalog/machines | Stub [] |
| GET | /api/v1/catalog/inc-pendientes | Stub [] |
| GET | /api/v1/catalog/inc-proceso | Stub [] |
| GET | /api/v1/catalog/inc-fin | Stub [] |

### Reservations

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | /api/v1/reservations | Listar (query: access_point_id, person_id, house_id, date, start_date, end_date, status) |
| GET | /api/v1/reservations/:id | Obtener una |
| POST | /api/v1/reservations | Crear |
| PUT | /api/v1/reservations/:id | Actualizar |
| PUT | /api/v1/reservations/:id/status | Cambiar estado |
| DELETE | /api/v1/reservations/:id | Eliminar |
| GET | /api/v1/reservations/areas | Áreas (access_points PISCINA, CASA_CLUB) |
| GET | /api/v1/reservations/availability | Disponibilidad |

### Respuestas y nuevos CRUD

- Éxito: `{ "success": true, "data": ... }` (o según `Response::success`).
- Error: `{ "success": false, "error": "mensaje" }` con HTTP 4xx/5xx.
- Listados: a veces `count`.

**Crear nuevo recurso:** (1) tabla en `vc_create_database.sql` y FKs; (2) `server/controllers/NombreController.php` extendiendo `Controller`; (3) rutas en `server/index.php` (`preg_match`, subrutas especiales antes del CRUD genérico).

### Tabla resumida (recurso → especiales)

| Recurso | CRUD | Endpoints especiales |
|---------|------|----------------------|
| users | Sí | by-birthday, me/photo |
| houses | Sí | :id/members |
| vehicles | Sí | by-house |
| persons | Sí | by-doc-number, observed, restricted, validate |
| external-visits | Sí | — |
| pets | Sí | person/:id, validate, photo |
| access-logs | List/Create/Show | access-points, stats/daily, reportes |
| reservations | Sí | areas, availability, status |

---

## 8. Modelos de datos (TypeScript)

### Person

```typescript
{
  id, doc_number, first_name, paternal_surname, maternal_surname,
  gender, birth_date, cel_number, email, address,
  status_validated: 'PERMITIDO' | 'OBSERVADO' | 'DENEGADO',
  status_reason, person_type, house_id, photo_url
}
```

### User

```typescript
{
  user_id, doc_number, first_name, paternal_surname, email,
  role_system, username_system, house_id, status_validated,
  // + person_id según modelo actual
}
```

### House

```typescript
{
  id, block_house, lot, apartment, status_system
}
```

### Vehicle

```typescript
{
  id, license_plate, type_vehicle, house_id,
  status_validated, category_entry,
  brand?, model?, color?, photo_url?
}
```

### Pet

```typescript
{
  id, name, species: 'DOG'|'CAT'|'BIRD'|'OTHER',
  breed, color, owner_id, photo_url,
  status_validated, status_reason, microchip_id
}
```

### AccessLog / AccessPoint / Reservation

`access_point_id`, `person_id`, `type` INGRESO|EGRESO; reservación con fechas, estado, `num_guests`, `area_name`, etc.

### Estados de validación (Persons)

| Estado | Significado |
|--------|-------------|
| PERMITIDO | Acceso normal (default) |
| OBSERVADO | Atención especial |
| DENEGADO | Sin acceso |

---

## 9. Seguridad

- **Autenticación**: JWT.
- **Contraseñas**: `password_hash()` en PHP.
- **SQL**: PDO prepared statements.
- **CORS**: configurado para desarrollo.
- **Pendientes frecuentes en plan**: CSRF, rate limiting, HTTPS en producción, validación estricta de uploads públicos.

---

## 10. Backup, despliegue y restauración

### 1. Backup de base de datos (producción)

```bash
docker exec vc-ingreso-mysql \
  sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" vc_db --single-transaction' \
  > backup_vc_db_$(date +%F_%H-%M-%S).sql
```

- `--single-transaction` evita inconsistencias en bases activas.

### 2. Backup de imágenes (volumen Docker)

```bash
docker run --rm \
  -v vc-ingreso_uploads_data:/data:ro \
  -v $(pwd):/backup \
  alpine \
  tar czf /backup/uploads_$(date +%F_%H-%M-%S).tar.gz -C /data .
```

- `--rm` no elimina el volumen; solo el contenedor temporal.

### 3. Flujo de despliegue (recomendado: imágenes desde GitHub Actions)

Cada push a `main` ejecuta [`.github/workflows/docker-publish.yml`](../.github/workflows/docker-publish.yml) y publica en **GHCR**:

- `ghcr.io/luisoscorima/vc-ingreso-api:main`
- `ghcr.io/luisoscorima/vc-ingreso-frontend:main`

En el servidor **no hace falta compilar Angular** (~40–140 s ahorrados). Solo pull + reinicio:

```bash
set -euo pipefail
cd ~/vc-ingreso

# Una sola vez si los paquetes GHCR son privados:
# echo <PAT con read:packages> | docker login ghcr.io -u TU_USUARIO --password-stdin

./scripts/deploy-prod.sh
```

O manualmente:

```bash
cd ~/vc-ingreso
git pull --ff-only origin main
# Migraciones SQL si hay archivos nuevos en database/migrations/
docker compose -f docker-compose.prod.yml pull api frontend
docker compose -f docker-compose.prod.yml up -d api frontend --remove-orphans
```

**Pin por commit** (rollback o deploy exacto):

```bash
export VC_IMAGE_TAG=main-1e1246b   # tag publicado por CI
docker compose -f docker-compose.prod.yml pull api frontend
docker compose -f docker-compose.prod.yml up -d api frontend
```

### 3b. Flujo legacy (build en el servidor)

Solo si GHCR no está disponible:

```bash
docker compose -f docker-compose.prod.yml up -d --build --remove-orphans
```

### 3c. Usuarios con versión antigua en el navegador

Si tras un deploy algunos usuarios siguen viendo pantallas viejas (p. ej. flujo de licencia ya eliminado):

1. **Causa:** el navegador o NPM cacheó `index.html` y apunta a bundles JS antiguos.
2. **Mitigación en app:** nginx sirve `index.html` y `version.json` con `Cache-Control: no-cache`; el frontend consulta `/version.json` y muestra aviso para recargar.
3. **Mitigación operativa:** pedir recarga forzada (Ctrl+F5) o cerrar pestaña en garitas con sesión abierta días.
4. **NPM (proxy):** no activar caché agresiva en el host del frontend; si existe, excluir `index.html` y `version.json`.

### 3d. Flujo de despliegue seguro completo (bash, con backup de imágenes)

```bash
set -euo pipefail

cd ~/vc-ingreso

echo "==> 1. Backup de BD"
docker exec vc-ingreso-mysql \
  sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" vc_db --single-transaction' \
  > backup_vc_db_$(date +%F_%H-%M-%S).sql

echo "==> 2. Backup de imagenes"
docker run --rm \
  -v vc-ingreso_uploads_data:/data:ro \
  -v $(pwd):/backup \
  alpine \
  tar czf /backup/uploads_$(date +%F_%H-%M-%S).tar.gz -C /data .

echo "==> 3. Actualizar codigo"
git fetch origin
git checkout main
git pull --ff-only origin main

echo "==> 4. Pull imágenes GHCR"
docker compose -f docker-compose.prod.yml pull api frontend

echo "==> 5. Reinicio controlado"
docker compose -f docker-compose.prod.yml up -d api frontend --remove-orphans

echo "==> 6. Verificacion"
docker compose -f docker-compose.prod.yml ps

echo "Deploy listo"
```

### 4. Restaurar BD en DEV (PowerShell)

```powershell
Get-Content .\backup_vc_db_YYYY-MM-DD_HH-MM-SS.sql | docker exec -i vc-ingreso-mysql mysql -uroot -pTU_PASSWORD vc_db
```

### 5. Restaurar imágenes en DEV

```powershell
docker run --rm `
  -v vc-ingreso_uploads_data:/data `
  -v ${PWD}:/backup `
  alpine `
  sh -c "rm -rf /data/* && tar xzf /backup/uploads_YYYY-MM-DD_HH-MM-SS.tar.gz -C /data"
```

### 6. Buenas prácticas

- Backup **antes** de pull.
- Imágenes son datos críticos además de la BD.
- No sobrescribir backups históricos.
- Validar que el `.sql` contenga INSERT.
- Probar restauración en DEV con regularidad.

### 7. Escalado futuro

- BD → RDS.
- Imágenes → S3 (u object storage).

---

## 11. Imágenes en registro público y almacenamiento

### Objetivo

Fotos de vehículos y mascotas en registro público como **URL en BD** (`photo_url`); visualización obligatoria **tras login** en Mi Casa / listados; en el formulario de registro la vista previa es opcional.

### Almacenamiento

- Solo URL en BD (VARCHAR); no binarios en tablas.
- **Alternativa 1**: disco en servidor (`server/uploads/public/vehicles/`, `pets/`, perfiles). Servir `/uploads` como estáticos.
- **Alternativa 2 (futuro)**: capa de abstracción → mismo contrato, sustituir implementación por S3.

### Implementación

- **PublicRegistration**: persiste `photo_url` en vehículos y mascotas.
- **PetController**: `uploadPhoto` para mascotas existentes (auth); distinto del flujo público sin pet_id.
- **Endpoints públicos** `POST .../public/upload/vehicle-photo` y `pet-photo`: multipart, validación tipo/tamaño, nombre único en disco, respuesta `{ success, photo_url }`.
- **Frontend registro**: servicios `uploadVehiclePhoto` / `uploadPetPhoto`; input file; payload final a `public/register`.
- **`.gitignore`**: `uploads/` para no versionar binarios.

### Orden de tareas sugerido

1. Backend: carpetas y rutas en `index.php`.
2. Validación + guardado + URL.
3. Documentar en API.
4. Frontend: FormData y asignación a `photo_url`.
5. Proxy/servidor para `/uploads`.
6. Pantallas logueadas con `<img [src]="...">` o base URL.
7. Preparar abstracción para S3.

---

## 12. Refactor frontend Angular

### Servicios actualizados

| Servicio | Estado | Notas |
|----------|--------|-------|
| UsersService | Completado | CRUD unificado, legacy getClientes* si aplica |
| AccessLogService | Completado | API v1 + métodos de historial |

### Archivos eliminados (lista histórica)

clientes.service.ts, ludopatia.service.ts, personal.service.ts, ludopata.ts, systemClient.ts, person.ts (legacy).

### Componentes

| Componente | Estado | Notas |
|------------|--------|-------|
| HistoryComponent | Completado | AccessLogService |
| BirthdayComponent | Completado | getPersonsByBirthday |
| ListrasComponent | Fuera de scope | Reemplazo futuro PersonsComponent |

### Métodos típicos (referencia)

**UsersService:** getAll, getById, getByDocNumber, getByStatus, getByBirthday, getByHouseId, CRUD, posibles getClientes legacy.

**AccessLogService:** getAccessLogs, getAccessLogById, createAccessLog, updateAccessLog, getAllAccessPoints, getAccessPointById, getHistoryByDate/Range/Client.

---

## 13. Formulario de registro público — secciones UI

*(Campos obligatorios según formulario; validar en código.)*

1. **Vivienda**: house_type, block_house, lot, apartment.
2. **Propietario principal**: type_doc, doc_number (+ botón RENIEC si DNI), apellidos, nombres, celular, email.
3. **Segundo propietario** (opcional): mismos campos.
4. **Vehículos** (hasta 3 en el texto plan; nota: cantidad idealmente recursiva): license_plate, type_vehicle, brand, model, color, photo_url.
5. **Mascotas** (1–2 en el texto; nota: recursivo): species, name, breed, color, age_years, photo_url.

Flujo de preguntas: segundo propietario sí/no → vehículos sí/no (hasta tres pasos) → mascotas sí/no (dos pasos) → envío a `POST /api/v1/public/register`.

---

## 14. Licencia

MIT (según README del proyecto).

---

*Ante duda, el código en `server/index.php` y controladores prevalece sobre esta referencia.*
