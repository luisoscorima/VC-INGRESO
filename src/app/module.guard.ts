import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, UrlTree } from '@angular/router';
import { Observable, of } from 'rxjs';
import { map, take } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { NavPermissionService } from './nav-permission.service';
import { ToastrService } from 'ngx-toastr';

/** Bloquea rutas de gestión si el usuario no tiene permiso de ver el módulo. */
@Injectable({ providedIn: 'root' })
export class ModuleGuard implements CanActivate {
  constructor(
    private auth: AuthService,
    private navPerm: NavPermissionService,
    private router: Router,
    private toastr: ToastrService
  ) {}

  canActivate(route: ActivatedRouteSnapshot): Observable<boolean | UrlTree> {
    if (!this.auth.isAuthenticated()) {
      return of(this.router.parseUrl('/login'));
    }
    const moduleKey = route.data['module'] as string | undefined;
    const moduleAny = route.data['moduleAny'] as string[] | undefined;
    if (!moduleKey && (!moduleAny || moduleAny.length === 0)) {
      return of(true);
    }
    return this.navPerm.load().pipe(
      take(1),
      map(() => {
        if (!this.auth.isSessionRolePersonValid()) {
          this.toastr.warning('Tu sesión no tiene una combinación de rol válida.');
          return this.router.parseUrl('/');
        }
        const allowed =
          (moduleAny && moduleAny.length > 0)
            ? moduleAny.some((key) => this.navPerm.canView(key))
            : this.navPerm.canView(moduleKey as string);
        if (!allowed) {
          this.toastr.warning('No tienes permiso para acceder a esta sección.');
          return this.router.parseUrl('/');
        }
        return true;
      })
    );
  }
}
