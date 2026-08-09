-- Backfill idempotente de identidad para registros previos a la migración 010.
-- Los datos inferidos se marcan LEGACY; nunca se marcan como RENIEC.

USE vc_db;

UPDATE `access_logs` al
LEFT JOIN `persons` p ON p.id = al.person_id
LEFT JOIN `vehicles` v ON v.vehicle_id = al.vehicle_id
LEFT JOIN `persons` vo ON vo.id = v.owner_id
SET
    al.entity_kind = COALESCE(
        al.entity_kind,
        CASE
            WHEN al.vehicle_id IS NOT NULL
              OR al.observation REGEXP 'placa[[:space:]]+[[:alnum:]-]+'
                THEN 'VEHICLE'
            WHEN al.person_id IS NOT NULL
              OR al.doc_number REGEXP '^[0-9]{8,15}$'
                THEN 'PERSON'
            ELSE NULL
        END
    ),
    al.document_snapshot = COALESCE(
        NULLIF(TRIM(al.document_snapshot), ''),
        CASE
            WHEN al.vehicle_id IS NULL
              AND NOT (al.observation REGEXP 'placa[[:space:]]+[[:alnum:]-]+')
                THEN NULLIF(TRIM(COALESCE(p.doc_number, al.doc_number)), '')
            ELSE NULL
        END
    ),
    al.license_plate_snapshot = COALESCE(
        NULLIF(TRIM(al.license_plate_snapshot), ''),
        CASE
            WHEN UPPER(TRIM(v.license_plate)) REGEXP '^[A-Z0-9 -]+$'
             AND CHAR_LENGTH(REGEXP_REPLACE(UPPER(TRIM(v.license_plate)), '[ -]', '')) = 6
                THEN REGEXP_REPLACE(UPPER(TRIM(v.license_plate)), '[ -]', '')
            ELSE NULL
        END,
        CASE
            WHEN REGEXP_REPLACE(
                    REGEXP_SUBSTR(al.observation, 'placa[[:space:]]+[[:alnum:] -]+', 1, 1, 'i'),
                    '^placa[[:space:]]+', '', 1, 0, 'i'
                 ) REGEXP '^[A-Za-z0-9 -]+$'
             AND CHAR_LENGTH(REGEXP_REPLACE(
                REGEXP_REPLACE(
                    REGEXP_SUBSTR(al.observation, 'placa[[:space:]]+[[:alnum:]-]+', 1, 1, 'i'),
                    '^placa[[:space:]]+', '', 1, 0, 'i'
                ), '[ -]', '')) = 6
                THEN REGEXP_REPLACE(UPPER(REGEXP_REPLACE(
                        REGEXP_SUBSTR(al.observation, 'placa[[:space:]]+[[:alnum:]-]+', 1, 1, 'i'),
                        '^placa[[:space:]]+', '', 1, 0, 'i'
                    )), '[ -]', '')
            ELSE NULL
        END
    ),
    al.display_name_snapshot = COALESCE(
        NULLIF(TRIM(al.display_name_snapshot), ''),
        CASE
            WHEN al.vehicle_id IS NOT NULL
              OR al.observation REGEXP 'placa[[:space:]]+[[:alnum:]-]+'
                THEN NULLIF(TRIM(CONCAT_WS(
                    ' ',
                    NULLIF(vo.first_name, ''),
                    NULLIF(vo.paternal_surname, ''),
                    NULLIF(vo.maternal_surname, '')
                )), '')
            WHEN al.person_id IS NOT NULL
                THEN NULLIF(TRIM(CONCAT_WS(
                    ' ',
                    NULLIF(p.first_name, ''),
                    NULLIF(p.paternal_surname, ''),
                    NULLIF(p.maternal_surname, '')
                )), '')
            ELSE NULL
        END
    ),
    al.identity_source = COALESCE(al.identity_source, 'LEGACY'),
    al.identity_resolved_at = COALESCE(al.identity_resolved_at, al.created_at)
WHERE al.entity_kind IS NULL
   OR al.display_name_snapshot IS NULL
   OR al.document_snapshot IS NULL
   OR al.license_plate_snapshot IS NULL
   OR al.identity_source IS NULL
   OR al.identity_resolved_at IS NULL;

UPDATE `temporary_access_logs` tal
LEFT JOIN `temporary_visits` tv ON tv.temp_visit_id = tal.temp_visit_id
SET
    tal.entity_kind = COALESCE(
        tal.entity_kind,
        CASE
            WHEN NULLIF(TRIM(tv.temp_visit_plate), '') IS NOT NULL THEN 'VEHICLE'
            ELSE 'PERSON'
        END
    ),
    tal.display_name_snapshot = COALESCE(
        NULLIF(TRIM(tal.display_name_snapshot), ''),
        NULLIF(TRIM(tv.temp_visit_name), '')
    ),
    tal.document_snapshot = COALESCE(
        NULLIF(TRIM(tal.document_snapshot), ''),
        NULLIF(TRIM(tv.temp_visit_doc), '')
    ),
    tal.license_plate_snapshot = COALESCE(
        NULLIF(TRIM(tal.license_plate_snapshot), ''),
        CASE
            WHEN UPPER(TRIM(tv.temp_visit_plate)) REGEXP '^[A-Z0-9 -]+$'
             AND CHAR_LENGTH(REGEXP_REPLACE(UPPER(TRIM(tv.temp_visit_plate)), '[ -]', '')) = 6
                THEN REGEXP_REPLACE(UPPER(TRIM(tv.temp_visit_plate)), '[ -]', '')
            ELSE NULL
        END
    ),
    tal.identity_source = COALESCE(tal.identity_source, 'LEGACY'),
    tal.identity_resolved_at = COALESCE(tal.identity_resolved_at, tal.temp_entry_time)
WHERE tal.entity_kind IS NULL
   OR tal.display_name_snapshot IS NULL
   OR tal.document_snapshot IS NULL
   OR tal.license_plate_snapshot IS NULL
   OR tal.identity_source IS NULL
   OR tal.identity_resolved_at IS NULL;

-- Consultas de validación (deben revisarse antes de endurecer entity_kind).
SELECT COUNT(*) AS unresolved_access_logs
FROM access_logs
WHERE entity_kind IS NULL;

SELECT COUNT(*) AS unresolved_temporary_access_logs
FROM temporary_access_logs
WHERE entity_kind IS NULL;
