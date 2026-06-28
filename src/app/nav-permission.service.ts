import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { ApiService } from './api.service';
import {
  AdminNavMatrix,
  NAV_MODULE_DEFS,
  NavModuleDef,
  ResolvedNavPermissions,
} from './nav-modules.config';

const EMPTY_PERMS: ResolvedNavPermissions = {};

function buildEmpty(): ResolvedNavPermissions {
  const out: ResolvedNavPermissions = {};
  for (const m of NAV_MODULE_DEFS) {
    out[m.key] = { view: false, manage: false };
  }
  return out;
}

@Injectable({ providedIn: 'root' })
export class NavPermissionService {
  private readonly permissionsSubject = new BehaviorSubject<ResolvedNavPermissions>(buildEmpty());
  readonly permissions$ = this.permissionsSubject.asObservable();
  private loaded = false;

  constructor(private api: ApiService) {}

  load(force = false): Observable<ResolvedNavPermissions> {
    if (this.loaded && !force) {
      return of(this.permissionsSubject.getValue());
    }
    return this.api.getRaw('api/v1/config/nav-permissions').pipe(
      map((res: any) => {
        const raw = res?.data?.modules ?? res?.modules ?? {};
        const merged = buildEmpty();
        for (const key of Object.keys(merged)) {
          const p = raw[key];
          if (p) {
            merged[key] = {
              view: !!p.view,
              manage: !!p.manage,
            };
          }
        }
        return merged;
      }),
      tap((perms) => {
        this.permissionsSubject.next(perms);
        this.loaded = true;
      }),
      catchError(() => {
        const fallback = buildEmpty();
        this.permissionsSubject.next(fallback);
        this.loaded = true;
        return of(fallback);
      })
    );
  }

  clear(): void {
    this.loaded = false;
    this.permissionsSubject.next(buildEmpty());
  }

  canView(moduleKey: string): boolean {
    return !!this.permissionsSubject.getValue()[moduleKey]?.view;
  }

  canManage(moduleKey: string): boolean {
    return !!this.permissionsSubject.getValue()[moduleKey]?.manage;
  }

  getVisibleModules(section?: 'gestion' | 'admin'): NavModuleDef[] {
    return NAV_MODULE_DEFS
      .filter((m) => (!section || m.section === section) && this.canView(m.key))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  hasVisibleModuleInSection(section: 'gestion' | 'admin'): boolean {
    return this.getVisibleModules(section).length > 0;
  }

  getAdminMatrix(): Observable<AdminNavMatrix> {
    return this.api.get<AdminNavMatrix>('api/v1/admin/nav-permissions').pipe(
      map((res: any) => res?.data ?? res)
    );
  }

  saveAdminMatrix(body: AdminNavMatrix): Observable<AdminNavMatrix> {
    return this.api.put<AdminNavMatrix>('api/v1/admin/nav-permissions', body).pipe(
      map((res: any) => res?.data ?? res),
      tap(() => this.load(true).subscribe())
    );
  }
}
