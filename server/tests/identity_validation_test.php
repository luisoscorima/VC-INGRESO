<?php

require_once __DIR__ . '/../helpers/license_plate.php';
require_once __DIR__ . '/../helpers/identity_document.php';

function assert_validation(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

foreach (['ABC123', 'ABC-123', 'AB-1234'] as $plate) {
    assert_validation(validate_license_plate(normalize_license_plate($plate)), "Placa válida rechazada: $plate");
}
foreach (['ABC12', 'ABC1234', 'ABC.123', 'ABC/123', 'ABC_123', 'ABÑ123'] as $plate) {
    assert_validation(!validate_license_plate(normalize_license_plate($plate)), "Placa inválida aceptada: $plate");
}

assert_validation(validate_identity_document('DNI', normalize_identity_document('DNI', '12345678')), 'DNI válido rechazado');
assert_validation(!validate_identity_document('DNI', normalize_identity_document('DNI', '1234567')), 'DNI corto aceptado');
assert_validation(normalize_identity_document('CE', ' ab12345 ') === 'AB12345', 'CE no se normalizó');
assert_validation(validate_identity_document('CE', normalize_identity_document('CE', 'ab12345')), 'CE válido rechazado');
assert_validation(!validate_identity_document('CE', normalize_identity_document('CE', 'ABC-123')), 'CE con símbolo aceptado');
assert_validation(validate_identity_document('CE', '12345678'), 'CE numérico de ocho dígitos debe ser válido');

echo "identity validation: OK\n";
