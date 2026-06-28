<?php
/**
 * ReservationController - Controlador de Reservaciones
 *
 * Maneja las reservaciones de la Casa Club y áreas comunes.
 * Política de ventana fija: día D desde las 08:00 hasta día D+1 08:00 (día lógico 8–8).
 */

namespace Controllers;

require_once __DIR__ . '/../utils/Response.php';
require_once __DIR__ . '/../utils/Router.php';
require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../helpers/house_permissions.php';
require_once __DIR__ . '/../config/reservation_business_rules.php';
require_once __DIR__ . '/../helpers/holidays_ics.php';
require_once __DIR__ . '/../helpers/event_log.php';

use Utils\Response;
use Utils\Router;

class ReservationController
{
    private $pdo;
    private $table = 'reservations';
    private $accessPointsTable = 'access_points';
    private $housesTable = 'houses';

    /** Estados que bloquean el hueco en el calendario (PENDIENTE reserva hasta decisión o fin de evento si confirma). */
    private const BLOCKING_STATUSES = ['PENDIENTE', 'CONFIRMADA'];

    public function __construct($pdo)
    {
        $this->pdo = $pdo;
    }

    /**
     * GET /api/v1/reservations
     * Listar reservaciones con filtros
     */
    public function index()
    {
        $auth = requireAuth();
        if (!canAccessReservationsModule($this->pdo, $auth)) {
            Response::json(['success' => false, 'error' => 'Sin permiso para el módulo de reservaciones'], 403);
            return;
        }

        $params = Router::getParams();
        $where = [];
        $values = [];

        if (isset($params['access_point_id']) && $params['access_point_id']) {
            $where[] = 'r.access_point_id = ?';
            $values[] = $params['access_point_id'];
        }

        if (isset($params['person_id']) && $params['person_id']) {
            $where[] = 'r.person_id = ?';
            $values[] = $params['person_id'];
        }

        if (isset($params['date']) && $params['date']) {
            $where[] = 'DATE(r.reservation_date) = ?';
            $values[] = $params['date'];
        }

        if (isset($params['start_date']) && isset($params['end_date'])) {
            $where[] = 'r.reservation_date <= ? AND r.end_date >= ?';
            $values[] = $params['end_date'] . ' 23:59:59';
            $values[] = $params['start_date'] . ' 00:00:00';
        }

        if (isset($params['status']) && $params['status']) {
            $where[] = 'r.status = ?';
            $values[] = strtoupper($params['status']);
        }

        if (isset($params['house_id']) && $params['house_id']) {
            $where[] = 'r.house_id = ?';
            $values[] = $params['house_id'];
        }

        $this->applyIndexRoleScope($where, $values, $auth);

        $sql = "SELECT r.*, ap.name as area_name, ap.type as area_type 
                FROM {$this->table} r 
                LEFT JOIN {$this->accessPointsTable} ap ON r.access_point_id = ap.id";

        if (!empty($where)) {
            $sql .= ' WHERE ' . implode(' AND ', $where);
        }
        $sql .= ' ORDER BY r.reservation_date DESC';

        $page = isset($params['page']) ? max(1, (int) $params['page']) : 1;
        $limit = isset($params['limit']) ? min(100, max(1, (int) $params['limit'])) : 50;
        $offset = ($page - 1) * $limit;
        $sql .= " LIMIT {$limit} OFFSET {$offset}";

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($values);
        $reservations = $stmt->fetchAll(\PDO::FETCH_ASSOC);

        $countSql = "SELECT COUNT(*) FROM {$this->table} r";
        if (!empty($where)) {
            $countSql .= ' WHERE ' . implode(' AND ', $where);
        }
        $countStmt = $this->pdo->prepare($countSql);
        $countStmt->execute($values);
        $total = $countStmt->fetchColumn();

        Response::json([
            'success' => true,
            'data' => $reservations,
            'pagination' => [
                'page' => $page,
                'limit' => $limit,
                'total' => $total,
                'total_pages' => ceil($total / $limit),
            ],
        ]);
    }

    /**
     * GET /api/v1/reservations/calendar
     * Vista mensual para todos los domicilios; filas ajenas con payload mínimo (sin observación ni teléfono).
     */
    public function calendar()
    {
        $auth = requireAuth();
        if (!canAccessReservationsModule($this->pdo, $auth)) {
            Response::json(['success' => false, 'error' => 'Sin permiso para el módulo de reservaciones'], 403);
            return;
        }

        $params = Router::getParams();
        $start = isset($params['start_date']) ? trim((string) $params['start_date']) : '';
        $end = isset($params['end_date']) ? trim((string) $params['end_date']) : '';
        if ($start === '' || $end === '') {
            Response::json(['success' => false, 'error' => 'start_date y end_date son requeridos (YYYY-MM-DD)'], 400);
            return;
        }

        $where = ['r.reservation_date <= ?', 'r.end_date >= ?'];
        $values = [$end . ' 23:59:59', $start . ' 00:00:00'];

        if (isset($params['access_point_id']) && $params['access_point_id'] !== '' && $params['access_point_id'] !== null) {
            $where[] = 'r.access_point_id = ?';
            $values[] = (int) $params['access_point_id'];
        }

        $sql = "SELECT r.*, ap.name as area_name, ap.type as area_type,
                h.block_house, h.lot, h.apartment
                FROM {$this->table} r
                LEFT JOIN {$this->accessPointsTable} ap ON r.access_point_id = ap.id
                LEFT JOIN {$this->housesTable} h ON r.house_id = h.house_id
                WHERE " . implode(' AND ', $where) . '
                ORDER BY r.reservation_date ASC, r.id ASC';

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($values);
        $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);

        $out = [];
        foreach ($rows as $row) {
            $hid = (int) ($row['house_id'] ?? 0);
            $full = isAdminRole($auth) || ($hid > 0 && canAccessHouse($this->pdo, $auth, $hid));
            if ($full) {
                unset($row['block_house'], $row['lot'], $row['apartment']);
                $out[] = $row;
            } else {
                $out[] = [
                    'id' => (int) $row['id'],
                    'access_point_id' => (int) $row['access_point_id'],
                    'area_name' => $row['area_name'] ?? null,
                    'area_type' => $row['area_type'] ?? null,
                    'reservation_date' => $row['reservation_date'],
                    'end_date' => $row['end_date'],
                    'status' => $row['status'],
                    'house_label' => $this->formatHouseLabel($row),
                ];
            }
        }

        Response::json(['success' => true, 'data' => $out]);
    }

    /**
     * GET /api/v1/reservations/holidays
     * Festivos (Perú) desde ICS público de Google; solo informativo para el calendario.
     * Query: start_date, end_date (YYYY-MM-DD).
     */
    public function holidays(): void
    {
        $auth = requireAuth();
        if (!canAccessReservationsModule($this->pdo, $auth)) {
            Response::json(['success' => false, 'error' => 'Sin permiso para el módulo de reservaciones'], 403);
            return;
        }

        $params = Router::getParams();
        $start = isset($params['start_date']) ? trim((string) $params['start_date']) : '';
        $end = isset($params['end_date']) ? trim((string) $params['end_date']) : '';
        if ($start === '' || $end === '') {
            Response::json(['success' => false, 'error' => 'start_date y end_date son requeridos (YYYY-MM-DD)'], 400);
            return;
        }

        $list = holidays_ics_list_for_range($start, $end);
        Response::json(['success' => true, 'data' => $list]);
    }

    /**
     * GET /api/v1/reservations/:id
     */
    public function show($id)
    {
        $auth = requireAuth();
        if (!canAccessReservationsModule($this->pdo, $auth)) {
            Response::json(['success' => false, 'error' => 'Sin permiso para el módulo de reservaciones'], 403);
            return;
        }

        $stmt = $this->pdo->prepare("
            SELECT r.*, ap.name as area_name, ap.type as area_type 
            FROM {$this->table} r 
            LEFT JOIN {$this->accessPointsTable} ap ON r.access_point_id = ap.id 
            WHERE r.id = ?
        ");
        $stmt->execute([$id]);
        $reservation = $stmt->fetch(\PDO::FETCH_ASSOC);

        if (!$reservation) {
            Response::json(['success' => false, 'error' => 'Reservación no encontrada'], 404);
            return;
        }

        if (!$this->canViewReservation($auth, $reservation)) {
            Response::json(['success' => false, 'error' => 'Sin permiso para ver esta reservación'], 403);
            return;
        }

        Response::json(['success' => true, 'data' => $reservation]);
    }

    /**
     * POST /api/v1/reservations
     */
    public function store()
    {
        $auth = requireAuth();
        if (!canAccessReservationsModule($this->pdo, $auth)) {
            Response::json(['success' => false, 'error' => 'Sin permiso para el módulo de reservaciones'], 403);
            return;
        }

        $data = json_decode(file_get_contents('php://input'), true);

        if (!$data) {
            Response::json(['success' => false, 'error' => 'Datos inválidos'], 400);
            return;
        }

        foreach (['access_point_id', 'house_id'] as $field) {
            if (!isset($data[$field]) || $data[$field] === '' || $data[$field] === null) {
                Response::json(['success' => false, 'error' => "Campo requerido: {$field}"], 400);
                return;
            }
        }

        $resolved = $this->resolveEightToEightWindow($data);
        if ($resolved['error'] !== null) {
            Response::json(['success' => false, 'error' => $resolved['error']], 400);
            return;
        }
        $data['reservation_date'] = $resolved['start'];
        $data['end_date'] = $resolved['end'];

        $validStatuses = ['PENDIENTE', 'CONFIRMADA', 'CANCELADA', 'RECHAZADA', 'COMPLETADA'];
        $data['status'] = isset($data['status']) ? strtoupper($data['status']) : 'PENDIENTE';
        if (!in_array($data['status'], $validStatuses, true)) {
            Response::json(['success' => false, 'error' => 'Estado inválido'], 400);
            return;
        }
        if (!isAdminRole($auth)) {
            $data['status'] = 'PENDIENTE';
        }
        if (!canAccessHouse($this->pdo, $auth, (int) $data['house_id'])) {
            Response::json(['success' => false, 'error' => 'Sin permiso para crear reservas en esta casa'], 403);
            return;
        }

        if (empty($data['person_id']) && !empty($auth['person_id'])) {
            $data['person_id'] = (int) $auth['person_id'];
        }

        $err = $this->validateReservationBusinessRules(
            (int) $data['house_id'],
            (int) $data['access_point_id'],
            (string) $data['reservation_date'],
            (string) $data['end_date'],
            null
        );
        if ($err !== null) {
            Response::json(['success' => false, 'error' => $err], 400);
            return;
        }

        $createdByUserId = isset($auth['user_id']) ? (int) $auth['user_id'] : null;

        try {
            $stmt = $this->pdo->prepare("
                INSERT INTO {$this->table} 
                (access_point_id, person_id, house_id, reservation_date, end_date, 
                 status, observation, num_guests, contact_phone, created_by_user_id, created_at) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ");

            $stmt->execute([
                $data['access_point_id'],
                $data['person_id'] ?? null,
                $data['house_id'],
                $data['reservation_date'],
                $data['end_date'],
                $data['status'],
                $data['observation'] ?? null,
                $data['num_guests'] ?? 1,
                $data['contact_phone'] ?? null,
                $createdByUserId,
            ]);

            $id = $this->pdo->lastInsertId();

            recordEventLog($this->pdo, $auth, 'reservation.create', [
                'summary' => 'Reservación creada #' . $id,
                'entity_type' => 'reservations',
                'entity_id' => $id,
                'details' => ['status' => $data['status'], 'house_id' => $data['house_id']],
            ]);

            Response::json([
                'success' => true,
                'data' => ['id' => $id, 'message' => 'Reservación creada correctamente'],
            ], 201);
        } catch (\PDOException $e) {
            Response::json(['success' => false, 'error' => 'Error al crear: ' . $e->getMessage()], 500);
        }
    }

    /**
     * PUT /api/v1/reservations/:id
     */
    public function update($id)
    {
        $auth = requireAuth();
        if (!canAccessReservationsModule($this->pdo, $auth)) {
            Response::json(['success' => false, 'error' => 'Sin permiso para el módulo de reservaciones'], 403);
            return;
        }

        $data = json_decode(file_get_contents('php://input'), true);

        if (!$data) {
            Response::json(['success' => false, 'error' => 'Datos inválidos'], 400);
            return;
        }

        $stmt = $this->pdo->prepare("SELECT * FROM {$this->table} WHERE id = ?");
        $stmt->execute([$id]);
        $reservation = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (!$reservation) {
            Response::json(['success' => false, 'error' => 'Reservación no encontrada'], 404);
            return;
        }
        if (!$this->canViewReservation($auth, $reservation)) {
            Response::json(['success' => false, 'error' => 'Sin permiso para editar esta reservación'], 403);
            return;
        }

        if (isAdminRole($auth)) {
            $authHouseId = isset($auth['house_id']) ? (int) $auth['house_id'] : 0;
            $resHouseId = (int) ($reservation['house_id'] ?? 0);
            if ($authHouseId <= 0 || $resHouseId !== $authHouseId) {
                Response::json(['success' => false, 'error' => 'Solo puedes editar solicitudes de tu propio domicilio'], 403);
                return;
            }
        }

        if (!isAdminRole($auth) && !in_array($reservation['status'], ['PENDIENTE', 'CONFIRMADA'], true)) {
            Response::json(['success' => false, 'error' => 'No se puede modificar esta reservación en su estado actual'], 400);
            return;
        }
        if (!isAdminRole($auth) && $reservation['status'] === 'CONFIRMADA') {
            Response::json(['success' => false, 'error' => 'Las reservas confirmadas solo pueden cancelarse desde el cambio de estado'], 400);
            return;
        }
        if (isset($data['house_id']) && (int) $data['house_id'] !== (int) $reservation['house_id']) {
            if (!canAccessHouse($this->pdo, $auth, (int) $data['house_id'])) {
                Response::json(['success' => false, 'error' => 'Sin permiso para asignar esta casa a la reservación'], 403);
                return;
            }
        }

        unset($data['status']);

        $fields = [];
        $values = [];

        $allowedFields = [
            'access_point_id', 'person_id', 'house_id',
            'observation', 'num_guests', 'contact_phone',
        ];

        $datePayload = $data;
        if (
            array_key_exists('reservation_day', $data)
            || array_key_exists('reservation_date', $data)
            || array_key_exists('end_date', $data)
        ) {
            $mergedForResolve = array_merge($reservation, $data);
            $resolved = $this->resolveEightToEightWindow($mergedForResolve);
            if ($resolved['error'] !== null) {
                Response::json(['success' => false, 'error' => $resolved['error']], 400);
                return;
            }
            $data['reservation_date'] = $resolved['start'];
            $data['end_date'] = $resolved['end'];
            $allowedFields[] = 'reservation_date';
            $allowedFields[] = 'end_date';
        }

        foreach ($allowedFields as $field) {
            if (array_key_exists($field, $data)) {
                $fields[] = "{$field} = ?";
                $values[] = $data[$field];
            }
        }

        if (empty($fields)) {
            Response::json(['success' => false, 'error' => 'No hay campos para actualizar'], 400);
            return;
        }

        $mergedHouse = isset($data['house_id']) ? (int) $data['house_id'] : (int) $reservation['house_id'];
        $mergedAp = isset($data['access_point_id']) ? (int) $data['access_point_id'] : (int) $reservation['access_point_id'];
        $mergedStart = isset($data['reservation_date']) ? (string) $data['reservation_date'] : (string) $reservation['reservation_date'];
        $mergedEnd = isset($data['end_date']) ? (string) $data['end_date'] : (string) $reservation['end_date'];

        if (
            isset($data['house_id']) || isset($data['access_point_id'])
            || isset($data['reservation_date']) || isset($data['end_date'])
            || isset($data['reservation_day'])
        ) {
            $err = $this->validateReservationBusinessRules(
                $mergedHouse,
                $mergedAp,
                $mergedStart,
                $mergedEnd,
                (int) $id
            );
            if ($err !== null) {
                Response::json(['success' => false, 'error' => $err], 400);
                return;
            }
        }

        $values[] = $id;

        try {
            $sql = "UPDATE {$this->table} SET " . implode(', ', $fields) . ' WHERE id = ?';
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($values);

            recordEventLog($this->pdo, $auth, 'reservation.update', [
                'summary' => 'Reservación actualizada #' . $id,
                'entity_type' => 'reservations',
                'entity_id' => $id,
            ]);

            Response::json([
                'success' => true,
                'data' => ['id' => $id, 'message' => 'Reservación actualizada correctamente'],
            ]);
        } catch (\PDOException $e) {
            Response::json(['success' => false, 'error' => 'Error al actualizar: ' . $e->getMessage()], 500);
        }
    }

    /**
     * PUT /api/v1/reservations/:id/status
     */
    public function updateStatus($id)
    {
        $auth = requireAuth();
        if (!canAccessReservationsModule($this->pdo, $auth)) {
            Response::json(['success' => false, 'error' => 'Sin permiso para el módulo de reservaciones'], 403);
            return;
        }

        $stmt = $this->pdo->prepare("SELECT * FROM {$this->table} WHERE id = ?");
        $stmt->execute([$id]);
        $reservation = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (!$reservation) {
            Response::json(['success' => false, 'error' => 'Reservación no encontrada'], 404);
            return;
        }
        if (!$this->canViewReservation($auth, $reservation)) {
            Response::json(['success' => false, 'error' => 'Sin permiso para cambiar el estado de esta reservación'], 403);
            return;
        }

        $data = json_decode(file_get_contents('php://input'), true);

        if (!isset($data['status'])) {
            Response::json(['success' => false, 'error' => 'Estado requerido'], 400);
            return;
        }

        $validStatuses = ['PENDIENTE', 'CONFIRMADA', 'CANCELADA', 'RECHAZADA', 'COMPLETADA'];
        $newStatus = strtoupper((string) $data['status']);
        if (!in_array($newStatus, $validStatuses, true)) {
            Response::json(['success' => false, 'error' => 'Estado inválido'], 400);
            return;
        }

        $isAdmin = isAdminRole($auth);
        $current = strtoupper((string) ($reservation['status'] ?? ''));

        if (in_array($newStatus, ['CONFIRMADA', 'RECHAZADA', 'COMPLETADA'], true) && !$isAdmin) {
            Response::json(['success' => false, 'error' => 'Solo un administrador puede establecer este estado'], 403);
            return;
        }

        if ($newStatus === 'PENDIENTE' && !$isAdmin) {
            Response::json(['success' => false, 'error' => 'No autorizado'], 403);
            return;
        }

        if ($newStatus === 'COMPLETADA' && $current !== 'CONFIRMADA') {
            Response::json(['success' => false, 'error' => 'Solo se puede completar una reserva confirmada'], 400);
            return;
        }

        if ($newStatus === 'CANCELADA') {
            if (!in_array($current, ['PENDIENTE', 'CONFIRMADA'], true)) {
                Response::json(['success' => false, 'error' => 'No se puede cancelar en este estado'], 400);
                return;
            }
            $resHouseId = (int) ($reservation['house_id'] ?? 0);
            if ($isAdmin) {
                $authHouseId = isset($auth['house_id']) ? (int) $auth['house_id'] : 0;
                if ($authHouseId <= 0 || $resHouseId !== $authHouseId) {
                    Response::json(['success' => false, 'error' => 'Solo puedes cancelar solicitudes de tu domicilio'], 403);
                    return;
                }
            } elseif (!canAccessHouse($this->pdo, $auth, $resHouseId)) {
                Response::json(['success' => false, 'error' => 'Sin permiso para cancelar esta reservación'], 403);
                return;
            }
        }

        try {
            $stmt = $this->pdo->prepare("UPDATE {$this->table} SET status = ? WHERE id = ?");
            $stmt->execute([$newStatus, $id]);

            recordEventLog($this->pdo, $auth, 'reservation.status_change', [
                'summary' => 'Reservación #' . $id . ' → ' . $newStatus,
                'entity_type' => 'reservations',
                'entity_id' => $id,
                'details' => ['from' => $current, 'to' => $newStatus],
            ]);

            Response::json([
                'success' => true,
                'data' => ['id' => $id, 'status' => $newStatus],
            ]);
        } catch (\PDOException $e) {
            Response::json(['success' => false, 'error' => 'Error: ' . $e->getMessage()], 500);
        }
    }

    /**
     * DELETE /api/v1/reservations/:id
     */
    public function destroy($id)
    {
        $auth = requireAuth();
        if (!canAccessReservationsModule($this->pdo, $auth)) {
            Response::json(['success' => false, 'error' => 'Sin permiso para el módulo de reservaciones'], 403);
            return;
        }

        if (!isAdminRole($auth)) {
            Response::json(['success' => false, 'error' => 'Solo un administrador puede eliminar reservaciones'], 403);
            return;
        }

        $stmt = $this->pdo->prepare("SELECT id, house_id FROM {$this->table} WHERE id = ?");
        $stmt->execute([$id]);
        $reservation = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (!$reservation) {
            Response::json(['success' => false, 'error' => 'Reservación no encontrada'], 404);
            return;
        }

        try {
            $stmt = $this->pdo->prepare("DELETE FROM {$this->table} WHERE id = ?");
            $stmt->execute([$id]);
            Response::json(['success' => true, 'data' => ['id' => $id, 'message' => 'Reservación eliminada']]);
        } catch (\PDOException $e) {
            Response::json(['success' => false, 'error' => 'Error al eliminar: ' . $e->getMessage()], 500);
        }
    }

    /**
     * GET /api/v1/reservations/areas
     */
    public function areas()
    {
        $auth = requireAuth();
        if (!canAccessReservationsModule($this->pdo, $auth)) {
            Response::json(['success' => false, 'error' => 'Sin permiso para el módulo de reservaciones'], 403);
            return;
        }

        $stmt = $this->pdo->query("
            SELECT * FROM {$this->accessPointsTable}
            WHERE permite_reserva = 1
            AND is_active = 1
            ORDER BY name
        ");

        Response::json(['success' => true, 'data' => $stmt->fetchAll(\PDO::FETCH_ASSOC)]);
    }

    /**
     * GET /api/v1/reservations/availability
     * Indica si el día lógico 8–8 que contiene `date` está libre para reservar en el área.
     */
    public function availability()
    {
        $auth = requireAuth();
        if (!canAccessReservationsModule($this->pdo, $auth)) {
            Response::json(['success' => false, 'error' => 'Sin permiso para el módulo de reservaciones'], 403);
            return;
        }

        $accessPointId = $_GET['access_point_id'] ?? null;
        $date = $_GET['date'] ?? null;

        if (!$accessPointId || !$date) {
            Response::json(['success' => false, 'error' => 'access_point_id y date requeridos'], 400);
            return;
        }

        $stmtAp = $this->pdo->prepare(
            "SELECT id, permite_reserva, is_active FROM {$this->accessPointsTable} WHERE id = ? LIMIT 1"
        );
        $stmtAp->execute([(int) $accessPointId]);
        $apRow = $stmtAp->fetch(\PDO::FETCH_ASSOC);
        if (!$apRow) {
            Response::json(['success' => false, 'error' => 'Punto de acceso no encontrado'], 404);
            return;
        }
        if ((int) ($apRow['is_active'] ?? 0) !== 1) {
            Response::json(['success' => false, 'error' => 'El punto de acceso no está activo'], 400);
            return;
        }
        if ((int) ($apRow['permite_reserva'] ?? 0) !== 1) {
            Response::json(['success' => false, 'error' => 'Este punto de acceso no admite reservaciones'], 400);
            return;
        }

        $resolved = $this->windowStringsFromDayYmd((string) $date);
        if ($resolved['error'] !== null) {
            Response::json(['success' => false, 'error' => $resolved['error']], 400);
            return;
        }
        $winStart = $resolved['start'];
        $winEnd = $resolved['end'];

        $placeholders = implode(',', array_fill(0, count(self::BLOCKING_STATUSES), '?'));
        $stmt = $this->pdo->prepare("
            SELECT COUNT(*) FROM {$this->table}
            WHERE access_point_id = ?
            AND status IN ({$placeholders})
            AND reservation_date = ?
        ");
        $params = array_merge([(int) $accessPointId], self::BLOCKING_STATUSES, [$winStart]);
        $stmt->execute($params);
        $blocked = (int) $stmt->fetchColumn() > 0;

        Response::json([
            'success' => true,
            'data' => [
                'date' => $date,
                'access_point_id' => (int) $accessPointId,
                'available' => !$blocked,
                'logical_window_start' => $winStart,
                'logical_window_end' => $winEnd,
            ],
        ]);
    }

    private function applyIndexRoleScope(array &$where, array &$values, array $auth): void
    {
        if (isAdminRole($auth)) {
            return;
        }

        $ids = getAccessibleHouseIds($this->pdo, $auth);
        if (empty($ids)) {
            $where[] = '1 = 0';

            return;
        }
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $where[] = "r.house_id IN ({$placeholders})";
        foreach ($ids as $hid) {
            $values[] = $hid;
        }
    }

    private function canViewReservation(array $auth, array $reservation): bool
    {
        if (isAdminRole($auth)) {
            return true;
        }
        $hid = (int) ($reservation['house_id'] ?? 0);
        if ($hid <= 0) {
            return false;
        }

        return canAccessHouse($this->pdo, $auth, $hid);
    }

    /**
     * @return array{start: string, end: string, error: ?string}
     */
    private function resolveEightToEightWindow(array $data): array
    {
        if (!empty($data['reservation_day'])) {
            return $this->windowStringsFromDayYmd(trim((string) $data['reservation_day']));
        }

        if (!empty($data['reservation_date'])) {
            $raw = trim((string) $data['reservation_date']);
            $dayPart = strlen($raw) >= 10 ? substr($raw, 0, 10) : $raw;

            return $this->windowStringsFromDayYmd($dayPart);
        }

        return ['start' => '', 'end' => '', 'error' => 'Indique reservation_day (YYYY-MM-DD) o reservation_date'];
    }

    /**
     * @return array{start: string, end: string, error: ?string}
     */
    private function windowStringsFromDayYmd(string $dayYmd): array
    {
        $d = \DateTime::createFromFormat('Y-m-d', $dayYmd);
        if (!$d || $d->format('Y-m-d') !== $dayYmd) {
            return ['start' => '', 'end' => '', 'error' => 'Fecha de día inválida (use YYYY-MM-DD)'];
        }
        $h = (int) RESERVATION_DAY_START_HOUR;
        $d->setTime($h, 0, 0);
        $start = $d->format('Y-m-d H:i:s');
        $d->modify('+1 day');
        $end = $d->format('Y-m-d H:i:s');

        return ['start' => $start, 'end' => $end, 'error' => null];
    }

    private function formatHouseLabel(array $row): string
    {
        $mz = strtoupper(trim((string) ($row['block_house'] ?? '')));
        $lt = trim((string) ($row['lot'] ?? ''));
        $apt = trim((string) ($row['apartment'] ?? ''));
        $out = 'MZ:' . ($mz !== '' ? $mz : '-') . ' LT:' . ($lt !== '' ? $lt : '-');
        if ($apt !== '') {
            $out .= ' DPTO:' . strtoupper($apt);
        }

        return $out;
    }

    /**
     * Ventana 8–8 exacta, tope mensual por casa y una reserva bloqueante por área y día lógico.
     *
     * @param int|null $excludeReservationId id al editar
     */
    private function validateReservationBusinessRules(
        int $houseId,
        int $accessPointId,
        string $reservationDateStr,
        string $endDateStr,
        $excludeReservationId
    ): ?string {
        if ($accessPointId <= 0) {
            return 'Área de acceso no válida';
        }
        $stmtAp = $this->pdo->prepare(
            "SELECT id, permite_reserva, is_active FROM {$this->accessPointsTable} WHERE id = ? LIMIT 1"
        );
        $stmtAp->execute([$accessPointId]);
        $apRow = $stmtAp->fetch(\PDO::FETCH_ASSOC);
        if (!$apRow) {
            return 'Área de acceso no encontrada';
        }
        if ((int) ($apRow['is_active'] ?? 0) !== 1) {
            return 'El punto de acceso no está activo';
        }
        if ((int) ($apRow['permite_reserva'] ?? 0) !== 1) {
            return 'Este punto de acceso no admite reservaciones';
        }

        try {
            $start = new \DateTime($reservationDateStr);
            $end = new \DateTime($endDateStr);
        } catch (\Exception $e) {
            return 'Fechas inválidas';
        }

        if ($end <= $start) {
            return 'La fecha de fin debe ser posterior al inicio';
        }

        $expected = clone $start;
        $expected->modify('+1 day');
        $h = (int) RESERVATION_DAY_START_HOUR;
        if ((int) $start->format('H') !== $h || (int) $start->format('i') !== 0 || (int) $start->format('s') !== 0) {
            return 'La reserva debe comenzar a las ' . $h . ':00 del día elegido';
        }
        if ($end->format('Y-m-d H:i:s') !== $expected->format('Y-m-d H:i:s')) {
            return 'La reserva debe cubrir exactamente 24 horas hasta las ' . $h . ':00 del día siguiente';
        }

        $year = (int) $start->format('Y');
        $month = (int) $start->format('n');

        $blockingRulesApply = true;
        if ($excludeReservationId !== null && $excludeReservationId !== '') {
            $stmtSt = $this->pdo->prepare("SELECT status FROM {$this->table} WHERE id = ? LIMIT 1");
            $stmtSt->execute([(int) $excludeReservationId]);
            $rowSt = $stmtSt->fetch(\PDO::FETCH_ASSOC);
            if ($rowSt && !in_array(strtoupper((string) ($rowSt['status'] ?? '')), ['PENDIENTE', 'CONFIRMADA'], true)) {
                $blockingRulesApply = false;
            }
        }

        if ($blockingRulesApply) {
            $countSql = "
                SELECT COUNT(*) FROM {$this->table}
                WHERE house_id = ?
                AND status IN ('PENDIENTE', 'CONFIRMADA')
                AND YEAR(reservation_date) = ?
                AND MONTH(reservation_date) = ?
            ";
            $countParams = [$houseId, $year, $month];
            if ($excludeReservationId !== null && $excludeReservationId !== '') {
                $countSql .= ' AND id != ?';
                $countParams[] = (int) $excludeReservationId;
            }
            $stmt = $this->pdo->prepare($countSql);
            $stmt->execute($countParams);
            $othersInMonth = (int) $stmt->fetchColumn();
            if ($othersInMonth >= RESERVATION_MAX_ACTIVE_PER_MONTH_PER_HOUSE) {
                return 'Se alcanzó el máximo de reservas activas por mes para esta casa (' . RESERVATION_MAX_ACTIVE_PER_MONTH_PER_HOUSE . ')';
            }
        }

        if (!$blockingRulesApply) {
            return null;
        }

        $overlapSql = "
            SELECT COUNT(*) FROM {$this->table}
            WHERE access_point_id = ?
            AND status IN ('PENDIENTE', 'CONFIRMADA')
            AND reservation_date = ?
        ";
        $overlapParams = [$accessPointId, $reservationDateStr];
        if ($excludeReservationId !== null && $excludeReservationId !== '') {
            $overlapSql .= ' AND id != ?';
            $overlapParams[] = (int) $excludeReservationId;
        }
        $stmtO = $this->pdo->prepare($overlapSql);
        $stmtO->execute($overlapParams);
        if ((int) $stmtO->fetchColumn() > 0) {
            return 'Ya existe una reserva pendiente o confirmada en esta área para ese día (política 8:00 a 8:00)';
        }

        return null;
    }
}
