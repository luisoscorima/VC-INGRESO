import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../environments/environment';
import { tap, map } from 'rxjs/operators';
import { Observable, BehaviorSubject } from 'rxjs';
import { User } from './user';
import { isResidentPersonType, isValidRolePersonPair, normalizePersonType } from './system-roles';
import { NavPermissionService } from './nav-permission.service';

const STORAGE_KEY = 'auth_user';
const TOKEN_KEY = 'auth_token';
const LEGACY_SESSION_KEYS = ['user_id', 'user_role', 'userOnSes', 'onSession', 'role_system'] as const;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private baseUrl = environment.baseUrl;
  private userSubject = new BehaviorSubject<User | null>(this.initFromStorage());
  user$ = this.userSubject.asObservable();

  constructor(
    private http: HttpClient,
    private router: Router,
    private navPerm: NavPermissionService
  ) {}

  private initFromStorage(): User | null {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as User;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
  }

  login(username: string, password: string): Observable<User> {
    return this.http.post<{ user: User; token: string } | { error: string }>(`${this.baseUrl}/api/v1/auth/login`, {
      username_system: username,
      password_system: password,
    }).pipe(
      map((res: any) => {
        if (res && !res.error && res.user && res.token) {
          return res as { user: User; token: string };
        }
        throw new Error(res?.error || 'Credenciales inválidas');
      }),
      tap((res) => {
        const u = res.user as User & { house_id?: number };
        const myHouses = (res as { my_houses?: Array<{ house_id?: number }> }).my_houses;
        let stored: User = u;
        const hid = Number(u.house_id ?? 0);
        if (hid <= 0 && Array.isArray(myHouses) && myHouses.length > 0 && myHouses[0]?.house_id) {
          stored = { ...(u as object), house_id: Number(myHouses[0].house_id) } as User;
        }
        (res as { user: User }).user = stored;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
        localStorage.setItem(TOKEN_KEY, res.token);
        this.userSubject.next(stored);
        this.navPerm.load(true).subscribe();
      })
    ).pipe(map((res) => res.user));
  }

  logout(): void {
    this.navPerm.clear();
    this.clearAuthState();
    this.router.navigate(['/login']);
  }

  clearAuthState(): void {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TOKEN_KEY);
    for (const key of LEGACY_SESSION_KEYS) {
      localStorage.removeItem(key);
    }
    this.userSubject.next(null);
  }

  getUser(): User | null {
    return this.userSubject.getValue();
  }

  /** Marca que el usuario ya cambió la contraseña temporal (actualiza el usuario en storage) */
  setForcePasswordChangeDone(): void {
    const u = this.getUser();
    if (u) {
      (u as any).force_password_change = 0;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
      this.userSubject.next(u);
    }
  }

  /** Actualiza el usuario actual en sesión (p. ej. tras cambiar foto de perfil). */
  updateCurrentUser(user: User): void {
    const prevUser = this.getUser();
    const prev = prevUser as unknown as Record<string, unknown> | null;
    const next = user as unknown as Record<string, unknown>;

    /** El login puede completar `house_id` desde `my_houses`; el endpoint de foto solo devuelve `users.house_id`. */
    let toStore = user;
    if (prev) {
      const merged = { ...prev, ...next } as Record<string, unknown>;
      const prevH = Number(prev['house_id'] ?? 0);
      const incH = Number(merged['house_id'] ?? 0);
      if (prevH > 0 && incH <= 0) {
        merged['house_id'] = prev['house_id'];
      }
      for (const k of ['block_house', 'lot', 'apartment', 'person_type', 'property_category'] as const) {
        const v = merged[k];
        if ((v === undefined || v === null || v === '') && prev[k] != null && prev[k] !== '') {
          merged[k] = prev[k];
        }
      }
      toStore = merged as unknown as User;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
    this.userSubject.next(toStore);
  }

  getToken(): string | null {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      return null;
    }
    if (this.isTokenExpired(token)) {
      this.clearAuthState();
      return null;
    }
    return token;
  }

  isAuthenticated(): boolean {
    return !!this.getUser() && !!this.getToken();
  }

  /** Personal de puerta / administración (puede usar escáner y validar QR). */
  isStaff(): boolean {
    const r = String(this.getUser()?.role_system ?? '').toUpperCase();
    return r === 'ADMINISTRADOR' || r === 'OPERARIO';
  }

  /** Vecino con rol USUARIO (Mi casa, generar QR). */
  isNeighbor(): boolean {
    return String(this.getUser()?.role_system ?? '').toUpperCase() === 'USUARIO';
  }

  /**
   * Contexto de hogar en sesión, alineado con `authHasNeighborHouseContext` (PHP):
   * `house_id` en usuario o persona vecina con tipo PROPIETARIO/RESIDENTE/INQUILINO
   * (la API valida membresía real).
   */
  hasNeighborHouseContextInSession(): boolean {
    const u = this.getUser() as { house_id?: number } | null;
    if (Number(u?.house_id ?? 0) > 0) {
      return true;
    }
    return this.hasLinkedPerson() && isResidentPersonType(this.personTypeUpper());
  }

  /**
   * Vista “vecino” en reservaciones: USUARIO u OPERARIO con tipo de hogar y contexto de casa
   * (no la vista staff global de administrador).
   */
  isReservationsNeighborUi(): boolean {
    const u = this.getUser();
    if (!u || this.isAdministratorRole()) {
      return false;
    }
    const role = String(u.role_system ?? '').toUpperCase();
    if (role !== 'USUARIO' && role !== 'OPERARIO') {
      return false;
    }
    if (!isResidentPersonType(this.personTypeUpper())) {
      return false;
    }
    return this.hasNeighborHouseContextInSession();
  }

  /** persons.id en JWT / usuario en sesión (login fusiona user + person). */
  hasLinkedPerson(): boolean {
    const u = this.getUser() as { person_id?: number } | null;
    return Number(u?.person_id ?? 0) > 0;
  }

  /** ADMINISTRADOR de aplicación (no implica solo portería). */
  isAdministratorRole(): boolean {
    const r = String(this.getUser()?.role_system ?? '').trim().toUpperCase();
    return r === 'ADMINISTRADOR';
  }

  /** persons.person_type (o property_category del login). */
  personTypeUpper(): string | null {
    const u = this.getUser() as { person_type?: string; property_category?: string } | null;
    return normalizePersonType(u?.person_type ?? u?.property_category ?? null);
  }

  /** Combinación JWT / sesión permitida (bloquea p. ej. ADMINISTRADOR + INQUILINO). */
  isSessionRolePersonValid(): boolean {
    const u = this.getUser();
    if (!u) {
      return false;
    }
    return isValidRolePersonPair(u.role_system, this.personTypeUpper());
  }

  /**
   * Generar "Mi código QR": persona vinculada, combinación válida y casa asociada.
   * ADMIN/OPERARIO + sin tipo/casa no aplican.
   */
  canGenerateHouseAccessQr(): boolean {
    if (!this.hasLinkedPerson() || !this.isSessionRolePersonValid()) {
      return false;
    }
    if (!this.hasNeighborHouseContextInSession()) {
      return false;
    }
    const role = String(this.getUser()?.role_system ?? '').toUpperCase();
    const pt = this.personTypeUpper();
    if (role === 'USUARIO') {
      return pt === 'PROPIETARIO' || pt === 'RESIDENTE' || pt === 'INQUILINO';
    }
    if (role === 'ADMINISTRADOR') {
      return pt === 'PROPIETARIO' || pt === 'RESIDENTE';
    }
    if (role === 'OPERARIO') {
      return pt === 'PROPIETARIO' || pt === 'RESIDENTE' || pt === 'INQUILINO';
    }
    return false;
  }

  /** Módulo reservaciones (bloquea OPERARIO + NULL). */
  canAccessReservationsPage(): boolean {
    const u = this.getUser();
    if (!u || !this.isSessionRolePersonValid()) {
      return false;
    }
    const role = String(u.role_system ?? '').toUpperCase();
    const pt = this.personTypeUpper();
    if (role === 'ADMINISTRADOR') {
      return true;
    }
    if (role === 'OPERARIO' && pt === null) {
      return false;
    }
    if (role === 'USUARIO' || role === 'OPERARIO') {
      return isResidentPersonType(pt) && this.hasNeighborHouseContextInSession();
    }
    return false;
  }

  // ========== Métodos Migrados de CookiesService ==========
  // Usan localStorage en lugar de cookies

  /**
   * Guarda un valor en localStorage
   */
  setItem(key: string, value: string): void {
    localStorage.setItem(key, value);
  }

  /**
   * Obtiene un valor de localStorage
   */
  getItem(key: string): string | null {
    return localStorage.getItem(key);
  }

  /**
   * Verifica si existe un valor en localStorage
   */
  hasItem(key: string): boolean {
    return localStorage.getItem(key) !== null;
  }

  /**
   * Elimina un valor de localStorage
   */
  removeItem(key: string): void {
    localStorage.removeItem(key);
  }

  // ========== Métodos Legacy (Alias para compatibilidad con CookiesService) ==========

  /**
   * Alias legacy para setItem - usa token_name como key
   */
  setToken(token_name: string, token: string): void {
    this.setItem(token_name, token);
  }

  /**
   * Alias legacy para getItem - usa token_name como key
   * Nota: Para el token de autenticación usar getToken() sin parámetros
   */
  getTokenItem(token_name: string): string {
    return this.getItem(token_name) || '';
  }

  /**
   * Alias legacy para hasItem
   */
  checkToken(token_name: string): boolean {
    return this.hasItem(token_name);
  }

  /**
   * Alias legacy para removeItem
   */
  deleteToken(token_name: string): void {
    this.removeItem(token_name);
  }

  private isTokenExpired(token: string): boolean {
    try {
      const payloadPart = token.split('.')[1];
      if (!payloadPart) return true;
      const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(base64)) as { exp?: number };
      if (!payload?.exp) return false;
      const now = Math.floor(Date.now() / 1000);
      return payload.exp <= now;
    } catch {
      return true;
    }
  }
}
