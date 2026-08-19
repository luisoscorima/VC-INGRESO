export type OperatorDecision =
  | 'CONSULTADO_PROPIETARIO'
  | 'AUTORIZADO_POR_PROPIETARIO'
  | 'RECHAZO_CONFIRMADO'
  | 'SIN_DOMICILIO';

export const OPERATOR_DECISION_OPTIONS: { value: OperatorDecision | ''; label: string }[] = [
  { value: '', label: 'Sin registrar' },
  { value: 'CONSULTADO_PROPIETARIO', label: 'Consulté al propietario' },
  { value: 'AUTORIZADO_POR_PROPIETARIO', label: 'Autorizado por propietario' },
  { value: 'RECHAZO_CONFIRMADO', label: 'Rechazo confirmado' },
  { value: 'SIN_DOMICILIO', label: 'Sin domicilio / no aplica' },
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
