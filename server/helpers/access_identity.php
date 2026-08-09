<?php

require_once __DIR__ . '/../token.php';

const ACCESS_IDENTITY_CLAIM_TYPE = 'vc_access_identity';
const ACCESS_IDENTITY_CLAIM_TTL = 300;
const RENIEC_CACHE_DAYS = 90;

function access_identity_full_name(array $row): ?string
{
    $parts = [
        trim((string) ($row['first_name'] ?? $row['nombres'] ?? '')),
        trim((string) ($row['paternal_surname'] ?? $row['apellido_paterno'] ?? '')),
        trim((string) ($row['maternal_surname'] ?? $row['apellido_materno'] ?? '')),
    ];
    $name = trim(implode(' ', array_filter($parts, static fn(string $part): bool => $part !== '')));
    return $name !== '' ? $name : null;
}

function access_identity_cached_reniec(\PDO $pdo, string $document): ?array
{
    $stmt = $pdo->prepare(
        "SELECT display_name_snapshot, document_snapshot, identity_resolved_at
         FROM (
             SELECT display_name_snapshot, document_snapshot, identity_resolved_at
             FROM access_logs
             WHERE document_snapshot = ? AND identity_source = 'RENIEC'
               AND display_name_snapshot IS NOT NULL
             UNION ALL
             SELECT display_name_snapshot, document_snapshot, identity_resolved_at
             FROM temporary_access_logs
             WHERE document_snapshot = ? AND identity_source = 'RENIEC'
               AND display_name_snapshot IS NOT NULL
         ) cached
         WHERE identity_resolved_at >= DATE_SUB(NOW(), INTERVAL " . RENIEC_CACHE_DAYS . " DAY)
         ORDER BY identity_resolved_at DESC
         LIMIT 1"
    );
    $stmt->execute([$document, $document]);
    $row = $stmt->fetch(\PDO::FETCH_ASSOC);
    return $row ?: null;
}

function access_identity_claim(
    string $document,
    string $displayName,
    string $source,
    ?string $resolvedAt = null
): string {
    return generateToken([
        'typ' => ACCESS_IDENTITY_CLAIM_TYPE,
        'doc' => $document,
        'name' => $displayName,
        'source' => strtoupper($source),
        'resolved_at' => $resolvedAt ?: date('Y-m-d H:i:s'),
    ], ACCESS_IDENTITY_CLAIM_TTL);
}

function access_identity_verify_claim(?string $token, string $document): ?array
{
    if ($token === null || trim($token) === '') {
        return null;
    }
    $payload = verifyToken(trim($token));
    if (
        !is_array($payload)
        || ($payload['typ'] ?? '') !== ACCESS_IDENTITY_CLAIM_TYPE
        || !hash_equals($document, trim((string) ($payload['doc'] ?? '')))
    ) {
        return null;
    }
    $name = trim((string) ($payload['name'] ?? ''));
    $source = strtoupper(trim((string) ($payload['source'] ?? '')));
    if ($name === '' || !in_array($source, ['RENIEC', 'LOCAL'], true)) {
        return null;
    }
    return [
        'display_name_snapshot' => $name,
        'document_snapshot' => $document,
        'identity_source' => $source,
        'identity_resolved_at' => trim((string) ($payload['resolved_at'] ?? '')) ?: date('Y-m-d H:i:s'),
    ];
}

