/**
 * Modelo de Reservación para VC-INGRESO
 */
export interface Reservation {
  id?: number;
  access_point_id: number;
  person_id?: number;
  house_id?: number;
  /** Día lógico YYYY-MM-DD (servidor deriva ventana según modo del área). */
  reservation_day?: string;
  /** Franja: HH:MM (solo FRANJA_HORARIA). */
  start_time?: string;
  end_time?: string;
  reservation_date: string;
  end_date?: string;
  status: 'PENDIENTE' | 'CONFIRMADA' | 'CANCELADA' | 'RECHAZADA' | 'COMPLETADA';
  observation?: string;
  num_guests?: number;
  contact_phone?: string;
  created_by_user_id?: number;
  created_at?: string;
  updated_at?: string;
  // Joined fields
  area_name?: string;
  area_type?: string;
  /** Solo en feed de calendario para casas ajenas (payload mínimo). */
  house_label?: string;
}

/**
 * Estados de reservación
 */
export const RESERVATION_STATUS = [
  { value: 'PENDIENTE', label: 'Pendiente', color: 'warn' },
  { value: 'CONFIRMADA', label: 'Confirmada', color: 'primary' },
  { value: 'CANCELADA', label: 'Cancelada', color: 'accent' },
  { value: 'RECHAZADA', label: 'Rechazada', color: 'warn' },
  { value: 'COMPLETADA', label: 'Completada', color: 'basic' }
];

/**
 * Tipo lógico de punto de acceso (catálogo access_points)
 */
export const AREA_TYPES = [
  { value: 'ENTRADA', label: 'Entrada' },
  { value: 'AREA_COMUN', label: 'Área común' },
  { value: 'AREA_LIMITADA', label: 'Área limitada' }
];

/**
 * Horario disponible (legacy; el API puede devolver solo día libre/ocupado).
 */
export interface TimeSlot {
  start: string;
  end: string;
  available: boolean;
}

/** Un día festivo para el calendario (GET /reservations/holidays). */
export interface HolidayEntry {
  date: string;
  summary: string;
}

/** Respuesta de GET /reservations/availability (día lógico 8–8). */
export interface ReservationDayAvailability {
  date: string;
  access_point_id: number;
  available: boolean;
  logical_window_start?: string;
  logical_window_end?: string;
}
