<?php
/**
 * Reglas de negocio — reservas de áreas comunes.
 *
 * Modificar SOLO estos valores si cambia la política GLOBAL del condominio.
 * El modo (día completo vs franja) y los solapes se configuran por access_point.
 */

/** Máximo de reservas “activas” (PENDIENTE + CONFIRMADA) por casa y por mes calendario (según reservation_date). */
const RESERVATION_MAX_ACTIVE_PER_MONTH_PER_HOUSE = 5;

/**
 * Hora de inicio del “día lógico” para modo DIA_COMPLETO: desde este momento del día D
 * hasta la misma hora del día D+1 (entrega del ambiente).
 */
const RESERVATION_DAY_START_HOUR = 8;
