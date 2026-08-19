import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../environments/environment';
import { compressThenUpload } from './shared/compress-image';

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
   * Comprime la imagen en cliente antes de enviar.
   */
  uploadProfilePhoto(
    file: File,
    options?: { maxEdge?: number; quality?: number; skipCompress?: boolean }
  ): Observable<ApiResponse<any>> {
    const send = (compressed: File) => {
      const form = new FormData();
      form.append('photo', compressed);
      return this.http.post<ApiResponse<any>>(`${this.baseUrl}/api/v1/users/me/photo`, form).pipe(
        catchError(this.handleError)
      );
    };
    if (options?.skipCompress) {
      return send(file);
    }
    return compressThenUpload(file, send, options);
  }

  /**
   * Subir documento para sección readonly/documents.
   * Devuelve { url, title, ext }.
   * Si el archivo es imagen, se comprime; PDF/otros se envían tal cual.
   */
  uploadReadonlyDocument(file: File): Observable<ApiResponse<any>> {
    const send = (f: File) => {
      const form = new FormData();
      form.append('file', f);
      return this.http.post<ApiResponse<any>>(`${this.baseUrl}/api/v1/readonly/documents/upload`, form).pipe(
        catchError(this.handleError)
      );
    };
    if (file.type.startsWith('image/')) {
      return compressThenUpload(file, send);
    }
    return send(file);
  }

  /**
   * Subir imagen para comunicados (CRUD admin).
   * Devuelve { url, ext }.
   * Comprime la imagen en cliente antes de enviar.
   */
  uploadAnnouncementImage(file: File): Observable<ApiResponse<any>> {
    return compressThenUpload(file, (compressed) => {
      const form = new FormData();
      form.append('file', compressed);
      return this.http.post<ApiResponse<any>>(`${this.baseUrl}/api/v1/announcements/upload-image`, form).pipe(
        catchError(this.handleError)
      );
    });
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
   * Manejo centralizado de errores.
   * Preserva mensajes ya normalizados (p. ej. por el interceptor) y evita el fallback genérico.
   */
  private handleError(error: unknown): Observable<never> {
    let errorMessage = 'Error desconocido';

    if (error instanceof HttpErrorResponse) {
      errorMessage = ApiService.messageFromHttp(error);
    } else if (error instanceof Error && error.message.trim()) {
      errorMessage = error.message;
    } else if (typeof error === 'string' && error.trim()) {
      errorMessage = error;
    }

    console.error('ApiService Error:', errorMessage, error);
    return throwError(() => new Error(errorMessage));
  }

  private static messageFromHttp(error: HttpErrorResponse): string {
    const bodyError =
      typeof error.error?.error === 'string'
        ? error.error.error
        : typeof error.error?.message === 'string'
          ? error.error.message
          : null;

    if (error.error instanceof ErrorEvent) {
      return error.error.message || 'Error de red';
    }

    switch (error.status) {
      case 0:
        return 'No se pudo conectar con el servidor. Revise la red e intente de nuevo.';
      case 400:
      case 409:
      case 422:
        return bodyError || 'Solicitud incorrecta';
      case 401:
        return 'No autorizado. Por favor inicie sesion nuevamente.';
      case 403:
        return 'Acceso prohibido';
      case 404:
        return bodyError || 'Recurso no encontrado';
      case 413:
        return bodyError || 'El archivo es demasiado grande.';
      case 500:
        return bodyError || 'Error interno del servidor';
      default:
        return bodyError || `Error ${error.status}: ${error.message}`;
    }
  }
}
