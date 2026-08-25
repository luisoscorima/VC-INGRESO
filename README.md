# VC-INGRESO

Sistema web de **control de acceso residencial**: personas, vehículos, ingresos/egresos, reservas de áreas comunes y registro público de propietarios.

**Stack:** Angular 18 + Angular Material + Tailwind · PHP 8.2 + MySQL · JWT · Docker.

## Capacidades del sistema

### Funcionalidades principales

- **Código QR:** generación y lectura de QR con caducidad, orientados a un uso seguro en portería. Funciona desde **celular, tablet y PC**. El vecino puede generar QR para **sí mismo, familia, visitas, inquilinos y vehículos** registrados en su domicilio.
- **Identificación en portería:** además del QR, admite **escaneo por código de barras** y **registro manual** cuando haga falta.
- **Usuarios y personas:** alta, consulta, edición y **gestión de fotos**; separación clara entre credenciales de sistema y datos de identidad/residencia.
- **Mascotas:** CRUD completo y **fotos** asociadas al hogar.
- **Vehículos:** CRUD completo y **fotos** (residentes y flujos de vehículos externos donde aplique).
- **Puntos de acceso:** el registro de ingresos/egresos se apoya en catálogo **tipificado** de puntos, con opciones como **permitir reservas** y **control de aforo** según el ambiente.
- **Reservaciones (áreas comunes):** flujo para **solicitar, confirmar, rechazar, cancelar y marcar como completada** (p. ej. casa club). Pensado para extenderse a **losas deportivas** u otros espacios reservables. Las solicitudes se visualizan en **vista calendario**.
- **Control de aforo (piscina y similares):** registro de **ingresos y salidas** con **indicador de ocupación en tiempo real**; el mismo enfoque puede aplicarse a otros ambientes con cupo limitado.
- **Comunicados y encuestas post-login:** al iniciar sesión se muestra primero la **cola completa de comunicados activos** (uno tras otro) y, al finalizar, se muestran las **encuestas pendientes**. La campana incluye **indicador amarillo** cuando hay comunicados no vistos o encuestas por responder.

### Comunicados y encuestas (UX + gestión)

- **Comunicados (admin):** CRUD en `Gestión > Comunicados`, con soporte de imagen (`image_url` y carga de archivo), estado `Activo/Inactivo` y preservación de histórico (sin borrado físico).
- **Encuestas (admin):** CRUD en `Gestión > Encuestas`, tipos `CLOSED`, `OPEN`, `MULTIPLE` y `CHECKBOX`, estado `Activo/Inactivo` y preservación de histórico.
- **Prioridad de visualización:** los comunicados tienen prioridad sobre encuestas en el flujo automático y en reapertura desde la campana.
- **Reapertura manual:** desde la campana el usuario puede volver a ver comunicados activos o encuestas pendientes.

### Beneficios para los vecinos

- Autogestión del hogar: residentes, inquilinos, visitas, mascotas y vehículos desde **Mi casa**, con foto y datos ordenados.
- **QR de ingreso** sin depender siempre del DNI físico; útil para familiares y visitas recurrentes.
- **Reservas** de áreas comunes con seguimiento del estado de la solicitud y vista en calendario.
- Transparencia: historial de accesos acotado a **su domicilio** cuando el rol es de vecino (sin ver datos de otras casas).

### Beneficios para administradores

- Visión **global** del condominio: personas, viviendas, vehículos, puntos de acceso, reservas e historial según políticas de rol.
- Configuración de **áreas comunes** (reservas, aforo, capacidad) desde el catálogo de puntos de acceso.
- Base para **auditoría** y reportes (ingresos/egresos, reservas, uso de aforo).
- Registro público de propietarios y flujos de alta que reducen carga operativa en secretaría.

### Beneficios para operadores de seguridad (portería / guardias)

- **Validación rápida:** escaneo de QR, código de barras o captura manual en el mismo flujo de trabajo.
- Menos fricción en horas punta: identificación clara de **persona, vehículo o visita temporal** según el caso.
- **Aforo en vivo** en ambientes controlados (p. ej. piscina) para decidir ingresos sin hojas de cálculo paralelas.
- Coherencia con las reglas del condominio: estados de reserva, límites de horario y políticas definidas en backend.

---

## Matriz de roles y políticas de acceso

Referencia funcional única para **quién puede qué** según `users.role_system` y `persons.person_type` (o equivalente en JWT/sesión). La implementación vive en backend (`server/helpers/role_policy.php`, `house_permissions.php`) y en guards/servicios Angular; **cualquier combinación no listada como válida no es un caso de uso permitido**.

### Valores

| Campo | Valores |
|--------|---------|
| **role_system** | `ADMINISTRADOR`, `OPERARIO`, `USUARIO` |
| **person_type** | `PROPIETARIO`, `RESIDENTE`, `INQUILINO`, `INVITADO`, `NULL` |

`NULL` indica persona sin tipo asignado en BD (p. ej. personal de portería sin ficha vecinal). `INVITADO` es tipo de persona en el padrón; **no tiene usuario de login** (no combina con ningún `role_system` en la práctica).

### Combinaciones válidas (pares fijos)

Solo estas tres familias son admitidas en login y en reglas de negocio:

| Par | role_system | person_type |
|-----|----------------|-------------|
| **1 + 2** | `ADMINISTRADOR` | `PROPIETARIO` / `RESIDENTE` / `NULL` |
| **3 + 4** | `OPERARIO` | `PROPIETARIO` / `RESIDENTE` / `INQUILINO` / `NULL` |
| **5 + 6** | `USUARIO` | `PROPIETARIO` / `RESIDENTE` / `INQUILINO` |

**Reglas globales**

- **ADMINISTRADOR + INQUILINO:** no permitido.
- **INVITADO:** sin cuenta en `users`; no crea, no edita, no genera QR.
- **OPERARIO + NULL** y **ADMINISTRADOR + NULL:** no entran a **Mi casa** ni generan **QR de hogar** (contexto vecinal); sí pueden usar flujos de **staff** (escáner, listados globales de gestión donde aplique).

---

### 0. Código QR

| Ámbito | role_system | person_type | Notas |
|--------|----------------|-------------|--------|
| **0.1** Escáner QR / ingreso manual documento o placa (portería) | `ADMINISTRADOR` | `PROPIETARIO` / `RESIDENTE` / `NULL` | Staff |
| | `OPERARIO` | `PROPIETARIO` / `RESIDENTE` / `INQUILINO` / `NULL` | Staff; conviene **mantener columna Documento** en pantallas de apoyo donde exista. |
| **0.2** Mi código QR de ingreso (requiere **casa asociada** en sesión / JWT) | `ADMINISTRADOR` / `OPERARIO` / `USUARIO` | `PROPIETARIO` / `RESIDENTE` | |
| | `USUARIO` / `OPERARIO` | `INQUILINO` | |

---

### 1. Dashboard

| Vista | role_system | person_type |
|--------|----------------|-------------|
| **1.1** Dashboard **staff** | `ADMINISTRADOR` | `PROPIETARIO` / `RESIDENTE` / `NULL` |
| | `OPERARIO` | `PROPIETARIO` / `RESIDENTE` / `INQUILINO` / `NULL` |
| **1.3** Dashboard **vecino** (requiere casa asociada) | `USUARIO` | `PROPIETARIO` / `RESIDENTE` / `INQUILINO` |

---

### 2. Historial

| Vista | role_system | person_type | UI |
|--------|----------------|-------------|-----|
| **2.1** Staff — ve **todas** las casas | `ADMINISTRADOR` | `PROPIETARIO` / `RESIDENTE` / `NULL` | Incluir columna **Documento** donde aplique. |
| | `OPERARIO` | `PROPIETARIO` / `RESIDENTE` / `INQUILINO` / `NULL` | **Mantener columna Documento.** |
| **2.3** Vecino — solo su domicilio | `USUARIO` | `PROPIETARIO` / `RESIDENTE` / `INQUILINO` | **No** mostrar columna Documento. |

---

### 3. Cumpleaños

| Vista | role_system | person_type | UI |
|--------|----------------|-------------|-----|
| **3.1** Staff — listado completo | `ADMINISTRADOR` | `PROPIETARIO` / `RESIDENTE` / `NULL` | |
| | `OPERARIO` | `PROPIETARIO` / `RESIDENTE` / `INQUILINO` / `NULL` | **Mantener columna Documento.** |
| **3.2** Vecino | `USUARIO` | `PROPIETARIO` / `RESIDENTE` / `INQUILINO` | **No** mostrar columna Documento. |

---

### 4. Mi casa (`My house`)

Requiere **contexto de hogar** (casa asociada). **OPERARIO + NULL** y **ADMINISTRADOR + NULL** **no** entran al módulo.

#### 4.1 Pestaña Residentes

- **Listar y generar QR** a otros con tipo `PROPIETARIO` o `RESIDENTE`: `ADMINISTRADOR` / `OPERARIO` / `USUARIO` con `person_type` **PROPIETARIO** o **RESIDENTE**.
- **Crear/editar** otros **PROPIETARIO**: mismos roles; solicitante **PROPIETARIO**.
- **Crear/editar** otros **RESIDENTE**: solicitante **PROPIETARIO** o **RESIDENTE** (según jerarquía abajo).

#### 4.2 Pestaña Inquilinos

- Listar / crear / editar / QR a **INQUILINO** con solicitante **PROPIETARIO** o **RESIDENTE**: roles `ADMINISTRADOR` / `OPERARIO` / `USUARIO` y `person_type` acorde.
- Listar / crear / editar / QR a **INQUILINO** con solicitante **INQUILINO**: `USUARIO` / `OPERARIO` con `person_type` **INQUILINO**.

#### 4.3 Mascotas

- Por **casa** (`house_id`): solicitante **PROPIETARIO** o **RESIDENTE** — `ADMINISTRADOR` / `OPERARIO` / `USUARIO` con esos tipos.
- Por **inquilino** (registros ligados al `owner_id` del usuario en sesión): `USUARIO` / `OPERARIO` con `person_type` **INQUILINO**.

#### 4.4 Vehículos (residentes)

- Por **casa**: como mascotas (propietario/residente).
- Por **owner** del inquilino en sesión: `USUARIO` / `OPERARIO` + **INQUILINO**.

#### 4.6 Visitas (invitados en padrón)

- Gestión amplia con solicitante **PROPIETARIO** o **RESIDENTE**: roles `ADMINISTRADOR` / `OPERARIO` / `USUARIO`.
- Con solicitante **INQUILINO**: `USUARIO` / `OPERARIO` + **INQUILINO**.

#### 4.7 Vehículos externos (`temporary_visits` + asignaciones)

- **Mi casa (vecino):** autoriza ingreso = lookup-or-create del perfil + asignación ACTIVA a su casa con duración (30\|60\|120\|240 min).
- **Visitas externas (staff):** padrón global de perfiles (creados por vecinos o staff). Alta staff puede ser **solo padrón** o, opcionalmente, con casa + duración (también crea asignación). El listado muestra las convocatorias (casa, vigencia, quién convocó) de cada perfil.
- Ingreso en portería requiere asignación vigente (el padrón solo no autoriza).

---

### Jerarquía Mi casa (crear/editar personas y recursos)

Sobre la **misma casa asociada** al solicitante:

| Solicitante | Puede listar | Puede crear/editar |
|-------------|----------------|---------------------|
| **PROPIETARIO** | Propietarios, residentes, inquilinos, invitados, mascotas, vehículos | Otros **PROPIETARIO**, **RESIDENTE**, **INQUILINO**, **INVITADO**, mascotas y vehículos de la casa |
| **RESIDENTE** | Igual listado | Solo **RESIDENTE**, **INQUILINO**, **INVITADO**, mascotas y vehículos de la casa (no edita propietarios) |
| **INQUILINO** | Inquilinos e invitados de la casa; mascotas y vehículos donde aplique su `owner_id` | Solo **INQUILINO**, **INVITADO** de la casa; mascotas/vehículos acotados a su **owner_id** |

**Generación de QR (Mi casa)**

| Solicitante | Puede generar QR para |
|-------------|------------------------|
| **PROPIETARIO** | PROPIETARIO, RESIDENTE, INQUILINO, INVITADO, vehículos |
| **RESIDENTE** | PROPIETARIO, RESIDENTE, INQUILINO, INVITADO, vehículos |
| **INQUILINO** | INQUILINO, INVITADO, vehículos |

**Visitas externas (Mi casa):** propietarios, residentes e inquilinos listan/crean asignaciones activas de su casa (perfil global reutilizado por placa/doc).

---

### 5. Reservaciones

- **OPERARIO + NULL** no entra ni al calendario “admin” ni al flujo “vecino”. El módulo es para **gestión del administrador** y **solicitud del vecino**; el operario entra **solo** si tiene **casa asociada como vecino** (no como staff “puro”).

| Elemento | Quién | person_type |
|-----------|--------|-------------|
| **5.1.1** Calendario staff (elige domicilio) | `ADMINISTRADOR` | `PROPIETARIO` / `RESIDENTE` / `NULL` |
| **5.1.2** Vista vecino (casa de sesión) | `USUARIO` / `OPERARIO` | `PROPIETARIO` / `RESIDENTE` / `INQUILINO` |
| **5.2.1** Tabla mes — **todas** las casas | `ADMINISTRADOR` | `PROPIETARIO` / `RESIDENTE` / `NULL` |
| **5.2.2** Tabla mes — **solo su casa** | `USUARIO` / `OPERARIO` | `PROPIETARIO` / `RESIDENTE` / `INQUILINO` |
| **5.3.1** Editar como admin (domicilio y estado) | `ADMINISTRADOR` | `PROPIETARIO` / `RESIDENTE` / `NULL` |
| **5.3.2** Editar como vecino | `USUARIO` / `OPERARIO` | `PROPIETARIO` / `RESIDENTE` / `INQUILINO` |
| **5.3.3** Confirmar | Solo `ADMINISTRADOR` | `PROPIETARIO` / `RESIDENTE` / `NULL` |
| **5.3.4** Rechazar | Solo `ADMINISTRADOR` | `PROPIETARIO` / `RESIDENTE` / `NULL` |
| **5.4.5** Cancelar | `ADMINISTRADOR` con `PROPIETARIO` / `RESIDENTE` (casa asociada); **y** `USUARIO` / `OPERARIO` vecino con `PROPIETARIO` / `RESIDENTE` / `INQUILINO`. Un **ADMINISTRADOR + NULL** no cancela por esta vía (cancelar es propio de quien tiene casa asociada). |

---

### 6. Usuarios / Personas (componente Users)

| Modo | role_system | person_type | UI |
|------|----------------|-------------|-----|
| **6.1** Listar con **documento** en tablas | `ADMINISTRADOR` | `PROPIETARIO` / `RESIDENTE` / `NULL` | Columna documento visible. |
| **6.2** Listar **solo lectura** (staff no admin) | `OPERARIO` | `PROPIETARIO` / `RESIDENTE` / `INQUILINO` / `NULL` | Sin columna documento; miniatura, nombre, domicilio, celular, estado. |
| **6.3** Crear y editar (gestión) | Solo `ADMINISTRADOR` | `PROPIETARIO` / `RESIDENTE` / `NULL` | |

---

### 7. Viviendas (Houses)

| Acción | role_system | person_type |
|--------|----------------|-------------|
| **7.1** Listar | `ADMINISTRADOR` | `PROPIETARIO` / `RESIDENTE` / `NULL` |
| | `OPERARIO` | `PROPIETARIO` / `RESIDENTE` / `INQUILINO` / `NULL` |
| **7.2** Crear/editar | Solo `ADMINISTRADOR` | `PROPIETARIO` / `RESIDENTE` / `NULL` |

---

### 8. Vehículos residentes y Visitas externas

Módulos nav separados (`vehicles` y `external_visits`). Defaults en Ajustes → Permisos / migración `016_external_visits_nav_module.sql`:

| Módulo | ADMINISTRADOR | OPERARIO | USUARIO |
|--------|---------------|----------|---------|
| `vehicles` (Vehículos residentes) | Ver + Gestionar | Sin acceso | Sin acceso |
| `external_visits` (Visitas externas) | Ver + Gestionar | Ver + Gestionar | Sin acceso |

| Acción | Quién (según matriz nav) |
|--------|---------------------------|
| **8.1** Listar vehículos residentes | Roles con **Ver** en `vehicles` |
| **8.2** Crear/editar vehículos residentes | Roles con **Gestionar** en `vehicles` |
| **8.3** Listar padrón global visitas externas (con convocatorias) | Roles con **Ver** en `external_visits` |
| **8.4** Crear/editar/eliminar padrón visitas externas (asignación casa+duración opcional al crear) | Roles con **Gestionar** en `external_visits` |

Rutas: `/vehicles` y `/external-visits` (mismo componente; pestañas según permiso). **Mi casa** autoriza visitas externas a la casa del vecino (no usa esta matriz nav).

---

### 9. Mascotas (Pets)

| Acción | role_system | person_type |
|--------|----------------|-------------|
| **9.1** Listar | `ADMINISTRADOR` | `PROPIETARIO` / `RESIDENTE` / `NULL` |
| | `OPERARIO` | `PROPIETARIO` / `RESIDENTE` / `INQUILINO` / `NULL` |
| **9.2** Crear/editar | Solo `ADMINISTRADOR` | `PROPIETARIO` / `RESIDENTE` / `NULL` |

---

### 10. Puntos de acceso

Solo administración con combinación válida admin:

| Acción | role_system | person_type |
|--------|----------------|-------------|
| Listar, crear, editar | `ADMINISTRADOR` | `PROPIETARIO` / `RESIDENTE` / `NULL` |

---

### 11. Configuración

Accesible para **todas las combinaciones válidas** del sistema (cada usuario ve y edita lo que su rol permita en pantalla):

| role_system | person_type |
|-------------|-------------|
| `ADMINISTRADOR` | `PROPIETARIO` / `RESIDENTE` / `NULL` |
| `OPERARIO` | `PROPIETARIO` / `RESIDENTE` / `INQUILINO` / `NULL` |
| `USUARIO` | `PROPIETARIO` / `RESIDENTE` / `INQUILINO` |

---

## Inicio rápido (Docker)

```bash
cp .env.example .env
docker compose up --build
```

- API: `http://localhost:8080`
- Frontend: `http://localhost:4200`

El frontend suele ejecutar `npm install --legacy-peer-deps` y `ng serve` dentro del contenedor; el servicio API monta `./server` para cambios en caliente.

## Documentación

| Archivo | Uso |
|---------|-----|
| Este **README** (sección *Matriz de roles y políticas de acceso*) | **Reglas de producto** — `role_system` × `person_type`, módulos, Mi casa, reservas, UI (documento visible o no) |
| [server/API.md](server/API.md) | **Contrato HTTP** — rutas, métodos, auth, política resumida alineada al README, registro público, RENIEC (referencia), errores |
| [ESTADO_Y_MEJORAS.md](ESTADO_Y_MEJORAS.md) | Estado del proyecto, roadmap, pendientes, registro de mejoras |
| [plans/REFERENCIA_TECNICA.md](plans/REFERENCIA_TECNICA.md) | Bases de datos, flujos `users`/`persons`/`house_members`, backup y despliegue, modelos, contexto ampliado |

**Base de datos:** en entornos nuevos, crear el esquema con `database/vc_create_database.sql` y datos de prueba con `database/vc_dev_data.sql` (orden y variables en la referencia técnica §4).

## Estructura principal

```
VC-INGRESO/
├── src/app/          # Angular (servicios, componentes, rutas)
├── server/           # API PHP (index.php, controllers/, db_connection.php)
├── database/         # vc_create_database.sql, vc_dev_data.sql, crearttech_clientes_schema.sql
├── server/API.md     # Referencia REST v1
└── plans/            # REFERENCIA_TECNICA.md
```

## Licencia
