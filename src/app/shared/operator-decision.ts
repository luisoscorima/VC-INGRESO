export type OperatorDecision =
  | 'CONSULTADO_PROPIETARIO'
  | 'AUTORIZADO_POR_PROPIETARIO'
  | 'RECHAZO_CONFIRMADO'
  | 'SIN_DOMICILIO';

/** Opciones del desplegable en garita. «Sin domicilio» vive solo en el checkbox de casa. */
export const OPERATOR_DECISION_OPTIONS: { value: OperatorDecision | ''; label: string }[] = [
  { value: '', label: 'Sin registrar' },
  { value: 'CONSULTADO_PROPIETARIO', label: 'Consulté al propietario' },
  { value: 'AUTORIZADO_POR_PROPIETARIO', label: 'Autorizado por propietario' },
  { value: 'RECHAZO_CONFIRMADO', label: 'Rechazo confirmado' },
];

const LABELS: Record<OperatorDecision, string> = {
  CONSULTADO_PROPIETARIO: 'Consulté al propietario',
  AUTORIZADO_POR_PROPIETARIO: 'Autorizado por propietario',
  RECHAZO_CONFIRMADO: 'Rechazo confirmado',
  SIN_DOMICILIO: 'Sin domicilio / no aplica',
};

export function operatorDecisionLabel(value: string | null | undefined): string {
  if (!value || !value.trim()) {
    return '—';
  }
  const key = value.trim().toUpperCase() as OperatorDecision;
  return LABELS[key] ?? value;
}

export function isAttentionScanStatus(status: string | null | undefined): boolean {
  const s = String(status ?? '').trim().toUpperCase();
  return s === 'DENEGADO' || s === 'OBSERVADO' || s === 'RESTRINGIDO';
}

/** Desplegable de decisión: solo en resultados que requieren acción humana. */
export function shouldShowOperatorDecision(status: string | null | undefined): boolean {
  return isAttentionScanStatus(status);
}

export function isNoHouseDecision(value: string | null | undefined): boolean {
  return String(value ?? '').trim().toUpperCase() === 'SIN_DOMICILIO';
}

/** Quita SIN_DOMICILIO del select (sigue existiendo en historial de registros viejos). */
export function normalizeOperatorDecisionForForm(value: string | null | undefined): OperatorDecision | '' {
  const v = String(value ?? '').trim().toUpperCase();
  if (v === 'CONSULTADO_PROPIETARIO' || v === 'AUTORIZADO_POR_PROPIETARIO' || v === 'RECHAZO_CONFIRMADO') {
    return v;
  }
  return '';
}
