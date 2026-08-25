<?php
/**
 * ExternalVehicleController — catálogo global temporary_visits + asignaciones por casa.
 */

namespace Controllers;

require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../helpers/house_permissions.php';
require_once __DIR__ . '/../helpers/nav_permissions.php';
require_once __DIR__ . '/../helpers/license_plate.php';
require_once __DIR__ . '/../helpers/temporary_visit.php';

use Utils\Response;

class ExternalVehicleController extends Controller {
    protected $tableName = 'temporary_visits';

    private function getAuthUserId(array $auth): int {
        return isset($auth['user_id']) ? (int) $auth['user_id'] : 0;
    }

    private function expireAssignments(): void {
        expire_temp_visit_assignments($this->db);
    }

    private function canAccessTemporaryVisit(array $auth, $visit): bool {
        if (canViewModule($this->db, $auth, 'external_visits')) {
            return true;
        }
        $tempVisitId = is_object($visit)
            ? (int) ($visit->temp_visit_id ?? 0)
            : (int) ($visit['temp_visit_id'] ?? 0);
        if ($tempVisitId <= 0) {
            return false;
        }

        return $this->neighborHasAssignmentOnProfile($auth, $tempVisitId);
    }

    private function neighborHasAssignmentOnProfile(array $auth, int $tempVisitId): bool {
        $ids = getAccessibleHouseIds($this->db, $auth);
        if ($ids === []) {
            return false;
        }
        $ph = implode(',', array_fill(0, count($ids), '?'));
        $params = array_merge([$tempVisitId], $ids);
        $stmt = $this->db->prepare(
            "SELECT 1 FROM temporary_visit_assignments
             WHERE temp_visit_id = ? AND house_id IN ({$ph})
             LIMIT 1"
        );
        $stmt->execute($params);

        return (bool) $stmt->fetchColumn();
    }

    public function index($params = []) {
        $auth = requireAuth();
        $this->expireAssignments();

        $houseId = (int) ($_GET['house_id'] ?? $params['house_id'] ?? 0);
        $activeParam = $_GET['active'] ?? $params['active'] ?? '';
        $active = $activeParam === '1' || $activeParam === 'true';
        $mineParam = $_GET['mine'] ?? $params['mine'] ?? '';
        $mine = $mineParam === '1' || $mineParam === 'true';

        if ($mine && $houseId <= 0) {
            $houseId = (int) ($auth['house_id'] ?? 0);
            if ($houseId <= 0) {
                $houseId = infer_user_primary_house_id($this->db, $this->getAuthUserId($auth));
            }
            $active = true;
        }

        if ($active || $mine) {
            if ($houseId <= 0) {
                Response::error('house_id requerido para listar visitas activas', 400);
                return;
            }
            if (!canAccessHouse($this->db, $auth, $houseId)) {
                Response::error('Sin permiso para ver visitas de esta casa', 403);
                return;
            }
            $stmt = $this->db->prepare(
                "SELECT tv.*,
                        tva.assignment_id,
                        tva.house_id,
                        tva.valid_from,
                        tva.valid_until,
                        tva.status AS assignment_status,
                        tva.registered_by_user_id AS assignment_registered_by_user_id,
                        TIMESTAMPDIFF(MINUTE, NOW(), tva.valid_until) AS minutes_remaining
                 FROM temporary_visit_assignments tva
                 INNER JOIN temporary_visits tv ON tv.temp_visit_id = tva.temp_visit_id
                 WHERE tva.house_id = ?
                   AND tva.status = 'ACTIVA'
                   AND tva.valid_until > NOW()
                 ORDER BY tva.valid_until ASC"
            );
            $stmt->execute([$houseId]);
            $rows = $stmt->fetchAll(\PDO::FETCH_OBJ);
            Response::success($rows, 'Visitas externas activas obtenidas correctamente');
            return;
        }

        if (!canViewModule($this->db, $auth, 'external_visits')) {
            Response::error('Sin permiso para ver el catálogo global', 403);
            return;
        }

        $visits = $this->getAll([], 'temp_visit_id DESC');
        $enriched = $this->attachAssignmentsToCatalog($visits);
        Response::success($enriched, 'Catálogo global de visitas externas');
    }

    /**
     * Adjunta asignaciones vigentes y recientes a cada perfil del padrón (staff).
     *
     * @param array<int, object|array> $visits
     * @return list<array<string, mixed>>
     */
    private function attachAssignmentsToCatalog(array $visits): array {
        if ($visits === []) {
            return [];
        }

        $rows = [];
        $ids = [];
        foreach ($visits as $visit) {
            $row = is_object($visit) ? (array) $visit : (array) $visit;
            $tid = (int) ($row['temp_visit_id'] ?? 0);
            if ($tid > 0) {
                $ids[] = $tid;
            }
            $row['assignments'] = [];
            $rows[$tid > 0 ? $tid : ('x' . count($rows))] = $row;
        }

        $ids = array_values(array_unique(array_filter($ids)));
        if ($ids === []) {
            return array_values($rows);
        }

        $ph = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $this->db->prepare(
            "SELECT tva.assignment_id,
                    tva.temp_visit_id,
                    tva.house_id,
                    tva.valid_from,
                    tva.valid_until,
                    tva.status,
                    tva.registered_by_user_id,
                    TIMESTAMPDIFF(MINUTE, NOW(), tva.valid_until) AS minutes_remaining,
                    h.block_house,
                    h.lot,
                    h.apartment,
                    u.username_system AS registered_by_username,
                    TRIM(CONCAT(
                        COALESCE(p.first_name, ''), ' ',
                        COALESCE(p.paternal_surname, ''), ' ',
                        COALESCE(p.maternal_surname, '')
                    )) AS registered_by_name
             FROM temporary_visit_assignments tva
             INNER JOIN houses h ON h.house_id = tva.house_id
             LEFT JOIN users u ON u.user_id = tva.registered_by_user_id
             LEFT JOIN persons p ON p.person_id = u.person_id
             WHERE tva.temp_visit_id IN ({$ph})
               AND (
                    (tva.status = 'ACTIVA' AND tva.valid_until > NOW())
                    OR tva.valid_until >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
                    OR (tva.status = 'CANCELADA' AND tva.updated_at >= CURDATE())
               )
             ORDER BY
                (tva.status = 'ACTIVA' AND tva.valid_until > NOW()) DESC,
                tva.valid_until DESC"
        );
        $stmt->execute($ids);
        $assignments = $stmt->fetchAll(\PDO::FETCH_ASSOC);

        foreach ($assignments as $a) {
            $tid = (int) $a['temp_visit_id'];
            if (!isset($rows[$tid])) {
                continue;
            }
            $block = trim((string) ($a['block_house'] ?? ''));
            $lot = trim((string) ($a['lot'] ?? ''));
            $apt = trim((string) ($a['apartment'] ?? ''));
            $houseLabel = trim("Mz:{$block} Lt:{$lot}" . ($apt !== '' ? " Dpt:{$apt}" : ''));
            $name = trim((string) ($a['registered_by_name'] ?? ''));
            $username = trim((string) ($a['registered_by_username'] ?? ''));
            $registeredLabel = $name !== '' ? $name : ($username !== '' ? $username : null);
            if ($registeredLabel === null && !empty($a['registered_by_user_id'])) {
                $registeredLabel = '#' . (int) $a['registered_by_user_id'];
            }

            $rawMinutes = $a['minutes_remaining'];
            $isActive = ($a['status'] === 'ACTIVA')
                && $rawMinutes !== null
                && (int) $rawMinutes >= 0;
            $minutesRemaining = ($rawMinutes !== null && (int) $rawMinutes >= 0)
                ? (int) $rawMinutes
                : null;

            $rows[$tid]['assignments'][] = [
                'assignment_id' => (int) $a['assignment_id'],
                'house_id' => (int) $a['house_id'],
                'house_label' => $houseLabel,
                'block_house' => $a['block_house'],
                'lot' => $a['lot'],
                'apartment' => $a['apartment'],
                'valid_from' => $a['valid_from'],
                'valid_until' => $a['valid_until'],
                'status' => $a['status'],
                'registered_by_user_id' => $a['registered_by_user_id'] !== null
                    ? (int) $a['registered_by_user_id']
                    : null,
                'registered_by_label' => $registeredLabel,
                'minutes_remaining' => $minutesRemaining !== null ? (int) $minutesRemaining : null,
                'is_active' => $isActive,
            ];
        }

        return array_values($rows);
    }

    public function lookup($params = []) {
        requireAuth();
        $plate = trim((string) ($_GET['plate'] ?? $_GET['temp_visit_plate'] ?? ''));
        $doc = trim((string) ($_GET['doc'] ?? $_GET['temp_visit_doc'] ?? ''));
        $docType = trim((string) ($_GET['document_type'] ?? $_GET['temp_visit_doc_type'] ?? ''));

        if ($plate === '' && $doc === '') {
            Response::error('Indique placa o documento', 400);
            return;
        }
        if ($plate !== '' && !validate_license_plate(normalize_license_plate($plate))) {
            Response::error('Ingrese una placa peruana de 6 letras o números. Puede usar espacios o guion.', 422);
            return;
        }
        if ($doc !== '') {
            try {
                require_valid_identity_document($docType, $doc);
            } catch (\InvalidArgumentException $e) {
                Response::error($e->getMessage(), 422);
                return;
            }
        }

        $profile = find_temp_visit_profile($this->db, $plate !== '' ? $plate : null, $doc !== '' ? $doc : null, $docType ?: null);
        if (!$profile) {
            Response::success(['found' => false, 'profile' => null], 'Sin coincidencia');
            return;
        }

        Response::success(['found' => true, 'profile' => $profile], 'Perfil encontrado');
    }

    public function show($params = []) {
        $auth = requireAuth();
        $id = $params['id'] ?? null;

        if (!$id) {
            Response::error('ID requerido', 400);
            return;
        }

        $visit = $this->findById($id, 'temp_visit_id');
        if (!$visit) {
            Response::notFound('Visita externa no encontrada');
            return;
        }
        if (!$this->canAccessTemporaryVisit($auth, $visit)) {
            Response::error('Sin permiso para ver este registro', 403);
            return;
        }

        Response::success($visit);
    }

    public function store($params = []) {
        $auth = requireAuth();
        $uid = $this->getAuthUserId($auth);
        if ($uid <= 0) {
            Response::error('Sesión inválida', 403);
            return;
        }

        $data = $this->getInput();
        $plateRaw = trim((string) ($data['temp_visit_plate'] ?? ''));
        $nameRaw = trim((string) ($data['temp_visit_name'] ?? ''));
        $doc = trim((string) ($data['temp_visit_doc'] ?? ''));
        if ($nameRaw === '') {
            Response::error('Campo requerido faltante: temp_visit_name', 400);
            return;
        }

        $explicitHouseId = array_key_exists('house_id', $data) ? (int) $data['house_id'] : 0;
        $staffCanManage = isStaffRole($auth) && canManageModule($this->db, $auth, 'external_visits');
        $catalogOnly = false;
        $houseId = 0;
        $durationMinutes = null;

        if ($staffCanManage && $explicitHouseId <= 0) {
            // Staff: sin casa explícita → solo padrón (no inferir house del auth).
            $catalogOnly = true;
        } elseif (isStaffRole($auth)) {
            if (!$staffCanManage) {
                Response::error('Sin permiso para registrar visitas externas', 403);
                return;
            }
            $houseId = $explicitHouseId;
            if ($houseId <= 0) {
                Response::error('house_id requerido', 400);
                return;
            }
        } else {
            $houseId = $explicitHouseId;
            if ($houseId <= 0) {
                $houseId = (int) ($auth['house_id'] ?? 0);
            }
            if ($houseId <= 0) {
                $houseId = infer_user_primary_house_id($this->db, $uid);
            }
            if ($houseId <= 0) {
                Response::error('house_id requerido', 400);
                return;
            }
            if (!canAccessHouse($this->db, $auth, $houseId)) {
                Response::error('Sin permiso para registrar visitas en esta casa', 403);
                return;
            }
        }

        if (!$catalogOnly) {
            try {
                $durationMinutes = validate_temp_visit_duration_minutes($data['duration_minutes'] ?? 120);
            } catch (\InvalidArgumentException $e) {
                Response::error($e->getMessage(), 400);
                return;
            }
        }

        $plateNorm = '';
        if ($plateRaw !== '') {
            $plateNorm = normalize_license_plate($plateRaw);
            if (!validate_license_plate($plateNorm)) {
                Response::error('Ingrese una placa peruana de 6 letras o números. Puede usar espacios o guion.', 422);
                return;
            }
        }
        $docType = normalize_identity_document_type($data['temp_visit_doc_type'] ?? '');
        $docNorm = '';
        if ($doc !== '') {
            try {
                $identity = require_valid_identity_document($docType, $doc);
                $docType = $identity['type'];
                $docNorm = $identity['value'];
            } catch (\InvalidArgumentException $e) {
                Response::error($e->getMessage(), 422);
                return;
            }
        }
        if ($plateNorm === '' && $docNorm === '') {
            Response::error('Indique placa o documento del conductor', 400);
            return;
        }

        $allowed = ['temp_visit_name', 'temp_visit_company', 'temp_visit_doc', 'temp_visit_doc_type', 'temp_visit_plate', 'temp_visit_cel', 'temp_visit_type', 'status_validated', 'status_reason', 'status_system', 'photo_url'];
        $incoming = [];
        foreach ($allowed as $field) {
            if (isset($data[$field])) {
                $incoming[$field] = $data[$field];
            }
        }
        if ($plateNorm !== '') {
            $incoming['temp_visit_plate'] = $plateNorm;
        } else {
            $incoming['temp_visit_plate'] = null;
        }
        if ($docNorm !== '') {
            $incoming['temp_visit_doc'] = $docNorm;
            $incoming['temp_visit_doc_type'] = $docType;
        } else {
            $incoming['temp_visit_doc'] = null;
            $incoming['temp_visit_doc_type'] = null;
        }
        if (empty($incoming['temp_visit_type'])) {
            $incoming['temp_visit_type'] = 'DELIVERY';
        }
        if (empty($incoming['status_system'])) {
            $incoming['status_system'] = 'ACTIVO';
        }
        if (empty($incoming['status_validated'])) {
            $incoming['status_validated'] = 'PERMITIDO';
        }

        $this->db->beginTransaction();
        try {
            $existing = find_temp_visit_profile(
                $this->db,
                $plateNorm !== '' ? $plateNorm : null,
                $docNorm !== '' ? $docNorm : null
                , $docType ?: null
            );

            if ($existing) {
                $tempVisitId = (int) $existing['temp_visit_id'];
                $merge = merge_temp_visit_profile_fields($existing, $incoming);
                if (!empty($merge)) {
                    $merge['updated_by_user_id'] = $uid;
                    $sets = [];
                    $vals = [];
                    foreach ($merge as $k => $v) {
                        $sets[] = "$k = ?";
                        $vals[] = $v;
                    }
                    $vals[] = $tempVisitId;
                    $stmtUp = $this->db->prepare(
                        'UPDATE temporary_visits SET ' . implode(', ', $sets) . ' WHERE temp_visit_id = ?'
                    );
                    $stmtUp->execute($vals);
                }
            } else {
                $incoming['registered_by_user_id'] = $uid;
                $incoming['created_by_user_id'] = $uid;
                $tempVisitId = (int) $this->create($incoming);
            }

            $visit = $this->findById($tempVisitId, 'temp_visit_id');
            $payload = is_object($visit) ? (array) $visit : (array) $visit;

            if ($catalogOnly) {
                $this->db->commit();
                $payload['assignments'] = [];
                Response::created($payload, 'Perfil de visita externa guardado en el padrón');
                return;
            }

            $validFrom = date('Y-m-d H:i:s');
            $validUntil = date('Y-m-d H:i:s', time() + ((int) $durationMinutes * 60));

            $stmtIns = $this->db->prepare(
                "INSERT INTO temporary_visit_assignments
                 (temp_visit_id, house_id, registered_by_user_id, valid_from, valid_until, status)
                 VALUES (?, ?, ?, ?, ?, 'ACTIVA')"
            );
            $stmtIns->execute([$tempVisitId, $houseId, $uid, $validFrom, $validUntil]);
            $assignmentId = (int) $this->db->lastInsertId();

            $this->db->commit();

            $payload['assignment_id'] = $assignmentId;
            $payload['house_id'] = $houseId;
            $payload['valid_from'] = $validFrom;
            $payload['valid_until'] = $validUntil;
            $payload['duration_minutes'] = (int) $durationMinutes;
            $payload['assignment_status'] = 'ACTIVA';

            Response::created($payload, 'Visita externa registrada correctamente');
        } catch (\Throwable $e) {
            $this->db->rollBack();
            Response::error('Error al registrar visita externa: ' . $e->getMessage(), 500);
        }
    }

    public function updateExternalVehicle($params = []) {
        $auth = requireAuth();
        $id = $params['id'] ?? null;

        if (!$id) {
            Response::error('ID requerido', 400);
            return;
        }

        $visit = $this->findById($id, 'temp_visit_id');
        if (!$visit) {
            Response::notFound('Visita externa no encontrada');
            return;
        }

        $canManageStaff = canManageModule($this->db, $auth, 'external_visits');
        if (!$canManageStaff) {
            if (isStaffRole($auth)) {
                Response::error('Sin permiso para gestionar visitas externas', 403);
                return;
            }
            $tempVisitId = (int) ($visit->temp_visit_id ?? 0);
            if ($tempVisitId <= 0 || !$this->neighborHasAssignmentOnProfile($auth, $tempVisitId)) {
                Response::error('Sin permiso para editar este registro', 403);
                return;
            }
        }

        $data = $this->getInput();
        $allowed = ['temp_visit_name', 'temp_visit_company', 'temp_visit_doc', 'temp_visit_doc_type', 'temp_visit_plate', 'temp_visit_cel', 'temp_visit_type', 'status_validated', 'status_reason', 'status_system', 'photo_url'];

        if ($canManageStaff) {
            $allowed[] = 'operator_notes';
        }

        $filtered = [];
        foreach ($allowed as $field) {
            if (isset($data[$field])) {
                $filtered[$field] = $data[$field];
            }
        }
        if (array_key_exists('temp_visit_plate', $filtered)) {
            $rawPlate = trim((string) $filtered['temp_visit_plate']);
            if ($rawPlate === '') {
                $filtered['temp_visit_plate'] = null;
            } else {
                $pn = normalize_license_plate($rawPlate);
                if (!validate_license_plate($pn)) {
                    Response::error('Ingrese una placa peruana de 6 letras o números. Puede usar espacios o guion.', 422);
                    return;
                }
                $filtered['temp_visit_plate'] = $pn;
            }
        }
        if (array_key_exists('temp_visit_doc', $filtered)) {
            $rawDoc = trim((string) $filtered['temp_visit_doc']);
            if ($rawDoc === '') {
                $filtered['temp_visit_doc'] = null;
                $filtered['temp_visit_doc_type'] = null;
            } else {
                try {
                    $identity = require_valid_identity_document(
                        $filtered['temp_visit_doc_type'] ?? $visit->temp_visit_doc_type ?? '',
                        $rawDoc
                    );
                    $filtered['temp_visit_doc_type'] = $identity['type'];
                    $filtered['temp_visit_doc'] = $identity['value'];
                } catch (\InvalidArgumentException $e) {
                    Response::error($e->getMessage(), 422);
                    return;
                }
            }
        }
        if (array_key_exists('temp_visit_name', $filtered) && trim((string) $filtered['temp_visit_name']) === '') {
            Response::error('Campo requerido faltante: temp_visit_name', 400);
            return;
        }

        $finalPlate = array_key_exists('temp_visit_plate', $filtered)
            ? trim((string) ($filtered['temp_visit_plate'] ?? ''))
            : trim((string) ($visit->temp_visit_plate ?? ''));
        $finalDoc = array_key_exists('temp_visit_doc', $filtered)
            ? trim((string) ($filtered['temp_visit_doc'] ?? ''))
            : trim((string) ($visit->temp_visit_doc ?? ''));
        if ($finalPlate === '' && $finalDoc === '') {
            Response::error('Indique placa o documento del conductor', 400);
            return;
        }

        if (empty($filtered)) {
            Response::error('No hay datos para actualizar', 400);
            return;
        }

        $uid = $this->getAuthUserId($auth);
        if ($uid > 0) {
            $filtered['updated_by_user_id'] = $uid;
        }

        parent::update($id, $filtered, 'temp_visit_id');
        $visit = $this->findById($id, 'temp_visit_id');

        Response::success($visit, 'Visita externa actualizada correctamente');
    }

    public function destroy($params = []) {
        $auth = requireAuth();
        $id = $params['id'] ?? null;
        $assignmentId = (int) ($_GET['assignment_id'] ?? 0);

        if (!$id) {
            Response::error('ID requerido', 400);
            return;
        }

        $visit = $this->findById($id, 'temp_visit_id');
        if (!$visit) {
            Response::notFound('Visita externa no encontrada');
            return;
        }

        if (canManageModule($this->db, $auth, 'external_visits')) {
            $this->delete($id, 'temp_visit_id');
            Response::success(null, 'Visita externa eliminada del catálogo');
            return;
        }

        if ($assignmentId <= 0) {
            Response::error('assignment_id requerido para cancelar', 400);
            return;
        }

        $stmt = $this->db->prepare(
            'SELECT * FROM temporary_visit_assignments WHERE assignment_id = ? AND temp_visit_id = ? LIMIT 1'
        );
        $stmt->execute([$assignmentId, $id]);
        $assignment = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (!$assignment) {
            Response::notFound('Asignación no encontrada');
            return;
        }
        if (!canAccessHouse($this->db, $auth, (int) $assignment['house_id'])) {
            Response::error('Sin permiso para cancelar esta asignación', 403);
            return;
        }

        $stmtUp = $this->db->prepare(
            "UPDATE temporary_visit_assignments SET status = 'CANCELADA', updated_at = NOW() WHERE assignment_id = ?"
        );
        $stmtUp->execute([$assignmentId]);

        Response::success(null, 'Asignación de visita externa cancelada');
    }
}
