import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  Output,
  EventEmitter,
} from '@angular/core';
import { BrowserCodeReader, BrowserMultiFormatReader } from '@zxing/browser';
import type { IScannerControls } from '@zxing/browser';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ToastrService } from 'ngx-toastr';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ApiService } from '../api.service';
import { QrAccessService, AccessQrScanResult } from './qr-access.service';
import { ExternalVisitAssignmentOption } from '../externalVehicle';
import { MatDialog } from '@angular/material/dialog';
import { NavPermissionService } from '../nav-permission.service';
import {
  IncidentFormDialogComponent,
  INCIDENT_DIALOG_PANEL_CLASS,
} from '../incidents/incident-form-dialog.component';
import {
  IncidentFormDialogData,
  IncidentScanContext,
} from '../incidents/access-incident.service';

/** Preferencia opcional: último punto elegido (sin bloqueo). */
const ACCESS_POINT_STORAGE_KEY = 'vc_scanner_access_point_id';
const MOVEMENT_MODE_STORAGE_KEY = 'vc_scanner_movement_mode';
const COOLDOWN_MS = 3000;

type MovementMode = 'INGRESO' | 'EGRESO';

interface AccessPointOption {
  id: number;
  name: string;
}

@Component({
  selector: 'app-qr-scanner',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  template: `
    <div>
      <!-- PNG de estado (allowed/denied/etc.): pantalla completa mientras dura el cooldown -->
      <div
        *ngIf="cooldownActive && statusImageUrl"
        class="fixed inset-0 z-[10050] flex flex-col items-center justify-center gap-4 bg-black/90 p-6 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-live="polite"
        aria-label="Resultado del escaneo">
        <img
          [src]="statusImageUrl"
          alt=""
          class="h-auto max-h-[min(34vh,220px)] w-auto max-w-[min(72vw,240px)] object-contain drop-shadow-xl sm:max-h-[min(38vh,260px)] sm:max-w-[min(70vw,280px)]" />
        <p class="text-center text-sm text-white/80">Podrá escanear de nuevo en unos segundos…</p>
      </div>

    <div class="w-full px-0 py-2 sm:py-3">
      <div
        class="overflow-hidden rounded-xl border-2 border-dashed border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800"
        [class.border-amber-400]="movementMode === 'EGRESO'"
        [class.bg-amber-50]="movementMode === 'EGRESO'"
        [class.scanner-exit-mode]="movementMode === 'EGRESO'">
        <div class="border-b border-gray-200 px-4 py-4 text-center dark:border-gray-700">
          <h2 class="m-0 flex items-center justify-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
            <mat-icon class="!h-7 !w-7 text-teal-600 dark:text-teal-400">qr_code_scanner</mat-icon>
            Escáner QR / documento / placa
          </h2>
        </div>
        <div class="p-4">
          <p
            *ngIf="scanEngineHint"
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
                <option *ngFor="let p of accessPoints" [ngValue]="p.id">{{ p.name }}</option>
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
          <p *ngIf="!accessPoints.length && !loadingPoints" class="mb-3 text-sm text-amber-700 dark:text-amber-400">
            No hay puntos de acceso configurados.
          </p>

          <div
            class="scanner-viewport w-full md:mx-auto md:max-w-[340px] lg:max-w-[380px]"
            #scannerViewport
            [class.dimmed]="cooldownActive">
            <video #videoElement autoplay playsinline muted></video>
            <canvas #scanCanvas hidden></canvas>
            <div class="scan-frame" *ngIf="isScanning && !cooldownActive" aria-hidden="true"></div>
            <div class="scan-overlay" *ngIf="isScanning && !cooldownActive">
              <div class="scan-line"></div>
            </div>
          </div>

          <div class="mt-4 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              *ngIf="!isScanning"
              (click)="startScanning()"
              [disabled]="cooldownActive || !selectedAccessPointId"
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
              *ngIf="isScanning && hasFlash && !cooldownActive"
              (click)="toggleFlash()"
              class="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700">
              <mat-icon class="!h-5 !w-5">{{ hasFlashOn ? 'flash_off' : 'flash_on' }}</mat-icon>
              {{ hasFlashOn ? 'Apagar flash' : 'Flash' }}
            </button>
          </div>

          <div
            class="result-area mt-4 rounded-lg border border-teal-100 bg-teal-50/80 p-4 dark:border-teal-900/40 dark:bg-teal-950/30"
            *ngIf="lastScanSummary">
            <div class="result-content text-center text-gray-900 dark:text-gray-100">
              <strong class="text-sm">{{ lastScanSummary }}</strong>
              <pre
                *ngIf="lastScanDetail"
                class="mt-2 whitespace-pre-wrap break-all rounded bg-white/90 p-2 text-left text-xs text-gray-800 dark:bg-gray-900/80 dark:text-gray-200">{{ lastScanDetail }}</pre>
            </div>
            <div class="mt-3 flex justify-center" *ngIf="canAddIncident && !pendingHouseSelection">
              <button
                type="button"
                (click)="openIncidentDialog()"
                [disabled]="!incidentLogReady"
                class="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-900/50">
                <mat-icon class="!h-5 !w-5">report_problem</mat-icon>
                {{ incidentLogReady ? 'Añadir incidencia' : 'Registrando acceso…' }}
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

          <div class="hero-image-wrap mt-4 text-center" *ngIf="heroImageUrl">
            <img [src]="heroImageUrl" alt="Foto" class="max-h-[280px] max-w-full rounded-lg object-contain shadow-md" />
          </div>

          <div
            *ngIf="errorMessage"
            class="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            <mat-icon class="shrink-0 text-red-600">error</mat-icon>
            <span>{{ errorMessage }}</span>
          </div>

          <div class="manual-input mt-4">
            <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              Entrada manual: DNI, placa o doc. responsable (veh. externo)
            </label>
            <div class="flex gap-2">
              <input
                type="text"
                [(ngModel)]="manualCode"
                (keyup.enter)="submitManualCode()"
                [disabled]="cooldownActive"
                placeholder="DNI, placa o doc. responsable"
                class="block min-w-0 flex-1 rounded-lg border border-gray-300 bg-gray-50 p-2.5 text-sm focus:border-teal-500 focus:ring-teal-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:focus:border-teal-500 dark:focus:ring-teal-500" />
              <button
                type="button"
                (click)="submitManualCode()"
                [disabled]="cooldownActive || !manualCode.trim()"
                title="Enviar"
                class="inline-flex shrink-0 items-center justify-center rounded-lg border border-teal-800/30 !bg-teal-600 p-2.5 shadow-sm hover:!bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50 dark:!bg-teal-500 dark:hover:!bg-teal-600">
                <mat-icon class="!text-white">send</mat-icon>
              </button>
            </div>
          </div>

          <div
            *ngIf="cooldownActive && !statusImageUrl"
            class="mt-4 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
            <svg class="h-6 w-6 shrink-0 animate-spin text-teal-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <span>Esperando… no escanee de nuevo hasta finalizar.</span>
          </div>
        </div>
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
    `,
  ],
})
export class QrScannerComponent implements OnInit, OnDestroy {
  @ViewChild('videoElement') videoElement!: ElementRef<HTMLVideoElement>;
  @ViewChild('scannerViewport') scannerViewport!: ElementRef;
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

  cooldownActive = false;
  lastScanSummary: string | null = null;
  lastScanDetail: string | null = null;
  lastScanOk = false;
  heroImageUrl: string | null = null;
  /** Imagen grande de estado (allowed / denied / observed / birthday). */
  statusImageUrl: string | null = null;

  pendingHouseSelection = false;
  pendingAssignments: ExternalVisitAssignmentOption[] = [];
  pendingTempVisitId: number | null = null;

  incidentLogReady = false;
  lastIncidentContext: IncidentScanContext | null = null;

  private useNativeBarcode = false;
  private mediaStream: MediaStream | null = null;
  private animationFrameId: number | null = null;
  private barcodeDetector: any = null;
  private zxingReader: BrowserMultiFormatReader | null = null;
  private zxingControls: IScannerControls | null = null;
  private destroy$ = new Subject<void>();
  private cooldownTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private toastr: ToastrService,
    private api: ApiService,
    private qrAccess: QrAccessService,
    private navPerm: NavPermissionService,
    private dialog: MatDialog
  ) {}

  get canAddIncident(): boolean {
    return this.navPerm.canView('incidents');
  }

  ngOnInit(): void {
    this.checkBarcodeSupport();
    this.loadMovementMode();
    this.loadAccessPoints();
    this.navPerm.load().subscribe();
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

  private movementLabel(): string {
    return this.isExitMode() ? 'Salida' : 'Entrada';
  }

  ngOnDestroy(): void {
    this.stopScanning();
    this.clearCooldownTimer();
    this.destroy$.next();
    this.destroy$.complete();
  }

  onAccessPointChange(id: number | null): void {
    if (id != null && !isNaN(Number(id)) && Number(id) > 0) {
      sessionStorage.setItem(ACCESS_POINT_STORAGE_KEY, String(id));
    } else {
      sessionStorage.removeItem(ACCESS_POINT_STORAGE_KEY);
    }
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
          const saved = sessionStorage.getItem(ACCESS_POINT_STORAGE_KEY);
          const savedId = saved ? parseInt(saved, 10) : NaN;
          if (this.accessPoints.some((p) => p.id === savedId)) {
            this.selectedAccessPointId = savedId;
          } else if (this.accessPoints.length === 1) {
            this.selectedAccessPointId = this.accessPoints[0].id;
            sessionStorage.setItem(ACCESS_POINT_STORAGE_KEY, String(this.selectedAccessPointId));
          } else {
            this.selectedAccessPointId = null;
          }
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
    if (this.cooldownActive) {
      return;
    }
    if (!this.selectedAccessPointId) {
      this.toastr.warning('Seleccione un punto de acceso');
      return;
    }
    this.errorMessage = null;
    this.scannedResult = null;
    this.lastScanSummary = null;
    this.lastScanDetail = null;
    this.heroImageUrl = null;
    this.statusImageUrl = null;

    const videoEl = this.videoElement.nativeElement;
    const useNative = this.useNativeBarcode && this.barcodeDetector;

    try {
      if (useNative) {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        videoEl.srcObject = this.mediaStream;
        this.isScanning = true;
        const track = this.mediaStream.getVideoTracks()[0];
        const capabilities = track.getCapabilities() as any;
        this.hasFlash = !!capabilities?.torch;
        void this.detectBarcode();
      } else {
        this.isScanning = true;
        this.hasFlash = false;
        await this.startZxingScan(videoEl);
      }
    } catch (error: any) {
      console.error('Error starting scanner:', error);
      this.errorMessage = 'No se pudo acceder a la cámara. Verifique los permisos o use entrada manual.';
      this.isScanning = false;
      this.stopZxing();
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach((t) => t.stop());
        this.mediaStream = null;
      }
    }
  }

  private async startZxingScan(videoEl: HTMLVideoElement): Promise<void> {
    this.stopZxing();
    const reader = new BrowserMultiFormatReader();
    this.zxingReader = reader;
    try {
      const controls = await reader.decodeFromVideoDevice(undefined, videoEl, (result, _, __) => {
        const text = result?.getText();
        if (text) {
          this.onCodeDetected(text);
        }
      });
      this.zxingControls = controls;
      const stream = videoEl.srcObject as MediaStream | null;
      if (stream && BrowserCodeReader.mediaStreamIsTorchCompatible(stream)) {
        this.hasFlash = true;
      }
    } catch (e) {
      console.error('ZXing scan failed:', e);
      this.isScanning = false;
      this.errorMessage = 'No se pudo iniciar el lector de códigos. Use la entrada manual.';
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

  private async detectBarcode(): Promise<void> {
    if (!this.isScanning || !this.videoElement?.nativeElement) {
      return;
    }

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
    }

    this.animationFrameId = requestAnimationFrame(() => this.detectBarcode());
  }

  private onCodeDetected(code: string): void {
    this.scannedResult = code;
    this.codeScanned.emit(code);
    this.stopScanning();
    this.processInput(code);
  }

  submitManualCode(): void {
    const t = this.manualCode.trim();
    if (!t || this.cooldownActive) {
      return;
    }
    this.manualCode = '';
    this.processInput(t);
  }

  private processInput(raw: string): void {
    if (!this.selectedAccessPointId) {
      this.toastr.warning('Seleccione un punto de acceso');
      return;
    }
    if (this.cooldownActive) {
      return;
    }

    this.errorMessage = null;
    this.lastScanSummary = null;
    this.lastScanDetail = null;
    this.heroImageUrl = null;
    this.statusImageUrl = null;
    this.pendingHouseSelection = false;
    this.pendingAssignments = [];
    this.pendingTempVisitId = null;
    this.incidentLogReady = false;
    this.lastIncidentContext = null;

    this.qrAccess.scan(raw).subscribe({
      next: (data) => this.handleScanResult(data),
      error: (err) => {
        const msg = err?.error?.error || err?.message || 'Error al procesar la lectura';
        this.errorMessage = msg;
        this.lastScanSummary = msg;
        this.lastScanDetail = null;
        this.statusImageUrl = 'assets/denied.png';
        this.toastr.error(msg);
        this.beginCooldown();
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
      this.toastr.info(data.message || 'Seleccione la casa destino');
      return;
    }

    this.pendingHouseSelection = false;
    this.pendingAssignments = [];
    this.pendingTempVisitId = null;
    this.applyScanUi(data);
    this.postAccessLog(data);
    this.beginCooldown();
  }

  openIncidentDialog(): void {
    if (!this.incidentLogReady || !this.lastIncidentContext || !this.selectedAccessPointId) {
      return;
    }
    const data: IncidentFormDialogData = {
      mode: 'scan',
      accessPointId: this.selectedAccessPointId,
      lockAccessPoint: true,
      scanContext: this.lastIncidentContext,
    };
    this.dialog.open(IncidentFormDialogComponent, {
      width: 'min(480px, 96vw)',
      panelClass: INCIDENT_DIALOG_PANEL_CLASS,
      data,
    });
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
    const lines: string[] = [];
    if (data.kind === 'person' && data.person) {
      const p = data.person;
      lines.push(
        [p.first_name, p.paternal_surname, p.maternal_surname].filter(Boolean).join(' ').trim() ||
          p.doc_number
      );
      lines.push(`DNI: ${p.doc_number}`);
      if (p.person_type) {
        lines.push(`Tipo: ${p.person_type}`);
      }
      const url = this.api.getPhotoUrl(p.photo_url ?? null);
      this.heroImageUrl = url || null;
    } else if (data.kind === 'vehicle' && data.vehicle) {
      const v = data.vehicle;
      lines.push(
        data.temp_visit_id ? `Visita externa ${v.license_plate}` : `Vehículo ${v.license_plate}`
      );
      if (v.brand || v.model) {
        lines.push([v.brand, v.model].filter(Boolean).join(' '));
      }
      if (data.doc_number) {
        lines.push(`Doc. responsable: ${data.doc_number}`);
      }
      if (data.house_id) {
        lines.push(`Casa destino: #${data.house_id}`);
      }
      if (data.operator_notes) {
        lines.push(`Notas: ${data.operator_notes}`);
      }
      const url = this.api.getPhotoUrl(v.photo_url ?? null);
      this.heroImageUrl = url || null;
    } else {
      lines.push(data.message || 'Sin coincidencia en el registro');
      if (data.doc_number) {
        lines.push(`Doc.: ${data.doc_number}`);
      }
      if (data.license_plate) {
        lines.push(`Placa: ${data.license_plate}`);
      }
      this.heroImageUrl = null;
    }

    this.appendExternalTimerLines(data, lines);

    this.statusImageUrl = this.pickStatusImage(data);
    this.lastScanOk = this.isExitMode() && !!data.temp_visit_id ? true : data.allow_entry;
    const registeredLabel = this.movementLabel() + ' registrada';
    this.lastScanSummary = data.pending_house_selection
      ? (data.message || 'Seleccione casa destino')
      : `${data.status_validated}${
          this.isExitMode() && data.temp_visit_id
            ? ' — ' + registeredLabel
            : data.allow_entry
              ? ' — ' + registeredLabel
              : ' — Registro denegado / observado'
        }`;
    if (data.is_birthday) {
      this.lastScanSummary += ' — ¡Cumpleaños!';
    }
    this.lastScanDetail = lines.join('\n');

    const snack = data.pending_house_selection
      ? 'Seleccione la casa destino'
      : this.isExitMode() && data.temp_visit_id
        ? registeredLabel
        : data.allow_entry
          ? data.is_birthday
            ? registeredLabel + '. ¡Feliz cumpleaños!'
            : registeredLabel
          : 'Acceso denegado u observado — evento registrado';
    if (data.pending_house_selection) {
      this.toastr.info(snack);
    } else if (this.isExitMode() && data.temp_visit_id) {
      // El toast de salida se muestra al confirmar en postAccessLog
    } else if (data.allow_entry) {
      this.toastr.success(snack);
    } else {
      this.toastr.warning(snack);
    }
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

  private pickStatusImage(data: AccessQrScanResult): string {
    const st = (data.status_validated || '').toUpperCase();
    if (!data.allow_entry || st === 'DENEGADO') {
      return 'assets/denied.png';
    }
    if (st === 'OBSERVADO' || st === 'RESTRINGIDO') {
      return 'assets/observed.png';
    }
    if (data.is_birthday) {
      return 'assets/birthday.png';
    }
    return 'assets/allowed.png';
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

    if (data.temp_visit_id) {
      const houseId = data.house_id ?? data.vehicle?.house_id ?? null;
      if (this.isExitMode()) {
        const body: Record<string, unknown> = {
          access_point_id: apId,
          temp_visit_id: data.temp_visit_id,
          house_id: houseId,
        };
        this.api.post('api/v1/access-logs/temporary/exit', body).subscribe({
          next: (res) => {
            const tempId = Number(res?.data?.temp_access_log_id ?? 0) || 0;
            const mins = Number(res?.data?.permanence_minutes ?? 0);
            const exceeded = !!res?.data?.stay_exceeded;
            if (tempId > 0) {
              this.lastIncidentContext = {
                ...this.buildScanContext(data),
                temp_access_log_id: tempId,
              };
              this.incidentLogReady = true;
            }
            let msg = `Salida registrada — permaneció ${mins} min`;
            if (exceeded) {
              msg += ' (excedió tiempo autorizado)';
              this.toastr.warning(msg);
            } else {
              this.toastr.success(msg);
            }
            this.lastScanSummary = `${data.status_validated} — ${msg}`;
          },
          error: (err) => {
            const msg =
              err?.error?.error || 'No hay entrada abierta para esta visita';
            this.toastr.error(msg);
          },
        });
        return;
      }

      if (!data.allow_entry) {
        return;
      }

      const body: Record<string, unknown> = {
        access_point_id: apId,
        temp_visit_id: data.temp_visit_id,
        house_id: houseId,
        assignment_id: data.assignment_id ?? null,
        status_validated: data.status_validated,
      };
      this.api.post('api/v1/access-logs/temporary', body).subscribe({
        next: (res) => {
          const tempId = Number(res?.data?.temp_access_log_id ?? 0) || 0;
          if (tempId > 0) {
            this.lastIncidentContext = {
              ...this.buildScanContext(data),
              temp_access_log_id: tempId,
            };
            this.incidentLogReady = true;
          }
        },
        error: (err) => {
          const msg = err?.error?.error || 'No se pudo guardar el ingreso de visita externa';
          this.toastr.error(msg);
        },
      });
      return;
    }

    const body: Record<string, unknown> = {
      access_point_id: apId,
      type: this.movementMode,
      observation: this.buildObservation(data),
    };

    if (data.kind === 'person') {
      body.person_id = data.person_id ?? null;
      body.doc_number = data.doc_number ?? data.person?.doc_number ?? null;
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

    this.api.post('api/v1/access-logs', body).subscribe({
      next: (res) => {
        const logId = Number(res?.data?.id ?? 0) || 0;
        const closed = !!res?.data?.closed;
        const permanenceMinutes = Number(res?.data?.permanence_minutes ?? 0);

        if (logId > 0) {
          this.lastIncidentContext = {
            ...this.buildScanContext(data),
            access_log_id: logId,
          };
          this.incidentLogReady = true;
        }

        if (closed && this.isExitMode()) {
          const msg = `Salida registrada — permaneció ${permanenceMinutes} min`;
          this.toastr.success(msg);
          this.lastScanSummary = `${data.status_validated} — ${msg}`;
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
      },
    });
  }

  private beginCooldown(): void {
    this.clearCooldownTimer();
    this.cooldownActive = true;
    this.cooldownTimer = setTimeout(() => {
      this.cooldownActive = false;
      this.cooldownTimer = null;
    }, COOLDOWN_MS);
  }

  private clearCooldownTimer(): void {
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
      this.cooldownTimer = null;
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
