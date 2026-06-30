import { Component, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ToastrService } from 'ngx-toastr';
import { AccessLogService } from '../access-log.service';
import {
  AccessIncident,
  AccessIncidentService,
  IncidentFormDialogData,
} from './access-incident.service';
import { IncidentFormDialogComponent, INCIDENT_DIALOG_PANEL_CLASS } from './incident-form-dialog.component';
import { NavPermissionService } from '../nav-permission.service';

interface AccessPointOption {
  id: number;
  label: string;
}

@Component({
  selector: 'app-incidents',
  templateUrl: './incidents.component.html',
  styleUrls: ['./incidents.component.css'],
})
export class IncidentsComponent implements OnInit {
  loading = false;
  rows: AccessIncident[] = [];
  accessPointOptions: AccessPointOption[] = [];

  fechaInicial = '';
  fechaFinal = '';
  accessPointId: number | null = null;
  sourceFilter: '' | 'scan' | 'manual' = '';

  selected: AccessIncident | null = null;
  detailLoading = false;

  constructor(
    public readonly navPerm: NavPermissionService,
    private readonly incidentService: AccessIncidentService,
    private readonly accessLogService: AccessLogService,
    private readonly dialog: MatDialog,
    private readonly toastr: ToastrService
  ) {}

  ngOnInit(): void {
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    this.fechaFinal = this.formatDateInput(today);
    this.fechaInicial = this.formatDateInput(weekAgo);
    this.loadAccessPoints();
    this.loadRows();
  }

  get canCreate(): boolean {
    return this.navPerm.canView('incidents');
  }

  loadRows(): void {
    this.loading = true;
    this.incidentService
      .list({
        fecha_inicial: this.fechaInicial,
        fecha_final: this.fechaFinal,
        access_point_id: this.accessPointId ?? undefined,
        source: this.sourceFilter,
      })
      .subscribe({
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

  openCreate(): void {
    const data: IncidentFormDialogData = {
      mode: 'manual',
      accessPointId: this.accessPointId,
      lockAccessPoint: false,
    };
    this.dialog
      .open(IncidentFormDialogComponent, {
        width: 'min(480px, 96vw)',
        panelClass: INCIDENT_DIALOG_PANEL_CLASS,
        data,
      })
      .afterClosed()
      .subscribe((saved) => {
        if (saved) this.loadRows();
      });
  }

  openDetail(row: AccessIncident): void {
    this.detailLoading = true;
    this.selected = row;
    this.incidentService.get(row.incident_id).subscribe({
      next: (detail) => {
        this.selected = detail;
        this.detailLoading = false;
      },
      error: (e: Error) => {
        this.detailLoading = false;
        this.toastr.error(e.message || 'No se pudo cargar el detalle');
      },
    });
  }

  closeDetail(): void {
    this.selected = null;
    this.detailLoading = false;
  }

  photoUrl(path: string | null | undefined): string | null {
    return this.incidentService.photoUrl(path);
  }

  sourceLabel(source: string): string {
    return source === 'scan' ? 'Escaneo' : 'Manual';
  }

  private loadAccessPoints(): void {
    this.accessLogService.getAllAccessPoints().subscribe({
      next: (points: unknown) => {
        const list = Array.isArray(points) ? points : [];
        this.accessPointOptions = list.map((p: any) => ({
          id: Number(p.id),
          label: String(p.name ?? p.label ?? ''),
        }));
      },
      error: () => {},
    });
  }

  private formatDateInput(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
