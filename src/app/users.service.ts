import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { User } from './user';
import { environment } from '../environments/environment';
import { BehaviorSubject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from './api.service';

@Injectable({
  providedIn: 'root'
})
export class UsersService {
  private baseUrl = environment.baseUrl;
  private reniecApiUrl = 'https://my.apidev.pro/api/dni';

  // BehaviorSubject para centralizar el estado del usuario
  private userSubject = new BehaviorSubject<User | null>(null);
  user$: Observable<User | null> = this.userSubject.asObservable();

  constructor(
    private http: HttpClient,
    private api: ApiService
  ) {}

  // ==================== USERS CRUD ====================

  getAllUsers(): Observable<any> {
    return this.api.get('api/v1/users').pipe(map((r) => r.data ?? r));
  }

  /**
   * Comprueba si un username_system está disponible (auth). Para Mi casa sin listar todo el directorio.
   */
  checkUsernameAvailable(username: string): Observable<{ available: boolean; username?: string }> {
    return this.api
      .get<{ available: boolean; username?: string }>('api/v1/users/check-username', { username })
      .pipe(map((r) => (r.data ?? r) as { available: boolean; username?: string }));
  }

  getUser(username_system: string, password_system: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/api/v1/auth/login`, { username_system, password_system });
  }

  getUserById(user_id: number): Observable<any> {
    return this.api.get(`api/v1/users/${user_id}`).pipe(map((r) => r.data ?? r));
  }

  setUsr(user: User): void {
    this.userSubject.next(user);
  }

  getUsr(): User | null {
    return this.userSubject.getValue();
  }

  getUserByDocNumber(doc_number: string): Observable<any> {
    return this.api.getRaw('api/v1/users/by-doc-number', { doc_number }).pipe(map((r) => r?.data ?? r));
  }

  getUsersByBirthday(fecha_cumple: string): Observable<any> {
    return this.api.getRaw('api/v1/users/by-birthday', { fecha_cumple }).pipe(map((r) => r?.data ?? r));
  }

  /**
   * Cambiar contraseña del usuario autenticado. Requiere contraseña actual y nueva.
   */
  changeMyPassword(current_password: string, new_password: string): Observable<any> {
    return this.api.put('api/v1/users/me/password', { current_password, new_password });
  }

  /**
   * Actualizar datos personales del usuario autenticado (person).
   * Solo campos permitidos: gender, birth_date, cel_number, email, address, district, province, region, civil_status.
   */
  updateMyPerson(data: Partial<{
    gender: string;
    birth_date: string | null;
    cel_number: string;
    email: string;
    address: string;
    district: string;
    province: string;
    region: string;
    civil_status: string | null;
  }>): Observable<any> {
    return this.api.put('api/v1/users/me/person', data).pipe(map((r) => r?.data ?? r));
  }

  addUser(u: User): Observable<any> {
    return this.api.post('api/v1/users', u);
  }

  updateUser(u: User): Observable<any> {
    return this.api.put(`api/v1/users/${(u as any).user_id}`, u);
  }

  // ==================== PERSONS ====================

  /**
   * Lista todas las personas (persons, para mascotas/residentes) con filtros opcionales.
   * without_user=1: solo personas que aún no tienen usuario (para "Dar acceso").
   */
  getPersons(params?: { 
    fecha_cumple?: string; 
    status?: string;
    house_id?: number;
    without_user?: number;
  }): Observable<any> {
    return this.api.getRaw('api/v1/persons', params);
  }

  /**
   * Crear usuario a partir de una persona existente (dar acceso al sistema).
   * POST api/v1/users/from-person
   */
  createUserFromPerson(body: { person_id: number; username_system: string; password_system: string; role_system: string; force_password_change?: number }): Observable<any> {
    return this.api.post('api/v1/users/from-person', body);
  }

  /**
   * Obtiene persona por ID
   */
  getPersonById(user_id: number): Observable<any> {
    return this.api.getRaw('api/v1/users', { user_id });
  }

  /**
   * Busca persona por número de documento
   */
  getPersonByDocNumber(doc_number: string): Observable<any> {
    return this.api.getRaw('api/v1/users', { doc_number });
  }

  /**
   * Filtra personas por status de validación
   */
  getPersonsByStatus(status: 'PERMITIDO' | 'OBSERVADO' | 'DENEGADO'): Observable<any> {
    return this.api.getRaw('api/v1/users', { status });
  }

  /**
   * Obtiene cumpleaños del mes/día
   */
  getPersonsByBirthday(fecha_cumple: string): Observable<any> {
    return this.api.getRaw('api/v1/users/by-birthday', { fecha_cumple });
  }

  /**
   * Obtiene personas por ID de casa
   */
  getPersonsByHouseId(house_id: number): Observable<any> {
    return this.api.getRaw('api/v1/users', { house_id });
  }

  /**
   * Crea una nueva persona
   */
  createPerson(person: Partial<User>): Observable<any> {
    return this.api.post('api/v1/persons', person);
  }

  /**
   * Actualizar una persona
   */
  updatePerson(person_id: number, person: Partial<User>): Observable<any> {
    return this.api.put(`api/v1/persons/${person_id}`, person);
  }

  /**
   * Elimina una persona (soft delete)
   */
  deletePerson(user_id: number): Observable<any> {
    return this.api.delete(`api/v1/users/${user_id}`);
  }

  // ==================== RENIEC ====================

  /**
   * Consultar datos de RENIEC usando token desde environment
   */
  getUserFromReniec(doc_number: string): Observable<any> {
    const reniecToken = environment.reniecApiToken || '';
    const url = `${this.reniecApiUrl}/${doc_number}?api_token=${reniecToken}`;
    return this.http.get(url);
  }
}
