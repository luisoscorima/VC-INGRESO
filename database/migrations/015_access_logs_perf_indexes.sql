-- Índices de rendimiento para historial / egreso por placa.
-- Idempotente.

SET @db := DATABASE();

-- access_logs (access_point_id, created_at)
SET @idx_exists := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'access_logs' AND INDEX_NAME = 'idx_al_point_created'
);
SET @sql := IF(@idx_exists = 0,
    'ALTER TABLE `access_logs` ADD KEY `idx_al_point_created` (`access_point_id`, `created_at`)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- access_logs (access_point_id, type, created_at) — match ingreso abierto / egreso
SET @idx_exists := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'access_logs' AND INDEX_NAME = 'idx_al_point_type_created'
);
SET @sql := IF(@idx_exists = 0,
    'ALTER TABLE `access_logs` ADD KEY `idx_al_point_type_created` (`access_point_id`, `type`, `created_at`)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- access_logs (license_plate_snapshot)
SET @idx_exists := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'access_logs' AND INDEX_NAME = 'idx_al_license_plate_snapshot'
);
SET @sql := IF(@idx_exists = 0,
    'ALTER TABLE `access_logs` ADD KEY `idx_al_license_plate_snapshot` (`license_plate_snapshot`)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- temporary_access_logs (access_point_id, temp_entry_time)
SET @idx_exists := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'temporary_access_logs' AND INDEX_NAME = 'idx_tal_point_entry'
);
SET @sql := IF(@idx_exists = 0,
    'ALTER TABLE `temporary_access_logs` ADD KEY `idx_tal_point_entry` (`access_point_id`, `temp_entry_time`)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- temporary_access_logs (license_plate_snapshot)
SET @idx_exists := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'temporary_access_logs' AND INDEX_NAME = 'idx_tal_license_plate_snapshot'
);
SET @sql := IF(@idx_exists = 0,
    'ALTER TABLE `temporary_access_logs` ADD KEY `idx_tal_license_plate_snapshot` (`license_plate_snapshot`)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
