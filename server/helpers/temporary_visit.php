<?php
/**
 * Helpers para visitas externas (temporary_visits + temporary_visit_assignments).
 */

require_once __DIR__ . '/license_plate.php';

/** Duraciones permitidas (minutos) elegibles por el vecino. */
const TEMP_VISIT_ALLOWED_DURATIONS = [30, 60, 120, 240];

function normalize_temp_visit_doc(?string $doc): string
{
    if ($doc === null || $doc === '') {
        return '';
    }

    return preg_replace('/\D/', '', trim($doc));
}

function validate_temp_visit_duration_minutes($minutes): int
{
    $m = (int) $minutes;
    if (!in_array($m, TEMP_VISIT_ALLOWED_DURATIONS, true)) {
        throw new \InvalidArgumentException('Duración inválida. Use: 30, 60, 120 o 240 minutos.');
    }

    return $m;
}

/**
 * Busca perfil global por placa O DNI (criterio OR).
 *
 * @return array<string,mixed>|null
 */
function find_temp_visit_profile(\PDO $pdo, ?string $plate, ?string $doc): ?array
{
    $plateNorm = $plate !== null && $plate !== '' ? normalize_license_plate($plate) : '';
    $docNorm = normalize_temp_visit_doc($doc);

    if ($plateNorm === '' && $docNorm === '') {
        return null;
    }

    $clauses = [];
    $params = [];
    if ($plateNorm !== '') {
        $clauses[] = "(temp_visit_plate IS NOT NULL AND temp_visit_plate <> '' AND temp_visit_plate = ?)";
        $params[] = $plateNorm;
    }
    if ($docNorm !== '') {
        $clauses[] = "(temp_visit_doc IS NOT NULL AND temp_visit_doc <> '' AND REPLACE(REPLACE(REPLACE(REPLACE(TRIM(temp_visit_doc), ' ', ''), '-', ''), '.', ''), '/', '') = ?)";
        $params[] = $docNorm;
    }

    $sql = 'SELECT * FROM temporary_visits WHERE (' . implode(' OR ', $clauses) . ') ORDER BY temp_visit_id DESC LIMIT 1';
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $row = $stmt->fetch(\PDO::FETCH_ASSOC);

    return $row ?: null;
}

/**
 * @param array<string,mixed> $existing
 * @param array<string,mixed> $incoming
 * @return array<string,mixed>
 */
function merge_temp_visit_profile_fields(array $existing, array $incoming): array
{
    $mergeFields = ['temp_visit_name', 'temp_visit_doc', 'temp_visit_plate', 'temp_visit_cel', 'temp_visit_type'];
    $out = [];
    foreach ($mergeFields as $field) {
        if (!array_key_exists($field, $incoming)) {
            continue;
        }
        $newVal = trim((string) ($incoming[$field] ?? ''));
        $oldVal = trim((string) ($existing[$field] ?? ''));
        if ($newVal === '') {
            continue;
        }
        if ($oldVal === '') {
            $out[$field] = $incoming[$field];
            continue;
        }
        if ($field === 'temp_visit_plate') {
            $out[$field] = normalize_license_plate($newVal) ?: $oldVal;
        } elseif ($field === 'temp_visit_doc') {
            if ($oldVal !== $newVal && normalize_temp_visit_doc($oldVal) !== normalize_temp_visit_doc($newVal)) {
                continue;
            }
        } else {
            $out[$field] = $incoming[$field];
        }
    }

    return $out;
}

function temp_visit_assignment_is_active(array $row): bool
{
    $status = strtoupper(trim((string) ($row['status'] ?? '')));
    if ($status !== 'ACTIVA') {
        return false;
    }
    $until = $row['valid_until'] ?? null;
    if ($until === null || $until === '') {
        return false;
    }

    return strtotime((string) $until) > time();
}

/**
 * @return array<int,array<string,mixed>>
 */
function fetch_active_temp_visit_assignments(\PDO $pdo, int $tempVisitId): array
{
    $stmt = $pdo->prepare(
        "SELECT tva.*,
                h.block_house, h.lot, h.apartment,
                CONCAT_WS(' ', NULLIF(h.block_house,''), NULLIF(CAST(h.lot AS CHAR),''), NULLIF(h.apartment,'')) AS house_label
         FROM temporary_visit_assignments tva
         INNER JOIN houses h ON h.house_id = tva.house_id
         WHERE tva.temp_visit_id = ?
           AND tva.status = 'ACTIVA'
           AND tva.valid_until > NOW()
         ORDER BY tva.valid_until ASC"
    );
    $stmt->execute([$tempVisitId]);
    $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);

    return is_array($rows) ? $rows : [];
}

/**
 * @return array<string,mixed>|null
 */
function fetch_temp_visit_assignment_by_id(\PDO $pdo, int $assignmentId): ?array
{
    $stmt = $pdo->prepare(
        "SELECT tva.*,
                h.block_house, h.lot, h.apartment,
                CONCAT_WS(' ', NULLIF(h.block_house,''), NULLIF(CAST(h.lot AS CHAR),''), NULLIF(h.apartment,'')) AS house_label
         FROM temporary_visit_assignments tva
         INNER JOIN houses h ON h.house_id = tva.house_id
         WHERE tva.assignment_id = ?
         LIMIT 1"
    );
    $stmt->execute([$assignmentId]);
    $row = $stmt->fetch(\PDO::FETCH_ASSOC);

    return $row ?: null;
}

function expire_temp_visit_assignments(\PDO $pdo): void
{
    $pdo->exec(
        "UPDATE temporary_visit_assignments
         SET status = 'EXPIRADA', updated_at = NOW()
         WHERE status = 'ACTIVA' AND valid_until <= NOW()"
    );
}

/**
 * Minutos autorizados según valid_from / valid_until de la asignación.
 */
function assignment_authorized_duration_minutes(array $assignment): int
{
    $from = strtotime((string) ($assignment['valid_from'] ?? ''));
    $until = strtotime((string) ($assignment['valid_until'] ?? ''));
    if ($from === false || $until === false || $until <= $from) {
        return 120;
    }

    return max(1, (int) round(($until - $from) / 60));
}

/**
 * Resuelve asignación activa para registrar ingreso en portería.
 *
 * @return array<string,mixed>|null
 */
function resolve_temp_visit_assignment_for_entry(
    \PDO $pdo,
    int $tempVisitId,
    int $houseId,
    int $assignmentId
): ?array {
    expire_temp_visit_assignments($pdo);

    if ($assignmentId > 0) {
        $assignment = fetch_temp_visit_assignment_by_id($pdo, $assignmentId);
        if (!$assignment || (int) $assignment['temp_visit_id'] !== $tempVisitId) {
            return null;
        }
        if (!temp_visit_assignment_is_active($assignment)) {
            return null;
        }

        return $assignment;
    }

    $active = fetch_active_temp_visit_assignments($pdo, $tempVisitId);
    if ($active === []) {
        return null;
    }

    if ($houseId > 0) {
        foreach ($active as $row) {
            if ((int) ($row['house_id'] ?? 0) === $houseId) {
                return $row;
            }
        }

        return null;
    }

    if (count($active) === 1) {
        return $active[0];
    }

    return null;
}

/**
 * @return array<string,mixed>|null
 */
function fetch_open_temp_access_log(\PDO $pdo, int $tempVisitId, int $houseId = 0): ?array
{
    $sql = 'SELECT * FROM temporary_access_logs
            WHERE temp_visit_id = ? AND temp_exit_time IS NULL';
    $params = [$tempVisitId];
    if ($houseId > 0) {
        $sql .= ' AND house_id = ?';
        $params[] = $houseId;
    }
    $sql .= ' ORDER BY temp_entry_time DESC LIMIT 1';

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $row = $stmt->fetch(\PDO::FETCH_ASSOC);

    return $row ?: null;
}

/**
 * Inferir house_id principal del usuario.
 */
function infer_user_primary_house_id(\PDO $pdo, int $userId): int
{
    if ($userId <= 0) {
        return 0;
    }
    $stmt = $pdo->prepare('SELECT house_id, person_id FROM users WHERE user_id = ? LIMIT 1');
    $stmt->execute([$userId]);
    $u = $stmt->fetch(\PDO::FETCH_ASSOC);
    if (!$u) {
        return 0;
    }
    $hid = (int) ($u['house_id'] ?? 0);
    if ($hid > 0) {
        return $hid;
    }
    $pid = (int) ($u['person_id'] ?? 0);
    if ($pid <= 0) {
        return 0;
    }
    $stmt2 = $pdo->prepare(
        'SELECT house_id FROM house_members WHERE person_id = ? AND COALESCE(is_active, 1) = 1 ORDER BY is_primary DESC, id ASC LIMIT 1'
    );
    $stmt2->execute([$pid]);
    $hm = $stmt2->fetch(\PDO::FETCH_ASSOC);
    if ($hm && !empty($hm['house_id'])) {
        return (int) $hm['house_id'];
    }
    $stmt3 = $pdo->prepare('SELECT house_id FROM persons WHERE id = ? AND house_id IS NOT NULL LIMIT 1');
    $stmt3->execute([$pid]);
    $p = $stmt3->fetch(\PDO::FETCH_ASSOC);

    return $p && !empty($p['house_id']) ? (int) $p['house_id'] : 0;
}
