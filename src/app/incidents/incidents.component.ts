import { Component, OnInit } from '@angular/core';
import { ToastrService } from 'ngx-toastr';
import { AccessLogService } from '../access-log.service';
import { AccessIncident, AccessIncidentService } from './access-incident.service';

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

  pageIndex = 0;
  pageSize = 50;
  total = 0;
  readonly pageSizeOptions = [25, 50, 100];

  selected: AccessIncident | null = null;
  detailLoading = false;

  showViewPhotoDialog = false;
  viewPhotoUrl: string | null = null;
  viewPhotoTitle = '';
  photoZoom = 1;
  private readonly zoomMin = 0.5;
  private readonly zoomMax = 3;
  private readonly zoomStep = 0.25;

  constructor(
    private readonly incidentService: AccessIncidentService,
    private readonly accessLogService: AccessLogService,
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

  loadRows(): void {
    this.loading = true;
    this.incidentService
      .list({
        fecha_inicial: this.fechaInicial,
        fecha_final: this.fechaFinal,
        access_point_id: this.accessPointId ?? undefined,
        source: this.sourceFilter,
        page: this.pageIndex + 1,
        page_size: this.pageSize,
      })
      .subscribe({
        next: (result) => {
          this.rows = result.items;
          this.total = result.pagination.total;
          this.loading = false;
        },
        error: (e: Error) => {
          this.loading = false;
          this.rows = [];
          this.total = 0;
          this.toastr.error(e.message || 'No se pudieron cargar las incidencias');
        },
      });
  }

  applyFilters(): void {
    this.pageIndex = 0;
    this.loadRows();
  }

  onPageChange(event: { pageIndex: number; pageSize: number }): void {
    this.pageIndex = event.pageIndex;
    this.pageSize = event.pageSize;
    this.loadRows();
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

  openViewPhoto(row: AccessIncident, event?: Event): void {
    event?.stopPropagation();
    const urls = this.photoUrlsOf(row);
    if (!urls.length) {
      return;
    }
    this.openViewPhotoUrl(urls[0], row.incident_id, 0);
  }

  openViewPhotoUrl(url: string, incidentId: number, index = 0): void {
    if (!url) {
      return;
    }
    this.viewPhotoUrl = url;
    this.viewPhotoTitle = `Incidencia #${incidentId} · foto ${index + 1}`;
    this.photoZoom = 1;
    this.showViewPhotoDialog = true;
  }

  closeViewPhoto(): void {
    this.showViewPhotoDialog = false;
    this.viewPhotoUrl = null;
    this.viewPhotoTitle = '';
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

  photoUrl(path: string | null | undefined): string | null {
    return this.incidentService.photoUrl(path);
  }

  photoUrlsOf(incident: AccessIncident | null | undefined): string[] {
    return this.incidentService.photoUrlsOf(incident);
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
