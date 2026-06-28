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
        Response::success([
            'users_count' => $usersCount,
            'houses_total' => $housesTotal,
            'houses_registered' => $housesRegistered,
            'vehicles_count' => $vehiclesCount,
            'pets_count' => $petsCount,
        ], 'Resumen dashboard');
    }

    /**
     * GET /api/v1/catalog/areas - Lista de áreas (access_points)
     */
    public static function areas(): void
    {
        requireAuth();
        $pdo = getDbConnection();
        $stmt = $pdo->query(
            'SELECT id, name, type, location, is_active, controla_aforo, permite_reserva, max_capacity, current_capacity '
            . 'FROM access_points ORDER BY name'
        );
        $rows = $stmt->fetchAll(\PDO::FETCH_OBJ);
        Response::json($rows);
    }

    private static function allowedAccessPointTypes(): array
    {
        return ['ENTRADA', 'AREA_COMUN', 'AREA_LIMITADA'];
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

    /**
     * POST /api/v1/catalog/access-points — Crear punto de acceso (solo ADMIN).
     * Body JSON: name (req), type?, location?, is_active?, controla_aforo?, permite_reserva?, max_capacity?, current_capacity?
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
                'INSERT INTO access_points (name, type, location, is_active, controla_aforo, permite_reserva, max_capacity, current_capacity) '
                . 'VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            );
            $stmt->execute([
                $name,
                $type,
                $location,
                $is_active,
                $controla_aforo,
                $permite_reserva,
                $max_capacity,
                $current_capacity,
            ]);
            $id = (int) $pdo->lastInsertId();
            $rowStmt = $pdo->prepare(
                'SELECT id, name, type, location, is_active, controla_aforo, permite_reserva, max_capacity, current_capacity '
                . 'FROM access_points WHERE id = ?'
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

        $updatableKeys = ['name', 'type', 'location', 'is_active', 'controla_aforo', 'permite_reserva', 'max_capacity', 'current_capacity'];
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

        $sql = 'UPDATE access_points SET name = ?, type = ?, location = ?, is_active = ?, controla_aforo = ?, permite_reserva = ?, max_capacity = ?, current_capacity = ? WHERE id = ?';
        $values = [
            $merged['name'],
            $merged['type'],
            $merged['location'],
            (int) $merged['is_active'],
            (int) $merged['controla_aforo'],
            (int) $merged['permite_reserva'],
            $merged['max_capacity'],
            $merged['current_capacity'],
            $apid,
        ];
        try {
            $pdo->prepare($sql)->execute($values);
            $rowStmt = $pdo->prepare(
                'SELECT id, name, type, location, is_active, controla_aforo, permite_reserva, max_capacity, current_capacity '
                . 'FROM access_points WHERE id = ?'
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
