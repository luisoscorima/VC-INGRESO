import { Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { ToastrService } from 'ngx-toastr';
import { ApiService } from '../api.service';
import { AccessLogService } from '../access-log.service';
import { compressImageFile, MOBILE_PHOTO_COMPRESS } from '../shared/compress-image';
import { PhotoSourcePickerComponent } from '../shared/photo-source-picker/photo-source-picker.component';
import {
  OPERATOR_DECISION_OPTIONS,
  OperatorDecision,
} from '../shared/operator-decision';
import {
  IncidentFormDialogComponent,
  INCIDENT_DIALOG_PANEL_CLASS,
} from '../incidents/incident-form-dialog.component';
import { IncidentFormDialogData, IncidentScanContext } from '../incidents/access-incident.service';

export const ACCESS_DETAILS_DIALOG_PANEL_CLASS = 'vc-incident-dialog';

export interface AccessDetailsDialogData {
  logRef: number;
  scanStatus: string;
  accessPointId: number;
  movementMode: 'INGRESO' | 'EGRESO';
  incidentContext: IncidentScanContext;
  canReportIncident: boolean;
  initialNotes?: string | null;
  initialDecision?: OperatorDecision | '' | null;
  initialHouseId?: number | null;
  rowLabel?: string;
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
  selector: 'app-access-details-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatIconModule, MatButtonModule, PhotoSourcePickerComponent],
  template: `
    <h2 mat-dialog-title class="vc-incident-dialog__title">Detalles del acceso</h2>
    <p *ngIf="data.rowLabel" class="mx-6 -mt-2 mb-0 text-xs text-gray-500 dark:text-gray-400">{{ data.rowLabel }}</p>
    <mat-dialog-content class="!pt-2">
      <div class="space-y-3">
        <div>
          <label class="vc-incident-dialog__label mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
            Nota del operario
          </label>
          <textarea
            [(ngModel)]="operatorNotes"
            rows="3"
            maxlength="2000"
            placeholder="Observaciones para auditoría…"
            class="vc-field w-full resize-y"></textarea>
        </div>

        <div>
          <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
            Fotos del acceso (opcional, máx. {{ maxPhotos }})
          </label>
          <div *ngIf="photos.length" class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div
              *ngFor="let ph of photos; let i = index"
              class="relative overflow-hidden rounded-lg border border-gray-200 dark:border-gray-600">
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
            </div>
          </div>
          <app-photo-source-picker
            *ngIf="canAddPhoto"
            [zoneTitle]="photos.length ? 'Añadir otra foto' : 'Añadir imagen'"
            [cameraLabel]="photos.length ? 'Tomar otra' : 'Tomar foto'"
            [compressing]="compressingPhoto"
            [disabled]="saving"
            (fileSelected)="onPhotoSelected($event)"
          />
        </div>

        <div>
          <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Decisión del operario</label>
          <select [(ngModel)]="operatorDecision" class="vc-select-sm w-full" (ngModelChange)="onDecisionChange($event)">
            <option *ngFor="let opt of operatorDecisionOptions" [ngValue]="opt.value">{{ opt.label }}</option>
          </select>
          <p class="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
            No modifica el resultado del scan; solo registra la acción del operario.
          </p>
        </div>

        <div class="space-y-2">
          <label class="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
            <input type="checkbox" [(ngModel)]="noHouse" (ngModelChange)="onNoHouseChange($event)" />
            Sin domicilio / no aplica
          </label>
          <div *ngIf="!noHouse" class="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div>
              <label class="mb-1 block text-xs text-gray-600 dark:text-gray-400">Manzana</label>
              <select [(ngModel)]="block" class="vc-select-sm w-full">
                <option value="">—</option>
                <option *ngFor="let b of blocks" [value]="b">{{ b }}</option>
              </select>
            </div>
            <div>
              <label class="mb-1 block text-xs text-gray-600 dark:text-gray-400">Lote</label>
              <select [(ngModel)]="lot" class="vc-select-sm w-full">
                <option value="">—</option>
                <option *ngFor="let l of lots" [value]="l">{{ l }}</option>
              </select>
            </div>
            <div *ngIf="apartments.length">
              <label class="mb-1 block text-xs text-gray-600 dark:text-gray-400">Dpto</label>
              <select [(ngModel)]="apartment" class="vc-select-sm w-full">
                <option value="">—</option>
                <option *ngFor="let a of apartments" [value]="a">{{ a }}</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="!flex-col !items-stretch !gap-2 !px-6 !pb-4 sm:!flex-row sm:!items-center">
      <button
        *ngIf="data.canReportIncident"
        type="button"
        class="order-2 mr-auto inline-flex items-center gap-1 text-xs font-medium text-amber-800 hover:underline dark:text-amber-200 sm:order-1"
        [disabled]="saving"
        (click)="openReportDialog()">
        <mat-icon class="!h-4 !w-4">report_problem</mat-icon>
        Reportar problema
      </button>
      <div class="order-1 flex justify-end gap-2 sm:order-2">
        <button type="button" class="vc-btn-cancel" (click)="close()" [disabled]="saving">Cancelar</button>
        <button
          type="button"
          class="vc-btn-primary !px-5 !py-2.5"
          (click)="submit()"
          [disabled]="saving || compressingPhoto">
          {{ primaryLabel }}
        </button>
      </div>
    </mat-dialog-actions>
  `,
})
export class AccessDetailsDialogComponent implements OnInit, OnDestroy {
  readonly maxPhotos = 5;
  readonly operatorDecisionOptions = OPERATOR_DECISION_OPTIONS;

  operatorNotes = '';
  operatorDecision: OperatorDecision | '' = '';
  noHouse = false;
  block = '';
  lot = '';
  apartment = '';
  photos: PendingPhoto[] = [];
  houses: HouseOption[] = [];
  saving = false;
  compressingPhoto = false;

  private photoPickSeq = 0;
  private nextPhotoId = 1;

  constructor(
    private readonly dialogRef: MatDialogRef<AccessDetailsDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public readonly data: AccessDetailsDialogData,
    private readonly accessLogService: AccessLogService,
    private readonly api: ApiService,
    private readonly toastr: ToastrService,
    private readonly dialog: MatDialog
  ) {
    this.dialogRef.disableClose = true;
  }

  ngOnInit(): void {
    this.operatorNotes = String(this.data.initialNotes ?? '').trim();
    this.operatorDecision = this.data.initialDecision ?? '';
    this.loadHouses();
  }

  ngOnDestroy(): void {
    this.photoPickSeq++;
    this.clearAllPhotos();
  }

  get canAddPhoto(): boolean {
    return this.photos.length < this.maxPhotos;
  }

  get blocks(): string[] {
    return [...new Set(this.houses.map((h) => h.block_house).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, 'es', { numeric: true })
    );
  }

  get lots(): string[] {
    if (!this.block) {
      return [];
    }
    return this.houses
      .filter((h) => h.block_house === this.block)
      .map((h) => h.lot)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  }

  get apartments(): string[] {
    if (!this.block || !this.lot) {
      return [];
    }
    return this.houses
      .filter((h) => h.block_house === this.block && h.lot === this.lot && h.apartment)
      .map((h) => h.apartment as string)
      .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  }

  get primaryLabel(): string {
    return this.saving ? 'Guardando…' : 'Guardar detalles';
  }

  onDecisionChange(value: OperatorDecision | ''): void {
    if (value === 'SIN_DOMICILIO') {
      this.noHouse = true;
    } else if (this.operatorDecision === 'SIN_DOMICILIO') {
      this.noHouse = false;
    }
  }

  onNoHouseChange(checked: boolean): void {
    if (checked && !this.operatorDecision) {
      this.operatorDecision = 'SIN_DOMICILIO';
    }
    if (!checked && this.operatorDecision === 'SIN_DOMICILIO') {
      this.operatorDecision = '';
    }
  }

  onPhotoSelected(file: File): void {
    void this.addPhoto(file);
  }

  removePhoto(index: number): void {
    const [removed] = this.photos.splice(index, 1);
    if (removed?.preview) {
      URL.revokeObjectURL(removed.preview);
    }
  }

  openReportDialog(): void {
    const incidentData: IncidentFormDialogData = {
      mode: 'scan',
      accessPointId: this.data.accessPointId,
      lockAccessPoint: true,
      scanContext: this.data.incidentContext,
    };
    this.dialog.open(IncidentFormDialogComponent, {
      width: 'min(480px, 96vw)',
      panelClass: INCIDENT_DIALOG_PANEL_CLASS,
      disableClose: true,
      data: incidentData,
    });
  }

  submit(): void {
    this.saveDetails();
  }

  close(): void {
    this.dialogRef.close(false);
  }

  private loadHouses(): void {
    this.api.getRaw('api/v1/houses').subscribe({
      next: (res) => {
        const list = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        this.houses = (list as any[])
          .map((h) => ({
            house_id: Number(h.house_id),
            block_house: String(h.block_house ?? '').trim(),
            lot: String(h.lot ?? '').trim(),
            apartment: h.apartment != null && String(h.apartment).trim() !== '' ? String(h.apartment).trim() : null,
          }))
          .filter((h) => h.house_id > 0 && h.block_house !== '');
        this.prefillHouse(this.data.initialHouseId ?? null);
      },
      error: () => {
        this.houses = [];
      },
    });
  }

  private prefillHouse(houseId: number | null): void {
    if (!houseId) {
      return;
    }
    const match = this.houses.find((h) => h.house_id === houseId);
    if (!match) {
      return;
    }
    this.block = match.block_house;
    this.lot = match.lot;
    this.apartment = match.apartment ?? '';
  }

  private resolveHouseId(): number | null {
    if (this.noHouse || !this.block || !this.lot) {
      return null;
    }
    const matches = this.houses.filter((h) => h.block_house === this.block && h.lot === this.lot);
    if (!matches.length) {
      return null;
    }
    if (this.apartment) {
      const byApt = matches.find((h) => h.apartment === this.apartment);
      if (byApt) {
        return byApt.house_id;
      }
    }
    const noApt = matches.find((h) => !h.apartment);
    return (noApt ?? matches[0]).house_id;
  }

  private buildFormData(): FormData {
    const form = new FormData();
    form.append('operator_notes', this.operatorNotes.trim());
    form.append('operator_decision', this.operatorDecision || '');
    const houseId = this.noHouse ? 0 : this.resolveHouseId();
    form.append('house_id', houseId != null ? String(houseId) : '0');
    for (const ph of this.photos) {
      form.append('photos[]', ph.file, ph.file.name || 'access.jpg');
    }
    return form;
  }

  private saveDetails(): void {
    this.saving = true;
    this.accessLogService.patchAccessDetails(this.data.logRef, this.buildFormData()).subscribe({
      next: () => {
        this.saving = false;
        this.toastr.success('Detalles guardados');
        this.dialogRef.close(true);
      },
      error: (err) => {
        this.saving = false;
        this.toastr.error(err?.message || 'No se pudieron guardar los detalles');
      },
    });
  }

  private clearAllPhotos(): void {
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
      if (seq !== this.photoPickSeq || this.photos.length >= this.maxPhotos) {
        return;
      }
      this.photos = [
        ...this.photos,
        { id: this.nextPhotoId++, file: ready, preview: URL.createObjectURL(ready) },
      ];
    } finally {
      if (seq === this.photoPickSeq) {
        this.compressingPhoto = false;
      }
    }
  }
}
