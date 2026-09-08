-- Campos derivados de OCR en fotos de detalle (DNI / placa). No pisan doc_number ni license_plate oficiales.
ALTER TABLE access_logs
  ADD COLUMN photo_doc_number VARCHAR(20) DEFAULT NULL COMMENT 'DNI detectado en foto de garita' AFTER photo_urls,
  ADD COLUMN photo_license_plate VARCHAR(15) DEFAULT NULL COMMENT 'Placa detectada en foto de garita' AFTER photo_doc_number,
  ADD COLUMN photo_ocr_status VARCHAR(16) DEFAULT NULL COMMENT 'pending|done|empty|error' AFTER photo_license_plate;

ALTER TABLE temporary_access_logs
  ADD COLUMN photo_doc_number VARCHAR(20) DEFAULT NULL COMMENT 'DNI detectado en foto de garita' AFTER photo_urls,
  ADD COLUMN photo_license_plate VARCHAR(15) DEFAULT NULL COMMENT 'Placa detectada en foto de garita' AFTER photo_doc_number,
  ADD COLUMN photo_ocr_status VARCHAR(16) DEFAULT NULL COMMENT 'pending|done|empty|error' AFTER photo_license_plate;
