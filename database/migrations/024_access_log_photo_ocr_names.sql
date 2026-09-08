-- Nombres/apellidos detectados en foto de detalle (carné, licencia, DNI, etc.).
ALTER TABLE access_logs
  ADD COLUMN photo_first_names VARCHAR(120) DEFAULT NULL COMMENT 'Nombres detectados en foto' AFTER photo_license_plate,
  ADD COLUMN photo_last_names VARCHAR(120) DEFAULT NULL COMMENT 'Apellidos detectados en foto' AFTER photo_first_names;

ALTER TABLE temporary_access_logs
  ADD COLUMN photo_first_names VARCHAR(120) DEFAULT NULL COMMENT 'Nombres detectados en foto' AFTER photo_license_plate,
  ADD COLUMN photo_last_names VARCHAR(120) DEFAULT NULL COMMENT 'Apellidos detectados en foto' AFTER photo_first_names;
