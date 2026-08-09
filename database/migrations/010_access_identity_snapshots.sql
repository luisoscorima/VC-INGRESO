-- Identidad semántica y snapshots inmutables para auditoría de accesos.
-- Expansión compatible: todas las columnas permanecen nullable durante la transición.

USE vc_db;

DROP PROCEDURE IF EXISTS `vc_add_access_identity_columns`;
DELIMITER $$
CREATE PROCEDURE `vc_add_access_identity_columns`()
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'access_logs' AND COLUMN_NAME = 'entity_kind'
    ) THEN
        ALTER TABLE `access_logs`
            ADD COLUMN `entity_kind` ENUM('PERSON','VEHICLE') DEFAULT NULL AFTER `vehicle_id`;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'access_logs' AND COLUMN_NAME = 'display_name_snapshot'
    ) THEN
        ALTER TABLE `access_logs`
            ADD COLUMN `display_name_snapshot` VARCHAR(255) DEFAULT NULL AFTER `entity_kind`;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'access_logs' AND COLUMN_NAME = 'document_snapshot'
    ) THEN
        ALTER TABLE `access_logs`
            ADD COLUMN `document_snapshot` VARCHAR(20) DEFAULT NULL AFTER `display_name_snapshot`;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'access_logs' AND COLUMN_NAME = 'license_plate_snapshot'
    ) THEN
        ALTER TABLE `access_logs`
            ADD COLUMN `license_plate_snapshot` VARCHAR(20) DEFAULT NULL AFTER `document_snapshot`;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'access_logs' AND COLUMN_NAME = 'identity_source'
    ) THEN
        ALTER TABLE `access_logs`
            ADD COLUMN `identity_source` ENUM('LOCAL','RENIEC','LEGACY') DEFAULT NULL AFTER `license_plate_snapshot`;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'access_logs' AND COLUMN_NAME = 'identity_resolved_at'
    ) THEN
        ALTER TABLE `access_logs`
            ADD COLUMN `identity_resolved_at` DATETIME DEFAULT NULL AFTER `identity_source`;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'access_logs'
          AND INDEX_NAME = 'idx_access_identity_cache'
    ) THEN
        ALTER TABLE `access_logs`
            ADD KEY `idx_access_identity_cache`
                (`document_snapshot`, `identity_source`, `identity_resolved_at`);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'temporary_access_logs' AND COLUMN_NAME = 'entity_kind'
    ) THEN
        ALTER TABLE `temporary_access_logs`
            ADD COLUMN `entity_kind` ENUM('PERSON','VEHICLE') DEFAULT NULL AFTER `temp_visit_id`;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'temporary_access_logs' AND COLUMN_NAME = 'display_name_snapshot'
    ) THEN
        ALTER TABLE `temporary_access_logs`
            ADD COLUMN `display_name_snapshot` VARCHAR(255) DEFAULT NULL AFTER `entity_kind`;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'temporary_access_logs' AND COLUMN_NAME = 'document_snapshot'
    ) THEN
        ALTER TABLE `temporary_access_logs`
            ADD COLUMN `document_snapshot` VARCHAR(20) DEFAULT NULL AFTER `display_name_snapshot`;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'temporary_access_logs' AND COLUMN_NAME = 'license_plate_snapshot'
    ) THEN
        ALTER TABLE `temporary_access_logs`
            ADD COLUMN `license_plate_snapshot` VARCHAR(20) DEFAULT NULL AFTER `document_snapshot`;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'temporary_access_logs' AND COLUMN_NAME = 'identity_source'
    ) THEN
        ALTER TABLE `temporary_access_logs`
            ADD COLUMN `identity_source` ENUM('LOCAL','RENIEC','LEGACY') DEFAULT NULL AFTER `license_plate_snapshot`;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'temporary_access_logs' AND COLUMN_NAME = 'identity_resolved_at'
    ) THEN
        ALTER TABLE `temporary_access_logs`
            ADD COLUMN `identity_resolved_at` DATETIME DEFAULT NULL AFTER `identity_source`;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'temporary_access_logs'
          AND INDEX_NAME = 'idx_temp_access_identity_cache'
    ) THEN
        ALTER TABLE `temporary_access_logs`
            ADD KEY `idx_temp_access_identity_cache`
                (`document_snapshot`, `identity_source`, `identity_resolved_at`);
    END IF;
END$$
DELIMITER ;

CALL `vc_add_access_identity_columns`();
DROP PROCEDURE `vc_add_access_identity_columns`;
