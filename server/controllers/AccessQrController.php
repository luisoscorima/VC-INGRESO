<?php
/**
 * JWT QR de acceso (vecinos) y escaneo/validación (staff).
 */

namespace Controllers;

require_once __DIR__ . '/../helpers/house_permissions.php';
require_once __DIR__ . '/../helpers/license_plate.php';
require_once __DIR__ . '/../helpers/temporary_visit.php';
require_once __DIR__ . '/../token.php';
require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../utils/Response.php';

use Utils\Response;

class AccessQrController
{
    private const QR_TYP = 'vc_access_qr';
    private const TTL_SECONDS = 7776000; // 90 días

    /** @var \PDO */
    private $pdo;

    public function __construct(\PDO $pdo)
    {
        $this->pdo = $pdo;
    }

    public function generate(): void
    {
        $auth = requireAuth();
        if (!canGenerateAccessQr($this->pdo, $auth)) {
            Response::error('No autorizado para generar QR de ingreso (persona vinculada, combinación rol/tipo válida y casa asociada).', 403);
            return;
        }

        $body = json_decode(file_get_contents('php://input'), true) ?? [];
        $kind = strtolower(trim($body['kind'] ?? ''));

        if ($kind !== 'person' && $kind !== 'vehicle') {
            Response::error('kind requerido: person o vehicle', 400);
            return;
        }

        if ($kind === 'person') {
            $personId = isset($body['person_id']) ? (int) $body['person_id'] : 0;
            if ($personId <= 0) {
                Response::error('person_id requerido', 400);
                return;
            }
            if (!canGenerateQrForPerson($this->pdo, $auth, $personId)) {
                Response::error('No autorizado para generar QR de esta persona', 403);
                return;
            }
            $stmt = $this->pdo->prepare(
                'SELECT id, doc_number, house_id FROM persons WHERE id = ? LIMIT 1'
            );
            $stmt->execute([$personId]);
            $row = $stmt->fetch(\PDO::FETCH_ASSOC);
            if (!$row || $row['doc_number'] === null || $row['doc_number'] === '') {
                Response::error('Persona no encontrada', 404);
                return;
            }
            $hid = (int) ($row['house_id'] ?? 0);
            if ($hid <= 0) {
                $stmtH = $this->pdo->prepare(
                    'SELECT house_id FROM house_members WHERE person_id = ? AND COALESCE(is_active, 1) = 1 ORDER BY is_primary DESC, id ASC LIMIT 1'
                );
                $stmtH->execute([$personId]);
                $hm = $stmtH->fetch(\PDO::FETCH_ASSOC);
                if ($hm && !empty($hm['house_id'])) {
                    $hid = (int) $hm['house_id'];
                }
            }
            if ($hid <= 0) {
                Response::error('Persona sin casa asociada para el QR', 422);
                return;
            }
            $payload = [
                'typ' => self::QR_TYP,
                'v' => 1,
                'k' => 'person',
                'doc' => (string) $row['doc_number'],
                'hid' => $hid,
                'pid' => (int) $row['id'],
            ];
            $token = generateToken($payload, self::TTL_SECONDS);
            $exp = time() + self::TTL_SECONDS;
            Response::success([
                'token' => $token,
                'expires_at' => $exp,
                'kind' => 'person',
                'person_id' => (int) $row['id'],
                'doc_number' => (string) $row['doc_number'],
                'house_id' => $hid,
            ], 'Token generado');
            return;
        }

        $vehicleId = isset($body['vehicle_id']) ? (int) $body['vehicle_id'] : 0;
        if ($vehicleId <= 0) {
            Response::error('vehicle_id requerido', 400);
            return;
        }
        if (!canGenerateQrForVehicle($this->pdo, $auth, $vehicleId)) {
            Response::error('No autorizado para generar QR de este vehículo', 403);
            return;
        }
        $stmt = $this->pdo->prepare(
            'SELECT vehicle_id, license_plate, house_id FROM vehicles WHERE vehicle_id = ? LIMIT 1'
        );
        $stmt->execute([$vehicleId]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (!$row) {
            Response::error('Vehículo no encontrado', 404);
            return;
        }
        $plate = normalize_license_plate((string) ($row['license_plate'] ?? ''));
        $hid = (int) $row['house_id'];
        $payload = [
            'typ' => self::QR_TYP,
            'v' => 1,
            'k' => 'vehicle',
            'plate' => $plate,
            'hid' => $hid,
            'vid' => (int) $row['vehicle_id'],
        ];
        $token = generateToken($payload, self::TTL_SECONDS);
        $exp = time() + self::TTL_SECONDS;
        Response::success([
            'token' => $token,
            'expires_at' => $exp,
            'kind' => 'vehicle',
            'vehicle_id' => (int) $row['vehicle_id'],
            'license_plate' => $plate,
            'house_id' => $hid,
        ], 'Token generado');
    }

    public function validate(): void
    {
        $auth = requireAuth();
        if (!isStaffRole($auth)) {
            Response::error('Solo personal autorizado puede validar QR', 403);
            return;
        }
        $body = json_decode(file_get_contents('php://input'), true) ?? [];
        $token = trim((string) ($body['token'] ?? ''));
        if ($token === '') {
            Response::error('token requerido', 400);
            return;
        }
        $payload = verifyToken($token);
        if ($payload === false) {
            Response::error('Token inválido o expirado', 400);
            return;
        }
        $data = $this->resolveQrPayload($payload);
        if ($data === null) {
            Response::error('QR de acceso no válido', 400);
            return;
        }
        $data['source'] = 'qr';
        Response::success($data, 'OK');
    }

    public function scan(): void
    {
        $auth = requireAuth();
        if (!isStaffRole($auth)) {
            Response::error('Solo personal autorizado puede escanear', 403);
            return;
        }
        $body = json_decode(file_get_contents('php://input'), true) ?? [];
        $input = trim((string) ($body['input'] ?? ''));
        if ($input === '') {
            Response::error('input requerido', 400);
            return;
        }

        if ($this->looksLikeJwt($input)) {
            $payload = verifyToken($input);
            if ($payload === false) {
                Response::error('Token inválido o expirado', 400);
                return;
            }
            $data = $this->resolveQrPayload($payload);
            if ($data === null) {
                Response::error('QR de acceso no válido', 400);
                return;
            }
            $data['source'] = 'qr';
            Response::success($data, 'OK');
            return;
        }

        $normalized = preg_replace('/\s+/', '', $input);
        if (preg_match('/^[0-9]{8,15}$/', $normalized)) {
            $stmt = $this->pdo->prepare(
                'SELECT * FROM persons WHERE doc_number = ? LIMIT 1'
            );
            $stmt->execute([$normalized]);
            $person = $stmt->fetch(\PDO::FETCH_ASSOC);
            if ($person) {
                $data = $this->buildUnifiedFromPerson($person, 'manual');
                Response::success($data, 'OK');
                return;
            }

            // Doc. responsable de vehículo externo (temporary_visits)
            $tempByDoc = find_temp_visit_profile($this->pdo, null, $normalized);
            if ($tempByDoc) {
                $data = $this->buildUnifiedFromTemporaryVisit($tempByDoc, 'manual');
                Response::success($data, 'OK');
                return;
            }

            Response::success([
                'source' => 'manual',
                'kind' => 'person',
                'person' => null,
                'vehicle' => null,
                'doc_number' => $normalized,
                'status_validated' => 'DENEGADO',
                'allow_entry' => false,
                'is_birthday' => false,
                'message' => 'Documento no registrado',
            ], 'OK');
            return;
        }

        $plateNorm = normalize_license_plate($input);
        if ($plateNorm === '') {
            Response::success([
                'source' => 'manual',
                'kind' => 'vehicle',
                'person' => null,
                'vehicle' => null,
                'license_plate' => null,
                'status_validated' => 'DENEGADO',
                'allow_entry' => false,
                'is_birthday' => false,
                'message' => 'Placa no registrada',
            ], 'OK');
            return;
        }
        $stmt = $this->pdo->prepare(
            'SELECT * FROM vehicles WHERE license_plate = ? LIMIT 1'
        );
        $stmt->execute([$plateNorm]);
        $vehicle = $stmt->fetch(\PDO::FETCH_ASSOC);
        if ($vehicle) {
            $data = $this->buildUnifiedFromVehicle($vehicle, 'manual');
            Response::success($data, 'OK');
            return;
        }

        // Vehículos externos: catálogo global + asignaciones vigentes
        $tempVisit = find_temp_visit_profile($this->pdo, $plateNorm, null);
        if ($tempVisit) {
            $data = $this->buildUnifiedFromTemporaryVisit($tempVisit, 'manual');
            Response::success($data, 'OK');
            return;
        }

        Response::success([
            'source' => 'manual',
            'kind' => 'vehicle',
            'person' => null,
            'vehicle' => null,
            'license_plate' => $plateNorm,
            'status_validated' => 'DENEGADO',
            'allow_entry' => false,
            'is_birthday' => false,
            'message' => 'Placa no registrada',
        ], 'OK');
    }

    /**
     * Confirmar ingreso de visita externa cuando hay varias casas activas.
     */
    public function scanConfirm(): void
    {
        $auth = requireAuth();
        if (!isStaffRole($auth)) {
            Response::error('Solo personal autorizado puede confirmar ingreso', 403);
            return;
        }

        expire_temp_visit_assignments($this->pdo);

        $body = json_decode(file_get_contents('php://input'), true) ?? [];
        $assignmentId = isset($body['assignment_id']) ? (int) $body['assignment_id'] : 0;
        $tempVisitId = isset($body['temp_visit_id']) ? (int) $body['temp_visit_id'] : 0;

        if ($assignmentId <= 0 || $tempVisitId <= 0) {
            Response::error('assignment_id y temp_visit_id requeridos', 400);
            return;
        }

        $assignment = fetch_temp_visit_assignment_by_id($this->pdo, $assignmentId);
        if (!$assignment || (int) $assignment['temp_visit_id'] !== $tempVisitId) {
            Response::error('Asignación no válida', 404);
            return;
        }
        if (!temp_visit_assignment_is_active($assignment)) {
            Response::error('La autorización de visita externa no está vigente', 422);
            return;
        }

        $stmt = $this->pdo->prepare('SELECT * FROM temporary_visits WHERE temp_visit_id = ? LIMIT 1');
        $stmt->execute([$tempVisitId]);
        $tv = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (!$tv) {
            Response::error('Visita externa no encontrada', 404);
            return;
        }

        $data = $this->buildUnifiedFromTemporaryVisit($tv, 'manual', $assignment);
        Response::success($data, 'OK');
    }

    private function looksLikeJwt(string $s): bool
    {
        $parts = explode('.', $s);

        return count($parts) === 3 && strlen($parts[0]) > 0 && strlen($parts[1]) > 0;
    }

    /**
     * @param array<string,mixed> $payload
     * @return array<string,mixed>|null
     */
    private function resolveQrPayload(array $payload): ?array
    {
        if (($payload['typ'] ?? '') !== self::QR_TYP) {
            return null;
        }
        $k = strtolower((string) ($payload['k'] ?? ''));
        if ($k === 'person') {
            $pid = isset($payload['pid']) ? (int) $payload['pid'] : 0;
            $docTok = trim((string) ($payload['doc'] ?? ''));
            if ($pid <= 0 || $docTok === '') {
                return null;
            }
            $stmt = $this->pdo->prepare('SELECT * FROM persons WHERE id = ? LIMIT 1');
            $stmt->execute([$pid]);
            $person = $stmt->fetch(\PDO::FETCH_ASSOC);
            if (!$person) {
                return null;
            }
            if (trim((string) $person['doc_number']) !== $docTok) {
                return null;
            }
            $hidTok = isset($payload['hid']) ? (int) $payload['hid'] : 0;
            $houseIds = $this->personHouseIds((int) $person['id'], $person);
            if ($hidTok > 0 && !in_array($hidTok, $houseIds, true)) {
                return null;
            }

            $data = $this->buildUnifiedFromPerson($person, 'qr');
            $data['token_house_id'] = $hidTok;

            return $data;
        }
        if ($k === 'vehicle') {
            $vid = isset($payload['vid']) ? (int) $payload['vid'] : 0;
            $plateTok = normalize_license_plate((string) ($payload['plate'] ?? ''));
            if ($vid <= 0 || $plateTok === '') {
                return null;
            }
            $stmt = $this->pdo->prepare('SELECT * FROM vehicles WHERE vehicle_id = ? LIMIT 1');
            $stmt->execute([$vid]);
            $vehicle = $stmt->fetch(\PDO::FETCH_ASSOC);
            if (!$vehicle) {
                return null;
            }
            if (normalize_license_plate((string) $vehicle['license_plate']) !== $plateTok) {
                return null;
            }
            $hidTok = isset($payload['hid']) ? (int) $payload['hid'] : 0;
            $vhid = (int) ($vehicle['house_id'] ?? 0);
            if ($hidTok > 0 && $vhid > 0 && $hidTok !== $vhid) {
                return null;
            }
            if ($hidTok > 0 && $vhid === 0) {
                return null;
            }

            $data = $this->buildUnifiedFromVehicle($vehicle, 'qr');
            $data['token_house_id'] = $hidTok;

            return $data;
        }

        return null;
    }

    /**
     * @param array<string,mixed> $person
     * @return array<string,mixed>
     */
    private function buildUnifiedFromPerson(array $person, string $source): array
    {
        $status = strtoupper(trim((string) ($person['status_validated'] ?? 'PERMITIDO')));
        if ($status === '') {
            $status = 'PERMITIDO';
        }
        $allow = $status !== 'DENEGADO';
        $bd = $person['birth_date'] ?? null;
        $houseId = $this->resolvePrimaryHouseIdForPerson($person);
        $houseLabel = $houseId !== null ? $this->fetchHouseLabel($houseId) : null;

        return [
            'source' => $source,
            'kind' => 'person',
            'person' => $this->publicPerson($person, $houseId),
            'vehicle' => null,
            'person_id' => (int) $person['id'],
            'doc_number' => (string) $person['doc_number'],
            'vehicle_id' => null,
            'license_plate' => null,
            'house_id' => $houseId,
            'house_label' => $houseLabel,
            'status_validated' => $status,
            'allow_entry' => $allow,
            'is_birthday' => $this->isBirthdayToday($bd),
            'birth_date' => $bd,
        ];
    }

    /**
     * @param array<string,mixed> $vehicle
     * @return array<string,mixed>
     */
    private function buildUnifiedFromVehicle(array $vehicle, string $source): array
    {
        $status = strtoupper(trim((string) ($vehicle['status_validated'] ?? 'PERMITIDO')));
        if ($status === '') {
            $status = 'PERMITIDO';
        }
        $allow = $status !== 'DENEGADO';
        $houseId = (int) ($vehicle['house_id'] ?? 0);
        $houseLabel = $houseId > 0 ? $this->fetchHouseLabel($houseId) : null;

        return [
            'source' => $source,
            'kind' => 'vehicle',
            'person' => null,
            'vehicle' => $this->publicVehicle($vehicle),
            'person_id' => null,
            'doc_number' => null,
            'vehicle_id' => (int) $vehicle['vehicle_id'],
            'license_plate' => normalize_license_plate((string) $vehicle['license_plate']),
            'house_id' => $houseId > 0 ? $houseId : null,
            'house_label' => $houseLabel,
            'status_validated' => $status,
            'allow_entry' => $allow,
            'is_birthday' => false,
            'birth_date' => null,
        ];
    }

    /**
     * Visita temporal / vehículo externo (temporary_visits), mismo shape unificado que vehículo residente.
     *
     * @param array<string,mixed> $tv
     * @return array<string,mixed>
     */
    private function buildUnifiedFromTemporaryVisit(array $tv, string $source, ?array $selectedAssignment = null): array
    {
        expire_temp_visit_assignments($this->pdo);

        $status = strtoupper(trim((string) ($tv['status_validated'] ?? 'PERMITIDO')));
        if ($status === '') {
            $status = 'PERMITIDO';
        }
        $sys = strtoupper(trim((string) ($tv['status_system'] ?? 'ACTIVO')));
        if ($sys !== '' && $sys !== 'ACTIVO') {
            $status = 'DENEGADO';
        }

        $tempVisitId = isset($tv['temp_visit_id']) ? (int) $tv['temp_visit_id'] : 0;
        $activeAssignments = $tempVisitId > 0 ? fetch_active_temp_visit_assignments($this->pdo, $tempVisitId) : [];

        $pendingHouseSelection = false;
        $assignmentId = null;
        $houseId = null;
        $message = null;
        $allow = $status !== 'DENEGADO';

        if ($selectedAssignment !== null) {
            $assignmentId = (int) ($selectedAssignment['assignment_id'] ?? 0);
            $houseId = (int) ($selectedAssignment['house_id'] ?? 0);
        } elseif ($allow) {
            if ($activeAssignments === []) {
                $allow = false;
                $status = 'DENEGADO';
                $message = 'Visita externa sin autorización vigente';
            } elseif (count($activeAssignments) === 1) {
                $assignmentId = (int) $activeAssignments[0]['assignment_id'];
                $houseId = (int) $activeAssignments[0]['house_id'];
            } else {
                $pendingHouseSelection = true;
                $allow = false;
                $message = 'Seleccione la casa destino antes de registrar el ingreso';
            }
        }

        $plate = normalize_license_plate((string) ($tv['temp_visit_plate'] ?? ''));
        $doc = trim((string) ($tv['temp_visit_doc'] ?? ''));

        $vehiclePublic = [
            'vehicle_id' => null,
            'license_plate' => $plate,
            'house_id' => $houseId,
            'brand' => $tv['temp_visit_type'] ?? null,
            'model' => $tv['temp_visit_name'] ?? null,
            'photo_url' => $tv['photo_url'] ?? null,
            'status_validated' => $tv['status_validated'] ?? null,
        ];

        $activeForResponse = array_map(static function (array $row): array {
            return [
                'assignment_id' => (int) $row['assignment_id'],
                'house_id' => (int) $row['house_id'],
                'house_label' => $row['house_label'] ?? '',
                'block_house' => $row['block_house'] ?? null,
                'lot' => $row['lot'] ?? null,
                'apartment' => $row['apartment'] ?? null,
                'valid_from' => $row['valid_from'] ?? null,
                'valid_until' => $row['valid_until'] ?? null,
            ];
        }, $activeAssignments);

        $houseLabel = null;
        if ($houseId !== null && $houseId > 0) {
            foreach ($activeForResponse as $assignmentRow) {
                if ((int) $assignmentRow['house_id'] === $houseId && trim((string) $assignmentRow['house_label']) !== '') {
                    $houseLabel = trim((string) $assignmentRow['house_label']);
                    break;
                }
            }
            if ($houseLabel === null) {
                $houseLabel = $this->fetchHouseLabel($houseId);
            }
        }

        return [
            'source' => $source,
            'kind' => 'vehicle',
            'person' => null,
            'vehicle' => $vehiclePublic,
            'person_id' => null,
            'doc_number' => $doc !== '' ? $doc : null,
            'vehicle_id' => null,
            'temp_visit_id' => $tempVisitId > 0 ? $tempVisitId : null,
            'assignment_id' => $assignmentId,
            'house_id' => $houseId,
            'house_label' => $houseLabel,
            'license_plate' => $plate,
            'status_validated' => $status,
            'allow_entry' => $allow,
            'pending_house_selection' => $pendingHouseSelection,
            'active_assignments' => $activeForResponse,
            'is_birthday' => false,
            'birth_date' => null,
            'message' => $message,
            'operator_notes' => $tv['operator_notes'] ?? null,
        ];
    }

    /**
     * @param array<string,mixed> $p
     * @return array<string,mixed>
     */
    private function publicPerson(array $p, ?int $houseId = null): array
    {
        $resolvedHouseId = $houseId ?? (isset($p['house_id']) ? (int) $p['house_id'] : null);

        return [
            'id' => (int) $p['id'],
            'doc_number' => (string) $p['doc_number'],
            'first_name' => $p['first_name'] ?? null,
            'paternal_surname' => $p['paternal_surname'] ?? null,
            'maternal_surname' => $p['maternal_surname'] ?? null,
            'photo_url' => $p['photo_url'] ?? null,
            'birth_date' => $p['birth_date'] ?? null,
            'status_validated' => $p['status_validated'] ?? null,
            'person_type' => $p['person_type'] ?? null,
            'house_id' => $resolvedHouseId !== null && $resolvedHouseId > 0 ? $resolvedHouseId : null,
        ];
    }

    /**
     * @param array<string,mixed> $v
     * @return array<string,mixed>
     */
    private function publicVehicle(array $v): array
    {
        return [
            'vehicle_id' => (int) $v['vehicle_id'],
            'license_plate' => normalize_license_plate((string) $v['license_plate']),
            'house_id' => isset($v['house_id']) ? (int) $v['house_id'] : null,
            'brand' => $v['brand'] ?? null,
            'model' => $v['model'] ?? null,
            'photo_url' => $v['photo_url'] ?? null,
            'status_validated' => $v['status_validated'] ?? null,
        ];
    }

    /**
     * Casas vinculadas a la persona (persons.house_id + house_members activos).
     *
     * @param array<string,mixed> $personRow
     * @return int[]
     */
    private function personHouseIds(int $personId, array $personRow): array
    {
        $ids = [];
        $h = (int) ($personRow['house_id'] ?? 0);
        if ($h > 0) {
            $ids[] = $h;
        }
        $stmt = $this->pdo->prepare(
            'SELECT DISTINCT house_id FROM house_members WHERE person_id = ? AND COALESCE(is_active, 1) = 1'
        );
        $stmt->execute([$personId]);
        while ($row = $stmt->fetch(\PDO::FETCH_ASSOC)) {
            if (!empty($row['house_id'])) {
                $ids[] = (int) $row['house_id'];
            }
        }

        return array_values(array_unique($ids));
    }

    private function isBirthdayToday($birthDate): bool
    {
        if ($birthDate === null || $birthDate === '') {
            return false;
        }
        $ts = strtotime((string) $birthDate);
        if ($ts === false) {
            return false;
        }
        $m = (int) date('m', $ts);
        $d = (int) date('d', $ts);

        return $m === (int) date('m') && $d === (int) date('d');
    }

    /**
     * Casa principal de la persona (persons.house_id o house_members activo).
     *
     * @param array<string,mixed> $person
     */
    private function resolvePrimaryHouseIdForPerson(array $person): ?int
    {
        $houseId = (int) ($person['house_id'] ?? 0);
        if ($houseId > 0) {
            return $houseId;
        }
        $personId = (int) ($person['id'] ?? 0);
        if ($personId <= 0) {
            return null;
        }
        $stmt = $this->pdo->prepare(
            'SELECT house_id FROM house_members WHERE person_id = ? AND COALESCE(is_active, 1) = 1 ORDER BY is_primary DESC, id ASC LIMIT 1'
        );
        $stmt->execute([$personId]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (!$row || empty($row['house_id'])) {
            return null;
        }

        return (int) $row['house_id'];
    }

    private function fetchHouseLabel(int $houseId): ?string
    {
        if ($houseId <= 0) {
            return null;
        }
        $stmt = $this->pdo->prepare(
            'SELECT block_house, lot, apartment FROM houses WHERE house_id = ? LIMIT 1'
        );
        $stmt->execute([$houseId]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (!$row) {
            return null;
        }

        return $this->formatHouseLabel($row);
    }

    /**
     * @param array<string,mixed> $row
     */
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
}
