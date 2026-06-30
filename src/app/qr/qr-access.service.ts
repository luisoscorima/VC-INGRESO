import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService, ApiResponse } from '../api.service';
import { ExternalVisitAssignmentOption } from '../externalVehicle';

/** Respuesta unificada de scan / validate (cuerpo `data` de la API). */
export interface AccessQrScanResult {
  source: 'qr' | 'manual';
  kind: 'person' | 'vehicle';
  person: AccessQrPersonPublic | null;
  vehicle: AccessQrVehiclePublic | null;
  person_id?: number | null;
  doc_number?: string | null;
  vehicle_id?: number | null;
  /** temporary_visits.temp_visit_id (vehículo externo / delivery). */
  temp_visit_id?: number | null;
  assignment_id?: number | null;
  house_id?: number | null;
  /** Texto legible del domicilio (Mz/Lt/Dpto). */
  house_label?: string | null;
  license_plate?: string | null;
  status_validated: string;
  allow_entry: boolean;
  pending_house_selection?: boolean;
  active_assignments?: ExternalVisitAssignmentOption[];
  is_birthday: boolean;
  birth_date?: string | null;
  message?: string;
  operator_notes?: string | null;
}

export interface AccessQrPersonPublic {
  id: number;
  doc_number: string;
  first_name?: string | null;
  paternal_surname?: string | null;
  maternal_surname?: string | null;
  photo_url?: string | null;
  birth_date?: string | null;
  status_validated?: string | null;
  person_type?: string | null;
  house_id?: number | null;
}

export interface AccessQrVehiclePublic {
  /** null si es vehículo externo (temporary_visits). */
  vehicle_id?: number | null;
  license_plate: string;
  house_id?: number | null;
  brand?: string | null;
  model?: string | null;
  photo_url?: string | null;
  status_validated?: string | null;
}

export interface AccessQrGenerateResult {
  token: string;
  expires_at: number;
  kind: 'person' | 'vehicle';
  person_id?: number;
  doc_number?: string;
  house_id?: number;
  vehicle_id?: number;
  license_plate?: string;
}

@Injectable({ providedIn: 'root' })
export class QrAccessService {
  constructor(private api: ApiService) {}

  scan(input: string): Observable<AccessQrScanResult> {
    return this.api
      .post<{ input: string }>('api/v1/access-qr/scan', { input: input.trim() })
      .pipe(
        map((res: ApiResponse<AccessQrScanResult>) => {
          if (!res.success || res.data == null) {
            throw new Error(res.error || 'Error al escanear');
          }
          return res.data;
        })
      );
  }

  scanConfirm(tempVisitId: number, assignmentId: number): Observable<AccessQrScanResult> {
    return this.api
      .post<{ temp_visit_id: number; assignment_id: number }>('api/v1/access-qr/scan-confirm', {
        temp_visit_id: tempVisitId,
        assignment_id: assignmentId,
      })
      .pipe(
        map((res: ApiResponse<AccessQrScanResult>) => {
          if (!res.success || res.data == null) {
            throw new Error(res.error || 'Error al confirmar ingreso');
          }
          return res.data;
        })
      );
  }

  validateToken(token: string): Observable<AccessQrScanResult> {
    return this.api.post<{ token: string }>('api/v1/access-qr/validate', { token }).pipe(
      map((res: ApiResponse<AccessQrScanResult>) => {
        if (!res.success || res.data == null) {
          throw new Error(res.error || 'QR inválido');
        }
        return res.data;
      })
    );
  }

  generatePersonQr(personId: number): Observable<AccessQrGenerateResult> {
    return this.api
      .post<{ kind: string; person_id: number }>('api/v1/access-qr/generate', {
        kind: 'person',
        person_id: personId,
      })
      .pipe(
        map((res: ApiResponse<AccessQrGenerateResult>) => {
          if (!res.success || res.data == null) {
            throw new Error(res.error || 'No se pudo generar el QR');
          }
          return res.data;
        })
      );
  }

  generateVehicleQr(vehicleId: number): Observable<AccessQrGenerateResult> {
    return this.api
      .post<{ kind: string; vehicle_id: number }>('api/v1/access-qr/generate', {
        kind: 'vehicle',
        vehicle_id: vehicleId,
      })
      .pipe(
        map((res: ApiResponse<AccessQrGenerateResult>) => {
          if (!res.success || res.data == null) {
            throw new Error(res.error || 'No se pudo generar el QR');
          }
          return res.data;
        })
      );
  }
}
