import { Component, OnInit } from '@angular/core';

import { User } from '../user';
import { UsersService } from '../users.service';
import { Router } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { AuthService } from '../auth.service';
import { EntranceService } from '../entrance.service';
import { initFlowbite } from 'flowbite';
import { AccessLogService } from '../access-log.service';
import { ReservationsService } from '../reservations.service';
import { ApiService } from '../api.service';
import { forkJoin, Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import {
  todayYmdInAppTimeZone,
  addDaysYmd,
  mondayOfWeekYmd,
} from '../app-date.util';
import { compressImageFile, MOBILE_PHOTO_COMPRESS } from '../shared/compress-image';


@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit {

  actualUser: User;

  /** Staff: filtro opcional por punto de acceso (null = todos). */
  staffAccessPointId: number | null = null;
  staffAccessPointOptions: { id: number; label: string }[] = [];

  /** Staff: cumpleaños del mes (persons?fecha_cumple=-MM-) */
  staffBirthdaysMonth: any[] = [];
  loadingStaffBirthdays = false;
  /** Vecino: cumpleaños de la semana (Lun–Dom) con énfasis ayer/hoy/mañana */
  neighborWeekBirthdays: any[] = [];
  loadingNeighborBirthdays = false;
  /** Dashboard: ingresos (movement INGRESO) hoy — mismo origen que Historial, todos los puntos */
  accessLogsCountToday = 0;
  /** Salidas registradas hoy (EGRESO + visitas externas con temp_exit_time). */
  exitsTodayCount = 0;
  /** Visitas externas que excedieron tiempo autorizado hoy. */
  stayExceededTodayCount = 0;
  /** Promedio de permanencia (min) de salidas cerradas hoy. */
  avgPermanenceMinutesToday: number | null = null;
  loadingLogs = false;
  /** Dashboard: últimos ingresos del día (INGRESO) */
  lastAccessLogs: any[] = [];
  /** Dashboard: total casas registradas */
  housesCount: number | null = null;
  /** Dashboard: ingresos de personas hoy (tipo PERSONA, movement INGRESO) */
  personsTodayCount = 0;
  /** Dashboard: ingresos de vehículos hoy (tipo VEHÍCULO, movement INGRESO) */
  vehiclesTodayCount = 0;
  /** Primer punto con controla_aforo (prioridad nombre "piscina") */
  poolOccupancy: { name: string; current: number; max: number | null; percent: number | null } | null = null;
  loadingPool = false;
  /** Dashboard: alertas activas (restringidos/observados); sin endpoint por ahora */
  activeAlerts: any[] = [];
  /** Dashboard: ingresos por hora para gráfico (opcional) */
  chartIngresosPorHora: { label: string; value: number; count: number }[] = [];
  ingresosHoraTotalCount = 0;
  /** Staff: pastel ingresos por categoría de persona */
  distributionVisitors: { label: string; percent: number; count: number; colorClass: string }[] = [];
  /** Dashboard: próximas reservas (primeras 5) */
  upcomingReservations: any[] = [];

  isAdmin = false;
  loadingSummary = false;
  usersCount: number | null = null;
  registeredHousesCount: number | null = null;
  registeredVehiclesCount: number | null = null;
  petsCount: number | null = null;

  /** Vecino: métricas del día (historial filtrado por sus casas en API) */
  neighborVisitsTodayCount = 0;
  neighborLastVisitLogs: any[] = [];
  neighborUpcomingReservations: any[] = [];

  hourChartPreset: 'today' | 'yesterday' | 'week' = 'today';
  loadingHourChart = false;
  dayTrendStart = '';
  dayTrendEnd = '';
  chartIngresosPorDia: { label: string; count: number; value: number }[] = [];
  loadingDayTrend = false;
  uploadingNeighborPhoto = false;
  compressingNeighborPhoto = false;
  showProfilePhotoPicker = false;

  constructor(
    private router: Router,
    private toastr: ToastrService,
    public auth: AuthService,
    private userService: UsersService,
    private entranceService: EntranceService,
    private accessLogService: AccessLogService,
    private reservationsService: ReservationsService,
    private api: ApiService,
  ) { }

  get isStaffView(): boolean {
    return this.auth.isStaff();
  }

  get isNeighborView(): boolean {
    return this.auth.isNeighbor();
  }

  get showRegistrationStats(): boolean {
    return this.isStaffView || this.isNeighborView;
  }

  get neighborHouseLabel(): string {
    const u = this.actualUser;
    if (!u) {
      return '—';
    }
    const mz = (u.block_house ?? '').toString().trim();
    const lt = u.lot != null && String(u.lot).trim() !== '' ? String(u.lot) : '';
    if (mz && lt) {
      return `Mz:${mz} Lt:${lt}`;
    }
    if (mz) {
      return `Mz:${mz}`;
    }
    return '—';
  }

  get distributionVisitorsTotal(): number {
    return (this.distributionVisitors || []).reduce((s, d) => s + (d.count || 0), 0);
  }

  /** Altura en px para barras del gráfico por hora (evita height.% sin contenedor con altura fija). */
  ingressBarHeightPx(bar: { count: number; value: number }): number {
    if (!bar.count) {
      return 0;
    }
    const maxBarPx = 152;
    return Math.max(6, Math.round((bar.value / 100) * maxBarPx));
  }

  /** Anillo tipo donut con conic-gradient según conteos por categoría. */
  distributionDonutStyle(): Record<string, string> | null {
    const total = this.distributionVisitorsTotal;
    if (!total) {
      return null;
    }
    const colorByClass: Record<string, string> = {
      'bg-emerald-500': '#10b981',
      'bg-sky-500': '#0ea5e9',
      'bg-amber-500': '#f59e0b',
      'bg-violet-500': '#8b5cf6',
    };
    let acc = 0;
    const stops: string[] = [];
    for (const d of this.distributionVisitors) {
      if (!d.count) {
        continue;
      }
      const pct = (d.count / total) * 100;
      const color = colorByClass[d.colorClass] ?? '#94a3b8';
      stops.push(`${color} ${acc}% ${acc + pct}%`);
      acc += pct;
    }
    if (!stops.length) {
      return null;
    }
    return { background: `conic-gradient(${stops.join(', ')})` };
  }

  /** Obtiene mes-día (MM-DD) desde birth_date para filtrar cumpleaños. */
  private getMonthDayFromBirthDate(birthDate: string | null | undefined): string | null {
    if (!birthDate) return null;
    const d = typeof birthDate === 'string' && birthDate.includes('T') ? new Date(birthDate) : new Date(birthDate + (birthDate.includes('-') && birthDate.length === 10 ? 'T12:00:00' : ''));
    if (isNaN(d.getTime())) return null;
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${m}-${day}`;
  }

  /** Misma forma que Historial: array o { data }. */
  private unwrapHistoryRows(raw: unknown): any[] {
    if (Array.isArray(raw)) {
      return raw;
    }
    if (raw && typeof raw === 'object' && 'data' in raw && Array.isArray((raw as { data: unknown }).data)) {
      return (raw as { data: any[] }).data;
    }
    return [];
  }

  /** Query `access_point` para historial unificado (staff). */
  private staffHistoryAccessPointParam(): string | undefined {
    if (this.staffAccessPointId == null || this.staffAccessPointId <= 0) {
      return undefined;
    }
    return String(this.staffAccessPointId);
  }

  get staffAccessPointFilterLabel(): string {
    if (this.staffAccessPointId == null) {
      return 'Todos los puntos';
    }
    const match = this.staffAccessPointOptions.find((p) => p.id === this.staffAccessPointId);
    return match?.label ?? 'Punto seleccionado';
  }

  private loadStaffAccessPointOptions(): void {
    this.entranceService.getAllAccessPoints().subscribe({
      next: (raw: unknown) => {
        const list = Array.isArray(raw) ? raw : [];
        this.staffAccessPointOptions = list
          .map((p: Record<string, unknown>) => ({
            id: Number(p['id'] ?? p['ap_id'] ?? 0),
            label: String(p['name'] ?? p['ap_location'] ?? p['location'] ?? `Punto ${p['id'] ?? ''}`),
          }))
          .filter((o) => o.id > 0);
      },
      error: () => {
        this.staffAccessPointOptions = [];
      },
    });
  }

  private reloadTodayMetrics(todayStr: string): void {
    const ap = this.isStaffView ? this.staffHistoryAccessPointParam() : undefined;
    this.loadingLogs = true;
    if (this.isStaffView && this.hourChartPreset === 'today') {
      this.loadingHourChart = true;
    }
    this.accessLogService.getHistoryByRange(todayStr, todayStr, ap, { limit: 500, offset: 0 }).subscribe({
      next: (raw: unknown) => {
        const list = this.unwrapHistoryRows(raw);
        const ingreso = list.filter((r: any) => this.rowIsIngressMovement(r));
        this.accessLogsCountToday = ingreso.length;
        this.exitsTodayCount = this.countExitsToday(list);
        this.stayExceededTodayCount = list.filter(
          (r: any) => Number(r?.stay_exceeded) === 1 && this.isRowFromToday(r, todayStr)
        ).length;
        this.avgPermanenceMinutesToday = this.computeAvgPermanenceClosedToday(list, todayStr);
        this.personsTodayCount = ingreso.filter(
          (r: any) => String(r?.type ?? '').toUpperCase() === 'PERSONA'
        ).length;
        const isVehicleType = (t: unknown) => {
          const x = String(t ?? '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toUpperCase();
          return x === 'VEHICULO';
        };
        this.vehiclesTodayCount = ingreso.filter((r: any) => isVehicleType(r?.type)).length;

        if (this.isStaffView) {
          this.buildDistributionFromRows(ingreso);
        }

        if (this.isNeighborView) {
          this.neighborVisitsTodayCount = ingreso.length;
          const visitRows = ingreso
            .filter((r: any) => this.isNeighborVisitRow(r))
            .sort((a: any, b: any) => {
              const ta = new Date(String(a?.date_entry ?? a?.created_at ?? 0)).getTime();
              const tb = new Date(String(b?.date_entry ?? b?.created_at ?? 0)).getTime();
              return tb - ta;
            });
          this.neighborLastVisitLogs = visitRows.slice(0, 8);
        }

        if (this.isStaffView) {
          const sorted = [...ingreso].sort((a: any, b: any) => {
            const ta = new Date(String(a?.date_entry ?? a?.created_at ?? 0)).getTime();
            const tb = new Date(String(b?.date_entry ?? b?.created_at ?? 0)).getTime();
            return tb - ta;
          });
          this.lastAccessLogs = sorted.slice(0, 8);
          if (this.hourChartPreset === 'today') {
            this.applyHourBucketsFromRows(ingreso);
          }
        }
        this.loadingLogs = false;
      },
      error: () => {
        this.loadingLogs = false;
        if (this.isStaffView && this.hourChartPreset === 'today') {
          this.loadingHourChart = false;
          this.chartIngresosPorHora = [];
          this.ingresosHoraTotalCount = 0;
        }
      },
    });
  }

  onStaffAccessPointFilterChange(): void {
    if (!this.isStaffView) {
      return;
    }
    const todayStr = todayYmdInAppTimeZone();
    this.reloadTodayMetrics(todayStr);
    if (this.hourChartPreset !== 'today') {
      this.reloadHourIngresos();
    }
    this.reloadDayTrendAndAlerts(todayStr);
  }

  private loadDashboardData(): void {
    const todayStr = todayYmdInAppTimeZone();
    const today = new Date(todayStr + 'T12:00:00');

    this.dayTrendEnd = todayStr;
    this.dayTrendStart = addDaysYmd(todayStr, -13);

    if (this.isStaffView) {
      const mm = todayStr.slice(5, 7);
      this.loadStaffMonthBirthdays(mm);
      if (this.hourChartPreset !== 'today') {
        this.reloadHourIngresos();
      }
      this.reloadDayTrendAndAlerts(todayStr);
    }

    if (this.isNeighborView) {
      this.loadNeighborWeekBirthdays(todayStr);
      const hid = Number(this.actualUser?.house_id ?? 0);
      if (hid > 0) {
        const endR = addDaysYmd(todayStr, 90);
        this.reservationsService
          .getReservations({ house_id: hid, start_date: todayStr, end_date: endR, limit: 20 })
          .subscribe({
            next: (res: any) => {
              const list = res?.data && Array.isArray(res.data) ? res.data : [];
              const sorted = [...list].sort((a: any, b: any) =>
                String(a.reservation_date ?? '').localeCompare(String(b.reservation_date ?? ''))
              );
              this.neighborUpcomingReservations = sorted.slice(0, 8);
            },
            error: () => {
              this.neighborUpcomingReservations = [];
            },
          });
      } else {
        this.neighborUpcomingReservations = [];
      }
    }

    this.reloadTodayMetrics(todayStr);

    if (this.isStaffView || this.isNeighborView) {
      this.loadingPool = true;
      this.entranceService.getAllAccessPoints().subscribe({
        next: (pts: any) => {
          const arr = Array.isArray(pts) ? pts : [];
          const byPoolName = arr.find(
            (p: any) => Number(p?.controla_aforo) === 1 && /piscina/i.test(String(p?.name ?? ''))
          );
          const anyAforo = arr.find((p: any) => Number(p?.controla_aforo) === 1);
          const pool = byPoolName || anyAforo || null;
          if (pool) {
            const cur = Number(pool.current_capacity ?? 0);
            const maxRaw = pool.max_capacity;
            const max = maxRaw != null && maxRaw !== '' ? Number(maxRaw) : null;
            this.poolOccupancy = {
              name: String(pool.name ?? 'Piscina'),
              current: cur,
              max,
              percent: max != null && max > 0 ? Math.min(100, Math.round((cur / max) * 100)) : null,
            };
          } else {
            this.poolOccupancy = null;
          }
          this.loadingPool = false;
        },
        error: () => {
          this.poolOccupancy = null;
          this.loadingPool = false;
        },
      });
    } else {
      this.poolOccupancy = null;
      this.loadingPool = false;
    }

    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + 30);
    const endStr =
      endDate.getFullYear() +
      '-' +
      String(endDate.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(endDate.getDate()).padStart(2, '0');
    if (this.isStaffView) {
      this.reservationsService.getByDateRange(todayStr, endStr).subscribe({
        next: (list: any[]) => {
          const sorted = [...(list || [])].sort((a: any, b: any) =>
            String(a.reservation_date ?? '').localeCompare(String(b.reservation_date ?? ''))
          );
          this.upcomingReservations = sorted.slice(0, 6);
        },
      });
    }
  }

  private loadRegistrationSummary(): void {
    if (!this.showRegistrationStats) {
      return;
    }
    this.loadingSummary = true;
    this.api.getRaw('api/v1/catalog/dashboard-summary').subscribe({
      next: (res: any) => {
        const d = res?.data ?? res;
        this.usersCount = d?.users_count ?? null;
        this.housesCount = d?.houses_total ?? null;
        this.registeredHousesCount = d?.houses_registered ?? null;
        this.registeredVehiclesCount = d?.vehicles_count ?? null;
        this.petsCount = d?.pets_count ?? null;
        this.loadingSummary = false;
      },
      error: () => {
        this.loadingSummary = false;
        this.usersCount = null;
        this.housesCount = null;
        this.registeredHousesCount = null;
        this.registeredVehiclesCount = null;
        this.petsCount = null;
      },
    });
  }

  private loadStaffMonthBirthdays(mm: string): void {
    this.loadingStaffBirthdays = true;
    this.userService.getPersons({ fecha_cumple: `-${mm}-` }).subscribe({
      next: (res: any) => {
        const raw = res?.data && Array.isArray(res.data) ? res.data : Array.isArray(res) ? res : [];
        const sorted = [...raw].sort((a: any, b: any) =>
          String(a.birth_date ?? '').localeCompare(String(b.birth_date ?? ''))
        );
        this.staffBirthdaysMonth = sorted.slice(0, 48);
        this.loadingStaffBirthdays = false;
      },
      error: () => {
        this.loadingStaffBirthdays = false;
        this.staffBirthdaysMonth = [];
      },
    });
  }

  private loadNeighborWeekBirthdays(todayStr: string): void {
    this.loadingNeighborBirthdays = true;
    const mon = mondayOfWeekYmd(todayStr);
    const yYesterday = addDaysYmd(todayStr, -1);
    const yTomorrow = addDaysYmd(todayStr, 1);
    const dowShort = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    const reqs: Observable<any>[] = [];
    const meta: { ymd: string; label: string }[] = [];
    for (let i = 0; i < 7; i++) {
      const ymd = addDaysYmd(mon, i);
      const mmdd = `${ymd.slice(5, 7)}-${ymd.slice(8, 10)}`;
      let label = dowShort[i] ?? '';
      if (ymd === todayStr) {
        label = 'Hoy';
      } else if (ymd === yYesterday) {
        label = 'Ayer';
      } else if (ymd === yTomorrow) {
        label = 'Mañana';
      }
      meta.push({ ymd, label });
      reqs.push(
        this.userService.getPersonsByBirthday(mmdd).pipe(
          map((r: any) => {
            const raw = r?.data && Array.isArray(r.data) ? r.data : Array.isArray(r) ? r : [];
            return raw.map((p: any) => ({ ...p, dayLabel: label, sortYmd: ymd }));
          }),
          catchError(() => of([]))
        )
      );
    }
    forkJoin(reqs).subscribe({
      next: (arrays: any[][]) => {
        const merged = ([] as any[]).concat(...arrays);
        merged.sort((a, b) => String(a.sortYmd).localeCompare(String(b.sortYmd)));
        this.neighborWeekBirthdays = merged.slice(0, 32);
        this.loadingNeighborBirthdays = false;
      },
      error: () => {
        this.loadingNeighborBirthdays = false;
        this.neighborWeekBirthdays = [];
      },
    });
  }

  private loadStaffAlerts(todayStr: string): void {
    this.reloadDayTrendAndAlerts(todayStr);
  }

  /** Un solo fetch de ~14 días: tendencia diaria + alertas (últimos 7). */
  private reloadDayTrendAndAlerts(todayStr?: string): void {
    if (!this.isStaffView) {
      return;
    }
    const end = this.dayTrendEnd || todayStr || todayYmdInAppTimeZone();
    const start = this.dayTrendStart || addDaysYmd(end, -13);
    if (!start || !end || start > end) {
      this.toastr.warning('Indica un rango de fechas válido (desde ≤ hasta).');
      return;
    }
    this.loadingDayTrend = true;
    this.accessLogService
      .getHistoryByRange(start, end, this.staffHistoryAccessPointParam(), { limit: 500, offset: 0 })
      .subscribe({
        next: (raw: unknown) => {
          const list = this.unwrapHistoryRows(raw);
          const ingreso = list.filter((r: any) => this.rowIsIngressMovement(r));

          const byDay = new Map<string, number>();
          for (const r of ingreso) {
            const ds = String(r?.date_entry ?? r?.created_at ?? '').slice(0, 10);
            if (/^\d{4}-\d{2}-\d{2}$/.test(ds)) {
              byDay.set(ds, (byDay.get(ds) || 0) + 1);
            }
          }
          const keys = [...byDay.keys()].sort();
          const max = Math.max(1, ...keys.map((k) => byDay.get(k) || 0));
          this.chartIngresosPorDia = keys.map((k) => {
            const c = byDay.get(k) || 0;
            return { label: k, count: c, value: Math.round((c / max) * 100) };
          });
          this.loadingDayTrend = false;

          const alertFrom = addDaysYmd(end, -7);
          const rows = ingreso.filter((r: any) => {
            const ds = String(r?.date_entry ?? r?.created_at ?? '').slice(0, 10);
            return (
              ds >= alertFrom &&
              String(r?.type ?? '').toUpperCase() === 'PERSONA' &&
              this.isAlertIngressObs(r?.obs)
            );
          });
          rows.sort((a: any, b: any) => {
            const ta = new Date(String(a?.date_entry ?? 0)).getTime();
            const tb = new Date(String(b?.date_entry ?? 0)).getTime();
            return tb - ta;
          });
          this.activeAlerts = rows.slice(0, 5).map((r: any) => ({
            name: r.name,
            doc_number: r.doc_number,
            status: r.obs,
            at: r.date_entry,
          }));
        },
        error: () => {
          this.loadingDayTrend = false;
          this.chartIngresosPorDia = [];
          this.activeAlerts = [];
        },
      });
  }

  /**
   * Solo ingresos con estado de validación / observación explícitamente de riesgo.
   * Evita tratar como alerta textos libres o estados permitidos (p. ej. notas de cumpleaños).
   */
  private isAlertIngressObs(obs: unknown): boolean {
    const raw = String(obs ?? '').trim();
    if (!raw || raw === '—' || raw === '-') {
      return false;
    }
    const u = raw.toUpperCase();
    const risk = [
      'DENEGADO',
      'OBSERVADO',
      'RESTRINGIDO',
      'RECHAZADO',
      'NO PERMITIDO',
      'NO AUTORIZADO',
      'BLOQUEADO',
    ];
    return risk.some((k) => u === k || u.startsWith(k + ' ') || u.startsWith(k + ':') || u.includes(' ' + k));
  }

  /** INGRESO/EGRESO viene en `movement_type` (columna al.type en BD). */
  private rowIsIngressMovement(r: any): boolean {
    const m = String(r?.movement_type ?? r?.MOVEMENT_TYPE ?? '').trim().toUpperCase();
    return m === 'INGRESO';
  }

  private isRowFromToday(row: any, todayStr: string): boolean {
    const ds = String(row?.date_entry ?? row?.created_at ?? '').slice(0, 10);
    return ds === todayStr;
  }

  private countExitsToday(rows: any[]): number {
    let count = 0;
    for (const r of rows) {
      if (String(r?.movement_type ?? '').toUpperCase() === 'EGRESO') {
        count++;
        continue;
      }
      const exit = r?.date_exit;
      if (exit != null && exit !== '') {
        count++;
      }
    }
    return count;
  }

  private computeAvgPermanenceClosedToday(rows: any[], todayStr: string): number | null {
    const mins: number[] = [];
    for (const r of rows) {
      if (!this.isRowFromToday(r, todayStr)) {
        continue;
      }
      const exit = r?.date_exit;
      if (exit == null || exit === '') {
        continue;
      }
      const entry = new Date(String(r?.date_entry ?? ''));
      const exitDt = new Date(String(exit));
      if (Number.isNaN(entry.getTime()) || Number.isNaN(exitDt.getTime())) {
        continue;
      }
      mins.push(Math.max(0, Math.round((exitDt.getTime() - entry.getTime()) / 60000)));
    }
    if (!mins.length) {
      return null;
    }
    return Math.round(mins.reduce((a, b) => a + b, 0) / mins.length);
  }

  private isNeighborVisitRow(r: any): boolean {
    if (!this.rowIsIngressMovement(r)) {
      return false;
    }
    const id = Number(r?.id ?? 0);
    if (id < 0) {
      return true;
    }
    const pc = String(r?.person_category ?? '').toUpperCase();
    return pc === 'INVITADO' || pc === 'VISITA_TEMPORAL' || pc === 'VISITA_EXTERNA';
  }

  private buildDistributionFromRows(ingreso: any[]): void {
    let residentes = 0;
    let inquilinos = 0;
    let visitas = 0;
    let externas = 0;
    for (const r of ingreso) {
      if (!this.rowIsIngressMovement(r)) {
        continue;
      }
      const id = Number(r?.id ?? 0);
      const pc = String(r?.person_category ?? '').toUpperCase();
      if (id < 0 || pc === 'VISITA_EXTERNA') {
        externas++;
        continue;
      }
      if (String(r?.type ?? '').toUpperCase() !== 'PERSONA') {
        continue;
      }
      if (pc === 'INQUILINO') {
        inquilinos++;
        continue;
      }
      if (pc === 'INVITADO' || pc === 'VISITA_TEMPORAL') {
        visitas++;
        continue;
      }
      residentes++;
    }
    const total = residentes + inquilinos + visitas + externas;
    const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
    this.distributionVisitors = [
      {
        label: 'Residentes / propietarios',
        count: residentes,
        percent: pct(residentes),
        colorClass: 'bg-emerald-500',
      },
      {
        label: 'Inquilinos',
        count: inquilinos,
        percent: pct(inquilinos),
        colorClass: 'bg-sky-500',
      },
      {
        label: 'Visitas',
        count: visitas,
        percent: pct(visitas),
        colorClass: 'bg-amber-500',
      },
      {
        label: 'Visitas externas',
        count: externas,
        percent: pct(externas),
        colorClass: 'bg-violet-500',
      },
    ];
  }

  private hourFromHistoryRow(r: any): number {
    const he = String(r?.hour_entrance ?? r?.HOUR_ENTRANCE ?? '').trim();
    const m1 = he.match(/^(\d{1,2})/);
    if (m1) {
      return Math.min(23, Math.max(0, parseInt(m1[1], 10)));
    }
    const s = String(r?.date_entry ?? r?.created_at ?? r?.DATE_ENTRY ?? '').trim();
    const m2 = s.match(/(?:T|\s)(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m2) {
      return Math.min(23, Math.max(0, parseInt(m2[1], 10)));
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? 0 : d.getHours();
  }

  private applyHourBucketsFromRows(ingreso: any[]): void {
    const buckets = new Array(24).fill(0);
    for (const r of ingreso) {
      const h = this.hourFromHistoryRow(r);
      if (h >= 0 && h < 24) {
        buckets[h]++;
      }
    }
    this.ingresosHoraTotalCount = buckets.reduce((a, b) => a + b, 0);
    const max = Math.max(...buckets, 1);
    this.chartIngresosPorHora = buckets.map((c, h) => ({
      label: `${h}h`,
      count: c,
      value: max > 0 ? Math.round((c / max) * 100) : 0,
    }));
    this.loadingHourChart = false;
  }

  reloadHourIngresos(): void {
    if (!this.isStaffView) {
      return;
    }
    const todayStr = todayYmdInAppTimeZone();
    if (this.hourChartPreset === 'today') {
      this.reloadTodayMetrics(todayStr);
      return;
    }
    let start: string;
    let end: string;
    if (this.hourChartPreset === 'yesterday') {
      start = end = addDaysYmd(todayStr, -1);
    } else {
      start = mondayOfWeekYmd(todayStr);
      end = todayStr;
    }
    this.loadingHourChart = true;
    this.accessLogService
      .getHistoryByRange(start, end, this.staffHistoryAccessPointParam(), { limit: 500, offset: 0 })
      .subscribe({
        next: (raw: unknown) => {
          const list = this.unwrapHistoryRows(raw).filter((r: any) => this.rowIsIngressMovement(r));
          this.applyHourBucketsFromRows(list);
        },
        error: () => {
          this.loadingHourChart = false;
          this.chartIngresosPorHora = [];
          this.ingresosHoraTotalCount = 0;
        },
      });
  }

  reloadDayTrend(): void {
    this.reloadDayTrendAndAlerts();
  }

  onNeighborPhotoSelected(file: File): void {
    void this.uploadNeighborProfilePhoto(file);
  }

  private async uploadNeighborProfilePhoto(file: File): Promise<void> {
    if (!file?.type.startsWith('image/')) {
      this.toastr.warning('Seleccione una imagen (JPG, PNG o GIF).');
      return;
    }

    this.compressingNeighborPhoto = true;
    let ready = file;
    try {
      ready = await compressImageFile(file, MOBILE_PHOTO_COMPRESS);
    } catch {
      this.toastr.warning('No se pudo optimizar la foto; se usará el original.');
    }
    this.compressingNeighborPhoto = false;
    this.uploadingNeighborPhoto = true;
    this.api.uploadProfilePhoto(ready, { skipCompress: true }).subscribe({
      next: (res: any) => {
        this.uploadingNeighborPhoto = false;
        const user = res?.data;
        if (user) {
          this.auth.updateCurrentUser(user);
          this.actualUser = user;
          this.toastr.success('Foto de perfil actualizada.');
          this.closeProfilePhotoPicker();
        }
      },
      error: () => {
        this.uploadingNeighborPhoto = false;
      },
    });
  }

  triggerNeighborPhotoInput(): void {
    this.showProfilePhotoPicker = true;
  }

  closeProfilePhotoPicker(): void {
    this.showProfilePhotoPicker = false;
  }

  isProfilePhotoBusy(): boolean {
    return this.compressingNeighborPhoto || this.uploadingNeighborPhoto;
  }

  ngOnInit() {
    initFlowbite();

    if (this.auth.checkToken('user_id')) {
      this.userService.getUserById(Number(this.auth.getTokenItem('user_id'))).subscribe((user: User) => {
        this.actualUser = user;
        this.isAdmin = (this.actualUser?.role_system || '').toUpperCase() === 'ADMINISTRADOR';
        if (this.isStaffView) {
          this.loadStaffAccessPointOptions();
        }
        this.loadDashboardData();
        if (this.showRegistrationStats) {
          this.loadRegistrationSummary();
        }
      });
    } else {
      this.router.navigateByUrl('/login');
    }
  }

}
