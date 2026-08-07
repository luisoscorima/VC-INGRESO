<?php
/**
 * LPR — cámaras fijas de garita y eventos de reconocimiento de placas.
 */

namespace Controllers;

require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../helpers/house_permissions.php';
require_once __DIR__ . '/../helpers/license_plate.php';
require_once __DIR__ . '/../helpers/nav_permissions.php';
require_once __DIR__ . '/../helpers/temporary_visit.php';
require_once __DIR__ . '/../helpers/event_log.php';
require_once __DIR__ . '/../utils/Response.php';
require_once __DIR__ . '/AccessQrController.php';

use Utils\Response;

class LprController
{
    /** @var \PDO */
    private $pdo;

    public function __construct(\PDO $pdo)
    {
        $this->pdo = $pdo;
    }

    /**
     * GET /api/v1/lpr/cameras
     */
    public function listCameras(): void
    {
        $auth = requireAuth();
        if (!canViewModule($this->pdo, $auth, 'lpr')) {
            Response::error('Sin permiso para ver cámaras LPR', 403);
            return;
        }

        $stmt = $this->pdo->query(
            'SELECT c.*, ap.name AS access_point_name
             FROM lpr_cameras c
             INNER JOIN access_points ap ON ap.id = c.access_point_id
             ORDER BY c.camera_id ASC'
        );
        Response::success($stmt->fetchAll(\PDO::FETCH_ASSOC) ?: []);
    }

    /**
     * POST /api/v1/lpr/cameras
     */
    public function createCamera(): void
    {
        $auth = requireAuth();
        if (!canManageModule($this->pdo, $auth, 'lpr')) {
            Response::error('Sin permiso para gestionar cámaras LPR', 403);
            return;
        }

        $data = json_decode(file_get_contents('php://input'), true);
        if (!is_array($data)) {
            Response::error('JSON inválido', 400);
            return;
        }

        $row = $this->validateCameraPayload($data, true);
        if (isset($row['error'])) {
            Response::error($row['error'], 400);
            return;
        }

        $stmt = $this->pdo->prepare(
            'INSERT INTO lpr_cameras
             (name, access_point_id, direction, stream_url, snapshot_url, is_enabled,
              min_confidence, debounce_seconds, poll_interval_ms)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $row['name'],
            $row['access_point_id'],
            $row['direction'],
            $row['stream_url'],
            $row['snapshot_url'],
            $row['is_enabled'],
            $row['min_confidence'],
            $row['debounce_seconds'],
            $row['poll_interval_ms'],
        ]);
        $id = (int) $this->pdo->lastInsertId();

        recordEventLog($this->pdo, $auth, 'lpr_camera.create', [
            'summary' => 'Cámara LPR creada: ' . $row['name'],
            'entity_type' => 'lpr_cameras',
            'entity_id' => $id,
        ]);

        Response::success($this->fetchCamera($id), 'Cámara creada', 201);
    }

    /**
     * PUT /api/v1/lpr/cameras/:id
     */
    public function updateCamera(int $id): void
    {
        $auth = requireAuth();
        if (!canManageModule($this->pdo, $auth, 'lpr')) {
            Response::error('Sin permiso para gestionar cámaras LPR', 403);
            return;
        }
        if ($id <= 0 || !$this->fetchCamera($id)) {
            Response::error('Cámara no encontrada', 404);
            return;
        }

        $data = json_decode(file_get_contents('php://input'), true);
        if (!is_array($data)) {
            Response::error('JSON inválido', 400);
            return;
        }

        $row = $this->validateCameraPayload($data, false);
        if (isset($row['error'])) {
            Response::error($row['error'], 400);
            return;
        }

        $stmt = $this->pdo->prepare(
            'UPDATE lpr_cameras SET
                name = ?, access_point_id = ?, direction = ?, stream_url = ?, snapshot_url = ?,
                is_enabled = ?, min_confidence = ?, debounce_seconds = ?, poll_interval_ms = ?
             WHERE camera_id = ?'
        );
        $stmt->execute([
            $row['name'],
            $row['access_point_id'],
            $row['direction'],
            $row['stream_url'],
            $row['snapshot_url'],
            $row['is_enabled'],
            $row['min_confidence'],
            $row['debounce_seconds'],
            $row['poll_interval_ms'],
            $id,
        ]);

        recordEventLog($this->pdo, $auth, 'lpr_camera.update', [
            'summary' => 'Cámara LPR actualizada #' . $id,
            'entity_type' => 'lpr_cameras',
            'entity_id' => $id,
        ]);

        Response::success($this->fetchCamera($id), 'Cámara actualizada');
    }

    /**
     * GET /api/v1/lpr/events
     */
    public function listEvents(): void
    {
        $auth = requireAuth();
        if (!canViewModule($this->pdo, $auth, 'lpr') && !isStaffRole($auth)) {
            Response::error('Sin permiso para ver eventos LPR', 403);
            return;
        }

        $limit = isset($_GET['limit']) ? (int) $_GET['limit'] : 50;
        if ($limit < 1) {
            $limit = 50;
        }
        if ($limit > 200) {
            $limit = 200;
        }

        $cameraId = isset($_GET['camera_id']) ? (int) $_GET['camera_id'] : 0;
        $result = isset($_GET['result']) ? trim((string) $_GET['result']) : '';

        $sql = 'SELECT e.*, c.name AS camera_name, ap.name AS access_point_name
                FROM lpr_events e
                INNER JOIN lpr_cameras c ON c.camera_id = e.camera_id
                INNER JOIN access_points ap ON ap.id = e.access_point_id
                WHERE 1=1';
        $params = [];
        if ($cameraId > 0) {
            $sql .= ' AND e.camera_id = ?';
            $params[] = $cameraId;
        }
        if ($result !== '') {
            $sql .= ' AND e.result = ?';
            $params[] = strtoupper($result);
        }
        $sql .= ' ORDER BY e.event_id DESC LIMIT ' . $limit;

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        Response::success($stmt->fetchAll(\PDO::FETCH_ASSOC) ?: []);
    }

    /**
     * GET /api/v1/lpr/worker/cameras — lista operativa para el worker (token LPR).
     */
    public function workerCameras(): void
    {
        requireLprServiceAuth();

        $stmt = $this->pdo->query(
            "SELECT camera_id, name, access_point_id, direction, stream_url, snapshot_url,
                    min_confidence, debounce_seconds, poll_interval_ms, last_seen_at
             FROM lpr_cameras
             WHERE is_enabled = 1
               AND (
                    (stream_url IS NOT NULL AND TRIM(stream_url) <> '')
                    OR (snapshot_url IS NOT NULL AND TRIM(snapshot_url) <> '')
               )
             ORDER BY camera_id ASC"
        );
        Response::success($stmt->fetchAll(\PDO::FETCH_ASSOC) ?: []);
    }

    /**
     * POST /api/v1/lpr/events — ingesta desde worker; auto-registra si autorizado.
     */
    public function ingestEvent(): void
    {
        $auth = requireLprServiceAuth();

        $data = json_decode(file_get_contents('php://input'), true);
        if (!is_array($data)) {
            Response::error('JSON inválido', 400);
            return;
        }

        $cameraId = (int) ($data['camera_id'] ?? 0);
        $rawPlate = (string) ($data['license_plate'] ?? '');
        $confidence = isset($data['confidence']) ? (float) $data['confidence'] : null;
        $rawOcr = isset($data['raw_ocr']) ? trim((string) $data['raw_ocr']) : null;

        if ($cameraId <= 0) {
            Response::error('camera_id requerido', 400);
            return;
        }

        $camera = $this->fetchCamera($cameraId);
        if (!$camera || !(int) $camera['is_enabled']) {
            Response::error('Cámara no encontrada o deshabilitada', 404);
            return;
        }

        $this->pdo->prepare('UPDATE lpr_cameras SET last_seen_at = NOW() WHERE camera_id = ?')
            ->execute([$cameraId]);

        $plate = normalize_license_plate($rawPlate);
        $accessPointId = (int) $camera['access_point_id'];
        $direction = strtoupper((string) $camera['direction']) === 'EGRESO' ? 'EGRESO' : 'INGRESO';
        $minConf = (float) $camera['min_confidence'];
        $debounce = (int) $camera['debounce_seconds'];
        if ($debounce < 5) {
            $debounce = 5;
        }

        $snapshotUrl = $this->persistSnapshotBase64(
            isset($data['snapshot_base64']) ? (string) $data['snapshot_base64'] : null,
            $plate !== '' ? $plate : 'unknown'
        );

        if ($plate === '') {
            $eventId = $this->insertEvent([
                'camera_id' => $cameraId,
                'access_point_id' => $accessPointId,
                'license_plate' => '?',
                'confidence' => $confidence,
                'direction' => $direction,
                'result' => 'ERROR',
                'status_validated' => null,
                'message' => 'Placa vacía tras normalizar',
                'vehicle_id' => null,
                'temp_visit_id' => null,
                'access_log_id' => null,
                'temp_access_log_id' => null,
                'snapshot_url' => $snapshotUrl,
                'raw_ocr' => $rawOcr,
            ]);
            Response::success(['event_id' => $eventId, 'result' => 'ERROR'], 'Placa inválida');
            return;
        }

        if ($confidence !== null && $confidence < $minConf) {
            $eventId = $this->insertEvent([
                'camera_id' => $cameraId,
                'access_point_id' => $accessPointId,
                'license_plate' => $plate,
                'confidence' => $confidence,
                'direction' => $direction,
                'result' => 'LOW_CONFIDENCE',
                'status_validated' => null,
                'message' => 'Confianza por debajo del umbral (' . $minConf . ')',
                'vehicle_id' => null,
                'temp_visit_id' => null,
                'access_log_id' => null,
                'temp_access_log_id' => null,
                'snapshot_url' => $snapshotUrl,
                'raw_ocr' => $rawOcr,
            ]);
            Response::success(['event_id' => $eventId, 'result' => 'LOW_CONFIDENCE'], 'Baja confianza');
            return;
        }

        if ($this->isDuplicate($cameraId, $plate, $debounce)) {
            $eventId = $this->insertEvent([
                'camera_id' => $cameraId,
                'access_point_id' => $accessPointId,
                'license_plate' => $plate,
                'confidence' => $confidence,
                'direction' => $direction,
                'result' => 'DUPLICATE',
                'status_validated' => null,
                'message' => 'Debounce ' . $debounce . 's',
                'vehicle_id' => null,
                'temp_visit_id' => null,
                'access_log_id' => null,
                'temp_access_log_id' => null,
                'snapshot_url' => $snapshotUrl,
                'raw_ocr' => $rawOcr,
            ]);
            Response::success(['event_id' => $eventId, 'result' => 'DUPLICATE'], 'Duplicado');
            return;
        }

        $qr = new AccessQrController($this->pdo);
        $resolved = $qr->resolveLicensePlate($plate, 'lpr');
        $status = strtoupper((string) ($resolved['status_validated'] ?? 'DENEGADO'));
        $allow = !empty($resolved['allow_entry']);
        $pendingHouse = !empty($resolved['pending_house_selection']);
        $vehicleId = isset($resolved['vehicle_id']) && (int) $resolved['vehicle_id'] > 0
            ? (int) $resolved['vehicle_id']
            : null;
        $tempVisitId = isset($resolved['temp_visit_id']) && (int) $resolved['temp_visit_id'] > 0
            ? (int) $resolved['temp_visit_id']
            : null;

        if ($pendingHouse) {
            $eventId = $this->insertEvent([
                'camera_id' => $cameraId,
                'access_point_id' => $accessPointId,
                'license_plate' => $plate,
                'confidence' => $confidence,
                'direction' => $direction,
                'result' => 'PENDING_HOUSE',
                'status_validated' => $status,
                'message' => (string) ($resolved['message'] ?? 'Seleccione casa en portería'),
                'vehicle_id' => $vehicleId,
                'temp_visit_id' => $tempVisitId,
                'access_log_id' => null,
                'temp_access_log_id' => null,
                'snapshot_url' => $snapshotUrl,
                'raw_ocr' => $rawOcr,
            ]);
            Response::success([
                'event_id' => $eventId,
                'result' => 'PENDING_HOUSE',
                'license_plate' => $plate,
                'alert' => true,
            ], 'Requiere selección de casa');
            return;
        }

        if (!$allow) {
            $eventId = $this->insertEvent([
                'camera_id' => $cameraId,
                'access_point_id' => $accessPointId,
                'license_plate' => $plate,
                'confidence' => $confidence,
                'direction' => $direction,
                'result' => 'DENIED',
                'status_validated' => $status !== '' ? $status : 'DENEGADO',
                'message' => (string) ($resolved['message'] ?? 'Acceso denegado'),
                'vehicle_id' => $vehicleId,
                'temp_visit_id' => $tempVisitId,
                'access_log_id' => null,
                'temp_access_log_id' => null,
                'snapshot_url' => $snapshotUrl,
                'raw_ocr' => $rawOcr,
            ]);
            Response::success([
                'event_id' => $eventId,
                'result' => 'DENIED',
                'license_plate' => $plate,
                'alert' => true,
                'status_validated' => $status,
            ], 'Denegado');
            return;
        }

        try {
            $reg = $this->registerAccess($auth, $resolved, $accessPointId, $direction, $status);
        } catch (\Throwable $e) {
            $eventId = $this->insertEvent([
                'camera_id' => $cameraId,
                'access_point_id' => $accessPointId,
                'license_plate' => $plate,
                'confidence' => $confidence,
                'direction' => $direction,
                'result' => 'ERROR',
                'status_validated' => $status,
                'message' => 'Error al registrar: ' . $e->getMessage(),
                'vehicle_id' => $vehicleId,
                'temp_visit_id' => $tempVisitId,
                'access_log_id' => null,
                'temp_access_log_id' => null,
                'snapshot_url' => $snapshotUrl,
                'raw_ocr' => $rawOcr,
            ]);
            Response::error('No se pudo registrar el acceso', 500, [
                'event_id' => $eventId,
                'detail' => $e->getMessage(),
            ]);
            return;
        }

        $eventId = $this->insertEvent([
            'camera_id' => $cameraId,
            'access_point_id' => $accessPointId,
            'license_plate' => $plate,
            'confidence' => $confidence,
            'direction' => $direction,
            'result' => 'REGISTERED',
            'status_validated' => $status,
            'message' => $reg['message'] ?? 'Registrado por LPR',
            'vehicle_id' => $vehicleId,
            'temp_visit_id' => $tempVisitId,
            'access_log_id' => $reg['access_log_id'] ?? null,
            'temp_access_log_id' => $reg['temp_access_log_id'] ?? null,
            'snapshot_url' => $snapshotUrl,
            'raw_ocr' => $rawOcr,
        ]);

        Response::success([
            'event_id' => $eventId,
            'result' => 'REGISTERED',
            'license_plate' => $plate,
            'direction' => $direction,
            'access_log_id' => $reg['access_log_id'] ?? null,
            'temp_access_log_id' => $reg['temp_access_log_id'] ?? null,
            'alert' => false,
        ], 'Registrado', 201);
    }

    /**
     * @param array<string,mixed> $data
     * @return array<string,mixed>
     */
    private function validateCameraPayload(array $data, bool $creating): array
    {
        $name = trim((string) ($data['name'] ?? ''));
        if ($name === '') {
            return ['error' => 'El nombre es obligatorio'];
        }
        $accessPointId = (int) ($data['access_point_id'] ?? 0);
        if ($accessPointId <= 0) {
            return ['error' => 'access_point_id obligatorio'];
        }
        $apStmt = $this->pdo->prepare(
            'SELECT id FROM access_points WHERE id = ? AND is_active = 1 LIMIT 1'
        );
        $apStmt->execute([$accessPointId]);
        if (!$apStmt->fetchColumn()) {
            return ['error' => 'Punto de acceso inactivo o no encontrado'];
        }

        $direction = strtoupper(trim((string) ($data['direction'] ?? 'INGRESO')));
        if ($direction !== 'INGRESO' && $direction !== 'EGRESO') {
            $direction = 'INGRESO';
        }

        $streamUrl = trim((string) ($data['stream_url'] ?? ''));
        $snapshotUrl = trim((string) ($data['snapshot_url'] ?? ''));
        $streamUrl = $streamUrl === '' ? null : $streamUrl;
        $snapshotUrl = $snapshotUrl === '' ? null : $snapshotUrl;
        if ($streamUrl === null && $snapshotUrl === null) {
            return ['error' => 'Indique stream_url (RTSP) y/o snapshot_url (HTTP)'];
        }

        $isEnabled = array_key_exists('is_enabled', $data)
            ? (((bool) $data['is_enabled']) ? 1 : 0)
            : 1;

        $minConfidence = isset($data['min_confidence']) ? (float) $data['min_confidence'] : 0.55;
        if ($minConfidence < 0.1) {
            $minConfidence = 0.1;
        }
        if ($minConfidence > 0.99) {
            $minConfidence = 0.99;
        }

        $debounce = isset($data['debounce_seconds']) ? (int) $data['debounce_seconds'] : 30;
        if ($debounce < 5) {
            $debounce = 5;
        }
        if ($debounce > 600) {
            $debounce = 600;
        }

        $poll = isset($data['poll_interval_ms']) ? (int) $data['poll_interval_ms'] : 1000;
        if ($poll < 200) {
            $poll = 200;
        }
        if ($poll > 10000) {
            $poll = 10000;
        }

        return [
            'name' => $name,
            'access_point_id' => $accessPointId,
            'direction' => $direction,
            'stream_url' => $streamUrl,
            'snapshot_url' => $snapshotUrl,
            'is_enabled' => $isEnabled,
            'min_confidence' => round($minConfidence, 2),
            'debounce_seconds' => $debounce,
            'poll_interval_ms' => $poll,
        ];
    }

    private function fetchCamera(int $id): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT c.*, ap.name AS access_point_name
             FROM lpr_cameras c
             INNER JOIN access_points ap ON ap.id = c.access_point_id
             WHERE c.camera_id = ?
             LIMIT 1'
        );
        $stmt->execute([$id]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);

        return $row ?: null;
    }

    private function isDuplicate(int $cameraId, string $plate, int $debounceSeconds): bool
    {
        $stmt = $this->pdo->prepare(
            "SELECT event_id FROM lpr_events
             WHERE camera_id = ?
               AND license_plate = ?
               AND result IN ('REGISTERED', 'DENIED', 'PENDING_HOUSE')
               AND created_at >= (NOW() - INTERVAL ? SECOND)
             ORDER BY event_id DESC
             LIMIT 1"
        );
        $stmt->execute([$cameraId, $plate, $debounceSeconds]);

        return (bool) $stmt->fetchColumn();
    }

    /**
     * @param array<string,mixed> $row
     */
    private function insertEvent(array $row): int
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO lpr_events
             (camera_id, access_point_id, license_plate, confidence, direction, result,
              status_validated, message, vehicle_id, temp_visit_id, access_log_id,
              temp_access_log_id, snapshot_url, raw_ocr)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $row['camera_id'],
            $row['access_point_id'],
            $row['license_plate'],
            $row['confidence'],
            $row['direction'],
            $row['result'],
            $row['status_validated'],
            $row['message'],
            $row['vehicle_id'],
            $row['temp_visit_id'],
            $row['access_log_id'],
            $row['temp_access_log_id'],
            $row['snapshot_url'],
            $row['raw_ocr'],
        ]);

        return (int) $this->pdo->lastInsertId();
    }

    private function persistSnapshotBase64(?string $b64, string $plateHint): ?string
    {
        if ($b64 === null || trim($b64) === '') {
            return null;
        }
        $b64 = trim($b64);
        if (str_starts_with($b64, 'data:')) {
            $comma = strpos($b64, ',');
            if ($comma === false) {
                return null;
            }
            $b64 = substr($b64, $comma + 1);
        }
        $bin = base64_decode($b64, true);
        if ($bin === false || strlen($bin) < 32) {
            return null;
        }
        if (strlen($bin) > 3 * 1024 * 1024) {
            return null;
        }

        $dir = __DIR__ . '/../uploads/public/lpr/';
        if (!is_dir($dir) && !@mkdir($dir, 0755, true)) {
            return null;
        }
        $safePlate = preg_replace('/[^A-Z0-9]/', '', strtoupper($plateHint)) ?: 'plate';
        $filename = date('Ymd_His') . '_' . $safePlate . '_' . bin2hex(random_bytes(3)) . '.jpg';
        $path = $dir . $filename;
        if (@file_put_contents($path, $bin) === false) {
            return null;
        }

        return '/uploads/public/lpr/' . $filename;
    }

    /**
     * @param array<string,mixed> $auth
     * @param array<string,mixed> $resolved
     * @return array{access_log_id?: int|null, temp_access_log_id?: int|null, message: string}
     */
    private function registerAccess(array $auth, array $resolved, int $accessPointId, string $direction, string $status): array
    {
        $tempVisitId = isset($resolved['temp_visit_id']) ? (int) $resolved['temp_visit_id'] : 0;
        if ($tempVisitId > 0) {
            return $this->registerTemporaryAccess($auth, $resolved, $accessPointId, $direction, $status);
        }

        $vehicleId = isset($resolved['vehicle_id']) ? (int) $resolved['vehicle_id'] : 0;
        $plate = normalize_license_plate((string) ($resolved['license_plate'] ?? ''));
        $observation = $status . ' | LPR';

        if ($direction === 'EGRESO') {
            return $this->closeResidentIngress($auth, $accessPointId, $vehicleId > 0 ? $vehicleId : null, $plate, $observation);
        }

        $stmt = $this->pdo->prepare(
            'INSERT INTO access_logs
             (access_point_id, person_id, doc_number, vehicle_id, type, observation, created_by_user_id, created_at)
             VALUES (?, NULL, NULL, ?, ?, ?, NULL, NOW())'
        );
        $stmt->execute([
            $accessPointId,
            $vehicleId > 0 ? $vehicleId : null,
            'INGRESO',
            $vehicleId > 0 ? $observation : ($observation . ' | placa ' . $plate),
        ]);
        $id = (int) $this->pdo->lastInsertId();

        recordEventLog($this->pdo, $auth, 'access_log.create', [
            'summary' => 'Ingreso LPR placa ' . $plate,
            'entity_type' => 'access_logs',
            'entity_id' => $id,
            'details' => [
                'access_point_id' => $accessPointId,
                'type' => 'INGRESO',
                'source' => 'lpr',
                'license_plate' => $plate,
            ],
        ]);

        return [
            'access_log_id' => $id,
            'temp_access_log_id' => null,
            'message' => 'Ingreso registrado por LPR',
        ];
    }

    /**
     * @param array<string,mixed> $auth
     * @param array<string,mixed> $resolved
     * @return array{access_log_id?: int|null, temp_access_log_id?: int|null, message: string}
     */
    private function registerTemporaryAccess(
        array $auth,
        array $resolved,
        int $accessPointId,
        string $direction,
        string $status
    ): array {
        $tempVisitId = (int) $resolved['temp_visit_id'];
        $houseId = (int) ($resolved['house_id'] ?? 0);
        $assignmentId = (int) ($resolved['assignment_id'] ?? 0);
        $plate = normalize_license_plate((string) ($resolved['license_plate'] ?? ''));

        if ($direction === 'EGRESO') {
            $open = fetch_open_temp_access_log($this->pdo, $tempVisitId, $houseId);
            if (!$open) {
                throw new \RuntimeException('No hay entrada abierta para esta visita externa');
            }
            $logId = (int) $open['temp_access_log_id'];
            $now = date('Y-m-d H:i:s');
            $this->pdo->prepare(
                'UPDATE temporary_access_logs SET temp_exit_time = ? WHERE temp_access_log_id = ? AND temp_exit_time IS NULL'
            )->execute([$now, $logId]);

            recordEventLog($this->pdo, $auth, 'temporary_access_log.exit', [
                'summary' => 'Salida LPR visita externa #' . $tempVisitId,
                'entity_type' => 'temporary_access_logs',
                'entity_id' => $logId,
                'details' => ['source' => 'lpr', 'license_plate' => $plate],
            ]);

            return [
                'access_log_id' => null,
                'temp_access_log_id' => $logId,
                'message' => 'Salida visita externa registrada por LPR',
            ];
        }

        $assignment = resolve_temp_visit_assignment_for_entry($this->pdo, $tempVisitId, $houseId, $assignmentId);
        if (!$assignment) {
            throw new \RuntimeException('Autorización de visita externa no vigente');
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
            throw new \RuntimeException('Ya hay una entrada sin salida registrada');
        }

        $now = date('Y-m-d H:i:s');
        $assignmentValidUntil = (string) ($assignment['valid_until'] ?? '');
        $authorizedMinutes = assignment_authorized_duration_minutes($assignment);
        $stayDeadline = date('Y-m-d H:i:s', strtotime($now) + ($authorizedMinutes * 60));

        $stmt = $this->pdo->prepare(
            'INSERT INTO temporary_access_logs
             (temp_visit_id, assignment_id, assignment_valid_until, authorized_duration_minutes, stay_deadline,
              temp_entry_time, access_point_id, status_validated, house_id, created_by_user_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)'
        );
        $stmt->execute([
            $tempVisitId,
            $assignmentId,
            $assignmentValidUntil !== '' ? $assignmentValidUntil : null,
            $authorizedMinutes,
            $stayDeadline,
            $now,
            $accessPointId,
            $status !== '' ? $status : 'PERMITIDO',
            $houseId,
        ]);
        $id = (int) $this->pdo->lastInsertId();

        recordEventLog($this->pdo, $auth, 'temporary_access_log.create', [
            'summary' => 'Ingreso LPR visita externa #' . $tempVisitId,
            'entity_type' => 'temporary_access_logs',
            'entity_id' => $id,
            'details' => ['source' => 'lpr', 'license_plate' => $plate],
        ]);

        return [
            'access_log_id' => null,
            'temp_access_log_id' => $id,
            'message' => 'Ingreso visita externa registrado por LPR',
        ];
    }

    /**
     * @param array<string,mixed> $auth
     * @return array{access_log_id: int, temp_access_log_id: null, message: string}
     */
    private function closeResidentIngress(
        array $auth,
        int $accessPointId,
        ?int $vehicleId,
        string $plate,
        string $observation
    ): array {
        $params = [$accessPointId];
        $identitySql = '';
        if ($vehicleId !== null && $vehicleId > 0) {
            $identitySql = 'AND vehicle_id = ?';
            $params[] = $vehicleId;
        } elseif ($plate !== '') {
            $identitySql = "AND (observation LIKE ? OR observation LIKE ?)";
            $params[] = '%placa ' . $plate . '%';
            $params[] = '%placa ' . $plate;
        } else {
            throw new \RuntimeException('No se pudo identificar el vehículo para egreso');
        }

        $sql = "SELECT id, observation, created_at, updated_at
                FROM access_logs
                WHERE type = 'INGRESO'
                  AND access_point_id = ?
                  AND updated_at <= created_at
                  {$identitySql}
                ORDER BY id DESC
                LIMIT 1";
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        $open = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (!$open) {
            throw new \RuntimeException('No hay entrada abierta para este vehículo');
        }

        $logId = (int) $open['id'];
        $now = date('Y-m-d H:i:s');
        $newObservation = trim((string) ($open['observation'] ?? ''));
        $newObservation = $newObservation !== ''
            ? $newObservation . ' | SALIDA: LPR'
            : 'SALIDA: LPR';

        $upd = $this->pdo->prepare(
            "UPDATE access_logs
             SET updated_at = ?, observation = ?
             WHERE id = ? AND type = 'INGRESO' AND updated_at <= created_at"
        );
        $upd->execute([$now, $newObservation, $logId]);

        recordEventLog($this->pdo, $auth, 'access_log.exit', [
            'summary' => 'Salida LPR placa ' . $plate,
            'entity_type' => 'access_logs',
            'entity_id' => $logId,
            'details' => ['source' => 'lpr', 'license_plate' => $plate],
        ]);

        return [
            'access_log_id' => $logId,
            'temp_access_log_id' => null,
            'message' => 'Salida registrada por LPR',
        ];
    }
}
