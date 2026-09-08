import { Component, Inject, OnInit } from '@angular/core';
import { AccessLogService } from '../access-log.service';
import { Visit } from '../visit';
import { MatDialog, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MAT_TOOLTIP_DEFAULT_OPTIONS, MatTooltipDefaultOptions } from '@angular/material/tooltip';
import { Item } from '../item';
import { animate, state, style, transition, trigger } from '@angular/animations';
import { ToastrService } from 'ngx-toastr';
import { EntranceService } from '../entrance.service';
import { AuthService } from '../auth.service';
import { NavPermissionService } from '../nav-permission.service';
import { AccessIncident, AccessIncidentService, buildScanContextFromHistoryRow } from '../incidents/access-incident.service';
import { IncidentFormDialogComponent, INCIDENT_DIALOG_PANEL_CLASS } from '../incidents/incident-form-dialog.component';
import { ApiService } from '../api.service';
import { todayYmdInAppTimeZone } from '../app-date.util';
import { operatorDecisionLabel, OperatorDecision } from '../shared/operator-decision';
import {
  accessDetailsActionLabel,
  accessLogRowLabel,
  hasAccessLogDetails,
  hasEffectiveEntry,
  parseAccessLogScanStatus,
} from '../shared/access-details.util';
import {
  AccessDetailsDialogComponent,
  ACCESS_DETAILS_DIALOG_PANEL_CLASS,
} from '../qr/access-details-dialog.component';
import * as XLSX from 'xlsx';
import {
  ExpandableRowId,
  isExpandableRowOpen,
  toggleExpandableRow,
} from '../shared/expandable-row';
import {
  extractDocAndPlateFromPhotos,
  PhotoOcrExtractResult,
} from '../shared/photo-ocr';
import { firstValueFrom } from 'rxjs';

export interface HistoryAccessPointOption {
  id: number;
  label: string;
}

interface HistoryRow extends Record<string, unknown> {
  entity_kind?: 'PERSON' | 'VEHICLE' | null;
  type?: 'PERSONA' | 'VEHÍCULO' | string | null;
  display_name_snapshot?: string | null;
  document_snapshot?: string | null;
  license_plate_snapshot?: string | null;
  identity_source?: 'LOCAL' | 'RENIEC' | 'LEGACY' | null;
}
type HistoryResultStatus = 'PERMITIDO' | 'DENEGADO' | 'RESTRINGIDO' | 'OBSERVADO' | '—';

/** En móvil el long-press del tooltip cancela el pan horizontal de la tabla. */
const HISTORY_TOOLTIP_OPTIONS: MatTooltipDefaultOptions = {
  showDelay: 0,
  hideDelay: 0,
  touchendHideDelay: 1500,
  touchGestures: 'off',
  disableTooltipInteractivity: true,
};

const HISTORY_RESULT_STATUSES: HistoryResultStatus[] = [
  'PERMITIDO',
  'DENEGADO',
  'RESTRINGIDO',
  'OBSERVADO',
];

function parseResultStatus(row: HistoryRow): HistoryResultStatus {
  const observation = String(row['observation_raw'] ?? row['obs'] ?? '').toUpperCase();
  const status = HISTORY_RESULT_STATUSES.find((candidate) =>
    new RegExp(`(^|\\|)\\s*${candidate}\\b`).test(observation)
  );
  if (status) {
    return status;
  }
  return String(row['entry_source'] ?? '').toLowerCase() === 'camera' &&
    /INGRESO\s+AUTOM[AÁ]TICO\s+LPR/i.test(observation)
    ? 'PERMITIDO'
    : '—';
}

function parseDisplayPlate(row: HistoryRow): string {
  const plate = String(row.license_plate_snapshot ?? row['vehicle_plate'] ?? '').trim();
  if (plate && plate !== '—') {
    return plate.toUpperCase();
  }
  const observation = String(row['observation_raw'] ?? row['obs'] ?? '');
  return observation.match(/\bplaca\s+([a-z0-9-]+)/i)?.[1]?.toUpperCase() ?? '—';
}

/** Salida real cerrada en access_logs (marcador SALIDA en observación). */
function hasSalidaObservation(row: HistoryRow): boolean {
  const observation = String(row['observation_raw'] ?? row['obs'] ?? '').trim();
  if (!observation) {
    return false;
  }
  return observation
    .split('|')
    .map((part) => part.trim())
    .some((part) => /^SALIDA(\s*:|$)/i.test(part));
}

function parseResultNotes(row: HistoryRow): string[] {
  const observation = String(row['observation_raw'] ?? row['obs'] ?? '').trim();
  if (!observation) {
    return [];
  }

  return observation
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const normalized = part.toUpperCase();
      if (
        HISTORY_RESULT_STATUSES.includes(normalized as HistoryResultStatus) ||
        normalized === 'QR' ||
        normalized === 'MANUAL' ||
        normalized === 'SALIDA' ||
        /^PLACA\s+/i.test(part) ||
        /^INGRESO\s+AUTOM[AÁ]TICO\s+LPR/i.test(part)
      ) {
        return '';
      }
      if (/^CUMPLEA[NÑ]OS$/i.test(part)) {
        return 'Cumpleaños';
      }
      if (/^VEH\.?\s*EXT\.?\s*#/i.test(part)) {
        return `Veh. externo ${part.replace(/^VEH\.?\s*EXT\.?\s*/i, '')}`;
      }
      if (/^SALIDA\s*:/i.test(part)) {
        return part.replace(/^SALIDA\s*:/i, '').trim();
      }
      return part;
    })
    .filter((note): note is string => Boolean(note));
}

@Component({
  selector: 'app-history',
  templateUrl: './history.component.html',
  styleUrls: ['./history.component.css'],
  providers: [{ provide: MAT_TOOLTIP_DEFAULT_OPTIONS, useValue: HISTORY_TOOLTIP_OPTIONS }],
  animations: [
    trigger('detailExpand', [
      state('collapsed', style({ height: '0px', minHeight: '0', display: 'none' })),
      state('expanded', style({ height: '*' })),
      transition('expanded <=> collapsed', animate('225ms cubic-bezier(0.4, 0.0, 0.2, 1)')),
    ]),
  ],
})
export class HistoryComponent implements OnInit {
  expandedElement!: Item;

  fecha_inicial!: Date;
  fecha_final!: Date;

  access_point: number | null = null;

  accessPointOptions: HistoryAccessPointOption[] = [];

  loading = false;
  /** Ignora respuestas obsoletas si el usuario cambia filtros mientras carga. */
  private historyRequestSeq = 0;

  /** Filas crudas del API */
  allRows: HistoryRow[] = [];

  /** Total reportado por el servidor (antes de filtros locales). */
  serverTotal = 0;

  /** true = la página actual viene del servidor; false = filtros locales sobre un tope de 500. */
  private serverPagingActive = true;

  filterQuery = '';
  sourceFilter: '' | 'manual' | 'qr' | 'camera' = '';
  sortKey: keyof HistoryRow | string = 'date_entry';
  sortAsc = false;

  pageIndex = 0;
  pageSize = 50;

  readonly pageSizeOptions = [25, 50, 100, 200];

  private get hasLocalFilter(): boolean {
    return !!(this.filterQuery.trim() || this.sourceFilter);
  }

  /** Columna documento: solo personal (admin/operario), no vecinos USUARIO. */
  showDocColumn = true;

  showIncidentsColumn = false;

  /** Staff con permiso manage: puede registrar incidencias desde historial o escáner. */
  canCreateIncident = false;

  /** Staff: puede agregar o editar detalle de acceso (nota, decisión, fotos). */
  canEditAccessDetails = false;

  /** Backfill OCR en curso (lote histórico). */
  ocrBackfillRunning = false;
  ocrBackfillCurrent = 0;
  ocrBackfillTotal = 0;

  readonly hasAccessLogDetails = hasAccessLogDetails;
  readonly accessDetailsActionLabel = accessDetailsActionLabel;

  expandedHistoryRowId: ExpandableRowId = null;

  /** Vista detalle (nota + fotos semigrandes), estilo incidencias. */
  accessMediaOpen = false;
  accessMediaRow: HistoryRow | null = null;
  accessMediaIndex = 0;

  /** Visor ampliado con zoom + navegación. */
  photoZoomOpen = false;
  photoZoom = 1;
  photoZoomUrls: string[] = [];
  photoZoomIndex = 0;
  photoZoomTitle = '';
  private readonly zoomMin = 0.5;
  private readonly zoomMax = 3;
  private readonly zoomStep = 0.25;

  get historyTableColspan(): number {
    let cols = this.showDocColumn ? 13 : 12;
    if (this.canEditAccessDetails) {
      cols += 1; // columna OCR (ojo)
    }
    if (this.hasExternalRows) {
      cols += 1;
    }
    if (this.showIncidentsColumn || this.canCreateIncident) {
      cols += 1;
    }
    if (this.showDayColumn) {
      cols += 1;
    }
    return cols;
  }

  /** Columna Día: solo si hay al menos un documento con varios movimientos el mismo día. */
  get showDayColumn(): boolean {
    return this.showDocColumn && this.filteredRows.some((r) => this.sameDayCount(r) > 1);
  }

  constructor(
    private accessLogService: AccessLogService,
    private entranceService: EntranceService,
    public dialog: MatDialog,
    private toastr: ToastrService,
    private auth: AuthService,
    private navPerm: NavPermissionService,
    private incidentService: AccessIncidentService,
    private api: ApiService
  ) {}

  get filteredRows(): HistoryRow[] {
    let rows = [...this.allRows];
    if (this.sourceFilter) {
      rows = rows.filter((r) => String(r['entry_source'] ?? 'manual').toLowerCase() === this.sourceFilter);
    }
    const f = this.filterQuery.trim().toLowerCase();
    if (f) {
      rows = rows.filter((r) =>
        Object.values(r)
          .filter((v) => v != null && v !== '')
          .some((v) => String(v).toLowerCase().includes(f))
      );
    }
    const key = this.sortKey;
    const dir = this.sortAsc ? 1 : -1;
    rows.sort((a, b) => {
      const va =
        key === 'result_status'
          ? this.resultStatus(a)
          : key === 'display_plate'
            ? this.displayPlate(a)
            : a[key as string];
      const vb =
        key === 'result_status'
          ? this.resultStatus(b)
          : key === 'display_plate'
            ? this.displayPlate(b)
            : b[key as string];
      const sa = va == null ? '' : String(va);
      const sb = vb == null ? '' : String(vb);
      if (sa < sb) {
        return -1 * dir;
      }
      if (sa > sb) {
        return 1 * dir;
      }
      return 0;
    });
    return rows;
  }

  get pagedRows(): HistoryRow[] {
    if (this.serverPagingActive && !this.hasLocalFilter) {
      return this.filteredRows;
    }
    const start = this.pageIndex * this.pageSize;
    return this.filteredRows.slice(start, start + this.pageSize);
  }

  get totalFiltered(): number {
    if (this.serverPagingActive && !this.hasLocalFilter) {
      return this.serverTotal;
    }
    return this.filteredRows.length;
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.totalFiltered / this.pageSize));
  }

  get displayRangeEnd(): number {
    if (!this.totalFiltered) {
      return 0;
    }
    return this.pageIndex * this.pageSize + this.pagedRows.length;
  }

  get fechaInicialInput(): string {
    return this.toYmd(this.fecha_inicial) ?? '';
  }

  get fechaFinalInput(): string {
    return this.toYmd(this.fecha_final) ?? '';
  }

  onFechaInicialInput(s: string): void {
    if (s) {
      this.fecha_inicial = new Date(s + 'T12:00:00');
    }
    this.pageIndex = 0;
    this.onDateRangeChange();
  }

  onFechaFinalInput(s: string): void {
    if (s) {
      this.fecha_final = new Date(s + 'T12:00:00');
    }
    this.pageIndex = 0;
    this.onDateRangeChange();
  }

  get hasExternalRows(): boolean {
    return this.filteredRows.some((r) => String(r['log_source'] ?? '').toUpperCase() === 'EXTERNAL');
  }

  isExternalRow(r: HistoryRow): boolean {
    return String(r['log_source'] ?? '').toUpperCase() === 'EXTERNAL';
  }

  formatPermanence(r: HistoryRow): string {
    if (!this.isExternalRow(r)) {
      return '—';
    }
    if (this.isExternalAttemptWithoutStay(r)) {
      return '—';
    }
    const mins = r['permanence_minutes'];
    if (mins == null || mins === '') {
      return '—';
    }
    const n = Number(mins);
    if (!Number.isFinite(n)) {
      return '—';
    }
    const open = Number(r['session_open']) === 1;
    const exceeded = Number(r['stay_exceeded']) === 1;
    let label = open ? `Aún dentro — ${n} min` : `${n} min`;
    if (exceeded) {
      label += ' (excedió)';
    }
    return label;
  }

  onFilterInput(value: string): void {
    const hadFilter = this.hasLocalFilter;
    this.filterQuery = value;
    this.pageIndex = 0;
    this.expandedHistoryRowId = null;
    if (hadFilter !== this.hasLocalFilter) {
      // El filtro local ya aplica sobre allRows; no bloquear la UI con overlay.
      this.fetchHistory({ silent: true });
    }
  }

  getHistoryRowId(a: HistoryRow): string {
    return `${a['doc_number'] ?? ''}-${a['date_entry'] ?? ''}-${a['access_point_name'] ?? ''}`;
  }

  isHistoryRowOpen(a: HistoryRow): boolean {
    return isExpandableRowOpen(this.expandedHistoryRowId, this.getHistoryRowId(a));
  }

  toggleHistoryRow(a: HistoryRow): void {
    this.expandedHistoryRowId = toggleExpandableRow(
      this.expandedHistoryRowId,
      this.getHistoryRowId(a)
    );
  }

  toggleSort(key: string): void {
    if (this.sortKey === key) {
      this.sortAsc = !this.sortAsc;
    } else {
      this.sortKey = key;
      this.sortAsc = key === 'date_entry' || key === 'date_exit' ? false : true;
    }
  }

  sortIndicator(key: string): string {
    if (this.sortKey !== key) {
      return '';
    }
    return this.sortAsc ? '↑' : '↓';
  }

  goPrevPage(): void {
    this.pageIndex = Math.max(0, this.pageIndex - 1);
    this.expandedHistoryRowId = null;
    if (this.serverPagingActive && !this.hasLocalFilter) {
      this.fetchHistory();
    }
  }

  goNextPage(): void {
    this.pageIndex = Math.min(this.totalPages - 1, this.pageIndex + 1);
    this.expandedHistoryRowId = null;
    if (this.serverPagingActive && !this.hasLocalFilter) {
      this.fetchHistory();
    }
  }

  onPageSizeChange(): void {
    this.pageIndex = 0;
    this.expandedHistoryRowId = null;
    this.fetchHistory();
  }

  exportExcel(): void {
    const rows = this.hasLocalFilter
      ? this.filteredRows
      : this.serverPagingActive && this.serverTotal > this.allRows.length
        ? this.allRows
        : this.filteredRows;
    if (!rows.length) {
      this.toastr.warning('No hay datos para exportar.');
      return;
    }
    if (this.serverPagingActive && !this.hasLocalFilter && this.serverTotal > rows.length) {
      this.toastr.info(
        `Se exportan ${rows.length} filas de esta página. Amplía el tamaño de página o filtra para acotar.`
      );
    }
    const data = rows.map((r) => ({
      TIPO: r['type'],
      ...(this.showDocColumn ? { DOCUMENTO: r['doc_number'] } : {}),
      DATOS: r['name'],
      PLACA: this.displayPlate(r),
      DOMICILIO: r['house_address'],
      PUNTO_ACCESO: r['access_point_name'],
      ORIGEN: this.entrySourceLabel(r),
      INGRESO: r['date_entry'],
      SALIDA: r['date_exit'] ?? '',
      PERMANENCIA_MIN: this.permanenceMinutes(r) ?? '',
      EXCEDIO_ESTADIA: Number(r['stay_exceeded']) === 1 ? 'Sí' : 'No',
      RESULTADO: this.resultStatus(r),
      DECISION: this.operatorDecisionText(r) || '—',
      NOTAS_SISTEMA: this.resultNotes(r).join(' · '),
      NOTAS_OPERARIO: String(r['operator_notes'] ?? '').trim(),
      DNI_FOTO: String(r['photo_doc_number'] ?? '').trim(),
      PLACA_FOTO: String(r['photo_license_plate'] ?? '').trim(),
      NOMBRES_FOTO: String(r['photo_first_names'] ?? '').trim(),
      APELLIDOS_FOTO: String(r['photo_last_names'] ?? '').trim(),
      OPERARIO: r['operator'],
      DETALLE: this.detailPreviewText(r)
        ? `${this.detailPreviewText(r)}${this.capturePhotoUrls(r).length ? ` · ${this.capturePhotoUrls(r).length} foto(s)` : ''}`
        : this.capturePhotoUrls(r).length
          ? `${this.capturePhotoUrls(r).length} foto(s)`
          : '—',
      ...(this.showIncidentsColumn
        ? {
            INCIDENCIAS: this.rowIncidentCount(r),
            INCIDENCIA_DESCRIPCION: this.incidentPreviewDescription(r),
          }
        : {}),
      ...(this.showDayColumn ? { MOVIMIENTOS_DIA: this.sameDayCount(r) } : {}),
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Historial');
    XLSX.writeFile(wb, 'Reporte_ingresos_por_fecha.xlsx');
  }

  onAccessPointChange(): void {
    this.pageIndex = 0;
    this.expandedHistoryRowId = null;
    this.fetchHistory();
  }

  onSourceFilterChange(): void {
    this.pageIndex = 0;
    this.expandedHistoryRowId = null;
    this.fetchHistory({ silent: true });
  }

  entrySourceLabel(row: HistoryRow): string {
    const source = String(row['entry_source'] ?? 'manual').toLowerCase();
    return source === 'camera' ? 'Cámara' : source === 'qr' ? 'QR' : 'Manual';
  }

  isCameraRow(row: HistoryRow): boolean {
    return String(row['entry_source'] ?? '').toLowerCase() === 'camera';
  }

  isVehicleRow(row: HistoryRow): boolean {
    const kind = String(row.entity_kind ?? '').toUpperCase();
    if (kind) return kind === 'VEHICLE';
    const type = String(row.type ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    return type === 'VEHICULO';
  }

  resultStatus(row: HistoryRow): HistoryResultStatus {
    return parseResultStatus(row);
  }

  resultNotes(row: HistoryRow): string[] {
    return parseResultNotes(row);
  }

  operatorNotesText(row: HistoryRow): string {
    return String(row['operator_notes'] ?? '').trim();
  }

  operatorDecisionText(row: HistoryRow): string {
    const label = operatorDecisionLabel(String(row['operator_decision'] ?? ''));
    return label !== '—' ? label : '';
  }

  /** Texto legible en columna Detalle (nota de garita). */
  detailPreviewText(row: HistoryRow): string {
    return this.operatorNotesText(row);
  }

  capturePhotoUrls(row: HistoryRow): string[] {
    const raw = row['access_photo_urls'];
    if (Array.isArray(raw)) {
      return raw
        .map((u) => this.api.getPhotoUrl(String(u ?? '')))
        .filter((u): u is string => !!u);
    }
    const single = this.api.getPhotoUrl(String(row['access_photo_url'] ?? ''));
    return single ? [single] : [];
  }

  photoOcrStatus(row: HistoryRow): string {
    return String(row['photo_ocr_status'] ?? '').trim().toLowerCase();
  }

  photoOcrDoc(row: HistoryRow): string {
    return String(row['photo_doc_number'] ?? '').trim();
  }

  photoOcrPlate(row: HistoryRow): string {
    return String(row['photo_license_plate'] ?? '').trim();
  }

  photoOcrFirstNames(row: HistoryRow): string {
    return String(row['photo_first_names'] ?? '').trim();
  }

  photoOcrLastNames(row: HistoryRow): string {
    return String(row['photo_last_names'] ?? '').trim();
  }

  hasPhotoOcrData(row: HistoryRow): boolean {
    return !!(
      this.photoOcrDoc(row) ||
      this.photoOcrPlate(row) ||
      this.photoOcrFirstNames(row) ||
      this.photoOcrLastNames(row)
    );
  }

  /** Filas del rango/filtro actual con foto y sin OCR procesado. */
  rowsPendingPhotoOcr(): HistoryRow[] {
    return this.filteredRows.filter((row) => this.needsPhotoOcrBackfill(row));
  }

  needsPhotoOcrBackfill(row: HistoryRow): boolean {
    if (!this.capturePhotoUrls(row).length) {
      return false;
    }
    const status = this.photoOcrStatus(row);
    if (!status) {
      return true;
    }
    // Reintentar solo errores; empty/done/pending no se reescriben en lote
    return status === 'error';
  }

  get ocrBackfillPendingCount(): number {
    return this.rowsPendingPhotoOcr().length;
  }

  applyPhotoOcrToRow(row: HistoryRow, result: PhotoOcrExtractResult): void {
    row['photo_doc_number'] = result.photo_doc_number;
    row['photo_license_plate'] = result.photo_license_plate;
    row['photo_first_names'] = result.photo_first_names;
    row['photo_last_names'] = result.photo_last_names;
    row['photo_ocr_status'] = result.photo_ocr_status;
  }

  async runPhotoOcrForRow(row: HistoryRow): Promise<PhotoOcrExtractResult> {
    const logRef = Number(row['id'] ?? 0);
    const urls = this.capturePhotoUrls(row);
    if (!logRef || !urls.length) {
      return {
        photo_doc_number: null,
        photo_license_plate: null,
        photo_first_names: null,
        photo_last_names: null,
        photo_ocr_status: 'empty',
      };
    }
    const result = await extractDocAndPlateFromPhotos(urls);
    await firstValueFrom(
      this.accessLogService.patchPhotoOcr(logRef, {
        photo_doc_number: result.photo_doc_number,
        photo_license_plate: result.photo_license_plate,
        photo_first_names: result.photo_first_names,
        photo_last_names: result.photo_last_names,
        photo_ocr_status: result.photo_ocr_status,
      })
    );
    this.applyPhotoOcrToRow(row, result);
    return result;
  }

  async startPhotoOcrBackfill(): Promise<void> {
    if (!this.canEditAccessDetails || this.ocrBackfillRunning) {
      return;
    }
    const pending = this.rowsPendingPhotoOcr();
    if (!pending.length) {
      this.toastr.info('No hay registros con foto pendientes de OCR en el filtro actual.');
      return;
    }
    const maxBatch = 80;
    const batch = pending.slice(0, maxBatch);
    const confirmMsg =
      pending.length > maxBatch
        ? `Hay ${pending.length} pendientes; se procesarán los primeros ${maxBatch}.\nPuede tardar varios minutos; no cierres esta pestaña. ¿Continuar?`
        : `¿Procesar OCR en ${batch.length} registro(s) con foto del filtro actual?\nPuede tardar varios minutos; no cierres esta pestaña.`;
    if (!window.confirm(confirmMsg)) {
      return;
    }

    this.ocrBackfillRunning = true;
    this.ocrBackfillTotal = batch.length;
    this.ocrBackfillCurrent = 0;
    let done = 0;
    let empty = 0;
    let error = 0;

    try {
      for (const row of batch) {
        this.ocrBackfillCurrent += 1;
        try {
          const result = await this.runPhotoOcrForRow(row);
          if (result.photo_ocr_status === 'error') {
            error += 1;
          } else if (result.photo_ocr_status === 'empty') {
            empty += 1;
          } else {
            done += 1;
          }
        } catch (err) {
          console.warn('[photo-ocr] backfill row failed', err);
          row['photo_ocr_status'] = 'error';
          error += 1;
        }
      }
      this.toastr.success(
        `OCR histórico: ${done} con datos, ${empty} sin texto, ${error} error(es).`
      );
    } finally {
      this.ocrBackfillRunning = false;
      this.ocrBackfillCurrent = 0;
      this.ocrBackfillTotal = 0;
    }
  }

  photoOcrStatusLabel(row: HistoryRow): string {
    switch (this.photoOcrStatus(row)) {
      case 'pending':
        return 'Pendiente';
      case 'done':
        return 'Completado';
      case 'empty':
        return 'Sin texto legible';
      case 'error':
        return 'Error';
      default:
        return this.hasPhotoOcrData(row) ? 'Completado' : 'Sin procesar';
    }
  }

  viewPhotoOcr(row: HistoryRow, event?: Event): void {
    event?.stopPropagation();
    const entry = row['date_entry'] ? new Date(String(row['date_entry'])) : null;
    const exit = row['date_exit'] ? new Date(String(row['date_exit'])) : null;
    const fmt = (d: Date | null): string =>
      d && !isNaN(d.getTime())
        ? d.toLocaleString('es-PE', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '';
    const ref = this.dialog.open(DialogHistoryPhotoOcr, {
      width: 'min(440px, 96vw)',
      maxHeight: '90vh',
      data: {
        logRef: Number(row['id'] ?? 0),
        name: String(row['name'] ?? '').trim(),
        doc: String(row['doc_number'] ?? '').trim(),
        plate: this.displayPlate(row),
        house: String(row['house_address'] ?? '').trim(),
        accessPoint: String(row['access_point_name'] ?? '').trim(),
        source: this.entrySourceLabel(row),
        result: this.resultStatus(row),
        decision: this.operatorDecisionText(row),
        operatorNote: this.operatorNotesText(row),
        operator: String(row['operator'] ?? '').trim(),
        entryAt: fmt(entry),
        exitAt: this.isEgressOnlyRow(row) ? fmt(entry) : fmt(exit),
        movementLabel: this.isEgressOnlyRow(row) ? 'Egreso' : this.hasRecordedExit(row) ? 'Ingreso / egreso' : 'Ingreso',
        status: this.photoOcrStatusLabel(row),
        statusRaw: this.photoOcrStatus(row),
        photoDoc: this.photoOcrDoc(row),
        photoPlate: this.photoOcrPlate(row),
        photoFirstNames: this.photoOcrFirstNames(row),
        photoLastNames: this.photoOcrLastNames(row),
        hasData: this.hasPhotoOcrData(row),
        photoUrls: this.capturePhotoUrls(row),
        canProcess: this.canEditAccessDetails && this.capturePhotoUrls(row).length > 0,
        openZoom: (urls: string[], index: number) => this.openPhotoZoom(urls, index, 'Foto de garita'),
      },
    });
    ref.afterClosed().subscribe((result: PhotoOcrExtractResult | undefined) => {
      if (result) {
        this.applyPhotoOcrToRow(row, result);
      }
    });
  }

  displayPlate(row: HistoryRow): string {
    return parseDisplayPlate(row);
  }

  statusBadgeClass(status: HistoryResultStatus): string {
    return `history-status-badge--${status === '—' ? 'unknown' : status.toLowerCase()}`;
  }

  statusIcon(status: HistoryResultStatus): string {
    if (status === 'PERMITIDO') return 'check_circle';
    if (status === 'DENEGADO') return 'block';
    if (status === 'RESTRINGIDO' || status === 'OBSERVADO') return 'warning';
    return 'help_outline';
  }

  showHistoryPhoto(row: HistoryRow, event?: Event): void {
    event?.stopPropagation();
    const urls = this.capturePhotoUrls(row);
    if (!urls.length && !this.operatorNotesText(row) && !this.operatorDecisionText(row)) {
      return;
    }
    this.accessMediaRow = row;
    this.accessMediaIndex = 0;
    this.accessMediaOpen = true;
  }

  closeAccessMedia(): void {
    this.accessMediaOpen = false;
    this.accessMediaRow = null;
    this.accessMediaIndex = 0;
  }

  accessMediaUrls(): string[] {
    return this.accessMediaRow ? this.capturePhotoUrls(this.accessMediaRow) : [];
  }

  accessMediaCurrentUrl(): string | null {
    const urls = this.accessMediaUrls();
    return urls[this.accessMediaIndex] ?? null;
  }

  accessMediaPrev(): void {
    const n = this.accessMediaUrls().length;
    if (n <= 1) {
      return;
    }
    this.accessMediaIndex = (this.accessMediaIndex - 1 + n) % n;
  }

  accessMediaNext(): void {
    const n = this.accessMediaUrls().length;
    if (n <= 1) {
      return;
    }
    this.accessMediaIndex = (this.accessMediaIndex + 1) % n;
  }

  openPhotoZoomFromAccessMedia(): void {
    const urls = this.accessMediaUrls();
    if (!urls.length) {
      return;
    }
    this.openPhotoZoom(urls, this.accessMediaIndex, 'Foto de garita');
  }

  openPhotoZoom(urls: string[], index = 0, title = 'Foto de garita'): void {
    if (!urls.length) {
      return;
    }
    const i = Math.max(0, Math.min(index, urls.length - 1));
    this.photoZoomUrls = urls;
    this.photoZoomIndex = i;
    this.photoZoomTitle = `${title} · ${i + 1}/${urls.length}`;
    this.photoZoom = 1;
    this.photoZoomOpen = true;
  }

  closePhotoZoom(): void {
    this.photoZoomOpen = false;
    this.photoZoomUrls = [];
    this.photoZoomIndex = 0;
    this.photoZoomTitle = '';
    this.photoZoom = 1;
  }

  photoZoomCurrentUrl(): string | null {
    return this.photoZoomUrls[this.photoZoomIndex] ?? null;
  }

  photoZoomPrev(): void {
    const n = this.photoZoomUrls.length;
    if (n <= 1) {
      return;
    }
    this.photoZoomIndex = (this.photoZoomIndex - 1 + n) % n;
    this.photoZoomTitle = `Foto de garita · ${this.photoZoomIndex + 1}/${n}`;
    this.photoZoom = 1;
  }

  photoZoomNext(): void {
    const n = this.photoZoomUrls.length;
    if (n <= 1) {
      return;
    }
    this.photoZoomIndex = (this.photoZoomIndex + 1) % n;
    this.photoZoomTitle = `Foto de garita · ${this.photoZoomIndex + 1}/${n}`;
    this.photoZoom = 1;
  }

  zoomIn(): void {
    this.photoZoom = Math.min(this.zoomMax, Math.round((this.photoZoom + this.zoomStep) * 100) / 100);
  }

  zoomOut(): void {
    this.photoZoom = Math.max(this.zoomMin, Math.round((this.photoZoom - this.zoomStep) * 100) / 100);
  }

  resetZoom(): void {
    this.photoZoom = 1;
  }

  showPhotoUrl(url: string | null | undefined, event?: Event): void {
    event?.stopPropagation();
    if (!url) {
      return;
    }
    this.openPhotoZoom([url], 0, 'Foto');
  }

  onDateRangeChange(): void {
    if (!this.fecha_inicial || !this.fecha_final) {
      return;
    }
    if (this.fecha_final < this.fecha_inicial) {
      this.toastr.warning('La fecha final no puede ser anterior a la inicial.');
      return;
    }
    this.pageIndex = 0;
    this.expandedHistoryRowId = null;
    this.fetchHistory();
  }

  /** Respuesta del API: array JSON o { data: [], total?: number } */
  private unwrapHistoryRows(raw: unknown): HistoryRow[] {
    if (Array.isArray(raw)) {
      return raw as HistoryRow[];
    }
    if (raw && typeof raw === 'object' && 'data' in raw && Array.isArray((raw as { data: unknown }).data)) {
      return (raw as { data: HistoryRow[] }).data;
    }
    return [];
  }

  private unwrapHistoryTotal(raw: unknown, rows: HistoryRow[]): number {
    if (raw && typeof raw === 'object' && 'total' in raw) {
      const t = Number((raw as { total: unknown }).total);
      if (Number.isFinite(t)) {
        return t;
      }
    }
    return rows.length;
  }

  private toYmd(d: Date | null | undefined): string | null {
    if (!d || !(d instanceof Date) || isNaN(d.getTime())) {
      return null;
    }
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  fetchHistory(opts?: { silent?: boolean }): void {
    const fi = this.toYmd(this.fecha_inicial);
    const ff = this.toYmd(this.fecha_final);
    if (!fi || !ff) {
      return;
    }
    const silent = !!opts?.silent && this.allRows.length > 0;
    if (!silent) {
      this.loading = true;
    }
    const requestSeq = ++this.historyRequestSeq;
    const ap =
      this.access_point != null && this.access_point > 0 ? String(this.access_point) : undefined;

    const useServerPage = !this.hasLocalFilter;
    this.serverPagingActive = useServerPage;
    const limit = useServerPage ? Math.min(500, this.pageSize) : 500;
    const offset = useServerPage ? this.pageIndex * this.pageSize : 0;

    this.accessLogService.getHistoryByRange(fi, ff, ap, { limit, offset }).subscribe({
      next: (raw: unknown) => {
        if (requestSeq !== this.historyRequestSeq) {
          return;
        }
        const rows = this.unwrapHistoryRows(raw);
        this.allRows = rows;
        this.serverTotal = this.unwrapHistoryTotal(raw, rows);
        this.loading = false;
      },
      error: (err) => {
        if (requestSeq !== this.historyRequestSeq) {
          return;
        }
        console.error('Error al obtener el historial:', err);
        this.loading = false;
        this.toastr.error('No se pudo cargar el historial.');
      },
    });
  }

  ngOnInit(): void {
    this.showDocColumn = this.auth.isStaff();
    this.canEditAccessDetails = this.auth.isStaff();
    this.navPerm.load().subscribe(() => {
      this.showIncidentsColumn = this.auth.isStaff() && this.navPerm.canView('incidents');
      this.canCreateIncident = this.auth.isStaff() && this.navPerm.canManage('incidents');
    });
    const ymd = todayYmdInAppTimeZone();
    const [y, m, d] = ymd.split('-').map((n) => Number(n));
    const today = new Date(y, m - 1, d);
    // Últimos 7 días inclusive (hoy y 6 anteriores).
    const from = new Date(today);
    from.setDate(from.getDate() - 6);
    this.fecha_inicial = from;
    this.fecha_final = today;

    this.entranceService.getAllAccessPoints({ includeInactive: true }).subscribe({
      next: (raw: unknown) => {
        const list = Array.isArray(raw) ? raw : [];
        this.accessPointOptions = list.map((p: Record<string, unknown>) => {
          const name = String(p['name'] ?? p['ap_location'] ?? p['location'] ?? `Punto ${p['id'] ?? ''}`);
          const active = Number(p['is_active'] ?? 1) === 1;
          return {
            id: Number(p['id'] ?? p['ap_id'] ?? 0),
            label: active ? name : `${name} (INACTIVO)`,
          };
        }).filter((o) => o.id > 0);

        if (!this.accessPointOptions.length) {
          this.toastr.warning('No hay puntos de acceso configurados.');
        }

        this.fetchHistory();
      },
      error: () => {
        this.toastr.error('No se pudieron cargar los puntos de acceso.');
        this.loading = false;
      },
    });
  }

  viewDetail(row: HistoryRow): void {
    this.dialog
      .open(DialogHistoryDetail, {
        width: 'min(720px, 96vw)',
        maxHeight: '90vh',
        data: { data: row as unknown as Visit, accessPointId: this.access_point },
      })
      .afterClosed()
      .subscribe(() => {});
  }

  rowIncidentCount(row: HistoryRow): number {
    return Number(row['incident_count'] ?? 0) || 0;
  }

  incidentPreviewDescription(row: HistoryRow): string {
    return String(row['incident_preview_description'] ?? '').trim();
  }

  incidentPreviewPhotoUrl(row: HistoryRow): string | null {
    const raw = row['incident_preview_photo_url'];
    if (raw == null || raw === '') {
      return null;
    }
    return this.api.getPhotoUrl(String(raw));
  }

  sameDayCount(row: HistoryRow): number {
    const n = Number(row['same_day_count'] ?? 1);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  hasRecordedExit(row: HistoryRow): boolean {
    if (this.isEgressOnlyRow(row)) {
      return true;
    }
    if (Number(row['session_open']) === 1) {
      return false;
    }
    if (this.isExternalRow(row)) {
      if (this.isExternalAttemptWithoutStay(row)) {
        return false;
      }
      const exit = row['date_exit'];
      return exit != null && exit !== '';
    }
    const exit = row['date_exit'];
    if (exit == null || exit === '') {
      return false;
    }
    return hasSalidaObservation(row);
  }

  /**
   * Intento de visita externa sin ingreso efectivo (temp_exit ≈ temp_entry en BD).
   * No es una salida escaneada; no debe mostrar permanencia ni hora de salida.
   */
  isExternalAttemptWithoutStay(row: HistoryRow): boolean {
    if (!this.isExternalRow(row) || hasEffectiveEntry(row)) {
      return false;
    }
    if (Number(row['session_open']) === 1) {
      return false;
    }
    const exitRaw = row['date_exit'];
    if (exitRaw == null || exitRaw === '') {
      return true;
    }
    const entry = new Date(String(row['date_entry'] ?? ''));
    const exit = new Date(String(exitRaw));
    if (Number.isNaN(entry.getTime()) || Number.isNaN(exit.getTime())) {
      return false;
    }
    return Math.abs(exit.getTime() - entry.getTime()) <= 2000;
  }

  isEgressOnlyRow(row: HistoryRow): boolean {
    return String(row['movement_type'] ?? '').toUpperCase() === 'EGRESO';
  }

  isSessionOpen(row: HistoryRow): boolean {
    if (this.isEgressOnlyRow(row)) {
      return false;
    }
    if (this.isExternalRow(row)) {
      // Solo sesión abierta tras ingreso efectivo (authorize / entrada permitida).
      return Number(row['session_open']) === 1;
    }
    if (Number(row['session_open']) === 1) {
      return true;
    }
    const mt = String(row['movement_type'] ?? '').toUpperCase();
    if (mt !== 'INGRESO' || this.hasRecordedExit(row)) {
      return false;
    }
    if (hasEffectiveEntry(row)) {
      return true;
    }
    const status = this.resultStatus(row);
    if (status === 'DENEGADO' || status === '—') {
      return false;
    }
    return status === 'PERMITIDO' || status === 'OBSERVADO' || status === 'RESTRINGIDO';
  }

  viewIncidents(row: HistoryRow): void {
    const logRef = Number(row['id'] ?? 0);
    if (!logRef) {
      return;
    }
    this.dialog.open(DialogHistoryIncidents, {
      width: 'min(560px, 96vw)',
      maxHeight: '90vh',
      data: { logRef, historyRow: row, canCreate: this.canCreateIncident },
    });
  }

  reportIncident(row: HistoryRow, event?: Event): void {
    event?.stopPropagation();
    const logRef = Number(row['id'] ?? 0);
    const accessPointId = Number(row['access_point_id'] ?? 0);
    if (!logRef || accessPointId <= 0) {
      this.toastr.warning('No se puede reportar incidencia: falta referencia del acceso.');
      return;
    }
    this.dialog
      .open(IncidentFormDialogComponent, {
        width: 'min(480px, 96vw)',
        panelClass: INCIDENT_DIALOG_PANEL_CLASS,
        disableClose: true,
        data: {
          mode: 'scan',
          accessPointId,
          lockAccessPoint: true,
          scanContext: buildScanContextFromHistoryRow(row),
        },
      })
      .afterClosed()
      .subscribe((saved) => {
        if (saved) {
          this.fetchHistory();
        }
      });
  }

  openAccessDetailsDialog(row: HistoryRow, event?: Event): void {
    event?.stopPropagation();
    const logRef = Number(row['id'] ?? 0);
    const accessPointId = Number(row['access_point_id'] ?? this.access_point ?? 0);
    if (!logRef || accessPointId <= 0) {
      this.toastr.warning('No se puede editar detalle: falta referencia del acceso.');
      return;
    }
    const movementRaw = String(row['movement_type'] ?? 'INGRESO').toUpperCase();
    this.dialog
      .open(AccessDetailsDialogComponent, {
        width: 'min(480px, 96vw)',
        panelClass: ACCESS_DETAILS_DIALOG_PANEL_CLASS,
        disableClose: true,
        data: {
          logRef,
          scanStatus: parseAccessLogScanStatus(row),
          accessPointId,
          movementMode: movementRaw === 'EGRESO' ? 'EGRESO' : 'INGRESO',
          incidentContext: buildScanContextFromHistoryRow(row),
          canReportIncident: this.canCreateIncident,
          initialNotes: String(row['operator_notes'] ?? '').trim() || null,
          initialDecision: (String(row['operator_decision'] ?? '').trim() as OperatorDecision) || '',
          initialHouseId: Number(row['house_id'] ?? 0) > 0 ? Number(row['house_id']) : null,
          effectiveEntryAt: String(row['effective_entry_at'] ?? '').trim() || null,
          rowLabel: accessLogRowLabel(row),
        },
      })
      .afterClosed()
      .subscribe((saved) => {
        if (saved) {
          this.fetchHistory();
        }
      });
  }

  canOpenDayDetail(row: HistoryRow): boolean {
    if (!this.showDocColumn) {
      return false;
    }
    const doc = String(row?.['doc_number'] ?? '').trim();
    if (!doc || doc === '—') {
      return false;
    }
    return this.sameDayCount(row) > 1;
  }

  private formatTooltipDate(value: unknown): string {
    if (value == null || value === '') {
      return '—';
    }
    const d = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(d.getTime())) {
      return String(value);
    }
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  private formatDurationMinutes(mins: number): string {
    if (!Number.isFinite(mins) || mins < 0) {
      return '—';
    }
    if (mins < 60) {
      return `${mins} min`;
    }
    const hours = Math.floor(mins / 60);
    const rest = mins % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }

  permanenceMinutes(row: HistoryRow): number | null {
    if (this.isExternalRow(row)) {
      if (this.isExternalAttemptWithoutStay(row)) {
        return null;
      }
      const mins = Number(row['permanence_minutes']);
      return Number.isFinite(mins) ? mins : null;
    }
    if (this.isEgressOnlyRow(row)) {
      return 0;
    }
    if (!this.hasRecordedExit(row)) {
      if (this.isSessionOpen(row)) {
        const entry = new Date(String(row['effective_entry_at'] ?? row['date_entry'] ?? ''));
        if (Number.isNaN(entry.getTime())) {
          return null;
        }
        return Math.max(0, Math.round((Date.now() - entry.getTime()) / 60000));
      }
      return null;
    }
    const entry = new Date(String(row['effective_entry_at'] ?? row['date_entry'] ?? ''));
    const exit = new Date(String(row['date_exit'] ?? ''));
    if (Number.isNaN(entry.getTime()) || Number.isNaN(exit.getTime())) {
      return null;
    }
    return Math.max(0, Math.round((exit.getTime() - entry.getTime()) / 60000));
  }

  operatorDisplayName(row: HistoryRow): string {
    const name = String(row['operator_name'] ?? '').trim();
    if (name) {
      return name;
    }
    return String(row['operator'] ?? '—');
  }

  tooltipType(row: HistoryRow): string {
    const kind = this.isVehicleRow(row) ? 'Vehículo' : 'Persona';
    const source = this.isExternalRow(row) ? 'Visita externa / temporal' : 'Registro residente';
    const movement = String(row['movement_type'] ?? 'INGRESO').toUpperCase();
    return `Tipo: ${kind}\nOrigen del registro: ${source}\nMovimiento en BD: ${movement}`;
  }

  tooltipDocument(row: HistoryRow): string {
    const doc = String(row['doc_number'] ?? '').trim() || '—';
    const snap = String(row['document_snapshot'] ?? '').trim();
    const lines = [`Documento: ${doc}`];
    if (snap && snap !== doc) {
      lines.push(`Snapshot al acceso: ${snap}`);
    }
    const src = String(row['identity_source'] ?? '').trim();
    if (src) {
      lines.push(`Identidad: ${src}`);
    }
    return lines.join('\n');
  }

  tooltipDatos(row: HistoryRow): string {
    const lines = [`Nombre: ${String(row['name'] ?? '—')}`];
    const category = String(row['person_category'] ?? '').trim();
    if (category) {
      lines.push(`Categoría: ${category.replace(/_/g, ' ')}`);
    }
    if (row['display_name_snapshot']) {
      lines.push(`Nombre registrado: ${String(row['display_name_snapshot'])}`);
    }
    return lines.join('\n');
  }

  tooltipPlate(row: HistoryRow): string {
    const plate = this.displayPlate(row);
    if (plate === '—') {
      return 'Sin placa asociada';
    }
    const snap = String(row['license_plate_snapshot'] ?? '').trim();
    const lines = [`Placa: ${plate}`];
    if (snap && snap.toUpperCase() !== plate) {
      lines.push(`Placa al acceso: ${snap}`);
    }
    return lines.join('\n');
  }

  tooltipHouse(row: HistoryRow): string {
    const addr = String(row['house_address'] ?? '').trim();
    return addr ? `Domicilio: ${addr}` : 'Sin domicilio asociado';
  }

  tooltipAccessPoint(row: HistoryRow): string {
    const name = String(row['access_point_name'] ?? '').trim() || '—';
    const id = row['access_point_id'];
    return id ? `Punto: ${name}\nID: ${id}` : `Punto: ${name}`;
  }

  tooltipSource(row: HistoryRow): string {
    const label = this.entrySourceLabel(row);
    const raw = String(row['entry_source'] ?? 'manual').toLowerCase();
    const detail =
      raw === 'camera'
        ? 'Lectura automática LPR / cámara'
        : raw === 'qr'
          ? 'Escaneo QR o búsqueda manual en escáner'
          : 'Registro manual en garita';
    return `Origen: ${label}\n${detail}`;
  }

  tooltipMovement(row: HistoryRow): string {
    if (this.isEgressOnlyRow(row)) {
      return [
        `Salida observada (↑): ${this.formatTooltipDate(row['date_entry'])}`,
        'No había ingreso abierto previo',
        'Permanencia: no aplica',
      ].join('\n');
    }

    const lines = [`Ingreso (↓): ${this.formatTooltipDate(row['date_entry'])}`];

    if (this.hasRecordedExit(row)) {
      lines.push(`Salida (↑): ${this.formatTooltipDate(row['date_exit'])}`);
    } else if (this.isSessionOpen(row)) {
      lines.push('Salida (↑): Aún dentro (sesión abierta)');
    } else {
      lines.push('Salida (↑): No registrada');
    }

    const mins = this.permanenceMinutes(row);
    if (mins != null) {
      const label = this.isSessionOpen(row) ? 'Permanencia parcial' : 'Permanencia';
      lines.push(`${label}: ${this.formatDurationMinutes(mins)} (${mins} min)`);
    }

    if (this.isExternalRow(row)) {
      const auth = row['authorized_duration_minutes'];
      if (auth != null && auth !== '') {
        lines.push(`Tiempo autorizado: ${auth} min`);
      }
      const deadline = row['stay_deadline'];
      if (deadline) {
        lines.push(`Límite de estadía: ${this.formatTooltipDate(deadline)}`);
      }
      if (Number(row['stay_exceeded']) === 1) {
        lines.push('Estado: excedió tiempo autorizado');
      }
    }

    const status = this.resultStatus(row);
    if (status === 'DENEGADO') {
      lines.push('Nota: acceso denegado — no ingresó al condominio');
    }

    return lines.join('\n');
  }

  tooltipPermanence(row: HistoryRow): string {
    if (!this.isExternalRow(row)) {
      return 'Permanencia detallada solo aplica a visitas externas';
    }
    const mins = this.permanenceMinutes(row);
    const lines = [this.formatPermanence(row)];
    if (mins != null) {
      lines.push(`Cálculo: ${this.formatDurationMinutes(mins)} (${mins} min)`);
    }
    if (Number(row['session_open']) === 1) {
      lines.push('Cuenta desde ingreso hasta ahora (aún dentro)');
    } else if (row['date_exit']) {
      lines.push(`Desde ${this.formatTooltipDate(row['date_entry'])} hasta ${this.formatTooltipDate(row['date_exit'])}`);
    }
    const auth = row['authorized_duration_minutes'];
    if (auth != null && auth !== '') {
      lines.push(`Autorizado: ${auth} min`);
    }
    return lines.join('\n');
  }

  tooltipResult(row: HistoryRow): string {
    const status = this.resultStatus(row);
    const lines = [`Estado: ${status}`];
    const notes = this.resultNotes(row);
    if (notes.length) {
      lines.push(`Notas: ${notes.join(' · ')}`);
    }
    const operatorNotes = String(row['operator_notes'] ?? '').trim();
    if (operatorNotes) {
      lines.push(`Notas operario: ${operatorNotes}`);
    }
    const decision = operatorDecisionLabel(String(row['operator_decision'] ?? ''));
    if (decision !== '—') {
      lines.push(`Decisión operario: ${decision}`);
    }
    const raw = String(row['observation_raw'] ?? row['obs'] ?? '').trim();
    if (raw && raw !== '—') {
      lines.push(`Observación completa: ${raw}`);
    }
    return lines.join('\n');
  }

  tooltipDecision(row: HistoryRow): string {
    const decision = this.operatorDecisionText(row);
    if (!decision) {
      return 'Sin decisión del operario';
    }
    const lines = [`Decisión: ${decision}`];
    if (hasEffectiveEntry(row)) {
      lines.push('Ingreso efectivo registrado en este mismo acceso (permanencia activa o cerrada).');
    }
    return lines.join('\n');
  }

  tooltipOperator(row: HistoryRow): string {
    const username = String(row['operator'] ?? '').trim() || '—';
    const name = String(row['operator_name'] ?? '').trim();
    const role = String(row['operator_role'] ?? '').trim();
    const lines: string[] = [];
    if (name) {
      lines.push(`Operario: ${name}`);
      lines.push(`Usuario: ${username}`);
    } else {
      lines.push(`Usuario: ${username}`);
    }
    if (role) {
      lines.push(`Rol: ${role}`);
    }
    return lines.join('\n');
  }

  tooltipDetail(row: HistoryRow): string {
    const photos = this.capturePhotoUrls(row).length;
    const note = this.operatorNotesText(row);
    const decision = this.operatorDecisionText(row);
    const lines: string[] = [];
    if (note) {
      lines.push(`Nota operario: ${note}`);
    }
    if (decision) {
      lines.push(`Decisión operario: ${decision}`);
    }
    if (photos) {
      lines.push(`${photos} foto(s) de garita`);
    }
    if (!lines.length) {
      return 'Sin detalle de garita en este registro';
    }
    if (photos) {
      lines.push('Clic en la miniatura para ver nota y fotos');
    }
    return lines.join('\n');
  }

  tooltipIncident(row: HistoryRow): string {
    const count = this.rowIncidentCount(row);
    if (count <= 0) {
      return 'Sin incidencias ligadas';
    }
    const lines = [`Incidencias: ${count}`];
    const desc = this.incidentPreviewDescription(row);
    if (desc) {
      lines.push(`Última: ${desc}`);
    }
    if (count > 1) {
      lines.push(`+${count - 1} incidencia(s) más`);
    }
    lines.push('Clic para ver detalle');
    return lines.join('\n');
  }

  tooltipPhotoOcr(row: HistoryRow): string {
    const lines = [`OCR foto: ${this.photoOcrStatusLabel(row)}`];
    if (!this.capturePhotoUrls(row).length) {
      lines.push('Sin foto de garita');
    }
    if (this.photoOcrDoc(row)) {
      lines.push(`DNI: ${this.photoOcrDoc(row)}`);
    }
    if (this.photoOcrPlate(row)) {
      lines.push(`Placa: ${this.photoOcrPlate(row)}`);
    }
    const nameBits = [this.photoOcrLastNames(row), this.photoOcrFirstNames(row)].filter(Boolean);
    if (nameBits.length) {
      lines.push(nameBits.join(', '));
    }
    if (!this.hasPhotoOcrData(row) && !this.photoOcrStatus(row)) {
      lines.push('Aún no hay resultado OCR');
    }
    lines.push('Clic para ver detalle');
    return lines.join('\n');
  }

  tooltipDay(row: HistoryRow): string {
    const count = this.sameDayCount(row);
    if (count <= 1) {
      return 'Un solo movimiento este día para este documento';
    }
    return `${count} movimientos el mismo día (mismo documento)\nClic para ver timeline del día`;
  }
}

@Component({
  selector: 'dialog-history-photo-ocr',
  template: `
    <h2 mat-dialog-title class="!text-lg !font-semibold">Contexto del acceso</h2>
    <mat-dialog-content>
      <div class="mb-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-700 dark:bg-gray-800/50">
        <p *ngIf="data.name" class="m-0 text-sm font-semibold text-gray-900 dark:text-white">{{ data.name }}</p>
        <p class="m-0 mt-1 text-gray-600 dark:text-gray-400">
          <span *ngIf="data.doc">Doc. {{ data.doc }}</span>
          <span *ngIf="data.plate && data.plate !== '—'"> · Placa {{ data.plate }}</span>
          <span *ngIf="data.house"> · {{ data.house }}</span>
        </p>
        <p class="m-0 mt-1 text-gray-600 dark:text-gray-400">
          <span *ngIf="data.accessPoint">{{ data.accessPoint }}</span>
          <span *ngIf="data.source"> · {{ data.source }}</span>
          <span *ngIf="data.operator"> · Op. {{ data.operator }}</span>
        </p>
        <p class="m-0 mt-1 text-gray-600 dark:text-gray-400">
          <span *ngIf="data.movementLabel">{{ data.movementLabel }}</span>
          <span *ngIf="data.entryAt"> · {{ data.entryAt }}</span>
          <span *ngIf="data.exitAt && data.movementLabel !== 'Egreso'"> → {{ data.exitAt }}</span>
        </p>
        <p class="m-0 mt-1 text-gray-600 dark:text-gray-400">
          <span *ngIf="data.result && data.result !== '—'">Resultado: {{ data.result }}</span>
          <span *ngIf="data.decision"> · Decisión: {{ data.decision }}</span>
        </p>
        <p *ngIf="data.operatorNote" class="m-0 mt-2 whitespace-pre-wrap text-gray-700 dark:text-gray-300">
          Nota: {{ data.operatorNote }}
        </p>
      </div>

      <h3 class="m-0 mb-2 text-sm font-semibold text-gray-800 dark:text-gray-100">OCR de la foto</h3>
      <p class="m-0 mb-3 text-xs text-gray-500 dark:text-gray-400">
        Estado: <span class="font-semibold text-gray-800 dark:text-gray-200">{{ data.status }}</span>
      </p>

      <dl class="m-0 grid gap-2 text-sm">
        <div class="flex gap-2">
          <dt class="w-24 shrink-0 text-gray-500">DNI foto</dt>
          <dd class="m-0 font-medium text-gray-900 dark:text-white">{{ data.photoDoc || '—' }}</dd>
        </div>
        <div class="flex gap-2">
          <dt class="w-24 shrink-0 text-gray-500">Placa foto</dt>
          <dd class="m-0 font-medium text-gray-900 dark:text-white">{{ data.photoPlate || '—' }}</dd>
        </div>
        <div class="flex gap-2">
          <dt class="w-24 shrink-0 text-gray-500">Nombres</dt>
          <dd class="m-0 font-medium text-gray-900 dark:text-white">{{ data.photoFirstNames || '—' }}</dd>
        </div>
        <div class="flex gap-2">
          <dt class="w-24 shrink-0 text-gray-500">Apellidos</dt>
          <dd class="m-0 font-medium text-gray-900 dark:text-white">{{ data.photoLastNames || '—' }}</dd>
        </div>
      </dl>

      <p *ngIf="!data.hasData && !processing" class="mt-3 mb-0 text-xs text-amber-700 dark:text-amber-300">
        {{ data.photoUrls?.length ? 'No hay texto útil detectado en la foto (pruebas OCR).' : 'Sin foto de garita: no hay OCR que mostrar; arriba está el contexto del ingreso.' }}
      </p>

      <p *ngIf="processing" class="mt-3 mb-0 text-xs text-teal-700 dark:text-teal-300">
        Procesando OCR… puede tardar unos segundos.
      </p>

      <div *ngIf="data.photoUrls?.length" class="mt-4">
        <div class="history-media-carousel">
          <button
            *ngIf="data.photoUrls.length > 1"
            type="button"
            class="history-media-nav"
            (click)="photoPrev()"
            aria-label="Foto anterior">
            <mat-icon>chevron_left</mat-icon>
          </button>
          <button
            type="button"
            class="history-media-frame"
            title="Ampliar foto"
            (click)="openCurrentZoom()">
            <img [src]="data.photoUrls[photoIndex]" [alt]="'Foto ' + (photoIndex + 1)" />
          </button>
          <button
            *ngIf="data.photoUrls.length > 1"
            type="button"
            class="history-media-nav"
            (click)="photoNext()"
            aria-label="Foto siguiente">
            <mat-icon>chevron_right</mat-icon>
          </button>
        </div>
        <p *ngIf="data.photoUrls.length > 1" class="mt-2 mb-0 text-center text-xs text-gray-500">
          {{ photoIndex + 1 }} / {{ data.photoUrls.length }} · clic para ampliar
        </p>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="!gap-2">
      <button
        *ngIf="data.canProcess"
        type="button"
        mat-stroked-button
        color="primary"
        [disabled]="processing"
        (click)="processNow()">
        {{ data.hasData ? 'Completar / reprocesar' : 'Procesar ahora' }}
      </button>
      <button type="button" mat-button [disabled]="processing" (click)="dialogRef.close(lastResult)">Cerrar</button>
    </mat-dialog-actions>
  `,
  styleUrls: ['./history.component.css'],
})
export class DialogHistoryPhotoOcr {
  processing = false;
  lastResult: PhotoOcrExtractResult | undefined;
  photoIndex = 0;

  constructor(
    public dialogRef: MatDialogRef<DialogHistoryPhotoOcr>,
    @Inject(MAT_DIALOG_DATA)
    public data: {
      logRef: number;
      name: string;
      doc: string;
      plate: string;
      house: string;
      accessPoint: string;
      source: string;
      result: string;
      decision: string;
      operatorNote: string;
      operator: string;
      entryAt: string;
      exitAt: string;
      movementLabel: string;
      status: string;
      statusRaw: string;
      photoDoc: string;
      photoPlate: string;
      photoFirstNames: string;
      photoLastNames: string;
      hasData: boolean;
      photoUrls: string[];
      canProcess: boolean;
      openZoom?: (urls: string[], index: number) => void;
    },
    private accessLogService: AccessLogService,
    private toastr: ToastrService
  ) {}

  photoPrev(): void {
    const n = this.data.photoUrls?.length ?? 0;
    if (n <= 1) {
      return;
    }
    this.photoIndex = (this.photoIndex - 1 + n) % n;
  }

  photoNext(): void {
    const n = this.data.photoUrls?.length ?? 0;
    if (n <= 1) {
      return;
    }
    this.photoIndex = (this.photoIndex + 1) % n;
  }

  openCurrentZoom(): void {
    const urls = this.data.photoUrls ?? [];
    if (!urls.length) {
      return;
    }
    this.data.openZoom?.(urls, this.photoIndex);
  }

  async processNow(): Promise<void> {
    if (this.processing || !this.data.canProcess || !this.data.logRef || !this.data.photoUrls?.length) {
      return;
    }
    this.processing = true;
    try {
      const result = await extractDocAndPlateFromPhotos(this.data.photoUrls);
      await firstValueFrom(
        this.accessLogService.patchPhotoOcr(this.data.logRef, {
          photo_doc_number: result.photo_doc_number,
          photo_license_plate: result.photo_license_plate,
          photo_first_names: result.photo_first_names,
          photo_last_names: result.photo_last_names,
          photo_ocr_status: result.photo_ocr_status,
        })
      );
      this.lastResult = result;
      this.data.photoDoc = result.photo_doc_number ?? '';
      this.data.photoPlate = result.photo_license_plate ?? '';
      this.data.photoFirstNames = result.photo_first_names ?? '';
      this.data.photoLastNames = result.photo_last_names ?? '';
      this.data.statusRaw = result.photo_ocr_status;
      this.data.hasData = !!(
        result.photo_doc_number ||
        result.photo_license_plate ||
        result.photo_first_names ||
        result.photo_last_names
      );
      this.data.status =
        result.photo_ocr_status === 'done'
          ? 'Completado'
          : result.photo_ocr_status === 'empty'
            ? 'Sin texto legible'
            : result.photo_ocr_status === 'error'
              ? 'Error'
              : result.photo_ocr_status;
      if (this.data.hasData) {
        this.toastr.success('OCR guardado');
      } else if (result.photo_ocr_status === 'error') {
        this.toastr.warning('OCR falló al leer la foto');
      } else {
        this.toastr.info('OCR sin texto útil en la foto');
      }
    } catch (err) {
      console.warn('[photo-ocr] processNow failed', err);
      this.toastr.error('No se pudo procesar el OCR');
    } finally {
      this.processing = false;
    }
  }
}

@Component({
  selector: 'dialog-history-incidents',
  template: `
    <h2 mat-dialog-title class="!text-lg !font-semibold">Incidencias del registro</h2>
    <mat-dialog-content>
      <div *ngIf="loading" class="py-6 text-center text-sm text-gray-500">Cargando…</div>
      <div *ngIf="!loading && !rows.length" class="py-4 text-sm text-gray-600">Sin incidencias ligadas.</div>
      <div *ngFor="let inc of rows" class="mb-4 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
        <p class="text-xs text-gray-500">{{ inc.created_at | date : 'dd/MM/yyyy HH:mm' }} · {{ inc.created_by_username }}</p>
        <p class="mt-2 text-sm whitespace-pre-wrap">{{ inc.description }}</p>
        <div *ngIf="photoUrlsOf(inc).length" class="mt-2 flex flex-wrap gap-2">
          <img
            *ngFor="let url of photoUrlsOf(inc)"
            [src]="url"
            alt=""
            class="max-h-40 rounded object-contain" />
        </div>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="!gap-2">
      <button
        *ngIf="data.canCreate"
        type="button"
        mat-stroked-button
        color="warn"
        (click)="openReportDialog()">
        Reportar incidencia
      </button>
      <button type="button" mat-button (click)="dialogRef.close()">Cerrar</button>
    </mat-dialog-actions>
  `,
})
export class DialogHistoryIncidents implements OnInit {
  rows: AccessIncident[] = [];
  loading = false;

  constructor(
    public dialogRef: MatDialogRef<DialogHistoryIncidents>,
    @Inject(MAT_DIALOG_DATA) public data: { logRef: number; historyRow?: HistoryRow; canCreate?: boolean },
    private incidentService: AccessIncidentService,
    private api: ApiService,
    private toastr: ToastrService,
    private dialog: MatDialog
  ) {}

  openReportDialog(): void {
    const row = this.data.historyRow;
    const accessPointId = Number(row?.['access_point_id'] ?? 0);
    if (!row || accessPointId <= 0) {
      this.toastr.warning('No se puede reportar incidencia sobre este registro.');
      return;
    }
    this.dialogRef.close();
    this.dialog
      .open(IncidentFormDialogComponent, {
        width: 'min(480px, 96vw)',
        panelClass: INCIDENT_DIALOG_PANEL_CLASS,
        disableClose: true,
        data: {
          mode: 'scan',
          accessPointId,
          lockAccessPoint: true,
          scanContext: buildScanContextFromHistoryRow(row),
        },
      })
      .afterClosed()
      .subscribe();
  }

  ngOnInit(): void {
    this.loading = true;
    this.incidentService.getByLogId(this.data.logRef).subscribe({
      next: (rows) => {
        this.rows = rows;
        this.loading = false;
      },
      error: (e: Error) => {
        this.loading = false;
        this.toastr.error(e.message || 'No se pudieron cargar las incidencias');
      },
    });
  }

  photoUrl(path: string | null | undefined): string | null {
    return this.api.getPhotoUrl(path ?? null);
  }

  photoUrlsOf(inc: AccessIncident): string[] {
    return this.incidentService.photoUrlsOf(inc);
  }
}

@Component({
  selector: 'dialog-history-detail',
  templateUrl: 'dialog-history-detail.html',
  styleUrls: ['./history.component.css'],
})
export class DialogHistoryDetail implements OnInit {
  detailRows: HistoryRow[] = [];
  anchorRow: HistoryRow | null = null;
  dayLabel = '';

  loading = false;

  constructor(
    public dialogRef: MatDialogRef<DialogHistoryDetail>,
    @Inject(MAT_DIALOG_DATA) public data: { data: Visit; accessPointId: number | null },
    private accessLogService: AccessLogService,
    private toastr: ToastrService,
    private api: ApiService
  ) {}

  get anchorDoc(): string {
    return String(this.anchorRow?.['doc_number'] ?? '').trim();
  }

  get anchorPlate(): string {
    if (!this.anchorRow) {
      return '';
    }
    return parseDisplayPlate(this.anchorRow);
  }

  get anchorHouse(): string {
    const h = String(this.anchorRow?.['house_address'] ?? '').trim();
    return h && h !== '—' ? h : '';
  }

  ngOnInit(): void {
    const row = this.data?.data as unknown as HistoryRow | undefined;
    this.anchorRow = row ?? null;
    const accessPointId = this.data?.accessPointId;
    const doc = String(row?.['doc_number'] ?? '').trim();
    const rawDate = row?.['date_entry'] ?? row?.['created_at'];
    const fecha =
      typeof rawDate === 'string'
        ? rawDate.slice(0, 10)
        : rawDate instanceof Date
          ? rawDate.toISOString().slice(0, 10)
          : '';

    if (fecha) {
      const [y, m, d] = fecha.split('-');
      this.dayLabel = `${d}/${m}/${y}`;
    }

    if (!fecha || !doc) {
      this.toastr.error('Faltan datos para cargar el detalle.');
      return;
    }

    this.loading = true;
    const ap =
      accessPointId != null && accessPointId > 0 ? String(accessPointId) : undefined;
    this.accessLogService.getHistoryByDocumentDay(fecha, doc, ap, { limit: 500, offset: 0 }).subscribe({
      next: (list: unknown) => {
        const rows = Array.isArray(list)
          ? list
          : list && typeof list === 'object' && Array.isArray((list as { data?: unknown }).data)
            ? (list as { data: HistoryRow[] }).data
            : [];
        this.detailRows = (rows as HistoryRow[]).sort((a, b) =>
          String(a['date_entry'] ?? '').localeCompare(String(b['date_entry'] ?? ''))
        );
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.toastr.error('No se pudo cargar el detalle.');
      },
    });
  }

  onNoClick(): void {
    this.dialogRef.close();
  }

  resultStatus(row: HistoryRow): HistoryResultStatus {
    return parseResultStatus(row);
  }

  resultNotes(row: HistoryRow): string[] {
    return parseResultNotes(row);
  }

  timelineTime(row: HistoryRow): string {
    const h = String(row['hour_entrance'] ?? '').trim();
    if (h) {
      return h;
    }
    const raw = row['date_entry'];
    if (!raw) {
      return '—';
    }
    const d = raw instanceof Date ? raw : new Date(String(raw));
    if (Number.isNaN(d.getTime())) {
      return '—';
    }
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  timelineMovement(row: HistoryRow): string {
    const mt = String(row['movement_type'] ?? '').toUpperCase();
    if (mt === 'EGRESO') {
      return '· Salida';
    }
    const src = String(row['entry_source'] ?? 'manual').toLowerCase();
    const srcLabel = src === 'camera' ? 'Cámara' : src === 'qr' ? 'QR' : 'Manual';
    return `· Ingreso (${srcLabel})`;
  }

  timelinePoint(row: HistoryRow): string {
    return String(row['access_point_name'] ?? '').trim();
  }

  timelineDecision(row: HistoryRow): string {
    const label = operatorDecisionLabel(String(row['operator_decision'] ?? ''));
    return label !== '—' ? label : '';
  }

  timelineOperatorNote(row: HistoryRow): string {
    return String(row['operator_notes'] ?? '').trim();
  }

  timelineSystemNotes(row: HistoryRow): string[] {
    return parseResultNotes(row);
  }

  timelinePhotoUrls(row: HistoryRow): string[] {
    const raw = row['access_photo_urls'];
    if (Array.isArray(raw)) {
      return raw
        .map((u) => this.api.getPhotoUrl(String(u ?? '')))
        .filter((u): u is string => !!u);
    }
    const single = this.api.getPhotoUrl(String(row['access_photo_url'] ?? ''));
    return single ? [single] : [];
  }

  statusBadgeClass(status: HistoryResultStatus): string {
    return `history-status-badge--${status === '—' ? 'unknown' : status.toLowerCase()}`;
  }

  statusIcon(status: HistoryResultStatus): string {
    if (status === 'PERMITIDO') return 'check_circle';
    if (status === 'DENEGADO') return 'block';
    if (status === 'RESTRINGIDO' || status === 'OBSERVADO') return 'warning';
    return 'help_outline';
  }
}
