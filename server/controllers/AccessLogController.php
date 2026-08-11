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

            $identity = $this->resolveIdentitySnapshot($data);
            $stmt = $this->pdo->prepare("
                INSERT INTO {$this->table} 
                (access_point_id, person_id, doc_number, vehicle_id, entity_kind,
                 display_name_snapshot, document_snapshot, document_type_snapshot, license_plate_snapshot,
                 identity_source, identity_resolved_at, type, observation, entry_source,
                 created_by_user_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
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
            $stmt = $this->pdo->prepare(
                "INSERT INTO temporary_access_logs
                 (temp_visit_id, entity_kind, display_name_snapshot, document_snapshot, document_type_snapshot,
                  license_plate_snapshot, identity_source, identity_resolved_at,
                  assignment_id, assignment_valid_until, authorized_duration_minutes, stay_deadline,
                  temp_entry_time, access_point_id, status_validated, entry_source, house_id, created_by_user_id)
                 VALUES (?, ?, ?, ?, ?, ?, 'LOCAL', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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

        $sqlMain = $this->historyRowsSelectSql($includeIncidents) . ' WHERE ' . implode(' AND ', $whereMain);
        $sqlTemp = $this->historyTemporaryRowsSelectSql($includeIncidents) . ' WHERE ' . implode(' AND ', $whereTemp);
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

        $sqlMain = $this->historyRowsSelectSql($includeIncidents) . ' WHERE ' . implode(' AND ', $whereMain);
        $sqlTemp = $this->historyTemporaryRowsSelectSql($includeIncidents) . ' WHERE ' . implode(' AND ', $whereTemp);
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

        $sqlMain = $this->historyRowsSelectSql() . ' WHERE ' . implode(' AND ', $whereMain);
        $sqlTemp = $this->historyTemporaryRowsSelectSql() . ' WHERE ' . implode(' AND ', $whereTemp);
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
                    WHEN al.type = 'INGRESO' AND al.updated_at > al.created_at THEN al.updated_at
                    WHEN al.type = 'EGRESO' THEN al.updated_at
                    ELSE NULL
                END AS date_exit,
                {$s("COALESCE(NULLIF(TRIM(al.observation), ''), NULLIF(p.status_validated, ''), '—')")} AS obs,
                {$s("COALESCE(NULLIF(TRIM(u.username_system), ''), IF(al.created_by_user_id IS NOT NULL, CONCAT('#', al.created_by_user_id), NULL), '—')")} AS `operator`,
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
                NULL AS session_open
                {$incidentSelect}
            FROM {$t} al
            LEFT JOIN access_points ap ON ap.id = al.access_point_id
            LEFT JOIN persons p ON p.id = al.person_id
            LEFT JOIN vehicles v ON v.vehicle_id = al.vehicle_id
            LEFT JOIN persons vo ON vo.id = v.owner_id
            LEFT JOIN houses h ON h.house_id = COALESCE(al.house_id, p.house_id, v.house_id)
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
}
