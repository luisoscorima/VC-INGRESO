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
require_once __DIR__ . '/../helpers/upload_storage.php';
require_once __DIR__ . '/../helpers/temporary_visit.php';
require_once __DIR__ . '/../helpers/access_identity.php';

use Utils\Response;
use Utils\Router;

class AccessLogController
{
    private $pdo;
    private $table = 'access_logs';

    /** @var list<string> */
    private const OPERATOR_DECISIONS = [
        'CONSULTADO_PROPIETARIO',
        'AUTORIZADO_POR_PROPIETARIO',
        'RECHAZO_CONFIRMADO',
        'SIN_DOMICILIO',
    ];

    private const MAX_ACCESS_CAPTURE_PHOTOS = 5;

    public function __construct($pdo)
    {
        $this->pdo = $pdo;
        self::ensureOperatorNotesColumns($this->pdo);
        self::ensureOperatorDecisionColumns($this->pdo);
        self::ensurePhotoUrlsColumns($this->pdo);
    }

    private static function ensureOperatorNotesColumns(\PDO $pdo): void
    {
        foreach (['access_logs', 'temporary_access_logs'] as $table) {
            $stmt = $pdo->prepare(
                'SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?'
            );
            $stmt->execute([$table, 'operator_notes']);
            if ((int) $stmt->fetchColumn() === 0) {
                $pdo->exec("ALTER TABLE {$table} ADD COLUMN operator_notes TEXT DEFAULT NULL");
            }
        }
    }

    private static function ensureOperatorDecisionColumns(\PDO $pdo): void
    {
        $enumSql = "ENUM('CONSULTADO_PROPIETARIO','AUTORIZADO_POR_PROPIETARIO','RECHAZO_CONFIRMADO','SIN_DOMICILIO') DEFAULT NULL";
        foreach (['access_logs', 'temporary_access_logs'] as $table) {
            $stmt = $pdo->prepare(
                'SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?'
            );
            $stmt->execute([$table, 'operator_decision']);
            if ((int) $stmt->fetchColumn() === 0) {
                $pdo->exec("ALTER TABLE {$table} ADD COLUMN operator_decision {$enumSql}");
            }
        }
    }

    private static function ensurePhotoUrlsColumns(\PDO $pdo): void
    {
        foreach (['access_logs', 'temporary_access_logs'] as $table) {
            $stmt = $pdo->prepare(
                'SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?'
            );
            $stmt->execute([$table, 'photo_urls']);
            if ((int) $stmt->fetchColumn() === 0) {
                $pdo->exec("ALTER TABLE {$table} ADD COLUMN photo_urls JSON DEFAULT NULL COMMENT 'Array de rutas/URLs de fotos garita'");
            }
        }
    }

    private function sanitizeOperatorNotes($raw): ?string
    {
        if ($raw === null || $raw === '') {
            return null;
        }
        $text = trim(strip_tags((string) $raw));
        if ($text === '') {
            return null;
        }

        return mb_substr($text, 0, 2000);
    }

    /**
     * Evita doble registro accidental en ventana corta (misma identidad + punto + tipo).
     */
    private function rejectDuplicateRecentEntry(int $accessPointId, string $type, array $data): void
    {
        if ($type !== 'INGRESO') {
            return;
        }
        $windowSeconds = 8;
        $since = date('Y-m-d H:i:s', time() - $windowSeconds);
        $clauses = ['access_point_id = ?', 'type = ?', 'created_at >= ?'];
        $params = [$accessPointId, 'INGRESO', $since];

        if (!empty($data['person_id'])) {
            $clauses[] = 'person_id = ?';
            $params[] = (int) $data['person_id'];
        } elseif (!empty($data['vehicle_id'])) {
            $clauses[] = 'vehicle_id = ?';
            $params[] = (int) $data['vehicle_id'];
        } elseif (!empty($data['doc_number'])) {
            $clauses[] = 'doc_number = ?';
            $params[] = trim((string) $data['doc_number']);
        } elseif (!empty($data['license_plate'])) {
            $clauses[] = 'license_plate_snapshot = ?';
            $params[] = normalize_license_plate((string) $data['license_plate']);
        } else {
            return;
        }

        $sql = 'SELECT id FROM access_logs WHERE ' . implode(' AND ', $clauses) . ' LIMIT 1';
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        if ($stmt->fetchColumn()) {
            Response::json([
                'success' => false,
                'error' => 'Registro duplicado reciente; espere unos segundos.',
            ], 409);
            exit;
        }
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

        // Filtro por fecha específica (rango para usar idx_created_at)
        if (isset($params['date']) && $params['date']) {
            $day = trim((string) $params['date']);
            if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $day)) {
                $where[] = 'created_at >= ? AND created_at < ?';
                $values[] = $day . ' 00:00:00';
                $values[] = (new \DateTimeImmutable($day))->modify('+1 day')->format('Y-m-d') . ' 00:00:00';
            }
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

        $accessPointId = (int) $data['access_point_id'];
        if (!$this->findActiveAccessPoint($accessPointId)) {
            Response::json(['success' => false, 'error' => 'Punto de acceso inactivo o no encontrado'], 422);
            return;
        }

        $createdByUserId = isset($auth['user_id']) ? (int)$auth['user_id'] : null;
        $entrySourceRaw = strtolower(trim((string) ($data['entry_source'] ?? 'manual')));
        $entrySource = in_array($entrySourceRaw, ['manual', 'qr', 'camera'], true) ? $entrySourceRaw : 'manual';

        try {
            if ($data['type'] === 'EGRESO') {
                $this->closeOpenAccessLog($auth, $data, $accessPointId, $createdByUserId);
                return;
            }

            if (empty($data['authorized_from_attempt'])) {
                $this->rejectDuplicateRecentEntry($accessPointId, $data['type'], $data);
            }

            $identity = $this->resolveIdentitySnapshot($data);
            $operatorNotes = $this->sanitizeOperatorNotes($data['operator_notes'] ?? null);
            $stmt = $this->pdo->prepare("
                INSERT INTO {$this->table} 
                (access_point_id, person_id, doc_number, vehicle_id, entity_kind,
                 display_name_snapshot, document_snapshot, document_type_snapshot, license_plate_snapshot,
                 identity_source, identity_resolved_at, type, observation, operator_notes, entry_source,
                 created_by_user_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ");

            $stmt->execute([
                $data['access_point_id'],
                $data['person_id'] ?? null,
                $data['doc_number'] ?? null,
                $data['vehicle_id'] ?? null,
                $identity['entity_kind'],
                $identity['display_name_snapshot'],
                $identity['document_snapshot'],
                $identity['document_type_snapshot'],
                $identity['license_plate_snapshot'],
                $identity['identity_source'],
                $identity['identity_resolved_at'],
                $data['type'],
                $data['observation'] ?? null,
                $operatorNotes,
                $entrySource,
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
        } catch (\InvalidArgumentException $e) {
            Response::json(['success' => false, 'error' => $e->getMessage()], 422);
        } catch (\PDOException $e) {
            Response::json(['success' => false, 'error' => 'Error al registrar: ' . $e->getMessage()], 500);
        }
    }

    /**
     * Cierra el último INGRESO abierto (misma persona/vehículo/doc/placa y punto de acceso).
     * Si no hay ingreso abierto, crea un EGRESO observado (orphan_exit) para auditoría e incidencias.
     */
    private function closeOpenAccessLog(array $auth, array $data, int $accessPointId, ?int $createdByUserId): void
    {
        $personId = $this->nullablePositiveInt($data['person_id'] ?? null);
        $vehicleId = $this->nullablePositiveInt($data['vehicle_id'] ?? null);
        $docNumber = trim((string) ($data['doc_number'] ?? ''));
        if ($personId === null && $docNumber !== '') {
            $identity = require_valid_identity_document(
                $data['document_type'] ?? $data['type_doc'] ?? '',
                $docNumber
            );
            $docNumber = $identity['value'];
        }
        $licensePlate = $this->extractLicensePlateFromPayload($data);

        $open = $this->findOpenAccessLogIngress($accessPointId, $personId, $vehicleId, $docNumber, $licensePlate);
        if (!$open) {
            // Placa/persona denegada u observada sin ingreso previo: dejar constancia EGRESO (no 422).
            $this->createStandaloneEgressLog($auth, $data, $accessPointId, $createdByUserId);
            return;
        }

        $logId = (int) $open['id'];
        $now = date('Y-m-d H:i:s');
        $exitNote = trim((string) ($data['observation'] ?? ''));
        $newObservation = trim((string) ($open['observation'] ?? ''));
        if ($exitNote !== '') {
            $newObservation = $newObservation !== ''
                ? $newObservation . ' | SALIDA: ' . $exitNote
                : 'SALIDA: ' . $exitNote;
        } elseif ($newObservation !== '') {
            $newObservation .= ' | SALIDA';
        } else {
            $newObservation = 'SALIDA';
        }

        try {
            $stmt = $this->pdo->prepare(
                "UPDATE {$this->table}
                 SET updated_at = ?, observation = ?
                 WHERE id = ? AND type = 'INGRESO' AND updated_at <= created_at"
            );
            $stmt->execute([$now, $newObservation, $logId]);

            if ($stmt->rowCount() === 0) {
                $this->createStandaloneEgressLog($auth, $data, $accessPointId, $createdByUserId);
                return;
            }

            $entryTs = strtotime((string) ($open['created_at'] ?? ''));
            $exitTs = strtotime($now);
            $permanenceMinutes = ($entryTs !== false && $exitTs !== false && $exitTs >= $entryTs)
                ? (int) max(0, round(($exitTs - $entryTs) / 60))
                : 0;

            recordEventLog($this->pdo, $auth, 'access_log.exit', [
                'summary' => 'Salida registrada en log #' . $logId,
                'entity_type' => 'access_logs',
                'entity_id' => $logId,
                'details' => [
                    'access_point_id' => $accessPointId,
                    'permanence_minutes' => $permanenceMinutes,
                ],
            ]);

            Response::json([
                'success' => true,
                'data' => [
                    'id' => $logId,
                    'closed' => true,
                    'permanence_minutes' => $permanenceMinutes,
                    'message' => 'Salida registrada',
                ],
            ], 200);
        } catch (\PDOException $e) {
            Response::json(['success' => false, 'error' => 'Error al registrar salida: ' . $e->getMessage()], 500);
        }
    }

    /**
     * EGRESO sin ingreso abierto (p. ej. placa no registrada / denegado en salida).
     * Crea fila de auditoría para historial e incidencias de escaneo.
     */
    private function createStandaloneEgressLog(
        array $auth,
        array $data,
        int $accessPointId,
        ?int $createdByUserId
    ): void {
        try {
            $identity = $this->resolveIdentitySnapshot($data);
            $entrySourceRaw = strtolower(trim((string) ($data['entry_source'] ?? 'manual')));
            $entrySource = in_array($entrySourceRaw, ['manual', 'qr', 'camera'], true) ? $entrySourceRaw : 'manual';

            $observation = trim((string) ($data['observation'] ?? ''));
            if ($observation === '') {
                $observation = 'EGRESO | SIN ENTRADA ABIERTA';
            } elseif (stripos($observation, 'SIN ENTRADA ABIERTA') === false) {
                $observation .= ' | SIN ENTRADA ABIERTA';
            }

            $stmt = $this->pdo->prepare("
                INSERT INTO {$this->table}
                (access_point_id, person_id, doc_number, vehicle_id, entity_kind,
                 display_name_snapshot, document_snapshot, document_type_snapshot, license_plate_snapshot,
                 identity_source, identity_resolved_at, type, observation, entry_source,
                 created_by_user_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'EGRESO', ?, ?, ?, NOW())
            ");

            $stmt->execute([
                $accessPointId,
                $data['person_id'] ?? null,
                $data['doc_number'] ?? null,
                $data['vehicle_id'] ?? null,
                $identity['entity_kind'],
                $identity['display_name_snapshot'],
                $identity['document_snapshot'],
                $identity['document_type_snapshot'],
                $identity['license_plate_snapshot'],
                $identity['identity_source'],
                $identity['identity_resolved_at'],
                $observation,
                $entrySource,
                $createdByUserId,
            ]);

            $id = (int) $this->pdo->lastInsertId();

            recordEventLog($this->pdo, $auth, 'access_log.orphan_exit', [
                'summary' => 'Salida observada sin ingreso previo #' . $id,
                'entity_type' => 'access_logs',
                'entity_id' => $id,
                'details' => [
                    'access_point_id' => $accessPointId,
                    'orphan_exit' => true,
                ],
            ]);

            Response::json([
                'success' => true,
                'data' => [
                    'id' => $id,
                    'closed' => false,
                    'orphan_exit' => true,
                    'permanence_minutes' => 0,
                    'message' => 'Salida observada sin ingreso previo',
                ],
            ], 201);
        } catch (\InvalidArgumentException $e) {
            Response::json(['success' => false, 'error' => $e->getMessage()], 422);
        } catch (\PDOException $e) {
            Response::json(['success' => false, 'error' => 'Error al registrar salida observada: ' . $e->getMessage()], 500);
        }
    }

    private function findOpenAccessLogIngress(
        int $accessPointId,
        ?int $personId,
        ?int $vehicleId,
        string $docNumber,
        ?string $licensePlate
    ): ?array {
        $identitySql = '';
        $identityParams = [];

        if ($personId !== null) {
            $identitySql = 'person_id = ?';
            $identityParams[] = $personId;
        } elseif ($vehicleId !== null) {
            $identitySql = 'vehicle_id = ?';
            $identityParams[] = $vehicleId;
        } elseif ($docNumber !== '') {
            $identitySql = '(document_snapshot = ? OR doc_number = ?)';
            $identityParams[] = $docNumber;
            $identityParams[] = $docNumber;
        } elseif ($licensePlate !== null && $licensePlate !== '') {
            $identitySql = '(license_plate_snapshot = ? OR doc_number = ? OR observation LIKE ?)';
            $identityParams[] = $licensePlate;
            $identityParams[] = $licensePlate;
            $identityParams[] = '%placa ' . $licensePlate . '%';
        } else {
            return null;
        }

        $sql = "SELECT id, created_at, updated_at, observation, person_id, vehicle_id, doc_number
                FROM {$this->table}
                WHERE type = 'INGRESO'
                  AND access_point_id = ?
                  AND updated_at <= created_at
                  AND (observation IS NULL OR observation NOT LIKE '%DENEGADO%')
                  AND ({$identitySql})
                ORDER BY created_at DESC
                LIMIT 1";

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute(array_merge([$accessPointId], $identityParams));
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);

        return $row ?: null;
    }

    private function extractLicensePlateFromPayload(array $data): ?string
    {
        $plate = trim((string) ($data['license_plate'] ?? ''));
        if ($plate !== '') {
            return require_valid_license_plate($plate);
        }
        $obs = (string) ($data['observation'] ?? '');
        if (preg_match('/placa\s+([A-Za-z0-9-]+)/iu', $obs, $m)) {
            return require_valid_license_plate($m[1]);
        }

        return null;
    }

    private function nullablePositiveInt($value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }
        $n = (int) $value;

        return $n > 0 ? $n : null;
    }

    /**
     * @return array{entity_kind:string,display_name_snapshot:?string,document_snapshot:?string,document_type_snapshot:?string,license_plate_snapshot:?string,identity_source:?string,identity_resolved_at:?string}
     */
    private function resolveIdentitySnapshot(array $data): array
    {
        $personId = $this->nullablePositiveInt($data['person_id'] ?? null);
        $vehicleId = $this->nullablePositiveInt($data['vehicle_id'] ?? null);
        if ($personId !== null && $vehicleId !== null) {
            throw new \InvalidArgumentException('El registro no puede ser persona y vehículo a la vez');
        }

        $kind = strtoupper(trim((string) ($data['entity_kind'] ?? $data['kind'] ?? '')));
        if ($kind === 'PERSONA') $kind = 'PERSON';
        if ($kind === 'VEHÍCULO' || $kind === 'VEHICULO') $kind = 'VEHICLE';
        $plate = $this->extractLicensePlateFromPayload($data);
        if ($kind === '') {
            $kind = ($vehicleId !== null || $plate !== null) ? 'VEHICLE' : 'PERSON';
        }
        if (!in_array($kind, ['PERSON', 'VEHICLE'], true)) {
            throw new \InvalidArgumentException('entity_kind inválido');
        }
        if (($kind === 'PERSON' && $vehicleId !== null) || ($kind === 'VEHICLE' && $personId !== null)) {
            throw new \InvalidArgumentException('entity_kind no coincide con la identidad enviada');
        }

        $snapshot = [
            'entity_kind' => $kind,
            'display_name_snapshot' => null,
            'document_snapshot' => null,
            'document_type_snapshot' => null,
            'license_plate_snapshot' => null,
            'identity_source' => null,
            'identity_resolved_at' => null,
        ];

        if ($kind === 'PERSON') {
            $document = trim((string) ($data['doc_number'] ?? ''));
            if ($personId !== null) {
                $stmt = $this->pdo->prepare(
                    "SELECT type_doc, doc_number, first_name, paternal_surname, maternal_surname
                     FROM persons WHERE id = ? LIMIT 1"
                );
                $stmt->execute([$personId]);
                $person = $stmt->fetch(\PDO::FETCH_ASSOC);
                if (!$person) throw new \InvalidArgumentException('Persona no encontrada');
                $snapshot['display_name_snapshot'] = access_identity_full_name($person);
                $localDocument = trim((string) ($person['doc_number'] ?? ''));
                $snapshot['document_snapshot'] = $localDocument !== ''
                    ? $localDocument
                    : ($document !== '' ? $document : null);
                $snapshot['document_type_snapshot'] = normalize_identity_document_type($person['type_doc'] ?? '') ?: null;
                $snapshot['identity_source'] = 'LOCAL';
                $snapshot['identity_resolved_at'] = date('Y-m-d H:i:s');
            } else {
                if ($document !== '') {
                    $identity = require_valid_identity_document($data['document_type'] ?? $data['type_doc'] ?? '', $document);
                    $document = $identity['value'];
                    $snapshot['document_snapshot'] = $document;
                    $snapshot['document_type_snapshot'] = $identity['type'];
                }
                $claim = access_identity_verify_claim($data['identity_claim'] ?? null, $document);
                if ($claim) {
                    $snapshot = array_merge($snapshot, $claim);
                }
            }
            return $snapshot;
        }

        if ($vehicleId !== null) {
            $stmt = $this->pdo->prepare(
                "SELECT v.license_plate, owner.first_name, owner.paternal_surname, owner.maternal_surname
                 FROM vehicles v
                 LEFT JOIN persons owner ON owner.id = v.owner_id
                 WHERE v.vehicle_id = ? LIMIT 1"
            );
            $stmt->execute([$vehicleId]);
            $vehicle = $stmt->fetch(\PDO::FETCH_ASSOC);
            if (!$vehicle) throw new \InvalidArgumentException('Vehículo no encontrado');
            $snapshot['display_name_snapshot'] = access_identity_full_name($vehicle);
            $snapshot['license_plate_snapshot'] =
                normalize_license_plate((string) ($vehicle['license_plate'] ?? '')) ?: $plate;
            $snapshot['identity_source'] = 'LOCAL';
            $snapshot['identity_resolved_at'] = date('Y-m-d H:i:s');
        } else {
            $snapshot['license_plate_snapshot'] = $plate;
        }
        return $snapshot;
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

        if (!$this->findActiveAccessPoint($accessPointId)) {
            Response::json(['success' => false, 'error' => 'Punto de acceso inactivo o no encontrado'], 422);
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
        $entrySourceRaw = strtolower(trim((string) ($data['entry_source'] ?? 'manual')));
        $entrySource = in_array($entrySourceRaw, ['manual', 'qr', 'camera'], true) ? $entrySourceRaw : 'manual';
        $now = date('Y-m-d H:i:s');
        $assignmentValidUntil = (string) ($assignment['valid_until'] ?? '');
        $authorizedMinutes = assignment_authorized_duration_minutes($assignment);
        $stayDeadline = date('Y-m-d H:i:s', strtotime($now) + ($authorizedMinutes * 60));

        try {
            $profileStmt = $this->pdo->prepare(
                'SELECT temp_visit_name, temp_visit_doc, temp_visit_doc_type, temp_visit_plate
                 FROM temporary_visits WHERE temp_visit_id = ? LIMIT 1'
            );
            $profileStmt->execute([$tempVisitId]);
            $profile = $profileStmt->fetch(\PDO::FETCH_ASSOC);
            if (!$profile) {
                Response::json(['success' => false, 'error' => 'Visita temporal no encontrada'], 404);
                return;
            }
            $snapshotPlate = normalize_license_plate((string) ($profile['temp_visit_plate'] ?? ''));
            $snapshotDoc = trim((string) ($profile['temp_visit_doc'] ?? ''));
            $snapshotDocType = normalize_identity_document_type($profile['temp_visit_doc_type'] ?? '') ?: null;
            $snapshotName = trim((string) ($profile['temp_visit_name'] ?? ''));
            $entityKind = $snapshotPlate !== '' ? 'VEHICLE' : 'PERSON';
            $operatorNotes = $this->sanitizeOperatorNotes($data['operator_notes'] ?? null);
            $stmt = $this->pdo->prepare(
                "INSERT INTO temporary_access_logs
                 (temp_visit_id, entity_kind, display_name_snapshot, document_snapshot, document_type_snapshot,
                  license_plate_snapshot, identity_source, identity_resolved_at,
                  assignment_id, assignment_valid_until, authorized_duration_minutes, stay_deadline,
                  temp_entry_time, access_point_id, status_validated, entry_source, house_id, operator_notes, created_by_user_id)
                 VALUES (?, ?, ?, ?, ?, ?, 'LOCAL', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            );
            $stmt->execute([
                $tempVisitId,
                $entityKind,
                $snapshotName !== '' ? $snapshotName : null,
                $snapshotDoc !== '' ? $snapshotDoc : null,
                $snapshotDocType,
                $snapshotPlate !== '' ? $snapshotPlate : null,
                $now,
                $assignmentId,
                $assignmentValidUntil !== '' ? $assignmentValidUntil : null,
                $authorizedMinutes,
                $stayDeadline,
                $now,
                $accessPointId,
                $statusValidated !== '' ? $statusValidated : 'PERMITIDO',
                $entrySource,
                $houseId,
                $operatorNotes,
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

        if (!$this->findActiveAccessPoint($accessPointId)) {
            Response::json(['success' => false, 'error' => 'Punto de acceso inactivo o no encontrado'], 422);
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
     * Puntos de acceso operativos (garita, escáner, filtros). Por defecto solo activos.
     * Query opcional: include_inactive=1 para incluir inactivos (p. ej. filtros históricos).
     */
    public function accessPoints()
    {
        requireAuth();

        $includeInactive = isset($_GET['include_inactive'])
            && in_array(strtolower(trim((string) $_GET['include_inactive'])), ['1', 'true', 'yes'], true);

        $sql = 'SELECT * FROM access_points';
        if (!$includeInactive) {
            $sql .= ' WHERE COALESCE(is_active, 1) = 1';
        }
        $sql .= ' ORDER BY name';

        $stmt = $this->pdo->query($sql);
        $points = $stmt->fetchAll(\PDO::FETCH_ASSOC);

        Response::json(['success' => true, 'data' => $points]);
    }

    /** @return array<string, mixed>|null */
    private function findActiveAccessPoint(int $accessPointId): ?array
    {
        if ($accessPointId <= 0) {
            return null;
        }
        $stmt = $this->pdo->prepare(
            'SELECT * FROM access_points WHERE id = ? AND COALESCE(is_active, 1) = 1 LIMIT 1'
        );
        $stmt->execute([$accessPointId]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);

        return $row ?: null;
    }

    /** GET ?fecha=&access_point= — id o nombre de punto. Incluye access_logs + temporary_access_logs. */
    public function historyByDate()
    {
        $auth = requireAuth();
        $fecha = trim((string) ($_GET['fecha'] ?? ''));
        $ap = $this->accessPointQueryValue();
        if ($fecha === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $fecha)) {
            Response::json(['success' => false, 'error' => 'fecha requerida'], 400);
            return;
        }

        $dayStart = $fecha . ' 00:00:00';
        $dayEndExclusive = (new \DateTimeImmutable($fecha))->modify('+1 day')->format('Y-m-d') . ' 00:00:00';

        $whereMain = ['al.created_at >= ? AND al.created_at < ?'];
        $paramsMain = [$dayStart, $dayEndExclusive];
        $this->appendAccessPointFilter($ap, $whereMain, $paramsMain, 'al');

        $whereTemp = ['tal.temp_entry_time >= ? AND tal.temp_entry_time < ?'];
        $paramsTemp = [$dayStart, $dayEndExclusive];
        $this->appendAccessPointFilter($ap, $whereTemp, $paramsTemp, 'tal');

        $this->appendHistoryNeighborHouseScope($auth, $whereMain, $paramsMain, $whereTemp, $paramsTemp);

        $includeIncidents = isStaffRole($auth) && canViewModule($this->pdo, $auth, 'incidents');

        $sqlMain = $this->historyRowsSelectSql($includeIncidents, $ap) . ' WHERE ' . implode(' AND ', $whereMain);
        $sqlTemp = $this->historyTemporaryRowsSelectSql($includeIncidents, $ap) . ' WHERE ' . implode(' AND ', $whereTemp);
        $this->respondHistoryUnion($sqlMain, $paramsMain, $sqlTemp, $paramsTemp, 'DESC');
    }

    /** GET ?fecha_inicial=&fecha_final=&access_point=&limit=&offset= (opcional: vacío = todos los puntos). */
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

        $sqlMain = $this->historyRowsSelectSql($includeIncidents, $ap) . ' WHERE ' . implode(' AND ', $whereMain);
        $sqlTemp = $this->historyTemporaryRowsSelectSql($includeIncidents, $ap) . ' WHERE ' . implode(' AND ', $whereTemp);
        $this->respondHistoryUnion($sqlMain, $paramsMain, $sqlTemp, $paramsTemp, 'DESC');
    }

    /** GET ?fecha=&access_point=&doc= — fecha YYYY-MM-DD. access_point vacío = todos. Incluye access_logs + temporary_access_logs. */
    public function historyByClient()
    {
        $auth = requireAuth();
        $fecha = trim((string) ($_GET['fecha'] ?? ''));
        $ap = $this->accessPointQueryValue();
        $doc = trim((string) ($_GET['doc'] ?? ''));
        if ($fecha === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $fecha)) {
            Response::json(['success' => false, 'error' => 'fecha requerida'], 400);
            return;
        }

        $dayStart = $fecha . ' 00:00:00';
        $dayEndExclusive = (new \DateTimeImmutable($fecha))->modify('+1 day')->format('Y-m-d') . ' 00:00:00';

        $whereMain = ['al.created_at >= ? AND al.created_at < ?'];
        $paramsMain = [$dayStart, $dayEndExclusive];
        $this->appendAccessPointFilter($ap, $whereMain, $paramsMain, 'al');
        if ($doc !== '') {
            $whereMain[] = '(al.doc_number = ? OR p.doc_number = ?)';
            $paramsMain[] = $doc;
            $paramsMain[] = $doc;
        }

        $whereTemp = ['tal.temp_entry_time >= ? AND tal.temp_entry_time < ?'];
        $paramsTemp = [$dayStart, $dayEndExclusive];
        $this->appendAccessPointFilter($ap, $whereTemp, $paramsTemp, 'tal');
        if ($doc !== '') {
            $whereTemp[] = '(tv.temp_visit_doc = ? OR tv.temp_visit_plate = ?)';
            $paramsTemp[] = $doc;
            $paramsTemp[] = $doc;
        }

        $this->appendHistoryNeighborHouseScope($auth, $whereMain, $paramsMain, $whereTemp, $paramsTemp);

        $sqlMain = $this->historyRowsSelectSql(false, $ap) . ' WHERE ' . implode(' AND ', $whereMain);
        $sqlTemp = $this->historyTemporaryRowsSelectSql(false, $ap) . ' WHERE ' . implode(' AND ', $whereTemp);
        $this->respondHistoryUnion($sqlMain, $paramsMain, $sqlTemp, $paramsTemp, 'ASC');
    }

    /**
     * @return array{0: int, 1: int} [limit, offset]
     */
    private function historyPagination(): array
    {
        $limit = isset($_GET['limit']) ? (int) $_GET['limit'] : 200;
        $offset = isset($_GET['offset']) ? (int) $_GET['offset'] : 0;
        $limit = max(1, min(500, $limit));
        $offset = max(0, $offset);

        return [$limit, $offset];
    }

    /**
     * Respuesta paginada { data, total } para UNION access_logs + temporary_access_logs.
     *
     * @param list<mixed> $paramsMain
     * @param list<mixed> $paramsTemp
     */
    private function respondHistoryUnion(
        string $sqlMain,
        array $paramsMain,
        string $sqlTemp,
        array $paramsTemp,
        string $orderDir = 'DESC'
    ): void {
        [$limit, $offset] = $this->historyPagination();
        $orderDir = strtoupper($orderDir) === 'ASC' ? 'ASC' : 'DESC';
        $unionSql = '((' . $sqlMain . ') UNION ALL (' . $sqlTemp . '))';
        $params = array_merge($paramsMain, $paramsTemp);

        $countStmt = $this->pdo->prepare('SELECT COUNT(*) FROM ' . $unionSql . ' AS combined');
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();

        $dataSql = 'SELECT * FROM ' . $unionSql . ' AS combined ORDER BY date_entry ' . $orderDir
            . ' LIMIT ' . $limit . ' OFFSET ' . $offset;
        $stmt = $this->pdo->prepare($dataSql);
        $stmt->execute($params);
        $rows = $this->resolveHistoryMediaUrls($stmt->fetchAll(\PDO::FETCH_OBJ));

        Response::json([
            'data' => $rows,
            'total' => $total,
            'limit' => $limit,
            'offset' => $offset,
        ]);
    }

    /**
     * Unifica collation UTF-8 para columnas de texto en UNION ALL (MySQL 1271 Illegal mix of collations).
     */
    private function historyUnionStr(string $exprSql): string
    {
        return "CONVERT(($exprSql) USING utf8mb4) COLLATE utf8mb4_unicode_ci";
    }

    /**
     * Filtro de punto para subconsultas de same_day_count (id interpolado o nombre quoted).
     *
     * @return array{0: string, 1: string} [filtro access_logs al2, filtro temporary tal2]
     */
    private function historySameDayAccessPointSql(string $ap): array
    {
        $ap = trim($ap);
        if ($ap === '') {
            return ['', ''];
        }
        if (ctype_digit($ap)) {
            $id = (int) $ap;
            return [" AND al2.access_point_id = {$id}", " AND tal2.access_point_id = {$id}"];
        }
        $quoted = $this->pdo->quote($ap);

        return [
            " AND EXISTS (SELECT 1 FROM access_points apx WHERE apx.id = al2.access_point_id AND apx.name = {$quoted})",
            " AND EXISTS (SELECT 1 FROM access_points apx WHERE apx.id = tal2.access_point_id AND apx.name = {$quoted})",
        ];
    }

    /**
     * Conteos del mismo documento en el mismo día (access_logs + temporary_access_logs).
     * Vacío o "—" → 1 para no mostrar el botón Día.
     */
    private function historySameDayCountSql(string $docExprSql, string $entryTsSql, string $ap = ''): string
    {
        [$apMain, $apTemp] = $this->historySameDayAccessPointSql($ap);
        $docMatch = "COALESCE(NULLIF(TRIM(al2.document_snapshot), ''), NULLIF(TRIM(al2.doc_number), ''), NULLIF(TRIM(p2.doc_number), ''), '')";
        $tempDoc = "COALESCE(NULLIF(TRIM(tal2.document_snapshot), ''), NULLIF(TRIM(tv2.temp_visit_doc), ''), '')";
        $tempPlate = "NULLIF(TRIM(COALESCE(tal2.license_plate_snapshot, tv2.temp_visit_plate)), '')";

        return "
            CASE
                WHEN NULLIF(TRIM({$docExprSql}), '') IS NULL THEN 1
                ELSE (
                    (
                        SELECT COUNT(*)
                        FROM {$this->table} al2
                        LEFT JOIN persons p2 ON p2.id = al2.person_id
                        WHERE al2.created_at >= CAST({$entryTsSql} AS DATE)
                          AND al2.created_at < CAST({$entryTsSql} AS DATE) + INTERVAL 1 DAY
                          AND {$docMatch} = {$docExprSql}
                          {$apMain}
                    )
                    +
                    (
                        SELECT COUNT(*)
                        FROM temporary_access_logs tal2
                        LEFT JOIN temporary_visits tv2 ON tv2.temp_visit_id = tal2.temp_visit_id
                        WHERE tal2.temp_entry_time >= CAST({$entryTsSql} AS DATE)
                          AND tal2.temp_entry_time < CAST({$entryTsSql} AS DATE) + INTERVAL 1 DAY
                          AND ({$tempDoc} = {$docExprSql} OR {$tempPlate} = {$docExprSql})
                          {$apTemp}
                    )
                )
            END
        ";
    }

    /**
     * Columnas de preview de incidencia (misma forma con o sin permiso).
     *
     * @return array{0: string, 1: string} [SELECT extra, JOIN extra]
     */
    private function historyIncidentPreviewSql(bool $includeIncidents, string $joinColumnSql, string $incidentFk): array
    {
        $s = fn (string $e) => $this->historyUnionStr($e);
        if (!$includeIncidents) {
            return [
                ', 0 AS incident_count'
                . ", {$s('CAST(NULL AS CHAR(1))')} AS incident_preview_description"
                . ", {$s('CAST(NULL AS CHAR(1))')} AS incident_preview_photo_url",
                '',
            ];
        }

        $photoExpr = "COALESCE(
            NULLIF(TRIM(ai.photo_url), ''),
            NULLIF(JSON_UNQUOTE(JSON_EXTRACT(ai.photo_urls, '\$[0]')), ''),
            NULLIF(JSON_UNQUOTE(JSON_EXTRACT(ai.photo_urls, '\$[0]')), 'null')
        )";

        $select = ', COALESCE(ai_prev.cnt, 0) AS incident_count'
            . ", {$s('ai_prev.preview_description')} AS incident_preview_description"
            . ", {$s('ai_prev.preview_photo_url')} AS incident_preview_photo_url";

        $join = "
            LEFT JOIN (
                SELECT x.{$incidentFk} AS incident_fk,
                       x.cnt,
                       ai.description AS preview_description,
                       {$photoExpr} AS preview_photo_url
                FROM (
                    SELECT {$incidentFk}, COUNT(*) AS cnt, MAX(incident_id) AS last_id
                    FROM access_incidents
                    WHERE {$incidentFk} IS NOT NULL
                    GROUP BY {$incidentFk}
                ) x
                INNER JOIN access_incidents ai ON ai.incident_id = x.last_id
            ) ai_prev ON ai_prev.incident_fk = {$joinColumnSql}
        ";

        return [$select, $join];
    }

    /**
     * SELECT enriquecido para pantalla Historial (columnas alineadas al mat-table Angular).
     */
    private function historyRowsSelectSql(bool $includeIncidentCount = false, string $accessPoint = ''): string
    {
        $t = $this->table;
        $s = fn (string $e) => $this->historyUnionStr($e);
        $docExpr = "COALESCE(NULLIF(TRIM(al.document_snapshot), ''), NULLIF(TRIM(al.doc_number), ''), NULLIF(TRIM(p.doc_number), ''), '')";
        $sameDaySql = $this->historySameDayCountSql($docExpr, 'al.created_at', $accessPoint);
        [$incidentSelect, $incidentJoin] = $this->historyIncidentPreviewSql(
            $includeIncidentCount,
            'al.id',
            'access_log_id'
        );

        return "
            SELECT
                al.id,
                al.access_point_id,
                NULL AS temp_visit_id,
                al.person_id,
                al.house_id,
                {$s("COALESCE(NULLIF(TRIM(al.document_snapshot), ''), NULLIF(TRIM(al.doc_number), ''), NULLIF(TRIM(p.doc_number), ''), '')")} AS doc_number,
                al.vehicle_id,
                {$s("COALESCE(al.entity_kind, CASE WHEN al.vehicle_id IS NOT NULL OR NULLIF(TRIM(al.license_plate_snapshot), '') IS NOT NULL OR al.observation REGEXP 'placa[[:space:]]+[[:alnum:]-]+' THEN 'VEHICLE' ELSE 'PERSON' END)")} AS entity_kind,
                {$s('al.display_name_snapshot')} AS display_name_snapshot,
                {$s('al.document_snapshot')} AS document_snapshot,
                {$s('al.license_plate_snapshot')} AS license_plate_snapshot,
                {$s('al.identity_source')} AS identity_source,
                al.identity_resolved_at,
                {$s('al.type')} AS movement_type,
                {$s('al.observation')} AS observation_raw,
                {$s('al.operator_notes')} AS operator_notes,
                {$s('al.operator_decision')} AS operator_decision,
                {$s('al.entry_source')} AS entry_source,
                {$s('al.photo_url')} AS access_photo_url,
                al.created_by_user_id,
                al.created_at,
                al.updated_at,
                {$s('ap.name')} AS access_point_name,
                {$s("CASE WHEN COALESCE(al.entity_kind, CASE WHEN al.vehicle_id IS NOT NULL OR NULLIF(TRIM(al.license_plate_snapshot), '') IS NOT NULL OR al.observation REGEXP 'placa[[:space:]]+[[:alnum:]-]+' THEN 'VEHICLE' ELSE 'PERSON' END) = 'VEHICLE' THEN 'VEHÍCULO' ELSE 'PERSONA' END")} AS type,
                {$s("COALESCE(NULLIF(TRIM(al.license_plate_snapshot), ''), NULLIF(TRIM(v.license_plate), ''))")} AS vehicle_plate,
                {$s("CONCAT_WS(' ', NULLIF(h.block_house,''), NULLIF(CAST(h.lot AS CHAR),''), NULLIF(h.apartment,''))")} AS house_address,
                al.created_at AS date_entry,
                CASE
                    WHEN al.type = 'INGRESO'
                         AND al.updated_at > al.created_at
                         AND (
                            al.observation LIKE '%| SALIDA%'
                            OR al.observation LIKE 'SALIDA%'
                         )
                    THEN al.updated_at
                    ELSE NULL
                END AS date_exit,
                {$s("COALESCE(NULLIF(TRIM(al.observation), ''), NULLIF(p.status_validated, ''), '—')")} AS obs,
                {$s("COALESCE(NULLIF(TRIM(u.username_system), ''), IF(al.created_by_user_id IS NOT NULL, CONCAT('#', al.created_by_user_id), NULL), '—')")} AS `operator`,
                {$s("NULLIF(TRIM(CONCAT(COALESCE(oup.first_name,''), ' ', COALESCE(oup.paternal_surname,''))), '')")} AS operator_name,
                {$s("COALESCE(NULLIF(TRIM(u.role_system), ''), '')")} AS operator_role,
                {$s("DATE_FORMAT(al.created_at, '%H:%i:%s')")} AS hour_entrance,
                1 AS visits,
                {$s("COALESCE(
                    NULLIF(TRIM(al.display_name_snapshot), ''),
                    CASE
                        WHEN COALESCE(al.entity_kind, CASE WHEN al.vehicle_id IS NOT NULL OR NULLIF(TRIM(al.license_plate_snapshot), '') IS NOT NULL OR al.observation REGEXP 'placa[[:space:]]+[[:alnum:]-]+' THEN 'VEHICLE' ELSE 'PERSON' END) = 'VEHICLE'
                            THEN NULLIF(TRIM(CONCAT(COALESCE(vo.first_name,''),' ',COALESCE(vo.paternal_surname,''),' ',COALESCE(vo.maternal_surname,''))), '')
                        ELSE NULLIF(TRIM(CONCAT(COALESCE(p.first_name,''),' ',COALESCE(p.paternal_surname,''),' ',COALESCE(p.maternal_surname,''))), '')
                    END,
                    CASE
                        WHEN COALESCE(al.entity_kind, CASE WHEN al.vehicle_id IS NOT NULL OR NULLIF(TRIM(al.license_plate_snapshot), '') IS NOT NULL OR al.observation REGEXP 'placa[[:space:]]+[[:alnum:]-]+' THEN 'VEHICLE' ELSE 'PERSON' END) = 'VEHICLE'
                            THEN '—'
                        ELSE 'Persona no identificada'
                    END
                )")} AS name,
                {$s("COALESCE(NULLIF(UPPER(TRIM(p.person_type)), ''), '')")} AS person_category,
                {$s("'REGISTRY'")} AS log_source,
                NULL AS assignment_valid_until,
                NULL AS authorized_duration_minutes,
                NULL AS stay_deadline,
                NULL AS permanence_minutes,
                0 AS stay_exceeded,
                NULL AS session_open,
                ({$sameDaySql}) AS same_day_count
                {$incidentSelect}
            FROM {$t} al
            LEFT JOIN access_points ap ON ap.id = al.access_point_id
            LEFT JOIN persons p ON p.id = al.person_id
            LEFT JOIN vehicles v ON v.vehicle_id = al.vehicle_id
            LEFT JOIN persons vo ON vo.id = v.owner_id
            LEFT JOIN houses h ON h.house_id = COALESCE(al.house_id, p.house_id, v.house_id)
            LEFT JOIN users u ON u.user_id = al.created_by_user_id
            LEFT JOIN persons oup ON oup.id = u.person_id
            {$incidentJoin}
        ";
    }

    /**
     * Misma forma de columnas que historyRowsSelectSql(), desde temporary_access_logs + temporary_visits.
     * id negativo para no chocar con access_logs.id.
     */
    private function historyTemporaryRowsSelectSql(bool $includeIncidentCount = false, string $accessPoint = ''): string
    {
        $s = fn (string $e) => $this->historyUnionStr($e);
        $docExpr = "COALESCE(NULLIF(TRIM(tal.document_snapshot), ''), NULLIF(TRIM(tv.temp_visit_doc), ''), '')";
        $sameDaySql = $this->historySameDayCountSql($docExpr, 'tal.temp_entry_time', $accessPoint);
        [$incidentSelect, $incidentJoin] = $this->historyIncidentPreviewSql(
            $includeIncidentCount,
            'tal.temp_access_log_id',
            'temp_access_log_id'
        );

        return "
            SELECT
                -(tal.temp_access_log_id) AS id,
                tal.access_point_id,
                tal.temp_visit_id,
                NULL AS person_id,
                tal.house_id,
                {$s("COALESCE(NULLIF(TRIM(tal.document_snapshot), ''), NULLIF(TRIM(tv.temp_visit_doc), ''), '')")} AS doc_number,
                NULL AS vehicle_id,
                {$s("COALESCE(tal.entity_kind, CASE WHEN NULLIF(TRIM(COALESCE(tal.license_plate_snapshot, tv.temp_visit_plate)), '') IS NOT NULL THEN 'VEHICLE' ELSE 'PERSON' END)")} AS entity_kind,
                {$s('tal.display_name_snapshot')} AS display_name_snapshot,
                {$s('tal.document_snapshot')} AS document_snapshot,
                {$s('tal.license_plate_snapshot')} AS license_plate_snapshot,
                {$s('tal.identity_source')} AS identity_source,
                tal.identity_resolved_at,
                {$s("'INGRESO'")} AS movement_type,
                {$s('CAST(NULL AS CHAR(1))')} AS observation_raw,
                {$s('tal.operator_notes')} AS operator_notes,
                {$s('tal.operator_decision')} AS operator_decision,
                {$s('tal.entry_source')} AS entry_source,
                {$s('tal.photo_url')} AS access_photo_url,
                tal.created_by_user_id,
                tal.temp_entry_time AS created_at,
                COALESCE(tal.temp_exit_time, tal.temp_entry_time) AS updated_at,
                {$s('ap.name')} AS access_point_name,
                {$s("CASE WHEN COALESCE(tal.entity_kind, CASE WHEN NULLIF(TRIM(COALESCE(tal.license_plate_snapshot, tv.temp_visit_plate)), '') IS NOT NULL THEN 'VEHICLE' ELSE 'PERSON' END) = 'VEHICLE' THEN 'VEHÍCULO' ELSE 'PERSONA' END")} AS type,
                {$s("COALESCE(NULLIF(TRIM(tal.license_plate_snapshot), ''), NULLIF(TRIM(tv.temp_visit_plate), ''))")} AS vehicle_plate,
                {$s("CONCAT_WS(' ', NULLIF(h.block_house,''), NULLIF(CAST(h.lot AS CHAR),''), NULLIF(h.apartment,''))")} AS house_address,
                tal.temp_entry_time AS date_entry,
                tal.temp_exit_time AS date_exit,
                {$s("COALESCE(NULLIF(TRIM(tal.status_validated), ''), '—')")} AS obs,
                {$s("COALESCE(
                    NULLIF(TRIM(u.username_system), ''),
                    IF(COALESCE(tal.created_by_user_id, tal.operario_id) IS NOT NULL, CONCAT('#', COALESCE(tal.created_by_user_id, tal.operario_id)), NULL),
                    '—'
                )")} AS `operator`,
                {$s("NULLIF(TRIM(CONCAT(COALESCE(oup.first_name,''), ' ', COALESCE(oup.paternal_surname,''))), '')")} AS operator_name,
                {$s("COALESCE(NULLIF(TRIM(u.role_system), ''), '')")} AS operator_role,
                {$s("DATE_FORMAT(tal.temp_entry_time, '%H:%i:%s')")} AS hour_entrance,
                1 AS visits,
                {$s("COALESCE(
                    NULLIF(TRIM(tal.display_name_snapshot), ''),
                    NULLIF(TRIM(tv.temp_visit_name), ''),
                    CASE
                        WHEN COALESCE(tal.entity_kind, CASE WHEN NULLIF(TRIM(COALESCE(tal.license_plate_snapshot, tv.temp_visit_plate)), '') IS NOT NULL THEN 'VEHICLE' ELSE 'PERSON' END) = 'VEHICLE'
                            THEN '—'
                        ELSE 'Persona no identificada'
                    END
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
                IF(tal.temp_exit_time IS NULL, 1, 0) AS session_open,
                ({$sameDaySql}) AS same_day_count
                {$incidentSelect}
            FROM temporary_access_logs tal
            LEFT JOIN temporary_visits tv ON tv.temp_visit_id = tal.temp_visit_id
            LEFT JOIN access_points ap ON ap.id = tal.access_point_id
            LEFT JOIN houses h ON h.house_id = tal.house_id
            LEFT JOIN users u ON u.user_id = COALESCE(tal.created_by_user_id, tal.operario_id)
            LEFT JOIN persons oup ON oup.id = u.person_id
            {$incidentJoin}
        ";
    }

    /**
     * Expone URLs de captura de cámara listas para el cliente (S3 público o path local).
     *
     * @param array<int, object> $rows
     * @return array<int, object>
     */
    private function resolveHistoryMediaUrls(array $rows): array
    {
        foreach ($rows as $row) {
            if (!is_object($row)) {
                continue;
            }
            if (isset($row->access_photo_url)) {
                $row->access_photo_url = resolveMediaUrl(
                    $row->access_photo_url !== null ? (string) $row->access_photo_url : null
                );
            }
            if (isset($row->incident_preview_photo_url)) {
                $row->incident_preview_photo_url = resolveMediaUrl(
                    $row->incident_preview_photo_url !== null ? (string) $row->incident_preview_photo_url : null
                );
            }
        }
        return $rows;
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
        $where[] = "COALESCE(al.house_id, p.house_id, v.house_id) IN ({$ph})";
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
        $whereMain[] = "COALESCE(al.house_id, p.house_id, v.house_id) IN ({$ph})";
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

    private function sanitizeOperatorDecision($raw): ?string
    {
        if ($raw === null || $raw === '') {
            return null;
        }
        $value = strtoupper(trim((string) $raw));

        return in_array($value, self::OPERATOR_DECISIONS, true) ? $value : null;
    }

    private function isDeniedAccessLogAttempt(array $row): bool
    {
        $obs = strtoupper(trim((string) ($row['observation'] ?? '')));

        return str_starts_with($obs, 'DENEGADO')
            || str_contains($obs, '| DENEGADO')
            || str_contains($obs, 'DENEGADO |');
    }

    private function isDeniedTemporaryAttempt(array $row): bool
    {
        $status = strtoupper(trim((string) ($row['status_validated'] ?? '')));
        if ($status !== 'DENEGADO') {
            return false;
        }
        $entry = strtotime((string) ($row['temp_entry_time'] ?? ''));
        $exit = strtotime((string) ($row['temp_exit_time'] ?? ''));
        if ($entry === false || $exit === false) {
            return true;
        }

        return abs($exit - $entry) <= 1;
    }

    private function validateHouseIdOrNull($houseIdRaw): ?int
    {
        if ($houseIdRaw === null || $houseIdRaw === '' || (int) $houseIdRaw === 0) {
            return null;
        }
        $houseId = (int) $houseIdRaw;
        if ($houseId <= 0) {
            return null;
        }
        $stmt = $this->pdo->prepare('SELECT house_id FROM houses WHERE house_id = ? LIMIT 1');
        $stmt->execute([$houseId]);
        if (!$stmt->fetchColumn()) {
            Response::json(['success' => false, 'error' => 'Domicilio no encontrado'], 422);
            exit;
        }

        return $houseId;
    }

    /**
     * @return list<string>
     */
    private function decodeAccessLogPhotoUrls(array $row): array
    {
        $raw = $row['photo_urls'] ?? null;
        if (is_string($raw) && $raw !== '') {
            $decoded = json_decode($raw, true);
            if (is_array($decoded)) {
                $paths = [];
                foreach ($decoded as $item) {
                    $path = trim((string) $item);
                    if ($path !== '') {
                        $paths[] = $path;
                    }
                }
                if ($paths !== []) {
                    return $paths;
                }
            }
        }
        $single = trim((string) ($row['photo_url'] ?? ''));
        if ($single !== '') {
            return [$single];
        }

        return [];
    }

    /**
     * @param array<string,mixed> $row
     * @return array<string,mixed>
     */
    private function normalizeAccessLogPhotoFields(array $row): array
    {
        $paths = $this->decodeAccessLogPhotoUrls($row);
        $resolved = [];
        foreach ($paths as $path) {
            $url = resolveMediaUrl($path);
            if ($url !== null && $url !== '') {
                $resolved[] = $url;
            }
        }
        $row['photo_urls'] = $resolved;
        $row['photo_url'] = $resolved[0] ?? null;

        return $row;
    }

    /**
     * @return list<string>
     */
    private function uploadAccessCapturePhotos(int $logId): array
    {
        $files = $this->collectUploadedPhotoFiles();
        if ($files === []) {
            return [];
        }
        if (count($files) > self::MAX_ACCESS_CAPTURE_PHOTOS) {
            throw new \RuntimeException('Máximo ' . self::MAX_ACCESS_CAPTURE_PHOTOS . ' fotos por acceso.');
        }

        $paths = [];
        $i = 0;
        foreach ($files as $file) {
            $error = (int) ($file['error'] ?? UPLOAD_ERR_OK);
            if ($error === UPLOAD_ERR_NO_FILE) {
                continue;
            }
            if ($error !== UPLOAD_ERR_OK) {
                throw new \RuntimeException($this->uploadAccessCaptureErrorMessage($error));
            }

            $ext = strtolower(pathinfo((string) ($file['name'] ?? ''), PATHINFO_EXTENSION));
            $filename = 'access_' . $logId . '_' . time() . '_' . $i . '.' . ($ext !== '' ? $ext : 'jpg');
            $result = storePublicPhoto($file, 'access-captures', [
                'allowed_exts' => ['jpg', 'jpeg', 'png', 'gif', 'webp'],
                'max_bytes' => 5 * 1024 * 1024,
                'filename' => $filename,
                'field_required' => true,
            ]);
            if (!$result['success']) {
                throw new \RuntimeException($result['error'] ?? 'Error al guardar la imagen.');
            }
            $paths[] = (string) $result['photo_url'];
            $i++;
        }

        return $paths;
    }

    /**
     * @return list<array{name:string,type:string,tmp_name:string,error:int,size:int}>
     */
    private function collectUploadedPhotoFiles(): array
    {
        $out = [];

        foreach (['photos', 'photos[]'] as $key) {
            if (!isset($_FILES[$key]) || !is_array($_FILES[$key])) {
                continue;
            }
            $bag = $_FILES[$key];
            if (isset($bag['name']) && is_array($bag['name'])) {
                $n = count($bag['name']);
                for ($i = 0; $i < $n; $i++) {
                    $out[] = [
                        'name' => (string) ($bag['name'][$i] ?? ''),
                        'type' => (string) ($bag['type'][$i] ?? ''),
                        'tmp_name' => (string) ($bag['tmp_name'][$i] ?? ''),
                        'error' => (int) ($bag['error'][$i] ?? UPLOAD_ERR_NO_FILE),
                        'size' => (int) ($bag['size'][$i] ?? 0),
                    ];
                }
            } elseif (isset($bag['tmp_name']) && is_string($bag['tmp_name'])) {
                $out[] = [
                    'name' => (string) ($bag['name'] ?? ''),
                    'type' => (string) ($bag['type'] ?? ''),
                    'tmp_name' => (string) $bag['tmp_name'],
                    'error' => (int) ($bag['error'] ?? UPLOAD_ERR_NO_FILE),
                    'size' => (int) ($bag['size'] ?? 0),
                ];
            }
        }

        if (isset($_FILES['photo']) && is_array($_FILES['photo']) && isset($_FILES['photo']['tmp_name']) && !is_array($_FILES['photo']['tmp_name'])) {
            $out[] = [
                'name' => (string) ($_FILES['photo']['name'] ?? ''),
                'type' => (string) ($_FILES['photo']['type'] ?? ''),
                'tmp_name' => (string) $_FILES['photo']['tmp_name'],
                'error' => (int) ($_FILES['photo']['error'] ?? UPLOAD_ERR_NO_FILE),
                'size' => (int) ($_FILES['photo']['size'] ?? 0),
            ];
        }

        return $out;
    }

    private function uploadAccessCaptureErrorMessage(int $code): string
    {
        return match ($code) {
            UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => 'La imagen supera el tamaño máximo permitido (5 MB).',
            UPLOAD_ERR_PARTIAL => 'La imagen se subió solo parcialmente. Intente de nuevo.',
            UPLOAD_ERR_NO_TMP_DIR, UPLOAD_ERR_CANT_WRITE, UPLOAD_ERR_EXTENSION => 'Error del servidor al recibir la imagen.',
            default => 'Error al subir la imagen (código ' . $code . ').',
        };
    }

    /**
     * POST /api/v1/access-logs/temporary/denied
     * Registra intento denegado de visita externa (auditoría, sin sesión abierta).
     */
    public function storeTemporaryDenied(): void
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
        if ($accessPointId <= 0 || $tempVisitId <= 0) {
            Response::json(['success' => false, 'error' => 'access_point_id y temp_visit_id requeridos'], 400);
            return;
        }

        if (!$this->findActiveAccessPoint($accessPointId)) {
            Response::json(['success' => false, 'error' => 'Punto de acceso inactivo o no encontrado'], 422);
            return;
        }

        $createdByUserId = isset($auth['user_id']) ? (int) $auth['user_id'] : null;
        $entrySourceRaw = strtolower(trim((string) ($data['entry_source'] ?? 'manual')));
        $entrySource = in_array($entrySourceRaw, ['manual', 'qr', 'camera'], true) ? $entrySourceRaw : 'manual';
        $now = date('Y-m-d H:i:s');
        $houseId = $this->nullablePositiveInt($data['house_id'] ?? null);
        $assignmentId = $this->nullablePositiveInt($data['assignment_id'] ?? null);
        $operatorNotes = $this->sanitizeOperatorNotes($data['operator_notes'] ?? null);

        try {
            $profileStmt = $this->pdo->prepare(
                'SELECT temp_visit_name, temp_visit_doc, temp_visit_doc_type, temp_visit_plate
                 FROM temporary_visits WHERE temp_visit_id = ? LIMIT 1'
            );
            $profileStmt->execute([$tempVisitId]);
            $profile = $profileStmt->fetch(\PDO::FETCH_ASSOC);
            if (!$profile) {
                Response::json(['success' => false, 'error' => 'Visita temporal no encontrada'], 404);
                return;
            }

            $snapshotName = trim((string) ($data['display_name_snapshot'] ?? $profile['temp_visit_name'] ?? ''));
            $snapshotDoc = trim((string) ($data['document_snapshot'] ?? $profile['temp_visit_doc'] ?? ''));
            $snapshotDocType = normalize_identity_document_type(
                $data['document_type_snapshot'] ?? $profile['temp_visit_doc_type'] ?? ''
            ) ?: null;
            $snapshotPlate = normalize_license_plate(
                (string) ($data['license_plate_snapshot'] ?? $profile['temp_visit_plate'] ?? '')
            );
            $entityKindRaw = strtoupper(trim((string) ($data['entity_kind'] ?? '')));
            $entityKind = in_array($entityKindRaw, ['PERSON', 'VEHICLE'], true)
                ? $entityKindRaw
                : ($snapshotPlate !== '' ? 'VEHICLE' : 'PERSON');

            $stmt = $this->pdo->prepare(
                "INSERT INTO temporary_access_logs
                 (temp_visit_id, entity_kind, display_name_snapshot, document_snapshot, document_type_snapshot,
                  license_plate_snapshot, identity_source, identity_resolved_at,
                  assignment_id, temp_entry_time, temp_exit_time, access_point_id, status_validated,
                  entry_source, house_id, operator_notes, created_by_user_id)
                 VALUES (?, ?, ?, ?, ?, ?, 'LOCAL', ?, ?, ?, ?, ?, 'DENEGADO', ?, ?, ?, ?)"
            );
            $stmt->execute([
                $tempVisitId,
                $entityKind,
                $snapshotName !== '' ? $snapshotName : null,
                $snapshotDoc !== '' ? $snapshotDoc : null,
                $snapshotDocType,
                $snapshotPlate !== '' ? $snapshotPlate : null,
                $now,
                $assignmentId,
                $now,
                $now,
                $accessPointId,
                $entrySource,
                $houseId,
                $operatorNotes,
                $createdByUserId,
            ]);

            $id = (int) $this->pdo->lastInsertId();

            recordEventLog($this->pdo, $auth, 'access_log.denied_attempt', [
                'summary' => 'Intento denegado visita externa #' . $tempVisitId,
                'entity_type' => 'temporary_access_logs',
                'entity_id' => $id,
                'details' => [
                    'temp_visit_id' => $tempVisitId,
                    'access_point_id' => $accessPointId,
                    'house_id' => $houseId,
                ],
            ]);

            Response::json([
                'success' => true,
                'data' => [
                    'temp_access_log_id' => $id,
                    'log_ref' => -$id,
                    'message' => 'Intento denegado registrado',
                ],
            ], 201);
        } catch (\PDOException $e) {
            Response::json(['success' => false, 'error' => 'Error al registrar intento: ' . $e->getMessage()], 500);
        }
    }

    /**
     * PATCH /api/v1/access-logs/details/:logRef
     * Completa detalles post-scan (nota, decisión, casa, foto).
     */
    public function patchDetails(int $logRef): void
    {
        $auth = requireAuth();
        if (!isStaffRole($auth)) {
            Response::json(['success' => false, 'error' => 'Solo personal autorizado'], 403);
            return;
        }

        if ($logRef === 0) {
            Response::json(['success' => false, 'error' => 'log_ref inválido'], 400);
            return;
        }

        $isTemp = $logRef < 0;
        $rowId = abs($logRef);
        $table = $isTemp ? 'temporary_access_logs' : 'access_logs';
        $idCol = $isTemp ? 'temp_access_log_id' : 'id';

        $stmt = $this->pdo->prepare("SELECT * FROM {$table} WHERE {$idCol} = ? LIMIT 1");
        $stmt->execute([$rowId]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (!$row) {
            Response::json(['success' => false, 'error' => 'Registro no encontrado'], 404);
            return;
        }

        $contentType = strtolower(trim((string) ($_SERVER['CONTENT_TYPE'] ?? '')));
        $isMultipart = str_contains($contentType, 'multipart/form-data');
        $input = $isMultipart ? $_POST : (json_decode(file_get_contents('php://input'), true) ?: []);

        $updates = [];
        $params = [];

        if (array_key_exists('operator_notes', $input)) {
            $updates[] = 'operator_notes = ?';
            $params[] = $this->sanitizeOperatorNotes($input['operator_notes']);
        }

        if (array_key_exists('operator_decision', $input)) {
            $decision = $this->sanitizeOperatorDecision($input['operator_decision']);
            if ($input['operator_decision'] !== '' && $input['operator_decision'] !== null && $decision === null) {
                Response::json(['success' => false, 'error' => 'operator_decision inválida'], 422);
                return;
            }
            $updates[] = 'operator_decision = ?';
            $params[] = $decision;
        }

        if (array_key_exists('house_id', $input)) {
            $houseId = $this->validateHouseIdOrNull($input['house_id']);
            $updates[] = 'house_id = ?';
            $params[] = $houseId;
        }

        $newPhotoPaths = [];
        if ($isMultipart) {
            try {
                $uploaded = $this->uploadAccessCapturePhotos($rowId);
                if ($uploaded !== []) {
                    $existing = $this->decodeAccessLogPhotoUrls($row);
                    $merged = array_values(array_unique(array_merge($existing, $uploaded)));
                    if (count($merged) > self::MAX_ACCESS_CAPTURE_PHOTOS) {
                        foreach ($uploaded as $path) {
                            deleteStoredMedia($path);
                        }
                        Response::json([
                            'success' => false,
                            'error' => 'Máximo ' . self::MAX_ACCESS_CAPTURE_PHOTOS . ' fotos por acceso.',
                        ], 422);
                        return;
                    }
                    $newPhotoPaths = $merged;
                    $updates[] = 'photo_url = ?';
                    $params[] = $merged[0] ?? null;
                    $updates[] = 'photo_urls = ?';
                    $params[] = json_encode($merged, JSON_UNESCAPED_SLASHES);
                }
            } catch (\RuntimeException $e) {
                Response::json(['success' => false, 'error' => $e->getMessage()], 422);
                return;
            }
        }

        if ($updates === []) {
            Response::json(['success' => false, 'error' => 'Nada que actualizar'], 400);
            return;
        }

        try {
            $params[] = $rowId;
            $sql = "UPDATE {$table} SET " . implode(', ', $updates) . " WHERE {$idCol} = ?";
            $upd = $this->pdo->prepare($sql);
            $upd->execute($params);

            $stmt->execute([$rowId]);
            $updated = $stmt->fetch(\PDO::FETCH_ASSOC) ?: $row;
            $updated = $this->normalizeAccessLogPhotoFields($updated);

            recordEventLog($this->pdo, $auth, 'access_log.details_update', [
                'summary' => 'Detalles actualizados en log ' . $logRef,
                'entity_type' => $table,
                'entity_id' => $rowId,
                'details' => [
                    'log_ref' => $logRef,
                    'fields' => array_keys(array_filter([
                        'operator_notes' => array_key_exists('operator_notes', $input),
                        'operator_decision' => array_key_exists('operator_decision', $input),
                        'house_id' => array_key_exists('house_id', $input),
                        'photo_url' => $newPhotoPaths !== [],
                        'photo_urls' => $newPhotoPaths !== [],
                    ])),
                ],
            ]);

            Response::json([
                'success' => true,
                'data' => [
                    'log_ref' => $logRef,
                    'row' => $updated,
                    'message' => 'Detalles guardados',
                ],
            ], 200);
        } catch (\PDOException $e) {
            Response::json(['success' => false, 'error' => 'Error al actualizar: ' . $e->getMessage()], 500);
        }
    }

    /**
     * POST /api/v1/access-logs/authorize-from-attempt
     * Crea INGRESO PERMITIDO en un clic tras autorización del propietario.
     */
    public function authorizeFromAttempt(): void
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

        $logRef = (int) ($data['log_ref'] ?? 0);
        if ($logRef === 0) {
            Response::json(['success' => false, 'error' => 'log_ref requerido'], 400);
            return;
        }

        $overrideHouseId = array_key_exists('house_id', $data)
            ? $this->validateHouseIdOrNull($data['house_id'])
            : null;

        if ($logRef > 0) {
            $this->authorizeFromResidentAttempt($auth, $logRef, $overrideHouseId);
            return;
        }

        $this->authorizeFromTemporaryAttempt($auth, abs($logRef), $overrideHouseId);
    }

    private function authorizeFromResidentAttempt(array $auth, int $attemptId, ?int $overrideHouseId): void
    {
        $stmt = $this->pdo->prepare("SELECT * FROM {$this->table} WHERE id = ? LIMIT 1");
        $stmt->execute([$attemptId]);
        $attempt = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (!$attempt) {
            Response::json(['success' => false, 'error' => 'Registro no encontrado'], 404);
            return;
        }
        if ((string) ($attempt['type'] ?? '') !== 'INGRESO') {
            Response::json(['success' => false, 'error' => 'Solo aplica a intentos de ingreso'], 422);
            return;
        }
        if (!$this->isDeniedAccessLogAttempt($attempt)) {
            Response::json(['success' => false, 'error' => 'El registro no es un intento denegado'], 422);
            return;
        }
        if (($attempt['operator_decision'] ?? '') !== 'AUTORIZADO_POR_PROPIETARIO') {
            Response::json([
                'success' => false,
                'error' => 'Registre la decisión «Autorizado por propietario» antes de autorizar el ingreso',
            ], 422);
            return;
        }

        $houseId = $overrideHouseId ?? $this->nullablePositiveInt($attempt['house_id'] ?? null);
        $createdByUserId = isset($auth['user_id']) ? (int) $auth['user_id'] : null;
        $entrySource = in_array($attempt['entry_source'] ?? '', ['manual', 'qr', 'camera'], true)
            ? $attempt['entry_source']
            : 'manual';

        try {
            $payload = [
                'access_point_id' => (int) $attempt['access_point_id'],
                'type' => 'INGRESO',
                'observation' => 'PERMITIDO | AUTORIZADO_OPERARIO',
                'entry_source' => $entrySource,
                'person_id' => $attempt['person_id'] ?? null,
                'doc_number' => $attempt['doc_number'] ?? null,
                'vehicle_id' => $attempt['vehicle_id'] ?? null,
                'license_plate' => $attempt['license_plate_snapshot'] ?? null,
                'entity_kind' => $attempt['entity_kind'] ?? null,
                'display_name_snapshot' => $attempt['display_name_snapshot'] ?? null,
                'document_snapshot' => $attempt['document_snapshot'] ?? null,
                'document_type_snapshot' => $attempt['document_type_snapshot'] ?? null,
                'license_plate_snapshot' => $attempt['license_plate_snapshot'] ?? null,
                'identity_source' => $attempt['identity_source'] ?? null,
                'identity_resolved_at' => $attempt['identity_resolved_at'] ?? null,
                'authorized_from_attempt' => true,
            ];

            $identity = $this->resolveIdentitySnapshot($payload);
            $insert = $this->pdo->prepare(
                "INSERT INTO {$this->table}
                 (access_point_id, person_id, doc_number, vehicle_id, house_id, entity_kind,
                  display_name_snapshot, document_snapshot, document_type_snapshot, license_plate_snapshot,
                  identity_source, identity_resolved_at, type, observation, entry_source,
                  created_by_user_id, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INGRESO', ?, ?, ?, NOW())"
            );
            $insert->execute([
                (int) $attempt['access_point_id'],
                $attempt['person_id'] ?? null,
                $attempt['doc_number'] ?? null,
                $attempt['vehicle_id'] ?? null,
                $houseId,
                $identity['entity_kind'],
                $identity['display_name_snapshot'],
                $identity['document_snapshot'],
                $identity['document_type_snapshot'],
                $identity['license_plate_snapshot'],
                $identity['identity_source'],
                $identity['identity_resolved_at'],
                'PERMITIDO | AUTORIZADO_OPERARIO',
                $entrySource,
                $createdByUserId,
            ]);

            $newId = (int) $this->pdo->lastInsertId();

            recordEventLog($this->pdo, $auth, 'access_log.authorize_from_attempt', [
                'summary' => 'Ingreso autorizado desde intento #' . $attemptId,
                'entity_type' => 'access_logs',
                'entity_id' => $newId,
                'details' => [
                    'attempt_log_id' => $attemptId,
                    'house_id' => $houseId,
                ],
            ]);

            Response::json([
                'success' => true,
                'data' => [
                    'authorized_log_id' => $newId,
                    'log_ref' => $newId,
                    'message' => 'Ingreso autorizado registrado',
                ],
            ], 201);
        } catch (\PDOException $e) {
            Response::json(['success' => false, 'error' => 'Error al autorizar ingreso: ' . $e->getMessage()], 500);
        }
    }

    private function authorizeFromTemporaryAttempt(array $auth, int $attemptId, ?int $overrideHouseId): void
    {
        $stmt = $this->pdo->prepare('SELECT * FROM temporary_access_logs WHERE temp_access_log_id = ? LIMIT 1');
        $stmt->execute([$attemptId]);
        $attempt = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (!$attempt) {
            Response::json(['success' => false, 'error' => 'Registro no encontrado'], 404);
            return;
        }
        if (!$this->isDeniedTemporaryAttempt($attempt)) {
            Response::json(['success' => false, 'error' => 'El registro no es un intento denegado'], 422);
            return;
        }
        if (($attempt['operator_decision'] ?? '') !== 'AUTORIZADO_POR_PROPIETARIO') {
            Response::json([
                'success' => false,
                'error' => 'Registre la decisión «Autorizado por propietario» antes de autorizar el ingreso',
            ], 422);
            return;
        }

        $tempVisitId = (int) ($attempt['temp_visit_id'] ?? 0);
        $accessPointId = (int) ($attempt['access_point_id'] ?? 0);
        $houseId = $overrideHouseId ?? $this->nullablePositiveInt($attempt['house_id'] ?? null);
        $assignmentId = $this->nullablePositiveInt($attempt['assignment_id'] ?? null);

        if ($tempVisitId <= 0 || $accessPointId <= 0) {
            Response::json(['success' => false, 'error' => 'Intento incompleto'], 422);
            return;
        }

        if (!$this->findActiveAccessPoint($accessPointId)) {
            Response::json(['success' => false, 'error' => 'Punto de acceso inactivo o no encontrado'], 422);
            return;
        }

        $openStmt = $this->pdo->prepare(
            'SELECT temp_access_log_id FROM temporary_access_logs
             WHERE temp_visit_id = ? AND temp_exit_time IS NULL
             LIMIT 1'
        );
        $openStmt->execute([$tempVisitId]);
        if ($openStmt->fetchColumn()) {
            Response::json(['success' => false, 'error' => 'Ya hay una entrada abierta para esta visita'], 409);
            return;
        }

        $assignment = resolve_temp_visit_assignment_for_entry($this->pdo, $tempVisitId, (int) ($houseId ?? 0), (int) ($assignmentId ?? 0));
        $assignmentOverride = false;
        if (!$assignment) {
            if ($houseId === null || $houseId <= 0) {
                Response::json(['success' => false, 'error' => 'Indique domicilio para autorizar el ingreso'], 422);
                return;
            }
            $assignmentOverride = true;
            $authorizedMinutes = 120;
            $assignmentValidUntil = date('Y-m-d H:i:s', strtotime('+2 hours'));
            $assignmentIdResolved = $assignmentId;
        } else {
            $assignmentIdResolved = (int) $assignment['assignment_id'];
            $houseId = (int) $assignment['house_id'];
            $authorizedMinutes = assignment_authorized_duration_minutes($assignment);
            $assignmentValidUntil = (string) ($assignment['valid_until'] ?? '');
        }

        $createdByUserId = isset($auth['user_id']) ? (int) $auth['user_id'] : null;
        $entrySource = in_array($attempt['entry_source'] ?? '', ['manual', 'qr', 'camera'], true)
            ? $attempt['entry_source']
            : 'manual';
        $now = date('Y-m-d H:i:s');
        $stayDeadline = date('Y-m-d H:i:s', strtotime($now) + ($authorizedMinutes * 60));

        try {
            $insert = $this->pdo->prepare(
                "INSERT INTO temporary_access_logs
                 (temp_visit_id, entity_kind, display_name_snapshot, document_snapshot, document_type_snapshot,
                  license_plate_snapshot, identity_source, identity_resolved_at,
                  assignment_id, assignment_valid_until, authorized_duration_minutes, stay_deadline,
                  temp_entry_time, access_point_id, status_validated, entry_source, house_id, created_by_user_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PERMITIDO', ?, ?, ?)"
            );
            $insert->execute([
                $tempVisitId,
                $attempt['entity_kind'] ?? null,
                $attempt['display_name_snapshot'] ?? null,
                $attempt['document_snapshot'] ?? null,
                $attempt['document_type_snapshot'] ?? null,
                $attempt['license_plate_snapshot'] ?? null,
                $attempt['identity_source'] ?? 'LOCAL',
                $attempt['identity_resolved_at'] ?? $now,
                $assignmentIdResolved,
                $assignmentValidUntil !== '' ? $assignmentValidUntil : null,
                $authorizedMinutes,
                $stayDeadline,
                $now,
                $accessPointId,
                $entrySource,
                $houseId,
                $createdByUserId,
            ]);

            $newId = (int) $this->pdo->lastInsertId();

            recordEventLog($this->pdo, $auth, 'access_log.authorize_from_attempt', [
                'summary' => 'Ingreso externo autorizado desde intento #' . $attemptId,
                'entity_type' => 'temporary_access_logs',
                'entity_id' => $newId,
                'details' => [
                    'attempt_log_id' => $attemptId,
                    'temp_visit_id' => $tempVisitId,
                    'house_id' => $houseId,
                    'assignment_override' => $assignmentOverride,
                ],
            ]);

            Response::json([
                'success' => true,
                'data' => [
                    'authorized_log_id' => $newId,
                    'log_ref' => -$newId,
                    'authorized_duration_minutes' => $authorizedMinutes,
                    'stay_deadline' => $stayDeadline,
                    'assignment_override' => $assignmentOverride,
                    'message' => 'Ingreso autorizado registrado',
                ],
            ], 201);
        } catch (\PDOException $e) {
            Response::json(['success' => false, 'error' => 'Error al autorizar ingreso: ' . $e->getMessage()], 500);
        }
    }
}
