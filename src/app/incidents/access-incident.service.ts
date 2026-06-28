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
  person_id?: number | null;
  vehicle_id?: number | null;
  temp_visit_id?: number | null;
  doc_number?: string | null;
  license_plate?: string | null;
  status_validated?: string | null;
  description: string;
  photo_url?: string | null;
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

@Injectable({ providedIn: 'root' })
export class AccessIncidentService {
  constructor(private readonly api: ApiService) {}

  list(params: {
    fecha_inicial?: string;
    fecha_final?: string;
    access_point_id?: number;
    source?: IncidentSource | '';
  }): Observable<AccessIncident[]> {
    const query: Record<string, string | number> = {};
    if (params.fecha_inicial) query['fecha_inicial'] = params.fecha_inicial;
    if (params.fecha_final) query['fecha_final'] = params.fecha_final;
    if (params.access_point_id && params.access_point_id > 0) {
      query['access_point_id'] = params.access_point_id;
    }
    if (params.source) query['source'] = params.source;

    return this.api.get<AccessIncident[]>('api/v1/access-incidents', query).pipe(
      map((res) => (Array.isArray(res.data) ? res.data : []))
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
}
