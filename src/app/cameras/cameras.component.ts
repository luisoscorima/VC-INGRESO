import { Component, OnInit } from '@angular/core';
import { ToastrService } from 'ngx-toastr';
import { ApiService } from '../api.service';
import { todayYmdInAppTimeZone } from '../app-date.util';
import { AccessPointRow } from '../access-points/access-points.component';
import { EntranceService } from '../entrance.service';
import { NavPermissionService } from '../nav-permission.service';
import {
  AccessCamera,
  CameraAccessEvent,
  CameraAccessService,
} from './camera-access.service';

interface CameraForm {
  camera_id: number;
  name: string;
  access_point_id: number | null;
  debounce_seconds: number;
  is_active: boolean;
}

@Component({
  selector: 'app-cameras',
  templateUrl: './cameras.component.html',
  styleUrls: ['./cameras.component.css'],
})
export class CamerasComponent implements OnInit {
  activeTab: 'cameras' | 'events' = 'cameras';
  cameras: AccessCamera[] = [];
  events: CameraAccessEvent[] = [];
  accessPoints: AccessPointRow[] = [];
  canManage = false;
  loading = false;

  formOpen = false;
  secretOpen = false;
  photoOpen = false;
  editing = false;
  form: CameraForm = this.emptyForm();
  issuedKey = '';
  issuedKeyTitle = '';
  selectedPhotoUrl: string | null = null;

  fechaInicial = todayYmdInAppTimeZone();
  fechaFinal = todayYmdInAppTimeZone();
  resultFilter = '';
  cameraFilter = 0;
  plateFilter = '';
  eventPage = 1;
  eventLimit = 50;
  eventTotal = 0;
  eventTotalPages = 0;

  constructor(
    private cameraService: CameraAccessService,
    private entranceService: EntranceService,
    private navPerm: NavPermissionService,
    private api: ApiService,
    private toastr: ToastrService
  ) {}

  ngOnInit(): void {
    this.navPerm.load().subscribe(() => {
      this.canManage = this.navPerm.canManage('cameras');
    });
    this.loadCameras();
    this.entranceService.getAllAreas().subscribe({
      next: (res: any) => {
        const rows = Array.isArray(res) ? res : (res?.data ?? []);
        this.accessPoints = rows.filter((p: AccessPointRow) => p.is_active === 1 || p.is_active === true);
      },
      error: () => this.toastr.error('No se pudieron cargar los puntos de acceso'),
    });
  }

  loadCameras(): void {
    this.cameraService.getCameras().subscribe({
      next: (rows) => (this.cameras = rows),
      error: () => this.toastr.error('No se pudieron cargar las cámaras'),
    });
  }

  loadEvents(page = 1): void {
    this.loading = true;
    this.eventPage = page;
    const params: Record<string, string | number> = {
      page,
      limit: this.eventLimit,
      fecha_inicial: this.fechaInicial,
      fecha_final: this.fechaFinal,
    };
    if (this.resultFilter) params['result'] = this.resultFilter;
    if (this.cameraFilter > 0) params['camera_id'] = this.cameraFilter;
    if (this.plateFilter.trim()) params['license_plate'] = this.plateFilter.trim();

    this.cameraService.getEvents(params).subscribe({
      next: (res) => {
        this.events = res.data;
        this.eventTotal = res.pagination.total;
        this.eventTotalPages = res.pagination.total_pages;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.toastr.error('No se pudieron cargar las lecturas');
      },
    });
  }

  changeTab(tab: 'cameras' | 'events'): void {
    this.activeTab = tab;
    if (tab === 'events') this.loadEvents();
  }

  openCreate(): void {
    this.editing = false;
    this.form = this.emptyForm();
    this.formOpen = true;
  }

  openEdit(camera: AccessCamera): void {
    this.editing = true;
    this.form = {
      camera_id: camera.camera_id,
      name: camera.name,
      access_point_id: camera.access_point_id,
      debounce_seconds: camera.debounce_seconds,
      is_active: camera.is_active === 1 || camera.is_active === true,
    };
    this.formOpen = true;
  }

  saveCamera(): void {
    if (!this.form.name.trim() || !this.form.access_point_id) {
      this.toastr.warning('Indique nombre y punto de acceso');
      return;
    }
    const body = {
      name: this.form.name.trim(),
      access_point_id: this.form.access_point_id,
      debounce_seconds: Math.min(600, Math.max(5, Number(this.form.debounce_seconds) || 45)),
      is_active: this.form.is_active,
    };
    const request = this.editing
      ? this.cameraService.updateCamera(this.form.camera_id, body)
      : this.cameraService.createCamera(body);

    request.subscribe({
      next: (res: any) => {
        this.formOpen = false;
        this.loadCameras();
        this.toastr.success(res.message ?? 'Cámara guardada');
        if (!this.editing && res.data?.api_key) {
          this.showSecret('Clave de la nueva cámara', res.data.api_key);
        }
      },
      error: () => this.toastr.error('No se pudo guardar la cámara'),
    });
  }

  rotateKey(camera: AccessCamera): void {
    if (!confirm(`¿Rotar la clave de "${camera.name}"? La clave anterior dejará de funcionar.`)) return;
    this.cameraService.rotateKey(camera.camera_id).subscribe({
      next: (res) => {
        this.loadCameras();
        if (res.data?.api_key) this.showSecret('Nueva clave de cámara', res.data.api_key);
      },
      error: () => this.toastr.error('No se pudo rotar la clave'),
    });
  }

  copyKey(): void {
    navigator.clipboard.writeText(this.issuedKey).then(
      () => this.toastr.success('Clave copiada'),
      () => this.toastr.warning('Seleccione y copie la clave manualmente')
    );
  }

  showPhoto(event: CameraAccessEvent): void {
    this.selectedPhotoUrl = this.api.getPhotoUrl(event.photo_url);
    if (this.selectedPhotoUrl) this.photoOpen = true;
  }

  resultLabel(result: string): string {
    return {
      ALLOWED: 'Permitido',
      DENIED: 'Denegado',
      IGNORED_DUPLICATE: 'Duplicado',
    }[result] ?? result;
  }

  matchLabel(match: string): string {
    return {
      REGISTRY: 'Vehículo residente',
      EXTERNAL: 'Visita temporal',
      NONE: 'Sin coincidencia',
      DENIED: 'No autorizado',
    }[match] ?? match;
  }

  private showSecret(title: string, key: string): void {
    this.issuedKeyTitle = title;
    this.issuedKey = key;
    this.secretOpen = true;
  }

  private emptyForm(): CameraForm {
    return {
      camera_id: 0,
      name: '',
      access_point_id: null,
      debounce_seconds: 45,
      is_active: true,
    };
  }
}
