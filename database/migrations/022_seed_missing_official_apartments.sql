-- Departamentos oficiales que no estaban en el grid O (101-104 / 201-204 / 301-304).
-- Idempotente: no inserta si ya existe la misma manzana + lote + dpto.
-- Ejecutar en BDs existentes: mysql ... < database/migrations/022_seed_missing_official_apartments.sql

INSERT INTO `houses` (`house_type`, `block_house`, `lot`, `apartment`, `status_system`)
SELECT v.house_type, v.block_house, v.lot, v.apartment, v.status_system
FROM (
    SELECT 'DEPARTAMENTO' AS house_type, 'O' AS block_house, 3 AS lot, '105' AS apartment, 'ACTIVO' AS status_system
    UNION ALL SELECT 'DEPARTAMENTO', 'O', 3, '120', 'ACTIVO'
    UNION ALL SELECT 'DEPARTAMENTO', 'O', 3, '206', 'ACTIVO'
    UNION ALL SELECT 'DEPARTAMENTO', 'O', 3, '305', 'ACTIVO'
    UNION ALL SELECT 'DEPARTAMENTO', 'O', 4, '307', 'ACTIVO'
    UNION ALL SELECT 'DEPARTAMENTO', 'O', 4, '318', 'ACTIVO'
    UNION ALL SELECT 'DEPARTAMENTO', 'O', 5, '116', 'ACTIVO'
    UNION ALL SELECT 'DEPARTAMENTO', 'O', 5, '316', 'ACTIVO'
    UNION ALL SELECT 'DEPARTAMENTO', 'O', 6, '211', 'ACTIVO'
    UNION ALL SELECT 'DEPARTAMENTO', 'O', 6, '213', 'ACTIVO'
) AS v
WHERE NOT EXISTS (
    SELECT 1
    FROM `houses` h
    WHERE h.block_house = v.block_house
      AND h.lot = v.lot
      AND h.apartment <=> v.apartment
);
