import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export interface LicensePlateParseResult {
  canonical: string;
  valid: boolean;
}

export function parsePeruvianLicensePlate(value: unknown): LicensePlateParseResult {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw || !/^[A-Z0-9 -]+$/.test(raw)) {
    return { canonical: '', valid: false };
  }
  const canonical = raw.replace(/[ -]+/g, '');
  return { canonical, valid: /^[A-Z0-9]{6}$/.test(canonical) };
}

export function normalizePeruvianLicensePlate(value: unknown): string {
  return parsePeruvianLicensePlate(value).canonical;
}

export function isValidPeruvianLicensePlate(value: unknown): boolean {
  return parsePeruvianLicensePlate(value).valid;
}

export const peruvianLicensePlateValidator: ValidatorFn = (
  control: AbstractControl
): ValidationErrors | null =>
  control.value == null || control.value === '' || isValidPeruvianLicensePlate(control.value)
    ? null
    : { peruvianLicensePlate: true };

export const PERUVIAN_LICENSE_PLATE_ERROR =
  'Ingrese una placa peruana de 6 letras o números. Puede usar espacios o guion.';
