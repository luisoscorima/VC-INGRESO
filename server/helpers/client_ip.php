<?php
/**
 * IP del cliente real detrás de reverse proxy (NPM, nginx, Cloudflare, etc.).
 */

/**
 * @return string|null IP válida (v4/v6), máx. 45 caracteres
 */
function getClientIpAddress(): ?string
{
    $candidates = [];

    $headerValues = [
        $_SERVER['HTTP_CF_CONNECTING_IP'] ?? null,
        $_SERVER['HTTP_TRUE_CLIENT_IP'] ?? null,
        $_SERVER['HTTP_X_REAL_IP'] ?? null,
    ];

    foreach ($headerValues as $value) {
        if (!is_string($value) || trim($value) === '') {
            continue;
        }
        $candidates[] = trim($value);
    }

    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR']) && is_string($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        foreach (explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']) as $part) {
            $part = trim($part);
            if ($part !== '') {
                $candidates[] = $part;
            }
        }
    }

    foreach ($candidates as $ip) {
        if (isValidIpAddress($ip) && !isLoopbackIp($ip)) {
            return truncateIpAddress($ip);
        }
    }

    $remote = $_SERVER['REMOTE_ADDR'] ?? null;
    if (is_string($remote) && $remote !== '' && isValidIpAddress($remote) && !isLoopbackIp($remote)) {
        return truncateIpAddress($remote);
    }

    return null;
}

function isValidIpAddress(string $ip): bool
{
    return filter_var($ip, FILTER_VALIDATE_IP) !== false;
}

function isLoopbackIp(string $ip): bool
{
    return $ip === '127.0.0.1' || $ip === '::1';
}

function truncateIpAddress(string $ip): string
{
    return strlen($ip) > 45 ? substr($ip, 0, 45) : $ip;
}
