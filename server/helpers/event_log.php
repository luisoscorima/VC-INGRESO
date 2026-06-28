<?php
/**
 * Registro persistente de eventos de auditoría (tabla event_logs).
 */

/** Claves sensibles que nunca deben persistirse en details_json. */
const EVENT_LOG_SENSITIVE_KEYS = [
    'password',
    'password_system',
    'current_password',
    'new_password',
    'confirm_password',
    'token',
    'auth_token',
    'secret',
];

/**
 * Sanitiza un array recursivamente eliminando claves sensibles.
 *
 * @param mixed $data
 * @return mixed
 */
function sanitizeEventLogDetails($data)
{
    if (!is_array($data)) {
        return $data;
    }

    $out = [];
    foreach ($data as $key => $value) {
        $keyLower = strtolower((string) $key);
        $blocked = false;
        foreach (EVENT_LOG_SENSITIVE_KEYS as $sensitive) {
            if ($keyLower === $sensitive || str_contains($keyLower, 'password') || str_contains($keyLower, 'token')) {
                $blocked = true;
                break;
            }
        }
        if ($blocked) {
            $out[$key] = '[redacted]';
            continue;
        }
        $out[$key] = is_array($value) ? sanitizeEventLogDetails($value) : $value;
    }

    return $out;
}

/**
 * @return array{user_id?:int,role_system?:string,username_system?:string}|null
 */
function normalizeEventLogAuth(?array $auth): ?array
{
    if ($auth === null || empty($auth)) {
        return null;
    }

    return [
        'user_id' => isset($auth['user_id']) ? (int) $auth['user_id'] : null,
        'role_system' => isset($auth['role_system']) ? (string) $auth['role_system'] : null,
        'username_system' => isset($auth['username_system']) ? (string) $auth['username_system'] : null,
    ];
}

/**
 * Registra un evento en event_logs.
 *
 * @param \PDO $db
 * @param array|null $auth Usuario en sesión (JWT) o null para eventos anónimos (login fallido)
 * @param string $action Código de acción (ej. user.create)
 * @param array{
 *   summary: string,
 *   entity_type?: string|null,
 *   entity_id?: string|int|null,
 *   details?: mixed,
 *   actor_username?: string|null,
 *   actor_role?: string|null,
 *   actor_user_id?: int|null
 * } $opts
 */
function recordEventLog(\PDO $db, ?array $auth, string $action, array $opts): void
{
    try {
        $normalized = normalizeEventLogAuth($auth);
        $actorUserId = $opts['actor_user_id'] ?? ($normalized['user_id'] ?? null);
        $actorRole = $opts['actor_role'] ?? ($normalized['role_system'] ?? null);
        $actorUsername = $opts['actor_username'] ?? ($normalized['username_system'] ?? null);

        $summary = trim((string) ($opts['summary'] ?? ''));
        if ($summary === '') {
            $summary = $action;
        }
        if (strlen($summary) > 500) {
            $summary = substr($summary, 0, 497) . '...';
        }

        $entityType = isset($opts['entity_type']) ? (string) $opts['entity_type'] : null;
        $entityId = isset($opts['entity_id']) ? (string) $opts['entity_id'] : null;

        $details = null;
        if (array_key_exists('details', $opts) && $opts['details'] !== null) {
            $sanitized = sanitizeEventLogDetails($opts['details']);
            $encoded = json_encode($sanitized, JSON_UNESCAPED_UNICODE);
            if ($encoded !== false) {
                $details = $encoded;
            }
        }

        $ip = $_SERVER['REMOTE_ADDR'] ?? null;
        if (is_string($ip) && strlen($ip) > 45) {
            $ip = substr($ip, 0, 45);
        }

        $ua = $_SERVER['HTTP_USER_AGENT'] ?? null;
        if (is_string($ua) && strlen($ua) > 255) {
            $ua = substr($ua, 0, 255);
        }

        $stmt = $db->prepare(
            'INSERT INTO event_logs (
                actor_user_id, actor_role, actor_username,
                action, entity_type, entity_id, summary, details_json,
                ip_address, user_agent
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $actorUserId,
            $actorRole,
            $actorUsername,
            $action,
            $entityType,
            $entityId,
            $summary,
            $details,
            $ip,
            $ua,
        ]);
    } catch (\Throwable $e) {
        error_log('[event_log] Failed to record: ' . $e->getMessage());
    }
}

/**
 * Lista acciones distintas registradas (para filtros UI).
 *
 * @return string[]
 */
function getEventLogActionCatalog(\PDO $db): array
{
    $stmt = $db->query(
        'SELECT DISTINCT action FROM event_logs ORDER BY action ASC LIMIT 200'
    );
    $rows = $stmt ? $stmt->fetchAll(\PDO::FETCH_COLUMN) : [];

    return array_values(array_filter(array_map('strval', $rows)));
}
