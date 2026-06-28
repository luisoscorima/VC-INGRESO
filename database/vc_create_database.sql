-- =============================================================================
-- VC-INGRESO - Creación completa de base de datos
-- Incluye tablas legacy + mascotas, reservaciones y access_logs (nuevo formato)
-- Ejecutar en orden; las claves foráneas se añaden al final.
-- =============================================================================
-- En Docker, este archivo se ejecuta desde database/init-docker.sh sustituyendo
-- __MYSQL_ROOT_PASSWORD__ por la contraseña real (root@'%' para que la API conecte).
-- Ejecución manual: sed 's/__MYSQL_ROOT_PASSWORD__/PASSWORD/g' database/vc_create_database.sql | mysql -uroot -p
-- =============================================================================

-- Permitir root desde la red Docker (contenedor API). Placeholder sustituido por init-docker.sh o por sed en ejecución manual.
CREATE USER IF NOT EXISTS 'root'@'%' IDENTIFIED WITH mysql_native_password BY '__MYSQL_ROOT_PASSWORD__';
GRANT ALL PRIVILEGES ON *.* TO 'root'@'%' WITH GRANT OPTION;
FLUSH PRIVILEGES;

-- Crear bases de datos (dev/stage/prod). Licencias: crearttech_clientes (bdLicense.php, DB_LICENSE_NAME).
CREATE DATABASE IF NOT EXISTS vc_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS crearttech_clientes CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Usar la base de datos vc_db para las tablas
USE vc_db;
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- 1. CASAS (houses)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `house_members`;
DROP TABLE IF EXISTS `survey_responses`;
DROP TABLE IF EXISTS `access_incidents`;
DROP TABLE IF EXISTS `surveys`;
DROP TABLE IF EXISTS `announcements`;
DROP TABLE IF EXISTS `reservations`;
DROP TABLE IF EXISTS `pets`;
DROP TABLE IF EXISTS `temporary_visit_assignments`;
DROP TABLE IF EXISTS `temporary_access_logs`;
DROP TABLE IF EXISTS `access_logs`;
DROP TABLE IF EXISTS `temporary_visits`;
DROP TABLE IF EXISTS `vehicles`;
DROP TABLE IF EXISTS `persons`;
DROP TABLE IF EXISTS `users`;
DROP TABLE IF EXISTS `access_points`;
DROP TABLE IF EXISTS `houses`;

CREATE TABLE `houses` (
    `house_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `house_type` ENUM('CASA', 'DEPARTAMENTO', 'LOCAL COMERCIAL','OTRO') NOT NULL,
    `block_house` VARCHAR(5) NOT NULL,
    `lot` INT NOT NULL,
    `apartment` VARCHAR(10) DEFAULT NULL,
    `owner_id` INT UNSIGNED DEFAULT NULL,
    `status_system` VARCHAR(50) DEFAULT NULL,
    PRIMARY KEY (`house_id`),
    KEY `idx_block_lot` (`block_house`, `lot`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Casas, departamentos o locales comerciales del condominio';

-- -----------------------------------------------------------------------------
-- 2. USUARIOS (users) - Solo datos del sistema (login, roles, estado). Identidad en persons.
-- -----------------------------------------------------------------------------
CREATE TABLE `users` (
    `user_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `person_id` INT UNSIGNED DEFAULT NULL COMMENT 'FK persons.id - identidad civil; 1 user = 1 person',
    `role_system` VARCHAR(20) NOT NULL,
    `username_system` VARCHAR(50) NOT NULL,
    `password_system` VARCHAR(255) NOT NULL,
    `house_id` INT UNSIGNED DEFAULT NULL COMMENT 'Legacy: preferir house_members',
    `status_validated` VARCHAR(50) DEFAULT NULL,
    `status_reason` VARCHAR(255) DEFAULT NULL,
    `status_system` VARCHAR(50) DEFAULT NULL,
    `is_active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1=habilitado, 0=deshabilitado',
    `force_password_change` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1=obligar cambio en próximo login',
    PRIMARY KEY (`user_id`),
    UNIQUE KEY `uk_username` (`username_system`),
    UNIQUE KEY `uk_person_id` (`person_id`),
    KEY `idx_house` (`house_id`),
    KEY `idx_person_id` (`person_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Usuarios del sistema (enlace a persons para datos civiles)';

-- Si la BD ya existe y users no tiene force_password_change:
-- ALTER TABLE users ADD COLUMN force_password_change TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1=obligar cambio en próximo login' AFTER is_active;

-- -----------------------------------------------------------------------------
-- 3. PUNTOS DE ACCESO (access_points) - Áreas y garitas (formato unificado API)
-- -----------------------------------------------------------------------------
CREATE TABLE `access_points` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL COMMENT 'Nombre del punto/área',
    `type` ENUM('ENTRADA', 'AREA_COMUN', 'AREA_LIMITADA') NOT NULL DEFAULT 'ENTRADA',
    `location` VARCHAR(255) DEFAULT NULL COMMENT 'Ubicación física',
    `is_active` TINYINT(1) NOT NULL DEFAULT 1,
    `controla_aforo` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1=obliga max_capacity y current_capacity',
    `permite_reserva` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1=admite reservas en el módulo',
    `max_capacity` INT UNSIGNED DEFAULT NULL COMMENT 'Solo si controla_aforo=1',
    `current_capacity` INT UNSIGNED DEFAULT NULL COMMENT 'Ocupación; NULL si no controla aforo',
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_name` (`name`),
    KEY `idx_type` (`type`),
    KEY `idx_is_active` (`is_active`),
    KEY `idx_permite_reserva` (`permite_reserva`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Puntos de acceso y áreas reservables';

-- -----------------------------------------------------------------------------
-- 4. PERSONAS (persons) - Residentes, propietarios, visitas (API persons + pets.owner)
-- -----------------------------------------------------------------------------
CREATE TABLE `persons` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `type_doc` VARCHAR(20) DEFAULT NULL,
    `doc_number` VARCHAR(15) NOT NULL,
    `first_name` VARCHAR(100) DEFAULT NULL,
    `paternal_surname` VARCHAR(50) DEFAULT NULL,
    `maternal_surname` VARCHAR(50) DEFAULT NULL,
    `gender` VARCHAR(10) DEFAULT NULL,
    `birth_date` DATE DEFAULT NULL,
    `cel_number` VARCHAR(15) DEFAULT NULL,
    `email` VARCHAR(100) DEFAULT NULL,
    `address` VARCHAR(255) DEFAULT NULL,
    `district` VARCHAR(50) DEFAULT NULL,
    `province` VARCHAR(50) DEFAULT NULL,
    `region` VARCHAR(50) DEFAULT NULL,
    `civil_status` VARCHAR(20) DEFAULT NULL,
    `status_validated` ENUM('PERMITIDO', 'OBSERVADO', 'DENEGADO') DEFAULT 'PERMITIDO',
    `status_reason` VARCHAR(255) DEFAULT NULL,
    `status_system` VARCHAR(50) DEFAULT NULL,
    `person_type` VARCHAR(50) DEFAULT NULL COMMENT 'PROPIETARIO, RESIDENTE, INQUILINO, INVITADO (sin login)',
    `house_id` INT UNSIGNED DEFAULT NULL,
    `photo_url` VARCHAR(255) DEFAULT NULL,
    `origin_list` VARCHAR(255) DEFAULT NULL,
    `motivo` VARCHAR(255) DEFAULT NULL,
    `puerta_list` VARCHAR(255) DEFAULT NULL COMMENT 'Puntos de acceso (garita, piscina, etc.)',
    `fecha_list` VARCHAR(255) DEFAULT NULL,
    `fecha_registro` DATETIME DEFAULT NULL,
    `puerta_registro` VARCHAR(50) DEFAULT NULL COMMENT 'Puerta/punto de registro',
    `condicion` VARCHAR(100) DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_doc` (`doc_number`),
    KEY `idx_house` (`house_id`),
    KEY `idx_status` (`status_validated`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Personas (residentes, propietarios, visitas)';

-- -----------------------------------------------------------------------------
-- 4.1. HOUSE MEMBERS (house_members) - Fuente de verdad pertenencia persona-casa
-- -----------------------------------------------------------------------------
CREATE TABLE `house_members` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `house_id` INT UNSIGNED NOT NULL,
    `person_id` INT UNSIGNED NOT NULL,
    `relation_type` VARCHAR(50) NOT NULL DEFAULT 'RESIDENTE' COMMENT 'PROPIETARIO|RESIDENTE|INQUILINO|FAMILIAR|APODERADO|etc',
    `is_active` TINYINT(1) NOT NULL DEFAULT 1,
    `is_primary` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1=contacto principal de la casa',
    `start_date` DATE DEFAULT NULL,
    `end_date` DATE DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_house_person` (`house_id`, `person_id`),
    KEY `idx_house_id` (`house_id`),
    KEY `idx_person_id` (`person_id`),
    KEY `idx_is_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Pertenencia persona-casa. Fuente de verdad para Mi Casa y permisos house-centric.';

-- -----------------------------------------------------------------------------
-- 5. VEHÍCULOS (vehicles)
-- -----------------------------------------------------------------------------
CREATE TABLE `vehicles` (
    `vehicle_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `license_plate` VARCHAR(15) NULL DEFAULT NULL,
    `type_vehicle` VARCHAR(15) DEFAULT NULL,
    `house_id` INT UNSIGNED DEFAULT NULL,
    `owner_id` INT UNSIGNED DEFAULT NULL,
    `status_validated` VARCHAR(50) DEFAULT NULL,
    `status_reason` VARCHAR(255) DEFAULT NULL,
    `status_system` VARCHAR(50) DEFAULT NULL,
    `category_entry` VARCHAR(50) DEFAULT NULL,
    `color` VARCHAR(15) DEFAULT NULL,
    `brand` VARCHAR(15) DEFAULT NULL,
    `model` VARCHAR(15) DEFAULT NULL,
    `year` VARCHAR(15) DEFAULT NULL,
    `photo_url` VARCHAR(255) DEFAULT NULL,
    `created_by_user_id` INT UNSIGNED DEFAULT NULL,
    `updated_by_user_id` INT UNSIGNED DEFAULT NULL,
    PRIMARY KEY (`vehicle_id`),
    UNIQUE KEY `uk_plate` (`license_plate`),
    KEY `idx_house` (`house_id`),
    KEY `idx_created_by_user` (`created_by_user_id`),
    KEY `idx_updated_by_user` (`updated_by_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Vehículos registrados';

-- -----------------------------------------------------------------------------
-- 6. VISITAS EXTERNAS / TEMPORALES (temporary_visits: vehículo o persona)
-- -----------------------------------------------------------------------------
CREATE TABLE `temporary_visits` (
    `temp_visit_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `registered_by_user_id` INT UNSIGNED NULL DEFAULT NULL COMMENT 'Primer registrante (legado)',
    `temp_visit_name` VARCHAR(100) DEFAULT NULL,
    `temp_visit_doc` VARCHAR(15) DEFAULT NULL,
    `temp_visit_plate` VARCHAR(15) DEFAULT NULL,
    `temp_visit_cel` VARCHAR(15) DEFAULT NULL,
    `temp_visit_type` VARCHAR(15) NOT NULL,
    `status_validated` VARCHAR(50) DEFAULT NULL,
    `status_reason` VARCHAR(255) DEFAULT NULL,
    `status_system` VARCHAR(50) DEFAULT NULL,
    `photo_url` VARCHAR(255) DEFAULT NULL,
    `operator_notes` TEXT DEFAULT NULL,
    `created_by_user_id` INT UNSIGNED NULL DEFAULT NULL,
    `updated_by_user_id` INT UNSIGNED NULL DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`temp_visit_id`),
    KEY `idx_temporary_visits_registered_by` (`registered_by_user_id`),
    KEY `idx_temp_visit_plate` (`temp_visit_plate`),
    KEY `idx_temp_visit_doc` (`temp_visit_doc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Catálogo global visitas externas (taxi, delivery, etc.)';

-- -----------------------------------------------------------------------------
-- 6b. ASIGNACIONES VISITAS EXTERNAS (casa + timer)
-- -----------------------------------------------------------------------------
CREATE TABLE `temporary_visit_assignments` (
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

-- -----------------------------------------------------------------------------
-- 7. REGISTROS DE ACCESO (access_logs) - Formato API (access_point_id, person_id, type)
-- -----------------------------------------------------------------------------
CREATE TABLE `access_logs` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `access_point_id` INT UNSIGNED NOT NULL,
    `person_id` INT UNSIGNED DEFAULT NULL COMMENT 'Persona/residente',
    `doc_number` VARCHAR(20) DEFAULT NULL COMMENT 'Si no hay person_id',
    `vehicle_id` INT UNSIGNED DEFAULT NULL,
    `type` ENUM('INGRESO', 'EGRESO') NOT NULL DEFAULT 'INGRESO',
    `observation` TEXT DEFAULT NULL,
    `created_by_user_id` INT UNSIGNED DEFAULT NULL COMMENT 'user_id del guardia/operario que registró',
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_access_point` (`access_point_id`),
    KEY `idx_person` (`person_id`),
    KEY `idx_doc_number` (`doc_number`),
    KEY `idx_vehicle` (`vehicle_id`),
    KEY `idx_type` (`type`),
    KEY `idx_created_at` (`created_at`),
    KEY `idx_created_by_user` (`created_by_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Registro de ingresos/egresos';

-- -----------------------------------------------------------------------------
-- 8. REGISTROS DE ACCESO TEMPORAL (temporary_access_logs)
-- -----------------------------------------------------------------------------
CREATE TABLE `temporary_access_logs` (
    `temp_access_log_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `temp_visit_id` INT UNSIGNED DEFAULT NULL,
    `assignment_id` INT UNSIGNED DEFAULT NULL,
    `assignment_valid_until` DATETIME DEFAULT NULL COMMENT 'Hasta cuando podía entrar (snapshot)',
    `authorized_duration_minutes` SMALLINT UNSIGNED DEFAULT NULL COMMENT 'Minutos estadía autorizados (del vecino)',
    `stay_deadline` DATETIME DEFAULT NULL COMMENT 'temp_entry_time + authorized_duration_minutes',
    `temp_entry_time` DATETIME NOT NULL,
    `temp_exit_time` DATETIME DEFAULT NULL,
    `access_point_id` INT UNSIGNED NOT NULL,
    `status_validated` VARCHAR(50) DEFAULT NULL,
    `house_id` INT UNSIGNED DEFAULT NULL,
    `operario_id` INT UNSIGNED DEFAULT NULL,
    `created_by_user_id` INT UNSIGNED DEFAULT NULL COMMENT 'user_id quien registró (reemplazo conceptual de operario_id)',
    PRIMARY KEY (`temp_access_log_id`),
    KEY `idx_temp_visit` (`temp_visit_id`),
    KEY `idx_tal_assignment` (`assignment_id`),
    KEY `idx_tal_entry_time` (`temp_entry_time`),
    KEY `idx_tal_open_session` (`temp_visit_id`, `house_id`, `temp_exit_time`),
    KEY `idx_tal_stay_deadline` (`stay_deadline`),
    KEY `idx_access_point` (`access_point_id`),
    KEY `idx_house` (`house_id`),
    KEY `idx_operario` (`operario_id`),
    KEY `idx_created_by_user` (`created_by_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 8b. INCIDENCIAS DE ACCESO (access_incidents)
-- -----------------------------------------------------------------------------
CREATE TABLE `access_incidents` (
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

-- -----------------------------------------------------------------------------
-- 9. MASCOTAS (pets)
-- -----------------------------------------------------------------------------
CREATE TABLE `pets` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `species` ENUM('PERRO', 'GATO', 'AVE', 'PEQUEÑO MAMÍFERO', 'ACUÁTICO', 'EXÓTICO', 'OTRO') NOT NULL,
    `breed` VARCHAR(100) DEFAULT '',
    `color` VARCHAR(50) DEFAULT '',
    `age_years` TINYINT UNSIGNED DEFAULT NULL COMMENT 'Edad en años (opcional)',
    `house_id` INT UNSIGNED NOT NULL COMMENT 'Casa a la que pertenece (gestión por casa)',
    `owner_id` INT UNSIGNED DEFAULT NULL COMMENT 'persons.id - dueño opcional',
    `photo_url` VARCHAR(255) DEFAULT NULL,
    `status_validated` ENUM('PERMITIDO', 'OBSERVADO', 'DENEGADO') DEFAULT 'PERMITIDO',
    `status_reason` VARCHAR(255) DEFAULT NULL,
    `microchip_id` VARCHAR(50) DEFAULT NULL,
    `created_by_user_id` INT UNSIGNED DEFAULT NULL,
    `updated_by_user_id` INT UNSIGNED DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_house` (`house_id`),
    KEY `idx_owner` (`owner_id`),
    KEY `idx_status` (`status_validated`),
    KEY `idx_species` (`species`),
    KEY `idx_created_by_user` (`created_by_user_id`),
    KEY `idx_updated_by_user` (`updated_by_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Mascotas registradas';

-- -----------------------------------------------------------------------------
-- 10. RESERVACIONES (reservations)
-- -----------------------------------------------------------------------------
CREATE TABLE `reservations` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `access_point_id` INT UNSIGNED NOT NULL COMMENT 'Área (Casa Club, Piscina)',
    `person_id` INT UNSIGNED DEFAULT NULL COMMENT 'Responsable',
    `house_id` INT UNSIGNED NOT NULL,
    `reservation_date` DATETIME NOT NULL,
    `end_date` DATETIME DEFAULT NULL,
    `status` ENUM('PENDIENTE', 'CONFIRMADA', 'CANCELADA', 'COMPLETADA') NOT NULL DEFAULT 'PENDIENTE',
    `observation` TEXT DEFAULT NULL,
    `num_guests` INT UNSIGNED NOT NULL DEFAULT 1,
    `contact_phone` VARCHAR(20) DEFAULT NULL,
    `created_by_user_id` INT UNSIGNED DEFAULT NULL COMMENT 'user_id quien creó la reserva',
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_access_point` (`access_point_id`),
    KEY `idx_person` (`person_id`),
    KEY `idx_house` (`house_id`),
    KEY `idx_status` (`status`),
    KEY `idx_reservation_date` (`reservation_date`),
    KEY `idx_created_by_user` (`created_by_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Reservaciones de áreas comunes';

-- -----------------------------------------------------------------------------
-- 11. COMUNICADOS (announcements)
-- -----------------------------------------------------------------------------
CREATE TABLE `announcements` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(180) NOT NULL,
    `message` TEXT NOT NULL,
    `start_at` DATETIME DEFAULT NULL,
    `end_at` DATETIME DEFAULT NULL,
    `cta_label` VARCHAR(80) DEFAULT NULL,
    `cta_url` VARCHAR(500) DEFAULT NULL,
    `image_url` VARCHAR(600) DEFAULT NULL,
    `is_active` TINYINT(1) NOT NULL DEFAULT 1,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_active` (`is_active`),
    KEY `idx_start_at` (`start_at`),
    KEY `idx_end_at` (`end_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Comunicados visibles para usuarios autenticados';

-- -----------------------------------------------------------------------------
-- 12. ENCUESTAS (surveys)
-- -----------------------------------------------------------------------------
CREATE TABLE `surveys` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(180) NOT NULL,
    `description` TEXT DEFAULT NULL,
    `question_type` ENUM('CLOSED','OPEN','MULTIPLE','CHECKBOX') NOT NULL DEFAULT 'CLOSED',
    `options_json` TEXT DEFAULT NULL,
    `is_active` TINYINT(1) NOT NULL DEFAULT 1,
    `start_at` DATETIME DEFAULT NULL,
    `end_at` DATETIME DEFAULT NULL,
    `created_by_user_id` INT UNSIGNED DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_surveys_active` (`is_active`),
    KEY `idx_surveys_start` (`start_at`),
    KEY `idx_surveys_end` (`end_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Encuestas para usuarios autenticados';

CREATE TABLE `survey_responses` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `survey_id` INT UNSIGNED NOT NULL,
    `user_id` INT UNSIGNED NOT NULL,
    `answer_text` TEXT DEFAULT NULL,
    `answer_option` VARCHAR(255) DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_survey_user` (`survey_id`, `user_id`),
    KEY `idx_survey_responses_survey` (`survey_id`),
    KEY `idx_survey_responses_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Respuestas por usuario a cada encuesta';

-- =============================================================================
-- CLAVES FORÁNEAS
-- =============================================================================
-- users -> houses, persons
ALTER TABLE `users`
    ADD CONSTRAINT `fk_users_house` FOREIGN KEY (`house_id`) REFERENCES `houses` (`house_id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_users_person` FOREIGN KEY (`person_id`) REFERENCES `persons` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- persons -> houses
ALTER TABLE `persons`
    ADD CONSTRAINT `fk_persons_house` FOREIGN KEY (`house_id`) REFERENCES `houses` (`house_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- house_members -> houses, persons
ALTER TABLE `house_members`
    ADD CONSTRAINT `fk_house_members_house` FOREIGN KEY (`house_id`) REFERENCES `houses` (`house_id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_house_members_person` FOREIGN KEY (`person_id`) REFERENCES `persons` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- temporary_visits -> users
ALTER TABLE `temporary_visits`
    ADD CONSTRAINT `fk_temporary_visits_registered_by` FOREIGN KEY (`registered_by_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_temp_visits_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_temp_visits_updated_by` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- temporary_visit_assignments -> temporary_visits, houses, users
ALTER TABLE `temporary_visit_assignments`
    ADD CONSTRAINT `fk_tva_temp_visit` FOREIGN KEY (`temp_visit_id`) REFERENCES `temporary_visits` (`temp_visit_id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_tva_house` FOREIGN KEY (`house_id`) REFERENCES `houses` (`house_id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_tva_registered_by` FOREIGN KEY (`registered_by_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- vehicles -> houses, users
ALTER TABLE `vehicles`
    ADD CONSTRAINT `fk_vehicles_house` FOREIGN KEY (`house_id`) REFERENCES `houses` (`house_id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_vehicles_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_vehicles_updated_by` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- access_logs -> access_points(id), persons(id), vehicles(vehicle_id), users(created_by)
ALTER TABLE `access_logs`
    ADD CONSTRAINT `fk_access_logs_ap` FOREIGN KEY (`access_point_id`) REFERENCES `access_points` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_access_logs_person` FOREIGN KEY (`person_id`) REFERENCES `persons` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_access_logs_vehicle` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles` (`vehicle_id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_access_logs_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- temporary_access_logs -> users
ALTER TABLE `temporary_access_logs`
    ADD CONSTRAINT `fk_temp_access_logs_ap` FOREIGN KEY (`access_point_id`) REFERENCES `access_points` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_temp_access_logs_temp_visit` FOREIGN KEY (`temp_visit_id`) REFERENCES `temporary_visits` (`temp_visit_id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_temp_access_logs_assignment` FOREIGN KEY (`assignment_id`) REFERENCES `temporary_visit_assignments` (`assignment_id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_temp_access_logs_house` FOREIGN KEY (`house_id`) REFERENCES `houses` (`house_id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_temp_access_logs_operario` FOREIGN KEY (`operario_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_temp_access_logs_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- access_incidents -> logs, access_points, persons, vehicles, houses, users
ALTER TABLE `access_incidents`
    ADD CONSTRAINT `fk_ai_access_log` FOREIGN KEY (`access_log_id`) REFERENCES `access_logs` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_ai_temp_access_log` FOREIGN KEY (`temp_access_log_id`) REFERENCES `temporary_access_logs` (`temp_access_log_id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_ai_access_point` FOREIGN KEY (`access_point_id`) REFERENCES `access_points` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_ai_house` FOREIGN KEY (`house_id`) REFERENCES `houses` (`house_id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_ai_person` FOREIGN KEY (`person_id`) REFERENCES `persons` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_ai_vehicle` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles` (`vehicle_id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_ai_temp_visit` FOREIGN KEY (`temp_visit_id`) REFERENCES `temporary_visits` (`temp_visit_id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_ai_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- pets -> houses, persons (opcional), users
ALTER TABLE `pets`
    ADD CONSTRAINT `fk_pets_house` FOREIGN KEY (`house_id`) REFERENCES `houses` (`house_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_pets_owner` FOREIGN KEY (`owner_id`) REFERENCES `persons` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_pets_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_pets_updated_by` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- reservations -> users
ALTER TABLE `reservations`
    ADD CONSTRAINT `fk_reservations_ap` FOREIGN KEY (`access_point_id`) REFERENCES `access_points` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_reservations_person` FOREIGN KEY (`person_id`) REFERENCES `persons` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_reservations_house` FOREIGN KEY (`house_id`) REFERENCES `houses` (`house_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_reservations_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- surveys -> users
ALTER TABLE `surveys`
    ADD CONSTRAINT `fk_surveys_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- survey_responses -> surveys, users
ALTER TABLE `survey_responses`
    ADD CONSTRAINT `fk_survey_responses_survey` FOREIGN KEY (`survey_id`) REFERENCES `surveys` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_survey_responses_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- PERMISOS DE NAVEGACIÓN / MÓDULOS DE GESTIÓN
-- =============================================================================
CREATE TABLE IF NOT EXISTS `nav_modules` (
    `module_key` VARCHAR(50) NOT NULL,
    `label` VARCHAR(100) NOT NULL,
    `route` VARCHAR(100) NOT NULL,
    `section` VARCHAR(50) NOT NULL DEFAULT 'gestion' COMMENT 'gestion | admin',
    `sort_order` INT NOT NULL DEFAULT 0,
    `is_enabled` TINYINT(1) NOT NULL DEFAULT 1,
    PRIMARY KEY (`module_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `role_nav_permissions` (
    `role_system` VARCHAR(50) NOT NULL,
    `module_key` VARCHAR(50) NOT NULL,
    `can_view` TINYINT(1) NOT NULL DEFAULT 0,
    `can_manage` TINYINT(1) NOT NULL DEFAULT 0,
    PRIMARY KEY (`role_system`, `module_key`),
    KEY `idx_rnp_module` (`module_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- DATOS INICIALES (puntos de acceso para reservas y API)
-- =============================================================================
INSERT INTO `access_points` (`name`, `type`, `location`, `is_active`, `controla_aforo`, `permite_reserva`, `max_capacity`, `current_capacity`) VALUES
('Garita Principal', 'ENTRADA', 'Entrada principal del condominio', 1, 0, 0, NULL, NULL),
('Entrada Peatonal', 'ENTRADA', 'Puerta principal peatonal', 1, 0, 0, NULL, NULL),
('Piscina', 'AREA_COMUN', 'Área de piscina', 1, 1, 1, 50, 0),
('Casa Club', 'AREA_COMUN', 'Edificio de eventos', 1, 1, 1, 200, 0)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

INSERT INTO `nav_modules` (`module_key`, `label`, `route`, `section`, `sort_order`, `is_enabled`) VALUES
('users', 'Usuarios', '/users', 'gestion', 10, 1),
('houses', 'Viviendas', '/houses', 'gestion', 20, 1),
('vehicles', 'Vehículos', '/vehicles', 'gestion', 30, 1),
('pets', 'Mascotas', '/pets', 'gestion', 40, 1),
('announcements', 'Comunicados', '/announcements', 'gestion', 50, 1),
('surveys', 'Encuestas', '/surveys', 'gestion', 60, 1),
('access_points', 'Puntos de acceso', '/access-points', 'admin', 70, 1)
ON DUPLICATE KEY UPDATE `label` = VALUES(`label`);

INSERT INTO `role_nav_permissions` (`role_system`, `module_key`, `can_view`, `can_manage`) VALUES
('ADMINISTRADOR', 'users', 1, 1),
('ADMINISTRADOR', 'houses', 1, 1),
('ADMINISTRADOR', 'vehicles', 1, 1),
('ADMINISTRADOR', 'pets', 1, 1),
('ADMINISTRADOR', 'announcements', 1, 1),
('ADMINISTRADOR', 'surveys', 1, 1),
('ADMINISTRADOR', 'access_points', 1, 1),
('OPERARIO', 'users', 1, 0),
('OPERARIO', 'houses', 1, 0),
('OPERARIO', 'vehicles', 1, 0),
('OPERARIO', 'pets', 1, 0)
ON DUPLICATE KEY UPDATE `can_view` = VALUES(`can_view`), `can_manage` = VALUES(`can_manage`);

-- =============================================================================
-- EVENT LOGS (auditoría de acciones; retención 30 días vía EVENT)
-- =============================================================================
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

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- EVENT SCHEDULER: cierre diario reservas vencidas (08:02 hora Lima / TZ servidor)
-- Requiere mysqld con --event-scheduler=ON (ver docker-compose) y --default-time-zone=America/Lima.
-- =============================================================================
SET GLOBAL event_scheduler = ON;

DROP EVENT IF EXISTS ev_vc_complete_expired_reservations;

CREATE EVENT ev_vc_complete_expired_reservations
ON SCHEDULE EVERY 1 DAY
STARTS (TIMESTAMP(CURDATE()) + INTERVAL 8 HOUR + INTERVAL 2 MINUTE)
ON COMPLETION PRESERVE
ENABLE
COMMENT 'CONFIRMADA->COMPLETADA si end_date<NOW(); diario 08:02 (America/Lima vía --default-time-zone)'
DO
  UPDATE reservations
  SET status = 'COMPLETADA'
  WHERE status = 'CONFIRMADA'
    AND end_date IS NOT NULL
    AND end_date < NOW();

DROP EVENT IF EXISTS ev_vc_purge_event_logs;

CREATE EVENT ev_vc_purge_event_logs
ON SCHEDULE EVERY 1 DAY
STARTS (TIMESTAMP(CURDATE()) + INTERVAL 3 HOUR)
ON COMPLETION PRESERVE
ENABLE
COMMENT 'Elimina event_logs con más de 30 días'
DO
  DELETE FROM event_logs WHERE occurred_at < NOW() - INTERVAL 30 DAY;
