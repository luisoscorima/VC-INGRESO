-- Mejoras temporary_access_logs: asignación, timer, permanencia
-- Ejecutar sobre BD existente vc_db

USE vc_db;

ALTER TABLE `temporary_access_logs`
    ADD COLUMN `assignment_id` INT UNSIGNED NULL AFTER `temp_visit_id`,
    ADD COLUMN `assignment_valid_until` DATETIME NULL COMMENT 'Hasta cuando podía entrar (snapshot)',
    ADD COLUMN `authorized_duration_minutes` SMALLINT UNSIGNED NULL COMMENT 'Minutos estadía autorizados (del vecino)',
    ADD COLUMN `stay_deadline` DATETIME NULL COMMENT 'temp_entry_time + authorized_duration_minutes',
    ADD KEY `idx_tal_entry_time` (`temp_entry_time`),
    ADD KEY `idx_tal_assignment` (`assignment_id`),
    ADD KEY `idx_tal_open_session` (`temp_visit_id`, `house_id`, `temp_exit_time`),
    ADD KEY `idx_tal_stay_deadline` (`stay_deadline`);

ALTER TABLE `temporary_access_logs`
    ADD CONSTRAINT `fk_temp_access_logs_assignment` FOREIGN KEY (`assignment_id`) REFERENCES `temporary_visit_assignments` (`assignment_id`) ON DELETE SET NULL ON UPDATE CASCADE;
