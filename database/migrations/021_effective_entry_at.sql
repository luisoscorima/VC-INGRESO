-- Hora de ingreso efectivo en el mismo registro (DENEGADO + autorizado por propietario).
ALTER TABLE access_logs
  ADD COLUMN effective_entry_at DATETIME DEFAULT NULL;

ALTER TABLE temporary_access_logs
  ADD COLUMN effective_entry_at DATETIME DEFAULT NULL;
