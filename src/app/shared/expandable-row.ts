/** Identificador de fila expandida en tablas móviles (null = ninguna). */
export type ExpandableRowId = string | number | null;

export function toggleExpandableRow(current: ExpandableRowId, id: string | number): ExpandableRowId {
  return current === id ? null : id;
}

export function isExpandableRowOpen(current: ExpandableRowId, id: string | number): boolean {
  return current === id;
}
