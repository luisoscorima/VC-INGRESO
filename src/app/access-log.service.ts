import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../environments/environment';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { OperatorDecision } from './shared/operator-decision';

export interface CreateResidentAccessLogBody {
  access_point_id: number;
  type: 'INGRESO' | 'EGRESO';
  observation?: string | null;
  operator_notes?: string | null;
  entry_source?: 'manual' | 'qr' | 'camera';
  entity_kind?: 'PERSON' | 'VEHICLE';
  identity_claim?: string | null;
  person_id?: number | null;
  doc_number?: string | null;
  document_type?: string | null;
  vehicle_id?: number | null;
  license_plate?: string | null;
}

export interface CreateTemporaryAccessLogBody {
  access_point_id: number;
  temp_visit_id: number;
  house_id?: number | null;
  assignment_id?: number | null;
  status_validated?: string;
  entry_source?: 'manual' | 'qr' | 'camera';
  entity_kind?: 'PERSON' | 'VEHICLE';
  operator_notes?: string | null;
}

export interface CreateTemporaryDeniedBody {
  access_point_id: number;
  temp_visit_id: number;
  house_id?: number | null;
  assignment_id?: number | null;
  entry_source?: 'manual' | 'qr' | 'camera';
  entity_kind?: 'PERSON' | 'VEHICLE';
  display_name_snapshot?: string | null;
  document_snapshot?: string | null;
  document_type_snapshot?: string | null;
  license_plate_snapshot?: string | null;
  operator_notes?: string | null;
}

export interface CreateTemporaryExitBody {
  access_point_id: number;
  temp_visit_id: number;
  house_id?: number | null;
  operator_notes?: string | null;
}

export interface PatchAccessDetailsBody {
  operator_notes?: string | null;
  operator_decision?: OperatorDecision | '' | null;
  house_id?: number | null;
}

@Injectable({
  providedIn: 'root'
})
export class AccessLogService {

  baseUrl = environment.baseUrl;

  constructor(
    private http: HttpClient,
    private api: ApiService
  ) { }

  // ==================== ACCESS LOGS (API V1) ====================

  getAccessLogs(params?: {
    date?: string;
    fecha?: string;
    fecha_inicial?: string;
    fecha_final?: string;
    start_date?: string;
    end_date?: string;
    access_point?: string;
    access_point_id?: number;
    user_id?: number;
    doc_number?: string;
    page?: number;
    limit?: number;
  }): Observable<any> {
    const query: Record<string, string | number> = { ...params } as Record<string, string | number>;
    if (params?.fecha && !params.date) {
      query['date'] = params.fecha;
      delete query['fecha'];
    }
    return this.api.getRaw('api/v1/access-logs', query);
  }

  getAccessLogById(accessLogId: number): Observable<any> {
    return this.api.getRaw(`api/v1/access-logs/${accessLogId}`);
  }

  createResidentAccessLog(body: CreateResidentAccessLogBody): Observable<any> {
    return this.api.post('api/v1/access-logs', body);
  }

  /** @deprecated Use createResidentAccessLog */
  createAccessLog(log: CreateResidentAccessLogBody): Observable<any> {
    return this.createResidentAccessLog(log);
  }

  createTemporaryEntry(body: CreateTemporaryAccessLogBody): Observable<any> {
    return this.api.post('api/v1/access-logs/temporary', body);
  }

  createTemporaryDeniedAttempt(body: CreateTemporaryDeniedBody): Observable<any> {
    return this.api.post('api/v1/access-logs/temporary/denied', body);
  }

  createTemporaryExit(body: CreateTemporaryExitBody): Observable<any> {
    return this.api.post('api/v1/access-logs/temporary/exit', body);
  }

  patchAccessDetails(logRef: number, body: PatchAccessDetailsBody | FormData): Observable<any> {
    if (body instanceof FormData) {
      return this.api.patchFormData(`api/v1/access-logs/details/${logRef}`, body);
    }
    return this.http.patch(`${this.baseUrl}/api/v1/access-logs/details/${logRef}`, body);
  }

  authorizeFromAttempt(logRef: number, houseId?: number | null): Observable<any> {
    const payload: Record<string, unknown> = { log_ref: logRef };
    if (houseId != null && houseId > 0) {
      payload['house_id'] = houseId;
    }
    return this.api.post('api/v1/access-logs/authorize-from-attempt', payload);
  }

  // ==================== ACCESS POINTS ====================

  getAllAccessPoints(options?: { includeInactive?: boolean }): Observable<any> {
    const params: Record<string, string> = {};
    if (options?.includeInactive) {
      params['include_inactive'] = '1';
    }
    return this.api.getRaw('api/v1/access-logs/access-points', params);
  }

  // ==================== HISTORIAL UNIFICADO ====================

  getHistoryByRange(
    fecha_inicial: string,
    fecha_final: string,
    access_point?: string,
    options?: { limit?: number; offset?: number }
  ): Observable<any> {
    const params: Record<string, string> = { fecha_inicial, fecha_final };
    if (access_point != null && access_point !== '') {
      params['access_point'] = access_point;
    }
    if (options?.limit != null) {
      params['limit'] = String(options.limit);
    }
    if (options?.offset != null) {
      params['offset'] = String(options.offset);
    }
    return this.api.getRaw('api/v1/access-logs/history-by-range', params);
  }

  getHistoryByDocumentDay(
    fecha: string,
    docNumber: string,
    accessPoint?: string,
    options?: { limit?: number; offset?: number }
  ): Observable<any> {
    const params: Record<string, string> = { fecha, doc: docNumber };
    if (accessPoint != null && accessPoint !== '') {
      params['access_point'] = accessPoint;
    }
    if (options?.limit != null) {
      params['limit'] = String(options.limit);
    }
    if (options?.offset != null) {
      params['offset'] = String(options.offset);
    }
    return this.api.getRaw('api/v1/access-logs/history-by-client', params);
  }
}
