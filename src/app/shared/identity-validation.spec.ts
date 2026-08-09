import {
  isValidIdentityDocument,
  normalizeIdentityDocument,
} from './identity-document';
import {
  isValidPeruvianLicensePlate,
  normalizePeruvianLicensePlate,
} from './license-plate';

describe('contrato de identidad', () => {
  it('normaliza y valida placas peruanas', () => {
    for (const value of ['ABC123', 'ABC-123', 'AB-1234']) {
      expect(isValidPeruvianLicensePlate(value)).toBeTrue();
      expect(normalizePeruvianLicensePlate(value).length).toBe(6);
    }
    for (const value of ['ABC12', 'ABC1234', 'ABC.123', 'ABC/123', 'ABC_123', 'ABÑ123']) {
      expect(isValidPeruvianLicensePlate(value)).toBeFalse();
    }
  });

  it('valida DNI y conserva CE alfanumérico', () => {
    expect(isValidIdentityDocument('DNI', '12345678')).toBeTrue();
    expect(isValidIdentityDocument('DNI', '1234567')).toBeFalse();
    expect(normalizeIdentityDocument('CE', ' ab12345 ')).toBe('AB12345');
    expect(isValidIdentityDocument('CE', 'ab12345')).toBeTrue();
    expect(isValidIdentityDocument('CE', 'ABC-123')).toBeFalse();
    expect(isValidIdentityDocument('CE', '12345678')).toBeTrue();
  });
});
