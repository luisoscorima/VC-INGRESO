import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { ToastrService } from 'ngx-toastr';
import { AccessIncidentService, IncidentFormDialogData } from './access-incident.service';
import { ApiService } from '../api.service';

interface AccessPointOption {
  id: number;
  name: string;
}

@Component({
  selector: 'app-incident-form-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatIconModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title class="!text-lg !font-semibold">
      {{ data.mode === 'scan' ? 'Incidencia del escaneo' : 'Nueva incidencia' }}
    </h2>
    <mat-dialog-content class="!pt-2">
      <div class="space-y-4">
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Punto de acceso</label>
          <select
            [(ngModel)]="accessPointId"
            [disabled]="!!data.lockAccessPoint || loadingPoints"
            class="vc-select-sm w-full">
            <option [ngValue]="null">— Seleccione —</option>
            <option *ngFor="let p of accessPoints" [ngValue]="p.id">{{ p.name }}</option>
          </select>
        </div>

        <div>
          <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Descripción</label>
          <textarea
            [(ngModel)]="description"
            rows="4"
            maxlength="2000"
            placeholder="Describa la incidencia…"
            class="vc-field w-full resize-y"></textarea>
        </div>

        <div>
          <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Foto (opcional)</label>
          <input type="file" accept="image/*" (change)="onPhotoSelected($event)" class="block w-full text-sm" />
          <img
            *ngIf="photoPreview"
            [src]="photoPreview"
            alt="Vista previa"
            class="mt-2 max-h-40 rounded-lg border border-gray-200 object-contain dark:border-gray-600" />
        </div>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="!gap-2">
      <button type="button" mat-button (click)="close()" [disabled]="saving">Cancelar</button>
      <button
        type="button"
        mat-flat-button
        color="primary"
        (click)="submit()"
        [disabled]="saving || !canSubmit">
        {{ saving ? 'Guardando…' : 'Registrar' }}
      </button>
    </mat-dialog-actions>
  `,
})
export class IncidentFormDialogComponent implements OnInit {
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
    if (this.photoPreview) {
      URL.revokeObjectURL(this.photoPreview);
    }
    this.photoPreview = file ? URL.createObjectURL(file) : null;
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
