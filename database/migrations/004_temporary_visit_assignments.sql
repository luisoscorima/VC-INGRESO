-- Visitas externas: catálogo global (temporary_visits) + asignaciones por casa con timer
-- Ejecutar sobre BD existente vc_db

USE vc_db;

-- Ampliar catálogo global (ejecutar una sola vez; ignorar errores de columna duplicada si ya aplicó)
ALTER TABLE `temporary_visits`
    ADD COLUMN `photo_url` VARCHAR(255) DEFAULT NULL AFTER `status_system`,
    ADD COLUMN `operator_notes` TEXT DEFAULT NULL AFTER `photo_url`,
    ADD COLUMN `created_by_user_id` INT UNSIGNED NULL DEFAULT NULL AFTER `operator_notes`,
    ADD COLUMN `updated_by_user_id` INT UNSIGNED NULL DEFAULT NULL AFTER `created_by_user_id`,
    ADD COLUMN `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER `updated_by_user_id`,
    ADD COLUMN `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `created_at`;

ALTER TABLE `temporary_visits`
    ADD KEY `idx_temp_visit_plate` (`temp_visit_plate`),
    ADD KEY `idx_temp_visit_doc` (`temp_visit_doc`);

CREATE TABLE IF NOT EXISTS `temporary_visit_assignments` (
    `assignment_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `temp_visit_id` INT UNSIGNED NOT NULL,
    `house_id` INT UNSIGNED NOT NULL,
    `registered_by_user_id` INT UNSIGNED NULL DEFAULT NULL,
    `valid_from` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `valid_until` DATETIME NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVA' COMMENT 'ACTIVA|EXPIRADA|CANCELADA',
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`assignment_id`),
    KEY `idx_tva_temp_visit` (`temp_visit_id`),
    KEY `idx_tva_house` (`house_id`),
    KEY `idx_tva_status_until` (`status`, `valid_until`),
    KEY `idx_tva_registered_by` (`registered_by_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Asignación temporal visita externa → casa';

-- FKs (omitir si ya existen)
ALTER TABLE `temporary_visit_assignments`
    ADD CONSTRAINT `fk_tva_temp_visit` FOREIGN KEY (`temp_visit_id`) REFERENCES `temporary_visits` (`temp_visit_id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_tva_house` FOREIGN KEY (`house_id`) REFERENCES `houses` (`house_id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_tva_registered_by` FOREIGN KEY (`registered_by_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `temporary_visits`
    ADD CONSTRAINT `fk_temp_visits_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_temp_visits_updated_by` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Migrar filas existentes: una asignación por registro (casa del usuario registrante)
INSERT INTO `temporary_visit_assignments` (`temp_visit_id`, `house_id`, `registered_by_user_id`, `valid_from`, `valid_until`, `status`)
SELECT
    tv.temp_visit_id,
    COALESCE(
        u.house_id,
        (SELECT hm.house_id FROM house_members hm
         INNER JOIN users u2 ON u2.person_id = hm.person_id
         WHERE u2.user_id = tv.registered_by_user_id AND COALESCE(hm.is_active, 1) = 1
         ORDER BY hm.is_primary DESC, hm.id ASC LIMIT 1)
    ) AS house_id,
    tv.registered_by_user_id,
    COALESCE(tv.created_at, NOW()),
    DATE_ADD(COALESCE(tv.created_at, NOW()), INTERVAL 2 HOUR),
    'EXPIRADA'
FROM temporary_visits tv
LEFT JOIN users u ON u.user_id = tv.registered_by_user_id
WHERE NOT EXISTS (
    SELECT 1 FROM temporary_visit_assignments tva WHERE tva.temp_visit_id = tv.temp_visit_id
)
AND COALESCE(
    u.house_id,
    (SELECT hm.house_id FROM house_members hm
     INNER JOIN users u2 ON u2.person_id = hm.person_id
     WHERE u2.user_id = tv.registered_by_user_id AND COALESCE(hm.is_active, 1) = 1
     ORDER BY hm.is_primary DESC, hm.id ASC LIMIT 1)
) IS NOT NULL;

-- Perfiles sin casa inferible: asignación expirada omitida (quedan solo en catálogo global)

UPDATE temporary_visits tv
SET created_by_user_id = COALESCE(created_by_user_id, registered_by_user_id)
WHERE created_by_user_id IS NULL AND registered_by_user_id IS NOT NULL;
