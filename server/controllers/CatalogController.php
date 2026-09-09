<?php
/**
 * CatalogController — catálogo operativo (access_points, resumen dashboard).
 */

namespace Controllers;

require_once __DIR__ . '/../db_connection.php';
require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../helpers/house_permissions.php';
require_once __DIR__ . '/../helpers/nav_permissions.php';
require_once __DIR__ . '/../helpers/event_log.php';
require_once __DIR__ . '/../utils/Response.php';

use Utils\Response;

class CatalogController
{
    /**
     * GET /api/v1/catalog/dashboard-summary
     * Conteos globales del condominio (cualquier usuario autenticado: staff y vecinos).
     */
    public static function dashboardSummary(): void
    {
        requireAuth();
        $cacheFile = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'vc_dashboard_summary.json';
        $ttlSeconds = 90;
        if (is_file($cacheFile)) {
            $age = time() - (int) filemtime($cacheFile);
            if ($age >= 0 && $age < $ttlSeconds) {
                $cached = json_decode((string) file_get_contents($cacheFile), true);
                if (is_array($cached)) {
                    Response::success($cached, 'Resumen dashboard');
                    return;
                }
            }
        }

        $pdo = getDbConnection();
        $usersCount = (int) $pdo->query('SELECT COUNT(*) FROM users WHERE COALESCE(is_active, 1) = 1')->fetchColumn();
        $housesTotal = (int) $pdo->query('SELECT COUNT(*) FROM houses')->fetchColumn();
        $stmtAv = $pdo->query("
            SELECT COUNT(*) FROM houses h
            WHERE NOT EXISTS (
                SELECT 1 FROM persons p WHERE p.house_id = h.house_id AND p.person_type = 'PROPIETARIO'
            )
        ");
        $housesAvailable = (int) $stmtAv->fetchColumn();
        $housesRegistered = max(0, $housesTotal - $housesAvailable);
        $vehiclesCount = (int) $pdo->query('SELECT COUNT(*) FROM vehicles')->fetchColumn();
        $petsCount = (int) $pdo->query('SELECT COUNT(*) FROM pets')->fetchColumn();
        $payload = [
            'users_count' => $usersCount,
            'houses_total' => $housesTotal,
            'houses_registered' => $housesRegistered,
            'vehicles_count' => $vehiclesCount,
            'pets_count' => $petsCount,
        ];
        @file_put_contents($cacheFile, json_encode($payload));
        Response::success($payload, 'Resumen dashboard');
    }

    private static function accessPointSelectColumns(): string
    {
        return 'id, name, type, location, is_active, controla_aforo, permite_reserva, permite_registro, '
            . 'modo_reserva, max_reservas_simultaneas, hora_apertura, hora_cierre, max_capacity, current_capacity';
    }

    private static function allowedAccessPointTypes(): array
    {
        return ['ENTRADA', 'AREA_COMUN', 'AREA_LIMITADA'];
    }

    private static function allowedModosReserva(): array
    {
        return ['DIA_COMPLETO', 'FRANJA_HORARIA'];
    }

    /**
     * @param mixed $default false = 0, true = 1
     */
    private static function parseBoolFlag(array $data, string $key, bool $default = false): int
    {
        if (!array_key_exists($key, $data)) {
            return $default ? 1 : 0;
        }
        $v = $data[$key];
        if (is_bool($v)) {
            return $v ? 1 : 0;
        }
        if (is_int($v) || is_float($v)) {
            return ((int) $v) !== 0 ? 1 : 0;
        }
        $s = strtolower(trim((string) $v));

        return in_array($s, ['1', 'true', 'yes', 'on'], true) ? 1 : 0;
    }

    /** @param mixed $v */
    private static function normalizeTimeOrNull($v): ?string
    {
        if ($v === null || $v === '') {
            return null;
        }
        $s = trim((string) $v);
        if (preg_match('/^\d{2}:\d{2}$/', $s)) {
            $s .= ':00';
        }
        if (!preg_match('/^\d{2}:\d{2}:\d{2}$/', $s)) {
            return null;
        }
        $parts = array_map('intval', explode(':', $s));
        if ($parts[0] > 23 || $parts[1] > 59 || $parts[2] > 59) {
            return null;
        }

        return sprintf('%02d:%02d:%02d', $parts[0], $parts[1], $parts[2]);
    }

    /** @return array{modo: string, max_sim: int, apertura: ?string, cierre: ?string, error: ?string} */
    private static function parseReservaScheduleFields(array $data, ?array $existing = null): array
    {
        $modoDefault = $existing['modo_reserva'] ?? 'DIA_COMPLETO';
        $modo = array_key_exists('modo_reserva', $data)
            ? strtoupper(trim((string) $data['modo_reserva']))
            : strtoupper((string) $modoDefault);
        if (!in_array($modo, self::allowedModosReserva(), true)) {
            $modo = 'DIA_COMPLETO';
        }

        $maxDefault = isset($existing['max_reservas_simultaneas']) ? (int) $existing['max_reservas_simultaneas'] : 1;
        if (array_key_exists('max_reservas_simultaneas', $data)) {
            $raw = $data['max_reservas_simultaneas'];
            $maxSim = ($raw === '' || $raw === null) ? 1 : max(0, (int) $raw);
        } else {
            $maxSim = max(0, $maxDefault);
        }

        $apertura = $existing['hora_apertura'] ?? null;
        $cierre = $existing['hora_cierre'] ?? null;
        if (array_key_exists('hora_apertura', $data)) {
            $apertura = self::normalizeTimeOrNull($data['hora_apertura']);
        }
        if (array_key_exists('hora_cierre', $data)) {
            $cierre = self::normalizeTimeOrNull($data['hora_cierre']);
        }

        if ($modo === 'FRANJA_HORARIA') {
            if ($apertura === null) {
                $apertura = '08:00:00';
            }
            if ($cierre === null) {
                $cierre = '22:00:00';
            }
            if ($apertura >= $cierre) {
                return [
                    'modo' => $modo,
                    'max_sim' => $maxSim,
                    'apertura' => $apertura,
                    'cierre' => $cierre,
                    'error' => 'En franja horaria, la hora de apertura debe ser anterior al cierre',
                ];
            }
        } else {
            $apertura = null;
            $cierre = null;
        }

        return [
            'modo' => $modo,
            'max_sim' => $maxSim,
            'apertura' => $apertura,
            'cierre' => $cierre,
            'error' => null,
        ];
    }

    /**
     * GET /api/v1/catalog/areas - Lista de áreas (access_points)
     */
    public static function areas(): void
    {
        requireAuth();
        $pdo = getDbConnection();
        $stmt = $pdo->query(
            'SELECT ' . self::accessPointSelectColumns() . ' FROM access_points ORDER BY name'
        );
        $rows = $stmt->fetchAll(\PDO::FETCH_OBJ);
        Response::json($rows);
    }

    /**
     * POST /api/v1/catalog/access-points — Crear punto de acceso (solo ADMIN).
     */
    public static function accessPointsStore(): void
    {
        $auth = requireAuth();
        if (!canManageModule(getDbConnection(), $auth, 'access_points')) {
            Response::error('Sin permiso para gestionar puntos de acceso', 403);
            return;
        }
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true);
        if (!is_array($data)) {
            Response::error('JSON inválido', 400);
            return;
        }
        $name = trim((string) ($data['name'] ?? ''));
        if ($name === '') {
            Response::error('El nombre es obligatorio', 400);
            return;
        }
        $type = strtoupper(trim((string) ($data['type'] ?? 'ENTRADA')));
        $allowedTypes = self::allowedAccessPointTypes();
        if (!in_array($type, $allowedTypes, true)) {
            $type = 'ENTRADA';
        }
        $location = isset($data['location']) ? trim((string) $data['location']) : '';
        $location = $location === '' ? null : $location;
        $is_active = isset($data['is_active']) ? ((bool) $data['is_active'] ? 1 : 0) : 1;
        $controla_aforo = self::parseBoolFlag($data, 'controla_aforo', false);
        $permite_reserva = self::parseBoolFlag($data, 'permite_reserva', false);
        $permite_registro = self::parseBoolFlag($data, 'permite_registro', false);

        $schedule = self::parseReservaScheduleFields($data, null);
        if ($schedule['error'] !== null) {
            Response::error($schedule['error'], 400);
            return;
        }

        $max_capacity = null;
        $current_capacity = null;
        if ($controla_aforo === 1) {
            if (!isset($data['max_capacity']) || $data['max_capacity'] === '' || $data['max_capacity'] === null) {
                Response::error('Si controla aforo, el aforo máximo es obligatorio y debe ser mayor que cero', 400);
                return;
            }
            $max_capacity = (int) $data['max_capacity'];
            if ($max_capacity <= 0) {
                Response::error('El aforo máximo debe ser mayor que cero', 400);
                return;
            }
            if (isset($data['current_capacity']) && $data['current_capacity'] !== '' && $data['current_capacity'] !== null) {
                $current_capacity = max(0, (int) $data['current_capacity']);
            } else {
                $current_capacity = 0;
            }
            if ($current_capacity > $max_capacity) {
                Response::error('La ocupación actual no puede superar el aforo máximo', 400);
                return;
            }
        }

        $pdo = getDbConnection();
        try {
            $stmt = $pdo->prepare(
                'INSERT INTO access_points (name, type, location, is_active, controla_aforo, permite_reserva, permite_registro, '
                . 'modo_reserva, max_reservas_simultaneas, hora_apertura, hora_cierre, max_capacity, current_capacity) '
                . 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            );
            $stmt->execute([
                $name,
                $type,
                $location,
                $is_active,
                $controla_aforo,
                $permite_reserva,
                $permite_registro,
                $schedule['modo'],
                $schedule['max_sim'],
                $schedule['apertura'],
                $schedule['cierre'],
                $max_capacity,
                $current_capacity,
            ]);
            $id = (int) $pdo->lastInsertId();
            $rowStmt = $pdo->prepare(
                'SELECT ' . self::accessPointSelectColumns() . ' FROM access_points WHERE id = ?'
            );
            $rowStmt->execute([$id]);
            $row = $rowStmt->fetch(\PDO::FETCH_ASSOC);
            recordEventLog($pdo, $auth, 'access_point.create', [
                'summary' => 'Punto de acceso creado: ' . $name,
                'entity_type' => 'access_points',
                'entity_id' => $id,
            ]);
            Response::success($row, 'Punto de acceso creado', 201);
        } catch (\PDOException $e) {
            if ((int) $e->getCode() === 23000 || str_contains($e->getMessage(), 'Duplicate')) {
                Response::error('Ya existe un punto con ese nombre', 409);
                return;
            }
            Response::error('Error al crear: ' . $e->getMessage(), 500);
        }
    }

    /**
     * PUT /api/v1/catalog/access-points/:id — Actualizar (solo ADMIN). Sin eliminación.
     */
    public static function accessPointsUpdate(string $id): void
    {
        $auth = requireAuth();
        if (!canManageModule(getDbConnection(), $auth, 'access_points')) {
            Response::error('Sin permiso para gestionar puntos de acceso', 403);
            return;
        }
        $apid = (int) $id;
        if ($apid <= 0) {
            Response::error('ID inválido', 400);
            return;
        }
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true);
        if (!is_array($data)) {
            Response::error('JSON inválido', 400);
            return;
        }

        $pdo = getDbConnection();
        $check = $pdo->prepare('SELECT * FROM access_points WHERE id = ?');
        $check->execute([$apid]);
        $existing = $check->fetch(\PDO::FETCH_ASSOC);
        if (!$existing) {
            Response::error('Punto de acceso no encontrado', 404);
            return;
        }

        $updatableKeys = [
            'name', 'type', 'location', 'is_active', 'controla_aforo', 'permite_reserva', 'permite_registro',
            'modo_reserva', 'max_reservas_simultaneas', 'hora_apertura', 'hora_cierre',
            'max_capacity', 'current_capacity',
        ];
        $hasAny = false;
        foreach ($updatableKeys as $k) {
            if (array_key_exists($k, $data)) {
                $hasAny = true;
                break;
            }
        }
        if (!$hasAny) {
            Response::error('Sin campos para actualizar', 400);
            return;
        }

        $allowedTypes = self::allowedAccessPointTypes();
        $merged = $existing;

        if (array_key_exists('name', $data)) {
            $n = trim((string) $data['name']);
            if ($n === '') {
                Response::error('El nombre no puede estar vacío', 400);
                return;
            }
            $merged['name'] = $n;
        }
        if (array_key_exists('type', $data)) {
            $type = strtoupper(trim((string) $data['type']));
            $merged['type'] = in_array($type, $allowedTypes, true) ? $type : 'ENTRADA';
        }
        if (array_key_exists('location', $data)) {
            $loc = trim((string) $data['location']);
            $merged['location'] = $loc === '' ? null : $loc;
        }
        if (array_key_exists('is_active', $data)) {
            $merged['is_active'] = (bool) $data['is_active'] ? 1 : 0;
        }
        if (array_key_exists('controla_aforo', $data)) {
            $merged['controla_aforo'] = self::parseBoolFlag($data, 'controla_aforo', false);
        }
        if (array_key_exists('permite_reserva', $data)) {
            $merged['permite_reserva'] = self::parseBoolFlag($data, 'permite_reserva', false);
        }
        if (array_key_exists('permite_registro', $data)) {
            $merged['permite_registro'] = self::parseBoolFlag($data, 'permite_registro', false);
        }
        if (array_key_exists('max_capacity', $data)) {
            $mv = $data['max_capacity'];
            if ($mv === '' || $mv === null) {
                $merged['max_capacity'] = null;
            } else {
                $merged['max_capacity'] = max(0, (int) $mv);
            }
        }
        if (array_key_exists('current_capacity', $data)) {
            $cv = $data['current_capacity'];
            if ($cv === '' || $cv === null) {
                $merged['current_capacity'] = null;
            } else {
                $merged['current_capacity'] = max(0, (int) $cv);
            }
        }

        $schedule = self::parseReservaScheduleFields($data, $merged);
        if ($schedule['error'] !== null) {
            Response::error($schedule['error'], 400);
            return;
        }
        $merged['modo_reserva'] = $schedule['modo'];
        $merged['max_reservas_simultaneas'] = $schedule['max_sim'];
        $merged['hora_apertura'] = $schedule['apertura'];
        $merged['hora_cierre'] = $schedule['cierre'];

        if ((int) $merged['controla_aforo'] === 0) {
            $merged['max_capacity'] = null;
            $merged['current_capacity'] = null;
        } else {
            $maxCap = isset($merged['max_capacity']) ? (int) $merged['max_capacity'] : 0;
            if ($maxCap <= 0) {
                Response::error('Si controla aforo, el aforo máximo es obligatorio y debe ser mayor que cero', 400);
                return;
            }
            $merged['max_capacity'] = $maxCap;
            $cur = $merged['current_capacity'];
            if ($cur === null || $cur === '') {
                $merged['current_capacity'] = 0;
            } else {
                $merged['current_capacity'] = max(0, (int) $cur);
            }
            if ((int) $merged['current_capacity'] > $maxCap) {
                Response::error('La ocupación actual no puede superar el aforo máximo', 400);
                return;
            }
        }

        $sql = 'UPDATE access_points SET name = ?, type = ?, location = ?, is_active = ?, controla_aforo = ?, '
            . 'permite_reserva = ?, permite_registro = ?, modo_reserva = ?, max_reservas_simultaneas = ?, '
            . 'hora_apertura = ?, hora_cierre = ?, max_capacity = ?, current_capacity = ? WHERE id = ?';
        $values = [
            $merged['name'],
            $merged['type'],
            $merged['location'],
            (int) $merged['is_active'],
            (int) $merged['controla_aforo'],
            (int) $merged['permite_reserva'],
            (int) ($merged['permite_registro'] ?? 0),
            $merged['modo_reserva'],
            (int) $merged['max_reservas_simultaneas'],
            $merged['hora_apertura'],
            $merged['hora_cierre'],
            $merged['max_capacity'],
            $merged['current_capacity'],
            $apid,
        ];
        try {
            $pdo->prepare($sql)->execute($values);
            $rowStmt = $pdo->prepare(
                'SELECT ' . self::accessPointSelectColumns() . ' FROM access_points WHERE id = ?'
            );
            $rowStmt->execute([$apid]);
            $row = $rowStmt->fetch(\PDO::FETCH_ASSOC);
            recordEventLog($pdo, $auth, 'access_point.update', [
                'summary' => 'Punto de acceso actualizado: ' . ($row['name'] ?? $apid),
                'entity_type' => 'access_points',
                'entity_id' => $apid,
            ]);
            Response::success($row, 'Punto de acceso actualizado');
        } catch (\PDOException $e) {
            if ((int) $e->getCode() === 23000 || str_contains($e->getMessage(), 'Duplicate')) {
                Response::error('Ya existe un punto con ese nombre', 409);
                return;
            }
            Response::error('Error al actualizar: ' . $e->getMessage(), 500);
        }
    }
}
