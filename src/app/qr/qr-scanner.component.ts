import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewInit,
  ViewChild,
  ElementRef,
  Output,
  EventEmitter,
} from '@angular/core';
import { BrowserCodeReader, BrowserMultiFormatReader } from '@zxing/browser';
import type { IScannerControls } from '@zxing/browser';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { ToastrService } from 'ngx-toastr';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ApiService } from '../api.service';
import { AccessLogService } from '../access-log.service';
import { QrAccessService, AccessQrScanResult } from './qr-access.service';
import { ExternalVisitAssignmentOption } from '../externalVehicle';
import { MatDialog } from '@angular/material/dialog';
import { NavPermissionService } from '../nav-permission.service';
import { IdentityDocumentType, inferIdentityDocumentType, normalizeIdentityDocument } from '../shared/identity-document';
import { parsePeruvianLicensePlate } from '../shared/license-plate';
import {
  IncidentFormDialogComponent,
  INCIDENT_DIALOG_PANEL_CLASS,
} from '../incidents/incident-form-dialog.component';
import {
  IncidentFormDialogData,
  IncidentScanContext,
  buildScanContextFromHistoryRow,
} from '../incidents/access-incident.service';
import { todayYmdInAppTimeZone } from '../app-date.util';
import { PhotoSourcePickerComponent } from '../shared/photo-source-picker/photo-source-picker.component';
import {
  OPERATOR_DECISION_OPTIONS,
  OperatorDecision,
  isAttentionScanStatus,
  operatorDecisionLabel,
} from '../shared/operator-decision';
import { compressImageFile, MOBILE_PHOTO_COMPRESS } from '../shared/compress-image';

/** Preferencia: último punto elegido (persiste al actualizar la página). */
const ACCESS_POINT_STORAGE_KEY = 'vc_scanner_access_point_id';
const MOVEMENT_MODE_STORAGE_KEY = 'vc_scanner_movement_mode';
/** Tiempo visible del resultado PERMITIDO antes de desvanecer (ms). */
const PERMITIDO_RESULT_FADE_MS = 4500;
/** Pulso en borde del input tras registrar (ms). */
const INPUT_PULSE_MS = 300;
/** Últimos accesos visibles en garita para incidencia tardía. */
const RECENT_HISTORY_LIMIT = 10;
/** Cámara QR oculta de forma temporal: la garita usa DNI/placa. Poner en true para reactivar. */
const CAMERA_SCANNER_ENABLED = false;

type MovementMode = 'INGRESO' | 'EGRESO';

interface AccessPointOption {
  id: number;
  name: string;
}

interface DetailHouseOption {
  house_id: number;
  block_house: string;
  lot: string;
  apartment: string | null;
}

interface PendingDetailPhoto {
  id: number;
  file: File;
  preview: string;
}

type ScannerRecentRow = Record<string, unknown>;

type ResultTone = 'ok' | 'warn' | 'deny' | 'info' | 'error';

const RECENT_STATUS_LABELS = ['PERMITIDO', 'DENEGADO', 'RESTRINGIDO', 'OBSERVADO'] as const;

function parseRecentRowStatus(row: ScannerRecentRow): string {
  const observation = String(row['observation_raw'] ?? row['obs'] ?? '').toUpperCase();
  const found = RECENT_STATUS_LABELS.find((s) => new RegExp(`(^|\\|)\\s*${s}\\b`).test(observation));
  if (found) {
    return found;
  }
  const obs = String(row['obs'] ?? '').trim();
  return obs && obs !== '—' ? obs.split('|')[0]?.trim() || '—' : '—';
}

@Component({
  selector: 'app-qr-scanner',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MatIconModule, PhotoSourcePickerComponent],
  template: `
    <div class="w-full px-0 py-2 sm:py-3">
      <div
        class="overflow-hidden rounded-xl border-2 border-dashed border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800"
        [class.border-amber-400]="movementMode === 'EGRESO'"
        [class.bg-amber-50]="movementMode === 'EGRESO'"
        [class.scanner-exit-mode]="movementMode === 'EGRESO'">
        <div class="border-b border-gray-200 px-4 py-4 text-center dark:border-gray-700">
          <h2 class="m-0 flex items-center justify-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
            <mat-icon class="!h-7 !w-7 text-teal-600 dark:text-teal-400">qr_code_scanner</mat-icon>
            Escáner / QR
          </h2>
        </div>
        <div class="p-4">
          <p
            *ngIf="cameraScannerEnabled && scanEngineHint"
            class="mb-3 rounded-lg border border-indigo-100 bg-indigo-50 p-2 text-xs text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-200">
            {{ scanEngineHint }}
          </p>

          <div
            class="scanner-controls mb-3"
            [class.scanner-controls--solo]="!accessPoints.length">
            <div class="scanner-controls__point" *ngIf="accessPoints.length">
              <label class="scanner-controls__label" for="scanner-access-point">Punto de acceso</label>
              <select
                id="scanner-access-point"
                [(ngModel)]="selectedAccessPointId"
                (ngModelChange)="onAccessPointChange($event)"
                [disabled]="loadingPoints"
                class="scanner-controls__select">
                <option [ngValue]="null">— Seleccione —</option>
                <option *ngFor="let p of accessPoints; trackBy: trackAccessPoint" [ngValue]="p.id">{{ p.name }}</option>
              </select>
            </div>
            <div class="scanner-controls__movement">
              <span class="scanner-controls__label" id="scanner-movement-label">Movimiento</span>
              <div
                class="movement-toggle"
                role="group"
                aria-labelledby="scanner-movement-label">
                <button
                  type="button"
                  class="movement-toggle__btn"
                  [class.movement-toggle__btn--active-in]="movementMode === 'INGRESO'"
                  [attr.aria-pressed]="movementMode === 'INGRESO'"
                  (click)="setMovementMode('INGRESO')">
                  <mat-icon class="movement-toggle__icon" aria-hidden="true">login</mat-icon>
                  <span class="movement-toggle__text">Entrada</span>
                </button>
                <button
                  type="button"
                  class="movement-toggle__btn"
                  [class.movement-toggle__btn--active-out]="movementMode === 'EGRESO'"
                  [attr.aria-pressed]="movementMode === 'EGRESO'"
                  (click)="setMovementMode('EGRESO')">
                  <mat-icon class="movement-toggle__icon" aria-hidden="true">logout</mat-icon>
                  <span class="movement-toggle__text">Salida</span>
                </button>
              </div>
            </div>
          </div>

          <p
            *ngIf="selectedAccessPointName"
            class="mb-3 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-medium text-teal-900 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-100"
            role="status">
            Registrando en: <strong>{{ selectedAccessPointName }}</strong>
            · {{ movementLabel() }}
          </p>
          <p
            *ngIf="accessPoints.length && !selectedAccessPointId && !loadingPoints"
            class="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
            role="status">
            Seleccione el punto de acceso antes de registrar.
          </p>
          <p *ngIf="!accessPoints.length && !loadingPoints" class="mb-3 text-sm text-amber-700 dark:text-amber-400">
            No hay puntos de acceso configurados.
          </p>

          <div class="manual-input mt-1">
            <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              DNI, placa o doc. responsable
            </label>
            <div class="flex gap-2">
              <input
                #manualInput
                type="text"
                [(ngModel)]="manualCode"
                (keyup.enter)="submitManualCode()"
                placeholder="DNI, placa o documento"
                class="scan-input block min-w-0 flex-1 rounded-lg border border-gray-300 bg-gray-50 p-2.5 text-sm focus:border-teal-500 focus:ring-teal-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:focus:border-teal-500 dark:focus:ring-teal-500"
                [class.scan-input--pulse-ok]="inputPulseTone === 'ok'"
                [class.scan-input--pulse-warn]="inputPulseTone === 'warn'"
                [class.scan-input--pulse-deny]="inputPulseTone === 'deny'" />
              <button
                type="button"
                (click)="submitManualCode()"
                [disabled]="registrationInProgress || !manualCode.trim()"
                title="Registrar"
                class="inline-flex shrink-0 items-center justify-center rounded-lg border border-teal-800/30 !bg-teal-600 p-2.5 shadow-sm hover:!bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50 dark:!bg-teal-500 dark:hover:!bg-teal-600">
                <mat-icon *ngIf="!registrationInProgress" class="!text-white">send</mat-icon>
                <svg
                  *ngIf="registrationInProgress"
                  class="h-5 w-5 animate-spin text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  aria-hidden="true">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
              </button>
            </div>
          </div>

          <div
            *ngIf="resultHeadline"
            class="scan-result mt-3"
            [ngClass]="'scan-result--' + resultTone"
            role="status"
            aria-live="polite">
            <div class="scan-result__inner">
              <mat-icon class="scan-result__icon" aria-hidden="true">{{ resultIcon }}</mat-icon>
              <div class="scan-result__text min-w-0 flex-1">
                <p class="scan-result__headline">{{ resultHeadline }}</p>
                <p *ngIf="resultSubline" class="scan-result__subline">{{ resultSubline }}</p>
                <p *ngFor="let line of resultDetailLines" class="scan-result__detail">{{ line }}</p>
                <p *ngIf="resultTimestamp" class="scan-result__time">{{ resultTimestamp }}</p>
              </div>
              <img
                *ngIf="resultThumbUrl"
                [src]="resultThumbUrl"
                alt=""
                class="scan-result__thumb shrink-0 rounded-md object-cover" />
            </div>
          </div>

          <ng-container *ngIf="cameraScannerEnabled">
          <div
            class="scanner-viewport mt-4 w-full md:mx-auto md:max-w-[340px] lg:max-w-[380px]"
            #scannerViewport
            [class.dimmed]="registrationInProgress">
            <video #videoElement autoplay playsinline muted></video>
            <canvas #scanCanvas hidden></canvas>
            <div class="scan-frame" *ngIf="isScanning && !registrationInProgress" aria-hidden="true"></div>
            <div class="scan-overlay" *ngIf="isScanning && !registrationInProgress">
              <div class="scan-line"></div>
            </div>
          </div>

          <div class="mt-4 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              *ngIf="!isScanning"
              (click)="startScanning()"
              [disabled]="registrationInProgress || !selectedAccessPointId"
              class="inline-flex items-center gap-1 rounded-lg bg-gradient-to-r from-teal-400 via-teal-500 to-teal-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-teal-500/50 hover:bg-gradient-to-br focus:outline-none focus:ring-4 focus:ring-teal-300 disabled:cursor-not-allowed disabled:opacity-50 dark:shadow-teal-800/80 dark:focus:ring-teal-800">
              <mat-icon class="!h-5 !w-5">play_arrow</mat-icon>
              Iniciar escáner
            </button>

            <button
              type="button"
              *ngIf="isScanning"
              (click)="stopScanning()"
              class="inline-flex items-center gap-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white shadow hover:bg-red-700 focus:outline-none focus:ring-4 focus:ring-red-300 dark:focus:ring-red-900">
              <mat-icon class="!h-5 !w-5">stop</mat-icon>
              Detener
            </button>

            <button
              type="button"
              *ngIf="isScanning && hasFlash && !registrationInProgress"
              (click)="toggleFlash()"
              class="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700">
              <mat-icon class="!h-5 !w-5">{{ hasFlashOn ? 'flash_off' : 'flash_on' }}</mat-icon>
              {{ hasFlashOn ? 'Apagar flash' : 'Flash' }}
            </button>
          </div>
          </ng-container>

          <div
            *ngIf="lastLogRef && incidentLogReady && !pendingHouseSelection"
            class="access-details mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
            [class.access-details--expanded]="detailsPanelOpen">
            <button
              type="button"
              class="access-details__toggle flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
              (click)="detailsPanelOpen = !detailsPanelOpen">
              <span class="text-sm font-semibold text-gray-900 dark:text-white">Detalles del acceso</span>
              <mat-icon class="!h-5 !w-5 text-gray-500">{{ detailsPanelOpen ? 'expand_less' : 'expand_more' }}</mat-icon>
            </button>
            <div *ngIf="detailsPanelOpen" class="access-details__body space-y-3 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
              <div>
                <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Nota del operario</label>
                <textarea
                  [(ngModel)]="operatorNotes"
                  rows="2"
                  maxlength="2000"
                  placeholder="Observaciones para auditoría…"
                  class="vc-field w-full resize-y text-sm"></textarea>
              </div>

              <div>
                <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                  Fotos del acceso (opcional, máx. {{ maxDetailPhotos }})
                </label>
                <div *ngIf="detailPhotos.length" class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <div
                    *ngFor="let ph of detailPhotos; let i = index"
                    class="relative overflow-hidden rounded-lg border border-gray-200 dark:border-gray-600">
                    <img [src]="ph.preview" [alt]="'Foto ' + (i + 1)" class="h-28 w-full object-cover" />
                    <button
                      type="button"
                      class="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
                      [disabled]="compressingDetailPhotos || savingDetails || authorizingEntry"
                      (click)="removeDetailPhoto(i)"
                      title="Quitar foto"
                      aria-label="Quitar foto">
                      <mat-icon class="!h-4 !w-4 !text-base">close</mat-icon>
                    </button>
                    <span class="absolute bottom-1 left-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">
                      {{ i + 1 }}/{{ detailPhotos.length }}
                    </span>
                  </div>
                </div>

                <app-photo-source-picker
                  *ngIf="canAddDetailPhoto"
                  [compact]="true"
                  [zoneTitle]="detailPhotos.length ? 'Añadir otra foto' : 'Añadir imagen'"
                  [cameraLabel]="detailPhotos.length ? 'Tomar otra' : 'Tomar foto'"
                  [compressing]="compressingDetailPhotos"
                  [disabled]="savingDetails || authorizingEntry"
                  (fileSelected)="onDetailPhotoSelected($event)"
                />
                <p *ngIf="detailPhotos.length >= maxDetailPhotos" class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Límite de {{ maxDetailPhotos }} fotos alcanzado.
                </p>
              </div>

              <div>
                <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Decisión del operario</label>
                <select [(ngModel)]="detailsOperatorDecision" class="scanner-controls__select w-full">
                  <option *ngFor="let opt of operatorDecisionOptions" [ngValue]="opt.value">{{ opt.label }}</option>
                </select>
              </div>

              <div class="space-y-2">
                <label class="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                  <input type="checkbox" [(ngModel)]="detailsNoHouse" (ngModelChange)="onDetailsNoHouseChange($event)" />
                  Sin domicilio / no aplica
                </label>
                <div *ngIf="!detailsNoHouse" class="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <div>
                    <label class="mb-1 block text-xs text-gray-600 dark:text-gray-400">Manzana</label>
                    <select [(ngModel)]="detailsBlock" class="scanner-controls__select w-full">
                      <option value="">—</option>
                      <option *ngFor="let b of detailBlocks" [value]="b">{{ b }}</option>
                    </select>
                  </div>
                  <div>
                    <label class="mb-1 block text-xs text-gray-600 dark:text-gray-400">Lote</label>
                    <select [(ngModel)]="detailsLot" class="scanner-controls__select w-full">
                      <option value="">—</option>
                      <option *ngFor="let l of detailLots" [value]="l">{{ l }}</option>
                    </select>
                  </div>
                  <div *ngIf="detailApartments.length">
                    <label class="mb-1 block text-xs text-gray-600 dark:text-gray-400">Dpto</label>
                    <select [(ngModel)]="detailsApartment" class="scanner-controls__select w-full">
                      <option value="">—</option>
                      <option *ngFor="let a of detailApartments" [value]="a">{{ a }}</option>
                    </select>
                  </div>
                </div>
              </div>

              <div class="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  (click)="saveAccessDetails()"
                  [disabled]="savingDetails || authorizingEntry || compressingDetailPhotos"
                  class="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50">
                  {{ savingDetails ? 'Guardando…' : 'Guardar detalles' }}
                </button>
                <button
                  *ngIf="showAuthorizeEntryButton"
                  type="button"
                  (click)="authorizeEntry()"
                  [disabled]="savingDetails || authorizingEntry"
                  class="inline-flex items-center gap-1 rounded-lg border border-emerald-600 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-100">
                  {{ authorizingEntry ? 'Registrando…' : 'Registrar ingreso autorizado' }}
                </button>
              </div>

              <div *ngIf="canAddIncident && lastIncidentContext" class="border-t border-gray-100 pt-2 dark:border-gray-700">
                <button
                  type="button"
                  (click)="openIncidentDialog()"
                  class="access-details__escalate inline-flex items-center gap-1 text-xs font-medium text-amber-800 hover:underline dark:text-amber-200">
                  <mat-icon class="!h-4 !w-4">report_problem</mat-icon>
                  Escalar problema
                </button>
              </div>
            </div>
            <div
              *ngIf="!detailsPanelOpen && canAddIncident && lastIncidentContext && showEscalateWhenCollapsed"
              class="border-t border-gray-100 px-4 py-2 dark:border-gray-700">
              <button
                type="button"
                (click)="openIncidentDialog()"
                class="access-details__escalate inline-flex items-center gap-1 text-xs font-medium text-amber-800 hover:underline dark:text-amber-200">
                <mat-icon class="!h-4 !w-4">report_problem</mat-icon>
                Escalar problema
              </button>
            </div>
          </div>

          <div
            *ngIf="pendingHouseSelection && pendingAssignments.length"
            class="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
            <p class="mb-3 text-sm font-medium text-amber-900 dark:text-amber-100">
              Varias casas autorizadas. Seleccione destino:
            </p>
            <div class="flex flex-col gap-2">
              <button
                type="button"
                *ngFor="let a of pendingAssignments"
                (click)="confirmAssignmentSelection(a)"
                class="rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm hover:bg-teal-50 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700">
                <span class="font-medium">{{ a.house_label || ('Casa #' + a.house_id) }}</span>
                <span class="block text-xs text-gray-500 dark:text-gray-400" *ngIf="a.valid_until">
                  Vigente hasta {{ a.valid_until }}
                </span>
              </button>
            </div>
          </div>

          <div
            *ngIf="errorMessage"
            class="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            <mat-icon class="shrink-0 text-red-600">error</mat-icon>
            <span>{{ errorMessage }}</span>
          </div>
        </div>
      </div>

      <div
        *ngIf="showRecentHistoryPanel"
        class="recent-history mt-4 overflow-hidden rounded-xl border-2 border-dashed border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div>
            <h3 class="m-0 text-sm font-semibold text-gray-900 dark:text-white">Últimos accesos de hoy</h3>
            <p class="m-0 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {{ selectedAccessPointName }} · hasta {{ recentHistoryLimit }} registros
            </p>
          </div>
          <a
            routerLink="/history"
            class="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline dark:text-teal-300">
            Historial completo
            <mat-icon class="!h-4 !w-4">open_in_new</mat-icon>
          </a>
        </div>
        <div class="p-3">
          <div *ngIf="loadingRecentHistory" class="py-4 text-center text-xs text-gray-500">Cargando…</div>
          <p *ngIf="!loadingRecentHistory && !recentHistoryRows.length" class="py-3 text-center text-xs text-gray-500 dark:text-gray-400">
            Sin registros hoy en este punto.
          </p>
          <ul *ngIf="!loadingRecentHistory && recentHistoryRows.length" class="recent-history__list m-0 list-none p-0">
            <li *ngFor="let row of recentHistoryRows; trackBy: trackRecentRow" class="recent-history__item">
              <div class="recent-history__main">
                <span class="recent-history__time">{{ recentRowTime(row) }}</span>
                <span class="recent-history__name">{{ recentRowLabel(row) }}</span>
                <span class="recent-history__meta">{{ recentRowMeta(row) }}</span>
                <span *ngIf="recentRowDecision(row) as dec" class="recent-history__decision">{{ dec }}</span>
              </div>
              <div class="recent-history__actions">
                <span
                  *ngIf="canViewIncidents && recentRowIncidentCount(row) > 0"
                  class="recent-history__inc-badge"
                  [title]="recentRowIncidentCount(row) + ' incidencia(s)'">
                  <mat-icon class="!h-3.5 !w-3.5">report_problem</mat-icon>
                  {{ recentRowIncidentCount(row) }}
                </span>
                <button
                  *ngIf="canAddIncident"
                  type="button"
                  class="recent-history__report-btn"
                  (click)="openIncidentDialogForRow(row)">
                  <mat-icon class="!h-4 !w-4">add_alert</mat-icon>
                  Reportar
                </button>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .scanner-viewport {
        position: relative;
        width: 100%;
        aspect-ratio: 4/3;
        background: #000;
        border-radius: 8px;
        overflow: hidden;
      }
      .scanner-viewport.dimmed {
        opacity: 0.45;
        pointer-events: none;
      }
      video {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .scan-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .scan-line {
        width: 80%;
        height: 2px;
        background: #4caf50;
        box-shadow: 0 0 10px #4caf50;
        animation: scan 2s linear infinite;
      }
      @keyframes scan {
        0% {
          transform: translateY(-100px);
        }
        100% {
          transform: translateY(100px);
        }
      }
      .scan-frame {
        position: absolute;
        inset: 12% 10%;
        border: 2px solid rgba(76, 175, 80, 0.85);
        border-radius: 12px;
        box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.35);
        pointer-events: none;
        z-index: 2;
      }
      @media (prefers-color-scheme: dark) {
        .scanner-exit-mode {
          background-color: rgb(69 26 3 / 0.35) !important;
        }
      }
      .movement-toggle {
        display: inline-flex;
        gap: 2px;
        padding: 3px;
        border-radius: 10px;
        border: 1px solid #d1d5db;
        background-color: #f3f4f6;
        box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.04);
      }
      .scanner-controls {
        display: flex;
        flex-direction: row;
        align-items: flex-end;
        gap: 0.625rem;
      }
      .scanner-controls--solo {
        justify-content: flex-end;
      }
      .scanner-controls__point {
        flex: 1 1 0;
        min-width: 0;
      }
      .scanner-controls__movement {
        flex: 0 0 auto;
      }
      .scanner-controls__label {
        display: block;
        margin-bottom: 0.25rem;
        font-size: 0.75rem;
        font-weight: 500;
        line-height: 1.25;
        color: #374151;
      }
      :host-context(.dark) .scanner-controls__label {
        color: #d1d5db;
      }
      .scanner-controls__select {
        display: block;
        width: 100%;
        min-width: 0;
        border-radius: 0.5rem;
        border: 1px solid #d1d5db;
        background-color: #f9fafb;
        padding: 0.5rem 0.625rem;
        font-size: 0.8125rem;
        line-height: 1.25;
        color: #111827;
      }
      .scanner-controls__select:focus {
        outline: none;
        border-color: #14b8a6;
        box-shadow: 0 0 0 2px rgba(20, 184, 166, 0.25);
      }
      .scanner-controls__select:disabled {
        opacity: 0.6;
      }
      :host-context(.dark) .scanner-controls__select {
        border-color: #4b5563;
        background-color: #374151;
        color: #ffffff;
      }
      :host-context(.dark) .movement-toggle {
        border-color: #4b5563;
        background-color: #1f2937;
        box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.2);
      }
      .movement-toggle__btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        min-width: 4.75rem;
        padding: 0.5rem 0.5rem;
        border: none;
        border-radius: 7px;
        background-color: transparent;
        color: #4b5563;
        font-size: 0.75rem;
        font-weight: 600;
        line-height: 1.25;
        cursor: pointer;
        transition:
          background-color 0.15s ease,
          color 0.15s ease,
          box-shadow 0.15s ease;
      }
      @media (min-width: 380px) {
        .movement-toggle__btn {
          gap: 6px;
          min-width: 5.75rem;
          padding: 0.5rem 0.75rem;
          font-size: 0.8125rem;
        }
      }
      @media (min-width: 480px) {
        .movement-toggle__btn {
          min-width: 6.75rem;
          padding: 0.5rem 0.875rem;
        }
      }
      :host-context(.dark) .movement-toggle__btn {
        color: #9ca3af;
      }
      .movement-toggle__btn:hover:not(.movement-toggle__btn--active-in):not(.movement-toggle__btn--active-out) {
        background-color: rgba(0, 0, 0, 0.05);
        color: #374151;
      }
      :host-context(.dark)
        .movement-toggle__btn:hover:not(.movement-toggle__btn--active-in):not(.movement-toggle__btn--active-out) {
        background-color: rgba(255, 255, 255, 0.06);
        color: #e5e7eb;
      }
      .movement-toggle__btn--active-in {
        background-color: #0d9488;
        color: #ffffff;
        box-shadow: 0 1px 3px rgba(13, 148, 136, 0.35);
      }
      .movement-toggle__btn--active-out {
        background-color: #d97706;
        color: #ffffff;
        box-shadow: 0 1px 3px rgba(217, 119, 6, 0.35);
      }
      .movement-toggle__btn--active-in:hover,
      .movement-toggle__btn--active-out:hover {
        color: #ffffff;
      }
      .movement-toggle__icon {
        width: 1rem !important;
        height: 1rem !important;
        font-size: 1rem !important;
      }
      @media (min-width: 380px) {
        .movement-toggle__icon {
          width: 1.125rem !important;
          height: 1.125rem !important;
          font-size: 1.125rem !important;
        }
      }
      .movement-toggle__text {
        white-space: nowrap;
      }
      .recent-history__list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .recent-history__item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        border: 1px solid #e5e7eb;
        border-radius: 0.5rem;
        padding: 0.5rem 0.625rem;
        background: #f9fafb;
      }
      :host-context(.dark) .recent-history__item {
        border-color: #374151;
        background: rgba(17, 24, 39, 0.45);
      }
      .recent-history__main {
        min-width: 0;
        flex: 1;
      }
      .recent-history__time {
        display: block;
        font-size: 0.6875rem;
        font-weight: 600;
        color: #6b7280;
      }
      :host-context(.dark) .recent-history__time {
        color: #9ca3af;
      }
      .recent-history__name {
        display: block;
        font-size: 0.8125rem;
        font-weight: 600;
        color: #111827;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      :host-context(.dark) .recent-history__name {
        color: #f3f4f6;
      }
      .recent-history__meta {
        display: block;
        font-size: 0.6875rem;
        color: #6b7280;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      :host-context(.dark) .recent-history__meta {
        color: #9ca3af;
      }
      .recent-history__actions {
        display: flex;
        flex-shrink: 0;
        align-items: center;
        gap: 0.375rem;
      }
      .recent-history__inc-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.125rem;
        border-radius: 9999px;
        background: #fef3c7;
        padding: 0.125rem 0.375rem;
        font-size: 0.625rem;
        font-weight: 600;
        color: #92400e;
      }
      :host-context(.dark) .recent-history__inc-badge {
        background: rgba(120, 53, 15, 0.35);
        color: #fcd34d;
      }
      .recent-history__report-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        border: 1px solid #fcd34d;
        border-radius: 0.375rem;
        background: #fffbeb;
        padding: 0.25rem 0.5rem;
        font-size: 0.6875rem;
        font-weight: 600;
        color: #92400e;
        cursor: pointer;
      }
      .recent-history__report-btn:hover {
        background: #fef3c7;
      }
      :host-context(.dark) .recent-history__report-btn {
        border-color: #78350f;
        background: rgba(120, 53, 15, 0.25);
        color: #fde68a;
      }
      .access-details__toggle {
        background: transparent;
        border: none;
        cursor: pointer;
      }
      .access-details--expanded {
        border-color: #fcd34d;
      }
      .access-details__escalate {
        background: none;
        border: none;
        cursor: pointer;
        padding: 0;
      }
      .recent-history__decision {
        display: block;
        font-size: 0.625rem;
        color: #0f766e;
        margin-top: 0.125rem;
      }
      :host-context(.dark) .recent-history__decision {
        color: #5eead4;
      }
      .scan-result {
        border-radius: 0.625rem;
        border-width: 2px;
        border-style: solid;
        padding: 0.75rem 0.875rem;
        transition: opacity 0.4s ease;
      }
      .scan-result--ok {
        border-color: #6ee7b7;
        background: #ecfdf5;
        color: #065f46;
      }
      .scan-result--warn {
        border-color: #fcd34d;
        background: #fffbeb;
        color: #92400e;
      }
      .scan-result--deny {
        border-color: #fca5a5;
        background: #fef2f2;
        color: #991b1b;
      }
      .scan-result--info {
        border-color: #93c5fd;
        background: #eff6ff;
        color: #1e40af;
      }
      .scan-result--error {
        border-color: #fca5a5;
        background: #fef2f2;
        color: #991b1b;
      }
      :host-context(.dark) .scan-result--ok {
        border-color: #047857;
        background: rgba(6, 78, 59, 0.35);
        color: #a7f3d0;
      }
      :host-context(.dark) .scan-result--warn {
        border-color: #b45309;
        background: rgba(120, 53, 15, 0.35);
        color: #fde68a;
      }
      :host-context(.dark) .scan-result--deny,
      :host-context(.dark) .scan-result--error {
        border-color: #991b1b;
        background: rgba(127, 29, 29, 0.35);
        color: #fecaca;
      }
      :host-context(.dark) .scan-result--info {
        border-color: #1d4ed8;
        background: rgba(30, 58, 138, 0.35);
        color: #bfdbfe;
      }
      .scan-result__inner {
        display: flex;
        align-items: flex-start;
        gap: 0.625rem;
      }
      .scan-result__icon {
        font-size: 1.75rem !important;
        width: 1.75rem !important;
        height: 1.75rem !important;
        flex-shrink: 0;
        margin-top: 0.0625rem;
      }
      .scan-result__headline {
        margin: 0;
        font-size: 0.9375rem;
        font-weight: 700;
        line-height: 1.3;
      }
      .scan-result__subline {
        margin: 0.25rem 0 0;
        font-size: 0.875rem;
        font-weight: 500;
        line-height: 1.35;
      }
      .scan-result__detail {
        margin: 0.125rem 0 0;
        font-size: 0.75rem;
        line-height: 1.35;
        opacity: 0.92;
      }
      .scan-result__time {
        margin: 0.375rem 0 0;
        font-size: 0.6875rem;
        opacity: 0.75;
      }
      .scan-result__thumb {
        width: 2.75rem;
        height: 2.75rem;
      }
      .scan-input {
        transition: box-shadow 0.15s ease, border-color 0.15s ease;
      }
      .scan-input--pulse-ok {
        animation: scan-input-pulse-ok 0.3s ease;
      }
      .scan-input--pulse-warn {
        animation: scan-input-pulse-warn 0.3s ease;
      }
      .scan-input--pulse-deny {
        animation: scan-input-pulse-deny 0.3s ease;
      }
      @keyframes scan-input-pulse-ok {
        0%, 100% { box-shadow: 0 0 0 0 transparent; border-color: #d1d5db; }
        50% { box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.35); border-color: #10b981; }
      }
      @keyframes scan-input-pulse-warn {
        0%, 100% { box-shadow: 0 0 0 0 transparent; border-color: #d1d5db; }
        50% { box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.35); border-color: #f59e0b; }
      }
      @keyframes scan-input-pulse-deny {
        0%, 100% { box-shadow: 0 0 0 0 transparent; border-color: #d1d5db; }
        50% { box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.35); border-color: #ef4444; }
      }
    `,
  ],
})
export class QrScannerComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('manualInput') manualInput?: ElementRef<HTMLInputElement>;
  @ViewChild('videoElement') videoElement?: ElementRef<HTMLVideoElement>;
  @ViewChild('scannerViewport') scannerViewport?: ElementRef;
  @Output() codeScanned = new EventEmitter<string>();

  isScanning = false;
  hasFlash = false;
  hasFlashOn = false;
  scannedResult: string | null = null;
  errorMessage: string | null = null;
  manualCode = '';

  /** Texto informativo: BarcodeDetector vs ZXing. */
  scanEngineHint = '';

  accessPoints: AccessPointOption[] = [];
  selectedAccessPointId: number | null = null;
  movementMode: MovementMode = 'INGRESO';
  loadingPoints = true;
  /** Notas opcionales del operario (se guardan en operator_notes, no en observation). */
  operatorNotes = '';

  lastLogRef: number | null = null;
  lastScanStatus = '';
  detailsPanelOpen = false;
  detailsOperatorDecision: OperatorDecision | '' = '';
  detailsNoHouse = false;
  detailsBlock = '';
  detailsLot = '';
  detailsApartment = '';
  detailHouses: DetailHouseOption[] = [];
  readonly maxDetailPhotos = 5;
  detailPhotos: PendingDetailPhoto[] = [];
  compressingDetailPhotos = false;
  private detailPhotoPickSeq = 0;
  private nextDetailPhotoId = 1;
  savingDetails = false;
  authorizingEntry = false;
  readonly operatorDecisionOptions = OPERATOR_DECISION_OPTIONS;

  registrationInProgress = false;
  resultTone: ResultTone = 'info';
  resultHeadline: string | null = null;
  resultSubline: string | null = null;
  resultDetailLines: string[] = [];
  resultTimestamp: string | null = null;
  resultThumbUrl: string | null = null;
  inputPulseTone: ResultTone | null = null;

  pendingHouseSelection = false;
  pendingAssignments: ExternalVisitAssignmentOption[] = [];
  pendingTempVisitId: number | null = null;

  incidentLogReady = false;
  lastIncidentContext: IncidentScanContext | null = null;
  readonly cameraScannerEnabled = CAMERA_SCANNER_ENABLED;
  readonly recentHistoryLimit = RECENT_HISTORY_LIMIT;

  recentHistoryRows: ScannerRecentRow[] = [];
  loadingRecentHistory = false;

  private useNativeBarcode = false;
  private mediaStream: MediaStream | null = null;
  private animationFrameId: number | null = null;
  private barcodeDetector: any = null;
  private zxingReader: BrowserMultiFormatReader | null = null;
  private zxingControls: IScannerControls | null = null;
  private destroy$ = new Subject<void>();
  private resultFadeTimer: ReturnType<typeof setTimeout> | null = null;
  private inputPulseTimer: ReturnType<typeof setTimeout> | null = null;
  /** Evita detectar en cada frame (RAM alta en Android). */
  private lastDetectAt = 0;
  private readonly detectIntervalMs = 200;
  /** Tras un escaneo, mantener cámara y reanudar sin pulsar «Iniciar». */
  private continuousScan = false;
  private detectionPaused = false;
  private readonly onVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden' && this.isScanning) {
      this.stopScanning();
    }
  };

  /** Resolución baja: suficiente para QR y evita OOM en móviles. */
  private readonly cameraConstraints: MediaTrackConstraints = {
    facingMode: { ideal: 'environment' },
    width: { ideal: 640, max: 1280 },
    height: { ideal: 480, max: 720 },
    frameRate: { ideal: 15, max: 24 },
  };

  constructor(
    private toastr: ToastrService,
    private api: ApiService,
    private qrAccess: QrAccessService,
    private accessLogService: AccessLogService,
    private navPerm: NavPermissionService,
    private dialog: MatDialog
  ) {}

  get resultIcon(): string {
    switch (this.resultTone) {
      case 'ok':
        return 'check_circle';
      case 'deny':
        return 'block';
      case 'warn':
        return 'warning';
      case 'error':
        return 'error';
      default:
        return 'info';
    }
  }

  get showEscalateWhenCollapsed(): boolean {
    return !isAttentionScanStatus(this.lastScanStatus);
  }

  get showAuthorizeEntryButton(): boolean {
    return (
      isAttentionScanStatus(this.lastScanStatus) &&
      this.detailsOperatorDecision === 'AUTORIZADO_POR_PROPIETARIO' &&
      this.isExitMode() === false
    );
  }

  get detailBlocks(): string[] {
    return [...new Set(this.detailHouses.map((h) => h.block_house).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, 'es')
    );
  }

  get detailLots(): string[] {
    if (!this.detailsBlock) {
      return [];
    }
    return this.detailHouses
      .filter((h) => h.block_house === this.detailsBlock)
      .map((h) => h.lot)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  }

  get detailApartments(): string[] {
    if (!this.detailsBlock || !this.detailsLot) {
      return [];
    }
    return this.detailHouses
      .filter((h) => h.block_house === this.detailsBlock && h.lot === this.detailsLot && h.apartment)
      .map((h) => h.apartment as string)
      .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  }

  get canAddIncident(): boolean {
    return this.navPerm.canManage('incidents');
  }

  get canViewIncidents(): boolean {
    return this.navPerm.canView('incidents');
  }

  get showRecentHistoryPanel(): boolean {
    return this.selectedAccessPointId != null && this.selectedAccessPointId > 0;
  }

  get selectedAccessPointName(): string | null {
    if (this.selectedAccessPointId == null) {
      return null;
    }
    const found = this.accessPoints.find((p) => p.id === this.selectedAccessPointId);
    return found?.name ?? null;
  }

  trackAccessPoint(_index: number, p: AccessPointOption): number {
    return p.id;
  }

  ngOnInit(): void {
    if (this.cameraScannerEnabled) {
      this.checkBarcodeSupport();
    }
    this.loadMovementMode();
    this.loadAccessPoints();
    this.loadDetailHouses();
    this.navPerm.load().subscribe();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  ngAfterViewInit(): void {
    this.focusManualInput();
  }

  private focusManualInput(): void {
    setTimeout(() => this.manualInput?.nativeElement?.focus(), 0);
  }

  setMovementMode(mode: MovementMode): void {
    this.movementMode = mode;
    localStorage.setItem(MOVEMENT_MODE_STORAGE_KEY, mode);
  }

  private loadMovementMode(): void {
    const saved = localStorage.getItem(MOVEMENT_MODE_STORAGE_KEY);
    if (saved === 'INGRESO' || saved === 'EGRESO') {
      this.movementMode = saved;
    }
  }

  private isExitMode(): boolean {
    return this.movementMode === 'EGRESO';
  }

  /** Visible en la nota de “Registrando en…”. */
  movementLabel(): string {
    return this.isExitMode() ? 'Salida' : 'Entrada';
  }

  ngOnDestroy(): void {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
    this.stopScanning();
    this.clearResultFadeTimer();
    this.clearInputPulseTimer();
    this.clearAllDetailPhotos();
    this.destroy$.next();
    this.destroy$.complete();
  }

  get canAddDetailPhoto(): boolean {
    return this.detailPhotos.length < this.maxDetailPhotos;
  }

  onAccessPointChange(id: number | null): void {
    this.persistAccessPointId(id);
    this.refreshRecentHistory();
  }

  private persistAccessPointId(id: number | null): void {
    if (id != null && !isNaN(Number(id)) && Number(id) > 0) {
      const value = String(Number(id));
      localStorage.setItem(ACCESS_POINT_STORAGE_KEY, value);
      // Limpia la clave antigua en sessionStorage si existía.
      sessionStorage.removeItem(ACCESS_POINT_STORAGE_KEY);
    } else {
      localStorage.removeItem(ACCESS_POINT_STORAGE_KEY);
      sessionStorage.removeItem(ACCESS_POINT_STORAGE_KEY);
    }
  }

  /** localStorage primero; migra valor viejo de sessionStorage si hace falta. */
  private readSavedAccessPointId(): number | null {
    const fromLocal = localStorage.getItem(ACCESS_POINT_STORAGE_KEY);
    const fromSession = sessionStorage.getItem(ACCESS_POINT_STORAGE_KEY);
    const raw = fromLocal || fromSession;
    if (!raw) {
      return null;
    }
    const id = parseInt(raw, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return null;
    }
    if (!fromLocal && fromSession) {
      localStorage.setItem(ACCESS_POINT_STORAGE_KEY, String(id));
      sessionStorage.removeItem(ACCESS_POINT_STORAGE_KEY);
    }
    return id;
  }

  private loadAccessPoints(): void {
    this.loadingPoints = true;
    this.api
      .get<AccessPointOption[]>('api/v1/access-logs/access-points')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.loadingPoints = false;
          const rows = (res.data ?? []) as AccessPointOption[];
          this.accessPoints = rows
            .filter((r: any) => Number(r?.is_active ?? 1) === 1)
            .map((r: any) => ({
              id: Number(r.id),
              name: String(r.name ?? 'Punto'),
            }));
          const savedId = this.readSavedAccessPointId();
          if (savedId != null && this.accessPoints.some((p) => p.id === savedId)) {
            this.selectedAccessPointId = savedId;
            this.persistAccessPointId(savedId);
          } else if (this.accessPoints.length === 1) {
            this.selectedAccessPointId = this.accessPoints[0].id;
            this.persistAccessPointId(this.selectedAccessPointId);
          } else {
            this.selectedAccessPointId = null;
          }
          this.refreshRecentHistory();
        },
        error: () => {
          this.loadingPoints = false;
          this.toastr.error('No se pudieron cargar los puntos de acceso');
        },
      });
  }

  private checkBarcodeSupport(): void {
    this.useNativeBarcode = typeof window !== 'undefined' && 'BarcodeDetector' in window;
    if (this.useNativeBarcode) {
      void this.initBarcodeDetector();
      this.scanEngineHint =
        'Lector nativo del navegador.';
    } else {
      this.scanEngineHint =
        'Lector ZXing (compatible con Chrome y otros navegadores).';
    }
  }

  private async initBarcodeDetector(): Promise<void> {
    try {
      this.barcodeDetector = new (window as any).BarcodeDetector({
        formats: ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39'],
      });
    } catch (e) {
      console.warn('BarcodeDetector init failed:', e);
      this.barcodeDetector = null;
      this.useNativeBarcode = false;
      this.scanEngineHint =
        'Lector ZXing (compatible con Chrome y otros navegadores). También puede usar la entrada manual.';
    }
  }

  async startScanning(): Promise<void> {
    if (!this.cameraScannerEnabled || this.registrationInProgress) {
      return;
    }
    if (!this.selectedAccessPointId) {
      this.toastr.warning('Seleccione un punto de acceso');
      return;
    }
    this.errorMessage = null;
    this.scannedResult = null;

    const videoEl = this.videoElement?.nativeElement;
    if (!videoEl) {
      return;
    }
    const useNative = this.useNativeBarcode && this.barcodeDetector;

    try {
      if (useNative) {
        this.mediaStream = await this.openCameraStream();
        videoEl.srcObject = this.mediaStream;
        this.isScanning = true;
        this.continuousScan = true;
        this.detectionPaused = false;
        this.lastDetectAt = 0;
        const track = this.mediaStream.getVideoTracks()[0];
        const capabilities = track.getCapabilities() as any;
        this.hasFlash = !!capabilities?.torch;
        void this.detectBarcode();
      } else {
        this.isScanning = true;
        this.continuousScan = true;
        this.detectionPaused = false;
        this.hasFlash = false;
        await this.startZxingScan(videoEl);
      }
    } catch (error: any) {
      console.error('Error starting scanner:', error);
      this.errorMessage = this.cameraErrorMessage(error);
      this.toastr.error(this.errorMessage);
      this.isScanning = false;
      this.continuousScan = false;
      this.detectionPaused = false;
      this.stopZxing();
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach((t) => t.stop());
        this.mediaStream = null;
      }
    }
  }

  /** Abre la cámara con resolución limitada; reintenta sin constraints si el dispositivo no las soporta. */
  private async openCameraStream(): Promise<MediaStream> {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: this.cameraConstraints,
      });
    } catch (first: any) {
      if (first?.name === 'OverconstrainedError' || first?.name === 'ConstraintNotSatisfiedError') {
        return navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' } },
        });
      }
      throw first;
    }
  }

  private cameraErrorMessage(error: unknown): string {
    const err = error as { name?: string; message?: string } | null;
    const rawMsg = String(err?.message || '');
    const msg = rawMsg.toLowerCase();
    const name = String(err?.name || '');
    if (
      msg.includes('memoria') ||
      msg.includes('memory') ||
      msg.includes('out of memory') ||
      (name === 'AbortError' && (msg.includes('memoria') || msg.includes('memory')))
    ) {
      return 'Memoria insuficiente en el dispositivo para abrir la cámara. Cierre otras apps, reinicie el navegador e intente de nuevo, o use la entrada manual.';
    }
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return 'Permiso de cámara denegado. Habilítelo en el navegador o use la entrada manual.';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return 'La cámara está ocupada por otra app. Ciérrela e intente de nuevo, o use la entrada manual.';
    }
    // Android a veces muestra este texto del sistema sin un name estándar.
    if (rawMsg.includes('Memoria insuficiente') || rawMsg.includes('operación anterior')) {
      return 'Memoria insuficiente en el dispositivo para abrir la cámara. Cierre otras apps, reinicie el navegador e intente de nuevo, o use la entrada manual.';
    }
    return 'No se pudo acceder a la cámara. Verifique los permisos o use entrada manual.';
  }

  private async startZxingScan(videoEl: HTMLVideoElement): Promise<void> {
    this.stopZxing();
    const reader = new BrowserMultiFormatReader();
    this.zxingReader = reader;
    try {
      const decodeCb = (result: { getText(): string } | undefined): void => {
        if (this.registrationInProgress || this.detectionPaused) {
          return;
        }
        const text = result?.getText();
        if (text) {
          this.onCodeDetected(text);
        }
      };
      let controls: IScannerControls;
      if (typeof (reader as any).decodeFromConstraints === 'function') {
        controls = await (reader as any).decodeFromConstraints(
          { audio: false, video: this.cameraConstraints },
          videoEl,
          decodeCb
        );
      } else {
        this.mediaStream = await this.openCameraStream();
        controls = await (reader as any).decodeFromStream(this.mediaStream, videoEl, decodeCb);
      }
      this.zxingControls = controls;
      const stream = (videoEl.srcObject as MediaStream | null) ?? this.mediaStream;
      if (stream && BrowserCodeReader.mediaStreamIsTorchCompatible(stream)) {
        this.hasFlash = true;
      }
    } catch (e) {
      console.error('ZXing scan failed:', e);
      this.isScanning = false;
      this.continuousScan = false;
      this.detectionPaused = false;
      this.errorMessage = this.cameraErrorMessage(e);
      this.toastr.error(this.errorMessage);
    }
  }

  private stopZxing(): void {
    if (this.zxingControls) {
      try {
        this.zxingControls.stop();
      } catch {
        /* ignore */
      }
      this.zxingControls = null;
    }
    this.zxingReader = null;
    const v = this.videoElement?.nativeElement;
    if (v?.srcObject) {
      const ms = v.srcObject as MediaStream;
      ms.getTracks().forEach((t) => t.stop());
      v.srcObject = null;
    }
  }

  stopScanning(): void {
    this.continuousScan = false;
    this.detectionPaused = false;
    this.stopZxing();
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    const v = this.videoElement?.nativeElement;
    if (v) {
      v.srcObject = null;
    }
    this.isScanning = false;
    this.hasFlashOn = false;
  }

  /** Pausa la detección sin soltar la cámara (más rápido entre lecturas). */
  private pauseDetection(): void {
    this.detectionPaused = true;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private resumeDetection(): void {
    if (!this.continuousScan || this.registrationInProgress) {
      return;
    }
    this.detectionPaused = false;
    this.lastDetectAt = 0;
    const useNative = this.useNativeBarcode && this.barcodeDetector && this.mediaStream;
    if (useNative) {
      this.isScanning = true;
      void this.detectBarcode();
      return;
    }
    if (this.zxingControls || this.zxingReader) {
      this.isScanning = true;
      return;
    }
    // Stream perdido: reabrir cámara.
    void this.startScanning();
  }

  private async detectBarcode(): Promise<void> {
    if (!this.isScanning || this.detectionPaused || this.registrationInProgress || !this.videoElement?.nativeElement) {
      return;
    }

    const now = performance.now();
    if (now - this.lastDetectAt >= this.detectIntervalMs) {
      this.lastDetectAt = now;
      try {
        if (this.barcodeDetector) {
          const barcodes = await this.barcodeDetector.detect(this.videoElement.nativeElement);
          if (barcodes.length > 0) {
            const result = barcodes[0].rawValue;
            this.onCodeDetected(result);
            return;
          }
        }
      } catch (error) {
        console.warn('Barcode detection error:', error);
        const msg = String((error as any)?.message || '').toLowerCase();
        if (msg.includes('memoria') || msg.includes('memory')) {
          this.stopScanning();
          this.errorMessage = this.cameraErrorMessage(error);
          this.toastr.error(this.errorMessage);
          return;
        }
      }
    }

    this.animationFrameId = requestAnimationFrame(() => this.detectBarcode());
  }

  private onCodeDetected(code: string): void {
    if (this.registrationInProgress || this.detectionPaused) {
      return;
    }
    this.scannedResult = code;
    this.codeScanned.emit(code);
    this.pauseDetection();
    this.processInput(code);
  }

  submitManualCode(): void {
    const t = this.manualCode.trim();
    if (!t || this.registrationInProgress) {
      return;
    }
    const plate = parsePeruvianLicensePlate(t);
    if (plate.valid) {
      this.manualCode = '';
      this.processInput(plate.canonical, 'PLATE');
      return;
    }
    const documentType = inferIdentityDocumentType(t);
    if (documentType) {
      this.manualCode = '';
      this.processInput(normalizeIdentityDocument(documentType, t), 'DOCUMENT', documentType);
      return;
    }
    this.toastr.warning('Entrada inválida. Use placa peruana, DNI o CE.');
  }

  private processInput(
    raw: string,
    inputKind?: 'PLATE' | 'DOCUMENT',
    documentType?: IdentityDocumentType
  ): void {
    if (!this.selectedAccessPointId) {
      this.toastr.warning('Seleccione un punto de acceso');
      return;
    }
    if (this.registrationInProgress) {
      return;
    }

    // Evita lecturas duplicadas mientras responde la API.
    if (this.isScanning || this.continuousScan) {
      this.pauseDetection();
    }

    this.registrationInProgress = true;
    this.clearResultFadeTimer();
    this.errorMessage = null;
    this.pendingHouseSelection = false;
    this.pendingAssignments = [];
    this.pendingTempVisitId = null;
    this.incidentLogReady = false;
    this.lastIncidentContext = null;
    this.lastLogRef = null;
    this.lastScanStatus = '';
    this.detailsPanelOpen = false;
    this.resetAccessDetailsFields();

    this.qrAccess.scan(raw, inputKind, documentType).subscribe({
      next: (data) => this.handleScanResult(data),
      error: (err) => {
        const msg = err?.error?.error || err?.message || 'Error al procesar la lectura';
        this.errorMessage = msg;
        this.setResultDisplay('error', 'Error al procesar', msg, [], null);
        this.lastIncidentContext = {
          doc_number: inputKind === 'DOCUMENT' ? raw : null,
          license_plate: inputKind === 'PLATE' ? raw : null,
        };
        this.registrationInProgress = false;
        this.incidentLogReady = true;
        this.focusManualInput();
        this.toastr.error(msg);
      },
    });
  }

  confirmAssignmentSelection(assignment: ExternalVisitAssignmentOption): void {
    const tid = this.pendingTempVisitId;
    if (!tid || !assignment?.assignment_id) {
      return;
    }
    this.qrAccess.scanConfirm(tid, assignment.assignment_id).subscribe({
      next: (data) => {
        this.pendingHouseSelection = false;
        this.pendingAssignments = [];
        this.pendingTempVisitId = null;
        this.handleScanResult(data);
      },
      error: (err) => {
        const msg = err?.error?.error || err?.message || 'Error al confirmar casa';
        this.toastr.error(msg);
      },
    });
  }

  private handleScanResult(data: AccessQrScanResult): void {
    if (data.pending_house_selection && data.active_assignments?.length) {
      this.pendingHouseSelection = true;
      this.pendingAssignments = data.active_assignments;
      this.pendingTempVisitId = data.temp_visit_id ?? null;
      this.applyScanUi(data);
      this.registrationInProgress = false;
      this.incidentLogReady = true;
      this.focusManualInput();
      return;
    }

    this.pendingHouseSelection = false;
    this.pendingAssignments = [];
    this.pendingTempVisitId = null;
    this.applyScanUi(data);
    this.postAccessLog(data);
  }

  openIncidentDialog(): void {
    if (!this.incidentLogReady || !this.lastIncidentContext || !this.selectedAccessPointId) {
      return;
    }
    this.openIncidentDialogForContext(this.lastIncidentContext, this.selectedAccessPointId);
  }

  openIncidentDialogForRow(row: ScannerRecentRow): void {
    const accessPointId = Number(row['access_point_id'] ?? this.selectedAccessPointId ?? 0);
    if (!accessPointId || !this.canAddIncident) {
      return;
    }
    this.openIncidentDialogForContext(buildScanContextFromHistoryRow(row), accessPointId);
  }

  private openIncidentDialogForContext(scanContext: IncidentScanContext, accessPointId: number): void {
    const data: IncidentFormDialogData = {
      mode: 'scan',
      accessPointId,
      lockAccessPoint: true,
      scanContext,
    };
    this.dialog
      .open(IncidentFormDialogComponent, {
        width: 'min(480px, 96vw)',
        panelClass: INCIDENT_DIALOG_PANEL_CLASS,
        disableClose: true,
        data,
      })
      .afterClosed()
      .subscribe((saved) => {
        this.focusManualInput();
        if (saved) {
          this.refreshRecentHistory();
        }
      });
  }

  trackRecentRow(_index: number, row: ScannerRecentRow): number {
    return Number(row['id'] ?? _index);
  }

  recentRowTime(row: ScannerRecentRow): string {
    const raw = row['date_entry'] ?? row['created_at'];
    if (raw == null || raw === '') {
      return '—';
    }
    const d = raw instanceof Date ? raw : new Date(String(raw));
    if (Number.isNaN(d.getTime())) {
      return String(raw);
    }
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  recentRowLabel(row: ScannerRecentRow): string {
    const name = String(row['name'] ?? row['display_name_snapshot'] ?? '').trim();
    if (name && name !== '—') {
      return name;
    }
    const plate = String(row['license_plate_snapshot'] ?? row['vehicle_plate'] ?? '').trim();
    if (plate && plate !== '—') {
      return plate.toUpperCase();
    }
    const doc = String(row['doc_number'] ?? '').trim();
    return doc || 'Sin identificar';
  }

  recentRowMeta(row: ScannerRecentRow): string {
    const status = parseRecentRowStatus(row);
    const movement = String(row['movement_type'] ?? 'INGRESO').toUpperCase();
    const parts = [status !== '—' ? status : null, movement === 'EGRESO' ? 'Salida' : 'Entrada'];
    const doc = String(row['doc_number'] ?? '').trim();
    if (doc && doc !== '—') {
      parts.push(doc);
    }
    return parts.filter(Boolean).join(' · ');
  }

  recentRowIncidentCount(row: ScannerRecentRow): number {
    return Number(row['incident_count'] ?? 0) || 0;
  }

  recentRowDecision(row: ScannerRecentRow): string | null {
    const label = operatorDecisionLabel(String(row['operator_decision'] ?? ''));
    return label !== '—' ? label : null;
  }

  onDetailsNoHouseChange(checked: boolean): void {
    if (checked && !this.detailsOperatorDecision) {
      this.detailsOperatorDecision = 'SIN_DOMICILIO';
    }
    if (!checked && this.detailsOperatorDecision === 'SIN_DOMICILIO') {
      this.detailsOperatorDecision = '';
    }
  }

  onDetailPhotoSelected(file: File): void {
    void this.addDetailPhoto(file);
  }

  removeDetailPhoto(index: number): void {
    const [removed] = this.detailPhotos.splice(index, 1);
    if (removed?.preview) {
      URL.revokeObjectURL(removed.preview);
    }
  }

  private clearAllDetailPhotos(): void {
    this.detailPhotoPickSeq++;
    for (const ph of this.detailPhotos) {
      URL.revokeObjectURL(ph.preview);
    }
    this.detailPhotos = [];
  }

  private async addDetailPhoto(file: File): Promise<void> {
    if (!this.canAddDetailPhoto) {
      this.toastr.warning(`Máximo ${this.maxDetailPhotos} fotos.`);
      return;
    }

    const seq = ++this.detailPhotoPickSeq;
    this.compressingDetailPhotos = true;

    try {
      let ready = file;
      try {
        ready = await compressImageFile(file, MOBILE_PHOTO_COMPRESS);
      } catch {
        this.toastr.warning('No se pudo comprimir la foto; se usará el original.');
      }
      if (seq !== this.detailPhotoPickSeq) {
        return;
      }
      if (this.detailPhotos.length >= this.maxDetailPhotos) {
        return;
      }
      this.detailPhotos = [
        ...this.detailPhotos,
        {
          id: this.nextDetailPhotoId++,
          file: ready,
          preview: URL.createObjectURL(ready),
        },
      ];
    } finally {
      if (seq === this.detailPhotoPickSeq) {
        this.compressingDetailPhotos = false;
      }
    }
  }

  private resetAccessDetailsFields(): void {
    this.detailsOperatorDecision = '';
    this.detailsNoHouse = false;
    this.detailsBlock = '';
    this.detailsLot = '';
    this.detailsApartment = '';
    this.clearAllDetailPhotos();
  }

  private loadDetailHouses(): void {
    this.api
      .getRaw('api/v1/houses')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const list = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
          this.detailHouses = (list as any[])
            .map((h) => ({
              house_id: Number(h.house_id),
              block_house: String(h.block_house ?? '').trim(),
              lot: String(h.lot ?? '').trim(),
              apartment: h.apartment != null && String(h.apartment).trim() !== '' ? String(h.apartment).trim() : null,
            }))
            .filter((h) => h.house_id > 0 && h.block_house !== '');
        },
        error: () => {
          this.detailHouses = [];
        },
      });
  }

  private resolveDetailsHouseId(): number | null {
    if (this.detailsNoHouse || !this.detailsBlock || !this.detailsLot) {
      return null;
    }
    const matches = this.detailHouses.filter(
      (h) => h.block_house === this.detailsBlock && h.lot === this.detailsLot
    );
    if (!matches.length) {
      return null;
    }
    if (this.detailsApartment) {
      const byApt = matches.find((h) => h.apartment === this.detailsApartment);
      if (byApt) {
        return byApt.house_id;
      }
    }
    const noApt = matches.find((h) => !h.apartment);
    return (noApt ?? matches[0]).house_id;
  }

  private buildDetailsFormData(): FormData {
    const form = new FormData();
    const notes = this.operatorNotes.trim();
    form.append('operator_notes', notes);
    if (this.detailsOperatorDecision) {
      form.append('operator_decision', this.detailsOperatorDecision);
    } else {
      form.append('operator_decision', '');
    }
    if (this.detailsNoHouse) {
      form.append('house_id', '0');
    } else {
      const houseId = this.resolveDetailsHouseId();
      form.append('house_id', houseId != null ? String(houseId) : '0');
    }
    if (this.detailPhotos.length) {
      for (const ph of this.detailPhotos) {
        form.append('photos[]', ph.file, ph.file.name || 'access.jpg');
      }
    }
    return form;
  }

  saveAccessDetails(): void {
    if (!this.lastLogRef) {
      return;
    }
    this.savingDetails = true;
    this.accessLogService.patchAccessDetails(this.lastLogRef, this.buildDetailsFormData()).subscribe({
      next: () => {
        this.savingDetails = false;
        this.clearAllDetailPhotos();
        this.toastr.success('Detalles guardados');
        this.refreshRecentHistory();
      },
      error: (err) => {
        this.savingDetails = false;
        this.toastr.error(err?.error?.error || err?.message || 'No se pudieron guardar los detalles');
      },
    });
  }

  authorizeEntry(): void {
    if (!this.lastLogRef) {
      return;
    }
    if (this.detailsOperatorDecision !== 'AUTORIZADO_POR_PROPIETARIO') {
      this.toastr.warning('Seleccione «Autorizado por propietario»');
      return;
    }
    this.authorizingEntry = true;
    this.accessLogService.patchAccessDetails(this.lastLogRef, this.buildDetailsFormData()).subscribe({
      next: () => {
        const houseId = this.detailsNoHouse ? null : this.resolveDetailsHouseId();
        this.accessLogService.authorizeFromAttempt(this.lastLogRef as number, houseId).subscribe({
          next: (res) => {
            this.authorizingEntry = false;
            const newRef = Number(res?.data?.log_ref ?? 0) || 0;
            if (newRef !== 0) {
              this.lastLogRef = newRef;
              if (newRef > 0 && this.lastIncidentContext) {
                this.lastIncidentContext = { ...this.lastIncidentContext, access_log_id: newRef };
              } else if (newRef < 0 && this.lastIncidentContext) {
                this.lastIncidentContext = {
                  ...this.lastIncidentContext,
                  temp_access_log_id: Math.abs(newRef),
                };
              }
            }
            this.lastScanStatus = 'PERMITIDO';
            this.patchResultMessage('PERMITIDO — Ingreso autorizado por propietario');
            this.detailsPanelOpen = false;
            this.operatorNotes = '';
            this.resetAccessDetailsFields();
            this.toastr.success(res?.data?.message || 'Ingreso autorizado registrado');
            this.triggerInputPulse('ok');
            this.scheduleResultFade();
            this.refreshRecentHistory();
            this.focusManualInput();
          },
          error: (err) => {
            this.authorizingEntry = false;
            this.toastr.error(err?.error?.error || err?.message || 'No se pudo autorizar el ingreso');
          },
        });
      },
      error: (err) => {
        this.authorizingEntry = false;
        this.toastr.error(err?.error?.error || err?.message || 'Guarde los detalles antes de autorizar');
      },
    });
  }

  private applyLogRefFromScan(data: AccessQrScanResult, logRef: number): void {
    this.lastLogRef = logRef;
    this.lastScanStatus = data.status_validated;
    this.detailsPanelOpen = isAttentionScanStatus(data.status_validated);
    this.resetAccessDetailsFields();
    if (data.house_id) {
      const house = this.detailHouses.find((h) => h.house_id === data.house_id);
      if (house) {
        this.detailsBlock = house.block_house;
        this.detailsLot = house.lot;
        this.detailsApartment = house.apartment ?? '';
      }
    }
  }

  private refreshRecentHistory(): void {
    const apId = this.selectedAccessPointId;
    if (!apId || apId <= 0) {
      this.recentHistoryRows = [];
      this.loadingRecentHistory = false;
      return;
    }
    const today = todayYmdInAppTimeZone();
    this.loadingRecentHistory = true;
    this.accessLogService
      .getHistoryByRange(today, today, String(apId), {
        limit: RECENT_HISTORY_LIMIT,
        offset: 0,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (raw: unknown) => {
          this.recentHistoryRows = this.unwrapHistoryRows(raw);
          this.loadingRecentHistory = false;
        },
        error: () => {
          this.recentHistoryRows = [];
          this.loadingRecentHistory = false;
        },
      });
  }

  private unwrapHistoryRows(raw: unknown): ScannerRecentRow[] {
    if (Array.isArray(raw)) {
      return raw as ScannerRecentRow[];
    }
    if (raw && typeof raw === 'object' && 'data' in raw && Array.isArray((raw as { data: unknown }).data)) {
      return (raw as { data: ScannerRecentRow[] }).data;
    }
    return [];
  }

  private buildScanContext(data: AccessQrScanResult): IncidentScanContext {
    const personId = data.person_id ?? (data.person as any)?.id ?? null;
    const vehicleId =
      data.vehicle_id != null && Number(data.vehicle_id) > 0 ? Number(data.vehicle_id) : null;

    return {
      person_id: personId ? Number(personId) : null,
      vehicle_id: vehicleId,
      temp_visit_id: data.temp_visit_id ?? null,
      house_id: data.house_id ?? data.vehicle?.house_id ?? null,
      doc_number: data.doc_number ?? data.person?.doc_number ?? null,
      license_plate: data.license_plate ?? data.vehicle?.license_plate ?? null,
      status_validated: data.status_validated ?? null,
    };
  }

  private applyScanUi(data: AccessQrScanResult): void {
    const detailLines: string[] = [];
    let subline: string | null = null;
    let thumb: string | null = null;

    if (data.kind === 'person' && data.person) {
      const p = data.person;
      subline =
        [p.first_name, p.paternal_surname, p.maternal_surname].filter(Boolean).join(' ').trim() ||
        p.doc_number;
      detailLines.push(`DNI: ${p.doc_number}`);
      if (p.person_type) {
        detailLines.push(`Tipo: ${p.person_type}`);
      }
      this.appendHouseLine(data, detailLines, data.house_id ?? p.house_id);
      thumb = this.api.getPhotoUrl(p.photo_url ?? null);
    } else if (data.kind === 'vehicle' && data.vehicle) {
      const v = data.vehicle;
      subline = v.license_plate;
      detailLines.push(
        data.temp_visit_id ? `Visita externa · ${v.license_plate}` : `Vehículo · ${v.license_plate}`
      );
      if (v.brand || v.model) {
        detailLines.push([v.brand, v.model].filter(Boolean).join(' '));
      }
      if (data.doc_number) {
        detailLines.push(`Doc. responsable: ${data.doc_number}`);
      }
      this.appendHouseLine(data, detailLines, data.house_id ?? v.house_id);
      thumb = this.api.getPhotoUrl(v.photo_url ?? null);
    } else {
      subline = data.identity_display_name ?? data.doc_number ?? data.license_plate ?? null;
      if (data.message) {
        detailLines.push(data.message);
      } else {
        detailLines.push('Sin coincidencia en el registro');
      }
      if (data.doc_number) {
        detailLines.push(`Doc.: ${data.doc_number}`);
      }
      if (data.license_plate) {
        detailLines.push(`Placa: ${data.license_plate}`);
      }
    }

    this.appendExternalTimerLines(data, detailLines);

    const tone = this.resolveResultTone(data);
    const registeredLabel = `${this.movementLabel()} registrada`;
    let headline = data.pending_house_selection
      ? data.message || 'Seleccione casa destino'
      : `${data.status_validated || '—'}${
          this.isExitMode() && data.temp_visit_id
            ? ` — ${registeredLabel}`
            : data.allow_entry
              ? ` — ${registeredLabel}`
              : ' — Evento registrado'
        }`;
    if (data.is_birthday) {
      headline += ' — ¡Cumpleaños!';
    }

    this.lastScanStatus = data.status_validated || '';
    this.detailsPanelOpen =
      isAttentionScanStatus(this.lastScanStatus) ||
      (!data.allow_entry && !data.pending_house_selection);

    this.setResultDisplay(tone, headline, subline, detailLines, thumb);
  }

  private resolveResultTone(data: AccessQrScanResult): ResultTone {
    if (data.pending_house_selection) {
      return 'info';
    }
    const st = (data.status_validated || '').toUpperCase();
    if (st === 'DENEGADO' || !data.allow_entry) {
      return 'deny';
    }
    if (st === 'OBSERVADO' || st === 'RESTRINGIDO') {
      return 'warn';
    }
    return 'ok';
  }

  private setResultDisplay(
    tone: ResultTone,
    headline: string,
    subline: string | null,
    detailLines: string[],
    thumbUrl: string | null
  ): void {
    this.clearResultFadeTimer();
    this.resultTone = tone;
    this.resultHeadline = headline;
    this.resultSubline = subline;
    this.resultDetailLines = detailLines.filter(Boolean).slice(0, 3);
    this.resultThumbUrl = thumbUrl;
    this.resultTimestamp = this.formatResultTimestamp();
  }

  private patchResultMessage(headline: string, subline: string | null = null): void {
    this.clearResultFadeTimer();
    this.resultHeadline = headline;
    if (subline !== null) {
      this.resultSubline = subline;
    }
    this.resultTimestamp = this.formatResultTimestamp();
  }

  private formatResultTimestamp(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }

  private scheduleResultFade(): void {
    this.clearResultFadeTimer();
    if (isAttentionScanStatus(this.lastScanStatus)) {
      return;
    }
    this.resultFadeTimer = setTimeout(() => this.clearResultDisplay(), PERMITIDO_RESULT_FADE_MS);
  }

  private clearResultDisplay(): void {
    this.resultHeadline = null;
    this.resultSubline = null;
    this.resultDetailLines = [];
    this.resultTimestamp = null;
    this.resultThumbUrl = null;
  }

  private clearResultFadeTimer(): void {
    if (this.resultFadeTimer) {
      clearTimeout(this.resultFadeTimer);
      this.resultFadeTimer = null;
    }
  }

  private triggerInputPulse(tone: ResultTone): void {
    this.clearInputPulseTimer();
    if (tone === 'info' || tone === 'error') {
      return;
    }
    this.inputPulseTone = tone;
    this.inputPulseTimer = setTimeout(() => {
      this.inputPulseTone = null;
      this.inputPulseTimer = null;
    }, INPUT_PULSE_MS);
  }

  private clearInputPulseTimer(): void {
    if (this.inputPulseTimer) {
      clearTimeout(this.inputPulseTimer);
      this.inputPulseTimer = null;
    }
    this.inputPulseTone = null;
  }

  private appendHouseLine(data: AccessQrScanResult, lines: string[], houseId?: number | null): void {
    if (!data.allow_entry) {
      return;
    }
    const label =
      (data.house_label && data.house_label.trim()) ||
      this.resolveHouseLabelFromAssignment(data, houseId ?? data.house_id ?? null);
    if (label) {
      lines.push(`Domicilio: ${label}`);
    } else if (houseId != null && houseId > 0) {
      lines.push(`Domicilio: Casa #${houseId}`);
    }
  }

  private resolveHouseLabelFromAssignment(
    data: AccessQrScanResult,
    houseId: number | null
  ): string | null {
    if (houseId == null || houseId <= 0) {
      return null;
    }
    const assignment = (data.active_assignments ?? []).find((a) => a.house_id === houseId);
    const label = assignment?.house_label?.trim();
    return label || null;
  }

  private appendExternalTimerLines(data: AccessQrScanResult, lines: string[]): void {
    if (!data.temp_visit_id || this.isExitMode()) {
      return;
    }
    const assignment = this.resolveAssignmentForDisplay(data);
    if (!assignment?.valid_until) {
      return;
    }
    lines.push(`Autorizado para entrar hasta: ${assignment.valid_until}`);
    const untilMs = new Date(assignment.valid_until).getTime();
    const mins =
      assignment.minutes_remaining != null
        ? assignment.minutes_remaining
        : Number.isFinite(untilMs)
          ? Math.max(0, Math.round((untilMs - Date.now()) / 60000))
          : null;
    if (mins != null && mins >= 0) {
      lines.push(`Tiempo restante para ingresar: ${mins} min`);
      if (mins < 5) {
        this.toastr.warning('Autorización por vencer');
      }
    }
    const duration = this.assignmentDurationMinutes(assignment);
    if (duration > 0) {
      lines.push(`Máx. ${duration} min de permanencia una vez dentro`);
    }
  }

  private resolveAssignmentForDisplay(data: AccessQrScanResult): ExternalVisitAssignmentOption | null {
    const list = data.active_assignments ?? [];
    const aid = data.assignment_id;
    if (aid != null && aid > 0) {
      const found = list.find((a) => a.assignment_id === aid);
      if (found) {
        return found;
      }
    }
    if (list.length === 1) {
      return list[0];
    }
    return null;
  }

  private assignmentDurationMinutes(assignment: ExternalVisitAssignmentOption): number {
    const from = assignment.valid_from ? new Date(assignment.valid_from).getTime() : NaN;
    const until = assignment.valid_until ? new Date(assignment.valid_until).getTime() : NaN;
    if (Number.isFinite(from) && Number.isFinite(until) && until > from) {
      return Math.max(1, Math.round((until - from) / 60000));
    }
    if (Number.isFinite(until)) {
      return Math.max(0, Math.round((until - Date.now()) / 60000));
    }
    return 0;
  }

  private buildObservation(data: AccessQrScanResult): string {
    let o = data.status_validated;
    if (data.is_birthday) {
      o += ' | CUMPLEAÑOS';
    }
    if (data.source === 'qr') {
      o += ' | QR';
    } else {
      o += ' | MANUAL';
    }
    return o;
  }

  private postAccessLog(data: AccessQrScanResult): void {
    const apId = this.selectedAccessPointId;
    if (!apId) {
      return;
    }

    this.incidentLogReady = false;
    this.lastIncidentContext = this.buildScanContext(data);
    const operatorNotes = this.operatorNotes.trim() || null;

    if (data.temp_visit_id) {
      const houseId = data.house_id ?? data.vehicle?.house_id ?? null;
      if (this.isExitMode()) {
        const body: Record<string, unknown> = {
          access_point_id: apId,
          temp_visit_id: data.temp_visit_id,
          house_id: houseId,
        };
        if (operatorNotes) {
          body['operator_notes'] = operatorNotes;
        }
        this.accessLogService.createTemporaryExit(body as any).subscribe({
          next: (res) => {
            const tempId = Number(res?.data?.temp_access_log_id ?? 0) || 0;
            const mins = Number(res?.data?.permanence_minutes ?? 0);
            const exceeded = !!res?.data?.stay_exceeded;
            if (tempId > 0) {
              this.lastIncidentContext = {
                ...this.buildScanContext(data),
                temp_access_log_id: tempId,
              };
              this.applyLogRefFromScan(data, -tempId);
            }
            this.markIncidentReady(true);
            this.operatorNotes = '';
            let msg = `Salida registrada — permaneció ${mins} min`;
            if (exceeded) {
              msg += ' (excedió tiempo autorizado)';
              this.toastr.warning(msg);
            }
            this.patchResultMessage(`${data.status_validated} — ${msg}`);
          },
          error: (err) => {
            const msg =
              err?.error?.error || 'No hay entrada abierta para esta visita';
            this.toastr.error(msg);
            this.markIncidentReady();
          },
        });
        return;
      }

      if (!data.allow_entry) {
        const houseId = data.house_id ?? data.vehicle?.house_id ?? null;
        const body: Record<string, unknown> = {
          access_point_id: apId,
          temp_visit_id: data.temp_visit_id,
          house_id: houseId,
          assignment_id: data.assignment_id ?? null,
          entry_source: data.source,
          entity_kind: data.kind === 'vehicle' ? 'VEHICLE' : 'PERSON',
          display_name_snapshot: data.identity_display_name ?? data.person?.first_name ?? null,
          document_snapshot: data.doc_number ?? data.person?.doc_number ?? null,
          document_type_snapshot: data.document_type ?? null,
          license_plate_snapshot: data.license_plate ?? data.vehicle?.license_plate ?? null,
        };
        if (operatorNotes) {
          body['operator_notes'] = operatorNotes;
        }
        this.accessLogService.createTemporaryDeniedAttempt(body as any).subscribe({
          next: (res) => {
            const tempId = Number(res?.data?.temp_access_log_id ?? 0) || 0;
            if (tempId > 0) {
              this.lastIncidentContext = {
                ...this.buildScanContext(data),
                temp_access_log_id: tempId,
              };
              this.applyLogRefFromScan(data, -tempId);
            }
            this.markIncidentReady(true);
          },
          error: (err) => {
            const msg = err?.error?.error || 'No se pudo registrar el intento denegado';
            this.toastr.error(msg);
            this.markIncidentReady();
          },
        });
        return;
      }

      const body: Record<string, unknown> = {
        access_point_id: apId,
        temp_visit_id: data.temp_visit_id,
        house_id: houseId,
        assignment_id: data.assignment_id ?? null,
        status_validated: data.status_validated,
        entry_source: data.source,
        entity_kind: data.kind === 'vehicle' ? 'VEHICLE' : 'PERSON',
      };
      if (operatorNotes) {
        body['operator_notes'] = operatorNotes;
      }
      this.accessLogService.createTemporaryEntry(body as any).subscribe({
        next: (res) => {
          const tempId = Number(res?.data?.temp_access_log_id ?? 0) || 0;
          if (tempId > 0) {
            this.lastIncidentContext = {
              ...this.buildScanContext(data),
              temp_access_log_id: tempId,
            };
            this.applyLogRefFromScan(data, -tempId);
          }
          this.markIncidentReady(true);
          this.operatorNotes = '';
        },
        error: (err) => {
          const msg = err?.error?.error || 'No se pudo guardar el ingreso de visita externa';
          this.toastr.error(msg);
          this.markIncidentReady();
        },
      });
      return;
    }

    const body: Record<string, unknown> = {
      access_point_id: apId,
      type: this.movementMode,
      observation: this.buildObservation(data),
      entry_source: data.source,
      entity_kind: data.kind === 'vehicle' ? 'VEHICLE' : 'PERSON',
      identity_claim: data.identity_claim ?? null,
    };
    if (operatorNotes) {
      body['operator_notes'] = operatorNotes;
    }

    if (data.kind === 'person') {
      body.person_id = data.person_id ?? null;
      body.doc_number = data.doc_number ?? data.person?.doc_number ?? null;
      body.document_type = data.document_type ?? null;
      body.vehicle_id = null;
    } else {
      const vid = data.vehicle_id != null && Number(data.vehicle_id) > 0 ? Number(data.vehicle_id) : null;
      body.vehicle_id = vid;
      body.person_id = null;
      body.doc_number = data.doc_number ?? null;
      if (data.license_plate) {
        body.license_plate = data.license_plate;
      }
      if (!vid && data.license_plate) {
        body.observation = `${body.observation} | placa ${data.license_plate}`;
      }
      if (data.temp_visit_id) {
        body.observation = `${body.observation} | veh.ext #${data.temp_visit_id}`;
      }
    }

    this.accessLogService.createResidentAccessLog(body as any).subscribe({
      next: (res) => {
        const logId = Number(res?.data?.id ?? 0) || 0;
        const closed = !!res?.data?.closed;
        const orphanExit = !!res?.data?.orphan_exit;
        const permanenceMinutes = Number(res?.data?.permanence_minutes ?? 0);

        if (logId > 0) {
          this.lastIncidentContext = {
            ...this.buildScanContext(data),
            access_log_id: logId,
          };
          this.applyLogRefFromScan(data, logId);
        }
        this.markIncidentReady(true);
        this.operatorNotes = '';

        if (orphanExit && this.isExitMode()) {
          const msg = 'Salida observada — no había ingreso abierto';
          this.toastr.warning(msg);
          this.patchResultMessage(`${data.status_validated} — ${msg}`);
        } else if (closed && this.isExitMode()) {
          const msg = `Salida registrada — permaneció ${permanenceMinutes} min`;
          this.patchResultMessage(`${data.status_validated} — ${msg}`);
        }
      },
      error: (err) => {
        const msg =
          err?.error?.error ||
          err?.message ||
          (this.isExitMode()
            ? 'No hay entrada abierta para este registro'
            : 'No se pudo guardar el registro de acceso');
        this.toastr.error(msg);
        this.markIncidentReady();
      },
    });
  }

  /** Finaliza registro en backend: libera input, pulso visual y fade en PERMITIDO. */
  private markIncidentReady(refreshHistory = false): void {
    this.registrationInProgress = false;
    this.incidentLogReady = true;
    if (this.continuousScan) {
      this.resumeDetection();
    }
    this.triggerInputPulse(this.resultTone);
    this.scheduleResultFade();
    this.focusManualInput();
    if (refreshHistory) {
      this.refreshRecentHistory();
    }
  }

  async toggleFlash(): Promise<void> {
    const video = this.videoElement?.nativeElement;
    const stream = (this.mediaStream ?? (video?.srcObject as MediaStream | null)) ?? null;
    if (!stream) {
      return;
    }
    try {
      if (BrowserCodeReader.mediaStreamIsTorchCompatible(stream)) {
        const track = stream.getVideoTracks()[0];
        await BrowserCodeReader.mediaStreamSetTorch(track, !this.hasFlashOn);
        this.hasFlashOn = !this.hasFlashOn;
        return;
      }
      const track = stream.getVideoTracks()[0];
      await track.applyConstraints({
        advanced: [{ torch: !this.hasFlashOn } as any],
      });
      this.hasFlashOn = !this.hasFlashOn;
    } catch (error) {
      console.error('Flash toggle error:', error);
    }
  }
}
