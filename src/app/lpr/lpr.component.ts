import { Component, OnDestroy, OnInit } from '@angular/core';
import { ToastrService } from 'ngx-toastr';
import { EntranceService } from '../entrance.service';
import { NavPermissionService } from '../nav-permission.service';
import { LprCamera, LprEvent, LprService } from './lpr.service';

interface AccessPointOption {
  id: number;
  name: string;
}

@Component({
  selector: 'app-lpr',
  templateUrl: './lpr.component.html',
  styleUrls: ['./lpr.component.css'],
})
export class LprComponent implements OnInit, OnDestroy {
  tab: 'events' | 'cameras' = 'events';
  events: LprEvent[] = [];
  cameras: LprCamera[] = [];
  accessPoints: AccessPointOption[] = [];
  loadingEvents = false;
  loadingCameras = false;

  form: Partial<LprCamera> = this.emptyCamera();
  editingId: number | null = null;
  showForm = false;

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastAlertEventId = 0;

  constructor(
    private lpr: LprService,
    private entrance: EntranceService,
    private navPerm: NavPermissionService,
    private toastr: ToastrService
  ) {}

  get canManage(): boolean {
    return this.navPerm.canManage('lpr');
  }

  ngOnInit(): void {
    this.navPerm.load().subscribe();
    this.loadEvents(true);
    this.loadCameras();
    this.loadAccessPoints();
    this.pollTimer = setInterval(() => this.loadEvents(false), 4000);
  }

  ngOnDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  emptyCamera(): Partial<LprCamera> {
    return {
      name: '',
      access_point_id: null as unknown as number,
      direction: 'INGRESO',
      stream_url: '',
      snapshot_url: '',
      is_enabled: 1,
      min_confidence: 0.55,
      debounce_seconds: 30,
      poll_interval_ms: 1000,
    };
  }

  loadAccessPoints(): void {
    this.entrance.getAllAreas().subscribe({
      next: (res: any) => {
        const list = Array.isArray(res) ? res : res?.data ?? [];
        this.accessPoints = (list as any[])
          .filter((p) => p.is_active === 1 || p.is_active === true)
          .map((p) => ({ id: Number(p.id), name: String(p.name) }));
      },
      error: () => {
        this.accessPoints = [];
      },
    });
  }

  loadCameras(): void {
    this.loadingCameras = true;
    this.lpr.listCameras().subscribe({
      next: (res) => {
        this.cameras = (res?.data ?? res ?? []) as LprCamera[];
        this.loadingCameras = false;
      },
      error: () => {
        this.loadingCameras = false;
        this.toastr.error('No se pudieron cargar las cámaras LPR');
      },
    });
  }

  loadEvents(showSpinner: boolean): void {
    if (showSpinner) {
      this.loadingEvents = true;
    }
    this.lpr.listEvents(60).subscribe({
      next: (res) => {
        const list = (res?.data ?? res ?? []) as LprEvent[];
        this.events = list;
        this.loadingEvents = false;
        this.notifyNewAlerts(list);
      },
      error: () => {
        this.loadingEvents = false;
      },
    });
  }

  private notifyNewAlerts(list: LprEvent[]): void {
    if (!list.length) {
      return;
    }
    const newestId = Number(list[0].event_id) || 0;
    if (this.lastAlertEventId === 0) {
      this.lastAlertEventId = newestId;
      return;
    }
    const fresh = list.filter((e) => Number(e.event_id) > this.lastAlertEventId);
    this.lastAlertEventId = newestId;
    for (const e of fresh.reverse()) {
      if (e.result === 'DENIED' || e.result === 'PENDING_HOUSE') {
        this.toastr.warning(
          `${e.license_plate}: ${e.message || e.result}`,
          'Alerta LPR'
        );
      } else if (e.result === 'REGISTERED') {
        this.toastr.success(
          `${e.license_plate} — ${e.direction} registrado`,
          'LPR'
        );
      }
    }
  }

  startCreate(): void {
    this.editingId = null;
    this.form = this.emptyCamera();
    this.showForm = true;
    this.tab = 'cameras';
  }

  startEdit(cam: LprCamera): void {
    this.editingId = cam.camera_id;
    this.form = {
      name: cam.name,
      access_point_id: cam.access_point_id,
      direction: cam.direction,
      stream_url: cam.stream_url ?? '',
      snapshot_url: cam.snapshot_url ?? '',
      is_enabled: cam.is_enabled === 1 || cam.is_enabled === true ? 1 : 0,
      min_confidence: Number(cam.min_confidence) || 0.55,
      debounce_seconds: Number(cam.debounce_seconds) || 30,
      poll_interval_ms: Number(cam.poll_interval_ms) || 1000,
    };
    this.showForm = true;
    this.tab = 'cameras';
  }

  cancelEdit(): void {
    this.editingId = null;
    this.showForm = false;
    this.form = this.emptyCamera();
  }

  saveCamera(): void {
    if (!this.canManage) {
      return;
    }
    if (!this.form.name?.trim()) {
      this.toastr.error('El nombre es obligatorio');
      return;
    }
    if (!this.form.access_point_id) {
      this.toastr.error('Seleccione un punto de acceso');
      return;
    }
    const stream = (this.form.stream_url || '').trim();
    const snap = (this.form.snapshot_url || '').trim();
    if (!stream && !snap) {
      this.toastr.error('Indique URL RTSP y/o snapshot HTTP');
      return;
    }

    const body = {
      name: this.form.name.trim(),
      access_point_id: Number(this.form.access_point_id),
      direction: this.form.direction || 'INGRESO',
      stream_url: stream || null,
      snapshot_url: snap || null,
      is_enabled: this.form.is_enabled ? 1 : 0,
      min_confidence: Number(this.form.min_confidence) || 0.55,
      debounce_seconds: Number(this.form.debounce_seconds) || 30,
      poll_interval_ms: Number(this.form.poll_interval_ms) || 1000,
    };

    const req =
      this.editingId != null
        ? this.lpr.updateCamera(this.editingId, body)
        : this.lpr.createCamera(body);

    req.subscribe({
      next: () => {
        this.toastr.success(this.editingId != null ? 'Cámara actualizada' : 'Cámara creada');
        this.cancelEdit();
        this.loadCameras();
      },
      error: (err) => {
        this.toastr.error(err?.error?.error || 'No se pudo guardar la cámara');
      },
    });
  }

  resultClass(result: string): string {
    switch ((result || '').toUpperCase()) {
      case 'REGISTERED':
        return 'lpr-badge lpr-badge--ok';
      case 'DENIED':
      case 'PENDING_HOUSE':
        return 'lpr-badge lpr-badge--alert';
      case 'DUPLICATE':
      case 'LOW_CONFIDENCE':
        return 'lpr-badge lpr-badge--muted';
      default:
        return 'lpr-badge';
    }
  }

  enabledLabel(v: number | boolean | undefined): string {
    return v === 1 || v === true ? 'Activa' : 'Inactiva';
  }
}
