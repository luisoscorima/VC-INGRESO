
import { IdentityDocumentType } from './shared/identity-document';

export class ExternalVehicle {
  public temp_visit_doc_type: IdentityDocumentType = 'DNI';

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
    public temp_visit_company?: string,
    public photo_url?: string,
    /** Hasta EXTERNAL_VISIT_MAX_PHOTOS rutas/URLs. */
    public photo_urls?: string[],
    public operator_notes?: string,
    /** Convocatorias (GET catálogo staff). */
    public assignments?: ExternalVisitCatalogAssignment[],
  ) { }

}

export const EXTERNAL_VISIT_MAX_PHOTOS = 5;

export function normalizeExternalVisitPhotoUrls(
  ev: Pick<ExternalVehicle, 'photo_url' | 'photo_urls'> | null | undefined
): string[] {
  const urls: string[] = [];
  if (Array.isArray(ev?.photo_urls)) {
    for (const u of ev!.photo_urls!) {
      const t = String(u ?? '').trim();
      if (t) {
        urls.push(t);
      }
    }
  }
  const single = String(ev?.photo_url ?? '').trim();
  if (single && !urls.includes(single)) {
    urls.unshift(single);
  }
  return urls.slice(0, EXTERNAL_VISIT_MAX_PHOTOS);
}

export function syncExternalVisitPhotoFields(ev: ExternalVehicle): void {
  const urls = normalizeExternalVisitPhotoUrls(ev);
  ev.photo_urls = urls;
  ev.photo_url = urls[0];
}

export const EXTERNAL_VISIT_DURATION_OPTIONS = [
  { label: '30 minutos', value: 30 },
  { label: '1 hora', value: 60 },
  { label: '2 horas', value: 120 },
  { label: '4 horas', value: 240 },
] as const;

export const EXTERNAL_VISIT_TYPE_VALUES = [
  'DELIVERY',
  'COLECTIVO',
  'TAXI',
  'MOTOTAXI',
  'MOTORIZADO',
] as const;

export type ExternalVisitType = (typeof EXTERNAL_VISIT_TYPE_VALUES)[number];

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

/** Asignación anidada en el padrón staff (GET /external-visits). */
export interface ExternalVisitCatalogAssignment {
  assignment_id: number;
  house_id: number;
  house_label: string;
  block_house?: string | null;
  lot?: number | string | null;
  apartment?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  status?: string | null;
  registered_by_user_id?: number | null;
  registered_by_label?: string | null;
  minutes_remaining?: number | null;
  is_active?: boolean;
}
