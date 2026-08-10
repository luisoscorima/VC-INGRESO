-- house_id opcional en access_logs (p. ej. denegados sin persona/vehículo vinculados).
-- Idempotente.

SET @db := DATABASE();

SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'access_logs' AND COLUMN_NAME = 'house_id'
);
SET @sql := IF(@col_exists = 0,
    'ALTER TABLE `access_logs` ADD COLUMN `house_id` INT UNSIGNED DEFAULT NULL COMMENT ''Casa asociada (operario / incidente)'' AFTER `vehicle_id`',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'access_logs' AND INDEX_NAME = 'idx_access_logs_house'
);
SET @sql := IF(@idx_exists = 0,
    'ALTER TABLE `access_logs` ADD KEY `idx_access_logs_house` (`house_id`)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk_exists := (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'access_logs' AND CONSTRAINT_NAME = 'fk_access_logs_house'
);
SET @sql := IF(@fk_exists = 0,
    'ALTER TABLE `access_logs` ADD CONSTRAINT `fk_access_logs_house` FOREIGN KEY (`house_id`) REFERENCES `houses` (`house_id`) ON DELETE SET NULL ON UPDATE CASCADE',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
