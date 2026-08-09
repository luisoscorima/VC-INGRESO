import { normalizePeruvianLicensePlate } from './shared/license-plate';

/**
 * Catálogo único de tipos de vehículo (registro público, Mi casa, administración).
 * Placa obligatoria salvo BICICLETA y MOTO ELECTRICA; en esos casos la foto del vehículo es obligatoria.
 */

export const VEHICLE_TYPE_VALUES: readonly string[] = [
  'AUTOMOVIL',
  'MOTOCICLETA',
  'MOTO ELECTRICA',
  'CAMIONETA',
  'CAMION',
  'MINIVAN',
  'MINI BUS',
  'MOTOTAXI',
  'FURGONETA',
  'BICICLETA'
] as const;

/** Opciones UI: botones (público) o referencia de etiquetas */
export const VEHICLE_TYPE_OPTIONS: { value: string; label: string; icon: string }[] = [
  { value: 'AUTOMOVIL', label: 'Automóvil', icon: '🚗' },
  { value: 'MOTOCICLETA', label: 'Motocicleta', icon: '🏍️' },
  { value: 'MOTO ELECTRICA', label: 'Moto eléctrica', icon: '⚡' },
  { value: 'CAMIONETA', label: 'Camioneta', icon: '🛻' },
  { value: 'CAMION', label: 'Camión', icon: '🚚' },
  { value: 'MINIVAN', label: 'Minivan', icon: '🚐' },
  { value: 'MINI BUS', label: 'Minibús', icon: '🚌' },
  { value: 'MOTOTAXI', label: 'Mototaxi', icon: '🛵' },
  { value: 'FURGONETA', label: 'Furgoneta', icon: '🚐' },
  { value: 'BICICLETA', label: 'Bicicleta', icon: '🚲' }
];

export function vehicleTypeRequiresLicensePlate(type: string | null | undefined): boolean {
  const t = (type ?? '').trim().toUpperCase();
  return t !== 'BICICLETA' && t !== 'MOTO ELECTRICA';
}

/** Si no llevan placa legal, deben identificarse por foto */
export function vehicleTypeRequiresVehiclePhoto(type: string | null | undefined): boolean {
  return !vehicleTypeRequiresLicensePlate(type);
}

/** Normalización alfanumérica de placa (solo A-Z0-9) para comparar duplicados en cliente */
export function normalizeLicensePlateClient(raw: string | null | undefined): string {
  return normalizePeruvianLicensePlate(raw);
}
