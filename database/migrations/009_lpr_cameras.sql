-- Cámaras LPR (garita) y eventos de reconocimiento de placas
-- Ejecutar sobre BD existente:
--   docker exec -i vc-ingreso-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" vc_db' < database/migrations/009_lpr_cameras.sql

USE vc_db;

CREATE TABLE IF NOT EXISTS `lpr_cameras` (
    `camera_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(120) NOT NULL,
    `access_point_id` INT UNSIGNED NOT NULL,
    `direction` ENUM('INGRESO', 'EGRESO') NOT NULL DEFAULT 'INGRESO',
    `stream_url` VARCHAR(512) DEFAULT NULL COMMENT 'RTSP u otro stream OpenCV',
    `snapshot_url` VARCHAR(512) DEFAULT NULL COMMENT 'URL HTTP de foto (preferida si existe)',
    `is_enabled` TINYINT(1) NOT NULL DEFAULT 1,
    `min_confidence` DECIMAL(5,2) NOT NULL DEFAULT 0.55,
    `debounce_seconds` INT UNSIGNED NOT NULL DEFAULT 30,
    `poll_interval_ms` INT UNSIGNED NOT NULL DEFAULT 1000,
    `last_seen_at` TIMESTAMP NULL DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`camera_id`),
    KEY `idx_lpr_cam_access_point` (`access_point_id`),
    KEY `idx_lpr_cam_enabled` (`is_enabled`),
    CONSTRAINT `fk_lpr_cam_access_point`
        FOREIGN KEY (`access_point_id`) REFERENCES `access_points` (`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Cámaras IP fijas para LPR en garita';

CREATE TABLE IF NOT EXISTS `lpr_events` (
    `event_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `camera_id` INT UNSIGNED NOT NULL,
    `access_point_id` INT UNSIGNED NOT NULL,
    `license_plate` VARCHAR(20) NOT NULL,
    `confidence` DECIMAL(5,4) DEFAULT NULL,
    `direction` ENUM('INGRESO', 'EGRESO') NOT NULL DEFAULT 'INGRESO',
    `result` ENUM(
        'REGISTERED',
        'DENIED',
        'DUPLICATE',
        'PENDING_HOUSE',
        'LOW_CONFIDENCE',
        'ERROR'
    ) NOT NULL,
    `status_validated` VARCHAR(50) DEFAULT NULL,
    `message` VARCHAR(255) DEFAULT NULL,
    `vehicle_id` INT UNSIGNED DEFAULT NULL,
    `temp_visit_id` INT UNSIGNED DEFAULT NULL,
    `access_log_id` BIGINT UNSIGNED DEFAULT NULL,
    `temp_access_log_id` INT UNSIGNED DEFAULT NULL,
    `snapshot_url` VARCHAR(255) DEFAULT NULL,
    `raw_ocr` VARCHAR(255) DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`event_id`),
    KEY `idx_lpr_evt_created` (`created_at`),
    KEY `idx_lpr_evt_camera_plate_created` (`camera_id`, `license_plate`, `created_at`),
    KEY `idx_lpr_evt_result` (`result`),
    KEY `idx_lpr_evt_access_point` (`access_point_id`),
    CONSTRAINT `fk_lpr_evt_camera`
        FOREIGN KEY (`camera_id`) REFERENCES `lpr_cameras` (`camera_id`)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_lpr_evt_access_point`
        FOREIGN KEY (`access_point_id`) REFERENCES `access_points` (`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Eventos de reconocimiento automático de placas';

INSERT INTO `nav_modules` (`module_key`, `label`, `route`, `section`, `sort_order`, `is_enabled`) VALUES
('lpr', 'Cámaras LPR', '/lpr', 'admin', 75, 1)
ON DUPLICATE KEY UPDATE
    `label` = VALUES(`label`),
    `route` = VALUES(`route`),
    `section` = VALUES(`section`),
    `sort_order` = VALUES(`sort_order`),
    `is_enabled` = VALUES(`is_enabled`);

INSERT INTO `role_nav_permissions` (`role_system`, `module_key`, `can_view`, `can_manage`) VALUES
('ADMINISTRADOR', 'lpr', 1, 1),
('OPERARIO', 'lpr', 1, 0)
ON DUPLICATE KEY UPDATE
    `can_view` = VALUES(`can_view`),
    `can_manage` = VALUES(`can_manage`);
