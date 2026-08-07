<?php
require_once __DIR__ . '/token.php';

/**
 * Autenticación obligatoria. Si $checkCsrf=true también valida encabezado X-CSRF-Token
 * generado como base64_encode(HMAC_SHA256(token, CSRF_SECRET || JWT_SECRET)).
 */
function requireAuth(bool $checkCsrf = false) {
    $headers = getallheaders();
    $authHeader = $headers['Authorization'] ?? $headers['authorization'] ?? '';
    if (stripos($authHeader, 'Bearer ') !== 0) {
        http_response_code(401);
        echo json_encode(['error' => 'Missing token']);
        exit;
    }

    $token = trim(substr($authHeader, 7));
    $payload = verifyToken($token);
    if ($payload === false) {
        http_response_code(401);
        echo json_encode(['error' => 'Invalid or expired token']);
        exit;
    }

    if ($checkCsrf) {
        $csrfHeader = $headers['X-CSRF-Token'] ?? $headers['X-Csrf-Token'] ?? $headers['x-csrf-token'] ?? '';
        if ($csrfHeader === '') {
            http_response_code(403);
            echo json_encode(['error' => 'Missing CSRF token']);
            exit;
        }
        $secret = getenv('CSRF_SECRET') ?: getenv('JWT_SECRET') ?: 'change-me';
        $expected = base64_encode(hash_hmac('sha256', $token, $secret, true));
        if (!hash_equals($expected, $csrfHeader)) {
            http_response_code(403);
            echo json_encode(['error' => 'Invalid CSRF token']);
            exit;
        }
    }

    return $payload; // contains user_id, role_system, etc.
}

/**
 * Auth del worker LPR (cámara fija). Acepta Authorization: Bearer <LPR_SERVICE_TOKEN>
 * o cabecera X-LPR-Token. No es un JWT de usuario.
 *
 * @return array{user_id: null, role_system: string, source: string}
 */
function requireLprServiceAuth(): array
{
    $expected = trim((string) (getenv('LPR_SERVICE_TOKEN') ?: ''));
    if ($expected === '') {
        http_response_code(503);
        echo json_encode(['error' => 'LPR_SERVICE_TOKEN no configurado']);
        exit;
    }

    $headers = function_exists('getallheaders') ? getallheaders() : [];
    if (!is_array($headers)) {
        $headers = [];
    }

    $provided = '';
    $authHeader = $headers['Authorization'] ?? $headers['authorization'] ?? '';
    if (is_string($authHeader) && stripos($authHeader, 'Bearer ') === 0) {
        $provided = trim(substr($authHeader, 7));
    }
    if ($provided === '') {
        $provided = trim((string) (
            $headers['X-LPR-Token']
            ?? $headers['X-Lpr-Token']
            ?? $headers['x-lpr-token']
            ?? ''
        ));
    }

    if ($provided === '' || !hash_equals($expected, $provided)) {
        http_response_code(401);
        echo json_encode(['error' => 'Token LPR inválido']);
        exit;
    }

    return [
        'user_id' => null,
        'role_system' => 'OPERARIO',
        'source' => 'lpr_service',
    ];
}
