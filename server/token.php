<?php
// Minimal JWT (HS256) implementation without external deps
// Uses env JWT_SECRET or defaults to 'change_me'; DO NOT commit real secret.

function base64UrlEncode($data) {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function base64UrlDecode($data) {
    return base64_decode(strtr($data, '-_', '+/'));
}

function getJwtSecret() {
    return getenv('JWT_SECRET') ?: 'change_me';
}

/** TTL del JWT de login (segundos). Por defecto 30 días. */
function getAuthTokenTtlSeconds(): int {
    $raw = getenv('JWT_AUTH_TTL_SECONDS');
    if ($raw !== false && $raw !== '' && ctype_digit(trim($raw))) {
        $ttl = (int) trim($raw);
        return max(3600, $ttl); // mínimo 1 h
    }
    return 2592000; // 30 días
}

function generateToken(array $payload, ?int $ttlSeconds = null) {
    if ($ttlSeconds === null) {
        $ttlSeconds = getAuthTokenTtlSeconds();
    }
    $header = ['alg' => 'HS256', 'typ' => 'JWT'];
    $now = time();
    $payload['iat'] = $now;
    $payload['exp'] = $now + $ttlSeconds;

    $secret = getJwtSecret();

    $segments = [
        base64UrlEncode(json_encode($header)),
        base64UrlEncode(json_encode($payload)),
    ];
    $signingInput = implode('.', $segments);
    $signature = hash_hmac('sha256', $signingInput, $secret, true);
    $segments[] = base64UrlEncode($signature);

    return implode('.', $segments);
}

function verifyToken(string $token) {
    $parts = explode('.', $token);
    if (count($parts) !== 3) return false;

    [$headerB64, $payloadB64, $signatureB64] = $parts;
    $signingInput = $headerB64 . '.' . $payloadB64;
    $secret = getJwtSecret();
    $expected = base64UrlEncode(hash_hmac('sha256', $signingInput, $secret, true));

    if (!hash_equals($expected, $signatureB64)) return false;

    $payload = json_decode(base64UrlDecode($payloadB64), true);
    if (!$payload) return false;

    if (isset($payload['exp']) && time() >= $payload['exp']) return false;

    return $payload;
}
