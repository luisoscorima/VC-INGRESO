-- Varias fotos por incidencia (JSON). photo_url sigue siendo la primera (compat).
-- Ejecutar sobre BD existente vc_db

USE vc_db;

ALTER TABLE `access_incidents`
    ADD COLUMN `photo_urls` JSON DEFAULT NULL COMMENT 'Array de rutas/URLs de fotos' AFTER `photo_url`;

-- Backfill: si hay foto única, copiarla al array
UPDATE `access_incidents`
SET `photo_urls` = JSON_ARRAY(`photo_url`)
WHERE `photo_url` IS NOT NULL
  AND TRIM(`photo_url`) <> ''
  AND (`photo_urls` IS NULL OR JSON_LENGTH(`photo_urls`) = 0);
