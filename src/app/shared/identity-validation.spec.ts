import {
  inferIdentityDocumentType,
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
    expect(normalizeIdentityDocument('CE', ' ab1234567 ')).toBe('AB1234567');
    expect(isValidIdentityDocument('CE', 'ab1234567')).toBeTrue();
    expect(isValidIdentityDocument('CE', '123456789')).toBeTrue();
    expect(isValidIdentityDocument('CE', 'N12345678')).toBeTrue();
    expect(isValidIdentityDocument('CE', 'ab12345')).toBeFalse();
    expect(isValidIdentityDocument('CE', '12345678')).toBeFalse();
    expect(isValidIdentityDocument('CE', 'ABC-123')).toBeFalse();
  });

  it('infiere DNI con 8 dígitos y CE con 9 a 12 caracteres', () => {
    expect(inferIdentityDocumentType('12345678')).toBe('DNI');
    expect(inferIdentityDocumentType('123456789')).toBe('CE');
    expect(inferIdentityDocumentType('n12345678')).toBe('CE');
    expect(inferIdentityDocumentType('1234567')).toBeNull();
  });
});
