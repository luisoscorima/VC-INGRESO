<?php
/**
 * ExternalVehicleController — catálogo global temporary_visits + asignaciones por casa.
 */

namespace Controllers;

require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../helpers/house_permissions.php';
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
        if (isStaffRole($auth)) {
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

        if (!isStaffRole($auth)) {
            Response::error('Sin permiso para ver el catálogo global', 403);
            return;
        }

        $visits = $this->getAll([], 'temp_visit_id DESC');
        Response::success($visits, 'Catálogo global de visitas externas');
    }

    public function lookup($params = []) {
        requireAuth();
        $plate = trim((string) ($_GET['plate'] ?? $_GET['temp_visit_plate'] ?? ''));
        $doc = trim((string) ($_GET['doc'] ?? $_GET['temp_visit_doc'] ?? ''));

        if ($plate === '' && $doc === '') {
            Response::error('Indique placa o documento', 400);
            return;
        }

        $profile = find_temp_visit_profile($this->db, $plate !== '' ? $plate : null, $doc !== '' ? $doc : null);
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
        $doc = trim((string) ($data['temp_visit_doc'] ?? ''));
        $plateRaw = trim((string) ($data['temp_visit_plate'] ?? ''));
        if ($doc === '' && $plateRaw === '') {
            Response::error('Indique al menos placa o documento del responsable', 400);
            return;
        }

        $houseId = (int) ($data['house_id'] ?? $auth['house_id'] ?? 0);
        if ($houseId <= 0) {
            $houseId = infer_user_primary_house_id($this->db, $uid);
        }
        if ($houseId <= 0) {
            Response::error('house_id requerido', 400);
            return;
        }
        if (!isStaffRole($auth) && !canAccessHouse($this->db, $auth, $houseId)) {
            Response::error('Sin permiso para registrar visitas en esta casa', 403);
            return;
        }

        try {
            $durationMinutes = validate_temp_visit_duration_minutes($data['duration_minutes'] ?? 120);
        } catch (\InvalidArgumentException $e) {
            Response::error($e->getMessage(), 400);
            return;
        }

        $plateNorm = $plateRaw !== '' ? normalize_license_plate($plateRaw) : '';
        $docNorm = normalize_temp_visit_doc($doc);

        $allowed = ['temp_visit_name', 'temp_visit_doc', 'temp_visit_plate', 'temp_visit_cel', 'temp_visit_type', 'status_validated', 'status_reason', 'status_system', 'photo_url'];
        $incoming = [];
        foreach ($allowed as $field) {
            if (isset($data[$field])) {
                $incoming[$field] = $data[$field];
            }
        }
        if ($plateNorm !== '') {
            $incoming['temp_visit_plate'] = $plateNorm;
        }
        if ($docNorm !== '') {
            $incoming['temp_visit_doc'] = $docNorm;
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

            $validFrom = date('Y-m-d H:i:s');
            $validUntil = date('Y-m-d H:i:s', time() + ($durationMinutes * 60));

            $stmtIns = $this->db->prepare(
                "INSERT INTO temporary_visit_assignments
                 (temp_visit_id, house_id, registered_by_user_id, valid_from, valid_until, status)
                 VALUES (?, ?, ?, ?, ?, 'ACTIVA')"
            );
            $stmtIns->execute([$tempVisitId, $houseId, $uid, $validFrom, $validUntil]);
            $assignmentId = (int) $this->db->lastInsertId();

            $this->db->commit();

            $visit = $this->findById($tempVisitId, 'temp_visit_id');
            $payload = is_object($visit) ? (array) $visit : (array) $visit;
            $payload['assignment_id'] = $assignmentId;
            $payload['house_id'] = $houseId;
            $payload['valid_from'] = $validFrom;
            $payload['valid_until'] = $validUntil;
            $payload['duration_minutes'] = $durationMinutes;
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

        $isStaff = isStaffRole($auth);
        if (!$isStaff && !$this->canAccessTemporaryVisit($auth, $visit)) {
            Response::error('Sin permiso para editar este registro', 403);
            return;
        }

        $data = $this->getInput();
        $allowed = ['temp_visit_name', 'temp_visit_doc', 'temp_visit_plate', 'temp_visit_cel', 'temp_visit_type', 'status_validated', 'status_reason', 'status_system', 'photo_url'];

        if ($isStaff) {
            $allowed[] = 'operator_notes';
        }

        $filtered = [];
        foreach ($allowed as $field) {
            if (isset($data[$field])) {
                $filtered[$field] = $data[$field];
            }
        }
        if (array_key_exists('temp_visit_plate', $filtered)) {
            $pn = normalize_license_plate((string) $filtered['temp_visit_plate']);
            $filtered['temp_visit_plate'] = $pn === '' ? null : $pn;
        }
        if (array_key_exists('temp_visit_doc', $filtered)) {
            $dn = normalize_temp_visit_doc((string) $filtered['temp_visit_doc']);
            $filtered['temp_visit_doc'] = $dn === '' ? null : $dn;
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

        if (isStaffRole($auth)) {
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
