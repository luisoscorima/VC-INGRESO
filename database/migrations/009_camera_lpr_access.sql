-- Acceso vehicular automático por cámaras LPR.
-- Mantiene las lecturas OCR separadas de access_incidents.

USE vc_db;

CREATE TABLE IF NOT EXISTS `access_cameras` (
    `camera_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(120) NOT NULL,
    `access_point_id` INT UNSIGNED NOT NULL,
    `api_key_hash` CHAR(64) NOT NULL,
    `api_key_prefix` VARCHAR(16) NOT NULL,
    `debounce_seconds` SMALLINT UNSIGNED NOT NULL DEFAULT 45,
    `is_active` TINYINT(1) NOT NULL DEFAULT 1,
    `last_seen_at` DATETIME DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`camera_id`),
    UNIQUE KEY `uq_access_cameras_api_key_hash` (`api_key_hash`),
    KEY `idx_access_cameras_point_active` (`access_point_id`, `is_active`),
    CONSTRAINT `fk_access_cameras_point`
        FOREIGN KEY (`access_point_id`) REFERENCES `access_points` (`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Cámaras autorizadas para registrar lecturas LPR';

DROP PROCEDURE IF EXISTS `vc_add_lpr_log_columns`;
DELIMITER $$
CREATE PROCEDURE `vc_add_lpr_log_columns`()
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'access_logs' AND COLUMN_NAME = 'entry_source'
    ) THEN
        ALTER TABLE `access_logs`
            ADD COLUMN `entry_source` ENUM('manual', 'qr', 'camera') NOT NULL DEFAULT 'manual' AFTER `observation`;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'access_logs' AND COLUMN_NAME = 'photo_url'
    ) THEN
        ALTER TABLE `access_logs` ADD COLUMN `photo_url` VARCHAR(255) DEFAULT NULL AFTER `entry_source`;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'access_logs' AND INDEX_NAME = 'idx_access_logs_entry_source'
    ) THEN
        ALTER TABLE `access_logs` ADD KEY `idx_access_logs_entry_source` (`entry_source`);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'temporary_access_logs' AND COLUMN_NAME = 'entry_source'
    ) THEN
        ALTER TABLE `temporary_access_logs`
            ADD COLUMN `entry_source` ENUM('manual', 'qr', 'camera') NOT NULL DEFAULT 'manual' AFTER `status_validated`;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'temporary_access_logs' AND COLUMN_NAME = 'photo_url'
    ) THEN
        ALTER TABLE `temporary_access_logs` ADD COLUMN `photo_url` VARCHAR(255) DEFAULT NULL AFTER `entry_source`;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'temporary_access_logs' AND INDEX_NAME = 'idx_temp_access_logs_entry_source'
    ) THEN
        ALTER TABLE `temporary_access_logs` ADD KEY `idx_temp_access_logs_entry_source` (`entry_source`);
    END IF;
END$$
DELIMITER ;
CALL `vc_add_lpr_log_columns`();
DROP PROCEDURE `vc_add_lpr_log_columns`;

CREATE TABLE IF NOT EXISTS `camera_access_events` (
    `event_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `camera_id` INT UNSIGNED NOT NULL,
    `access_point_id` INT UNSIGNED NOT NULL,
    `license_plate_raw` VARCHAR(40) NOT NULL,
    `license_plate_norm` VARCHAR(20) NOT NULL,
    `confidence` DECIMAL(5,4) DEFAULT NULL,
    `match_type` ENUM('REGISTRY', 'EXTERNAL', 'NONE', 'DENIED') NOT NULL,
    `result` ENUM('ALLOWED', 'DENIED', 'IGNORED_DUPLICATE') NOT NULL,
    `access_log_id` BIGINT UNSIGNED DEFAULT NULL,
    `temp_access_log_id` INT UNSIGNED DEFAULT NULL,
    `vehicle_id` INT UNSIGNED DEFAULT NULL,
    `temp_visit_id` INT UNSIGNED DEFAULT NULL,
    `house_id` INT UNSIGNED DEFAULT NULL,
    `photo_url` VARCHAR(255) DEFAULT NULL,
    `captured_at` DATETIME NOT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`event_id`),
    KEY `idx_camera_events_created` (`created_at`),
    KEY `idx_camera_events_camera_created` (`camera_id`, `created_at`),
    KEY `idx_camera_events_point_created` (`access_point_id`, `created_at`),
    KEY `idx_camera_events_plate_created` (`license_plate_norm`, `created_at`),
    KEY `idx_camera_events_result_created` (`result`, `created_at`),
    KEY `idx_camera_events_access_log` (`access_log_id`),
    KEY `idx_camera_events_temp_log` (`temp_access_log_id`),
    CONSTRAINT `fk_camera_events_camera`
        FOREIGN KEY (`camera_id`) REFERENCES `access_cameras` (`camera_id`)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_camera_events_point`
        FOREIGN KEY (`access_point_id`) REFERENCES `access_points` (`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_camera_events_access_log`
        FOREIGN KEY (`access_log_id`) REFERENCES `access_logs` (`id`)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `fk_camera_events_temp_log`
        FOREIGN KEY (`temp_access_log_id`) REFERENCES `temporary_access_logs` (`temp_access_log_id`)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `fk_camera_events_vehicle`
        FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles` (`vehicle_id`)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `fk_camera_events_temp_visit`
        FOREIGN KEY (`temp_visit_id`) REFERENCES `temporary_visits` (`temp_visit_id`)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `fk_camera_events_house`
        FOREIGN KEY (`house_id`) REFERENCES `houses` (`house_id`)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Auditoría de lecturas OCR emitidas por cámaras LPR';

INSERT INTO `nav_modules`
    (`module_key`, `label`, `route`, `section`, `sort_order`, `is_enabled`)
VALUES
    ('cameras', 'Cámaras', '/cameras', 'admin', 75, 1)
ON DUPLICATE KEY UPDATE
    `label` = VALUES(`label`),
    `route` = VALUES(`route`),
    `section` = VALUES(`section`),
    `sort_order` = VALUES(`sort_order`);

INSERT INTO `role_nav_permissions`
    (`role_system`, `module_key`, `can_view`, `can_manage`)
VALUES
    ('ADMINISTRADOR', 'cameras', 1, 1),
    ('OPERARIO', 'cameras', 1, 0)
ON DUPLICATE KEY UPDATE
    `can_view` = VALUES(`can_view`),
    `can_manage` = VALUES(`can_manage`);
