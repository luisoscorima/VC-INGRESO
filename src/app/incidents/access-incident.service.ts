import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from '../api.service';

export type IncidentSource = 'scan' | 'manual';

export interface AccessIncidentAccessContext {
  log_type: 'resident' | 'temporary';
  entry_time?: string | null;
  movement_type?: string | null;
  status_validated?: string | null;
  access_point_name?: string | null;
  name?: string | null;
  doc_number?: string | null;
  license_plate?: string | null;
  house_address?: string | null;
  observation?: string | null;
}

export interface AccessIncident {
  incident_id: number;
  source: IncidentSource;
  access_log_id?: number | null;
  temp_access_log_id?: number | null;
  access_point_id: number;
  access_point_name?: string;
  house_id?: number | null;
  house_address?: string | null;
  person_id?: number | null;
  vehicle_id?: number | null;
  temp_visit_id?: number | null;
  doc_number?: string | null;
  license_plate?: string | null;
  status_validated?: string | null;
  description: string;
  photo_url?: string | null;
  /** Todas las fotos (incluye la de photo_url como primera). */
  photo_urls?: string[] | null;
  created_by_user_id?: number | null;
  created_by_username?: string;
  created_at?: string | null;
  has_access_context?: boolean;
  access_context?: AccessIncidentAccessContext | null;
}

export interface IncidentScanContext {
  access_log_id?: number | null;
  temp_access_log_id?: number | null;
  person_id?: number | null;
  vehicle_id?: number | null;
  temp_visit_id?: number | null;
  house_id?: number | null;
  doc_number?: string | null;
  license_plate?: string | null;
  status_validated?: string | null;
}

export interface IncidentFormDialogData {
  mode: IncidentSource;
  accessPointId?: number | null;
  lockAccessPoint?: boolean;
  scanContext?: IncidentScanContext;
}

const HISTORY_RESULT_STATUSES = ['PERMITIDO', 'DENEGADO', 'RESTRINGIDO', 'OBSERVADO'] as const;

function parseStatusFromHistoryRow(row: Record<string, unknown>): string | null {
  const observation = String(row['observation_raw'] ?? row['obs'] ?? '').toUpperCase();
  const found = HISTORY_RESULT_STATUSES.find((candidate) =>
    new RegExp(`(^|\\|)\\s*${candidate}\\b`).test(observation)
  );
  if (found) {
    return found;
  }
  const obs = String(row['obs'] ?? '').trim();
  if (obs && obs !== '—') {
    return obs.split('|')[0]?.trim() || null;
  }
  return null;
}

/** Construye contexto de incidencia desde una fila del historial unificado. */
export function buildScanContextFromHistoryRow(row: Record<string, unknown>): IncidentScanContext {
  const logRef = Number(row['id'] ?? 0);
  const plate = String(row['license_plate_snapshot'] ?? row['vehicle_plate'] ?? '').trim();
  const ctx: IncidentScanContext = {
    doc_number: String(row['doc_number'] ?? row['document_snapshot'] ?? '').trim() || null,
    license_plate: plate && plate !== '—' ? plate.toUpperCase() : null,
    status_validated: parseStatusFromHistoryRow(row),
    house_id: Number(row['house_id'] ?? 0) > 0 ? Number(row['house_id']) : null,
    person_id: Number(row['person_id'] ?? 0) > 0 ? Number(row['person_id']) : null,
    vehicle_id: Number(row['vehicle_id'] ?? 0) > 0 ? Number(row['vehicle_id']) : null,
    temp_visit_id: Number(row['temp_visit_id'] ?? 0) > 0 ? Number(row['temp_visit_id']) : null,
  };
  if (logRef > 0) {
    ctx.access_log_id = logRef;
  } else if (logRef < 0) {
    ctx.temp_access_log_id = Math.abs(logRef);
  }
  return ctx;
}

export interface IncidentPagination {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface IncidentListResult {
  items: AccessIncident[];
  pagination: IncidentPagination;
}

@Injectable({ providedIn: 'root' })
export class AccessIncidentService {
  constructor(private readonly api: ApiService) {}

  list(params: {
    fecha_inicial?: string;
    fecha_final?: string;
    access_point_id?: number;
    source?: IncidentSource | '';
    page?: number;
    page_size?: number;
  }): Observable<IncidentListResult> {
    const query: Record<string, string | number> = {};
    if (params.fecha_inicial) query['fecha_inicial'] = params.fecha_inicial;
    if (params.fecha_final) query['fecha_final'] = params.fecha_final;
    if (params.access_point_id && params.access_point_id > 0) {
      query['access_point_id'] = params.access_point_id;
    }
    if (params.source) query['source'] = params.source;
    if (params.page) query['page'] = params.page;
    if (params.page_size) query['page_size'] = params.page_size;

    return this.api.get<{ items?: AccessIncident[]; pagination?: IncidentPagination } | AccessIncident[]>(
      'api/v1/access-incidents',
      query
    ).pipe(
      map((res) => {
        const data = res.data;
        // Compat: respuesta antigua = array plano
        if (Array.isArray(data)) {
          return {
            items: data,
            pagination: {
              page: 1,
              page_size: data.length,
              total: data.length,
              total_pages: 1,
            },
          };
        }
        const items = Array.isArray(data?.items) ? data.items : [];
        const pagination = data?.pagination ?? {
          page: 1,
          page_size: items.length,
          total: items.length,
          total_pages: 1,
        };
        return { items, pagination };
      })
    );
  }

  get(id: number): Observable<AccessIncident> {
    return this.api.get<AccessIncident>(`api/v1/access-incidents/${id}`).pipe(
      map((res) => res.data as AccessIncident)
    );
  }

  getByLogId(logRef: number): Observable<AccessIncident[]> {
    return this.api.get<AccessIncident[]>(`api/v1/access-incidents/by-log/${logRef}`).pipe(
      map((res) => (Array.isArray(res.data) ? res.data : []))
    );
  }

  create(form: FormData): Observable<AccessIncident> {
    return this.api.postFormData<AccessIncident>('api/v1/access-incidents', form).pipe(
      map((res) => res.data as AccessIncident)
    );
  }

  photoUrl(path: string | null | undefined): string | null {
    return this.api.getPhotoUrl(path ?? null);
  }

  /** URLs de fotos de una incidencia (compat con solo photo_url). */
  photoUrlsOf(incident: AccessIncident | null | undefined): string[] {
    if (!incident) {
      return [];
    }
    const fromArray = Array.isArray(incident.photo_urls)
      ? incident.photo_urls.map((u) => this.photoUrl(u)).filter((u): u is string => !!u)
      : [];
    if (fromArray.length) {
      return fromArray;
    }
    const single = this.photoUrl(incident.photo_url);
    return single ? [single] : [];
  }
}
