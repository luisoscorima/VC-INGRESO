import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../environments/environment';

/**
 * Interfaz base para respuestas de la API
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

/**
 * ApiService - Servicio unificado para todas las llamadas HTTP
 * 
 * Proporciona métodos tipados para GET, POST, PUT, DELETE con:
 * - Manejo centralizado de errores
 * - Tipado de respuestas
 * - Parámetros via HttpParams
 */
@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private baseUrl = environment.baseUrl;
  private publicAppUrl = (environment.publicAppUrl || '').replace(/\/$/, '');

  constructor(private http: HttpClient) {}

  /**
   * Realiza una petición GET con parámetros tipados
   */
  get<T>(endpoint: string, params?: Record<string, string | number | boolean>): Observable<ApiResponse<T>> {
    let httpParams = new HttpParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        httpParams = httpParams.set(key, String(value));
      });
    }

    return this.http.get<ApiResponse<T>>(`${this.baseUrl}/${endpoint}`, { params: httpParams }).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * Realiza una petición GET sin tipado (para endpoints legacy)
   */
  getRaw(endpoint: string, params?: Record<string, string | number | boolean>): Observable<any> {
    let httpParams = new HttpParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        httpParams = httpParams.set(key, String(value));
      });
    }

    return this.http.get(`${this.baseUrl}/${endpoint}`, { params: httpParams }).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * Realiza una petición POST con datos tipados
   */
  post<T>(endpoint: string, data: T): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(`${this.baseUrl}/${endpoint}`, data).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * Realiza una petición PUT con datos tipados
   */
  put<T>(endpoint: string, data: T): Observable<ApiResponse<any>> {
    return this.http.put<ApiResponse<any>>(`${this.baseUrl}/${endpoint}`, data).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * Realiza una petición DELETE
   */
  delete(endpoint: string): Observable<ApiResponse<any>> {
    return this.http.delete<ApiResponse<any>>(`${this.baseUrl}/${endpoint}`).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * POST multipart/form-data (sin Content-Type manual; el navegador añade boundary).
   */
  postFormData<T = unknown>(endpoint: string, form: FormData): Observable<ApiResponse<T>> {
    return this.http.post<ApiResponse<T>>(`${this.baseUrl}/${endpoint}`, form).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * Subir foto de perfil del usuario autenticado (POST multipart).
   * Requiere token. Devuelve { success, data: usuario actualizado }.
   */
  uploadProfilePhoto(file: File): Observable<ApiResponse<any>> {
    const form = new FormData();
    form.append('photo', file);
    return this.http.post<ApiResponse<any>>(`${this.baseUrl}/api/v1/users/me/photo`, form).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * Subir documento para sección readonly/documents.
   * Devuelve { url, title, ext }.
   */
  uploadReadonlyDocument(file: File): Observable<ApiResponse<any>> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<ApiResponse<any>>(`${this.baseUrl}/api/v1/readonly/documents/upload`, form).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * Subir imagen para comunicados (CRUD admin).
   * Devuelve { url, ext }.
   */
  uploadAnnouncementImage(file: File): Observable<ApiResponse<any>> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<ApiResponse<any>>(`${this.baseUrl}/api/v1/announcements/upload-image`, form).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * Devuelve la URL completa para mostrar una foto (vehículo, mascota, perfil, etc.).
   * - http(s):// → tal cual.
   * - /assets/… → estáticos de la SPA: URL completa con `environment.publicAppUrl` (no el API).
   * - Otras rutas relativas (p. ej. /uploads/…) → se antepone baseUrl del backend.
   */
  getPhotoUrl(url: string | null | undefined): string | null {
    if (!url || typeof url !== 'string') return null;
    const u = url.trim();
    if (u.startsWith('http://') || u.startsWith('https://')) {
      if (this.publicAppUrl) {
        try {
          const parsed = new URL(u);
          if (parsed.pathname.startsWith('/assets/')) {
            const apiOrigin = new URL(this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`).origin;
            if (parsed.origin === apiOrigin) {
              return `${this.publicAppUrl}${parsed.pathname}${parsed.search}`;
            }
          }
        } catch {
          /* URL inválida: devolver tal cual */
        }
      }
      return u;
    }
    if (u.startsWith('/assets/') && this.publicAppUrl) {
      return `${this.publicAppUrl}${u}`;
    }
    if (u.startsWith('/assets/')) {
      return u;
    }
    const base = this.baseUrl.replace(/\/$/, '');
    return u.startsWith('/') ? `${base}${u}` : `${base}/${u}`;
  }

  /**
   * Manejo centralizado de errores
   */
  private handleError(error: any): Observable<never> {
    let errorMessage = 'Error desconocido';

    if (error.error instanceof ErrorEvent) {
      // Error del lado del cliente
      errorMessage = `Error: ${error.error.message}`;
    } else if (error.status) {
      // Error del lado del servidor
      switch (error.status) {
        case 400:
          errorMessage = error.error?.error || 'Solicitud incorrecta';
          break;
        case 401:
          errorMessage = 'No autorizado. Por favor inicie sesion nuevamente.';
          break;
        case 403:
          errorMessage = 'Acceso prohibido';
          break;
        case 404:
          errorMessage = 'Recurso no encontrado';
          break;
        case 409:
          errorMessage = error.error?.error || 'Conflicto de datos';
          break;
        case 500:
          errorMessage = 'Error interno del servidor';
          break;
        default:
          errorMessage = `Error ${error.status}: ${error.message}`;
      }
    }

    console.error('ApiService Error:', errorMessage, error);
    return throwError(() => new Error(errorMessage));
  }
}
