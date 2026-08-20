import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/**
 * Selector de foto unificado: dos acciones directas (cámara / galería),
 * estilo “attachment zone” inspirado en shadcn, adaptado a Angular + Tailwind.
 */
@Component({
  selector: 'app-photo-source-picker',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="vc-photo-picker" [class.vc-photo-picker--compact]="compact">
      <label *ngIf="label" class="vc-photo-picker__label">
        {{ label }}
        <span *ngIf="required" class="text-red-600">*</span>
        <span *ngIf="optional" class="text-gray-400 font-normal text-xs">(opcional)</span>
      </label>
      <p *ngIf="hint" class="vc-photo-picker__hint">{{ hint }}</p>

      <div *ngIf="previewUrl" class="vc-photo-picker__preview">
        <img [src]="previewUrl" [alt]="previewAlt" />
        <button
          *ngIf="showClear"
          type="button"
          class="vc-photo-picker__clear"
          [disabled]="busy"
          (click)="onClear()"
        >
          Quitar foto
        </button>
      </div>

      <div
        class="vc-photo-picker__zone"
        [class.vc-photo-picker__zone--busy]="busy"
        [class.vc-photo-picker__zone--has-preview]="!!previewUrl"
      >
        <mat-icon class="vc-photo-picker__zone-icon" aria-hidden="true">add_photo_alternate</mat-icon>
        <p class="vc-photo-picker__zone-title">{{ zoneTitle }}</p>
        <p class="vc-photo-picker__zone-sub">JPG, PNG o WEBP</p>

        <div class="vc-photo-picker__actions" [class.vc-photo-picker__actions--single]="!showGallery">
          <button
            type="button"
            class="vc-photo-picker__btn vc-photo-picker__btn--camera"
            [disabled]="busy"
            (click)="openCamera()"
          >
            <mat-icon aria-hidden="true">photo_camera</mat-icon>
            <span>{{ cameraLabel }}</span>
          </button>
          <button
            *ngIf="showGallery"
            type="button"
            class="vc-photo-picker__btn vc-photo-picker__btn--gallery"
            [disabled]="busy"
            (click)="openGallery()"
          >
            <mat-icon aria-hidden="true">photo_library</mat-icon>
            <span>{{ galleryLabel }}</span>
          </button>
        </div>
      </div>

      <div *ngIf="busy" class="vc-photo-picker__status" role="status" aria-live="polite">
        <span class="vc-photo-picker__spinner" aria-hidden="true"></span>
        <span>{{ compressing ? 'Procesando foto…' : 'Subiendo foto…' }}</span>
      </div>

      <p *ngIf="successText && !busy" class="vc-photo-picker__success">{{ successText }}</p>

      <input
        #cameraInput
        type="file"
        class="hidden"
        tabindex="-1"
        [accept]="accept"
        [attr.capture]="captureFacing"
        (change)="onInputChange($event)"
      />
      <input
        *ngIf="showGallery"
        #galleryInput
        type="file"
        class="hidden"
        tabindex="-1"
        [accept]="accept"
        (change)="onInputChange($event)"
      />
    </div>
  `,
})
export class PhotoSourcePickerComponent {
  @ViewChild('cameraInput') private cameraInput?: ElementRef<HTMLInputElement>;
  @ViewChild('galleryInput') private galleryInput?: ElementRef<HTMLInputElement>;

  @Input() label = '';
  @Input() hint = '';
  @Input() required = false;
  @Input() optional = false;
  @Input() previewUrl: string | null = null;
  @Input() previewAlt = 'Vista previa';
  @Input() compressing = false;
  @Input() uploading = false;
  @Input() disabled = false;
  @Input() showClear = false;
  @Input() successText = '';
  @Input() captureFacing: 'environment' | 'user' = 'environment';
  @Input() compact = false;
  @Input() zoneTitle = 'Añadir imagen';
  @Input() cameraLabel = 'Tomar foto';
  @Input() galleryLabel = 'Galería';
  @Input() showGallery = true;
  @Input() accept = 'image/jpeg,image/png,image/gif,image/webp';

  @Output() fileSelected = new EventEmitter<File>();
  @Output() cleared = new EventEmitter<void>();

  get busy(): boolean {
    return this.disabled || this.compressing || this.uploading;
  }

  openCamera(): void {
    if (this.busy) {
      return;
    }
    this.cameraInput?.nativeElement.click();
  }

  openGallery(): void {
    if (this.busy || !this.showGallery) {
      return;
    }
    this.galleryInput?.nativeElement.click();
  }

  onInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      input.value = '';
      return;
    }
    this.fileSelected.emit(file);
    input.value = '';
  }

  onClear(): void {
    if (this.busy) {
      return;
    }
    this.cleared.emit();
  }
}
