import { Router } from '@angular/router';

/**
 * Ruta interna actual. Con `HashLocationStrategy`, en el primer `ngOnInit` de la raíz
 * `router.url` a veces sigue en `/` antes de aplicar `#/landing`, y el hash ya es fiable.
 */
export function currentInternalPath(router: Router): string {
  if (typeof window !== 'undefined') {
    const hash = window.location.hash || '';
    if (hash.startsWith('#/')) {
      return hash.slice(1).split('?')[0] || '/';
    }
  }
  return (router.url || '').split('?')[0] || '/';
}

export function isPublicGuestPath(path: string): boolean {
  const p = (path || '').split('?')[0];
  return p === '/login' || p === '/registro' || p === '/landing';
}
