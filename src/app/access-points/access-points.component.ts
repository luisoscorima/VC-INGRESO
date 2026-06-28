import { AfterViewInit, Component, OnInit } from '@angular/core';
import { EntranceService } from '../entrance.service';
import { initFlowbite } from 'flowbite';
import { ToastrService } from 'ngx-toastr';
import { ExpandableRowId, isExpandableRowOpen, toggleExpandableRow } from '../shared/expandable-row';

/** Fila de `access_points` (catálogo / gestión). */
export interface AccessPointRow {
  id: number;
  name: string;
  type: string;
  location?: string | null;
  is_active: number | boolean;
  controla_aforo?: number | boolean;
  permite_reserva?: number | boolean;
  max_capacity?: number | null;
  current_capacity?: number | null;
}

@Component({
  selector: 'app-access-points',
  templateUrl: './access-points.component.html',
  styleUrls: ['./access-points.component.css'],
})
export class AccessPointsComponent implements OnInit, AfterViewInit {
  accessPoints: AccessPointRow[] = [];

  pointToAdd: AccessPointRow = this.emptyPoint();
  pointToEdit: AccessPointRow = this.emptyPoint();

  types: string[] = ['ENTRADA', 'AREA_COMUN', 'AREA_LIMITADA'];

  searchTerm = '';
  currentPage = 1;
  pageSize = 10;
  pageSizeOptions: number[] = [10, 25, 50, 100];

  expandedRowId: ExpandableRowId = null;
  readonly tableColspan = 10;

  constructor(
    private entranceService: EntranceService,
    private toastr: ToastrService
  ) {}

  ngOnInit(): void {
    this.reload();
  }

  ngAfterViewInit(): void {
    initFlowbite();
  }

  private emptyPoint(): AccessPointRow {
    return {
      id: 0,
      name: '',
      type: 'ENTRADA',
      location: '',
      is_active: 1,
      controla_aforo: 0,
      permite_reserva: 0,
      max_capacity: null,
      current_capacity: null,
    };
  }

  reload(): void {
    this.entranceService.getAllAreas().subscribe({
      next: (res: any) => {
        const list = Array.isArray(res) ? res : (res?.data ?? []);
        this.accessPoints = list as AccessPointRow[];
      },
      error: (err) => console.error('Error cargando puntos de acceso:', err),
    });
  }

  newPoint(): void {
    this.pointToAdd = this.emptyPoint();
    document.getElementById('access-points-new-button')?.click();
  }

  editPoint(row: AccessPointRow): void {
    this.pointToEdit = {
      ...row,
      location: row.location ?? '',
      max_capacity: row.max_capacity ?? null,
      current_capacity: row.current_capacity ?? null,
      is_active: row.is_active === 1 || row.is_active === true ? 1 : 0,
      controla_aforo: row.controla_aforo === 1 || row.controla_aforo === true ? 1 : 0,
      permite_reserva: row.permite_reserva === 1 || row.permite_reserva === true ? 1 : 0,
    };
    document.getElementById('access-points-edit-button')?.click();
  }

  saveNewPoint(): void {
    if (!this.pointToAdd.name?.trim()) {
      this.toastr.error('El nombre es obligatorio');
      return;
    }
    const controla = this.pointToAdd.controla_aforo === 1 || this.pointToAdd.controla_aforo === true;
    if (controla) {
      const max = this.normalizeMaxCapacity(this.pointToAdd.max_capacity);
      if (max === null || max <= 0) {
        this.toastr.error('Si controla aforo, indique un aforo máximo mayor que cero');
        return;
      }
    }
    const body: Record<string, unknown> = {
      name: this.pointToAdd.name.trim(),
      type: this.pointToAdd.type || 'ENTRADA',
      location: (this.pointToAdd.location ?? '').toString().trim() || null,
      is_active: this.pointToAdd.is_active === 1 || this.pointToAdd.is_active === true,
      controla_aforo: controla,
      permite_reserva: this.pointToAdd.permite_reserva === 1 || this.pointToAdd.permite_reserva === true,
      max_capacity: controla ? this.normalizeMaxCapacity(this.pointToAdd.max_capacity) : null,
      current_capacity: controla ? this.normalizeOccupancy(this.pointToAdd.current_capacity) : null,
    };
    this.entranceService.addAccessPoint(body).subscribe({
      next: (res: any) => {
        if (res.success) {
          this.toastr.success(res.message ?? 'Creado');
          this.handleSuccess();
        } else {
          this.toastr.error(res.error || res.message || 'Error al crear');
        }
      },
      error: () => this.toastr.error('Error al crear el punto de acceso'),
    });
  }

  saveEditPoint(): void {
    if (!this.pointToEdit.name?.trim()) {
      this.toastr.error('El nombre es obligatorio');
      return;
    }
    const id = this.pointToEdit.id;
    if (!id) {
      this.toastr.error('ID no válido');
      return;
    }
    const controla = this.pointToEdit.controla_aforo === 1 || this.pointToEdit.controla_aforo === true;
    if (controla) {
      const max = this.normalizeMaxCapacity(this.pointToEdit.max_capacity);
      if (max === null || max <= 0) {
        this.toastr.error('Si controla aforo, indique un aforo máximo mayor que cero');
        return;
      }
    }
    const body: Record<string, unknown> = {
      name: this.pointToEdit.name.trim(),
      type: this.pointToEdit.type || 'ENTRADA',
      location: (this.pointToEdit.location ?? '').toString().trim() || null,
      is_active: this.pointToEdit.is_active === 1 || this.pointToEdit.is_active === true,
      controla_aforo: controla,
      permite_reserva: this.pointToEdit.permite_reserva === 1 || this.pointToEdit.permite_reserva === true,
      max_capacity: controla ? this.normalizeMaxCapacity(this.pointToEdit.max_capacity) : null,
      current_capacity: controla ? this.normalizeOccupancy(this.pointToEdit.current_capacity) : null,
    };
    this.entranceService.updateAccessPoint(id, body).subscribe({
      next: (res: any) => {
        if (res.success) {
          this.toastr.success(res.message ?? 'Actualizado');
          this.handleSuccess();
        } else {
          this.toastr.error(res.error || res.message || 'Error al actualizar');
        }
      },
      error: () => this.toastr.error('Error al actualizar el punto de acceso'),
    });
  }

  private handleSuccess(): void {
    this.pointToAdd = this.emptyPoint();
    this.pointToEdit = this.emptyPoint();
    this.reload();
  }

  isActiveLabel(v: number | boolean | undefined): string {
    return v === 1 || v === true ? 'ACTIVO' : 'INACTIVO';
  }

  siNo(v: number | boolean | undefined): string {
    return v === 1 || v === true ? 'Sí' : 'No';
  }

  typeLabel(t: string | undefined): string {
    const u = String(t ?? '')
      .trim()
      .toUpperCase();
    const map: Record<string, string> = {
      ENTRADA: 'Entrada',
      AREA_COMUN: 'Área común',
      AREA_LIMITADA: 'Área limitada',
    };
    return map[u] || u || '—';
  }

  onControlaAforoChangeAdd(checked: boolean): void {
    this.pointToAdd.controla_aforo = checked ? 1 : 0;
    if (!checked) {
      this.pointToAdd.max_capacity = null;
      this.pointToAdd.current_capacity = null;
    }
  }

  onControlaAforoChangeEdit(checked: boolean): void {
    this.pointToEdit.controla_aforo = checked ? 1 : 0;
    if (!checked) {
      this.pointToEdit.max_capacity = null;
      this.pointToEdit.current_capacity = null;
    }
  }

  get filteredPoints(): AccessPointRow[] {
    if (!this.searchTerm.trim()) {
      return this.accessPoints;
    }
    const s = this.searchTerm.toLowerCase();
    return this.accessPoints.filter(
      (p) =>
        (p.name && p.name.toLowerCase().includes(s)) ||
        (p.type && p.type.toLowerCase().includes(s)) ||
        (p.location && String(p.location).toLowerCase().includes(s))
    );
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredPoints.length / this.pageSize));
  }

  get paginatedPoints(): AccessPointRow[] {
    const safe = Math.min(this.currentPage, this.totalPages);
    if (safe !== this.currentPage) {
      this.currentPage = safe;
    }
    const start = (safe - 1) * this.pageSize;
    return this.filteredPoints.slice(start, start + this.pageSize);
  }

  onPageSizeChange(): void {
    this.currentPage = 1;
    this.expandedRowId = null;
  }

  previousPage(): void {
    if (this.currentPage > 1) {
      this.currentPage -= 1;
      this.expandedRowId = null;
    }
  }

  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage += 1;
      this.expandedRowId = null;
    }
  }

  isRowOpen(p: AccessPointRow): boolean {
    return isExpandableRowOpen(this.expandedRowId, p.id);
  }

  toggleRow(p: AccessPointRow): void {
    this.expandedRowId = toggleExpandableRow(this.expandedRowId, p.id);
  }

  private normalizeMaxCapacity(v: number | string | null | undefined): number | null {
    if (v === null || v === undefined || v === '') {
      return null;
    }
    const n = Number(v);
    return Number.isNaN(n) || n < 0 ? null : n;
  }

  private normalizeOccupancy(v: number | string | null | undefined): number | null {
    if (v === null || v === undefined || v === '') {
      return null;
    }
    const n = Number(v);
    if (Number.isNaN(n) || n < 0) {
      return null;
    }
    return Math.floor(n);
  }
}
