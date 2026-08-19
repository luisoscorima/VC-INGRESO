-- Notas libres del operario en garita (separadas de observation automática).
ALTER TABLE access_logs ADD COLUMN operator_notes TEXT DEFAULT NULL;
ALTER TABLE temporary_access_logs ADD COLUMN operator_notes TEXT DEFAULT NULL;
