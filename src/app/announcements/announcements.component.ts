import { Component, OnInit } from '@angular/core';
import { ToastrService } from 'ngx-toastr';
import { ApiService } from '../api.service';
import { AuthService } from '../auth.service';
import { NavPermissionService } from '../nav-permission.service';

interface AnnouncementItem {
  id: number;
  title: string;
  message: string;
  start_at?: string | null;
  end_at?: string | null;
  cta_label?: string | null;
  cta_url?: string | null;
  image_url?: string | null;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

@Component({
  selector: 'app-announcements',
  templateUrl: './announcements.component.html',
  styleUrls: ['./announcements.component.css']
})
export class AnnouncementsComponent implements OnInit {
  loading = false;
  saving = false;
  uploadingImage = false;
  announcements: AnnouncementItem[] = [];

  editingId: number | null = null;
  form = this.emptyForm();

  constructor(
    public readonly auth: AuthService,
    public readonly navPerm: NavPermissionService,
    private readonly api: ApiService,
    private readonly toastr: ToastrService
  ) {}

  get canManageAnnouncements(): boolean {
    return this.navPerm.canManage('announcements');
  }

  ngOnInit(): void {
    this.loadRows();
  }

  private emptyForm() {
    return {
      title: '',
      message: '',
      start_at: '',
      end_at: '',
      cta_label: '',
      cta_url: '',
      image_url: '',
      is_active: true
    };
  }

  private loadRows(): void {
    this.loading = true;
    this.api.get<AnnouncementItem[]>('api/v1/announcements').subscribe({
      next: (res) => {
        this.announcements = Array.isArray(res?.data) ? res.data : [];
        this.loading = false;
      },
      error: () => {
        this.announcements = [];
        this.loading = false;
      }
    });
  }

  startCreate(): void {
    this.editingId = null;
    this.form = this.emptyForm();
  }

  editRow(row: AnnouncementItem): void {
    this.editingId = row.id;
    this.form = {
      title: String(row.title ?? ''),
      message: String(row.message ?? ''),
      start_at: this.toDateTimeLocal(row.start_at),
      end_at: this.toDateTimeLocal(row.end_at),
      cta_label: String(row.cta_label ?? ''),
      cta_url: String(row.cta_url ?? ''),
      image_url: String(row.image_url ?? ''),
      is_active: !!row.is_active
    };
  }

  cancelEdit(): void {
    this.startCreate();
  }

  save(): void {
    if (!this.canManageAnnouncements) {
      this.toastr.error('Solo administradores.');
      return;
    }
    const payload = {
      title: this.form.title.trim(),
      message: this.form.message.trim(),
      start_at: this.normalizeDateTime(this.form.start_at),
      end_at: this.normalizeDateTime(this.form.end_at),
      cta_label: this.form.cta_label.trim(),
      cta_url: this.form.cta_url.trim(),
      image_url: this.form.image_url.trim(),
      is_active: !!this.form.is_active
    };
    if (!payload.title || !payload.message) {
      this.toastr.warning('Titulo y mensaje son obligatorios.');
      return;
    }

    this.saving = true;
    const req = this.editingId
      ? this.api.put(`api/v1/announcements/${this.editingId}`, payload)
      : this.api.post('api/v1/announcements', payload);

    req.subscribe({
      next: () => {
        this.saving = false;
        this.toastr.success(this.editingId ? 'Comunicado actualizado.' : 'Comunicado creado.');
        this.startCreate();
        this.loadRows();
      },
      error: (e) => {
        this.saving = false;
        this.toastr.error(e?.message || 'No se pudo guardar.');
      }
    });
  }

  toggleRowActive(row: AnnouncementItem): void {
    if (!this.canManageAnnouncements) {
      this.toastr.error('Solo administradores.');
      return;
    }
    const nextState = !row.is_active;
    const ok = window.confirm(`¿Cambiar estado de "${row.title}" a ${nextState ? 'Activo' : 'Inactivo'}?`);
    if (!ok) {
      return;
    }
    const payload = {
      title: String(row.title ?? '').trim(),
      message: String(row.message ?? '').trim(),
      start_at: this.normalizeDateTime(this.toDateTimeLocal(row.start_at)),
      end_at: this.normalizeDateTime(this.toDateTimeLocal(row.end_at)),
      cta_label: String(row.cta_label ?? '').trim(),
      cta_url: String(row.cta_url ?? '').trim(),
      image_url: String(row.image_url ?? '').trim(),
      is_active: nextState
    };
    this.api.put(`api/v1/announcements/${row.id}`, payload).subscribe({
      next: () => {
        this.toastr.success(`Comunicado ${nextState ? 'activado' : 'inhabilitado'}.`);
        this.loadRows();
      },
      error: (e) => {
        this.toastr.error(e?.message || 'No se pudo actualizar estado.');
      }
    });
  }

  private toDateTimeLocal(value: string | null | undefined): string {
    const v = String(value ?? '').trim();
    if (!v) return '';
    const normalized = v.replace(' ', 'T');
    return normalized.slice(0, 16);
  }

  private normalizeDateTime(value: string): string {
    const v = String(value ?? '').trim();
    return v ? v : '';
  }

  onAnnouncementImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      this.toastr.warning('Seleccione una imagen valida.');
      input.value = '';
      return;
    }
    this.uploadingImage = true;
    this.api.uploadAnnouncementImage(file).subscribe({
      next: (res) => {
        this.uploadingImage = false;
        input.value = '';
        const url = String(res?.data?.url ?? '').trim();
        if (!url) {
          this.toastr.error('No se recibio URL de imagen.');
          return;
        }
        this.form.image_url = url;
        this.toastr.success('Imagen subida.');
      },
      error: (e) => {
        this.uploadingImage = false;
        input.value = '';
        this.toastr.error(e?.message || 'No se pudo subir la imagen.');
      }
    });
  }

  announcementImagePreview(): string | null {
    return this.api.getPhotoUrl(this.form.image_url);
  }

  announcementRowImage(url: string | null | undefined): string | null {
    return this.api.getPhotoUrl(url);
  }
}

