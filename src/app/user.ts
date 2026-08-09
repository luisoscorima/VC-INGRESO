import { IdentityDocumentType } from './shared/identity-document';

/**
 * Modelo de vista (no es una sola tabla).
 *
 * - **persons**: plantilla global de la persona (identidad: documento, RENIEC, contacto, domicilio,
 *   person_type, house_id, foto, etc.). Toda persona del barrio está en `persons`.
 * - **users**: solo quienes tienen acceso al sistema (login). Contiene credenciales y parámetros
 *   de sistema (role_system, username_system, password_system, force_password_change, …), no datos
 *   personales; se enlaza a `persons` por `person_id` (relación 1:1 cuando existe acceso).
 *
 * Los formularios suelen necesitar ambos conjuntos; por eso esta clase mezcla campos de ambas fuentes.
 */
export class User {
  constructor(
    public type_doc: IdentityDocumentType | string,
    public doc_number: string,
    public first_name: string,
    public paternal_surname: string,
    public maternal_surname: string,
    public gender: string,
    public birth_date: string,
    public cel_number: string,
    public email: string,
    /** Tabla `users`: rol en el sistema (no confundir con person_type en persons). */
    public role_system: string,
    public username_system: string,
    public password_system: string,
    /** En API/BD suele persistirse como `persons.person_type` (PROPIETARIO, RESIDENTE, …). */
    public property_category: string,
    public person_type: string,
    public house_id: number,
    public photo_url: string,
    /** Pueden existir en persons y/o users según el endpoint (validación de identidad vs estado de cuenta). */
    public status_validated: string,
    public status_reason: string,
    public status_system: string,
    public civil_status: string,
    public address_reniec: string,
    public district: string,
    public province: string,
    public region: string,
    // Opcionales, por si no siempre están presentes
    public block_house?: string,
    public lot?: number,
    public apartment?: string,
    /** Tabla `users` */
    public user_id?: number,
    /** Tabla `users`: obligar cambio de contraseña en próximo login. */
    public force_password_change?: number | boolean
  ) { }

  /** Crea un User vacío (todos los campos por defecto). Evita errores de conteo de argumentos. */
  static empty(): User {
    return new User(
      '', '', '', '', '', '', '', '', '', '', '', '', '','',
      0,
      '', '', '', '', '', '', '', '', '', '', 
      0, '', 0, 0
    );
  }
}
