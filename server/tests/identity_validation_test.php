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
assert_validation(normalize_identity_document('CE', ' ab1234567 ') === 'AB1234567', 'CE no se normalizó');
assert_validation(validate_identity_document('CE', normalize_identity_document('CE', 'ab1234567')), 'CE válido rechazado');
assert_validation(validate_identity_document('CE', '123456789'), 'CE numérico de nueve dígitos rechazado');
assert_validation(validate_identity_document('CE', 'N12345678'), 'CE con prefijo N rechazado');
assert_validation(!validate_identity_document('CE', normalize_identity_document('CE', 'ab12345')), 'CE de 7 caracteres aceptado');
assert_validation(!validate_identity_document('CE', '12345678'), 'CE numérico de ocho dígitos aceptado');
assert_validation(!validate_identity_document('CE', normalize_identity_document('CE', 'ABC-123')), 'CE con símbolo aceptado');
assert_validation(infer_identity_document_type('12345678') === 'DNI', '8 dígitos no se infirieron como DNI');
assert_validation(infer_identity_document_type('123456789') === 'CE', '9 dígitos no se infirieron como CE');
assert_validation(infer_identity_document_type('n12345678') === 'CE', 'CE alfanumérico no se infirió');
assert_validation(infer_identity_document_type('1234567') === '', 'Documento corto no debió inferirse');

echo "identity validation: OK\n";
