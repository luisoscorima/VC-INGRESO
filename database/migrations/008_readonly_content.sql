-- Contenido readonly (tutoriales, documentos, contactos) en BD.
-- Archivos subidos siguen en uploads/public/readonly-docs/.
-- Ejecutar en prod:
--   docker exec -i vc-ingreso-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" vc_db' \
--     < database/migrations/008_readonly_content.sql
--
-- Sin seed aquí: si las tablas quedan vacías, la API importa una vez desde
-- storage/readonly_data.json (volumen o imagen) al primer GET/PUT.

CREATE TABLE IF NOT EXISTS `readonly_settings` (
    `id` TINYINT UNSIGNED NOT NULL,
    `authorization_url` VARCHAR(600) NOT NULL DEFAULT '',
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Ajustes globales de contenido readonly (fila id=1)';

CREATE TABLE IF NOT EXISTS `readonly_documents` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(180) NOT NULL,
    `url` VARCHAR(600) NOT NULL,
    `description` VARCHAR(500) DEFAULT NULL,
    `doc_date` DATE DEFAULT NULL,
    `sort_order` INT NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_readonly_docs_sort` (`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Metadatos de documentos de solo lectura';

CREATE TABLE IF NOT EXISTS `tutorial_topics` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(180) NOT NULL,
    `description` TEXT DEFAULT NULL,
    `sort_order` INT NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_tutorial_topics_sort` (`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Temas de tutoriales (YouTube)';

CREATE TABLE IF NOT EXISTS `tutorial_videos` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `topic_id` INT UNSIGNED NOT NULL,
    `title` VARCHAR(180) NOT NULL,
    `youtube_id` VARCHAR(64) NOT NULL,
    `sort_order` INT NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_tutorial_videos_topic` (`topic_id`),
    KEY `idx_tutorial_videos_sort` (`sort_order`),
    CONSTRAINT `fk_tutorial_videos_topic`
        FOREIGN KEY (`topic_id`) REFERENCES `tutorial_topics` (`id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Videos de tutoriales por tema';

CREATE TABLE IF NOT EXISTS `emergency_contacts` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `label` VARCHAR(180) NOT NULL,
    `phone` VARCHAR(40) NOT NULL DEFAULT '',
    `detail` VARCHAR(500) DEFAULT NULL,
    `sort_order` INT NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_emergency_contacts_sort` (`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Contactos de emergencia';
