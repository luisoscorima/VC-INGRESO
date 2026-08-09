-- Tipos documentales para visitas y snapshots. Expansiva e idempotente.
USE vc_db;

DROP PROCEDURE IF EXISTS `vc_add_identity_document_types`;
DELIMITER $$
CREATE PROCEDURE `vc_add_identity_document_types`()
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'temporary_visits'
          AND COLUMN_NAME = 'temp_visit_doc_type'
    ) THEN
        ALTER TABLE `temporary_visits`
            ADD COLUMN `temp_visit_doc_type` ENUM('DNI','CE') DEFAULT NULL AFTER `temp_visit_doc`;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'access_logs'
          AND COLUMN_NAME = 'document_type_snapshot'
    ) THEN
        ALTER TABLE `access_logs`
            ADD COLUMN `document_type_snapshot` ENUM('DNI','CE') DEFAULT NULL AFTER `document_snapshot`;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'temporary_access_logs'
          AND COLUMN_NAME = 'document_type_snapshot'
    ) THEN
        ALTER TABLE `temporary_access_logs`
            ADD COLUMN `document_type_snapshot` ENUM('DNI','CE') DEFAULT NULL AFTER `document_snapshot`;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'temporary_visits'
          AND INDEX_NAME = 'idx_temp_visit_doc_typed'
    ) THEN
        ALTER TABLE `temporary_visits`
            ADD KEY `idx_temp_visit_doc_typed` (`temp_visit_doc_type`, `temp_visit_doc`);
    END IF;
END$$
DELIMITER ;
CALL `vc_add_identity_document_types`();
DROP PROCEDURE IF EXISTS `vc_add_identity_document_types`;

-- Solo CE inequívocos (contienen letras). Ocho dígitos quedan sin tipo para revisión.
UPDATE `temporary_visits`
SET temp_visit_doc = UPPER(TRIM(temp_visit_doc)),
    temp_visit_doc_type = 'CE'
WHERE temp_visit_doc_type IS NULL
  AND UPPER(TRIM(temp_visit_doc)) REGEXP '^[A-Z0-9]{7,15}$'
  AND UPPER(TRIM(temp_visit_doc)) REGEXP '[A-Z]';

UPDATE `access_logs` al
LEFT JOIN `persons` p ON p.id = al.person_id
SET al.document_type_snapshot =
    CASE
        WHEN p.type_doc = 'DNI' AND p.doc_number REGEXP '^[0-9]{8}$' THEN 'DNI'
        WHEN p.type_doc = 'CE' AND UPPER(p.doc_number) REGEXP '^[A-Z0-9]{7,15}$' THEN 'CE'
        WHEN al.identity_source = 'RENIEC' AND al.document_snapshot REGEXP '^[0-9]{8}$' THEN 'DNI'
        ELSE al.document_type_snapshot
    END
WHERE al.document_type_snapshot IS NULL;

UPDATE `temporary_access_logs` tal
LEFT JOIN `temporary_visits` tv ON tv.temp_visit_id = tal.temp_visit_id
SET tal.document_type_snapshot = tv.temp_visit_doc_type
WHERE tal.document_type_snapshot IS NULL
  AND tv.temp_visit_doc_type IS NOT NULL;

-- Auditoría: estos SELECT no alteran catálogos ni snapshots ambiguos.
SELECT id, type_doc, doc_number
FROM persons
WHERE NOT (
    (type_doc = 'DNI' AND doc_number REGEXP '^[0-9]{8}$')
 OR (type_doc = 'CE' AND UPPER(doc_number) REGEXP '^[A-Z0-9]{7,15}$')
);

SELECT vehicle_id, license_plate
FROM vehicles
WHERE license_plate IS NOT NULL
  AND NOT (
      UPPER(TRIM(license_plate)) REGEXP '^[A-Z0-9 -]+$'
      AND CHAR_LENGTH(REGEXP_REPLACE(UPPER(TRIM(license_plate)), '[ -]', '')) = 6
  );

SELECT REGEXP_REPLACE(UPPER(TRIM(license_plate)), '[ -]', '') AS canonical_plate,
       COUNT(*) AS collision_count,
       GROUP_CONCAT(vehicle_id ORDER BY vehicle_id) AS vehicle_ids
FROM vehicles
WHERE license_plate IS NOT NULL
  AND UPPER(TRIM(license_plate)) REGEXP '^[A-Z0-9 -]+$'
GROUP BY canonical_plate
HAVING COUNT(*) > 1;
