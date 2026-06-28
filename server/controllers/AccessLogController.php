<?php
/**
 * AccessLogController - Controlador de Logs de Acceso
 * 
 * Maneja el registro de ingresos/egresos del condominio
 */

namespace Controllers;

require_once __DIR__ . '/../utils/Response.php';
require_once __DIR__ . '/../utils/Router.php';
require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../helpers/house_permissions.php';
require_once __DIR__ . '/../helpers/nav_permissions.php';
require_once __DIR__ . '/../helpers/event_log.php';
require_once __DIR__ . '/../helpers/temporary_visit.php';

use Utils\Response;
use Utils\Router;

class AccessLogController
{
    private $pdo;
    private $table = 'access_logs';

    public function __construct($pdo)
    {
        $this->pdo = $pdo;
    }

    /**
     * GET /api/v1/access-logs
     * Listar logs con filtros opcionales
     */
    public function index()
    {
        // Verificar autenticación
        requireAuth();

        $params = Router::getParams();
        $where = [];
        $values = [];

        // Filtro por access_point_id
        if (isset($params['access_point_id']) && $params['access_point_id']) {
            $where[] = 'access_point_id = ?';
            $values[] = $params['access_point_id'];
        }

        // Filtro por person_id
        if (isset($params['person_id']) && $params['person_id']) {
            $where[] = 'person_id = ?';
            $values[] = $params['person_id'];
        }

        // Filtro por tipo (INGRESO/EGRESO)
        if (isset($params['type']) && $params['type']) {
            $where[] = 'type = ?';
            $values[] = strtoupper($params['type']);
        }

        // Filtro por fecha específica
        if (isset($params['date']) && $params['date']) {
            $where[] = 'DATE(created_at) = ?';
            $values[] = $params['date'];
        }

        // Filtro por rango de fechas
        if (isset($params['start_date']) && isset($params['end_date'])) {
            $where[] = 'created_at BETWEEN ? AND ?';
            $values[] = $params['start_date'] . ' 00:00:00';
            $values[] = $params['end_date'] . ' 23:59:59';
        }

        // Construir query
        $sql = "SELECT * FROM {$this->table}";
        if (!empty($where)) {
            $sql .= ' WHERE ' . implode(' AND ', $where);
        }
        $sql .= ' ORDER BY created_at DESC';

        // Pagination
        $page = isset($params['page']) ? max(1, (int)$params['page']) : 1;
        $limit = isset($params['limit']) ? min(100, max(1, (int)$params['limit'])) : 50;
        $offset = ($page - 1) * $limit;
        $sql .= " LIMIT {$limit} OFFSET {$offset}";

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($values);
        $logs = $stmt->fetchAll(\PDO::FETCH_ASSOC);

        // Get total count
        $countSql = "SELECT COUNT(*) FROM {$this->table}";
        if (!empty($where)) {
            $countSql .= ' WHERE ' . implode(' AND ', $where);
        }
        $countStmt = $this->pdo->prepare($countSql);
        $countStmt->execute($values);
        $total = $countStmt->fetchColumn();

        Response::json([
            'success' => true,
            'data' => $logs,
            'pagination' => [
                'page' => $page,
                'limit' => $limit,
                'total' => $total,
                'total_pages' => ceil($total / $limit)
            ]
        ]);
    }

    /**
     * GET /api/v1/access-logs/:id
     * Obtener log por ID
     */
    public function show($id)
    {
        requireAuth();

        $stmt = $this->pdo->prepare("SELECT * FROM {$this->table} WHERE id = ?");
        $stmt->execute([$id]);
        $log = $stmt->fetch(\PDO::FETCH_ASSOC);

        if (!$log) {
            Response::json(['success' => false, 'error' => 'Log no encontrado'], 404);
            return;
        }

        Response::json(['success' => true, 'data' => $log]);
    }

    /**
     * POST /api/v1/access-logs
     * Crear nuevo registro de acceso. Auditoría: created_by_user_id (guardia/operario que registró).
     */
    public function store()
    {
        $auth = requireAuth();

        $data = json_decode(file_get_contents('php://input'), true);

        if (!$data) {
            Response::json(['success' => false, 'error' => 'Datos inválidos'], 400);
            return;
        }

        // Validar campos requeridos
        $required = ['access_point_id', 'type'];
        foreach ($required as $field) {
            if (!isset($data[$field]) || empty($data[$field])) {
                Response::json(['success' => false, 'error' => "Campo requerido: {$field}"], 400);
                return;
            }
        }

        // Validar tipo
        $validTypes = ['INGRESO', 'EGRESO'];
        $data['type'] = strtoupper($data['type']);
        if (!in_array($data['type'], $validTypes)) {
            Response::json(['success' => false, 'error' => 'Tipo inválido. Usar: INGRESO o EGRESO'], 400);
            return;
        }

        $createdByUserId = isset($auth['user_id']) ? (int)$auth['user_id'] : null;

        try {
            $stmt = $this->pdo->prepare("
                INSERT INTO {$this->table} 
                (access_point_id, person_id, doc_number, vehicle_id, type, observation, created_by_user_id, created_at) 
                VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
            ");

            $stmt->execute([
                $data['access_point_id'],
                $data['person_id'] ?? null,
                $data['doc_number'] ?? null,
                $data['vehicle_id'] ?? null,
                $data['type'],
                $data['observation'] ?? null,
                $createdByUserId
            ]);

            $id = $this->pdo->lastInsertId();

            recordEventLog($this->pdo, $auth, 'access_log.create', [
                'summary' => 'Registro de acceso manual: ' . $data['type'],
                'entity_type' => 'access_logs',
                'entity_id' => $id,
                'details' => [
                    'access_point_id' => $data['access_point_id'],
                    'type' => $data['type'],
                ],
            ]);

            Response::json([
                'success' => true,
                'data' => ['id' => $id, 'message' => 'Log registrado correctamente']
            ], 201);
        } catch (\PDOException $e) {
            Response::json(['success' => false, 'error' => 'Error al registrar: ' . $e->getMessage()], 500);
        }
    }

    /**
     * POST /api/v1/access-logs/temporary
     * Registra ingreso de visita externa en temporary_access_logs.
     */
    public function storeTemporary()
    {
        $auth = requireAuth();
        if (!isStaffRole($auth)) {
            Response::json(['success' => false, 'error' => 'Solo personal autorizado'], 403);
            return;
        }

        $data = json_decode(file_get_contents('php://input'), true);
        if (!$data) {
            Response::json(['success' => false, 'error' => 'Datos inválidos'], 400);
            return;
        }

        $accessPointId = (int) ($data['access_point_id'] ?? 0);
        $tempVisitId = (int) ($data['temp_visit_id'] ?? 0);
        $houseId = (int) ($data['house_id'] ?? 0);
        $assignmentId = (int) ($data['assignment_id'] ?? 0);

        if ($accessPointId <= 0 || $tempVisitId <= 0) {
            Response::json(['success' => false, 'error' => 'access_point_id y temp_visit_id requeridos'], 400);
            return;
        }

        $assignment = resolve_temp_visit_assignment_for_entry($this->pdo, $tempVisitId, $houseId, $assignmentId);
        if (!$assignment) {
            Response::json(['success' => false, 'error' => 'Autorización no vigente'], 422);
            return;
        }

        $assignmentId = (int) $assignment['assignment_id'];
        $houseId = (int) $assignment['house_id'];

        $openStmt = $this->pdo->prepare(
            'SELECT temp_access_log_id FROM temporary_access_logs
             WHERE temp_visit_id = ? AND house_id = ? AND temp_exit_time IS NULL
             LIMIT 1'
        );
        $openStmt->execute([$tempVisitId, $houseId]);
        if ($openStmt->fetchColumn()) {
            Response::json(['success' => false, 'error' => 'Ya hay una entrada sin salida registrada'], 409);
            return;
        }

        $createdByUserId = isset($auth['user_id']) ? (int) $auth['user_id'] : null;
        $statusValidated = trim((string) ($data['status_validated'] ?? 'PERMITIDO'));
        $now = date('Y-m-d H:i:s');
        $assignmentValidUntil = (string) ($assignment['valid_until'] ?? '');
        $authorizedMinutes = assignment_authorized_duration_minutes($assignment);
        $stayDeadline = date('Y-m-d H:i:s', strtotime($now) + ($authorizedMinutes * 60));

        try {
            $stmt = $this->pdo->prepare(
                "INSERT INTO temporary_access_logs
                 (temp_visit_id, assignment_id, assignment_valid_until, authorized_duration_minutes, stay_deadline,
                  temp_entry_time, access_point_id, status_validated, house_id, created_by_user_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            );
            $stmt->execute([
                $tempVisitId,
                $assignmentId,
                $assignmentValidUntil !== '' ? $assignmentValidUntil : null,
                $authorizedMinutes,
                $stayDeadline,
                $now,
                $accessPointId,
                $statusValidated !== '' ? $statusValidated : 'PERMITIDO',
                $houseId,
                $createdByUserId,
            ]);

            $id = (int) $this->pdo->lastInsertId();

            recordEventLog($this->pdo, $auth, 'temporary_access_log.create', [
                'summary' => 'Ingreso visita externa #' . $tempVisitId,
                'entity_type' => 'temporary_access_logs',
                'entity_id' => $id,
                'details' => [
                    'temp_visit_id' => $tempVisitId,
                    'house_id' => $houseId,
                    'assignment_id' => $assignmentId,
                    'authorized_duration_minutes' => $authorizedMinutes,
                    'stay_deadline' => $stayDeadline,
                ],
            ]);

            Response::json([
                'success' => true,
                'data' => [
                    'temp_access_log_id' => $id,
                    'authorized_duration_minutes' => $authorizedMinutes,
                    'stay_deadline' => $stayDeadline,
                    'assignment_valid_until' => $assignmentValidUntil,
                    'message' => 'Ingreso de visita externa registrado',
                ],
            ], 201);
        } catch (\PDOException $e) {
            Response::json(['success' => false, 'error' => 'Error al registrar: ' . $e->getMessage()], 500);
        }
    }

    /**
     * POST /api/v1/access-logs/temporary/exit
     * Cierra sesión abierta de visita externa (temp_exit_time).
     */
    public function exitTemporary()
    {
        $auth = requireAuth();
        if (!isStaffRole($auth)) {
            Response::json(['success' => false, 'error' => 'Solo personal autorizado'], 403);
            return;
        }

        $data = json_decode(file_get_contents('php://input'), true);
        if (!$data) {
            Response::json(['success' => false, 'error' => 'Datos inválidos'], 400);
            return;
        }

        $accessPointId = (int) ($data['access_point_id'] ?? 0);
        $tempVisitId = (int) ($data['temp_visit_id'] ?? 0);
        $houseId = (int) ($data['house_id'] ?? 0);

        if ($accessPointId <= 0 || $tempVisitId <= 0) {
            Response::json(['success' => false, 'error' => 'access_point_id y temp_visit_id requeridos'], 400);
            return;
        }

        $open = fetch_open_temp_access_log($this->pdo, $tempVisitId, $houseId);
        if (!$open) {
            Response::json(['success' => false, 'error' => 'No hay entrada abierta para esta visita'], 422);
            return;
        }

        $logId = (int) $open['temp_access_log_id'];
        $now = date('Y-m-d H:i:s');

        try {
            $stmt = $this->pdo->prepare(
                'UPDATE temporary_access_logs SET temp_exit_time = ? WHERE temp_access_log_id = ? AND temp_exit_time IS NULL'
            );
            $stmt->execute([$now, $logId]);

            $entryTs = strtotime((string) ($open['temp_entry_time'] ?? ''));
            $exitTs = strtotime($now);
            $permanenceMinutes = ($entryTs !== false && $exitTs !== false && $exitTs >= $entryTs)
                ? (int) max(0, round(($exitTs - $entryTs) / 60))
                : 0;

            $stayDeadline = $open['stay_deadline'] ?? null;
            $stayExceeded = false;
            if ($stayDeadline !== null && $stayDeadline !== '') {
                $stayExceeded = strtotime($now) > strtotime((string) $stayDeadline);
            } elseif (!empty($open['authorized_duration_minutes'])) {
                $stayExceeded = $permanenceMinutes > (int) $open['authorized_duration_minutes'];
            }

            recordEventLog($this->pdo, $auth, 'temporary_access_log.exit', [
                'summary' => 'Salida visita externa #' . $tempVisitId,
                'entity_type' => 'temporary_access_logs',
                'entity_id' => $logId,
                'details' => [
                    'temp_visit_id' => $tempVisitId,
                    'house_id' => (int) ($open['house_id'] ?? 0),
                    'permanence_minutes' => $permanenceMinutes,
                    'stay_exceeded' => $stayExceeded,
                ],
            ]);

            Response::json([
                'success' => true,
                'data' => [
                    'temp_access_log_id' => $logId,
                    'temp_exit_time' => $now,
                    'permanence_minutes' => $permanenceMinutes,
                    'stay_exceeded' => $stayExceeded,
                    'authorized_duration_minutes' => isset($open['authorized_duration_minutes'])
                        ? (int) $open['authorized_duration_minutes']
                        : null,
                    'message' => 'Salida de visita externa registrada',
                ],
            ]);
        } catch (\PDOException $e) {
            Response::json(['success' => false, 'error' => 'Error al registrar salida: ' . $e->getMessage()], 500);
        }
    }

    /**
     * GET /api/v1/access-logs/access-points
     * Listar puntos de acceso
     */
    public function accessPoints()
    {
        requireAuth();

        $stmt = $this->pdo->query("SELECT * FROM access_points ORDER BY name");
        $points = $stmt->fetchAll(\PDO::FETCH_ASSOC);

        Response::json(['success' => true, 'data' => $points]);
    }

    /** GET ?fecha=&access_point= — id o nombre de punto. Incluye access_logs + temporary_access_logs. */
    public function historyByDate()
    {
        $auth = requireAuth();
        $fecha = trim((string) ($_GET['fecha'] ?? ''));
        $ap = $this->accessPointQueryValue();
        if ($fecha === '') {
            Response::json(['success' => false, 'error' => 'fecha requerida'], 400);
            return;
        }

        $whereMain = ['DATE(al.created_at) = ?'];
        $paramsMain = [$fecha];
        $this->appendAccessPointFilter($ap, $whereMain, $paramsMain, 'al');

        $whereTemp = ['DATE(tal.temp_entry_time) = ?'];
        $paramsTemp = [$fecha];
        $this->appendAccessPointFilter($ap, $whereTemp, $paramsTemp, 'tal');

        $this->appendHistoryNeighborHouseScope($auth, $whereMain, $paramsMain, $whereTemp, $paramsTemp);

        $includeIncidents = isStaffRole($auth) && canViewModule($this->pdo, $auth, 'incidents');

        $sqlMain = $this->historyRowsSelectSql($includeIncidents) . ' WHERE ' . implode(' AND ', $whereMain);
        $sqlTemp = $this->historyTemporaryRowsSelectSql($includeIncidents) . ' WHERE ' . implode(' AND ', $whereTemp);
        $sql = 'SELECT * FROM ((' . $sqlMain . ') UNION ALL (' . $sqlTemp . ')) AS combined ORDER BY date_entry DESC';

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute(array_merge($paramsMain, $paramsTemp));
        Response::json($stmt->fetchAll(\PDO::FETCH_OBJ));
    }

    /** GET ?fecha_inicial=&fecha_final=&access_point= (opcional: vacío = todos los puntos). Incluye access_logs + temporary_access_logs. */
    public function historyByRange()
    {
        $auth = requireAuth();
        $fi = trim((string) ($_GET['fecha_inicial'] ?? ''));
        $ff = trim((string) ($_GET['fecha_final'] ?? ''));
        $ap = trim((string) ($_GET['access_point'] ?? ''));
        if ($fi === '' || $ff === '') {
            Response::json(['success' => false, 'error' => 'fecha_inicial y fecha_final requeridos'], 400);
            return;
        }
        $rangeStart = $this->normalizeHistoryRangeStart($fi);
        $rangeEnd = $this->normalizeHistoryRangeEnd($ff);

        $whereMain = ['al.created_at BETWEEN ? AND ?'];
        $paramsMain = [$rangeStart, $rangeEnd];
        $this->appendAccessPointFilter($ap, $whereMain, $paramsMain, 'al');

        $whereTemp = ['tal.temp_entry_time BETWEEN ? AND ?'];
        $paramsTemp = [$rangeStart, $rangeEnd];
        $this->appendAccessPointFilter($ap, $whereTemp, $paramsTemp, 'tal');

        $this->appendHistoryNeighborHouseScope($auth, $whereMain, $paramsMain, $whereTemp, $paramsTemp);

        $includeIncidents = isStaffRole($auth) && canViewModule($this->pdo, $auth, 'incidents');

        $sqlMain = $this->historyRowsSelectSql($includeIncidents) . ' WHERE ' . implode(' AND ', $whereMain);
        $sqlTemp = $this->historyTemporaryRowsSelectSql($includeIncidents) . ' WHERE ' . implode(' AND ', $whereTemp);
        $sql = 'SELECT * FROM ((' . $sqlMain . ') UNION ALL (' . $sqlTemp . ')) AS combined ORDER BY date_entry DESC';

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute(array_merge($paramsMain, $paramsTemp));
        Response::json($stmt->fetchAll(\PDO::FETCH_OBJ));
    }

    /** GET ?fecha=&access_point=&doc= — fecha YYYY-MM-DD. access_point vacío = todos. Incluye access_logs + temporary_access_logs. */
    public function historyByClient()
    {
        $auth = requireAuth();
        $fecha = trim((string) ($_GET['fecha'] ?? ''));
        $ap = $this->accessPointQueryValue();
        $doc = trim((string) ($_GET['doc'] ?? ''));
        if ($fecha === '') {
            Response::json(['success' => false, 'error' => 'fecha requerida'], 400);
            return;
        }
        $whereMain = ['DATE(al.created_at) = ?'];
        $paramsMain = [$fecha];
        $this->appendAccessPointFilter($ap, $whereMain, $paramsMain, 'al');
        if ($doc !== '') {
            $whereMain[] = '(al.doc_number = ? OR p.doc_number = ?)';
            $paramsMain[] = $doc;
            $paramsMain[] = $doc;
        }

        $whereTemp = ['DATE(tal.temp_entry_time) = ?'];
        $paramsTemp = [$fecha];
        $this->appendAccessPointFilter($ap, $whereTemp, $paramsTemp, 'tal');
        if ($doc !== '') {
            $whereTemp[] = '(tv.temp_visit_doc = ? OR tv.temp_visit_plate = ?)';
            $paramsTemp[] = $doc;
            $paramsTemp[] = $doc;
        }

        $this->appendHistoryNeighborHouseScope($auth, $whereMain, $paramsMain, $whereTemp, $paramsTemp);

        $sqlMain = $this->historyRowsSelectSql() . ' WHERE ' . implode(' AND ', $whereMain);
        $sqlTemp = $this->historyTemporaryRowsSelectSql() . ' WHERE ' . implode(' AND ', $whereTemp);
        $sql = 'SELECT * FROM ((' . $sqlMain . ') UNION ALL (' . $sqlTemp . ')) AS combined ORDER BY date_entry ASC';

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute(array_merge($paramsMain, $paramsTemp));
        Response::json($stmt->fetchAll(\PDO::FETCH_OBJ));
    }

    /**
     * Unifica collation UTF-8 para columnas de texto en UNION ALL (MySQL 1271 Illegal mix of collations).
     */
    private function historyUnionStr(string $exprSql): string
    {
        return "CONVERT(($exprSql) USING utf8mb4) COLLATE utf8mb4_unicode_ci";
    }

    /**
     * SELECT enriquecido para pantalla Historial (columnas alineadas al mat-table Angular).
     */
    private function historyRowsSelectSql(bool $includeIncidentCount = false): string
    {
        $t = $this->table;
        $s = fn (string $e) => $this->historyUnionStr($e);
        $incidentSelect = $includeIncidentCount
            ? ', COALESCE(ai_cnt.cnt, 0) AS incident_count'
            : ', 0 AS incident_count';
        $incidentJoin = $includeIncidentCount
            ? ' LEFT JOIN (
                SELECT access_log_id, COUNT(*) AS cnt
                FROM access_incidents
                WHERE access_log_id IS NOT NULL
                GROUP BY access_log_id
              ) ai_cnt ON ai_cnt.access_log_id = al.id'
            : '';

        return "
            SELECT
                al.id,
                al.access_point_id,
                al.person_id,
                {$s('al.doc_number')} AS doc_number,
                al.vehicle_id,
                {$s('al.type')} AS movement_type,
                {$s('al.observation')} AS observation_raw,
                al.created_by_user_id,
                al.created_at,
                al.updated_at,
                {$s('ap.name')} AS access_point_name,
                {$s("CASE WHEN al.vehicle_id IS NOT NULL THEN 'VEHÍCULO' ELSE 'PERSONA' END")} AS type,
                {$s('v.license_plate')} AS vehicle_plate,
                {$s("CONCAT_WS(' ', NULLIF(h.block_house,''), NULLIF(CAST(h.lot AS CHAR),''), NULLIF(h.apartment,''))")} AS house_address,
                al.created_at AS date_entry,
                CASE WHEN al.type = 'EGRESO' THEN al.updated_at ELSE NULL END AS date_exit,
                {$s("COALESCE(NULLIF(TRIM(al.observation), ''), NULLIF(p.status_validated, ''), '—')")} AS obs,
                {$s("COALESCE(NULLIF(TRIM(u.username_system), ''), IF(al.created_by_user_id IS NOT NULL, CONCAT('#', al.created_by_user_id), NULL), '—')")} AS `operator`,
                {$s("DATE_FORMAT(al.created_at, '%H:%i:%s')")} AS hour_entrance,
                1 AS visits,
                {$s("COALESCE(
                    NULLIF(TRIM(CONCAT(COALESCE(p.first_name,''),' ',COALESCE(p.paternal_surname,''),' ',COALESCE(p.maternal_surname,''))), ''),
                    NULLIF(TRIM(v.license_plate), ''),
                    NULLIF(TRIM(al.doc_number), ''),
                    '—'
                )")} AS name,
                {$s("COALESCE(NULLIF(UPPER(TRIM(p.person_type)), ''), '')")} AS person_category,
                {$s("'REGISTRY'")} AS log_source,
                NULL AS assignment_valid_until,
                NULL AS authorized_duration_minutes,
                NULL AS stay_deadline,
                NULL AS permanence_minutes,
                0 AS stay_exceeded,
                NULL AS session_open
                {$incidentSelect}
            FROM {$t} al
            LEFT JOIN access_points ap ON ap.id = al.access_point_id
            LEFT JOIN persons p ON p.id = al.person_id
            LEFT JOIN vehicles v ON v.vehicle_id = al.vehicle_id
            LEFT JOIN houses h ON h.house_id = COALESCE(p.house_id, v.house_id)
            LEFT JOIN users u ON u.user_id = al.created_by_user_id
            {$incidentJoin}
        ";
    }

    /**
     * Misma forma de columnas que historyRowsSelectSql(), desde temporary_access_logs + temporary_visits.
     * id negativo para no chocar con access_logs.id.
     */
    private function historyTemporaryRowsSelectSql(bool $includeIncidentCount = false): string
    {
        $s = fn (string $e) => $this->historyUnionStr($e);
        $incidentSelect = $includeIncidentCount
            ? ', COALESCE(ai_cnt.cnt, 0) AS incident_count'
            : ', 0 AS incident_count';
        $incidentJoin = $includeIncidentCount
            ? ' LEFT JOIN (
                SELECT temp_access_log_id, COUNT(*) AS cnt
                FROM access_incidents
                WHERE temp_access_log_id IS NOT NULL
                GROUP BY temp_access_log_id
              ) ai_cnt ON ai_cnt.temp_access_log_id = tal.temp_access_log_id'
            : '';

        return "
            SELECT
                -(tal.temp_access_log_id) AS id,
                tal.access_point_id,
                NULL AS person_id,
                {$s("COALESCE(NULLIF(TRIM(tv.temp_visit_doc), ''), '')")} AS doc_number,
                NULL AS vehicle_id,
                {$s("'INGRESO'")} AS movement_type,
                {$s('CAST(NULL AS CHAR(1))')} AS observation_raw,
                tal.created_by_user_id,
                tal.temp_entry_time AS created_at,
                COALESCE(tal.temp_exit_time, tal.temp_entry_time) AS updated_at,
                {$s('ap.name')} AS access_point_name,
                {$s("CASE WHEN tv.temp_visit_plate IS NOT NULL AND TRIM(tv.temp_visit_plate) <> '' THEN 'VEHÍCULO' ELSE 'PERSONA' END")} AS type,
                {$s('tv.temp_visit_plate')} AS vehicle_plate,
                {$s("CONCAT_WS(' ', NULLIF(h.block_house,''), NULLIF(CAST(h.lot AS CHAR),''), NULLIF(h.apartment,''))")} AS house_address,
                tal.temp_entry_time AS date_entry,
                tal.temp_exit_time AS date_exit,
                {$s("COALESCE(NULLIF(TRIM(tal.status_validated), ''), '—')")} AS obs,
                {$s("COALESCE(
                    NULLIF(TRIM(u.username_system), ''),
                    IF(COALESCE(tal.created_by_user_id, tal.operario_id) IS NOT NULL, CONCAT('#', COALESCE(tal.created_by_user_id, tal.operario_id)), NULL),
                    '—'
                )")} AS `operator`,
                {$s("DATE_FORMAT(tal.temp_entry_time, '%H:%i:%s')")} AS hour_entrance,
                1 AS visits,
                {$s("COALESCE(
                    NULLIF(TRIM(tv.temp_visit_name), ''),
                    NULLIF(TRIM(tv.temp_visit_plate), ''),
                    NULLIF(TRIM(tv.temp_visit_doc), ''),
                    '—'
                )")} AS name,
                {$s("'VISITA_EXTERNA'")} AS person_category,
                {$s("'EXTERNAL'")} AS log_source,
                tal.assignment_valid_until,
                tal.authorized_duration_minutes,
                tal.stay_deadline,
                CASE
                    WHEN tal.temp_exit_time IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, tal.temp_entry_time, tal.temp_exit_time)
                    ELSE TIMESTAMPDIFF(MINUTE, tal.temp_entry_time, NOW())
                END AS permanence_minutes,
                CASE
                    WHEN tal.stay_deadline IS NOT NULL AND tal.temp_exit_time IS NOT NULL AND tal.temp_exit_time > tal.stay_deadline THEN 1
                    WHEN tal.stay_deadline IS NOT NULL AND tal.temp_exit_time IS NULL AND NOW() > tal.stay_deadline THEN 1
                    WHEN tal.authorized_duration_minutes IS NOT NULL AND tal.temp_exit_time IS NOT NULL
                         AND TIMESTAMPDIFF(MINUTE, tal.temp_entry_time, tal.temp_exit_time) > tal.authorized_duration_minutes THEN 1
                    ELSE 0
                END AS stay_exceeded,
                IF(tal.temp_exit_time IS NULL, 1, 0) AS session_open
                {$incidentSelect}
            FROM temporary_access_logs tal
            LEFT JOIN temporary_visits tv ON tv.temp_visit_id = tal.temp_visit_id
            LEFT JOIN access_points ap ON ap.id = tal.access_point_id
            LEFT JOIN houses h ON h.house_id = tal.house_id
            LEFT JOIN users u ON u.user_id = COALESCE(tal.created_by_user_id, tal.operario_id)
            {$incidentJoin}
        ";
    }

    private function normalizeHistoryRangeStart(string $value): string
    {
        $value = trim($value);
        if ($value === '') {
            return $value;
        }
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) {
            return $value . ' 00:00:00';
        }

        return $value;
    }

    private function normalizeHistoryRangeEnd(string $value): string
    {
        $value = trim($value);
        if ($value === '') {
            return $value;
        }
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) {
            return $value . ' 23:59:59';
        }

        return $value;
    }

    /** Mismo criterio de domicilio que el historial unificado, solo sobre filas de access_logs (sin temporary). */
    private function appendNeighborHouseFilterAccessLogsOnly(array $auth, array &$where, array &$params): void
    {
        if (isAdminRole($auth)) {
            return;
        }
        $role = strtoupper(trim($auth['role_system'] ?? ''));
        if ($role === 'OPERARIO') {
            return;
        }
        $ids = getAccessibleHouseIds($this->pdo, $auth);
        if ($ids === []) {
            $where[] = '1 = 0';

            return;
        }
        $ph = implode(',', array_fill(0, count($ids), '?'));
        $where[] = "COALESCE(p.house_id, v.house_id) IN ({$ph})";
        foreach ($ids as $hid) {
            $params[] = $hid;
        }
    }

    /**
     * ADMINISTRADOR / OPERARIO: ven todo el historial.
     * USUARIO (vecino): solo access_logs y temporary_access_logs de su(s) domicilio(s).
     */
    private function appendHistoryNeighborHouseScope(
        array $auth,
        array &$whereMain,
        array &$paramsMain,
        array &$whereTemp,
        array &$paramsTemp
    ): void {
        if (isAdminRole($auth)) {
            return;
        }
        $role = strtoupper(trim($auth['role_system'] ?? ''));
        if ($role === 'OPERARIO') {
            return;
        }

        $ids = getAccessibleHouseIds($this->pdo, $auth);
        if ($ids === []) {
            $whereMain[] = '1 = 0';
            $whereTemp[] = '1 = 0';

            return;
        }
        $ph = implode(',', array_fill(0, count($ids), '?'));
        $whereMain[] = "COALESCE(p.house_id, v.house_id) IN ({$ph})";
        foreach ($ids as $hid) {
            $paramsMain[] = $hid;
        }
        $whereTemp[] = "tal.house_id IN ({$ph})";
        foreach ($ids as $hid) {
            $paramsTemp[] = $hid;
        }
    }

    /** Filtro por punto: id numérico o nombre (ap.name). $tableAlias p.ej. al o tal. */
    private function appendAccessPointFilter(string $ap, array &$where, array &$params, string $tableAlias = 'al'): void
    {
        if ($ap === '') {
            return;
        }
        if (ctype_digit($ap)) {
            $where[] = "{$tableAlias}.access_point_id = ?";
            $params[] = (int) $ap;
        } else {
            $where[] = 'ap.name = ?';
            $params[] = $ap;
        }
    }

    private function accessPointQueryValue(): string
    {
        return trim((string) ($_GET['access_point'] ?? ''));
    }
}
