import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { ApiService, ApiResponse } from '../api.service';
import { environment } from '../../environments/environment';
import { IdentityDocumentType } from '../shared/identity-document';
import { compressThenUpload } from '../shared/compress-image';

export interface PublicRegisterHouse {
  house_type: string;
  block_house: string;
  lot: number | null;
  apartment: string | null;
}

/** Casa devuelta por GET /api/v1/public/houses (para desplegables Mz/Lt/Apt) */
export interface HouseFromApi {
  house_id: number;
  house_type: string;
  block_house: string;
  lot: number;
  apartment: string | null;
}

export interface PublicRegisterOwner {
  type_doc: IdentityDocumentType;
  doc_number: string;
  first_name: string;
  paternal_surname: string;
  maternal_surname?: string;
  cel_number?: string;
  email?: string;
  /** Datos RENIEC/apidev para no reconsultar (persistir en persons) */
  gender?: string;
  birth_date?: string | null;
  address?: string | null;
  district?: string | null;
  province?: string | null;
  region?: string | null;
  civil_status?: string | null;
}

export interface PublicRegisterVehicle {
  /** Obligatoria salvo BICICLETA / MOTO ELECTRICA (entonces null y foto obligatoria). */
  license_plate?: string | null;
  type_vehicle?: string;
  brand?: string;
  model?: string;
  color?: string;
  photo_url?: string | null;
}

export interface PublicRegisterPet {
  species: string;
  name: string;
  breed?: string;
  color?: string;
  age_years?: number | null;
  photo_url?: string | null;
}

export interface PublicRegisterPayload {
  house: PublicRegisterHouse;
  owners: PublicRegisterOwner[];
  vehicles: PublicRegisterVehicle[];
  pets: PublicRegisterPet[];
}

/** Respuesta del backend POST /api/v1/public/register */
export interface PublicRegisterResponseData {
  house_id: number;
  person_ids: number[];
  vehicle_ids: number[];
  pet_ids: number[];
  created_users?: Array<{ person_id: number; username_system: string; temporary_password: string }>;
}

export interface ReniecDniData {
  numero: string;
  nombres: string;
  apellido_paterno: string;
  apellido_materno: string;
  nombre_completo?: string;
  fecha_nacimiento?: string;
  sexo?: string;
  direccion?: string;
  direccion_completa?: string;
  distrito?: string;
  provincia?: string;
  departamento?: string;
  [key: string]: unknown;
}

/**
 * Servicio para el registro público (sin login): envío del formulario
 * y consulta DNI a API externa RENIEC.
 */
@Injectable({
  providedIn: 'root'
})
export class PublicRegistrationService {

  /** URL base de la API de registro (mismo backend) */
  private get apiBase(): string {
    return environment.baseUrl;
  }

  constructor(
    private api: ApiService,
    private http: HttpClient
  ) {}

  /**
   * Lista todas las casas para los desplegables Mz / Lote / Departamento.
   * GET /api/v1/public/houses (no requiere auth).
   */
  getHouses(): Observable<ApiResponse<HouseFromApi[]>> {
    return this.api.get<HouseFromApi[]>('api/v1/public/houses');
  }

  /**
   * Envía el formulario completo al backend.
   * POST /api/v1/public/register (no requiere auth).
   */
  register(payload: PublicRegisterPayload): Observable<ApiResponse<PublicRegisterResponseData>> {
    return this.api.post<PublicRegisterPayload>('api/v1/public/register', payload);
  }

  /**
   * Sube una foto de vehículo. POST multipart/form-data, campo "photo".
   * Devuelve la URL que debe enviarse en photo_url del vehículo en el registro.
   * Comprime la imagen en cliente antes de enviar.
   */
  uploadVehiclePhoto(file: File): Observable<{ success: boolean; photo_url?: string; error?: string }> {
    return compressThenUpload(file, (compressed) => {
      const formData = new FormData();
      formData.append('photo', compressed, compressed.name);
      return this.http.post<{ success: boolean; photo_url?: string; error?: string }>(
        `${this.apiBase}/api/v1/public/upload/vehicle-photo`,
        formData
      );
    });
  }

  /**
   * Sube una foto de mascota. POST multipart/form-data, campo "photo".
   * Devuelve la URL que debe enviarse en photo_url de la mascota en el registro.
   * Comprime la imagen en cliente antes de enviar.
   */
  uploadPetPhoto(file: File): Observable<{ success: boolean; photo_url?: string; error?: string }> {
    return compressThenUpload(file, (compressed) => {
      const formData = new FormData();
      formData.append('photo', compressed, compressed.name);
      return this.http.post<{ success: boolean; photo_url?: string; error?: string }>(
        `${this.apiBase}/api/v1/public/upload/pet-photo`,
        formData
      );
    });
  }

  /**
   * Comprueba si un DNI ya está registrado en el sistema (evita consultas repetidas a apidev y detecta duplicados).
   * GET /api/v1/public/check-doc (siempre 200, sin 404).
   */
  checkDocRegistered(docNumber: string): Observable<boolean> {
    const num = (docNumber || '').trim();
    if (!num) return of(false);
    return this.api.getRaw('api/v1/public/check-doc', { doc_number: num }).pipe(
      map((res: any) => res?.registered === true),
      catchError(() => of(false))
    );
  }

  /** Consulta RENIEC mediante el proxy público limitado del backend. */
  getDniData(docNumber: string): Observable<ReniecDniData | null> {
    const num = (docNumber || '').trim();
    if (!/^[0-9]{8}$/.test(num)) {
      return of(null);
    }
    return this.api.getRaw(`api/v1/public/reniec/dni/${num}`).pipe(
      map(res => (res?.success && res?.data) ? res.data : null),
      catchError(() => of(null))
    );
  }
}
