<?php

namespace Controllers;

require_once __DIR__ . '/../utils/Response.php';
require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../helpers/nav_permissions.php';
require_once __DIR__ . '/../helpers/event_log.php';
require_once __DIR__ . '/../helpers/license_plate.php';
require_once __DIR__ . '/../helpers/temporary_visit.php';
require_once __DIR__ . '/../helpers/upload_storage.php';

use Utils\Response;

class CameraAccessController
{
    private \PDO $pdo;

    public function __construct(\PDO $pdo)
    {
        $this->pdo = $pdo;
    }

    public function camerasIndex(): void
    {
        $auth = requireAuth();
        $this->requireView($auth);

        $stmt = $this->pdo->query(
            'SELECT c.camera_id, c.name, c.access_point_id, c.api_key_prefix,
                    c.debounce_seconds, c.is_active, c.last_seen_at, c.created_at, c.updated_at,
                    ap.name AS access_point_name
             FROM access_cameras c
             INNER JOIN access_points ap ON ap.id = c.access_point_id
             ORDER BY c.name ASC'
        );

        Response::success($stmt->fetchAll(\PDO::FETCH_ASSOC) ?: []);
    }

    public function camerasStore(): void
    {
        $auth = requireAuth();
        $this->requireManage($auth);
        $data = $this->jsonBody();

        $name = trim((string) ($data['name'] ?? ''));
        $accessPointId = (int) ($data['access_point_id'] ?? 0);
        $debounce = $this->validDebounce($data['debounce_seconds'] ?? 45);
        if ($name === '' || $accessPointId <= 0) {
            Response::error('name y access_point_id son obligatorios', 400);
            return;
        }
        if (!$this->accessPointExists($accessPointId, true)) {
            Response::error('Punto de acceso inactivo o no encontrado', 422);
            return;
        }

        [$plainKey, $hash, $prefix] = $this->newApiKey();
        $stmt = $this->pdo->prepare(
            'INSERT INTO access_cameras
             (name, access_point_id, api_key_hash, api_key_prefix, debounce_seconds, is_active)
             VALUES (?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $name,
            $accessPointId,
            $hash,
            $prefix,
            $debounce,
            $this->boolFlag($data['is_active'] ?? true),
        ]);
        $id = (int) $this->pdo->lastInsertId();

        recordEventLog($this->pdo, $auth, 'camera.create', [
            'summary' => 'Cámara LPR creada: ' . $name,
            'entity_type' => 'access_cameras',
            'entity_id' => $id,
        ]);

        Response::success([
            'camera_id' => $id,
            'api_key' => $plainKey,
            'api_key_prefix' => $prefix,
        ], 'Cámara creada. Copie la clave ahora; no volverá a mostrarse.', 201);
    }

    public function camerasUpdate(int $id): void
    {
        $auth = requireAuth();
        $this->requireManage($auth);
        $data = $this->jsonBody();
        $camera = $this->cameraById($id);
        if (!$camera) {
            Response::notFound('Cámara no encontrada');
            return;
        }

        $name = trim((string) ($data['name'] ?? $camera['name']));
        $accessPointId = (int) ($data['access_point_id'] ?? $camera['access_point_id']);
        $debounce = $this->validDebounce($data['debounce_seconds'] ?? $camera['debounce_seconds']);
        $active = array_key_exists('is_active', $data)
            ? $this->boolFlag($data['is_active'])
            : (int) $camera['is_active'];

        if ($name === '' || !$this->accessPointExists($accessPointId, $active === 1)) {
            Response::error('Nombre o punto de acceso inválido', 422);
            return;
        }

        $stmt = $this->pdo->prepare(
            'UPDATE access_cameras
             SET name = ?, access_point_id = ?, debounce_seconds = ?, is_active = ?
             WHERE camera_id = ?'
        );
        $stmt->execute([$name, $accessPointId, $debounce, $active, $id]);

        recordEventLog($this->pdo, $auth, 'camera.update', [
            'summary' => 'Cámara LPR actualizada: ' . $name,
            'entity_type' => 'access_cameras',
            'entity_id' => $id,
        ]);
        Response::success(['camera_id' => $id], 'Cámara actualizada');
    }

    public function camerasRotateKey(int $id): void
    {
        $auth = requireAuth();
        $this->requireManage($auth);
        if (!$this->cameraById($id)) {
            Response::notFound('Cámara no encontrada');
            return;
        }

        [$plainKey, $hash, $prefix] = $this->newApiKey();
        $stmt = $this->pdo->prepare(
            'UPDATE access_cameras SET api_key_hash = ?, api_key_prefix = ? WHERE camera_id = ?'
        );
        $stmt->execute([$hash, $prefix, $id]);
        recordEventLog($this->pdo, $auth, 'camera.rotate_key', [
            'summary' => 'Clave de cámara LPR rotada',
            'entity_type' => 'access_cameras',
            'entity_id' => $id,
        ]);

        Response::success([
            'camera_id' => $id,
            'api_key' => $plainKey,
            'api_key_prefix' => $prefix,
        ], 'Clave rotada. Copie la nueva clave ahora.');
    }

    public function eventsIndex(): void
    {
        $auth = requireAuth();
        $this->requireView($auth);

        $where = ['1=1'];
        $params = [];
        $cameraId = (int) ($_GET['camera_id'] ?? 0);
        $accessPointId = (int) ($_GET['access_point_id'] ?? 0);
        $result = strtoupper(trim((string) ($_GET['result'] ?? '')));
        $plate = normalize_license_plate((string) ($_GET['license_plate'] ?? ''));
        $from = trim((string) ($_GET['fecha_inicial'] ?? ''));
        $to = trim((string) ($_GET['fecha_final'] ?? ''));

        if ($cameraId > 0) {
            $where[] = 'e.camera_id = ?';
            $params[] = $cameraId;
        }
        if ($accessPointId > 0) {
            $where[] = 'e.access_point_id = ?';
            $params[] = $accessPointId;
        }
        if (in_array($result, ['ALLOWED', 'DENIED', 'IGNORED_DUPLICATE'], true)) {
            $where[] = 'e.result = ?';
            $params[] = $result;
        }
        if ($plate !== '') {
            $where[] = 'e.license_plate_norm LIKE ?';
            $params[] = '%' . $plate . '%';
        }
        if ($from !== '') {
            $where[] = 'e.created_at >= ?';
            $params[] = $from . ' 00:00:00';
        }
        if ($to !== '') {
            $where[] = 'e.created_at <= ?';
            $params[] = $to . ' 23:59:59';
        }

        $page = max(1, (int) ($_GET['page'] ?? 1));
        $limit = min(200, max(1, (int) ($_GET['limit'] ?? 50)));
        $offset = ($page - 1) * $limit;
        $whereSql = implode(' AND ', $where);

        $count = $this->pdo->prepare("SELECT COUNT(*) FROM camera_access_events e WHERE {$whereSql}");
        $count->execute($params);
        $total = (int) $count->fetchColumn();

        $sql = "SELECT e.*, c.name AS camera_name, ap.name AS access_point_name,
                       v.brand, v.model, tv.temp_visit_name
                FROM camera_access_events e
                INNER JOIN access_cameras c ON c.camera_id = e.camera_id
                INNER JOIN access_points ap ON ap.id = e.access_point_id
                LEFT JOIN vehicles v ON v.vehicle_id = e.vehicle_id
                LEFT JOIN temporary_visits tv ON tv.temp_visit_id = e.temp_visit_id
                WHERE {$whereSql}
                ORDER BY e.created_at DESC
                LIMIT {$limit} OFFSET {$offset}";
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);

        Response::json([
            'success' => true,
            'data' => $stmt->fetchAll(\PDO::FETCH_ASSOC) ?: [],
            'pagination' => [
                'page' => $page,
                'limit' => $limit,
                'total' => $total,
                'total_pages' => (int) ceil($total / $limit),
            ],
        ]);
    }

    public function ingest(): void
    {
        $camera = $this->authenticateCamera();
        if (!$camera) {
            Response::unauthorized('Clave de cámara inválida o cámara inactiva');
            return;
        }

        $rawPlate = trim((string) ($_POST['license_plate'] ?? ''));
        $plate = normalize_license_plate($rawPlate);
        if (!validate_license_plate($plate)) {
            Response::error('license_plate debe ser una placa peruana de 6 caracteres', 422);
            return;
        }

        $confidence = $this->nullableConfidence($_POST['confidence'] ?? null);
        if (isset($_POST['confidence']) && $confidence === null) {
            Response::error('confidence debe estar entre 0 y 1', 422);
            return;
        }
        $capturedAt = $this->capturedAt($_POST['captured_at'] ?? null);

        $photoUrl = null;
        if (isset($_FILES['photo'])) {
            $upload = $this->storeCameraPhoto($_FILES['photo']);
            if (!$upload['success']) {
                Response::error((string) $upload['error'], 422);
                return;
            }
            $photoUrl = $upload['photo_url'];
        }

        $cameraId = (int) $camera['camera_id'];
        $accessPointId = (int) $camera['access_point_id'];
        $debounce = max(1, (int) $camera['debounce_seconds']);

        try {
            $this->pdo->beginTransaction();
            // Serializa lecturas de una cámara: debounce + creación del log son atómicos.
            $lock = $this->pdo->prepare(
                'SELECT camera_id FROM access_cameras WHERE camera_id = ? AND is_active = 1 FOR UPDATE'
            );
            $lock->execute([$cameraId]);
            if (!$lock->fetchColumn()) {
                throw new \RuntimeException('La cámara dejó de estar activa');
            }
            $this->pdo->prepare('UPDATE access_cameras SET last_seen_at = NOW() WHERE camera_id = ?')
                ->execute([$cameraId]);

            if ($this->isDuplicate($cameraId, $plate, $debounce)) {
                $eventId = $this->insertEvent([
                    $cameraId, $accessPointId, $rawPlate, $plate, $confidence,
                    'NONE', 'IGNORED_DUPLICATE', null, null, null, null, null,
                    $photoUrl, $capturedAt,
                ]);
                $this->pdo->commit();
                Response::success([
                    'result' => 'IGNORED_DUPLICATE',
                    'match_type' => 'NONE',
                    'event_id' => $eventId,
                ], 'Lectura duplicada ignorada');
                return;
            }

            $registry = $this->findRegistryVehicle($plate);
            if ($registry) {
                $allowed = strtoupper(trim((string) ($registry['status_validated'] ?? ''))) === 'PERMITIDO';
                $accessLogId = null;
                if ($allowed) {
                    $stmt = $this->pdo->prepare(
                        "INSERT INTO access_logs
                         (access_point_id, vehicle_id, entity_kind, display_name_snapshot,
                          license_plate_snapshot, identity_source, identity_resolved_at,
                          type, observation, entry_source, photo_url, created_at)
                         VALUES (?, ?, 'VEHICLE', ?, ?, 'LOCAL', ?, 'INGRESO', ?, 'camera', ?, ?)"
                    );
                    $ownerName = trim(implode(' ', array_filter([
                        trim((string) ($registry['owner_first_name'] ?? '')),
                        trim((string) ($registry['owner_paternal_surname'] ?? '')),
                        trim((string) ($registry['owner_maternal_surname'] ?? '')),
                    ])));
                    $stmt->execute([
                        $accessPointId,
                        (int) $registry['vehicle_id'],
                        $ownerName !== '' ? $ownerName : null,
                        $plate,
                        $capturedAt,
                        'Ingreso automático LPR - placa ' . $plate,
                        $photoUrl,
                        $capturedAt,
                    ]);
                    $accessLogId = (int) $this->pdo->lastInsertId();
                }
                $eventId = $this->insertEvent([
                    $cameraId, $accessPointId, $rawPlate, $plate, $confidence,
                    $allowed ? 'REGISTRY' : 'DENIED',
                    $allowed ? 'ALLOWED' : 'DENIED',
                    $accessLogId, null, (int) $registry['vehicle_id'], null,
                    $this->positiveOrNull($registry['house_id'] ?? null), $photoUrl, $capturedAt,
                ]);
                $this->pdo->commit();
                Response::success([
                    'result' => $allowed ? 'ALLOWED' : 'DENIED',
                    'match_type' => $allowed ? 'REGISTRY' : 'DENIED',
                    'access_log_id' => $accessLogId,
                    'event_id' => $eventId,
                ], $allowed ? 'Ingreso registrado' : 'Vehículo no autorizado', $allowed ? 201 : 200);
                return;
            }

            $external = find_temp_visit_profile($this->pdo, $plate, null);
            if ($external) {
                $assignment = $this->singleActiveAssignment((int) $external['temp_visit_id']);
                $status = strtoupper(trim((string) ($external['status_validated'] ?? '')));
                $allowed = $status === 'PERMITIDO' && $assignment !== null;
                $tempLogId = null;
                $houseId = $assignment ? (int) $assignment['house_id'] : null;
                if ($allowed) {
                    $tempLogId = $this->insertTemporaryLog(
                        $external,
                        $assignment,
                        $accessPointId,
                        $photoUrl,
                        $capturedAt
                    );
                }
                $eventId = $this->insertEvent([
                    $cameraId, $accessPointId, $rawPlate, $plate, $confidence,
                    $allowed ? 'EXTERNAL' : 'DENIED',
                    $allowed ? 'ALLOWED' : 'DENIED',
                    null, $tempLogId, null, (int) $external['temp_visit_id'],
                    $houseId, $photoUrl, $capturedAt,
                ]);
                $this->pdo->commit();
                Response::success([
                    'result' => $allowed ? 'ALLOWED' : 'DENIED',
                    'match_type' => $allowed ? 'EXTERNAL' : 'DENIED',
                    'temp_access_log_id' => $tempLogId,
                    'event_id' => $eventId,
                ], $allowed ? 'Ingreso temporal registrado' : 'Visita sin autorización vigente', $allowed ? 201 : 200);
                return;
            }

            $eventId = $this->insertEvent([
                $cameraId, $accessPointId, $rawPlate, $plate, $confidence,
                'NONE', 'DENIED', null, null, null, null, null, $photoUrl, $capturedAt,
            ]);
            $this->pdo->commit();
            Response::success([
                'result' => 'DENIED',
                'match_type' => 'NONE',
                'event_id' => $eventId,
            ], 'Placa no registrada');
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            $this->removeUploadedPhoto($photoUrl);
            Response::error('No se pudo procesar la lectura', 500, $e->getMessage());
        }
    }

    private function insertTemporaryLog(
        array $external,
        array $assignment,
        int $accessPointId,
        ?string $photoUrl,
        string $capturedAt
    ): int {
        $tempVisitId = (int) $external['temp_visit_id'];
        $houseId = (int) $assignment['house_id'];
        $open = fetch_open_temp_access_log($this->pdo, $tempVisitId, $houseId);
        if ($open) {
            return (int) $open['temp_access_log_id'];
        }

        $minutes = assignment_authorized_duration_minutes($assignment);
        $stayDeadline = date('Y-m-d H:i:s', strtotime($capturedAt) + ($minutes * 60));
        $stmt = $this->pdo->prepare(
            "INSERT INTO temporary_access_logs
             (temp_visit_id, entity_kind, display_name_snapshot, document_snapshot, document_type_snapshot,
              license_plate_snapshot, identity_source, identity_resolved_at,
              assignment_id, assignment_valid_until, authorized_duration_minutes,
              stay_deadline, temp_entry_time, access_point_id, status_validated,
              entry_source, photo_url, house_id)
             VALUES (?, 'VEHICLE', ?, ?, ?, ?, 'LOCAL', ?, ?, ?, ?, ?, ?, ?, 'PERMITIDO', 'camera', ?, ?)"
        );
        $stmt->execute([
            $tempVisitId,
            trim((string) ($external['temp_visit_name'] ?? '')) ?: null,
            trim((string) ($external['temp_visit_doc'] ?? '')) ?: null,
            normalize_identity_document_type($external['temp_visit_doc_type'] ?? '') ?: null,
            normalize_license_plate((string) ($external['temp_visit_plate'] ?? '')) ?: null,
            $capturedAt,
            (int) $assignment['assignment_id'],
            $assignment['valid_until'] ?? null,
            $minutes,
            $stayDeadline,
            $capturedAt,
            $accessPointId,
            $photoUrl,
            $houseId,
        ]);
        return (int) $this->pdo->lastInsertId();
    }

    private function insertEvent(array $values): int
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO camera_access_events
             (camera_id, access_point_id, license_plate_raw, license_plate_norm, confidence,
              match_type, result, access_log_id, temp_access_log_id, vehicle_id,
              temp_visit_id, house_id, photo_url, captured_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute($values);
        return (int) $this->pdo->lastInsertId();
    }

    private function authenticateCamera(): ?array
    {
        $headers = function_exists('getallheaders') ? getallheaders() : [];
        $key = trim((string) ($headers['X-Camera-Key'] ?? $headers['x-camera-key'] ?? ''));
        if ($key === '') {
            $auth = (string) ($headers['Authorization'] ?? $headers['authorization'] ?? '');
            if (stripos($auth, 'Bearer ') === 0) {
                $key = trim(substr($auth, 7));
            }
        }
        if ($key === '') {
            return null;
        }
        $stmt = $this->pdo->prepare(
            'SELECT c.*
             FROM access_cameras c
             INNER JOIN access_points ap ON ap.id = c.access_point_id AND ap.is_active = 1
             WHERE c.api_key_hash = ? AND c.is_active = 1
             LIMIT 1'
        );
        $stmt->execute([hash('sha256', $key)]);
        $camera = $stmt->fetch(\PDO::FETCH_ASSOC);
        return $camera ?: null;
    }

    private function isDuplicate(int $cameraId, string $plate, int $seconds): bool
    {
        $stmt = $this->pdo->prepare(
            'SELECT event_id FROM camera_access_events
             WHERE camera_id = ? AND license_plate_norm = ?
               AND created_at >= DATE_SUB(NOW(), INTERVAL ? SECOND)
             ORDER BY event_id DESC LIMIT 1'
        );
        $stmt->execute([$cameraId, $plate, $seconds]);
        return (bool) $stmt->fetchColumn();
    }

    private function findRegistryVehicle(string $plate): ?array
    {
        $stmt = $this->pdo->prepare(
            "SELECT v.*,
                    owner.first_name AS owner_first_name,
                    owner.paternal_surname AS owner_paternal_surname,
                    owner.maternal_surname AS owner_maternal_surname
             FROM vehicles v
             LEFT JOIN persons owner ON owner.id = v.owner_id
             WHERE UPPER(REPLACE(REPLACE(TRIM(v.license_plate), '-', ''), ' ', '')) = ?
             ORDER BY v.vehicle_id DESC LIMIT 1"
        );
        $stmt->execute([$plate]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    private function singleActiveAssignment(int $tempVisitId): ?array
    {
        $assignments = fetch_active_temp_visit_assignments($this->pdo, $tempVisitId);
        return count($assignments) === 1 ? $assignments[0] : null;
    }

    private function accessPointExists(int $id, bool $activeOnly): bool
    {
        $sql = 'SELECT id FROM access_points WHERE id = ?';
        if ($activeOnly) {
            $sql .= ' AND is_active = 1';
        }
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([$id]);
        return (bool) $stmt->fetchColumn();
    }

    private function storeCameraPhoto(array $file): array
    {
        $tmp = (string) ($file['tmp_name'] ?? '');
        if ($tmp === '' || !is_uploaded_file($tmp)) {
            return ['success' => false, 'photo_url' => null, 'error' => 'Captura inválida'];
        }
        $mime = (new \finfo(FILEINFO_MIME_TYPE))->file($tmp);
        if (!in_array($mime, ['image/jpeg', 'image/png'], true) || @getimagesize($tmp) === false) {
            return ['success' => false, 'photo_url' => null, 'error' => 'La captura debe ser JPG o PNG válida'];
        }
        return storePublicPhoto($file, 'camera-access');
    }

    private function removeUploadedPhoto(?string $photoUrl): void
    {
        if (!$photoUrl || !str_starts_with($photoUrl, '/uploads/public/camera-access/')) {
            return;
        }
        deleteStoredMedia($photoUrl);
    }

    private function cameraById(int $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM access_cameras WHERE camera_id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    private function requireView(array $auth): void
    {
        if (!canViewModule($this->pdo, $auth, 'cameras')) {
            Response::forbidden('Sin permiso para cámaras');
            exit;
        }
    }

    private function requireManage(array $auth): void
    {
        if (!canManageModule($this->pdo, $auth, 'cameras')) {
            Response::forbidden('Sin permiso para gestionar cámaras');
            exit;
        }
    }

    private function jsonBody(): array
    {
        $data = json_decode(file_get_contents('php://input'), true);
        if (!is_array($data)) {
            Response::error('JSON inválido', 400);
            exit;
        }
        return $data;
    }

    private function newApiKey(): array
    {
        $plain = 'vclpr_' . bin2hex(random_bytes(24));
        return [$plain, hash('sha256', $plain), substr($plain, 0, 14)];
    }

    private function validDebounce($value): int
    {
        return min(600, max(5, (int) $value));
    }

    private function boolFlag($value): int
    {
        return filter_var($value, FILTER_VALIDATE_BOOLEAN) ? 1 : 0;
    }

    private function nullableConfidence($value): ?float
    {
        if ($value === null || $value === '') {
            return null;
        }
        $number = filter_var($value, FILTER_VALIDATE_FLOAT);
        if ($number === false || $number < 0 || $number > 1) {
            return null;
        }
        return round((float) $number, 4);
    }

    private function capturedAt($value): string
    {
        $text = trim((string) ($value ?? ''));
        if ($text === '') {
            return date('Y-m-d H:i:s');
        }
        $timestamp = strtotime($text);
        if ($timestamp === false || abs(time() - $timestamp) > 86400) {
            return date('Y-m-d H:i:s');
        }
        return date('Y-m-d H:i:s', $timestamp);
    }

    private function positiveOrNull($value): ?int
    {
        $number = (int) $value;
        return $number > 0 ? $number : null;
    }
}
