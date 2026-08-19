import { Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { ToastrService } from 'ngx-toastr';
import { AccessIncidentService, IncidentFormDialogData } from './access-incident.service';
import { ApiService } from '../api.service';
import { compressImageFile, MOBILE_PHOTO_COMPRESS } from '../shared/compress-image';
import { PhotoSourcePickerComponent } from '../shared/photo-source-picker/photo-source-picker.component';

/** panelClass para MatDialog (estilos en styles.css → .vc-incident-dialog) */
export const INCIDENT_DIALOG_PANEL_CLASS = 'vc-incident-dialog';

interface AccessPointOption {
  id: number;
  name: string;
}

interface HouseOption {
  house_id: number;
  block_house: string;
  lot: string;
  apartment: string | null;
}

interface PendingPhoto {
  id: number;
  file: File;
  preview: string;
}

@Component({
  selector: 'app-incident-form-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatIconModule, MatButtonModule, PhotoSourcePickerComponent],
  template: `
    <h2 mat-dialog-title class="vc-incident-dialog__title">
      Incidencia del acceso
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

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="vc-incident-dialog__label mb-1 block text-xs font-medium text-gray-700">Mz (opcional)</label>
            <select
              [(ngModel)]="selectedBlock"
              (ngModelChange)="onBlockChange()"
              [disabled]="loadingHouses"
              class="vc-select-sm w-full">
              <option value="">— Ninguna —</option>
              <option *ngFor="let b of uniqueBlocks" [value]="b">Mz: {{ b }}</option>
            </select>
          </div>
          <div>
            <label class="vc-incident-dialog__label mb-1 block text-xs font-medium text-gray-700">Lote (opcional)</label>
            <select
              [(ngModel)]="selectedLot"
              (ngModelChange)="onLotChange()"
              [disabled]="loadingHouses || !selectedBlock"
              class="vc-select-sm w-full">
              <option value="">— Seleccione —</option>
              <option *ngFor="let lot of uniqueLots" [value]="lot">Lt: {{ lot }}</option>
            </select>
          </div>
        </div>
        <p *ngIf="data.mode === 'scan'" class="text-xs text-gray-500 dark:text-gray-400">
          Queda ligada a este acceso (escáner o historial). En denegados o visitas sin casa puede indicar Mz/Lote.
        </p>

        <div *ngIf="apartmentOptions.length > 1">
          <label class="vc-incident-dialog__label mb-1 block text-xs font-medium text-gray-700">Dpto (opcional)</label>
          <select [(ngModel)]="selectedApartment" class="vc-select-sm w-full">
            <option value="">— Sin dpto / primero —</option>
            <option *ngFor="let apt of apartmentOptions" [value]="apt">{{ apt }}</option>
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
          <label class="vc-incident-dialog__label mb-1 block text-xs font-medium text-gray-700">
            Fotos (opcional, máx. {{ maxPhotos }})
          </label>
          <div *ngIf="photos.length" class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div *ngFor="let ph of photos; let i = index" class="relative overflow-hidden rounded-lg border border-gray-200 dark:border-gray-600">
              <img [src]="ph.preview" [alt]="'Foto ' + (i + 1)" class="h-28 w-full object-cover" />
              <button
                type="button"
                class="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
                [disabled]="compressingPhoto || saving"
                (click)="removePhoto(i)"
                title="Quitar foto"
                aria-label="Quitar foto">
                <mat-icon class="!h-4 !w-4 !text-base">close</mat-icon>
              </button>
              <span class="absolute bottom-1 left-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">
                {{ i + 1 }}/{{ photos.length }}
              </span>
            </div>
          </div>

          <app-photo-source-picker
            *ngIf="canAddPhoto"
            [zoneTitle]="photos.length ? 'Añadir otra foto' : 'Añadir imagen'"
            [cameraLabel]="photos.length ? 'Tomar otra' : 'Tomar foto'"
            [compressing]="compressingPhoto"
            [disabled]="saving"
            (fileSelected)="onPhotoFileSelected($event)"
          />
          <p *ngIf="photos.length >= maxPhotos" class="mt-1 text-xs text-gray-500">
            Límite de {{ maxPhotos }} fotos alcanzado.
          </p>
        </div>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="!gap-2 !px-6 !pb-4">
      <button type="button" class="vc-btn-cancel" (click)="close()" [disabled]="saving">Cancelar</button>
      <button
        type="button"
        class="vc-btn-primary !px-5 !py-2.5"
        (click)="submit()"
        [disabled]="saving || compressingPhoto || !canSubmit">
        {{ saving ? 'Guardando…' : 'Registrar' }}
      </button>
    </mat-dialog-actions>
  `,
})
export class IncidentFormDialogComponent implements OnInit, OnDestroy {
  readonly maxPhotos = 5;

  accessPoints: AccessPointOption[] = [];
  accessPointId: number | null = null;
  description = '';
  photos: PendingPhoto[] = [];
  saving = false;
  loadingPoints = false;
  compressingPhoto = false;
  private photoPickSeq = 0;
  private nextPhotoId = 1;

  houses: HouseOption[] = [];
  loadingHouses = false;
  selectedBlock = '';
  selectedLot = '';
  selectedApartment = '';

  constructor(
    private readonly dialogRef: MatDialogRef<IncidentFormDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public readonly data: IncidentFormDialogData,
    private readonly incidentService: AccessIncidentService,
    private readonly api: ApiService,
    private readonly toastr: ToastrService
  ) {
    // Evita que un toque fuera (p. ej. bajar el teclado en móvil) cierre el modal y pierda fotos.
    this.dialogRef.disableClose = true;
  }

  ngOnInit(): void {
    this.accessPointId = this.data.accessPointId ?? null;
    this.loadAccessPoints();
    this.loadHouses();
  }

  ngOnDestroy(): void {
    this.photoPickSeq++;
    this.clearAllPreviews();
  }

  get canSubmit(): boolean {
    return !!this.accessPointId && this.description.trim().length > 0;
  }

  get canAddPhoto(): boolean {
    return this.photos.length < this.maxPhotos;
  }

  get uniqueBlocks(): string[] {
    return [...new Set(this.houses.map((h) => h.block_house).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    );
  }

  get uniqueLots(): string[] {
    if (!this.selectedBlock) {
      return [];
    }
    const filtered = this.houses.filter((h) => h.block_house === this.selectedBlock);
    return [...new Set(filtered.map((h) => h.lot).filter(Boolean))].sort(
      (a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b)
    );
  }

  get apartmentOptions(): string[] {
    if (!this.selectedBlock || !this.selectedLot) {
      return [];
    }
    return this.houses
      .filter((h) => h.block_house === this.selectedBlock && h.lot === this.selectedLot)
      .map((h) => (h.apartment ?? '').trim())
      .filter((apt) => apt !== '')
      .filter((apt, i, arr) => arr.indexOf(apt) === i)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  onBlockChange(): void {
    this.selectedLot = '';
    this.selectedApartment = '';
  }

  onLotChange(): void {
    this.selectedApartment = '';
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

  private loadHouses(): void {
    this.loadingHouses = true;
    this.api.getRaw('api/v1/houses').subscribe({
      next: (raw: unknown) => {
        const list = Array.isArray(raw)
          ? raw
          : raw && typeof raw === 'object' && Array.isArray((raw as { data?: unknown }).data)
            ? (raw as { data: unknown[] }).data
            : [];
        this.houses = (list as any[])
          .map((h) => ({
            house_id: Number(h.house_id),
            block_house: String(h.block_house ?? '').trim(),
            lot: String(h.lot ?? '').trim(),
            apartment: h.apartment != null && String(h.apartment).trim() !== '' ? String(h.apartment).trim() : null,
          }))
          .filter((h) => h.house_id > 0 && h.block_house !== '');
        this.loadingHouses = false;
        this.prefillHouseFromScanContext();
      },
      error: () => {
        this.loadingHouses = false;
        this.toastr.error('No se pudieron cargar las casas (Mz/Lote)');
      },
    });
  }

  /** Si el escaneo ya trae house_id, preselecciona Mz/Lt. */
  private prefillHouseFromScanContext(): void {
    const houseId = this.data.mode === 'scan' ? this.data.scanContext?.house_id ?? null : null;
    if (!houseId) {
      return;
    }
    const house = this.houses.find((h) => h.house_id === houseId);
    if (!house) {
      return;
    }
    this.selectedBlock = house.block_house;
    this.selectedLot = house.lot;
    this.selectedApartment = house.apartment ?? '';
  }

  /** Resuelve house_id a partir de Mz + Lote (+ dpto si aplica). */
  private resolveHouseId(): number | null {
    if (!this.selectedBlock || !this.selectedLot) {
      return null;
    }
    const matches = this.houses.filter(
      (h) => h.block_house === this.selectedBlock && h.lot === this.selectedLot
    );
    if (!matches.length) {
      return null;
    }
    if (this.selectedApartment) {
      const byApt = matches.find((h) => (h.apartment ?? '') === this.selectedApartment);
      if (byApt) {
        return byApt.house_id;
      }
    }
    const noApt = matches.find((h) => !h.apartment);
    return (noApt ?? matches[0]).house_id;
  }

  onPhotoFileSelected(file: File): void {
    void this.addPhoto(file);
  }

  removePhoto(index: number): void {
    const [removed] = this.photos.splice(index, 1);
    if (removed?.preview) {
      URL.revokeObjectURL(removed.preview);
    }
  }

  private clearAllPreviews(): void {
    for (const ph of this.photos) {
      URL.revokeObjectURL(ph.preview);
    }
    this.photos = [];
  }

  private async addPhoto(file: File): Promise<void> {
    if (!this.canAddPhoto) {
      this.toastr.warning(`Máximo ${this.maxPhotos} fotos.`);
      return;
    }

    const seq = ++this.photoPickSeq;
    this.compressingPhoto = true;

    try {
      let ready = file;
      try {
        ready = await compressImageFile(file, MOBILE_PHOTO_COMPRESS);
      } catch {
        this.toastr.warning('No se pudo comprimir la foto; se usará el original.');
      }
      if (seq !== this.photoPickSeq) {
        return;
      }
      if (this.photos.length >= this.maxPhotos) {
        return;
      }
      this.photos = [
        ...this.photos,
        {
          id: this.nextPhotoId++,
          file: ready,
          preview: URL.createObjectURL(ready),
        },
      ];
    } finally {
      if (seq === this.photoPickSeq) {
        this.compressingPhoto = false;
      }
    }
  }

  submit(): void {
    if (!this.canSubmit || !this.accessPointId || this.compressingPhoto) {
      return;
    }

    const form = new FormData();
    form.append('description', this.description.trim());
    form.append('access_point_id', String(this.accessPointId));
    form.append('source', 'scan');

    if (this.data.scanContext) {
      const ctx = this.data.scanContext;
      if (ctx.access_log_id) form.append('access_log_id', String(ctx.access_log_id));
      if (ctx.temp_access_log_id) form.append('temp_access_log_id', String(ctx.temp_access_log_id));
      if (ctx.person_id) form.append('person_id', String(ctx.person_id));
      if (ctx.vehicle_id) form.append('vehicle_id', String(ctx.vehicle_id));
      if (ctx.temp_visit_id) form.append('temp_visit_id', String(ctx.temp_visit_id));
      if (ctx.doc_number) form.append('doc_number', ctx.doc_number);
      if (ctx.license_plate) form.append('license_plate', ctx.license_plate);
      if (ctx.status_validated) form.append('status_validated', ctx.status_validated);
    }

    // Casa elegida por el operario (manual o escaneo denegado / sin casa)
    const houseId = this.resolveHouseId() ?? (this.data.mode === 'scan' ? this.data.scanContext?.house_id ?? null : null);
    if (houseId) {
      form.append('house_id', String(houseId));
    }

    for (const ph of this.photos) {
      form.append('photos[]', ph.file, ph.file.name || 'incident.jpg');
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
