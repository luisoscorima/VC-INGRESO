import { isAttentionScanStatus } from './operator-decision';

const SCAN_STATUS_LABELS = ['PERMITIDO', 'DENEGADO', 'RESTRINGIDO', 'OBSERVADO'] as const;

export function hasAccessLogDetails(row: Record<string, unknown>): boolean {
  if (String(row['operator_notes'] ?? '').trim()) {
    return true;
  }
  if (String(row['operator_decision'] ?? '').trim()) {
    return true;
  }
  if (Array.isArray(row['access_photo_urls']) && row['access_photo_urls'].length > 0) {
    return true;
  }
  if (String(row['access_photo_url'] ?? row['photo_url'] ?? '').trim()) {
    return true;
  }
  return false;
}

export function accessDetailsActionLabel(row: Record<string, unknown>): string {
  return hasAccessLogDetails(row) ? 'Editar detalle' : 'Agregar detalle';
}

export function parseAccessLogScanStatus(row: Record<string, unknown>): string {
  const observation = String(row['observation_raw'] ?? row['obs'] ?? '').toUpperCase();
  const found = SCAN_STATUS_LABELS.find((status) =>
    new RegExp(`(^|\\|)\\s*${status}\\b`).test(observation)
  );
  if (found) {
    return found;
  }
  const obs = String(row['obs'] ?? '').trim();
  return obs && obs !== '—' ? obs.split('|')[0]?.trim() || '—' : '—';
}

/** Muestra checkbox «Persona ingresó ahora» tras autorización del propietario en scan no permitido. */
export function canOfferAuthorizeEntry(opts: {
  scanStatus: string;
  operatorDecision: string;
  authorizedLogId?: number | null;
}): boolean {
  if (opts.authorizedLogId != null && Number(opts.authorizedLogId) !== 0) {
    return false;
  }
  if (String(opts.operatorDecision ?? '').trim() !== 'AUTORIZADO_POR_PROPIETARIO') {
    return false;
  }
  return isAttentionScanStatus(opts.scanStatus);
}

/** Visitas externas (log_ref negativo) exigen domicilio al autorizar ingreso. */
export function requiresHouseForAuthorizeEntry(logRef: number): boolean {
  return logRef < 0;
}

export function accessLogRowLabel(row: Record<string, unknown>): string {
  const name = String(row['name'] ?? row['display_name_snapshot'] ?? '').trim();
  if (name && name !== '—') {
    return name;
  }
  const plate = String(row['license_plate_snapshot'] ?? row['vehicle_plate'] ?? '').trim();
  if (plate && plate !== '—') {
    return plate.toUpperCase();
  }
  const doc = String(row['doc_number'] ?? '').trim();
  return doc || 'Sin identificar';
}
