import { Component, Inject, OnInit } from '@angular/core';
import { UsersService } from '../users.service';
import { User } from '../user';
import { MatDialog, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { FormBuilder } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Item } from '../item';
import { ToastrService } from 'ngx-toastr';
import { animate, state, style, transition, trigger } from '@angular/animations';
import { EntranceService } from '../entrance.service';
import { House } from '../house';
import { AuthService } from '../auth.service';
import {
  ExpandableRowId,
  isExpandableRowOpen,
  toggleExpandableRow,
} from '../shared/expandable-row';

@Component({
  selector: 'app-birthday',
  templateUrl: './birthday.component.html',
  styleUrls: ['./birthday.component.css'],
  animations: [
    trigger('detailExpand', [
      state('collapsed', style({ height: '0px', minHeight: '0', display: 'none' })),
      state('expanded', style({ height: '*' })),
      transition('expanded <=> collapsed', animate('225ms cubic-bezier(0.4, 0.0, 0.2, 1)')),
    ]),
  ],
})
export class BirthdayComponent implements OnInit {
  expandedElement: Item;

  neighbor: User = new User(
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    0,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    0,
    '',
    0
  );
  neighbors: User[] = [];
  houses: House[] = [];

  fecha: Date;
  fecha_cumple: string;
  fechaString: string;
  day: string;
  month: string;
  year: number;

  /** Columna documento: personal de puerta (admin/operario), no vecinos USUARIO. */
  showDocColumn = false;

  searchTerm = '';
  currentPage = 1;
  pageSize = 10;
  readonly pageSizeOptions = [10, 20, 50, 100];

  expandedBirthdayRowId: ExpandableRowId = null;

  get birthdayTableColspan(): number {
    return this.showDocColumn ? 6 : 5;
  }

  /** Columnas a mostrar en la tabla (con o sin doc según rol). */
  get displayedColumns(): string[] {
    return this.showDocColumn
      ? ['doc', 'name', 'birth_date', 'house', 'accion']
      : ['name', 'birth_date', 'house', 'accion'];
  }

  get colCount(): number {
    return this.displayedColumns.length;
  }

  get filteredNeighbors(): User[] {
    const f = this.searchTerm.trim().toLowerCase();
    if (!f) {
      return this.neighbors;
    }
    return this.neighbors.filter((p: User | any) => {
      const parts = [
        p?.doc_number,
        p?.first_name,
        p?.paternal_surname,
        p?.maternal_surname,
        this.getHouseDisplay(p),
      ]
        .filter((x) => x != null && String(x).trim() !== '')
        .map((x) => String(x).toLowerCase());
      return parts.some((s) => s.includes(f));
    });
  }

  get paginatedNeighbors(): User[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredNeighbors.slice(start, start + this.pageSize);
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredNeighbors.length / this.pageSize));
  }

  /** yyyy-MM-dd para input type="date" (local). */
  get fechaInputYmd(): string {
    const y = this.fecha.getFullYear();
    const m = String(this.fecha.getMonth() + 1).padStart(2, '0');
    const d = String(this.fecha.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  constructor(
    private usersServices: UsersService,
    private entranceService: EntranceService,
    private auth: AuthService,
    public dialog: MatDialog,
    private route: ActivatedRoute,
    private snackBar: MatSnackBar,
    private router: Router
  ) {}

  searchItem() {}

  saveCheck() {}

  applyFilterList(value: string): void {
    this.searchTerm = value;
    this.currentPage = 1;
  }

  onDateInput(ymd: string): void {
    if (!ymd || ymd.length < 10) {
      return;
    }
    const parts = ymd.split('-').map((x) => parseInt(x, 10));
    if (parts.length !== 3 || parts.some((n) => isNaN(n))) {
      return;
    }
    const [y, m, d] = parts;
    this.fecha = new Date(y, m - 1, d);
    this.initializeDateFields();
    this.loadBirthdays(this.fecha_cumple);
  }

  ngOnInit() {
    const currentUser = this.auth.getUser();
    this.showDocColumn = this.auth.isStaff();
    this.fecha = new Date();
    this.initializeDateFields();
    this.loadHouses();
    this.loadBirthdays(this.fecha_cumple);
  }

  private loadHouses() {
    this.entranceService.getAllHouses().subscribe((res: any) => {
      const list = Array.isArray(res) ? res : res?.data ?? [];
      this.houses = list;
    });
  }

  /** Devuelve el texto de domicilio (Mz / Lt) para una persona, usando house si hace falta. */
  getHouseDisplay(person: User | any): string {
    const mz = person?.block_house ?? null;
    const lt = person?.lot ?? null;
    if (mz != null && mz !== '' && lt != null && lt !== '') {
      return `Mz: ${mz}  Lt: ${lt}`;
    }
    const houseId = person?.house_id;
    if (houseId != null && this.houses.length) {
      const h = this.houses.find((x: any) => (x as any).house_id === houseId || x.house_id === houseId);
      if (h) {
        return `Mz: ${h.block_house ?? '-'}  Lt: ${h.lot != null ? h.lot : '-'}`;
      }
    }
    return 'Mz: -  Lt: -';
  }

  /** Abre WhatsApp para enviar un mensaje de feliz cumpleaños a la persona. */
  felicitar(person: User | any) {
    const nombre = [person?.first_name].filter(Boolean).join(' ').trim() || 'Vecin@';
    const genero = (person?.gender ?? '').toString().toUpperCase();
    const tratamiento = genero.includes('FEMENINO') ? 'Vecina' : genero.includes('MASCULINO') ? 'Vecino' : null;
    const msg = tratamiento
      ? `¡Feliz cumpleaños ${tratamiento} ${nombre}! \u{1F382}\u{1F389} Que tengas un excelente día.`
      : `¡Feliz cumpleaños, ${nombre}! \u{1F382}\u{1F389} Que tengas un excelente día.`;
    const textEnc = encodeURIComponent(msg);
    const cel = (person?.cel_number ?? '').toString().replace(/\D/g, '');
    let url: string;
    if (cel.length >= 9) {
      const num = cel.length === 9 && cel.startsWith('9') ? '51' + cel : cel.startsWith('51') ? cel : '51' + cel;
      url = `https://wa.me/${num}?text=${textEnc}`;
    } else {
      url = `https://wa.me/?text=${textEnc}`;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  onSubmit() {}

  onPageSizeChange(): void {
    this.currentPage = 1;
    this.expandedBirthdayRowId = null;
  }

  previousPage(): void {
    if (this.currentPage > 1) {
      this.currentPage -= 1;
      this.expandedBirthdayRowId = null;
    }
  }

  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage += 1;
      this.expandedBirthdayRowId = null;
    }
  }

  getBirthdayRowId(a: User): string | number {
    const id = Number((a as { user_id?: number }).user_id || 0);
    return id > 0 ? id : a.doc_number;
  }

  isBirthdayRowOpen(a: User): boolean {
    return isExpandableRowOpen(this.expandedBirthdayRowId, this.getBirthdayRowId(a));
  }

  toggleBirthdayRow(a: User): void {
    this.expandedBirthdayRowId = toggleExpandableRow(
      this.expandedBirthdayRowId,
      this.getBirthdayRowId(a)
    );
  }

  onBirthdaySearchChange(): void {
    this.currentPage = 1;
    this.expandedBirthdayRowId = null;
  }

  private initializeDateFields() {
    this.year = this.fecha.getFullYear();
    this.month = (this.fecha.getMonth() + 1).toString().padStart(2, '0');
    this.day = this.fecha.getDate().toString().padStart(2, '0');

    this.fecha_cumple = `${this.month}-${this.day}`;
    const opciones: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'long' };
    this.fechaString = this.fecha.toLocaleDateString('es-ES', opciones);
  }

  /**
   * Obtiene mes-día (MM-DD) desde una fecha, interpretando siempre como fecha local
   * para evitar desfases por UTC (ej. "2000-04-06" debe ser 6 de abril en cualquier zona horaria).
   */
  private getMonthDayFromBirthDate(birthDate: string | Date | null | undefined): string | null {
    if (birthDate == null) return null;
    let d: Date;
    if (typeof birthDate === 'string') {
      const match = birthDate.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (match) {
        const [, y, m, day] = match;
        d = new Date(parseInt(y!, 10), parseInt(m!, 10) - 1, parseInt(day!, 10));
      } else {
        d = new Date(birthDate);
      }
    } else {
      d = birthDate;
    }
    if (isNaN(d.getTime())) return null;
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${m}-${day}`;
  }

  private loadBirthdays(fecha_cumple: string) {
    this.usersServices.getPersonsByBirthday(fecha_cumple).subscribe((res: any) => {
      const rawList = Array.isArray(res) ? res : res?.data ?? [];
      this.neighbors = rawList.filter((p: any) => {
        const md = this.getMonthDayFromBirthDate(p.birth_date);
        return md === fecha_cumple;
      });
      this.currentPage = 1;
    });
  }
}

@Component({
  selector: 'dialog-datos',
  templateUrl: 'dialog-datos.html',
  styleUrls: ['./birthday.component.css'],
})
export class DialogDatos implements OnInit {
  constructor(
    public dialogRef: MatDialogRef<DialogDatos>,
    @Inject(MAT_DIALOG_DATA) public data: Item,
    private fb: FormBuilder,
    private toastr: ToastrService
  ) {}

  ngOnInit(): void {}

  onNoClick(): void {
    this.dialogRef.close();
  }

  onKeyUpEvent(event: any) {}

  btnSave() {
    this.data.area = this.data.area.toUpperCase();
    this.data.codigo = this.data.codigo.toUpperCase();
    this.data.descripcion = this.data.descripcion.toUpperCase();
    this.data.estado = this.data.estado.toUpperCase();
    this.data.fabricante = this.data.fabricante.toUpperCase();
    this.data.lugar = this.data.lugar.toUpperCase();
    this.data.marca = this.data.marca.toUpperCase();
    this.data.modelo = this.data.modelo.toUpperCase();
    this.data.numero = this.data.numero.toUpperCase();
    this.data.observacion = this.data.observacion.toUpperCase();
    this.data.propietario = this.data.propietario.toUpperCase();
    this.data.registro = this.data.registro.toUpperCase();
    this.data.serie = this.data.serie.toUpperCase();
    this.data.tipo = this.data.tipo.toUpperCase();
    this.data.ubicacion = this.data.ubicacion.toUpperCase();
    this.dialogRef.close(this.data);
  }
}
