-- Flag de capacidad: punto usable en escáner / registro de acceso (espejo de permite_reserva).
-- Por defecto 0; se habilita en entradas conocidas (type ENTRADA).

ALTER TABLE `access_points`
  ADD COLUMN `permite_registro` TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1=usable en escáner / registro de acceso'
    AFTER `permite_reserva`,
  ADD KEY `idx_permite_registro` (`permite_registro`);

UPDATE `access_points`
SET `permite_registro` = 1
WHERE `type` = 'ENTRADA';
