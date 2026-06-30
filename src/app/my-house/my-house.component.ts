import { AfterViewInit, Component, OnInit } from '@angular/core';
import { User } from '../user';
import { House } from '../house';
import { initFlowbite } from 'flowbite';
import { EntranceService } from '../entrance.service';
import { AuthService } from '../auth.service';
import { UsersService } from '../users.service';
import { ApiService } from '../api.service';
import { ExternalVehicle, EXTERNAL_VISIT_DURATION_OPTIONS } from '../externalVehicle';
import { Vehicle } from '../vehicle';
import { ToastrService } from 'ngx-toastr';
import { environment } from '../../environments/environment';
import { PetsService } from '../pets.service';
import { Pet } from '../pet';
import { PublicRegistrationService } from '../public-registration/public-registration.service';
import {
  VEHICLE_TYPE_VALUES,
  vehicleTypeRequiresLicensePlate,
  vehicleTypeRequiresVehiclePhoto
} from '../vehicle-types';
import { QrAccessService } from '../qr/qr-access.service';
import * as QRCode from 'qrcode';
import {
  ExpandableRowId,
  isExpandableRowOpen,
  toggleExpandableRow,
} from '../shared/expandable-row';

type MyHouseTableKey = 'residents' | 'tenants' | 'pets' | 'vehicles' | 'visits' | 'external';

@Component({
  selector: 'app-my-house',
  templateUrl: './my-house.component.html',
  styleUrls: ['./my-house.component.css']
})
export class MyHouseComponent implements OnInit, AfterViewInit {

  document = document;

  users: User[] = [];
  userToAdd: User = User.empty();
  userToEdit: User = User.empty();

  houses: House[] = [];
  houseToAdd: House = new House('',0,null,'',0);
  houseToEdit: House = new House('',0,null,'',0);

  myFamily: User[] = [];
  myResidents: User[] = [];
  myTenants: User[] = [];
  myVisits: User[] = [];
  myVehicles: Vehicle[] = [];
  myPets: Pet[] = [];

  showViewPhotoDialog = false;
  viewPhotoUrl: string | null = null;
  viewPhotoTitle = '';

  showMyQrDialog = false;
  myQrDataUrl: string | null = null;
  myQrLoading = false;
  myQrDialogTitle = 'Mi QR de ingreso';

  user_id;
  userOnSes: User = User.empty();

  typeDocs: string[] = ['DNI','CE'];
  genders: string[] = ['F', 'M'];
  roles: string[] = ['USUARIO','ADMINISTRADOR','OPERARIO'];
  status_validated: string[] = ['PERMITIDO','DENEGADO','OBSERVADO'];
  categories: string[] = ['PROPIETARIO','RESIDENTE','INQUILINO'];
  residentCategories: string[] = ['PROPIETARIO','RESIDENTE'];
  tenantCategories: string[] = ['INQUILINO'];
  currentCategoryOptions: string[] = ['PROPIETARIO','RESIDENTE'];
  categories_visits: string[] = ['INVITADO'];
  types: string[] = [...VEHICLE_TYPE_VALUES];
  temp_visit_type:string[]=['DELIVERY','COLECTIVO','TAXI'];
  readonly externalDurationOptions = EXTERNAL_VISIT_DURATION_OPTIONS;
  externalDurationMinutes = 120;
  externalLookupLoading = false;
  enableSystemAccessNew = false;
  enableSystemAccessEdit = false;
  
  // Colores para vehículos
  vehicleColors: string[] = ['Blanco', 'Negro', 'Plata', 'Gris', 'Rojo', 'Azul', 'Verde', 'Beige', 'Otro'];
  
  // Colores para mascotas
  petColors: string[] = ['Blanco', 'Negro', 'Café', 'Gris', 'Crema', 'Atigrado', 'Otro'];
  
  vehicleToAdd = new Vehicle('', 'AUTOMOVIL', 0, 'PERMITIDO', '', '', 'RESIDENTE', '', '', '');
  vehicleToEdit = new Vehicle('', 'AUTOMOVIL', 0, 'PERMITIDO', '', '', 'RESIDENTE', '', '', '');
  vehicles: Vehicle[] = [];
  externalVehicleToAdd = new ExternalVehicle('','','','','','','','',);
  externalVehicleToEdit = new ExternalVehicle('','','','','','','','',);
  externalVehicles: ExternalVehicle[] = [];

  petToAdd: Partial<Pet> = { name: '', species: 'PERRO', breed: '', color: '', age_years: undefined, house_id: 0, status_validated: 'PERMITIDO', photo_url: undefined };
  petToEdit: Partial<Pet> & { id?: number } = {};
  petSpecies: { value: string; label: string }[] = [
    { value: 'PERRO', label: 'Perro' },
    { value: 'GATO', label: 'Gato' },
    { value: 'AVE', label: 'Ave' },
    { value: 'PEQUEÑO MAMÍFERO', label: 'Pequeño mamífero' },
    { value: 'ACUÁTICO', label: 'Acuático' },
    { value: 'EXÓTICO', label: 'Exótico' },
    { value: 'OTRO', label: 'Otros' }
  ];
  petStatusList = ['PERMITIDO', 'OBSERVADO', 'DENEGADO'];

  /** Índice del vehículo cuya foto se está subiendo (-1 = ninguno) */
  uploadingVehicleIndex: number = -1;
  /** Foto del modal “nuevo vehículo” (antes de existir vehicle_id) */
  uploadingNewVehiclePhoto = false;
  /** Índice de la mascota cuya foto se está subiendo (-1 = ninguna) */
  uploadingPetIndex: number = -1;
  /** Foto del modal «nueva mascota» (opcional, antes de crear el registro) */
  uploadingNewPetPhoto = false;
  /** Foto del modal «nueva visita externa» */
  uploadingNewExternalVehiclePhoto = false;
  /** Foto del modal «editar visita externa» */
  uploadingEditExternalVehiclePhoto = false;

  expandedMyHouseRows: Record<MyHouseTableKey, ExpandableRowId> = {
    residents: null,
    tenants: null,
    pets: null,
    vehicles: null,
    visits: null,
    external: null,
  };

  readonly myHouseResidentsColspan = 8;
  readonly myHouseTenantsColspan = 7;
  readonly myHousePetsColspan = 7;
  readonly myHouseVehiclesColspan = 7;
  readonly myHouseVisitsColspan = 6;
  readonly myHouseExternalColspan = 7;

  constructor(
    private entranceService: EntranceService,
    private auth: AuthService,
    private usersService: UsersService,
    public api: ApiService,
    private toastr: ToastrService,
    private petsService: PetsService,
    private publicReg: PublicRegistrationService,
    private qrAccess: QrAccessService
  ){}

  ngOnInit(): void {
    const userId = Number(this.auth.getTokenItem('user_id'));
    if (!userId || userId <= 0) {
      this.toastr.error('No se encontró usuario en sesión.');
      return;
    }

    this.usersService.getUserById(userId).subscribe({
      next: (os: User) => {
        this.userOnSes = os;
        const houseId = Number(os.house_id) || 0;

        if (houseId <= 0) {
          this.toastr.warning('El usuario no tiene casa asociada.');
          return;
        }

        this.loadHouseMembers(houseId);
        this.loadPets(houseId);
        this.loadVehicles(houseId);
        this.loadExternalVehicles(houseId);
        this.loadAllHouses();
        setTimeout(() => initFlowbite(), 0);
      },
      error: () => {
        this.toastr.error('Error al cargar información del usuario.');
      }
    });
  }

  private normalizeCategory(value: any): string {
    return (value || '').toString().trim().toUpperCase();
  }

  /**
   * Persona INQUILINO (USUARIO u OPERARIO con casa): sin pestaña Residentes; gestión acotada.
   */
  get isTenantRestrictedInMyHouse(): boolean {
    const cat = this.normalizeCategory(
      (this.userOnSes as any).property_category || (this.userOnSes as any).person_type || ''
    );
    return cat === 'INQUILINO';
  }

  /** Solicitante RESIDENTE: no crea/edita PROPIETARIO (sí lista y QR según reglas). */
  get isResidentOnlyMyHouse(): boolean {
    return (
      this.normalizeCategory(
        (this.userOnSes as any).property_category || (this.userOnSes as any).person_type || ''
      ) === 'RESIDENTE'
    );
  }

  /** En pestaña Residentes: ocultar editar si el residente no puede modificar esa fila. */
  canEditResidentRow(row: any): boolean {
    if (this.isTenantRestrictedInMyHouse) {
      return false;
    }
    const cat = this.normalizeCategory(row?.property_category || row?.person_type || row?.relation_type);
    if (this.isResidentOnlyMyHouse && cat === 'PROPIETARIO') {
      return false;
    }
    return true;
  }

  private assertCanManageResidents(): boolean {
    if (this.isTenantRestrictedInMyHouse) {
      this.toastr.warning('Como inquilino no puedes gestionar la pestaña Residentes.');
      return false;
    }
    return true;
  }

  /** persons.id del usuario en sesión (JWT / getUserById). */
  personIdSession(): number {
    return Number((this.userOnSes as any).person_id ?? 0) || 0;
  }

  /** USUARIO o administrador con persona vinculada (misma regla que API access-qr/generate). */
  canShowMyAccessQr(): boolean {
    return this.auth.canGenerateHouseAccessQr();
  }

  /** persons.id en filas de Mi casa (API house_members / persons). */
  personRowPersonId(row: any): number {
    return Number(row?.id ?? row?.person_id ?? 0) || 0;
  }

  /**
   * Reglas alineadas al backend: propietario/residente amplio; inquilino solo inquilino/visita.
   */
  canShowQrForPersonRow(row: any): boolean {
    if (!this.canShowMyAccessQr()) {
      return false;
    }
    if (this.personRowPersonId(row) <= 0) {
      return false;
    }
    const cat = this.normalizeCategory(row.property_category || row.person_type || row.relation_type);
    if (this.isTenantRestrictedInMyHouse) {
      return ['INQUILINO', 'INVITADO'].includes(cat);
    }
    return ['PROPIETARIO', 'RESIDENTE', 'INQUILINO', 'INVITADO'].includes(cat);
  }

  canShowQrForVehicleRow(v: Vehicle): boolean {
    return this.canShowMyAccessQr() && Number(v?.vehicle_id ?? 0) > 0;
  }

  openPersonAccessQr(row: any, title: string): void {
    if (!this.canShowQrForPersonRow(row)) {
      return;
    }
    const pid = this.personRowPersonId(row);
    if (pid <= 0) {
      this.toastr.error('No se pudo identificar a la persona.');
      return;
    }
    this.myQrDialogTitle = title.trim() || 'QR de ingreso';
    this.runGeneratePersonQr(pid);
  }

  openVehicleAccessQr(v: Vehicle): void {
    if (!this.canShowQrForVehicleRow(v)) {
      return;
    }
    const vid = Number(v.vehicle_id ?? 0);
    const pl = (v.license_plate ?? '').toString().trim();
    this.myQrDialogTitle = `QR ingreso — vehículo ${pl || v.type_vehicle || ''}`.trim();
    this.myQrLoading = true;
    this.qrAccess.generateVehicleQr(vid).subscribe({
      next: (res) => {
        QRCode.toDataURL(res.token, { width: 280, margin: 2, errorCorrectionLevel: 'M' })
          .then((url) => {
            this.myQrDataUrl = url;
            this.showMyQrDialog = true;
            this.myQrLoading = false;
            setTimeout(() => initFlowbite(), 0);
          })
          .catch(() => {
            this.myQrLoading = false;
            this.toastr.error('No se pudo generar la imagen del QR.');
          });
      },
      error: (e: Error) => {
        this.myQrLoading = false;
        this.toastr.error(e?.message || 'No se pudo generar el código.');
      },
    });
  }

  private runGeneratePersonQr(personId: number): void {
    this.myQrLoading = true;
    this.qrAccess.generatePersonQr(personId).subscribe({
      next: (res) => {
        QRCode.toDataURL(res.token, { width: 280, margin: 2, errorCorrectionLevel: 'M' })
          .then((url) => {
            this.myQrDataUrl = url;
            this.showMyQrDialog = true;
            this.myQrLoading = false;
            setTimeout(() => initFlowbite(), 0);
          })
          .catch(() => {
            this.myQrLoading = false;
            this.toastr.error('No se pudo generar la imagen del QR.');
          });
      },
      error: (e: Error) => {
        this.myQrLoading = false;
        this.toastr.error(e?.message || 'No se pudo generar el código.');
      },
    });
  }

  closeMyQrDialog(): void {
    this.showMyQrDialog = false;
    this.myQrDataUrl = null;
    this.myQrDialogTitle = 'Mi QR de ingreso';
  }

  /** Inquilino: solo vehículos propios con categoría INQUILINO. */
  canTenantEditVehicle(v: Vehicle): boolean {
    if (!this.isTenantRestrictedInMyHouse) {
      return true;
    }
    const pid = this.personIdSession();
    const cat = (v.category_entry ?? '').toString().trim().toUpperCase();
    const oid = Number((v as any).owner_id);
    return pid > 0 && cat === 'INQUILINO' && oid === pid;
  }

  /** Inquilino: solo mascotas donde es responsable. */
  canTenantEditPet(pt: Pet): boolean {
    if (!this.isTenantRestrictedInMyHouse) {
      return true;
    }
    const pid = this.personIdSession();
    const oid = Number((pt as any).owner_id);
    return pid > 0 && oid === pid;
  }

  /** Opciones de categoría de ingreso en modales de vehículo (inquilino: solo INQUILINO). */
  get vehicleCategoryOptions(): string[] {
    return this.isTenantRestrictedInMyHouse ? ['INQUILINO'] : this.categories;
  }

  private safeDataArray(res: any): any[] {
    if (!res) {
      return [];
    }
    if (Array.isArray(res)) {
      return res;
    }
    if (res.data && Array.isArray(res.data)) {
      return res.data;
    }
    return [];
  }

  private loadHouseMembers(houseId: number): void {
    this.entranceService.getPersonsByHouseId(houseId).subscribe({
      next: (res: any) => {
        const raw = this.safeDataArray(res);

        const list = raw.map((u: any) => {
          const property = this.normalizeCategory(u.property_category || u.person_type || u.relation_type);
          return {
            ...u,
            property_category: property,
            person_type: this.normalizeCategory(u.person_type),
            relation_type: this.normalizeCategory(u.relation_type)
          };
        });

        this.myFamily = list.filter((u: any) => ['PROPIETARIO', 'RESIDENTE', 'INQUILINO'].includes(u.property_category));
        this.myResidents = list.filter((u: any) => ['PROPIETARIO', 'RESIDENTE'].includes(u.property_category));
        this.myTenants = list.filter((u: any) => u.property_category === 'INQUILINO');
        this.myVisits = list.filter((u: any) =>
          ['INVITADO', 'VISITA'].includes(this.normalizeCategory(u.property_category || u.person_type || u.relation_type))
        );

        // fallback a persons?house_id=... si no hay datos en house_members
        if (this.myFamily.length === 0) {
          this.usersService.getPersonsByHouseId(houseId).subscribe({
            next: (res2: any) => {
              const raw2 = this.safeDataArray(res2);
              const list2 = raw2.map((u: any) => {
                const property = this.normalizeCategory(u.property_category || u.person_type || u.relation_type);
                return {
                  ...u,
                  property_category: property,
                  person_type: this.normalizeCategory(u.person_type),
                  relation_type: this.normalizeCategory(u.relation_type)
                };
              });
              this.myFamily = list2.filter((u: any) => ['PROPIETARIO', 'RESIDENTE', 'INQUILINO'].includes(u.property_category));
              this.myResidents = list2.filter((u: any) => ['PROPIETARIO', 'RESIDENTE'].includes(u.property_category));
              this.myTenants = list2.filter((u: any) => u.property_category === 'INQUILINO');
              this.myVisits = list2.filter((u: any) =>
                ['INVITADO', 'VISITA'].includes(this.normalizeCategory(u.property_category || u.person_type || u.relation_type))
              );
            },
            error: () => {
              // no action
            }
          });
        }
      },
      error: () => {
        this.myFamily = [];
        this.myResidents = [];
        this.myTenants = [];
        this.myVisits = [];
      }
    });
  }

  private loadPets(houseId: number): void {
    this.petsService.getPets({ house_id: houseId }).subscribe({
      next: (res: any) => {
        this.myPets = this.safeDataArray(res);
      },
      error: () => {
        this.myPets = [];
      }
    });
  }

  private loadVehicles(houseId: number): void {
    this.entranceService.getVehiclesByHouseId(houseId).subscribe({
      next: (res: any) => {
        this.myVehicles = this.safeDataArray(res);
      },
      error: () => {
        this.myVehicles = [];
      }
    });
  }

  private loadExternalVehicles(houseId?: number): void {
    const hid = houseId ?? (Number(this.userOnSes?.house_id) || 0);
    if (hid <= 0) {
      this.externalVehicles = [];
      return;
    }
    this.entranceService.getActiveExternalVehiclesByHouse(hid).subscribe({
      next: (res: any) => {
        this.externalVehicles = this.safeDataArray(res);
      },
      error: () => {
        this.externalVehicles = [];
      }
    });
  }

  formatExternalValidUntil(ev: ExternalVehicle): string {
    const raw = ev.valid_until;
    if (!raw) {
      return '—';
    }
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) {
      return raw;
    }
    return d.toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });
  }

  lookupExternalVisitOnIdentifierBlur(): void {
    const plate = (this.externalVehicleToAdd.temp_visit_plate || '').trim();
    const doc = (this.externalVehicleToAdd.temp_visit_doc || '').trim();
    if (!plate && !doc) {
      return;
    }
    this.externalLookupLoading = true;
    this.entranceService.lookupExternalVisit({ plate: plate || undefined, doc: doc || undefined }).subscribe({
      next: (res: any) => {
        this.externalLookupLoading = false;
        const body = res?.data ?? res;
        if (!body?.found || !body?.profile) {
          return;
        }
        const p = body.profile;
        if (p.temp_visit_name) {
          this.externalVehicleToAdd.temp_visit_name = p.temp_visit_name;
        }
        if (p.temp_visit_cel) {
          this.externalVehicleToAdd.temp_visit_cel = p.temp_visit_cel;
        }
        if (p.temp_visit_type) {
          this.externalVehicleToAdd.temp_visit_type = p.temp_visit_type;
        }
        if (p.temp_visit_plate && !plate) {
          this.externalVehicleToAdd.temp_visit_plate = p.temp_visit_plate;
        }
        if (p.temp_visit_doc && !doc) {
          this.externalVehicleToAdd.temp_visit_doc = p.temp_visit_doc;
        }
        if (p.photo_url) {
          this.externalVehicleToAdd.photo_url = p.photo_url;
        }
        this.toastr.info('Datos reutilizados del registro global');
      },
      error: () => {
        this.externalLookupLoading = false;
      },
    });
  }

  private loadAllHouses(): void {
    this.entranceService.getAllHouses().subscribe({
      next: (res: any) => {
        this.houses = this.safeDataArray(res);
      },
      error: () => {
        this.houses = [];
      }
    });
  }

  ngAfterViewInit(): void {
    initFlowbite();
    const tabList = document.getElementById('myhouse-default-tab');
    tabList?.querySelectorAll('[role="tab"]').forEach((btn) => {
      btn.addEventListener('click', () => this.onMyHouseTabChange());
    });
  }

  onMyHouseTabChange(): void {
    (Object.keys(this.expandedMyHouseRows) as MyHouseTableKey[]).forEach((key) => {
      this.expandedMyHouseRows[key] = null;
    });
  }

  isMyHouseRowOpen(table: MyHouseTableKey, id: string | number): boolean {
    return isExpandableRowOpen(this.expandedMyHouseRows[table], id);
  }

  toggleMyHouseRow(table: MyHouseTableKey, id: string | number): void {
    this.expandedMyHouseRows[table] = toggleExpandableRow(this.expandedMyHouseRows[table], id);
  }

  getMyHouseUserRowId(u: User): string | number {
    const id = Number((u as { user_id?: number }).user_id || 0);
    return id > 0 ? id : u.doc_number;
  }

  getMyHousePetRowId(pt: Pet): string | number {
    return pt.id ?? pt.name ?? '';
  }

  getMyHouseVehicleRowId(vh: Vehicle): string | number {
    const id = Number((vh as { vehicle_id?: number }).vehicle_id || 0);
    return id > 0 ? id : (vh.license_plate || vh.type_vehicle || '');
  }

  getMyHouseExternalRowId(ev: ExternalVehicle): string | number {
    const id = Number((ev as { id?: number }).id || 0);
    return id > 0 ? id : `${ev.temp_visit_plate}-${ev.temp_visit_name}`;
  }

  openViewPhoto(item: { photo_url?: string }, title: string): void {
    const photoUrl = this.api.getPhotoUrl(item.photo_url || '');
    if (!photoUrl) {
      this.toastr.warning('No hay imagen disponible para mostrar.');
      return;
    }
    this.viewPhotoTitle = title;
    this.viewPhotoUrl = photoUrl;
    this.showViewPhotoDialog = true;
  }

  closeViewPhoto(): void {
    this.showViewPhotoDialog = false;
    this.viewPhotoUrl = null;
    this.viewPhotoTitle = '';
  }

  private hasSystemAccess(user: Partial<User>): boolean {
    const role = (user.role_system || '').toString().trim().toUpperCase();
    return !!user.user_id && role !== '' && role !== 'SN' && role !== 'NINGUNO';
  }

  getSessionHouseLabel(): string {
    const houseId = Number(this.userOnSes.house_id) || 0;
    if (houseId <= 0) {
      return 'Sin domicilio asociado';
    }
    const houseFromList = this.houses.find((h) => Number(h.house_id) === houseId);
    const block = houseFromList?.block_house || this.userOnSes.block_house || '—';
    const lot = houseFromList?.lot ?? this.userOnSes.lot ?? '—';
    const apartment = houseFromList?.apartment ?? this.userOnSes.apartment ?? '—';
    return `Mz:${block} Lt:${lot} Dpt:${apartment}`;
  }

  onToggleSystemAccessNew(): void {
    if (this.enableSystemAccessNew) {
      this.userToAdd.force_password_change = 1;
      this.suggestUniqueUsernameFor(this.userToAdd, true);
      this.userToAdd.role_system = 'USUARIO';
    } else {
      this.userToAdd.username_system = '';
      this.userToAdd.role_system = '';
      this.userToAdd.password_system = '';
      this.userToAdd.force_password_change = 0;
    }
  }

  onToggleSystemAccessEdit(): void {
    if (this.enableSystemAccessEdit) {
      this.userToEdit.role_system = 'USUARIO';
      // Mismo criterio que users: al habilitar acceso se exige cambio en próximo inicio por defecto.
      this.userToEdit.force_password_change = 1;
      if (!this.userToEdit.username_system?.trim()) {
        this.suggestUniqueUsernameFor(this.userToEdit, false);
      }
    }
  }

  private normalizeUsernamePart(value: string): string {
    return (value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase();
  }

  private suggestUniqueUsernameFor(targetUser: User, force = false): void {
    if (!force && targetUser.username_system?.trim()) {
      return;
    }
    const firstInitial = this.normalizeUsernamePart((targetUser.first_name || '').trim()).charAt(0);
    const lastName = this.normalizeUsernamePart((targetUser.paternal_surname || '').trim());
    const docFallback = this.normalizeUsernamePart((targetUser.doc_number || '').trim());
    let base = `${firstInitial}${lastName}`;
    if (!base) {
      base = docFallback || 'usuario';
    }

    this.reserveUsernameCandidate(base, targetUser, 0);
  }

  /** Busca el primer username libre usando GET check-username (sin descargar todos los usuarios). */
  private reserveUsernameCandidate(base: string, targetUser: User, suffix: number): void {
    if (suffix > 200) {
      targetUser.username_system = suffix === 0 ? base : `${base}${suffix}`;
      return;
    }
    const candidate = suffix === 0 ? base : `${base}${suffix}`;
    this.usersService.checkUsernameAvailable(candidate).subscribe({
      next: (raw: any) => {
        if (raw?.available === true) {
          targetUser.username_system = candidate;
          return;
        }
        this.reserveUsernameCandidate(base, targetUser, suffix + 1);
      },
      error: () => {
        targetUser.username_system = candidate;
      }
    });
  }

  searchUser(doc_number: string){
    // Validar que sea un documento válido
    const docTrimmed = doc_number?.trim() ?? '';
    const isValidDoc = /^\d{8,}$/.test(docTrimmed); // 8 o más dígitos

    if (!isValidDoc) {
      this.toastr.warning('Por favor ingresa un documento válido (mínimo 8 dígitos)');
      return;
    }

    const isDni = docTrimmed.length === 8;

    // Primero buscar en la base de datos
    this.usersService.getUserByDocNumber(docTrimmed).subscribe(
      (resExistentUser: User) => {
        if (resExistentUser?.user_id) {
          // Usuario existe en BD
          if (resExistentUser.role_system !== 'SN' && resExistentUser.role_system !== 'NINGUNO' && resExistentUser.role_system !== '') {
            this.clean();
            this.toastr.warning('El usuario ya existe en el sistema');
          } else {
            this.toastr.success('Datos obtenidos correctamente desde BD');
            this.userToAdd = resExistentUser;
          }
        } else {
          // No existe en BD
          // Solo usar RENIEC si es DNI (8 dígitos)
          if (isDni) {
            this.fetchFromReniec(docTrimmed);
          } else {
            // Es Carné de Extranjería u otro documento: solo busca en BD
            this.toastr.info('No se encontraron datos en el sistema. Completa los datos manualmente.');
            this.clean();
          }
        }
      },
      (error: any) => {
        console.error('Error consultando BD:', error);
        // Fallback a RENIEC solo si es DNI (8 dígitos)
        if (isDni) {
          this.fetchFromReniec(docTrimmed);
        } else {
          this.toastr.error('Error consultando BD. Completa los datos manualmente.');
          this.clean();
        }
      }
    );
  }

  private fetchFromReniec(doc_number: string){
    this.usersService.getUserFromReniec(doc_number).subscribe(
      (resReniecUser: any) => {
        if (resReniecUser && resReniecUser['success'] && resReniecUser['data']) {
          this.toastr.success('Datos obtenidos desde RENIEC');
          this.userToAdd.type_doc = 'DNI';
          this.userToAdd.first_name = resReniecUser['data']['nombres'] || '';
          this.userToAdd.paternal_surname = resReniecUser['data']['apellido_paterno'] || '';
          this.userToAdd.maternal_surname = resReniecUser['data']['apellido_materno'] || '';
          
          const sexo = (resReniecUser['data']['sexo'] || '').toString().toUpperCase();
          this.userToAdd.gender = (sexo === 'FEMENINO' || sexo === 'F') ? 'F' : (sexo === 'MASCULINO' || sexo === 'M') ? 'M' : sexo || '';
          
          this.userToAdd.birth_date = resReniecUser['data']['fecha_nacimiento'] || '';
          this.userToAdd.civil_status = resReniecUser['data']['estado_civil'] || '';
          this.userToAdd.address_reniec = resReniecUser['data']['direccion_completa'] || '';
          this.userToAdd.district = resReniecUser['data']['distrito'] || '';
          this.userToAdd.province = resReniecUser['data']['provincia'] || '';
          this.userToAdd.region = resReniecUser['data']['departamento'] || '';
        } else {
          this.noData();
        }
      },
      (error: any) => {
        console.error('Error consultando RENIEC:', error);
        this.toastr.error('Error consultando RENIEC. Completa los datos manualmente.');
        this.clean();
      }
    );
  }

  noData(){
    this.clean();
    this.toastr.info('No se encontraron datos');

  }

  newUser(){
    if (!this.assertCanManageResidents()) {
      return;
    }
    this.userToAdd = User.empty();
    this.enableSystemAccessNew = false;
    this.currentCategoryOptions = this.isResidentOnlyMyHouse ? ['RESIDENTE'] : [...this.residentCategories];
    this.userToAdd.property_category = 'RESIDENTE';
    this.userToAdd.role_system = 'USUARIO';
    this.userToAdd.house_id = this.userOnSes.house_id ?? 0;
    this.userToAdd.force_password_change = 1;
    document.getElementById('myhouse-new-user-button')?.click();
  }

  newTenant(){
    this.userToAdd = User.empty();
    this.enableSystemAccessNew = false;
    this.currentCategoryOptions = [...this.tenantCategories];
    this.userToAdd.property_category = 'INQUILINO';
    this.userToAdd.role_system = 'USUARIO';
    this.userToAdd.house_id = this.userOnSes.house_id ?? 0;
    this.userToAdd.force_password_change = 1;
    document.getElementById('myhouse-new-user-button')?.click();
  }

  editUser(user: User): void {
    const catEdit = this.normalizeCategory(
      (user as any).property_category || (user as any).person_type || (user as any).relation_type
    );
    if (this.isTenantRestrictedInMyHouse && ['PROPIETARIO', 'RESIDENTE'].includes(catEdit)) {
      this.toastr.warning('No tienes permiso para editar datos de propietarios o residentes.');
      return;
    }
    if (this.isResidentOnlyMyHouse && catEdit === 'PROPIETARIO') {
      this.toastr.warning('Como residente no puedes editar datos de propietarios.');
      return;
    }
    this.userToEdit = { ...user } as User;
    this.userToEdit.house_id = this.userOnSes.house_id ?? this.userToEdit.house_id;
    this.enableSystemAccessEdit = this.hasSystemAccess(this.userToEdit);
    this.currentCategoryOptions =
      ((this.userToEdit.property_category || '').toUpperCase() === 'INQUILINO')
        ? [...this.tenantCategories]
        : this.isResidentOnlyMyHouse
          ? ['RESIDENTE']
          : [...this.residentCategories];
    this.userToEdit.force_password_change = Number((this.userToEdit as any).force_password_change || 0);
    const g = (this.userToEdit.gender || '').toString().toUpperCase();
    this.userToEdit.gender = (g === 'FEMENINO' || g === 'F') ? 'F' : (g === 'MASCULINO' || g === 'M') ? 'M' : g || '';

    const normalizeFromDb = (resUser: any): void => {
      if (!resUser) {
        return;
      }
      if (resUser.user_id) {
        this.userToEdit.user_id = resUser.user_id;
        this.userToEdit.username_system = resUser.username_system || '';
        // En Mi casa solo se gestiona acceso de residente (rol fijo en UI).
        this.userToEdit.role_system = 'USUARIO';
        this.userToEdit.status_system = resUser.status_system || 'ACTIVO';
        this.userToEdit.status_validated = resUser.status_validated || this.userToEdit.status_validated;
        this.userToEdit.status_reason = resUser.status_reason || this.userToEdit.status_reason;
        this.userToEdit.force_password_change = Number((resUser as any).force_password_change || 0);
        this.enableSystemAccessEdit = true;
      } else {
        this.enableSystemAccessEdit = false;
        this.userToEdit.user_id = 0;
        this.userToEdit.username_system = '';
        this.userToEdit.role_system = '';
        this.userToEdit.force_password_change = 0;
      }
    };

    const userId = Number((user as any).user_id || 0);
    if (userId > 0) {
      this.usersService.getUserById(userId).subscribe({
        next: (dbUser: any) => {
          normalizeFromDb({ ...dbUser, user_id: dbUser?.user_id ?? userId });
        },
        error: () => {
          const doc = (this.userToEdit.doc_number || '').trim();
          if (doc) {
            this.usersService.getUserByDocNumber(doc).subscribe({
              next: (resUser: User) => normalizeFromDb(resUser as any),
              error: () => {}
            });
          }
        }
      });
    } else {
      const doc = (this.userToEdit.doc_number || '').trim();
      if (doc) {
        this.usersService.getUserByDocNumber(doc).subscribe({
          next: (resUser: User) => normalizeFromDb(resUser as any),
          error: () => {}
        });
      }
    }
    document.getElementById('myhouse-edit-user-button')?.click();
  }
  newVisit(){
    this.userToAdd = User.empty();
    this.enableSystemAccessNew = false;
    this.userToAdd.property_category = 'INVITADO';
    this.userToAdd.role_system = '';
    this.userToAdd.username_system = '';
    this.userToAdd.force_password_change = 0;
    this.userToAdd.house_id = this.userOnSes.house_id ?? 0;
    this.userToAdd.status_validated = 'PERMITIDO';
    document.getElementById('myhouse-new-visit-button')?.click();
  }

  editVisit(user:User){
    this.userToEdit = { ...user } as User;
    this.enableSystemAccessEdit = false;
    this.userToEdit.property_category = 'INVITADO';
    this.userToEdit.role_system = '';
    this.userToEdit.username_system = '';
    this.userToEdit.force_password_change = 0;
    this.userToEdit.house_id = this.userOnSes.house_id ?? this.userToEdit.house_id;
    document.getElementById('myhouse-edit-visit-button')?.click();
  }

  saveNewVisit() {
    if (!this.validateUser(this.userToAdd)) {
      this.toastr.error('Por favor, completa todos los campos requeridos correctamente.');
      this.clean();
      return;
    }

    const newVisitPerson: any = {
      type_doc: this.userToAdd.type_doc || 'DNI',
      doc_number: this.userToAdd.doc_number,
      first_name: this.userToAdd.first_name,
      paternal_surname: this.userToAdd.paternal_surname,
      maternal_surname: this.userToAdd.maternal_surname || '',
      gender: this.userToAdd.gender || undefined,
      birth_date: this.userToAdd.birth_date || undefined,
      cel_number: this.userToAdd.cel_number || undefined,
      email: this.userToAdd.email || undefined,
      address: this.userToAdd.address_reniec || undefined,
      district: this.userToAdd.district || undefined,
      province: this.userToAdd.province || undefined,
      region: this.userToAdd.region || undefined,
      civil_status: this.userToAdd.civil_status || undefined,
      house_id: this.userOnSes.house_id,
      person_type: 'INVITADO',
      status_system: 'ACTIVO',
      status_validated: this.userToAdd.status_validated || 'PERMITIDO',
      status_reason: this.userToAdd.status_reason || ''
    };

    this.usersService.createPerson(newVisitPerson).subscribe({
      next: () => {
        this.toastr.success('Visita creada correctamente');
        this.handleSuccess();
      },
      error: (error) => {
        if (error?.error?.error && error.error.error.includes('documento')) {
          this.toastr.warning('Ya existe una persona con este documento');
        } else {
          this.toastr.error(error?.error?.error || 'Error al crear la visita.');
        }
        console.error(error);
      }
    });
  }

  saveEditVisit() {
    const personId = (this.userToEdit as any).person_id || (this.userToEdit as any).id;
    if (!personId) {
      this.toastr.error('No se puede editar la visita.');
      return;
    }

    const updateVisitPayload: any = {
      first_name: this.userToEdit.first_name,
      paternal_surname: this.userToEdit.paternal_surname,
      maternal_surname: this.userToEdit.maternal_surname,
      cel_number: this.userToEdit.cel_number,
      email: this.userToEdit.email,
      address: this.userToEdit.address_reniec,
      district: this.userToEdit.district,
      province: this.userToEdit.province,
      region: this.userToEdit.region,
      civil_status: this.userToEdit.civil_status,
      person_type: 'INVITADO',
      house_id: this.userOnSes.house_id,
      status_validated: this.userToEdit.status_validated || 'PERMITIDO',
      status_reason: this.userToEdit.status_reason || ''
    };

    this.usersService.updatePerson(personId, updateVisitPayload).subscribe({
      next: () => {
        this.toastr.success('Visita actualizada correctamente');
        this.handleSuccess();
      },
      error: (err) => {
        console.error(err);
        this.toastr.error('Error al actualizar la visita');
      }
    });
  }
  
  clean(){
    this.userToAdd = User.empty();
    this.userToEdit = User.empty();
    this.enableSystemAccessNew = false;
    this.enableSystemAccessEdit = false;
    this.currentCategoryOptions = [...this.residentCategories];
    this.vehicleToAdd = new Vehicle('', 'AUTOMOVIL', 0, 'PERMITIDO', '', '', 'RESIDENTE', '', '', '');
    this.vehicleToEdit = new Vehicle('', 'AUTOMOVIL', 0, 'PERMITIDO', '', '', 'RESIDENTE', '', '', '');
    this.externalVehicleToAdd = new ExternalVehicle('','','','','','','','',);
    this.externalVehicleToEdit = new ExternalVehicle('','','','','','','','',);
    this.petToAdd = { name: '', species: 'PERRO', breed: '', color: '', house_id: 0, status_validated: 'PERMITIDO', photo_url: undefined };
    this.petToEdit = {};
  }

  newPet(){
    this.petToAdd = {
      name: '',
      species: 'PERRO',
      breed: '',
      color: '',
      house_id: this.userOnSes.house_id ?? 0,
      status_validated: 'PERMITIDO',
      photo_url: undefined
    };
    document.getElementById('myhouse-new-pet-button')?.click();
  }

  onNewPetPhotoPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      this.toastr.warning('Seleccione una imagen (JPG, PNG o GIF).');
      return;
    }
    this.uploadingNewPetPhoto = true;
    this.publicReg.uploadPetPhoto(file).subscribe({
      next: (res) => {
        this.uploadingNewPetPhoto = false;
        if (res.success && res.photo_url) {
          this.petToAdd = { ...this.petToAdd, photo_url: res.photo_url };
          this.toastr.success('Foto cargada.');
        } else {
          this.toastr.error(res.error || 'Error al subir la foto.');
        }
        input.value = '';
      },
      error: (err) => {
        this.uploadingNewPetPhoto = false;
        this.toastr.error(err?.error?.error || err?.message || 'Error al subir la foto.');
        input.value = '';
      }
    });
  }

  clearNewPetPhoto(): void {
    this.petToAdd = { ...this.petToAdd, photo_url: undefined };
  }

  editPet(pet: Pet){
    if (!this.canTenantEditPet(pet)) {
      this.toastr.warning('Solo puedes editar mascotas registradas como tuyas.');
      return;
    }
    this.petToEdit = { ...pet };
    document.getElementById('myhouse-edit-pet-button')?.click();
  }

  saveNewPet(){
    if (!this.petToAdd.name?.trim() || !this.petToAdd.species || !this.petToAdd.house_id) {
      this.toastr.error('Nombre, especie y casa son obligatorios.');
      return;
    }
    if (this.isTenantRestrictedInMyHouse) {
      const pid = this.personIdSession();
      if (!pid) {
        this.toastr.error('No se encontró tu persona en sesión.');
        return;
      }
      this.petToAdd.owner_id = pid;
    }
    const petPayload: Partial<Pet> = { ...this.petToAdd };
    if (!petPayload.photo_url?.trim()) {
      delete petPayload.photo_url;
    }
    this.petsService.createPet(petPayload).subscribe({
      next: () => {
        this.toastr.success('Mascota registrada correctamente.');
        this.handleSuccess();
      },
      error: (err) => {
        this.toastr.error(err?.error?.error || 'Error al guardar la mascota.');
      }
    });
  }

  saveEditPet(){
    const id = this.petToEdit.id ?? (this.petToEdit as any).id;
    if (!id) {
      this.toastr.error('No se puede editar la mascota.');
      return;
    }
    if (!this.canTenantEditPet(this.petToEdit as Pet)) {
      this.toastr.warning('Solo puedes editar mascotas registradas como tuyas.');
      return;
    }
    if (!this.petToEdit.name?.trim() || !this.petToEdit.species) {
      this.toastr.error('Nombre y especie son obligatorios.');
      return;
    }
    if (this.isTenantRestrictedInMyHouse) {
      const pid = this.personIdSession();
      if (pid) {
        (this.petToEdit as any).owner_id = pid;
      }
    }
    this.petsService.updatePet(id, this.petToEdit).subscribe({
      next: () => {
        this.toastr.success('Mascota actualizada correctamente.');
        this.handleSuccess();
      },
      error: (err) => {
        this.toastr.error(err?.error?.error || 'Error al actualizar la mascota.');
      }
    });
  }

  private handleSuccess() {
    this.clean();
    this.ngOnInit();
  }

  /**
   * Misma regla que en Users: foto por defecto solo si hay género (F/M o FEMENINO/MASCULINO).
   */
  private optionalPhotoUrlByGender(gender: string | undefined | null): string | undefined {
    const g = (gender ?? '').toString().trim().toUpperCase();
    if (!g) {
      return undefined;
    }
    const origin = (environment.publicAppUrl || '').replace(/\/$/, '');
    const path = g === 'MASCULINO' || g === 'M' ? '/assets/user-male.png' : '/assets/user-female.png';
    return origin ? `${origin}${path}` : path;
  }

  saveNewUser() {
    if (!this.validateUser(this.userToAdd)) {
      this.toastr.error("Por favor, completa todos los campos requeridos correctamente.");
      this.clean();
      return;
    }

    const newPerson: any = {
      type_doc: this.userToAdd.type_doc || 'DNI',
      doc_number: this.userToAdd.doc_number,
      first_name: this.userToAdd.first_name,
      paternal_surname: this.userToAdd.paternal_surname,
      maternal_surname: this.userToAdd.maternal_surname || '',
      gender: this.userToAdd.gender || undefined,
      birth_date: this.userToAdd.birth_date || undefined,
      cel_number: this.userToAdd.cel_number || undefined,
      email: this.userToAdd.email || undefined,
      address: this.userToAdd.address_reniec || undefined,
      district: this.userToAdd.district || undefined,
      province: this.userToAdd.province || undefined,
      region: this.userToAdd.region || undefined,
      civil_status: this.userToAdd.civil_status || undefined,
      house_id: this.userOnSes.house_id,
      person_type: ((this.userToAdd as any).property_category || (this.userToAdd as any).person_type || 'RESIDENTE').toUpperCase(),
      status_system: 'ACTIVO',
      status_validated: 'PERMITIDO'
    };
    const photoUrl = this.optionalPhotoUrlByGender(this.userToAdd.gender);
    if (photoUrl) {
      newPerson.photo_url = photoUrl;
    }

    if (this.enableSystemAccessNew) {
      this.userToAdd.role_system = 'USUARIO';
      if (!this.userToAdd.username_system?.trim()) {
        this.toastr.warning('Para acceso al sistema, completa Usuario.');
        return;
      }
    }

    this.usersService.createPerson(newPerson).subscribe({
      next: (resCreate: any) => {
        const personId = Number(resCreate?.data?.id || resCreate?.id || 0);
        if (!this.enableSystemAccessNew) {
          this.toastr.success('Persona creada correctamente');
          this.handleSuccess();
          return;
        }

        if (!personId) {
          this.toastr.warning('Persona creada, pero no se pudo activar acceso al sistema.');
          this.handleSuccess();
          return;
        }

        this.usersService.createUserFromPerson({
          person_id: personId,
          username_system: this.userToAdd.username_system.trim(),
          password_system: this.userToAdd.doc_number.trim(),
          role_system: 'USUARIO',
          force_password_change: Number(this.userToAdd.force_password_change ? 1 : 0)
        }).subscribe({
          next: () => {
            this.toastr.success('Persona y acceso al sistema creados correctamente');
            this.handleSuccess();
          },
          error: (errUser) => {
            this.toastr.warning(errUser?.error?.error || 'Persona creada, pero no se pudo crear acceso al sistema.');
            this.handleSuccess();
          }
        });
      },
      error: (error) => {
        if (error?.error?.error && error.error.error.includes('documento')) {
          this.toastr.warning('Ya existe una persona con este documento');
        } else {
          this.toastr.error(error?.error?.error || 'Error al crear la persona.');
        }
        console.error(error);
      }
    });
  }
  
  private validateUser(user: User): boolean {
    if (!user.doc_number || user.doc_number.trim().length < 8) return false;
    if (!user.first_name) return false;
    if (this.enableSystemAccessNew) {
      if (!user.username_system || !user.username_system.trim()) return false;
    }
    // Agrega más validaciones según sea necesario.
    return true;
  }

  saveEditUser(){
    const personId = (this.userToEdit as any).person_id || (this.userToEdit as any).id;
    if (personId) {
      const updatePersonPayload: any = {
        first_name: this.userToEdit.first_name,
        paternal_surname: this.userToEdit.paternal_surname,
        maternal_surname: this.userToEdit.maternal_surname,
        cel_number: this.userToEdit.cel_number,
        email: this.userToEdit.email,
        address: this.userToEdit.address_reniec,
        district: this.userToEdit.district,
        province: this.userToEdit.province,
        region: this.userToEdit.region,
        civil_status: this.userToEdit.civil_status,
        person_type: ((this.userToEdit as any).property_category || (this.userToEdit as any).person_type || 'RESIDENTE').toUpperCase(),
        house_id: this.userOnSes.house_id
      };
      this.usersService.updatePerson(personId, updatePersonPayload).subscribe({
        next: () => {
          if (!this.enableSystemAccessEdit) {
            this.toastr.success('Persona actualizada correctamente');
            this.handleSuccess();
            return;
          }

          if (!this.userToEdit.username_system?.trim() || !this.userToEdit.role_system?.trim()) {
            this.userToEdit.role_system = 'USUARIO';
          }

          if (!this.userToEdit.username_system?.trim()) {
            this.toastr.warning('Persona actualizada, pero falta Usuario para activar acceso.');
            this.handleSuccess();
            return;
          }

          if (this.userToEdit.user_id) {
            const forcePw = Number(this.userToEdit.force_password_change ? 1 : 0);
            const userPayload: any = {
              user_id: this.userToEdit.user_id,
              username_system: this.userToEdit.username_system.trim(),
              role_system: 'USUARIO',
              house_id: this.userOnSes.house_id,
              status_system: this.userToEdit.status_system || 'ACTIVO',
              status_validated: this.userToEdit.status_validated || 'PERMITIDO',
              status_reason: this.userToEdit.status_reason || '',
              force_password_change: forcePw
            };
            if (forcePw === 1) {
              userPayload.password_system = (this.userToEdit.doc_number || '').toString().trim();
            }
            this.usersService.updateUser(userPayload).subscribe({
              next: () => {
                this.toastr.success('Persona y acceso al sistema actualizados correctamente');
                this.handleSuccess();
              },
              error: () => {
                this.toastr.warning('Persona actualizada, pero no se pudo actualizar el acceso al sistema.');
                this.handleSuccess();
              }
            });
            return;
          }

          this.usersService.createUserFromPerson({
            person_id: Number(personId),
            username_system: this.userToEdit.username_system.trim(),
            password_system: this.userToEdit.doc_number.trim(),
            role_system: 'USUARIO',
            force_password_change: Number(this.userToEdit.force_password_change ? 1 : 0)
          }).subscribe({
            next: () => {
              this.toastr.success('Persona actualizada y acceso al sistema creado correctamente');
              this.handleSuccess();
            },
            error: () => {
              this.toastr.warning('Persona actualizada, pero no se pudo crear acceso al sistema.');
              this.handleSuccess();
            }
          });
        },
        error: (err) => {
          console.error(err);
          this.toastr.error('Error al actualizar la persona');
        }
      });
      return;
    }

    // Fallback: actualizar usuario si no tiene person_id
    this.usersService.updateUser(this.userToEdit).subscribe(resUpdateUser=>{
      if(resUpdateUser){
        this.toastr.success('Usuario actualizado correctamente');
        this.handleSuccess();
      }
    })
  }
// VEHÍCULOS DE RESIDENTES

  requiresVehiclePlateType(type: string | undefined): boolean {
    return vehicleTypeRequiresLicensePlate(type);
  }

  requiresVehiclePhotoType(type: string | undefined): boolean {
    return vehicleTypeRequiresVehiclePhoto(type);
  }

  onNewVehicleTypeChange(): void {
    if (vehicleTypeRequiresLicensePlate(this.vehicleToAdd.type_vehicle)) {
      return;
    }
    this.vehicleToAdd.license_plate = '';
  }

  onEditVehicleTypeChange(): void {
    if (vehicleTypeRequiresLicensePlate(this.vehicleToEdit.type_vehicle)) {
      return;
    }
    this.vehicleToEdit.license_plate = '';
  }

  onNewVehiclePhotoPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      this.toastr.warning('Seleccione una imagen (JPG, PNG o GIF).');
      return;
    }
    this.uploadingNewVehiclePhoto = true;
    this.publicReg.uploadVehiclePhoto(file).subscribe({
      next: (res) => {
        this.uploadingNewVehiclePhoto = false;
        if (res.success && res.photo_url) {
          this.vehicleToAdd.photo_url = res.photo_url;
          this.toastr.success('Foto del vehículo cargada.');
        } else {
          this.toastr.error(res.error || 'Error al subir la foto.');
        }
        input.value = '';
      },
      error: (err) => {
        this.uploadingNewVehiclePhoto = false;
        this.toastr.error(err?.error?.error || err?.message || 'Error al subir la foto.');
        input.value = '';
      }
    });
  }

  newVehicle(): void {
    const houseId = this.userOnSes.house_id ?? 0;
  this.vehicleToAdd.house_id = houseId;
  if (!this.vehicleToAdd.type_vehicle) this.vehicleToAdd.type_vehicle = 'AUTOMOVIL';
  if (this.isTenantRestrictedInMyHouse) {
    this.vehicleToAdd.category_entry = 'INQUILINO';
    const pid = this.personIdSession();
    if (pid) {
      (this.vehicleToAdd as any).owner_id = pid;
    }
  } else {
    const pid = this.personIdSession();
    if (pid) {
      (this.vehicleToAdd as any).owner_id = pid;
    }
    if (!this.vehicleToAdd.category_entry) {
      this.vehicleToAdd.category_entry = 'RESIDENTE';
    }
  }
  if (!this.vehicleToAdd.status_validated) this.vehicleToAdd.status_validated = 'PERMITIDO';
  if (this.houses.length === 0 && houseId) {
    this.houses = [{ house_id: houseId, block_house: '—', lot: null, apartment: null } as House];
  }
  document.getElementById('myhouse-new-vehicle-button')?.click();
}

editVehicle(vehicle:Vehicle){
  if (!this.canTenantEditVehicle(vehicle)) {
    this.toastr.warning('Solo puedes editar vehículos de categoría INQUILINO registrados a tu nombre.');
    return;
  }
  this.vehicleToEdit = vehicle;
  document.getElementById('myhouse-edit-vehicle-button')?.click();
}

saveEditVehicle(){
  if (!this.vehicleToEdit.house_id || !this.vehicleToEdit.type_vehicle) {
    this.toastr.error('Los campos obligatorios no pueden estar vacíos');
    this.clean();
    return;
  }
  const t = this.vehicleToEdit.type_vehicle;
  if (vehicleTypeRequiresLicensePlate(t)) {
    if (!(this.vehicleToEdit.license_plate ?? '').toString().trim()) {
      this.toastr.error('La placa es obligatoria para este tipo de vehículo.');
      this.clean();
      return;
    }
  } else if (!(this.vehicleToEdit.photo_url ?? '').toString().trim()) {
    this.toastr.error('Para bicicleta y moto eléctrica debe tener foto del vehículo.');
    return;
  }
  if (!this.canTenantEditVehicle(this.vehicleToEdit)) {
    this.toastr.warning('Solo puedes editar vehículos de categoría INQUILINO registrados a tu nombre.');
    return;
  }
  if (this.isTenantRestrictedInMyHouse) {
    const pid = this.personIdSession();
    if (pid) {
      (this.vehicleToEdit as any).owner_id = pid;
    }
    this.vehicleToEdit.category_entry = 'INQUILINO';
  }
  const payloadEdit = { ...this.vehicleToEdit } as Vehicle;
  if (!vehicleTypeRequiresLicensePlate(t)) {
    (payloadEdit as any).license_plate = null;
  }
  this.entranceService.updateVehicle(payloadEdit).subscribe({
    next:(resUpdate:any)=>{
      if(resUpdate.success){
        this.toastr.success(resUpdate.message);
        this.toastr.success('Vehículo actualizado correctamente');
        this.handleSuccess();
      }
      else{
        this.toastr.error('Error al actualizar el vehículo');
      }
    },
    error:()=>{
      this.toastr.error('Error al actualizar el vehículo')
    },
  })
}

saveNewVehicle(): void {
  const houseId = this.userOnSes.house_id ?? 0;
  this.vehicleToAdd.house_id = houseId;

  if (!this.vehicleToAdd.house_id || !this.vehicleToAdd.type_vehicle) {
    this.toastr.error('Los campos obligatorios no pueden estar vacíos');
    this.clean();
    return;
  }
  const tv = this.vehicleToAdd.type_vehicle;
  if (vehicleTypeRequiresLicensePlate(tv)) {
    if (!(this.vehicleToAdd.license_plate ?? '').toString().trim()) {
      this.toastr.error('La placa es obligatoria para este tipo de vehículo.');
      this.clean();
      return;
    }
  } else if (!(this.vehicleToAdd.photo_url ?? '').toString().trim()) {
    this.toastr.error('Para bicicleta y moto eléctrica debe subir una foto del vehículo.');
    return;
  }
  if (this.isTenantRestrictedInMyHouse) {
    const pid = this.personIdSession();
    if (!pid) {
      this.toastr.error('No se encontró tu persona en sesión.');
      return;
    }
    this.vehicleToAdd.category_entry = 'INQUILINO';
    (this.vehicleToAdd as any).owner_id = pid;
  } else {
    const pid = this.personIdSession();
    if (pid) {
      (this.vehicleToAdd as any).owner_id = pid;
    }
  }
  //HASTA AQUÍ
  this.vehicleToAdd.status_system='ACTIVO'
  if (!this.vehicleToAdd.status_validated){
    this.vehicleToAdd.status_validated='PERMITIDO'
  }
  const payloadNew = { ...this.vehicleToAdd } as Vehicle;
  if (!vehicleTypeRequiresLicensePlate(tv)) {
    (payloadNew as any).license_plate = null;
  }
  this.entranceService.addVehicle(payloadNew).subscribe({
    next:(res:any)=>{
      if(res.success){
        this.toastr.success(res.message);
        this.toastr.success('Vehículo guardado correctamente');
        this.handleSuccess();
      } else {
        this.toastr.error('Error al guardar el vehículo');
      }
    },
    error:(err)=>{
      console.error(err);
      this.toastr.error('Error al guardar el vehículo')
    }
  });
}


  //EXTERNAL VEHICLE
  onNewExternalVisitPhotoPick(event: Event): void {
    this.onExternalVisitPhotoPick(event, 'add');
  }

  onEditExternalVisitPhotoPick(event: Event): void {
    this.onExternalVisitPhotoPick(event, 'edit');
  }

  clearExternalVisitPhoto(mode: 'add' | 'edit'): void {
    const target = mode === 'add' ? this.externalVehicleToAdd : this.externalVehicleToEdit;
    target.photo_url = undefined;
  }

  private onExternalVisitPhotoPick(event: Event, mode: 'add' | 'edit'): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      this.toastr.warning('Seleccione una imagen (JPG, PNG o GIF).');
      return;
    }
    const target = mode === 'add' ? this.externalVehicleToAdd : this.externalVehicleToEdit;
    if (mode === 'add') {
      this.uploadingNewExternalVehiclePhoto = true;
    } else {
      this.uploadingEditExternalVehiclePhoto = true;
    }
    this.publicReg.uploadVehiclePhoto(file).subscribe({
      next: (res) => {
        if (mode === 'add') {
          this.uploadingNewExternalVehiclePhoto = false;
        } else {
          this.uploadingEditExternalVehiclePhoto = false;
        }
        if (res.success && res.photo_url) {
          target.photo_url = res.photo_url;
          this.toastr.success('Foto de la visita cargada.');
        } else {
          this.toastr.error(res.error || 'Error al subir la foto.');
        }
        input.value = '';
      },
      error: (err) => {
        if (mode === 'add') {
          this.uploadingNewExternalVehiclePhoto = false;
        } else {
          this.uploadingEditExternalVehiclePhoto = false;
        }
        this.toastr.error(err?.error?.error || err?.message || 'Error al subir la foto.');
        input.value = '';
      },
    });
  }

  newExternalVehicle(){
    this.externalDurationMinutes = 120;
    this.externalVehicleToAdd = new ExternalVehicle('','','','','DELIVERY','PERMITIDO','','ACTIVO');
    document.getElementById('myhouse-new-external-vehicle-button')?.click();
  }

  editExternalVehicle(externalVehicle: ExternalVehicle) {
    this.externalVehicleToEdit = { ...externalVehicle } as ExternalVehicle;
    const tid = (externalVehicle as any).temp_visit_id ?? (externalVehicle as any).id;
    if (tid) {
      (this.externalVehicleToEdit as any).id = tid;
    }
    document.getElementById('myhouse-edit-external-vehicle-button')?.click();
  }

  saveEditExternalVehicle(){
    // Validar campos obligatorios
    if (
      !this.externalVehicleToEdit.temp_visit_plate?.trim() ||
      !this.externalVehicleToEdit.temp_visit_doc?.trim() ||
      !this.externalVehicleToEdit.temp_visit_name?.trim()
    ) {
      this.toastr.error('Los campos obligatorios no pueden estar vacíos');
      this.clean();
      return;
    }
  
    this.entranceService.updateExternalVehicle(this.externalVehicleToEdit).subscribe({
      next: (resUpdateExternalVehicle: any) => {
        if (resUpdateExternalVehicle.success) {
          this.toastr.success(resUpdateExternalVehicle.message);
          this.toastr.success('Visita externa actualizada correctamente');
          this.handleSuccess();
        } else {
          this.toastr.error('Error al actualizar la visita externa');
        }
      },
      error: (err) => {
        console.error(err);
        this.toastr.error('Error al actualizar la visita externa');
      },
    });
  }
  
  saveNewExternalVehicle(): void {
    // Validar campos obligatorios
    if (
      !this.externalVehicleToAdd.temp_visit_plate?.trim() ||
      !this.externalVehicleToAdd.temp_visit_doc?.trim() ||
      !this.externalVehicleToAdd.temp_visit_name?.trim()
    ) {
      this.toastr.error('Los campos obligatorios no pueden estar vacíos');
      this.clean();
      return;
    }
  
    this.externalVehicleToAdd.status_system = 'ACTIVO';

    if (!this.externalVehicleToAdd.status_validated) {
      this.externalVehicleToAdd.status_validated = 'PERMITIDO';
    }

    const houseId = Number(this.userOnSes.house_id) || 0;
    const payload = {
      ...this.externalVehicleToAdd,
      house_id: houseId,
      duration_minutes: this.externalDurationMinutes,
    } as ExternalVehicle;

    this.entranceService.addExternalVehicle(payload).subscribe({
      next: (res: any) => {
        if (res.success) {
          this.toastr.success(res.message);
          this.handleSuccess();
        } else {
          this.toastr.error('Error al guardar la visita externa');
        }
      },
      error: (err) => {
        console.error(err);
        this.toastr.error('Error al guardar la visita externa');
      },
    });
  }
  


 
  /* SIWTCH ON/OFF
  toggleStatus(vehicle: any): void {
    // Alternar el estado entre 'ACTIVO' e 'INACTIVO'
    vehicle.status_system = vehicle.status_system === 'ACTIVO' ? 'INACTIVO' : 'ACTIVO';
  
    // Realizar una actualización en el servidor
    this.entranceService.updateVehicle(vehicle).subscribe({
      next: (res: any) => {
        if (res.success) {
          this.toastr.success(`Estado actualizado a ${vehicle.status_system}`);
        } else {
          this.toastr.error('Error al actualizar el estado');
        }
      },
      error: (err) => {
        console.error('Error al actualizar el estado:', err);
        this.toastr.error('Error al actualizar el estado');
      }
    });
  }*/

  /** Sube la foto del vehículo y actualiza su foto_url en el servidor */
  onVehiclePhotoSelect(vehicleIndex: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      this.toastr.warning('Seleccione una imagen (JPG, PNG o GIF).');
      return;
    }
    
    const vehicle = this.myVehicles[vehicleIndex];
    if (!vehicle) {
      this.toastr.error('Vehículo no encontrado.');
      return;
    }
    if (!this.canTenantEditVehicle(vehicle)) {
      this.toastr.warning('No puedes actualizar la foto de este vehículo.');
      return;
    }

    this.uploadingVehicleIndex = vehicleIndex;
    this.publicReg.uploadVehiclePhoto(file).subscribe({
      next: (res) => {
        this.uploadingVehicleIndex = -1;
        if (res.success && res.photo_url) {
          // Actualizar la foto_url en el servidor
          vehicle.photo_url = res.photo_url;
          this.entranceService.updateVehicle(vehicle).subscribe({
            next: (updateRes: any) => {
              if (updateRes.success) {
                this.toastr.success('Foto del vehículo cargada correctamente.');
              } else {
                this.toastr.warning('Foto subida pero error al guardar.');
              }
            },
            error: () => {
              this.toastr.warning('Foto subida pero error al guardar.');
            }
          });
        } else {
          this.toastr.error(res.error || 'Error al subir la foto.');
        }
        input.value = '';
      },
      error: (err) => {
        this.uploadingVehicleIndex = -1;
        this.toastr.error(err?.error?.error || err?.message || 'Error al subir la foto.');
        input.value = '';
      }
    });
  }

  /** Sube la foto de la mascota y actualiza su photo_url en el servidor */
  onPetPhotoSelect(petIndex: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      this.toastr.warning('Seleccione una imagen (JPG, PNG o GIF).');
      return;
    }

    const pet = this.myPets[petIndex];
    if (!pet) {
      this.toastr.error('Mascota no encontrada.');
      return;
    }
    if (!this.canTenantEditPet(pet)) {
      this.toastr.warning('No puedes actualizar la foto de esta mascota.');
      return;
    }

    this.uploadingPetIndex = petIndex;
    this.publicReg.uploadPetPhoto(file).subscribe({
      next: (res) => {
        this.uploadingPetIndex = -1;
        if (res.success && res.photo_url) {
          // Actualizar la photo_url en el servidor
          pet.photo_url = res.photo_url;
          this.petsService.updatePet(pet.id || (pet as any).id, pet).subscribe({
            next: (updateRes: any) => {
              if (updateRes.success || updateRes.message) {
                this.toastr.success('Foto de la mascota cargada correctamente.');
              } else {
                this.toastr.warning('Foto subida pero error al guardar.');
              }
            },
            error: () => {
              this.toastr.warning('Foto subida pero error al guardar.');
            }
          });
        } else {
          this.toastr.error(res.error || 'Error al subir la foto.');
        }
        input.value = '';
      },
      error: (err) => {
        this.uploadingPetIndex = -1;
        this.toastr.error(err?.error?.error || err?.message || 'Error al subir la foto.');
        input.value = '';
      }
    });
  }

}



