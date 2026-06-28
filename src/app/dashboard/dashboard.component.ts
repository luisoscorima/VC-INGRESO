
import { Component, ElementRef, HostListener, Inject, OnInit, QueryList, ViewChild, ViewChildren, Renderer2 } from '@angular/core';
import * as XLSX from 'xlsx';

import { User } from '../user';
import { UsersService } from '../users.service';


import { MatDialog, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ThemePalette, } from '@angular/material/core';
import { FormBuilder, FormControl } from '@angular/forms';
import { Router } from '@angular/router';
import { Item } from '../item';
import { MatTableDataSource } from '@angular/material/table';
import { MatPaginator } from '@angular/material/paginator';
import { MatSort, MAT_SORT_HEADER_INTL_PROVIDER_FACTORY } from '@angular/material/sort';
import { Sale } from '../sale';
import { ToastrService } from 'ngx-toastr';
import { Product } from '../product';
import { AuthService } from '../auth.service';
import { Collaborator } from '../collaborator';
import { AccessPoint } from '../accessPoint';
import { EntranceService } from '../entrance.service';
import { Console } from 'console';
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


@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit {

  barChartData = {
    labels: ['January', 'February', 'March', 'April', 'May'],
    datasets: [
      {
        data: [65, 59, 80, 81, 56],
        label: 'Monthly Sales',
        backgroundColor: '#42A5F5'
      }
    ]
  };

  barChartOptions = {
    responsive: true,
    scales: {
      x: { beginAtZero: true },
      y: { beginAtZero: true }
    }
  };

  lineChartData = {
    labels: [],
    datasets: [
      {
        label: "Registros de ingreso",
        data: [],
        backgroundColor: 'transparent',
        borderColor: '#0d6efd',
        lineTension: 0.4,
        borderWidth: 1.5,
      }
    ]
  };
  
  lineChartOptions = {
    responsive: true,
    scales: {
      x: { beginAtZero: true },
      y: { beginAtZero: true }
    }
  };

  doughnutChartData = {
    labels: ['Red', 'Blue', 'Yellow'],
    datasets: [
      {
        data: [300, 50, 100],
        backgroundColor: ['#FF6384', '#36A2EB', '#FFCE56']
      }
    ]
  };
  
  doughnutChartOptions = {
    responsive: true,
    cutoutPercentage: 70, // Controla el tamaño del agujero central
  };

  barChartData2 = {
    labels: ['January', 'February', 'March', 'April', 'May'],
    datasets: [
      {
        data: [65, 59, 80, 81, 56],
        label: 'Monthly Sales',
        backgroundColor: '#42A5F5'
      }
    ]
  };
  
  barChartOptions2 = {
    responsive: true,
    scales: {
      x: { beginAtZero: true },
      y: { beginAtZero: true }
    }
  };

  radarChartData = {
    labels: ['Eating', 'Drinking', 'Sleeping', 'Designing', 'Coding', 'Cycling', 'Running'],
    datasets: [
      {
        label: 'Week 1',
        data: [65, 59, 90, 81, 56, 55, 40],
        backgroundColor: 'rgba(66, 165, 245, 0.2)',
        borderColor: '#42A5F5',
        pointBackgroundColor: '#42A5F5'
      }
    ]
  };
  
  radarChartOptions = {
    responsive: true,
    scales: {
      r: {
        angleLines: {
          display: true
        },
        suggestedMin: 0
      }
    }
  };

  polarAreaChartData = {
    labels: ['Red', 'Green', 'Yellow', 'Blue', 'Purple', 'Orange'],
    datasets: [
      {
        data: [11, 16, 7, 3, 14, 10],
        backgroundColor: ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40']
      }
    ]
  };
  
  polarAreaChartOptions = {
    responsive: true,
    scales: {
      r: {
        angleLines: {
          display: true
        }
      }
    }
  };

  bubbleChartData = {
    datasets: [
      {
        label: 'First dataset',
        data: [{ x: 10, y: 20, r: 15 }, { x: 15, y: 30, r: 10 }, { x: 25, y: 25, r: 5 }],
        backgroundColor: 'rgba(66, 165, 245, 0.5)'
      }
    ]
  };
  
  bubbleChartOptions = {
    responsive: true,
    scales: {
      x: { beginAtZero: true },
      y: { beginAtZero: true }
    }
  };

  scatterChartData = {
    datasets: [
      {
        label: 'Scatter Dataset',
        data: [{ x: 10, y: 20 }, { x: 15, y: 30 }, { x: 25, y: 25 }],
        backgroundColor: 'rgba(66, 165, 245, 0.5)'
      }
    ]
  };
  
  scatterChartOptions = {
    responsive: true,
    scales: {
      x: { type: 'linear', position: 'bottom' },
      y: { type: 'linear', position: 'left' }
    }
  };

  clientes: User[] = [];
  


  dias=['SELECCIONAR','LUNES','MARTES','MIERCOLES','JUEVES','VIERNES','SABADO','DOMINGO'];

  meses=['SELECCIONAR','ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SETIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];


  rowHeightValue;


  mesDisabled;
  diaDisabled;
  fechaDisabled;

  statsIngresosTotal;
  statsIngresosRango;
  statsIngresosPromedioDia;
  edadTop;
  distritoTop;
  horaTop;

  logoSrc;



  actualUser: User;

  accessPoints: AccessPoint[] = [];

  /** Staff: cumpleaños del mes (persons?fecha_cumple=-MM-) */
  staffBirthdaysMonth: any[] = [];
  loadingStaffBirthdays = false;
  /** Vecino: cumpleaños de la semana (Lun–Dom) con énfasis ayer/hoy/mañana */
  neighborWeekBirthdays: any[] = [];
  loadingNeighborBirthdays = false;
  /** Dashboard: ingresos (movement INGRESO) hoy — mismo origen que Historial, todos los puntos */
  accessLogsCountToday = 0;
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

  


  supply_role;

  


  
  typeAforo="ComboChart";
  typeAge="PieChart";
  typeMensual="ComboChart";
  typeAddress="BarChart";
  typeFechas="ComboChart";
  typeHours="BarChart";
  typeHoraWargos="ComboChart";


  optionsAforo = {
    hAxis: {
       title: 'Fecha'
    },
    vAxis:{
       title: 'Ingresos'
    },
    seriesType: 'bar',
    series: {2: {type: 'line'}}
  };

  optionsAge = {
    hAxis: {
       title: 'Cantidad'
    },
    vAxis:{
       title: 'Edad'
    },
    seriesType: 'bar',
    series: {2: {type: 'line'}}
  };

  optionsMensual = {
    hAxis: {
      title: 'Fecha',
    
      textStyle : {
        fontSize: 10 // or the number you want
      },
    },
    vAxis:{
       title: 'Ingresos'
    },
    colors:['#E67E22','#27AE60'],
    
    seriesType: 'bar',
    series: {2: {type: 'line'}}
  };

  optionsHoraWargos = {
    hAxis: {
      title: 'Hora',
      textStyle : {
        fontSize: 10 // or the number you want
      },
    },
    vAxis:{
       title: 'Ingresos'
    },
    colors:['#0c5670','#E67E22'],
    seriesType: 'bar',
    series: {2: {type: 'line'}}
  };

  optionsFechas = {
    hAxis: {
      title: 'Fecha',
      textStyle : {
        fontSize: 10 // or the number you want
      },
    },
    vAxis:{
       title: 'Ingresos'
    },
    seriesType: 'bar',
    series: {2: {type: 'line'}}
  };

  optionsAddress = {
    //width: 300,
    legend: {position: 'none'},
    annotations: {
      textStyle: {
        fontSize:11
      },
   },
    bar: {
      groupWidth: "35%",
      groupHeight: "35%",
    },
    colors:['#884EA0'],
    hAxis: {
      title: 'Ingresos',
      textStyle : {
        fontSize: 15 // or the number you want
      },
    },
    vAxis:{
      title: 'Distrito',
      textStyle : {
        fontSize: 14 // or the number you want
      },
    }
  };

  optionsHours = {
    //width: 300,
    legend: {position: 'none'},
    annotations: {
      textStyle: {
      },
    },
    isStacked: true,
    bar: {
      groupWidth: "60%",
      groupHeight: "120%"
    },
    colors:['#2471A3'],
    hAxis: {
      title: 'Ingresos',
      textStyle : {
        fontSize: 15 // or the number you want
      },
    },
    vAxis:{
      title: 'Hora',
      textStyle : {
        fontSize: 10 // or the number you want
      },
    }
  };


  aforo=[['',0],
  ['',0],
  ['',0],
  ['',0],
  ['',0]
  ];

  address=[
  ];

  mensual=[
  ];

  horaWargos=[
  ];

  fechas=[
  ];

  hours=[
  ];

  age=[
  ];

  columnsAddress=[
  ];

  columnsMensual=[
  ];

  columnsHoraWargos=[
  ];

  columnsFechas=[
  ];

  columnsHours=[
  ];

  columnsAge=[
  ];

  titleAforo='AFORO';
  titleAge='EDAD';
  titleMensual='MENSUAL';
  titleHoraWargos='OCUPACION POR HORA - WARGOS';
  titleAddress='DISTRITOS';
  titleFechas='DIAS';
  titleHours='HORAS';

  fecha;
  fechaAux;

  fecha_hoy;

  aux;

  fecha1;
  fecha2;
  fecha3;
  fecha4;
  fecha5;

  fechaMes;

  fechaInicio;
  fechaFin;

  dia;
  mes;
  anio;

  fechaCmbBoxStart;
  fechaCmbBoxEnd;
  selectedAccessPoint: AccessPoint = new AccessPoint('','','','');
  diaCmbBox;
  mesCmbBox;

  dia_aux;
  mes_aux;
  anio_aux;

  mesActual;
  diaActual;


  dataSourceSale: MatTableDataSource<Item>;

  dataSourceProducts: MatTableDataSource<Product>;


  img = new Image();

  @ViewChildren(MatPaginator) paginator= new QueryList<MatPaginator>();
  @ViewChildren(MatSort) sort= new QueryList<MatSort>();

  @ViewChild('tuTabla', { static: true }) table: ElementRef;


  constructor(
    private dialogo: MatDialog,
    private snackBar: MatSnackBar, private router: Router,
    public dialog: MatDialog,
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
      return `Mz ${mz} — Lt ${lt}`;
    }
    if (mz) {
      return `Mz ${mz}`;
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

  private loadDashboardData(): void {
    const todayStr = todayYmdInAppTimeZone();
    const today = new Date(todayStr + 'T12:00:00');

    this.dayTrendEnd = todayStr;
    this.dayTrendStart = addDaysYmd(todayStr, -13);

    if (this.isStaffView) {
      const mm = todayStr.slice(5, 7);
      this.loadStaffMonthBirthdays(mm);
      this.loadStaffAlerts(todayStr);
      this.reloadHourIngresos();
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

    this.loadingLogs = true;
    this.accessLogService.getHistoryByRange(todayStr, todayStr).subscribe({
      next: (raw: unknown) => {
        const list = this.unwrapHistoryRows(raw);
        const ingreso = list.filter((r: any) => this.rowIsIngressMovement(r));
        this.accessLogsCountToday = ingreso.length;
        this.personsTodayCount = ingreso.filter(
          (r: any) => String(r?.type ?? '').toUpperCase() === 'PERSONA'
        ).length;
        const isVehicleType = (t: unknown) => {
          const x = String(t ?? '').toUpperCase();
          return x === 'VEHÍCULO' || x === 'VEHICULO';
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

        const sorted = [...ingreso].sort((a: any, b: any) => {
          const ta = new Date(String(a?.date_entry ?? a?.created_at ?? 0)).getTime();
          const tb = new Date(String(b?.date_entry ?? b?.created_at ?? 0)).getTime();
          return tb - ta;
        });
        this.lastAccessLogs = sorted.slice(0, 8);
        this.loadingLogs = false;
      },
      error: () => {
        this.loadingLogs = false;
      },
    });

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
      this.reloadDayTrend();
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
    const start = addDaysYmd(todayStr, -7);
    this.accessLogService.getHistoryByRange(start, todayStr).subscribe({
      next: (raw: unknown) => {
        const list = this.unwrapHistoryRows(raw);
        const rows = list.filter(
          (r: any) =>
            this.rowIsIngressMovement(r) &&
            String(r?.type ?? '').toUpperCase() === 'PERSONA' &&
            this.isAlertIngressObs(r?.obs)
        );
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

  reloadHourIngresos(): void {
    if (!this.isStaffView) {
      return;
    }
    const todayStr = todayYmdInAppTimeZone();
    let start: string;
    let end: string;
    if (this.hourChartPreset === 'today') {
      start = end = todayStr;
    } else if (this.hourChartPreset === 'yesterday') {
      start = end = addDaysYmd(todayStr, -1);
    } else {
      start = mondayOfWeekYmd(todayStr);
      end = todayStr;
    }
    this.loadingHourChart = true;
    this.accessLogService.getHistoryByRange(start, end).subscribe({
      next: (raw: unknown) => {
        const list = this.unwrapHistoryRows(raw).filter((r: any) => this.rowIsIngressMovement(r));
        const buckets = new Array(24).fill(0);
        for (const r of list) {
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
      },
      error: () => {
        this.loadingHourChart = false;
        this.chartIngresosPorHora = [];
        this.ingresosHoraTotalCount = 0;
      },
    });
  }

  reloadDayTrend(): void {
    if (!this.isStaffView) {
      return;
    }
    const a = this.dayTrendStart;
    const b = this.dayTrendEnd;
    if (!a || !b || a > b) {
      this.toastr.warning('Indica un rango de fechas válido (desde ≤ hasta).');
      return;
    }
    this.loadingDayTrend = true;
    this.accessLogService.getHistoryByRange(a, b).subscribe({
      next: (raw: unknown) => {
        const list = this.unwrapHistoryRows(raw).filter((r: any) => this.rowIsIngressMovement(r));
        const byDay = new Map<string, number>();
        for (const r of list) {
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
      },
      error: () => {
        this.loadingDayTrend = false;
        this.chartIngresosPorDia = [];
      },
    });
  }

  onNeighborPhotoChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      this.toastr.warning('Seleccione una imagen (JPG, PNG o GIF).');
      input.value = '';
      return;
    }
    this.uploadingNeighborPhoto = true;
    this.api.uploadProfilePhoto(file).subscribe({
      next: (res: any) => {
        this.uploadingNeighborPhoto = false;
        input.value = '';
        const user = res?.data;
        if (user) {
          this.auth.updateCurrentUser(user);
          this.toastr.success('Foto de perfil actualizada.');
        }
      },
      error: () => {
        this.uploadingNeighborPhoto = false;
        input.value = '';
      },
    });
  }

  triggerNeighborPhotoInput(): void {
    const el = document.getElementById('neighbor-dashboard-photo-input') as HTMLInputElement;
    el?.click();
  }

  applyFilterCompra(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.dataSourceSale.filter = filterValue.trim().toLowerCase();

    if (this.dataSourceSale.paginator) {
      this.dataSourceSale.paginator.firstPage();
    }
  }

  applyFilterProductos(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.dataSourceProducts.filter = filterValue.trim().toLowerCase();

    if (this.dataSourceProducts.paginator) {
      this.dataSourceProducts.paginator.firstPage();
    }
  }

  getEntrances(){
    this.accessLogService.getAccessLogs().subscribe((res: any) => {
      const resLogs = Array.isArray(res) ? res : (res?.data ?? []);
      resLogs.forEach((an: any) => {
        this.lineChartData.labels.push(an.date ?? an.FECHA);
        this.lineChartData.datasets[0].data.push(an.count ?? an.AFORO ?? 0);
      });
      console.log(this.lineChartData);
    });
  }



  

  ngOnInit() {

    initFlowbite();

    // Dashboard: gráficos legacy desactivados; por ahora no llamar getEntrances
    // this.getEntrances();

    if (this.auth.checkToken('user_id')) {
      this.mesDisabled = false;
      this.diaDisabled = false;
      this.fechaDisabled = false;

      this.userService.getUserById(Number(this.auth.getTokenItem('user_id'))).subscribe((user: User) => {
        this.actualUser = user;
        this.isAdmin = (this.actualUser?.role_system || '').toUpperCase() === 'ADMINISTRADOR';
        this.entranceService.getAllAccessPoints().subscribe((campList: AccessPoint[]) => {
          if (campList && campList.length) {
            this.accessPoints = campList;
            this.fechaCmbBoxStart = new Date();
            this.fechaCmbBoxEnd = new Date();
            this.diaCmbBox = 'SELECCIONAR';
            this.mesCmbBox = 'SELECCIONAR';
            this.selectedAccessPoint = this.accessPoints[0];
            this.logoSrc = this.selectedAccessPoint?.image_url;
            this.fecha = new Date();
            this.dia = this.fecha.getDate();
            this.mes = this.fecha.getMonth() + 1;
            this.anio = this.fecha.getFullYear();
            if (this.mes < 10) this.mes = '0' + this.mes;
            if (this.dia < 10) this.dia = '0' + this.dia;
            this.fecha_hoy = this.anio + '-' + this.mes + '-' + this.dia;
            this.fecha1 = '';
            this.fecha2 = '';
            this.fecha3 = '';
            this.fecha4 = '';
            this.fecha5 = '';
            this.fechaInicio = this.fecha_hoy;
            this.fechaFin = this.fecha_hoy;
            this.fechaMes = this.anio + '-' + this.mes + '-';
            this.mesActual = this.meses[this.fecha.getMonth()];
            this.diaActual = String(this.fecha.getDate());
            this.aforo = [];
            this.fechas = [];
            this.address = [];
            this.mensual = [];
            this.hours = [];
            this.age = [];
          }
        });

        this.loadDashboardData();
        if (this.showRegistrationStats) {
          this.loadRegistrationSummary();
        }
      });
    }
    else{
      this.router.navigateByUrl('/login');
    }

  }
  
 exportExel() {
  console.log('Exporting data...');
  const workbook: XLSX.WorkBook = XLSX.utils.book_new();
  const separator = ',';

 // Agregar hojas de cálculo con datos
  
 // Dividir las cadenas en las columnas 'Age'
    const ageData = this.age.map(row => row.map(cell => (typeof cell === 'string' ? cell.split(separator) : cell)));
    this.addSheet(workbook, 'Age', ageData, this.columnsAge);   

// Dividir las cadenas en las columnas 'Fechas'
    const fechasData = this.fechas.map(row => row.map(cell => (typeof cell === 'string' ? cell.split(separator) : cell)));
    this.addSheet(workbook, 'Fechas', fechasData, this.columnsFechas);

// Invertir la dirección de las columnas 'Address'
    this.columnsAddress.reverse();

// Dividir las cadenas en las columnas 'Address'
    const addressData = this.address.map(row => row.map(cell => (typeof cell === 'string' ? cell.split(separator) : cell)));
    this.addSheet(workbook, 'Address', addressData, this.columnsAddress);

// Dividir las cadenas en las columnas 'Hours'
   const hoursData = this.hours.map(row => row.map(cell => (typeof cell === 'string' ? cell.split(separator) : cell)));
   this.addSheet(workbook, 'Hours', hoursData, this.columnsHours);

// Dividir las cadenas en las columnas 'Mensual'
   const mensualData = this.mensual.map(row => row.map(cell => (typeof cell === 'string' ? cell.split(separator) : cell)));
   this.addSheet(workbook, 'Mensual', mensualData, this.columnsMensual);

 // Imprimir los resultados después de la división
      console.log('Age', ageData, this.columnsAge);
      console.log('Fechas', fechasData, this.columnsFechas);
      console.log('Address', addressData, this.columnsAddress);
      console.log('Hours', hoursData, this.columnsHours);
      console.log('Mensual', mensualData, this.columnsMensual);

 // Descargar el archivo Excel
    XLSX.writeFile(workbook, 'exported-data.xlsx');

 }
// Crear una hoja de cálculo con datos
addSheet(workbook: XLSX.WorkBook, sheetName: string, data: any, columns: any): void {
  const ws: XLSX.WorkSheet = XLSX.utils.aoa_to_sheet([columns, ...data]);
  XLSX.utils.book_append_sheet(workbook, ws, sheetName);
}






  
  
  
  

  
  onAccessPointChange(point: AccessPoint): void {
    this.selectedAccessPoint = point;
    this.getStats();
  }

  mesChange(mes: string){
    this.diaCmbBox='SELECCIONAR';
    this.mesCmbBox=mes;
    if(this.mesCmbBox=='ENERO'){
      this.fechaMes=this.anio+'-01-';
    }
    if(this.mesCmbBox=='FEBRERO'){
      this.fechaMes=this.anio+'-02-';
    }
    if(this.mesCmbBox=='MARZO'){
      this.fechaMes=this.anio+'-03-';
    }
    if(this.mesCmbBox=='ABRIL'){
      this.fechaMes=this.anio+'-04-';
    }
    if(this.mesCmbBox=='MAYO'){
      this.fechaMes=this.anio+'-05-';
    }
    if(this.mesCmbBox=='JUNIO'){
      this.fechaMes=this.anio+'-06-';
    }
    if(this.mesCmbBox=='JULIO'){
      this.fechaMes=this.anio+'-07-';
    }
    if(this.mesCmbBox=='AGOSTO'){
      this.fechaMes=this.anio+'-08-';
    }
    if(this.mesCmbBox=='SETIEMBRE'){
      this.fechaMes=this.anio+'-09-';
    }
    if(this.mesCmbBox=='OCTUBRE'){
      this.fechaMes=this.anio+'-10-';
    }
    if(this.mesCmbBox=='NOVIEMBRE'){
      this.fechaMes=this.anio+'-11-';
    }
    if(this.mesCmbBox=='DICIEMBRE'){
      this.fechaMes=this.anio+'-12-';
    }

    this.getStats();
  }

  diaChange(dia: string){
    this.mesCmbBox='SELECCIONAR';
    this.diaCmbBox=dia;
    var diaInd;
    if(this.diaCmbBox=='LUNES'){
      diaInd=1;
    }
    if(this.diaCmbBox=='MARTES'){
      diaInd=2;
    }
    if(this.diaCmbBox=='MIERCOLES'){
      diaInd=3;
    }
    if(this.diaCmbBox=='JUEVES'){
      diaInd=4;
    }
    if(this.diaCmbBox=='VIERNES'){
      diaInd=5;
    }
    if(this.diaCmbBox=='SABADO'){
      diaInd=6;
    }
    if(this.diaCmbBox=='DOMINGO'){
      diaInd=0;
    }
    this.fechaAux=this.fechaPorDia(diaInd);

    this.dia_aux = this.fechaAux.getDate();
    this.mes_aux = this.fechaAux.getMonth()+1;
    this.anio_aux = this.fechaAux.getFullYear();

    if(this.mes_aux<10){
      this.mes_aux = '0'+this.mes_aux;
    }

    if(this.dia_aux<10){
      this.dia_aux = '0'+this.dia_aux;
    }

    this.fecha1 = this.anio_aux+'-'+this.mes_aux+'-'+this.dia_aux;

    this.fechaMes='-'+this.mes_aux+'-';

    this.fechaAux.setDate(this.fechaAux.getDate() - 7);

    this.dia_aux = this.fechaAux.getDate();
    this.mes_aux = this.fechaAux.getMonth()+1;
    this.anio_aux = this.fechaAux.getFullYear();

    if(this.mes_aux<10){
      this.mes_aux = '0'+this.mes_aux;
    }

    if(this.dia_aux<10){
      this.dia_aux = '0'+this.dia_aux;
    }

    this.fecha2 = this.anio_aux+'-'+this.mes_aux+'-'+this.dia_aux;

    this.fechaAux.setDate(this.fechaAux.getDate() - 7);

    this.dia_aux = this.fechaAux.getDate();
    this.mes_aux = this.fechaAux.getMonth()+1;
    this.anio_aux = this.fechaAux.getFullYear();

    if(this.mes_aux<10){
      this.mes_aux = '0'+this.mes_aux;
    }

    if(this.dia_aux<10){
      this.dia_aux = '0'+this.dia_aux;
    }

    this.fecha3 = this.anio_aux+'-'+this.mes_aux+'-'+this.dia_aux;

    this.fechaAux.setDate(this.fechaAux.getDate() - 7);

    this.dia_aux = this.fechaAux.getDate();
    this.mes_aux = this.fechaAux.getMonth()+1;
    this.anio_aux = this.fechaAux.getFullYear();

    if(this.mes_aux<10){
      this.mes_aux = '0'+this.mes_aux;
    }

    if(this.dia_aux<10){
      this.dia_aux = '0'+this.dia_aux;
    }

    this.fecha4 = this.anio_aux+'-'+this.mes_aux+'-'+this.dia_aux;

    this.getStats();
  }

  fechaChange(){
    this.diaCmbBox='SELECCIONAR';
    this.mesCmbBox='SELECCIONAR';

    if(this.fechaCmbBoxEnd){
      this.fechaAux=this.fechaCmbBoxStart;

      this.dia_aux = this.fechaAux.getDate();
      this.mes_aux = this.fechaAux.getMonth()+1;
      this.anio_aux = this.fechaAux.getFullYear();

      if(this.mes_aux<10){
        this.mes_aux = '0'+this.mes_aux;
      }

      if(this.dia_aux<10){
        this.dia_aux = '0'+this.dia_aux;
      }

      this.fechaInicio = this.anio_aux+'-'+this.mes_aux+'-'+this.dia_aux;

      var fechaAux2;
      var dia_aux2;
      var mes_aux2;
      var anio_aux2;

      fechaAux2=this.fechaCmbBoxEnd;

      dia_aux2 = fechaAux2.getDate();
      mes_aux2 = fechaAux2.getMonth()+1;
      anio_aux2 = fechaAux2.getFullYear();

      if(mes_aux2<10){
        mes_aux2 = '0'+mes_aux2;
      }

      if(dia_aux2<10){
        dia_aux2 = '0'+dia_aux2;
      }

      this.fechaFin = anio_aux2+'-'+mes_aux2+'-'+dia_aux2;

      this.fechaMes=anio_aux2+'-'+mes_aux2+'-';

      this.getStats();
    }


  }

  getStats(){
    this.aforo=[];
    this.fechas=[];
    this.address=[];
    this.mensual=[];

    this.logoSrc="assets/logo"+this.selectedAccessPoint+".png"

    this.accessLogService.getAforoStat(this.selectedAccessPoint.ap_location,this.fechaInicio,this.fechaFin,this.fechaMes,this.mesCmbBox,this.diaCmbBox,this.fecha1,this.fecha2,this.fecha3,this.fecha4,this.fecha5).subscribe((res:any[])=>{
      if(res.length>0){

        this.aforo=[[String(res[0]['FECHA']),parseInt(res[0]['AFORO']),0]];

        this.fechas=[];

        this.accessLogService.getAforoStat(this.selectedAccessPoint.ap_location,this.fechaInicio,this.fechaFin,this.fechaMes,this.mesCmbBox,this.diaCmbBox,this.fecha1,this.fecha2,this.fecha3,this.fecha4,this.fecha5).subscribe((res2:any[])=>{

          this.columnsFechas=['Fecha','Total',{role:'annotation'},'Nuevos',{role:'annotation'}]

          this.statsIngresosTotal=0;
          this.statsIngresosRango=0;

          for(var i=0,l=res.length;i<l;i++){
            var flag3=false;
            var ele=[];
            ele.push(String(res[i]['FECHA']));
            ele.push(parseInt(res[i]['AFORO']));
            ele.push(String(res[i]['AFORO']));

            this.statsIngresosTotal+=parseInt(res[i]['AFORO']);
            this.statsIngresosPromedioDia=(this.statsIngresosTotal/res.length).toFixed(0);

            if(res2.length>0){
              res2.forEach(rd=>{
                if(rd['FECHA']==res[i]['FECHA']){
                  flag3=true;
                  ele.push(parseInt(rd['AFORO']));
                  ele.push(String(rd['AFORO']))

                  this.statsIngresosRango+=parseInt(rd['AFORO']);

                }
              })
              if(!flag3){
                ele.push(0);
                ele.push('0');
              }
            }
            else{
              ele.push(0);
              ele.push('0');
            }
            this.fechas.push(ele);
          }

        })

      }
      else[
        this.aforo=[['No hay datos',0]],
        this.fechas=[['No hay datos',0]]
      ]

      this.accessLogService.getAddressStat(this.selectedAccessPoint.ap_location,this.fechaInicio,this.fechaFin,this.fechaMes,this.mesCmbBox,this.diaCmbBox,this.fecha1,this.fecha2,this.fecha3,this.fecha4,this.fecha5).subscribe((a:any[])=>{
        if(a.length>0){
          this.address=[];
          a.sort(function(m,n){return n['CANTIDAD'] - m['CANTIDAD'];});

          this.distritoTop=a[0]['DISTRITO'];

          var ndist=0;

          a.forEach(ad=>{
            if(ad['DISTRITO']!='S/N' && ad['DISTRITO']!='--' && ad['DISTRITO']!='SN'&&ndist<12){
              var el =[];

              this.columnsAddress=['Dir','Cantidad',{ role: 'annotation' }]


              el.push(String(ad['CANTIDAD']));
              el.push(parseInt(ad['CANTIDAD']));
              el.push(ad['DISTRITO']);
              this.address.push(el);
              ndist+=1;
            }
          })
        }

        else{
          this.address=[['No hay datos',0,'SN']]
        }


        this.accessLogService.getTotalMonth(this.selectedAccessPoint.ap_location,this.fechaMes,this.mesCmbBox,this.diaCmbBox,this.fecha1,this.fecha2,this.fecha3,this.fecha4).subscribe((b:any[])=>{
          if(b.length>0){
            this.mensual=[];

            this.accessLogService.getTotalMonthNew(this.selectedAccessPoint.ap_location,this.fechaMes,this.mesCmbBox,this.diaCmbBox,this.fecha1,this.fecha2,this.fecha3,this.fecha4).subscribe((b2:any[])=>{

              this.columnsMensual=['Fecha','Total',{ role: 'annotation' },'Nuevos',{role:'annotation'}];

              for(var i=0, l=b.length;i<l;i++){
                var el =[];
                var flag4=false;
                el.push(b[i]['FECHA']);
                el.push(parseInt(b[i]['AFORO']));
                el.push(String(b[i]['AFORO']));
                if(b2.length>0){
                  b2.forEach(ad=>{
                    if(ad['FECHA']==b[i]['FECHA']){
                      flag4=true;
                      el.push(parseInt(ad['AFORO']));
                      el.push(String(ad['AFORO']));
                    }
                  })
                  if(!flag4){
                    el.push(0);
                    el.push('0');
                  }
                }
                else{
                  el.push(0);
                  el.push('0');
                }
                this.mensual.push(el);
              }

            })

          }
          else{
            this.mensual=[['No hay datos',0]]
          }

          this.hours=[];

          this.accessLogService.getHourStat(this.selectedAccessPoint.ap_location,this.fechaInicio,this.fechaFin,this.fechaMes,this.mesCmbBox,this.diaCmbBox,this.fecha1,this.fecha2,this.fecha3,this.fecha4,this.fecha5).subscribe((resHours:any[])=>{
            var horasString=['00','01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23']
            this.columnsHours=['Hora','Cantidad',{ role: 'annotation' }];
            var cantidadXHoras=[24];
            if(resHours.length>0){

              var cantHourAux=0;

              for(var i=0;i<24;i++){
                var elem=[];
                var contador=0;
                resHours.forEach(hItem=>{
                  if(String(hItem['HORA']).substring(0,2)==horasString[i]){
                    contador+=parseInt(hItem['AFORO']);
                  }
                })
                elem.push(horasString[i]+':00');
                elem.push(contador);
                elem.push(String(contador));
                cantidadXHoras[i]=contador;

                if(contador>=cantHourAux){
                  cantHourAux=contador;
                  if(i<23){
                    this.horaTop=horasString[i]+':00 a '+horasString[i+1]+':00';
                  }
                  else{
                    this.horaTop=horasString[i]+':00 a 24:00';
                  }
                }

                this.hours.push(elem);
              }
            }

            this.age=[];

            this.accessLogService.getAgeStat(this.selectedAccessPoint.ap_location,this.fechaInicio,this.fechaFin,this.fechaMes,this.mesCmbBox,this.diaCmbBox,this.fecha1,this.fecha2,this.fecha3,this.fecha4,this.fecha5).subscribe((resAge:any[])=>{
              if(resAge.length>0){
                this.columnsAge=['Edad','Cantidad',{ role: 'annotation' }];
                var count18a30 = 0;
                var count30a40 = 0;
                var count40a50 = 0;
                var count50a60 = 0;
                var count60amas = 0;

                var cantEdad=0;


                resAge.forEach(clientAge=>{

                  if(parseInt(clientAge['EDAD'])<=30){
                    count18a30+=parseInt(clientAge['AFORO']);
                    if(count18a30>cantEdad){
                      cantEdad=count18a30;
                      this.edadTop='18 a 30';
                    }
                  }
                  else if(parseInt(clientAge['EDAD'])<=40){
                    count30a40+=parseInt(clientAge['AFORO']);
                    if(count30a40>cantEdad){
                      cantEdad=count30a40;
                      this.edadTop='31 a 40';
                    }
                  }
                  else if(parseInt(clientAge['EDAD'])<=50){
                    count40a50+=parseInt(clientAge['AFORO']);
                    if(count40a50>cantEdad){
                      cantEdad=count40a50;
                      this.edadTop='41 a 50';
                    }
                  }
                  else if(parseInt(clientAge['EDAD'])<=60){
                    count50a60+=parseInt(clientAge['AFORO']);
                    if(count50a60>cantEdad){
                      cantEdad=count50a60;
                      this.edadTop='51 a 60';
                    }
                  }
                  else{
                    count60amas+=parseInt(clientAge['AFORO']);
                    if(count60amas>cantEdad){
                      cantEdad=count60amas;
                      this.edadTop='60+';
                    }
                  }
                })

                var elem=[];

                elem.push('18 a 30');
                elem.push(count18a30);
                elem.push(String(count18a30));
                this.age.push(elem);

                elem=[];
                elem.push('31 a 40');
                elem.push(count30a40);
                elem.push(String(count30a40));
                this.age.push(elem);

                elem=[];
                elem.push('41 a 50');
                elem.push(count40a50);
                elem.push(String(count40a50));
                this.age.push(elem);

                elem=[];
                elem.push('51 a 60');
                elem.push(count50a60);
                elem.push(String(count50a60));
                this.age.push(elem);

                elem=[];
                elem.push('61 a más');
                elem.push(count60amas);
                elem.push(String(count60amas));
                this.age.push(elem);


/*                 this.accessLogService.getHourWargos(this.selectedAccessPoint,this.fechaInicio,this.fechaFin,'','','','','','','','').subscribe((ans:any[])=>{
                  if(ans.length>0){
                    var contHW1;
                    var contHW2;
                    var horaHWStr;
                    var flagAdd;
                    if(ans.length>48){
                      ans.splice(0,48);
                    }


                    var ultimoElem = ans[ans.length-1]['fechaHora'];

                    var fechaHoraArrayAux = String(ultimoElem).split(' ');
                    var horaWargosArrayAux = String(fechaHoraArrayAux[1]).split(':');
                    var horaWargosNumAux = parseInt(horaWargosArrayAux[0]);
                    var minWargosNumAux = parseInt(horaWargosArrayAux[1]);
                    if(horaWargosNumAux==8&&minWargosNumAux==0){
                      ans.splice(ans.length-1-24,25);
                    }


                    console.log(ans);
                    this.horaWargos=[];
                    this.columnsHoraWargos=['Hora','Total',{ role: 'annotation' },'Logueados',{ role: 'annotation' }]
                    for(var t=0; t<24; t++){
                      contHW1=0;
                      contHW2=0;
                      var elemHW =[];
                      flagAdd=false;
                      ans.forEach(ansItem=>{

                        var fechaHoraArray = String(ansItem['fechaHora']).split(' ');
                        var horaWargosArray = String(fechaHoraArray[1]).split(':');
                        var horaWargosNum = parseInt(horaWargosArray[0]);
                        var minWargosNum = parseInt(horaWargosArray[1]);
                        if(t==horaWargosNum&&minWargosNum==0){
                          horaHWStr= horaWargosArray[0]+':'+horaWargosArray[1];
                          console.log(horaWargosArray[0]+':'+horaWargosArray[1]);

                          contHW1+=parseInt(ansItem['played']);
                          contHW2+=parseInt(ansItem['logged']);
                          flagAdd=true;
                        }

                      })
                      if(flagAdd){
                        elemHW.push(horaHWStr);
                        elemHW.push(contHW1);
                        elemHW.push(String(contHW1));
                        elemHW.push(contHW2);
                        elemHW.push(String(contHW2));
                        this.horaWargos.push(elemHW);
                      }
                    }
                  }
                }) */
              }

/*               this.accessLogService.getHourReal(this.selectedAccessPoint,this.fechaInicio,this.fechaFin,this.fechaMes,this.mesCmbBox,this.diaCmbBox,this.fecha1,this.fecha2,this.fecha3,this.fecha4,this.fecha5).subscribe(r=>{
                console.log(r);
              }) */
            })
          })

        })
      })
    })

  }

  fechaPorDia(dia_index:number):Date{
    var dias1;
    var fecha_actualisima= new Date();
    var dia_act=fecha_actualisima.getDate();
    var mes_act=fecha_actualisima.getMonth();
    var anio_act=fecha_actualisima.getFullYear();
    var fecha1 = new Date(anio_act,mes_act,dia_act);
    var diapararestar=fecha1.getUTCDay();
    if(diapararestar<dia_index){
        dias1=(-diapararestar-(dia_index+1));
    }else{
        dias1=(diapararestar-dia_index)*(-1);
    }

    fecha1.setDate(fecha1.getDate() + dias1);
    return fecha1;
  }

}

@Component({
  selector: 'dialog-revalidar',
  templateUrl: 'dialog-revalidar.html',
  styleUrls: ['./dashboard.component.css']
})
export class DialogRevalidar implements OnInit {


  btnRevalidarEnabled ;


  fecha;

  anio;
  mes;
  dia;
  diaSemana;
  hora;
  mesIndex;




  img = new Image();

  constructor(
    public dialogRef: MatDialogRef<DialogRevalidar>,
    @Inject(MAT_DIALOG_DATA) public data:Product,
    private fb: FormBuilder,
    private toastr: ToastrService,
  ) {}

  ngOnInit(): void {

    this.btnRevalidarEnabled=true;

  }

  btnRevalidar(){
    this.dialogRef.close(this.data);
  }

  btnRechazar(){
    this.dialogRef.close(this.data);
  }

  onNoClick(): void {
    this.dialogRef.close();
  }


}


@Component({
  selector: 'dialog-select-sala',
  templateUrl: 'dialog-select-sala.html',
  styleUrls: ['./dashboard.component.css']
})
export class DialogSelectSala implements OnInit {


  img = new Image();

  constructor(
    public dialogRef: MatDialogRef<DialogRevalidar>,
    @Inject(MAT_DIALOG_DATA) public data:String,
    private fb: FormBuilder,
    private toastr: ToastrService,
  ) {}

  ngOnInit(): void {

  }

  btnMega(){
    this.data = 'mega';
    this.dialogRef.close(this.data);
  }

  btnPro(){
    this.data = 'pro';
    this.dialogRef.close(this.data);
  }

  btnHuaral(){
    this.data = 'huaral';
    this.dialogRef.close(this.data);
  }

  btnOlympo(){
    this.data = 'huaral';
    this.dialogRef.close(this.data);
  }

  onNoClick(): void {
    this.dialogRef.close();
  }


}
