import { Component, Inject, OnInit } from '@angular/core';
import { AccessLogService } from '../access-log.service';
import { Visit } from '../visit';
import { MatDialog, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { Item } from '../item';
import { animate, state, style, transition, trigger } from '@angular/animations';
import { ToastrService } from 'ngx-toastr';
import { EntranceService } from '../entrance.service';
import { AuthService } from '../auth.service';
import { NavPermissionService } from '../nav-permission.service';
import { AccessIncident, AccessIncidentService } from '../incidents/access-incident.service';
import { ApiService } from '../api.service';
import { todayYmdInAppTimeZone } from '../app-date.util';
import * as XLSX from 'xlsx';
import {
  ExpandableRowId,
  isExpandableRowOpen,
  toggleExpandableRow,
} from '../shared/expandable-row';

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

  /** Filas crudas del API */
  allRows: HistoryRow[] = [];

  filterQuery = '';
  sourceFilter: '' | 'manual' | 'qr' | 'camera' = '';
  sortKey: keyof HistoryRow | string = 'date_entry';
  sortAsc = false;

  pageIndex = 0;
  pageSize = 50;

  readonly pageSizeOptions = [25, 50, 100, 200];

  /** Columna documento: solo personal (admin/operario), no vecinos USUARIO. */
  showDocColumn = true;

  showIncidentsColumn = false;

  expandedHistoryRowId: ExpandableRowId = null;
  historyPhotoOpen = false;
  selectedHistoryPhotoUrl: string | null = null;

  get historyTableColspan(): number {
    let cols = this.showDocColumn ? 13 : 12;
    if (this.hasExternalRows) cols += 1;
    if (this.showIncidentsColumn) cols += 1;
    return cols;
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
    const start = this.pageIndex * this.pageSize;
    return this.filteredRows.slice(start, start + this.pageSize);
  }

  get totalFiltered(): number {
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
    this.filterQuery = value;
    this.pageIndex = 0;
    this.expandedHistoryRowId = null;
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
  }

  goNextPage(): void {
    this.pageIndex = Math.min(this.totalPages - 1, this.pageIndex + 1);
    this.expandedHistoryRowId = null;
  }

  onPageSizeChange(): void {
    this.pageIndex = 0;
    this.expandedHistoryRowId = null;
  }

  exportExcel(): void {
    const rows = this.filteredRows;
    if (!rows.length) {
      this.toastr.warning('No hay datos para exportar.');
      return;
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
      SALIDA: r['date_exit'],
      ...(this.hasExternalRows ? { PERMANENCIA_MIN: this.formatPermanence(r) } : {}),
      RESULTADO: this.resultStatus(r),
      NOTAS: this.resultNotes(r).join(' · '),
      OPERARIO: r['operator'],
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

  showHistoryPhoto(row: HistoryRow): void {
    const url = this.api.getPhotoUrl(String(row['access_photo_url'] ?? ''));
    if (!url) return;
    this.selectedHistoryPhotoUrl = url;
    this.historyPhotoOpen = true;
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

  /** Respuesta del API: array JSON o { data: [] } */
  private unwrapHistoryRows(raw: unknown): HistoryRow[] {
    if (Array.isArray(raw)) {
      return raw as HistoryRow[];
    }
    if (raw && typeof raw === 'object' && 'data' in raw && Array.isArray((raw as { data: unknown }).data)) {
      return (raw as { data: HistoryRow[] }).data;
    }
    return [];
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

  fetchHistory(): void {
    const fi = this.toYmd(this.fecha_inicial);
    const ff = this.toYmd(this.fecha_final);
    if (!fi || !ff) {
      return;
    }
    this.loading = true;
    const ap =
      this.access_point != null && this.access_point > 0 ? String(this.access_point) : undefined;
    this.accessLogService.getHistoryByRange(fi, ff, ap).subscribe({
      next: (raw: unknown) => {
        const rows = this.unwrapHistoryRows(raw);
        this.allRows = rows;
        this.loading = false;
      },
      error: (err) => {
        console.error('Error al obtener el historial:', err);
        this.loading = false;
        this.toastr.error('No se pudo cargar el historial.');
      },
    });
  }

  ngOnInit(): void {
    this.showDocColumn = this.auth.isStaff();
    this.navPerm.load().subscribe(() => {
      this.showIncidentsColumn = this.auth.isStaff() && this.navPerm.canView('incidents');
    });
    const ymd = todayYmdInAppTimeZone();
    const [y, m, d] = ymd.split('-').map((n) => Number(n));
    const today = new Date(y, m - 1, d);
    this.fecha_inicial = today;
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

  viewIncidents(row: HistoryRow): void {
    const logRef = Number(row['id'] ?? 0);
    if (!logRef) {
      return;
    }
    this.dialog.open(DialogHistoryIncidents, {
      width: 'min(560px, 96vw)',
      maxHeight: '90vh',
      data: { logRef },
    });
  }

  canOpenDayDetail(row: HistoryRow): boolean {
    if (!this.showDocColumn) {
      return false;
    }
    const doc = String(row?.['doc_number'] ?? '').trim();
    return doc.length > 0 && doc !== '—';
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
        <img
          *ngIf="photoUrl(inc.photo_url)"
          [src]="photoUrl(inc.photo_url)!"
          alt=""
          class="mt-2 max-h-40 rounded object-contain" />
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button type="button" mat-button (click)="dialogRef.close()">Cerrar</button>
    </mat-dialog-actions>
  `,
})
export class DialogHistoryIncidents implements OnInit {
  rows: AccessIncident[] = [];
  loading = false;

  constructor(
    public dialogRef: MatDialogRef<DialogHistoryIncidents>,
    @Inject(MAT_DIALOG_DATA) public data: { logRef: number },
    private incidentService: AccessIncidentService,
    private api: ApiService,
    private toastr: ToastrService
  ) {}

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
}

@Component({
  selector: 'dialog-history-detail',
  templateUrl: 'dialog-history-detail.html',
  styleUrls: ['./history.component.css'],
})
export class DialogHistoryDetail implements OnInit {
  detailRows: HistoryRow[] = [];

  loading = false;

  constructor(
    public dialogRef: MatDialogRef<DialogHistoryDetail>,
    @Inject(MAT_DIALOG_DATA) public data: { data: Visit; accessPointId: number | null },
    private accessLogService: AccessLogService,
    private toastr: ToastrService
  ) {}

  ngOnInit(): void {
    const row = this.data?.data as unknown as HistoryRow | undefined;
    const accessPointId = this.data?.accessPointId;
    const doc = String(row?.['doc_number'] ?? '').trim();
    const rawDate = row?.['date_entry'] ?? row?.['created_at'];
    const fecha =
      typeof rawDate === 'string'
        ? rawDate.slice(0, 10)
        : rawDate instanceof Date
          ? rawDate.toISOString().slice(0, 10)
          : '';

    if (!fecha || !doc) {
      this.toastr.error('Faltan datos para cargar el detalle.');
      return;
    }

    this.loading = true;
    const ap =
      accessPointId != null && accessPointId > 0 ? String(accessPointId) : undefined;
    this.accessLogService.getHistoryByDocumentDay(fecha, doc, ap).subscribe({
      next: (list: unknown) => {
        const rows = Array.isArray(list)
          ? list
          : list && typeof list === 'object' && Array.isArray((list as { data?: unknown }).data)
            ? (list as { data: HistoryRow[] }).data
            : [];
        this.detailRows = rows as HistoryRow[];
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
