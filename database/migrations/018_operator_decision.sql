-- Decisión humana del operario (independiente del resultado del scan).
ALTER TABLE access_logs
  ADD COLUMN operator_decision ENUM(
    'CONSULTADO_PROPIETARIO',
    'AUTORIZADO_POR_PROPIETARIO',
    'RECHAZO_CONFIRMADO',
    'SIN_DOMICILIO'
  ) DEFAULT NULL;

ALTER TABLE temporary_access_logs
  ADD COLUMN operator_decision ENUM(
    'CONSULTADO_PROPIETARIO',
    'AUTORIZADO_POR_PROPIETARIO',
    'RECHAZO_CONFIRMADO',
    'SIN_DOMICILIO'
  ) DEFAULT NULL;
