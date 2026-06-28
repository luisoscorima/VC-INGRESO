-- Registro de eventos de auditoría (solo consulta por ADMINISTRADOR)
-- Ejecutar en BDs existentes: mysql ... < database/migrations/003_event_logs.sql

CREATE TABLE IF NOT EXISTS `event_logs` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `occurred_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `actor_user_id` INT UNSIGNED DEFAULT NULL,
    `actor_role` VARCHAR(20) DEFAULT NULL,
    `actor_username` VARCHAR(50) DEFAULT NULL,
    `action` VARCHAR(80) NOT NULL,
    `entity_type` VARCHAR(50) DEFAULT NULL,
    `entity_id` VARCHAR(64) DEFAULT NULL,
    `summary` VARCHAR(500) NOT NULL,
    `details_json` JSON DEFAULT NULL,
    `ip_address` VARCHAR(45) DEFAULT NULL,
    `user_agent` VARCHAR(255) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_event_logs_occurred_at` (`occurred_at`),
    KEY `idx_event_logs_action` (`action`),
    KEY `idx_event_logs_actor` (`actor_user_id`),
    KEY `idx_event_logs_entity` (`entity_type`, `entity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET GLOBAL event_scheduler = ON;

DROP EVENT IF EXISTS ev_vc_purge_event_logs;

CREATE EVENT ev_vc_purge_event_logs
ON SCHEDULE EVERY 1 DAY
STARTS (TIMESTAMP(CURDATE()) + INTERVAL 3 HOUR)
ON COMPLETION PRESERVE
ENABLE
COMMENT 'Elimina event_logs con más de 30 días'
DO
  DELETE FROM event_logs WHERE occurred_at < NOW() - INTERVAL 30 DAY;
