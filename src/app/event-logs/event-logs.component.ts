import { Component, OnInit } from '@angular/core';
import { ToastrService } from 'ngx-toastr';
import { addDaysYmd, todayYmdInAppTimeZone } from '../app-date.util';
import {
  ExpandableRowId,
  isExpandableRowOpen,
  toggleExpandableRow,
} from '../shared/expandable-row';
import { EventLogItem, EventLogService } from './event-log.service';

@Component({
  selector: 'app-event-logs',
  templateUrl: './event-logs.component.html',
  styleUrls: ['./event-logs.component.css'],
})
export class EventLogsComponent implements OnInit {
  loading = false;
  items: EventLogItem[] = [];
  actionOptions: string[] = [];

  fromDate = '';
  toDate = '';
  filterAction = '';
  filterQuery = '';
  retentionDays = 30;

  pageIndex = 0;
  pageSize = 50;
  total = 0;
  readonly pageSizeOptions = [25, 50, 100, 200];

  expandedRowId: ExpandableRowId = null;

  constructor(
    private eventLogService: EventLogService,
    private toastr: ToastrService
  ) {}

  ngOnInit(): void {
    const today = todayYmdInAppTimeZone();
    this.toDate = today;
    this.fromDate = addDaysYmd(today, -7);
    this.loadActions();
    this.loadLogs();
  }

  loadActions(): void {
    this.eventLogService.getActions().subscribe({
      next: (actions) => {
        this.actionOptions = actions;
      },
      error: () => {
        this.actionOptions = [];
      },
    });
  }

  loadLogs(): void {
    this.loading = true;
    this.eventLogService
      .list({
        from: this.fromDate,
        to: this.toDate,
        action: this.filterAction || undefined,
        q: this.filterQuery.trim() || undefined,
        page: this.pageIndex + 1,
        page_size: this.pageSize,
      })
      .subscribe({
        next: (result) => {
          this.loading = false;
          this.items = result.items;
          this.total = result.pagination.total;
          this.retentionDays = result.filters.retention_days ?? 30;
        },
        error: (err) => {
          this.loading = false;
          this.items = [];
          this.total = 0;
          const msg = err?.error?.error ?? 'No se pudo cargar el registro de eventos.';
          this.toastr.error(msg);
        },
      });
  }

  applyFilters(): void {
    this.pageIndex = 0;
    this.expandedRowId = null;
    this.loadLogs();
  }

  onPageChange(event: { pageIndex: number; pageSize: number }): void {
    this.pageIndex = event.pageIndex;
    this.pageSize = event.pageSize;
    this.loadLogs();
  }

  toggleDetails(id: number): void {
    this.expandedRowId = toggleExpandableRow(this.expandedRowId, id);
  }

  isRowOpen(id: number): boolean {
    return isExpandableRowOpen(this.expandedRowId, id);
  }

  formatDateTime(value: string | null | undefined): string {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString('es-PE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  actionLabel(action: string): string {
    const map: Record<string, string> = {
      'auth.login_success': 'Inicio de sesión',
      'auth.login_failed': 'Intento de login fallido',
      'auth.password_change': 'Cambio de contraseña',
      'nav_permissions.update': 'Permisos de navegación',
      'user.create': 'Usuario creado',
      'user.update': 'Usuario actualizado',
      'user.create_from_person': 'Acceso desde persona',
      'house.create': 'Vivienda creada',
      'house.update': 'Vivienda actualizada',
      'house.delete': 'Vivienda eliminada',
      'vehicle.create': 'Vehículo registrado',
      'vehicle.update': 'Vehículo actualizado',
      'vehicle.delete': 'Vehículo eliminado',
      'pet.create': 'Mascota registrada',
      'pet.update': 'Mascota actualizada',
      'pet.delete': 'Mascota eliminada',
      'person.create': 'Persona creada',
      'person.update': 'Persona actualizada',
      'person.validate': 'Validación de persona',
      'person.delete': 'Persona eliminada',
      'access_point.create': 'Punto de acceso creado',
      'access_point.update': 'Punto de acceso actualizado',
      'announcement.create': 'Comunicado creado',
      'announcement.update': 'Comunicado actualizado',
      'survey.create': 'Encuesta creada',
      'survey.update': 'Encuesta actualizada',
      'survey.disable': 'Encuesta inhabilitada',
      'reservation.create': 'Reservación creada',
      'reservation.update': 'Reservación actualizada',
      'reservation.status_change': 'Cambio estado reservación',
      'readonly_documents.update': 'Documentos actualizados',
      'readonly_documents.upload': 'Documento subido',
      'access_log.create': 'Registro de acceso manual',
    };
    return map[action] ?? action;
  }

  detailsPreview(details: unknown): string {
    if (details == null) return '';
    try {
      return JSON.stringify(details, null, 2);
    } catch {
      return String(details);
    }
  }
}
