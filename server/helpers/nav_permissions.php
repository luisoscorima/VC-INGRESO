<?php
/**
 * Permisos configurables de módulos de navegación / gestión.
 * Tablas: nav_modules, role_nav_permissions.
 */

require_once __DIR__ . '/role_policy.php';

/** @return list<string> */
function npModuleKeys(): array
{
    return [
        'users',
        'houses',
        'vehicles',
        'pets',
        'announcements',
        'surveys',
        'access_points',
    ];
}

/** @return list<string> */
function npRoleKeys(): array
{
    return ['ADMINISTRADOR', 'OPERARIO', 'USUARIO'];
}

function npTablesExist(\PDO $pdo): bool
{
    try {
        $stmt = $pdo->query("SHOW TABLES LIKE 'nav_modules'");
        if (!$stmt || !$stmt->fetch()) {
            return false;
        }
        $stmt = $pdo->query("SHOW TABLES LIKE 'role_nav_permissions'");
        return (bool) ($stmt && $stmt->fetch());
    } catch (\Throwable $e) {
        return false;
    }
}

function npEnsureSchema(\PDO $pdo): void
{
    if (npTablesExist($pdo)) {
        $stmt = $pdo->query('SELECT COUNT(*) FROM nav_modules');
        if ($stmt && (int) $stmt->fetchColumn() > 0) {
            return;
        }
    }

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS nav_modules (
            module_key VARCHAR(50) NOT NULL,
            label VARCHAR(100) NOT NULL,
            route VARCHAR(100) NOT NULL,
            section VARCHAR(50) NOT NULL DEFAULT \'gestion\',
            sort_order INT NOT NULL DEFAULT 0,
            is_enabled TINYINT(1) NOT NULL DEFAULT 1,
            PRIMARY KEY (module_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS role_nav_permissions (
            role_system VARCHAR(50) NOT NULL,
            module_key VARCHAR(50) NOT NULL,
            can_view TINYINT(1) NOT NULL DEFAULT 0,
            can_manage TINYINT(1) NOT NULL DEFAULT 0,
            PRIMARY KEY (role_system, module_key),
            KEY idx_rnp_module (module_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    $modules = [
        ['users', 'Usuarios', '/users', 'gestion', 10],
        ['houses', 'Viviendas', '/houses', 'gestion', 20],
        ['vehicles', 'Vehículos', '/vehicles', 'gestion', 30],
        ['pets', 'Mascotas', '/pets', 'gestion', 40],
        ['announcements', 'Comunicados', '/announcements', 'gestion', 50],
        ['surveys', 'Encuestas', '/surveys', 'gestion', 60],
        ['access_points', 'Puntos de acceso', '/access-points', 'admin', 70],
    ];
    $insMod = $pdo->prepare(
        'INSERT INTO nav_modules (module_key, label, route, section, sort_order, is_enabled)
         VALUES (?, ?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE label = VALUES(label), route = VALUES(route), section = VALUES(section), sort_order = VALUES(sort_order)'
    );
    foreach ($modules as $m) {
        $insMod->execute($m);
    }

    $perms = [
        ['ADMINISTRADOR', 'users', 1, 1],
        ['ADMINISTRADOR', 'houses', 1, 1],
        ['ADMINISTRADOR', 'vehicles', 1, 1],
        ['ADMINISTRADOR', 'pets', 1, 1],
        ['ADMINISTRADOR', 'announcements', 1, 1],
        ['ADMINISTRADOR', 'surveys', 1, 1],
        ['ADMINISTRADOR', 'access_points', 1, 1],
        ['OPERARIO', 'users', 1, 0],
        ['OPERARIO', 'houses', 1, 0],
        ['OPERARIO', 'vehicles', 1, 0],
        ['OPERARIO', 'pets', 1, 0],
    ];
    $insPerm = $pdo->prepare(
        'INSERT INTO role_nav_permissions (role_system, module_key, can_view, can_manage)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE can_view = VALUES(can_view), can_manage = VALUES(can_manage)'
    );
    foreach ($perms as $p) {
        $insPerm->execute($p);
    }
}

/**
 * Permisos por defecto (mismo comportamiento histórico) si no hay tablas.
 *
 * @return array<string, array{view: bool, manage: bool}>
 */
function npDefaultResolvedForRole(string $roleSystem): array
{
    $role = strtoupper(trim($roleSystem));
    $out = [];
    foreach (npModuleKeys() as $key) {
        $out[$key] = ['view' => false, 'manage' => false];
    }
    if ($role === 'ADMINISTRADOR') {
        foreach (npModuleKeys() as $key) {
            $out[$key] = ['view' => true, 'manage' => true];
        }
    } elseif ($role === 'OPERARIO') {
        foreach (['users', 'houses', 'vehicles', 'pets'] as $key) {
            $out[$key] = ['view' => true, 'manage' => false];
        }
    }

    return $out;
}

/**
 * @return array<string, array{view: bool, manage: bool}>
 */
function getResolvedNavPermissions(\PDO $pdo, array $auth): array
{
    $role = strtoupper(trim((string) ($auth['role_system'] ?? '')));
    if ($role === '' || !isValidRolePersonPair($role, rpPersonTypeFromAuth($pdo, $auth))) {
        $empty = [];
        foreach (npModuleKeys() as $key) {
            $empty[$key] = ['view' => false, 'manage' => false];
        }

        return $empty;
    }

    if (!npTablesExist($pdo)) {
        return npDefaultResolvedForRole($role);
    }

    npEnsureSchema($pdo);

    $sql = 'SELECT m.module_key, m.is_enabled, COALESCE(r.can_view, 0) AS can_view, COALESCE(r.can_manage, 0) AS can_manage
            FROM nav_modules m
            LEFT JOIN role_nav_permissions r ON r.module_key = m.module_key AND r.role_system = ?
            ORDER BY m.sort_order ASC, m.module_key ASC';
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$role]);
    $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC) ?: [];

    $out = [];
    foreach (npModuleKeys() as $key) {
        $out[$key] = ['view' => false, 'manage' => false];
    }
    foreach ($rows as $row) {
        $key = (string) ($row['module_key'] ?? '');
        if ($key === '' || !isset($out[$key])) {
            continue;
        }
        $enabled = (int) ($row['is_enabled'] ?? 0) === 1;
        $canView = $enabled && (int) ($row['can_view'] ?? 0) === 1;
        $canManage = $canView && (int) ($row['can_manage'] ?? 0) === 1;
        $out[$key] = ['view' => $canView, 'manage' => $canManage];
    }

    return $out;
}

function canViewModule(\PDO $pdo, array $auth, string $moduleKey): bool
{
    $key = strtolower(trim($moduleKey));
    if (!in_array($key, npModuleKeys(), true)) {
        return false;
    }
    $perms = getResolvedNavPermissions($pdo, $auth);

    return !empty($perms[$key]['view']);
}

function canManageModule(\PDO $pdo, array $auth, string $moduleKey): bool
{
    $key = strtolower(trim($moduleKey));
    if (!in_array($key, npModuleKeys(), true)) {
        return false;
    }
    $perms = getResolvedNavPermissions($pdo, $auth);

    return !empty($perms[$key]['manage']);
}

function npRequireViewModule(\PDO $pdo, array $auth, string $moduleKey): void
{
    if (!canViewModule($pdo, $auth, $moduleKey)) {
        require_once __DIR__ . '/../utils/Response.php';
        \Utils\Response::error('Sin permiso para acceder a este módulo', 403);
        exit;
    }
}

function npRequireManageModule(\PDO $pdo, array $auth, string $moduleKey): void
{
    if (!canManageModule($pdo, $auth, $moduleKey)) {
        require_once __DIR__ . '/../utils/Response.php';
        \Utils\Response::error('Sin permiso para gestionar este módulo', 403);
        exit;
    }
}

/**
 * Matriz completa para UI de administración.
 *
 * @return array{modules: list<array<string, mixed>>, roles: list<string>, permissions: array<string, array<string, array{can_view: int, can_manage: int}>>}
 */
function getAdminNavMatrix(\PDO $pdo): array
{
    npEnsureSchema($pdo);

    $mods = $pdo->query('SELECT module_key, label, route, section, sort_order, is_enabled FROM nav_modules ORDER BY sort_order ASC, module_key ASC')
        ->fetchAll(\PDO::FETCH_ASSOC) ?: [];

    $stmt = $pdo->query('SELECT role_system, module_key, can_view, can_manage FROM role_nav_permissions');
    $rows = $stmt ? ($stmt->fetchAll(\PDO::FETCH_ASSOC) ?: []) : [];

    $permissions = [];
    foreach (npRoleKeys() as $role) {
        $permissions[$role] = [];
        foreach (npModuleKeys() as $key) {
            $permissions[$role][$key] = ['can_view' => 0, 'can_manage' => 0];
        }
    }
    foreach ($rows as $row) {
        $role = strtoupper(trim((string) ($row['role_system'] ?? '')));
        $key = (string) ($row['module_key'] ?? '');
        if (!isset($permissions[$role][$key])) {
            continue;
        }
        $permissions[$role][$key] = [
            'can_view' => (int) ($row['can_view'] ?? 0) ? 1 : 0,
            'can_manage' => (int) ($row['can_manage'] ?? 0) ? 1 : 0,
        ];
    }

    return [
        'modules' => $mods,
        'roles' => npRoleKeys(),
        'permissions' => $permissions,
    ];
}

/**
 * @param array{modules?: list<array<string, mixed>>, permissions?: array<string, array<string, array{can_view?: int, can_manage?: int}>>} $data
 */
function saveAdminNavMatrix(\PDO $pdo, array $data): void
{
    npEnsureSchema($pdo);

    if (!empty($data['modules']) && is_array($data['modules'])) {
        $upd = $pdo->prepare('UPDATE nav_modules SET is_enabled = ? WHERE module_key = ?');
        foreach ($data['modules'] as $mod) {
            if (!is_array($mod)) {
                continue;
            }
            $key = strtolower(trim((string) ($mod['module_key'] ?? '')));
            if (!in_array($key, npModuleKeys(), true)) {
                continue;
            }
            $upd->execute([(int) (!empty($mod['is_enabled']) ? 1 : 0), $key]);
        }
    }

    if (empty($data['permissions']) || !is_array($data['permissions'])) {
        return;
    }

    $upsert = $pdo->prepare(
        'INSERT INTO role_nav_permissions (role_system, module_key, can_view, can_manage)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE can_view = VALUES(can_view), can_manage = VALUES(can_manage)'
    );

    foreach ($data['permissions'] as $role => $mods) {
        $roleNorm = strtoupper(trim((string) $role));
        if (!in_array($roleNorm, npRoleKeys(), true) || !is_array($mods)) {
            continue;
        }
        foreach ($mods as $moduleKey => $perm) {
            $key = strtolower(trim((string) $moduleKey));
            if (!in_array($key, npModuleKeys(), true) || !is_array($perm)) {
                continue;
            }
            $canView = (int) (!empty($perm['can_view']) ? 1 : 0);
            $canManage = (int) (!empty($perm['can_manage']) ? 1 : 0);
            if ($canManage && !$canView) {
                $canManage = 0;
            }
            $upsert->execute([$roleNorm, $key, $canView, $canManage]);
        }
    }

    // Salvaguarda: el administrador siempre conserva acceso a usuarios.
    $upsert->execute(['ADMINISTRADOR', 'users', 1, 1]);
}
