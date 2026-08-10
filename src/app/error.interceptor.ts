import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { currentInternalPath, isPublicGuestPath } from './public-route.utils';

let loginRedirectInProgress = false;

function messageFromHttp(error: HttpErrorResponse): string {
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
      return 'No autorizado';
    case 403:
      return 'Acceso prohibido';
    case 404:
      return bodyError || 'Recurso no encontrado';
    case 413:
      return bodyError || 'El archivo es demasiado grande.';
    case 500:
      return bodyError || 'Error interno del servidor';
    default:
      return bodyError || (error.status ? `Error ${error.status}: ${error.message}` : 'Error desconocido');
  }
}

/**
 * ErrorInterceptor - Manejo centralizado de errores HTTP
 *
 * Captura todos los errores de las peticiones HTTP y:
 * - Registra el error en consola
 * - Maneja errores 401 (no autorizado)
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const auth = inject(AuthService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      const errorMessage = messageFromHttp(error);

      if (error.status === 401) {
        const path = currentInternalPath(router);
        const publicNoRedirect = isPublicGuestPath(path);
        auth.clearAuthState();
        if (!publicNoRedirect && !loginRedirectInProgress) {
          loginRedirectInProgress = true;
          router.navigate(['/login'], { replaceUrl: true }).finally(() => {
            loginRedirectInProgress = false;
          });
        }
      }

      console.error('HTTP Error:', {
        url: req.url,
        status: error.status,
        message: errorMessage,
        error: error.error
      });

      return throwError(() => new Error(errorMessage));
    })
  );
};
