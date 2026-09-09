-- Modo de reserva por punto + tope de solapes (0 = sin tope).
-- Casa Club: día completo exclusivo. Piscina/Grass: franja; piscina sin tope, grass exclusivo.

ALTER TABLE `access_points`
  ADD COLUMN `modo_reserva` ENUM('DIA_COMPLETO', 'FRANJA_HORARIA') NOT NULL DEFAULT 'DIA_COMPLETO'
    COMMENT 'Solo aplica si permite_reserva=1'
    AFTER `permite_registro`,
  ADD COLUMN `max_reservas_simultaneas` INT UNSIGNED NOT NULL DEFAULT 1
    COMMENT '0=sin tope de solapes; 1=exclusivo; N=hasta N solapadas'
    AFTER `modo_reserva`,
  ADD COLUMN `hora_apertura` TIME DEFAULT NULL
    COMMENT 'Inicio permitido (FRANJA); NULL=08:00'
    AFTER `max_reservas_simultaneas`,
  ADD COLUMN `hora_cierre` TIME DEFAULT NULL
    COMMENT 'Fin permitido (FRANJA); NULL=22:00'
    AFTER `hora_apertura`;

UPDATE `access_points`
SET
  `modo_reserva` = 'DIA_COMPLETO',
  `max_reservas_simultaneas` = 1,
  `hora_apertura` = NULL,
  `hora_cierre` = NULL
WHERE `name` LIKE '%Casa Club%';

UPDATE `access_points`
SET
  `modo_reserva` = 'FRANJA_HORARIA',
  `max_reservas_simultaneas` = 0,
  `hora_apertura` = '08:00:00',
  `hora_cierre` = '20:00:00'
WHERE `name` LIKE '%Piscina%';

UPDATE `access_points`
SET
  `modo_reserva` = 'FRANJA_HORARIA',
  `max_reservas_simultaneas` = 1,
  `hora_apertura` = '08:00:00',
  `hora_cierre` = '22:00:00'
WHERE `name` LIKE '%Grass%';
