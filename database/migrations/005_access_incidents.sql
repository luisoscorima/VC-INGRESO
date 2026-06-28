-- Incidencias de acceso (escáner + manual desde sidebar)
-- Ejecutar sobre BD existente vc_db

USE vc_db;

CREATE TABLE IF NOT EXISTS `access_incidents` (
    `incident_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `source` ENUM('scan', 'manual') NOT NULL DEFAULT 'manual',
    `access_log_id` BIGINT UNSIGNED DEFAULT NULL,
    `temp_access_log_id` INT UNSIGNED DEFAULT NULL,
    `access_point_id` INT UNSIGNED NOT NULL,
    `house_id` INT UNSIGNED DEFAULT NULL,
    `person_id` INT UNSIGNED DEFAULT NULL,
    `vehicle_id` INT UNSIGNED DEFAULT NULL,
    `temp_visit_id` INT UNSIGNED DEFAULT NULL,
    `doc_number` VARCHAR(20) DEFAULT NULL,
    `license_plate` VARCHAR(20) DEFAULT NULL,
    `status_validated` VARCHAR(50) DEFAULT NULL,
    `description` TEXT NOT NULL,
    `photo_url` VARCHAR(255) DEFAULT NULL,
    `created_by_user_id` INT UNSIGNED DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`incident_id`),
    KEY `idx_ai_created_at` (`created_at`),
    KEY `idx_ai_access_point` (`access_point_id`),
    KEY `idx_ai_source` (`source`),
    KEY `idx_ai_access_log` (`access_log_id`),
    KEY `idx_ai_temp_access_log` (`temp_access_log_id`),
    KEY `idx_ai_created_by` (`created_by_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Incidencias reportadas en garita';

ALTER TABLE `access_incidents`
    ADD CONSTRAINT `fk_ai_access_log` FOREIGN KEY (`access_log_id`) REFERENCES `access_logs` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_ai_temp_access_log` FOREIGN KEY (`temp_access_log_id`) REFERENCES `temporary_access_logs` (`temp_access_log_id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_ai_access_point` FOREIGN KEY (`access_point_id`) REFERENCES `access_points` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_ai_house` FOREIGN KEY (`house_id`) REFERENCES `houses` (`house_id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_ai_person` FOREIGN KEY (`person_id`) REFERENCES `persons` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_ai_vehicle` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles` (`vehicle_id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_ai_temp_visit` FOREIGN KEY (`temp_visit_id`) REFERENCES `temporary_visits` (`temp_visit_id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_ai_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO `nav_modules` (`module_key`, `label`, `route`, `section`, `sort_order`, `is_enabled`) VALUES
('incidents', 'Incidencias', '/incidents', 'gestion', 65, 1)
ON DUPLICATE KEY UPDATE `label` = VALUES(`label`), `route` = VALUES(`route`), `section` = VALUES(`section`), `sort_order` = VALUES(`sort_order`);

INSERT INTO `role_nav_permissions` (`role_system`, `module_key`, `can_view`, `can_manage`) VALUES
('ADMINISTRADOR', 'incidents', 1, 1),
('OPERARIO', 'incidents', 1, 0)
ON DUPLICATE KEY UPDATE `can_view` = VALUES(`can_view`), `can_manage` = VALUES(`can_manage`);
