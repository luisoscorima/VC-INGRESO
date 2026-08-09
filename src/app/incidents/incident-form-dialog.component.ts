import { Component, ElementRef, Inject, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { ToastrService } from 'ngx-toastr';
import { AccessIncidentService, IncidentFormDialogData } from './access-incident.service';
import { ApiService } from '../api.service';

/** panelClass para MatDialog (estilos en styles.css → .vc-incident-dialog) */
export const INCIDENT_DIALOG_PANEL_CLASS = 'vc-incident-dialog';

interface AccessPointOption {
  id: number;
  name: string;
}

@Component({
  selector: 'app-incident-form-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatIconModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title class="vc-incident-dialog__title">
      {{ data.mode === 'scan' ? 'Incidencia del escaneo' : 'Nueva incidencia' }}
    </h2>
    <mat-dialog-content class="!pt-2">
      <div class="space-y-4">
        <div>
          <label class="vc-incident-dialog__label mb-1 block text-xs font-medium text-gray-700">Punto de acceso</label>
          <select
            [(ngModel)]="accessPointId"
            [disabled]="!!data.lockAccessPoint || loadingPoints"
            class="vc-select-sm w-full">
            <option [ngValue]="null">— Seleccione —</option>
            <option *ngFor="let p of accessPoints" [ngValue]="p.id">{{ p.name }}</option>
          </select>
        </div>

        <div>
          <label class="vc-incident-dialog__label mb-1 block text-xs font-medium text-gray-700">Descripción</label>
          <textarea
            [(ngModel)]="description"
            rows="4"
            maxlength="2000"
            placeholder="Describa la incidencia…"
            class="vc-field w-full resize-y"></textarea>
        </div>

        <div>
          <label class="vc-incident-dialog__label mb-1 block text-xs font-medium text-gray-700">Foto (opcional)</label>
          <input
            #cameraInput
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp,.jpg,.jpeg,.png,.gif,.webp"
            capture="environment"
            (change)="onPhotoSelected($event)"
            class="hidden" />
          <input
            #galleryInput
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp,.jpg,.jpeg,.png,.gif,.webp"
            (change)="onPhotoSelected($event)"
            class="hidden" />

          <div *ngIf="!photoPreview" class="flex flex-wrap items-center gap-3">
            <button
              type="button"
              class="vc-btn-primary inline-flex items-center gap-2 !px-4 !py-2.5"
              (click)="openCamera()">
              <mat-icon class="!h-5 !w-5 !text-xl">photo_camera</mat-icon>
              Tomar foto
            </button>
            <button
              type="button"
              class="text-sm font-medium text-amber-700 hover:underline dark:text-amber-400"
              (click)="openGallery()">
              Elegir de galería
            </button>
          </div>

          <div *ngIf="photoPreview" class="mt-2">
            <img
              [src]="photoPreview"
              alt="Vista previa de la incidencia"
              class="max-h-40 rounded-lg border border-gray-200 object-contain dark:border-gray-600" />
            <div class="mt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                class="vc-btn-primary inline-flex items-center gap-2 !px-4 !py-2"
                (click)="openCamera()">
                <mat-icon class="!h-5 !w-5 !text-xl">photo_camera</mat-icon>
                Volver a tomar
              </button>
              <button
                type="button"
                class="text-sm font-medium text-red-700 hover:underline dark:text-red-400"
                (click)="removePhoto()">
                Quitar foto
              </button>
            </div>
          </div>
        </div>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="!gap-2 !px-6 !pb-4">
      <button type="button" class="vc-btn-cancel" (click)="close()" [disabled]="saving">Cancelar</button>
      <button
        type="button"
        class="vc-btn-primary !px-5 !py-2.5"
        (click)="submit()"
        [disabled]="saving || !canSubmit">
        {{ saving ? 'Guardando…' : 'Registrar' }}
      </button>
    </mat-dialog-actions>
  `,
})
export class IncidentFormDialogComponent implements OnInit, OnDestroy {
  @ViewChild('cameraInput') private cameraInput?: ElementRef<HTMLInputElement>;
  @ViewChild('galleryInput') private galleryInput?: ElementRef<HTMLInputElement>;

  accessPoints: AccessPointOption[] = [];
  accessPointId: number | null = null;
  description = '';
  photoFile: File | null = null;
  photoPreview: string | null = null;
  saving = false;
  loadingPoints = false;

  constructor(
    private readonly dialogRef: MatDialogRef<IncidentFormDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public readonly data: IncidentFormDialogData,
    private readonly incidentService: AccessIncidentService,
    private readonly api: ApiService,
    private readonly toastr: ToastrService
  ) {}

  ngOnInit(): void {
    this.accessPointId = this.data.accessPointId ?? null;
    this.loadAccessPoints();
  }

  ngOnDestroy(): void {
    this.clearPhotoPreview();
  }

  get canSubmit(): boolean {
    return !!this.accessPointId && this.description.trim().length > 0;
  }

  private loadAccessPoints(): void {
    this.loadingPoints = true;
    this.api.getRaw('api/v1/access-logs/access-points').subscribe({
      next: (raw: unknown) => {
        const list = Array.isArray(raw)
          ? raw
          : raw && typeof raw === 'object' && Array.isArray((raw as { data?: unknown }).data)
            ? (raw as { data: AccessPointOption[] }).data
            : [];
        this.accessPoints = (list as AccessPointOption[]).map((p) => ({
          id: Number((p as any).id),
          name: String((p as any).name ?? ''),
        }));
        this.loadingPoints = false;
      },
      error: () => {
        this.loadingPoints = false;
        this.toastr.error('No se pudieron cargar los puntos de acceso');
      },
    });
  }

  onPhotoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.photoFile = file;
    this.clearPhotoPreview();
    this.photoPreview = file ? URL.createObjectURL(file) : null;
  }

  openCamera(): void {
    this.openFileInput(this.cameraInput);
  }

  openGallery(): void {
    this.openFileInput(this.galleryInput);
  }

  removePhoto(): void {
    this.photoFile = null;
    this.clearPhotoPreview();
    this.resetFileInputs();
  }

  private openFileInput(input?: ElementRef<HTMLInputElement>): void {
    if (!input) {
      return;
    }
    input.nativeElement.value = '';
    input.nativeElement.click();
  }

  private resetFileInputs(): void {
    if (this.cameraInput) {
      this.cameraInput.nativeElement.value = '';
    }
    if (this.galleryInput) {
      this.galleryInput.nativeElement.value = '';
    }
  }

  private clearPhotoPreview(): void {
    if (this.photoPreview) {
      URL.revokeObjectURL(this.photoPreview);
      this.photoPreview = null;
    }
  }

  submit(): void {
    if (!this.canSubmit || !this.accessPointId) {
      return;
    }

    const form = new FormData();
    form.append('description', this.description.trim());
    form.append('access_point_id', String(this.accessPointId));
    form.append('source', this.data.mode);

    if (this.data.mode === 'scan' && this.data.scanContext) {
      const ctx = this.data.scanContext;
      if (ctx.access_log_id) form.append('access_log_id', String(ctx.access_log_id));
      if (ctx.temp_access_log_id) form.append('temp_access_log_id', String(ctx.temp_access_log_id));
      if (ctx.person_id) form.append('person_id', String(ctx.person_id));
      if (ctx.vehicle_id) form.append('vehicle_id', String(ctx.vehicle_id));
      if (ctx.temp_visit_id) form.append('temp_visit_id', String(ctx.temp_visit_id));
      if (ctx.house_id) form.append('house_id', String(ctx.house_id));
      if (ctx.doc_number) form.append('doc_number', ctx.doc_number);
      if (ctx.license_plate) form.append('license_plate', ctx.license_plate);
      if (ctx.status_validated) form.append('status_validated', ctx.status_validated);
    }

    if (this.photoFile) {
      form.append('photo', this.photoFile);
    }

    this.saving = true;
    this.incidentService.create(form).subscribe({
      next: () => {
        this.saving = false;
        this.toastr.success('Incidencia registrada');
        this.dialogRef.close(true);
      },
      error: (e: Error) => {
        this.saving = false;
        this.toastr.error(e.message || 'No se pudo registrar la incidencia');
      },
    });
  }

  close(): void {
    this.dialogRef.close(false);
  }
}
