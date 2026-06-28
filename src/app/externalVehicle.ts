
export class ExternalVehicle {
  constructor(
    public temp_visit_name: string,
    public temp_visit_doc: string,
    public temp_visit_plate: string,
    public temp_visit_cel: string,
    public temp_visit_type: string,
    public status_validated: string,
    public status_reason: string,
    public status_system: string,
    public temp_visit_id?: number,
    /** Usuario que registró la visita (API: registered_by_user_id). */
    public registered_by_user_id?: number,
    /** Alias para PUT /api/v1/external-visits/:id (mismo valor que temp_visit_id). */
    public id?: number,
    /** Asignación activa (Mi casa). */
    public assignment_id?: number,
    public house_id?: number,
    public valid_from?: string,
    public valid_until?: string,
    public assignment_status?: string,
    public minutes_remaining?: number,
    /** Minutos elegidos al registrar (POST). */
    public duration_minutes?: number,
    public photo_url?: string,
    public operator_notes?: string,
  ) { }

}

export const EXTERNAL_VISIT_DURATION_OPTIONS = [
  { label: '30 minutos', value: 30 },
  { label: '1 hora', value: 60 },
  { label: '2 horas', value: 120 },
  { label: '4 horas', value: 240 },
] as const;

export interface ExternalVisitAssignmentOption {
  assignment_id: number;
  house_id: number;
  house_label: string;
  block_house?: string | null;
  lot?: number | string | null;
  apartment?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  minutes_remaining?: number | null;
}
