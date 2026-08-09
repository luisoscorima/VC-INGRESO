<?php
/**
 * Normalización de placas (vehículos residentes y, opcionalmente, visitas externas).
 * Placa peruana: seis alfanuméricos. Se toleran espacios/guion solo al capturar.
 */

/**
 * @param string $raw Placa tal como la envía el cliente o está en legado BD.
 * @return string Cadena normalizada (puede quedar vacía si no hay alfanuméricos).
 */
function normalize_license_plate(string $raw): string
{
    $s = strtoupper(trim($raw));
    if ($s === '' || preg_match('/^[A-Z0-9 -]+$/', $s) !== 1) {
        return '';
    }
    return preg_replace('/[ -]+/', '', $s);
}

function validate_license_plate(string $plate): bool
{
    return preg_match('/^[A-Z0-9]{6}$/', $plate) === 1;
}

function require_valid_license_plate($raw): string
{
    $plate = normalize_license_plate((string) $raw);
    if (!validate_license_plate($plate)) {
        throw new \InvalidArgumentException(
            'Ingrese una placa peruana de 6 letras o números. Puede usar espacios o guion.'
        );
    }
    return $plate;
}
