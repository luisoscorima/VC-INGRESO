import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../environments/environment';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

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

  /**
   * Lista logs de acceso con filtros opcionales
   */
  getAccessLogs(params?: {
    fecha?: string;
    fecha_inicial?: string;
    fecha_final?: string;
    start_date?: string;
    end_date?: string;
    access_point?: string;
    user_id?: number;
    doc_number?: string;
  }): Observable<any> {
    return this.api.getRaw('api/v1/access-logs', params);
  }

  /**
   * Obtiene log por ID
   */
  getAccessLogById(access_log_id: number): Observable<any> {
    return this.api.getRaw('api/v1/access-logs', { access_log_id });
  }

  /**
   * Crea un nuevo log de acceso
   */
  createAccessLog(log: any): Observable<any> {
    return this.api.post('api/v1/access-logs', log);
  }

  /**
   * Actualiza un log de acceso (ej. registrar salida)
   */
  updateAccessLog(access_log_id: number, data: any): Observable<any> {
    return this.api.put(`api/v1/access-logs/${access_log_id}`, data);
  }

  // ==================== ACCESS POINTS ====================

  /**
   * Obtiene todos los puntos de acceso
   */
  getAllAccessPoints(): Observable<any> {
    return this.api.getRaw('api/v1/access-logs/access-points');
  }

  /**
   * Obtiene punto de acceso por ID
   */
  getAccessPointById(ap_id: number): Observable<any> {
    return this.api.getRaw('api/v1/access-points', { ap_id });
  }

  // ==================== HISTORIAL UNIFICADO ====================

  /** access_point vacío u omitido = todos los puntos (access_logs + temporary_access_logs). */
  getHistoryByRange(fecha_inicial: string, fecha_final: string, access_point?: string): Observable<any> {
    const params: Record<string, string> = { fecha_inicial, fecha_final };
    if (access_point != null && access_point !== '') {
      params['access_point'] = access_point;
    }
    return this.api.getRaw('api/v1/access-logs/history-by-range', params);
  }

  /** Movimientos del mismo documento en un día; accessPoint opcional (todos si vacío). */
  getHistoryByDocumentDay(fecha: string, docNumber: string, accessPoint?: string): Observable<any> {
    const params: Record<string, string> = { fecha, doc: docNumber };
    if (accessPoint != null && accessPoint !== '') {
      params['access_point'] = accessPoint;
    }
    return this.api.getRaw('api/v1/access-logs/history-by-client', params);
  }
}
