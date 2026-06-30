<?php

namespace Controllers;

require_once __DIR__ . '/../utils/Response.php';
require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../helpers/house_permissions.php';
require_once __DIR__ . '/../helpers/nav_permissions.php';
require_once __DIR__ . '/../helpers/event_log.php';

use Utils\Response;

class AccessIncidentController
{
    private $pdo;

    public function __construct($pdo)
    {
        $this->pdo = $pdo;
    }

    private static function ensureTable(\PDO $pdo): void
    {
        $pdo->exec(
            "CREATE TABLE IF NOT EXISTS access_incidents (
                incident_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                source ENUM('scan', 'manual') NOT NULL DEFAULT 'manual',
                access_log_id BIGINT UNSIGNED DEFAULT NULL,
                temp_access_log_id INT UNSIGNED DEFAULT NULL,
                access_point_id INT UNSIGNED NOT NULL,
                house_id INT UNSIGNED DEFAULT NULL,
                person_id INT UNSIGNED DEFAULT NULL,
                vehicle_id INT UNSIGNED DEFAULT NULL,
                temp_visit_id INT UNSIGNED DEFAULT NULL,
                doc_number VARCHAR(20) DEFAULT NULL,
                license_plate VARCHAR(20) DEFAULT NULL,
                status_validated VARCHAR(50) DEFAULT NULL,
                description TEXT NOT NULL,
                photo_url VARCHAR(255) DEFAULT NULL,
                created_by_user_id INT UNSIGNED DEFAULT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (incident_id),
                KEY idx_ai_created_at (created_at),
                KEY idx_ai_access_point (access_point_id),
                KEY idx_ai_source (source),
                KEY idx_ai_access_log (access_log_id),
                KEY idx_ai_temp_access_log (temp_access_log_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }

    private function requireIncidentAccess(array $auth): void
    {
        if (!isStaffRole($auth)) {
            Response::error('Solo personal autorizado', 403);
            exit;
        }
        if (!canViewModule($this->pdo, $auth, 'incidents')) {
            Response::error('Sin permiso para incidencias', 403);
            exit;
        }
    }

    /**
     * GET /api/v1/access-incidents
     */
    public function index(): void
    {
        $auth = requireAuth();
        $this->requireIncidentAccess($auth);
        self::ensureTable($this->pdo);

        $fi = trim((string) ($_GET['fecha_inicial'] ?? ''));
        $ff = trim((string) ($_GET['fecha_final'] ?? ''));
        $ap = (int) ($_GET['access_point_id'] ?? 0);
        $source = strtolower(trim((string) ($_GET['source'] ?? '')));

        $where = ['1=1'];
        $params = [];

        if ($fi !== '' && $ff !== '') {
            $where[] = 'ai.created_at BETWEEN ? AND ?';
            $params[] = $fi . ' 00:00:00';
            $params[] = $ff . ' 23:59:59';
        }
        if ($ap > 0) {
            $where[] = 'ai.access_point_id = ?';
            $params[] = $ap;
        }
        if ($source === 'scan' || $source === 'manual') {
            $where[] = 'ai.source = ?';
            $params[] = $source;
        }

        $sql = "
            SELECT ai.*,
                   ap.name AS access_point_name,
                   COALESCE(u.username_system, CONCAT('#', ai.created_by_user_id)) AS created_by_username
            FROM access_incidents ai
            LEFT JOIN access_points ap ON ap.id = ai.access_point_id
            LEFT JOIN users u ON u.user_id = ai.created_by_user_id
            WHERE " . implode(' AND ', $where) . "
            ORDER BY ai.created_at DESC, ai.incident_id DESC
            LIMIT 500
        ";
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC) ?: [];

        $out = array_map(fn ($row) => $this->normalizeRow($row, false), $rows);
        Response::success($out);
    }

    /**
     * GET /api/v1/access-incidents/:id
     */
    public function show($id): void
    {
        $auth = requireAuth();
        $this->requireIncidentAccess($auth);
        self::ensureTable($this->pdo);

        $incidentId = (int) $id;
        if ($incidentId <= 0) {
            Response::error('ID inválido', 400);
            return;
        }

        $row = $this->fetchRowById($incidentId);
        if (!$row) {
            Response::error('Incidencia no encontrada', 404);
            return;
        }

        $normalized = $this->normalizeRow($row, true);
        $normalized['access_context'] = $this->loadAccessContext($normalized);
        $normalized['has_access_context'] = !empty($normalized['access_context']);

        Response::success($normalized);
    }

    /**
     * GET /api/v1/access-incidents/by-log/:logRef
     * logRef: id positivo = access_logs, negativo = temporary_access_logs
     */
    public function byLog($logRef): void
    {
        $auth = requireAuth();
        $this->requireIncidentAccess($auth);
        self::ensureTable($this->pdo);

        $ref = (int) $logRef;
        if ($ref === 0) {
            Response::error('Referencia de log inválida', 400);
            return;
        }

        if ($ref > 0) {
            $stmt = $this->pdo->prepare(
                "SELECT ai.*, ap.name AS access_point_name,
                        COALESCE(u.username_system, CONCAT('#', ai.created_by_user_id)) AS created_by_username
                 FROM access_incidents ai
                 LEFT JOIN access_points ap ON ap.id = ai.access_point_id
                 LEFT JOIN users u ON u.user_id = ai.created_by_user_id
                 WHERE ai.access_log_id = ?
                 ORDER BY ai.created_at DESC"
            );
            $stmt->execute([$ref]);
        } else {
            $tempId = abs($ref);
            $stmt = $this->pdo->prepare(
                "SELECT ai.*, ap.name AS access_point_name,
                        COALESCE(u.username_system, CONCAT('#', ai.created_by_user_id)) AS created_by_username
                 FROM access_incidents ai
                 LEFT JOIN access_points ap ON ap.id = ai.access_point_id
                 LEFT JOIN users u ON u.user_id = ai.created_by_user_id
                 WHERE ai.temp_access_log_id = ?
                 ORDER BY ai.created_at DESC"
            );
            $stmt->execute([$tempId]);
        }

        $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC) ?: [];
        $out = array_map(fn ($row) => $this->normalizeRow($row, false), $rows);
        Response::success($out);
    }

    /**
     * POST /api/v1/access-incidents (multipart/form-data)
     */
    public function store(): void
    {
        $auth = requireAuth();
        $this->requireIncidentAccess($auth);
        self::ensureTable($this->pdo);

        $description = trim((string) ($_POST['description'] ?? ''));
        $accessPointId = (int) ($_POST['access_point_id'] ?? 0);
        $source = strtolower(trim((string) ($_POST['source'] ?? 'manual')));

        if ($description === '') {
            Response::error('La descripción es obligatoria', 400);
            return;
        }
        if ($accessPointId <= 0) {
            Response::error('access_point_id requerido', 400);
            return;
        }
        if ($source !== 'scan' && $source !== 'manual') {
            Response::error('source debe ser scan o manual', 400);
            return;
        }

        $accessLogId = (int) ($_POST['access_log_id'] ?? 0) ?: null;
        $tempAccessLogId = (int) ($_POST['temp_access_log_id'] ?? 0) ?: null;

        if ($source === 'manual') {
            $accessLogId = null;
            $tempAccessLogId = null;
        } elseif ($source === 'scan') {
            if ($accessLogId !== null && $accessLogId <= 0) {
                $accessLogId = null;
            }
            if ($tempAccessLogId !== null && $tempAccessLogId <= 0) {
                $tempAccessLogId = null;
            }
            if ($accessLogId === null && $tempAccessLogId === null) {
                Response::error('Incidencia de escaneo requiere access_log_id o temp_access_log_id', 422);
                return;
            }
        }

        $stmtAp = $this->pdo->prepare('SELECT id FROM access_points WHERE id = ?');
        $stmtAp->execute([$accessPointId]);
        if (!$stmtAp->fetch()) {
            Response::error('Punto de acceso no encontrado', 404);
            return;
        }

        if ($accessLogId !== null) {
            $stmt = $this->pdo->prepare('SELECT id FROM access_logs WHERE id = ?');
            $stmt->execute([$accessLogId]);
            if (!$stmt->fetch()) {
                Response::error('Registro de acceso no encontrado', 404);
                return;
            }
        }
        if ($tempAccessLogId !== null) {
            $stmt = $this->pdo->prepare('SELECT temp_access_log_id FROM temporary_access_logs WHERE temp_access_log_id = ?');
            $stmt->execute([$tempAccessLogId]);
            if (!$stmt->fetch()) {
                Response::error('Registro de visita externa no encontrado', 404);
                return;
            }
        }

        $houseId = $this->nullableInt($_POST['house_id'] ?? null);
        $personId = $this->nullableInt($_POST['person_id'] ?? null);
        $vehicleId = $this->nullableInt($_POST['vehicle_id'] ?? null);
        $tempVisitId = $this->nullableInt($_POST['temp_visit_id'] ?? null);
        $docNumber = $this->nullableStr($_POST['doc_number'] ?? null, 20);
        $licensePlate = $this->nullableStr($_POST['license_plate'] ?? null, 20);
        $statusValidated = $this->nullableStr($_POST['status_validated'] ?? null, 50);
        $createdBy = isset($auth['user_id']) ? (int) $auth['user_id'] : null;

        if ($source === 'manual') {
            $houseId = $personId = $vehicleId = $tempVisitId = null;
            $docNumber = $licensePlate = $statusValidated = null;
        }

        try {
            $this->pdo->beginTransaction();

            $stmt = $this->pdo->prepare(
                "INSERT INTO access_incidents
                 (source, access_log_id, temp_access_log_id, access_point_id, house_id, person_id, vehicle_id,
                  temp_visit_id, doc_number, license_plate, status_validated, description, created_by_user_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            );
            $stmt->execute([
                $source,
                $accessLogId,
                $tempAccessLogId,
                $accessPointId,
                $houseId,
                $personId,
                $vehicleId,
                $tempVisitId,
                $docNumber,
                $licensePlate,
                $statusValidated,
                $description,
                $createdBy,
            ]);

            $incidentId = (int) $this->pdo->lastInsertId();
            $photoUrl = $this->uploadPhotoIfPresent($incidentId);

            if ($photoUrl !== null) {
                $upd = $this->pdo->prepare('UPDATE access_incidents SET photo_url = ? WHERE incident_id = ?');
                $upd->execute([$photoUrl, $incidentId]);
            }

            recordEventLog($this->pdo, $auth, 'access_incident.create', [
                'summary' => 'Incidencia #' . $incidentId . ' (' . $source . ')',
                'entity_type' => 'access_incidents',
                'entity_id' => $incidentId,
                'details' => [
                    'source' => $source,
                    'access_point_id' => $accessPointId,
                    'access_log_id' => $accessLogId,
                    'temp_access_log_id' => $tempAccessLogId,
                ],
            ]);

            $this->pdo->commit();

            $row = $this->fetchRowById($incidentId);
            $normalized = $this->normalizeRow($row ?: [], true);
            $normalized['access_context'] = $this->loadAccessContext($normalized);
            $normalized['has_access_context'] = !empty($normalized['access_context']);

            Response::created($normalized, 'Incidencia registrada');
        } catch (\RuntimeException $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            Response::error($e->getMessage(), 400);
        } catch (\PDOException $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            Response::error('Error al registrar incidencia: ' . $e->getMessage(), 500);
        }
    }

    private function fetchRowById(int $incidentId): ?array
    {
        $stmt = $this->pdo->prepare(
            "SELECT ai.*, ap.name AS access_point_name,
                    COALESCE(u.username_system, CONCAT('#', ai.created_by_user_id)) AS created_by_username
             FROM access_incidents ai
             LEFT JOIN access_points ap ON ap.id = ai.access_point_id
             LEFT JOIN users u ON u.user_id = ai.created_by_user_id
             WHERE ai.incident_id = ?"
        );
        $stmt->execute([$incidentId]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);

        return $row ?: null;
    }

    private function normalizeRow(array $row, bool $full): array
    {
        $out = [
            'incident_id' => (int) ($row['incident_id'] ?? 0),
            'source' => (string) ($row['source'] ?? 'manual'),
            'access_log_id' => isset($row['access_log_id']) && $row['access_log_id'] !== null
                ? (int) $row['access_log_id'] : null,
            'temp_access_log_id' => isset($row['temp_access_log_id']) && $row['temp_access_log_id'] !== null
                ? (int) $row['temp_access_log_id'] : null,
            'access_point_id' => (int) ($row['access_point_id'] ?? 0),
            'access_point_name' => (string) ($row['access_point_name'] ?? ''),
            'house_id' => $this->nullableInt($row['house_id'] ?? null),
            'person_id' => $this->nullableInt($row['person_id'] ?? null),
            'vehicle_id' => $this->nullableInt($row['vehicle_id'] ?? null),
            'temp_visit_id' => $this->nullableInt($row['temp_visit_id'] ?? null),
            'doc_number' => $row['doc_number'] ?? null,
            'license_plate' => $row['license_plate'] ?? null,
            'status_validated' => $row['status_validated'] ?? null,
            'description' => (string) ($row['description'] ?? ''),
            'photo_url' => $row['photo_url'] ?? null,
            'created_by_user_id' => $this->nullableInt($row['created_by_user_id'] ?? null),
            'created_by_username' => (string) ($row['created_by_username'] ?? ''),
            'created_at' => $row['created_at'] ?? null,
        ];

        if ($full) {
            $out['has_access_context'] = ($out['access_log_id'] !== null || $out['temp_access_log_id'] !== null);
        }

        return $out;
    }

    private function loadAccessContext(array $incident): ?array
    {
        if (!empty($incident['temp_access_log_id'])) {
            $stmt = $this->pdo->prepare(
                "SELECT tal.temp_access_log_id, tal.temp_entry_time, tal.status_validated, tal.house_id,
                        tv.temp_visit_plate, tv.temp_visit_doc, tv.temp_visit_name,
                        ap.name AS access_point_name,
                        CONCAT_WS(' ', NULLIF(h.block_house,''), NULLIF(CAST(h.lot AS CHAR),''), NULLIF(h.apartment,'')) AS house_address
                 FROM temporary_access_logs tal
                 LEFT JOIN temporary_visits tv ON tv.temp_visit_id = tal.temp_visit_id
                 LEFT JOIN access_points ap ON ap.id = tal.access_point_id
                 LEFT JOIN houses h ON h.house_id = tal.house_id
                 WHERE tal.temp_access_log_id = ?"
            );
            $stmt->execute([(int) $incident['temp_access_log_id']]);
            $row = $stmt->fetch(\PDO::FETCH_ASSOC);
            if (!$row) {
                return null;
            }

            return [
                'log_type' => 'temporary',
                'entry_time' => $row['temp_entry_time'] ?? null,
                'movement_type' => 'INGRESO',
                'status_validated' => $row['status_validated'] ?? $incident['status_validated'],
                'access_point_name' => $row['access_point_name'] ?? $incident['access_point_name'],
                'name' => trim((string) ($row['temp_visit_name'] ?? '')) ?: ($row['temp_visit_plate'] ?? 'Visita externa'),
                'doc_number' => $row['temp_visit_doc'] ?? $incident['doc_number'],
                'license_plate' => $row['temp_visit_plate'] ?? $incident['license_plate'],
                'house_address' => $row['house_address'] ?? null,
                'observation' => null,
            ];
        }

        if (!empty($incident['access_log_id'])) {
            $stmt = $this->pdo->prepare(
                "SELECT al.id, al.type, al.observation, al.created_at, al.doc_number,
                        ap.name AS access_point_name,
                        CONCAT_WS(' ', p.first_name, p.paternal_surname, p.maternal_surname) AS person_name,
                        p.doc_number AS person_doc,
                        v.license_plate,
                        CONCAT_WS(' ', NULLIF(h.block_house,''), NULLIF(CAST(h.lot AS CHAR),''), NULLIF(h.apartment,'')) AS house_address
                 FROM access_logs al
                 LEFT JOIN access_points ap ON ap.id = al.access_point_id
                 LEFT JOIN persons p ON p.id = al.person_id
                 LEFT JOIN vehicles v ON v.vehicle_id = al.vehicle_id
                 LEFT JOIN houses h ON h.house_id = COALESCE(p.house_id, v.house_id)
                 WHERE al.id = ?"
            );
            $stmt->execute([(int) $incident['access_log_id']]);
            $row = $stmt->fetch(\PDO::FETCH_ASSOC);
            if (!$row) {
                return null;
            }

            $name = trim((string) ($row['person_name'] ?? ''));
            if ($name === '') {
                $name = trim((string) ($row['license_plate'] ?? '')) ?: trim((string) ($row['doc_number'] ?? ''));
            }

            return [
                'log_type' => 'resident',
                'entry_time' => $row['created_at'] ?? null,
                'movement_type' => $row['type'] ?? 'INGRESO',
                'status_validated' => $incident['status_validated'],
                'access_point_name' => $row['access_point_name'] ?? $incident['access_point_name'],
                'name' => $name ?: '—',
                'doc_number' => $row['person_doc'] ?? $row['doc_number'] ?? $incident['doc_number'],
                'license_plate' => $row['license_plate'] ?? $incident['license_plate'],
                'house_address' => $row['house_address'] ?? null,
                'observation' => $row['observation'] ?? null,
            ];
        }

        return null;
    }

    private function uploadPhotoIfPresent(int $incidentId): ?string
    {
        if (!isset($_FILES['photo']) || !is_array($_FILES['photo'])) {
            return null;
        }
        $file = $_FILES['photo'];
        if (($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
            return null;
        }
        if (($file['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK) {
            throw new \RuntimeException($this->uploadErrorMessage((int) ($file['error'] ?? UPLOAD_ERR_OK)));
        }

        // server/uploads/incidents (misma raíz que index.php sirve en GET /uploads/...)
        $uploadDir = __DIR__ . '/../uploads/incidents/';
        if (!is_dir($uploadDir) && !@mkdir($uploadDir, 0755, true)) {
            throw new \RuntimeException('No se pudo crear el directorio de almacenamiento de fotos.');
        }

        $ext = strtolower(pathinfo((string) ($file['name'] ?? ''), PATHINFO_EXTENSION));
        $allowedExts = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
        if (!in_array($ext, $allowedExts, true)) {
            throw new \RuntimeException('Formato de imagen no permitido. Use JPG, PNG, GIF o WEBP.');
        }

        $maxSize = 5 * 1024 * 1024;
        if (($file['size'] ?? 0) > $maxSize) {
            throw new \RuntimeException('La imagen no debe superar 5 MB.');
        }

        $filename = 'incident_' . $incidentId . '_' . time() . '.' . $ext;
        $filepath = $uploadDir . $filename;

        if (!move_uploaded_file($file['tmp_name'], $filepath)) {
            throw new \RuntimeException('Error al guardar la imagen en el servidor.');
        }

        return '/uploads/incidents/' . $filename;
    }

    private function uploadErrorMessage(int $code): string
    {
        return match ($code) {
            UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => 'La imagen supera el tamaño máximo permitido (5 MB).',
            UPLOAD_ERR_PARTIAL => 'La imagen se subió solo parcialmente. Intente de nuevo.',
            UPLOAD_ERR_NO_TMP_DIR => 'El servidor no tiene carpeta temporal para subidas.',
            UPLOAD_ERR_CANT_WRITE => 'El servidor no pudo escribir la imagen.',
            UPLOAD_ERR_EXTENSION => 'La subida fue bloqueada por una extensión del servidor.',
            default => 'Error al subir la imagen (código ' . $code . ').',
        };
    }

    private function nullableInt($value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }
        $n = (int) $value;

        return $n > 0 ? $n : null;
    }

    private function nullableStr($value, int $maxLen): ?string
    {
        $s = trim((string) ($value ?? ''));
        if ($s === '') {
            return null;
        }

        return mb_substr($s, 0, $maxLen);
    }
}
