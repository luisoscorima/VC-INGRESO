-- Varias fotos por evento de acceso (garita). photo_url sigue siendo la primera (compat).
ALTER TABLE access_logs
  ADD COLUMN photo_urls JSON DEFAULT NULL COMMENT 'Array de rutas/URLs de fotos garita' AFTER photo_url;

ALTER TABLE temporary_access_logs
  ADD COLUMN photo_urls JSON DEFAULT NULL COMMENT 'Array de rutas/URLs de fotos garita' AFTER photo_url;

UPDATE access_logs
SET photo_urls = JSON_ARRAY(photo_url)
WHERE photo_url IS NOT NULL
  AND TRIM(photo_url) <> ''
  AND (photo_urls IS NULL OR JSON_LENGTH(photo_urls) = 0);

UPDATE temporary_access_logs
SET photo_urls = JSON_ARRAY(photo_url)
WHERE photo_url IS NOT NULL
  AND TRIM(photo_url) <> ''
  AND (photo_urls IS NULL OR JSON_LENGTH(photo_urls) = 0);
