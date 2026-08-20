-- Enlace intento denegado → ingreso efectivo autorizado por operario
ALTER TABLE access_logs
  ADD COLUMN authorized_log_id INT UNSIGNED DEFAULT NULL COMMENT 'Ingreso efectivo creado desde este intento';

ALTER TABLE temporary_access_logs
  ADD COLUMN authorized_log_id INT UNSIGNED DEFAULT NULL COMMENT 'Ingreso efectivo creado desde este intento';
