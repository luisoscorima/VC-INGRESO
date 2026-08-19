<?php

const IDENTITY_DOCUMENT_TYPES = ['DNI', 'CE'];

function normalize_identity_document_type($type): string
{
    $normalized = strtoupper(trim((string) $type));
    return in_array($normalized, IDENTITY_DOCUMENT_TYPES, true) ? $normalized : '';
}

function normalize_identity_document(string $type, $value): string
{
    $normalized = trim((string) $value);
    return $type === 'CE' ? strtoupper($normalized) : $normalized;
}

function validate_identity_document(string $type, string $value): bool
{
    if ($type === 'DNI') {
        return preg_match('/^[0-9]{8}$/', $value) === 1;
    }
    if ($type === 'CE') {
        return preg_match('/^[A-Z0-9]{9,12}$/', $value) === 1;
    }
    return false;
}

function infer_identity_document_type($value): string
{
    $raw = trim((string) $value);
    if (validate_identity_document('DNI', $raw)) {
        return 'DNI';
    }
    $ce = normalize_identity_document('CE', $raw);
    if (validate_identity_document('CE', $ce)) {
        return 'CE';
    }
    return '';
}

/**
 * @return array{type:string,value:string}
 */
function require_valid_identity_document($type, $value): array
{
    $normalizedType = normalize_identity_document_type($type);
    if ($normalizedType === '') {
        throw new \InvalidArgumentException('Tipo de documento inválido. Use DNI o CE.');
    }
    $normalizedValue = normalize_identity_document($normalizedType, $value);
    if (!validate_identity_document($normalizedType, $normalizedValue)) {
        $message = $normalizedType === 'DNI'
            ? 'El DNI debe contener exactamente 8 dígitos.'
            : 'El CE debe contener entre 9 y 12 letras o números.';
        throw new \InvalidArgumentException($message);
    }
    return ['type' => $normalizedType, 'value' => $normalizedValue];
}

function is_dni_document($type, $value): bool
{
    return normalize_identity_document_type($type) === 'DNI'
        && validate_identity_document('DNI', normalize_identity_document('DNI', $value));
}

function normalize_untyped_identity_document($value): string
{
    $normalized = strtoupper(trim((string) $value));
    return validate_identity_document('DNI', $normalized) || validate_identity_document('CE', $normalized)
        ? $normalized
        : '';
}
