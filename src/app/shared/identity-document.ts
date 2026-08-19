import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export type IdentityDocumentType = 'DNI' | 'CE';

export const IDENTITY_DOCUMENT_TYPES: readonly IdentityDocumentType[] = ['DNI', 'CE'];

export function normalizeIdentityDocumentType(value: unknown): IdentityDocumentType | null {
  const type = String(value ?? '').trim().toUpperCase();
  return type === 'DNI' || type === 'CE' ? type : null;
}

export function normalizeIdentityDocument(type: IdentityDocumentType, value: unknown): string {
  const normalized = String(value ?? '').trim();
  return type === 'CE' ? normalized.toUpperCase() : normalized;
}

export function isValidIdentityDocument(type: IdentityDocumentType, value: unknown): boolean {
  const normalized = normalizeIdentityDocument(type, value);
  return type === 'DNI' ? /^[0-9]{8}$/.test(normalized) : /^[A-Z0-9]{9,12}$/.test(normalized);
}

/** 8 dígitos = DNI; 9–12 alfanuméricos = CE. */
export function inferIdentityDocumentType(value: unknown): IdentityDocumentType | null {
  const raw = String(value ?? '').trim();
  if (isValidIdentityDocument('DNI', raw)) {
    return 'DNI';
  }
  if (isValidIdentityDocument('CE', raw)) {
    return 'CE';
  }
  return null;
}

export function canLookupReniec(type: IdentityDocumentType | null, value: unknown): boolean {
  return type === 'DNI' && isValidIdentityDocument('DNI', value);
}

export function identityDocumentValidator(typeControl: AbstractControl): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const type = normalizeIdentityDocumentType(typeControl.value);
    if (!type || !isValidIdentityDocument(type, control.value)) {
      return { identityDocument: true };
    }
    return null;
  };
}

export function identityDocumentError(type: IdentityDocumentType | null): string {
  return type === 'DNI'
    ? 'El DNI debe contener exactamente 8 dígitos.'
    : 'El CE debe contener entre 9 y 12 letras o números.';
}
