import { AfterViewInit, Component, OnInit } from '@angular/core';
import { User } from '../user';
import { UsersService } from '../users.service';
import { initFlowbite } from 'flowbite';
import { House } from '../house';
import { EntranceService } from '../entrance.service';
import { ToastrService } from 'ngx-toastr';
import { environment } from '../../environments/environment';
import { isStaffRoleSystemValue } from '../system-roles';
import { AuthService } from '../auth.service';
import { NavPermissionService } from '../nav-permission.service';
import { ExpandableRowId, isExpandableRowOpen, toggleExpandableRow } from '../shared/expandable-row';

@Component({
  selector: 'app-users',
  templateUrl: './users.component.html',
  styleUrls: ['./users.component.css']
})
export class UsersComponent implements OnInit, AfterViewInit{

  users: User[] = [];
  userToAdd: User = User.empty();
  userToEdit: User = User.empty();

  /** Pestaña activa: 'users' | 'persons' */
  activeTab: 'users' | 'persons' = 'users';
  /** Contexto del modal Nuevo/Editar */
  modalMode: 'users' | 'persons' = 'users';
  enableSystemAccessNew = true;
  enableSystemAccessEdit = true;

  /** Personas registradas que aún no tienen usuario (para "Dar acceso") */
  personsWithoutUser: any[] = [];
  loadingPersonsWithoutUser = false;
  hasLoadedPersonsWithoutUser = false;
  giveAccessPerson: any = null;
  giveAccessUsername = '';
  giveAccessPassword = '';
  giveAccessRole = 'USUARIO';
  savingGiveAccess = false;

  typeDocs: string[] = ['DNI','CE'];
  genders: string[] = ['MASCULINO','FEMENINO'];
  roles: string[] = ['USUARIO', 'ADMINISTRADOR', 'OPERARIO'];
  status: string[] = ['ACTIVO', 'INACTIVO']
  houses: House[] = [];
  status_validated: string[] = ['PERMITIDO','DENEGADO','OBSERVADO'];
  categories: string[] = ['PROPIETARIO','RESIDENTE','INVITADO','INQUILINO'];
  categoriesNewUser: string[] = ['PROPIETARIO','RESIDENTE','INQUILINO'];
  /** Filtro y listados en pestaña Personas (orden solicitado). */
  categoriesPersonsFilter: string[] = ['PROPIETARIO', 'RESIDENTE', 'INQUILINO', 'INVITADO'];
  
  searchTerm: string = '';
  selectedBlock: string = '';
  selectedLot: string = '';
  selectedUserCategory: string = '';
  personsSearchTerm: string = '';
  personsSelectedBlock: string = '';
  personsSelectedLot: string = '';
  personsSelectedCategory: string = '';
  usersCurrentPage: number = 1;
  usersPageSize: number = 10;
  personsCurrentPage: number = 1;
  personsPageSize: number = 10;
  pageSizeOptions: number[] = [10, 25, 50, 100];

  /** Fila expandida en móvil (tabla unificada) */
  expandedUsersRowId: ExpandableRowId = null;
  expandedPersonsRowId: ExpandableRowId = null;
  readonly usersTableColspan = 9;
  readonly personsTableColspan = 8;

  constructor(
    private usersService: UsersService,
    private entranceService: EntranceService,
    private toastr: ToastrService,
    private auth: AuthService,
    private navPerm: NavPermissionService,
  ) {}

  get canManageUsers(): boolean {
    return this.navPerm.canManage('users');
  }

  get isStaffReadOnlyUsers(): boolean {
    return this.navPerm.canView('users') && !this.navPerm.canManage('users');
  }

  ngOnInit(){
    this.usersService.getAllUsers().subscribe((res: any) => {
      const list = Array.isArray(res) ? res : (res?.data ?? []);
      this.users = list;
    });
    this.entranceService.getAllHouses().subscribe((resHouses: any) => {
      const list = Array.isArray(resHouses) ? resHouses : (resHouses?.data ?? []);
      this.houses = list;
    });
  }

  ngAfterViewInit(){
    initFlowbite();
  }

  /** Categoría de domicilio para listados (person_type / property_category). */
  listCategoryLabel(u: User | any): string {
    const raw = (u?.property_category ?? u?.person_type ?? '').toString().trim().toUpperCase();
    return raw || '-';
  }

  getHouseLocation(u: User): string {
    const house = this.houses.find(h => h.house_id === u.house_id);
    const mz = (house?.block_house ?? u.block_house ?? '-').toString().toUpperCase();
    const lt = (house?.lot ?? u.lot ?? '-').toString().toUpperCase();
    const apt = (house?.apartment ?? u.apartment ?? '').toString().trim();
    let output = `MZ:${mz} LT:${lt}`;
    if (apt !== '') {
      output += ` DPTO:${apt.toUpperCase()}`;
    }
    return output;
  }

  getPhotoUrl(photoUrl: string): string {
    if (!photoUrl) return '';
    if (photoUrl.startsWith('http://') || photoUrl.startsWith('https://')) {
      const pub = (environment.publicAppUrl || '').replace(/\/$/, '');
      if (pub) {
        try {
          const parsed = new URL(photoUrl);
          if (parsed.pathname.startsWith('/assets/')) {
            const apiOrigin = new URL(
              environment.baseUrl.endsWith('/') ? environment.baseUrl : `${environment.baseUrl}/`
            ).origin;
            if (parsed.origin === apiOrigin) {
              return `${pub}${parsed.pathname}${parsed.search}`;
            }
          }
        } catch {
          /* seguir */
        }
      }
      return photoUrl;
    }
    // Misma lógica que ApiService.getPhotoUrl: /assets/ se sirve desde publicAppUrl, no desde el API
    if (photoUrl.startsWith('/assets/')) {
      const origin = (environment.publicAppUrl || '').replace(/\/$/, '');
      return origin ? `${origin}${photoUrl}` : photoUrl;
    }
    if (photoUrl.startsWith('/')) {
      return environment.baseUrl + photoUrl;
    }
    return photoUrl;
  }

  get filteredUsers(): User[] {
    if (
      !this.searchTerm.trim() &&
      !this.selectedBlock &&
      !this.selectedLot &&
      !this.selectedUserCategory
    ) {
      return this.users;
    }
    const search = this.searchTerm.toLowerCase();
    return this.users.filter(u => {
      const matchesSearch = !this.searchTerm.trim() || 
        `${u.paternal_surname} ${u.maternal_surname} ${u.first_name}`.toLowerCase().includes(search) ||
        u.username_system.toLowerCase().includes(search) ||
        (u.cel_number && u.cel_number.toLowerCase().includes(search));
      
      const house = this.houses.find(h => h.house_id === u.house_id);
      const blockVal = (house?.block_house ?? u.block_house ?? '').toString();
      const lotVal = (house?.lot ?? u.lot ?? '').toString();
      
      const matchesBlock = !this.selectedBlock || blockVal === this.selectedBlock;
      const matchesLot = !this.selectedLot || lotVal === this.selectedLot;
      const cat = this.listCategoryLabel(u);
      const matchesCategory =
        !this.selectedUserCategory ||
        (cat !== '-' && cat === this.selectedUserCategory);
      
      return matchesSearch && matchesBlock && matchesLot && matchesCategory;
    });
  }

  get uniqueBlocks(): string[] {
    return [...new Set(this.houses.map(h => h.block_house.toString()))].sort();
  }

  get uniqueLots(): string[] {
    const filtered = this.selectedBlock 
      ? this.houses.filter(h => h.block_house.toString() === this.selectedBlock)
      : this.houses;
    return [...new Set(filtered.map(h => h.lot.toString()))].sort((a, b) => parseInt(a) - parseInt(b));
  }

  get usersTotalPages(): number {
    return Math.max(1, Math.ceil(this.filteredUsers.length / this.usersPageSize));
  }

  get paginatedUsers(): User[] {
    const safePage = Math.min(this.usersCurrentPage, this.usersTotalPages);
    if (safePage !== this.usersCurrentPage) {
      this.usersCurrentPage = safePage;
    }
    const start = (safePage - 1) * this.usersPageSize;
    return this.filteredUsers.slice(start, start + this.usersPageSize);
  }

  get personsTotalPages(): number {
    return Math.max(1, Math.ceil(this.filteredPersonsWithoutUser.length / this.personsPageSize));
  }

  get paginatedPersonsWithoutUser(): any[] {
    const safePage = Math.min(this.personsCurrentPage, this.personsTotalPages);
    if (safePage !== this.personsCurrentPage) {
      this.personsCurrentPage = safePage;
    }
    const start = (safePage - 1) * this.personsPageSize;
    return this.filteredPersonsWithoutUser.slice(start, start + this.personsPageSize);
  }

  get filteredPersonsWithoutUser(): any[] {
    if (
      !this.personsSearchTerm.trim() &&
      !this.personsSelectedBlock &&
      !this.personsSelectedLot &&
      !this.personsSelectedCategory
    ) {
      return this.personsWithoutUser;
    }

    const search = this.personsSearchTerm.toLowerCase();
    return this.personsWithoutUser.filter((p: any) => {
      const fullName = `${p.paternal_surname || ''} ${p.maternal_surname || ''} ${p.first_name || ''}`.toLowerCase();
      const doc = (p.doc_number || '').toString().toLowerCase();
      const cel = (p.cel_number || '').toString().toLowerCase();
      const email = (p.email || '').toString().toLowerCase();
      const matchesSearch = !this.personsSearchTerm.trim() ||
        fullName.includes(search) || doc.includes(search) || cel.includes(search) || email.includes(search);

      const house = this.houses.find(h => Number(h.house_id) === Number(p.house_id));
      const blockVal = (house?.block_house ?? p.block_house ?? '').toString();
      const lotVal = (house?.lot ?? p.lot ?? '').toString();
      const matchesBlock = !this.personsSelectedBlock || blockVal === this.personsSelectedBlock;
      const matchesLot = !this.personsSelectedLot || lotVal === this.personsSelectedLot;
      const cat = this.listCategoryLabel(p);
      const matchesCategory =
        !this.personsSelectedCategory ||
        (cat !== '-' && cat === this.personsSelectedCategory);

      return matchesSearch && matchesBlock && matchesLot && matchesCategory;
    });
  }

  onUsersPageSizeChange(): void {
    this.usersCurrentPage = 1;
    this.expandedUsersRowId = null;
  }

  onUsersFiltersChange(): void {
    this.usersCurrentPage = 1;
    this.expandedUsersRowId = null;
  }

  previousUsersPage(): void {
    if (this.usersCurrentPage > 1) {
      this.usersCurrentPage -= 1;
      this.expandedUsersRowId = null;
    }
  }

  nextUsersPage(): void {
    if (this.usersCurrentPage < this.usersTotalPages) {
      this.usersCurrentPage += 1;
      this.expandedUsersRowId = null;
    }
  }

  onPersonsPageSizeChange(): void {
    this.personsCurrentPage = 1;
    this.expandedPersonsRowId = null;
  }

  onPersonsFiltersChange(): void {
    this.personsCurrentPage = 1;
    this.expandedPersonsRowId = null;
  }

  previousPersonsPage(): void {
    if (this.personsCurrentPage > 1) {
      this.personsCurrentPage -= 1;
      this.expandedPersonsRowId = null;
    }
  }

  nextPersonsPage(): void {
    if (this.personsCurrentPage < this.personsTotalPages) {
      this.personsCurrentPage += 1;
      this.expandedPersonsRowId = null;
    }
  }

  getUserRowId(u: User): string | number {
    const id = Number((u as { user_id?: number }).user_id || 0);
    return id > 0 ? id : u.doc_number;
  }

  getPersonRowId(p: { id?: number; doc_number?: string }): string | number {
    const id = Number(p.id || 0);
    return id > 0 ? id : (p.doc_number ?? '');
  }

  isUsersRowOpen(u: User): boolean {
    return isExpandableRowOpen(this.expandedUsersRowId, this.getUserRowId(u));
  }

  toggleUsersRow(u: User): void {
    this.expandedUsersRowId = toggleExpandableRow(this.expandedUsersRowId, this.getUserRowId(u));
  }

  isPersonsRowOpen(p: { id?: number; doc_number?: string }): boolean {
    return isExpandableRowOpen(this.expandedPersonsRowId, this.getPersonRowId(p));
  }

  togglePersonsRow(p: { id?: number; doc_number?: string }): void {
    this.expandedPersonsRowId = toggleExpandableRow(this.expandedPersonsRowId, this.getPersonRowId(p));
  }

  searchUser(doc_number: string){
    this.usersService.getUserByDocNumber(doc_number).subscribe((resExistentUser:User)=>{
      if(resExistentUser.user_id){
        if(resExistentUser.role_system!='SN'&&resExistentUser.role_system!='NINGUNO'&&resExistentUser.role_system!=''){
          this.clean();
          this.toastr.warning('El usuario ya existe');
        }
        else{
          this.toastr.success('Datos obtenidos correctamente');
          this.userToAdd=resExistentUser;
        }
      }
      else if(doc_number.trim().length==8){
        this.usersService.getUserFromReniec(doc_number).subscribe((resReniecUser:any)=>{
          if(resReniecUser&&resReniecUser['success']){
            this.toastr.success('Datos obtenidos correctamente');
            this.userToAdd.type_doc='DNI';
            this.userToAdd.first_name=resReniecUser['data']['nombres'];
            this.userToAdd.paternal_surname=resReniecUser['data']['apellido_paterno'];
            this.userToAdd.maternal_surname=resReniecUser['data']['apellido_materno'];
            this.userToAdd.gender=resReniecUser['data']['sexo'];
            this.userToAdd.birth_date=resReniecUser['data']['fecha_nacimiento'];
            this.userToAdd.civil_status=resReniecUser['data']['estado_civil'];
            this.userToAdd.address_reniec=resReniecUser['data']['direccion_completa'];
            this.userToAdd.district=resReniecUser['data']['distrito'];
            this.userToAdd.province=resReniecUser['data']['provincia'];
            this.userToAdd.region=resReniecUser['data']['departamento'];
            this.onNewUserNameFieldsChange();
          }
          else{
            this.noData();
          }
        },(error:any)=>{
          this.noData();
        })
      }
      else{
        this.noData();
      }
    })
  }

  noData(){
    this.clean();
    this.toastr.info('No se encontraron datos');

  }

  clean(){
    this.userToAdd = User.empty();
    this.userToEdit = User.empty();
  }

  newUser(){
    this.modalMode = 'users';
    this.userToAdd = User.empty();
    this.userToAdd.force_password_change = 1;
    this.userToAdd.username_system = '';
    this.userToAdd.role_system = this.roles[0] || 'USUARIO';
    this.enableSystemAccessNew = true;
    document.getElementById('users-new-user-button')?.click();
  }

  newPerson(){
    this.modalMode = 'persons';
    this.userToAdd = User.empty();
    this.userToAdd.type_doc = 'DNI';
    this.userToAdd.status_validated = 'PERMITIDO';
    this.userToAdd.property_category = '';
    this.userToAdd.house_id = null as any;
    this.userToAdd.force_password_change = 0;
    this.userToAdd.role_system = '';
    this.userToAdd.username_system = '';
    this.enableSystemAccessNew = false;
    document.getElementById('users-new-user-button')?.click();
  }

  private normalizeUsernamePart(value: string): string {
    return (value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase();
  }

  private buildSuggestedUsername(firstName: string, paternalSurname: string): string {
    const initial = this.normalizeUsernamePart((firstName || '').trim()).charAt(0);
    const lastName = this.normalizeUsernamePart((paternalSurname || '').trim());
    return `${initial}${lastName}`;
  }

  private buildIncrementalUsername(base: string): string {
    const normalizedBase = (base || '').trim().toLowerCase();
    if (!normalizedBase) {
      return '';
    }

    const existing = new Set(
      (this.users || [])
        .map((u: any) => (u?.username_system || '').toString().trim().toLowerCase())
        .filter((u: string) => !!u)
    );

    let candidate = normalizedBase;
    let i = 2;
    while (existing.has(candidate)) {
      candidate = `${normalizedBase}${i}`;
      i += 1;
    }
    return candidate;
  }

  onNewUserNameFieldsChange(): void {
    if (this.modalMode === 'persons' && !this.enableSystemAccessNew) {
      return;
    }
    const base = this.buildSuggestedUsername(this.userToAdd.first_name, this.userToAdd.paternal_surname);
    this.userToAdd.username_system = this.buildIncrementalUsername(base);
  }

  private ensureSuggestedUsernameFor(target: User): void {
    if ((target.username_system || '').toString().trim()) {
      return;
    }
    const base = this.buildSuggestedUsername(target.first_name || '', target.paternal_surname || '');
    target.username_system = this.buildIncrementalUsername(base);
  }

  onToggleSystemAccessNew(): void {
    if (!this.enableSystemAccessNew) {
      this.userToAdd.username_system = '';
      this.userToAdd.role_system = '';
      this.userToAdd.force_password_change = 0;
      return;
    }
    this.userToAdd.role_system = this.roles[0] || 'USUARIO';
    this.userToAdd.force_password_change = 1;
    this.ensureSuggestedUsernameFor(this.userToAdd);
  }

  onToggleSystemAccessEdit(): void {
    if (this.enableSystemAccessEdit) {
      this.userToEdit.role_system = this.userToEdit.role_system || 'USUARIO';
      this.userToEdit.force_password_change = Number(this.userToEdit.force_password_change ? 1 : 0) || 1;
      this.ensureSuggestedUsernameFor(this.userToEdit);
    }
  }

  editUser(user:User){
    this.modalMode = 'users';
    this.enableSystemAccessEdit = true;
    this.userToEdit = { ...user };
    this.userToEdit.force_password_change = Number((this.userToEdit as any).force_password_change || 0);

    const normalizeGender = (value: any): string => {
      const g = (value || '').toString().trim().toUpperCase();
      if (g === 'M' || g === 'MASCULINO') return 'MASCULINO';
      if (g === 'F' || g === 'FEMENINO') return 'FEMENINO';
      return g;
    };

    this.userToEdit.gender = normalizeGender(this.userToEdit.gender);

    const userId = Number((user as any).user_id || 0);
    if (userId > 0) {
      this.usersService.getUserById(userId).subscribe({
        next: (dbUser: any) => {
          if (!dbUser) return;
          this.userToEdit = {
            ...this.userToEdit,
            ...dbUser,
            gender: normalizeGender(dbUser.gender ?? this.userToEdit.gender),
            cel_number: dbUser.cel_number ?? this.userToEdit.cel_number,
            property_category: dbUser.property_category ?? this.userToEdit.property_category,
            force_password_change: Number((dbUser as any).force_password_change || this.userToEdit.force_password_change || 0)
          } as User;
        },
        error: () => {
          // Mantener datos locales si falla la recarga puntual desde BD.
        }
      });
    }
    document.getElementById('users-edit-user-button')?.click();
  }

  editPerson(person: any){
    this.modalMode = 'persons';
    this.enableSystemAccessEdit = false;
    this.userToEdit = { ...(person as any) } as User;
    this.userToEdit.property_category = ((person as any).property_category || (person as any).person_type || this.userToEdit.property_category || 'RESIDENTE').toString().toUpperCase();
    this.userToEdit.user_id = Number((person as any).user_id || 0);
    this.userToEdit.force_password_change = Number((this.userToEdit as any).force_password_change || 0);
    if (!this.userToEdit.role_system) this.userToEdit.role_system = 'USUARIO';
    if (!this.userToEdit.status_validated) this.userToEdit.status_validated = 'PERMITIDO';
    document.getElementById('users-edit-user-button')?.click();
  }

  /** Expuesto a la plantilla: roles staff no requieren domicilio obligatorio. */
  isStaffRole(role: string | undefined | null): boolean {
    return isStaffRoleSystemValue(role);
  }

  /** Categoría en domicilio solo si hay casa seleccionada. */
  hasSelectedHouseId(u: User): boolean {
    const hid = Number(u?.house_id) || 0;
    return hid > 0;
  }

  saveNewUser() {
    if (this.modalMode === 'persons') {
      this.saveNewPerson();
      return;
    }

    const validationMsg = this.validateNewUserAdminModal();
    if (validationMsg) {
      this.toastr.error(validationMsg);
      return;
    }
    // Staff sin casa: sin person_type (equivalente a OPERARIO/ADMINISTRADOR + NULL en BD).
    // Configurar valores predeterminados
    this.userToAdd.password_system = this.userToAdd.doc_number;
    const photoNew = this.optionalPhotoUrlByGender(this.userToAdd.gender);
    if (photoNew) {
      this.userToAdd.photo_url = photoNew;
    } else {
      delete (this.userToAdd as any).photo_url;
    }
    this.userToAdd.status_system = 'ACTIVO';
    this.userToAdd.force_password_change = Number(this.userToAdd.force_password_change ? 1 : 0);

    const hid = Number(this.userToAdd.house_id) || 0;
    if (hid <= 0 && isStaffRoleSystemValue(this.userToAdd.role_system)) {
      this.userToAdd.property_category = '';
      (this.userToAdd as any).person_type = null;
    }
  
    // Verificar existencia del usuario en la base de datos
    this.usersService.getUserByDocNumber(this.userToAdd.doc_number).subscribe((resExistentUser: User) => {
      const existingId = Number((resExistentUser as any)?.user_id || 0);
      if (existingId) {
        this.userToAdd.user_id = existingId;

        if (
          resExistentUser.role_system &&
          resExistentUser.role_system !== 'NINGUNO' &&
          resExistentUser.role_system !== 'SN'
        ) {
          this.toastr.warning('El usuario ya existe');
          return;
        }
      }
  
      // Decidir si es una actualización o un nuevo registro
      if (this.userToAdd.user_id && this.userToAdd.user_id !== 0) {
        // Actualizar usuario existente
        this.usersService.updateUser(this.userToAdd).subscribe({
          next: (resUpdateUser) =>{
            if (resUpdateUser) {
              this.handleSuccess('users-new-user-modal');
            }
          },
          error: (error) =>{
            this.toastr.error("Error al guardar el usuario. Inténtalo nuevamente.");
            console.error(error);
          },
          complete: () => {}
        })
      }
      else {
        // Agregar nuevo usuario
        this.usersService.addUser(this.userToAdd).subscribe({
          next: (resAddUser) => {
            if (resAddUser) {
              this.handleSuccess('users-new-user-modal');
            }
          },
          error: (error) => {
            this.toastr.error("Error al guardar el usuario. Inténtalo nuevamente.");
            console.error(error);
          },
          complete: () => {}
        });
      }
    });
  }

  private saveNewPerson() {
    const validationMsg = this.validateNewPersonModal();
    if (validationMsg) {
      this.toastr.error(validationMsg);
      return;
    }

    const hid = Number(this.userToAdd.house_id) || 0;
    let personType = this.trim(this.userToAdd.property_category) || 'RESIDENTE';
    if (hid <= 0 && isStaffRoleSystemValue(this.userToAdd.role_system)) {
      personType = '';
    }
    const personPayload: any = {
      type_doc: this.userToAdd.type_doc || 'DNI',
      doc_number: this.userToAdd.doc_number,
      first_name: this.userToAdd.first_name,
      paternal_surname: this.userToAdd.paternal_surname,
      maternal_surname: this.userToAdd.maternal_surname || '',
      gender: this.userToAdd.gender || undefined,
      birth_date: this.userToAdd.birth_date || undefined,
      cel_number: this.userToAdd.cel_number || undefined,
      email: this.userToAdd.email || undefined,
      house_id: hid > 0 ? hid : undefined,
      person_type: (personType || null) as string | null,
      status_validated: this.userToAdd.status_validated || 'PERMITIDO',
      status_reason: this.userToAdd.status_reason || '',
      status_system: 'ACTIVO'
    };
    const photoPerson = this.optionalPhotoUrlByGender(this.userToAdd.gender);
    if (photoPerson) {
      personPayload.photo_url = photoPerson;
    }

    this.usersService.createPerson(personPayload).subscribe({
      next: (res: any) => {
        const personId = Number(res?.data?.id || res?.id || 0);
        if (this.enableSystemAccessNew && personId) {
          this.ensureSuggestedUsernameFor(this.userToAdd);
          if (!(this.userToAdd.username_system || '').trim()) {
            this.toastr.warning('No se pudo generar un usuario automáticamente. Completa el campo Usuario.');
            return;
          }
          this.usersService.createUserFromPerson({
            person_id: personId,
            username_system: (this.userToAdd.username_system || '').trim(),
            password_system: (this.userToAdd.doc_number || '').trim(),
            role_system: this.userToAdd.role_system || 'USUARIO',
            force_password_change: Number(this.userToAdd.force_password_change ? 1 : 0)
          }).subscribe({
            next: () => {
              this.toastr.success('Persona creada y acceso habilitado.');
              this.afterPersonAccessChange('new');
            },
            error: (err) => {
              this.toastr.warning(err?.error?.error || 'Persona creada, pero no se pudo dar acceso al sistema.');
              this.afterPersonOnlyChange('new');
            }
          });
          return;
        }

        this.toastr.success('Persona creada correctamente.');
        this.afterPersonOnlyChange('new');
      },
      error: (err) => {
        this.toastr.error(err?.error?.error || 'Error al crear la persona.');
      }
    });
  }
  
  private trim(v: string | undefined | null): string {
    return (v ?? '').toString().trim();
  }

  /**
   * Avatar por defecto según género (URL absoluta al origen de la SPA). Solo si hay género.
   * Acepta MASCULINO/FEMENINO (users) y M/F por compatibilidad.
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

  /** Datos civiles mínimos (sin domicilio; usado en alta de usuario sistema). */
  private validatePersonCoreRequired(u: User): string | null {
    if (!this.trim(u.type_doc)) {
      return 'Seleccione el tipo de documento.';
    }
    if (!this.trim(u.doc_number) || this.trim(u.doc_number).length < 8) {
      return 'El número de documento es obligatorio (mínimo 8 caracteres).';
    }
    if (!this.trim(u.paternal_surname)) {
      return 'El apellido paterno es obligatorio.';
    }
    if (!this.trim(u.maternal_surname)) {
      return 'El apellido materno es obligatorio.';
    }
    if (!this.trim(u.first_name)) {
      return 'Los nombres son obligatorios.';
    }
    if (!this.trim(u.status_validated)) {
      return 'Seleccione el estado de validación.';
    }
    return null;
  }

  /** Pestaña Usuarios: Nuevo usuario + bloque USERS (usuario y rol). */
  private validateNewUserAdminModal(): string | null {
    const core = this.validatePersonCoreRequired(this.userToAdd);
    if (core) {
      return core;
    }
    const hid = Number(this.userToAdd.house_id) || 0;
    if (hid <= 0 && !isStaffRoleSystemValue(this.userToAdd.role_system)) {
      return 'Seleccione el domicilio (obligatorio para rol USUARIO / vecinos).';
    }
    if (hid > 0 && !this.trim(this.userToAdd.property_category)) {
      return 'Seleccione la categoría en el domicilio.';
    }
    if (!this.trim(this.userToAdd.username_system)) {
      return 'Indique el usuario de acceso al sistema.';
    }
    if (!this.trim(this.userToAdd.role_system)) {
      return 'Seleccione el rol en el sistema.';
    }
    if (this.trim(this.userToAdd.property_category).toUpperCase() === 'INVITADO') {
      return 'INVITADO no puede tener usuario de sistema. Use PROPIETARIO, RESIDENTE o INQUILINO.';
    }
    return null;
  }

  /**
   * Pestaña Personas: domicilio opcional; si hay domicilio, categoría obligatoria.
   * Sin "Dar acceso al sistema" no se valida bloque USERS.
   */
  private validateNewPersonModal(): string | null {
    const u = this.userToAdd;
    if (!this.trim(u.type_doc)) {
      return 'Seleccione el tipo de documento.';
    }
    if (!this.trim(u.doc_number) || this.trim(u.doc_number).length < 8) {
      return 'El número de documento es obligatorio (mínimo 8 caracteres).';
    }
    if (!this.trim(u.paternal_surname)) {
      return 'El apellido paterno es obligatorio.';
    }
    if (!this.trim(u.maternal_surname)) {
      return 'El apellido materno es obligatorio.';
    }
    if (!this.trim(u.first_name)) {
      return 'Los nombres son obligatorios.';
    }
    const hid = Number(u.house_id) || 0;
    if (hid > 0 && !this.trim(u.property_category)) {
      return 'Si selecciona domicilio, indique la categoría.';
    }
    if (!this.trim(u.status_validated)) {
      return 'Seleccione el estado de validación.';
    }
    if (this.enableSystemAccessNew) {
      if (this.trim(this.userToAdd.property_category).toUpperCase() === 'INVITADO') {
        return 'No se puede dar acceso al sistema a INVITADO. Cambie primero el tipo a PROPIETARIO, RESIDENTE o INQUILINO.';
      }
      if (!this.trim(this.userToAdd.username_system)) {
        return 'Indique el usuario de acceso al sistema.';
      }
      if (!this.trim(this.userToAdd.role_system)) {
        return 'Seleccione el rol en el sistema.';
      }
    }
    return null;
  }

  private closeModalByDataId(modalId: string): void {
    const btn = document.querySelector(`[data-modal-hide="${modalId}"]`) as HTMLElement | null;
    btn?.click();
  }

  // Manejar éxito en la creación o actualización
  private handleSuccess(closeModalId?: string) {
    if (closeModalId) {
      this.closeModalByDataId(closeModalId);
    }
    this.clean();
    this.usersService.getAllUsers().subscribe((res: any[]) => {
      this.users = res;
      this.toastr.success('Usuario guardado correctamente');
    });
  }
  

  saveEditUser(){
    if (this.modalMode === 'persons') {
      this.saveEditPerson();
      return;
    }

    this.userToEdit.force_password_change = Number(this.userToEdit.force_password_change ? 1 : 0);
    const userUpdatePayload = { ...this.userToEdit } as any;
    if (userUpdatePayload.force_password_change === 1) {
      userUpdatePayload.password_system = (this.userToEdit.doc_number || '').toString().trim();
    } else {
      delete userUpdatePayload.password_system;
    }
    this.usersService.updateUser(userUpdatePayload).subscribe(resUpdateUser=>{
      if(resUpdateUser){
        this.handleSuccess('users-edit-user-modal');
      }
    })
  }

  private saveEditPerson() {
    const personId = Number((this.userToEdit as any).id || (this.userToEdit as any).person_id || 0);
    if (!personId) {
      this.toastr.error('No se encontró el ID de la persona para editar.');
      return;
    }
    if (
      this.enableSystemAccessEdit &&
      this.trim(this.userToEdit.property_category).toUpperCase() === 'INVITADO'
    ) {
      this.toastr.error(
        'No se puede dar acceso al sistema a INVITADO. Cambie primero el tipo a PROPIETARIO, RESIDENTE o INQUILINO.'
      );
      return;
    }

    const personPayload: any = {
      first_name: this.userToEdit.first_name,
      paternal_surname: this.userToEdit.paternal_surname,
      maternal_surname: this.userToEdit.maternal_surname,
      gender: this.userToEdit.gender,
      birth_date: this.userToEdit.birth_date,
      cel_number: this.userToEdit.cel_number,
      email: this.userToEdit.email,
      house_id: this.userToEdit.house_id,
      person_type: this.userToEdit.property_category || 'RESIDENTE',
      status_validated: this.userToEdit.status_validated || 'PERMITIDO',
      status_reason: this.userToEdit.status_reason || ''
    };

    this.usersService.updatePerson(personId, personPayload).subscribe({
      next: () => {
        const existingUserId = Number((this.userToEdit as any).user_id || 0);

        if (this.enableSystemAccessEdit && existingUserId) {
          this.userToEdit.force_password_change = Number(this.userToEdit.force_password_change ? 1 : 0);
          const userUpdatePayload = { ...this.userToEdit } as any;
          if (userUpdatePayload.force_password_change === 1) {
            userUpdatePayload.password_system = (this.userToEdit.doc_number || '').toString().trim();
          } else {
            delete userUpdatePayload.password_system;
          }
          this.usersService.updateUser(userUpdatePayload).subscribe({
            next: () => {
              this.toastr.success('Persona y acceso al sistema actualizados correctamente.');
              this.afterPersonAccessChange('edit');
            },
            error: (err) => {
              this.toastr.warning(err?.error?.error || 'Persona actualizada, pero no se pudo actualizar el acceso al sistema.');
              this.afterPersonOnlyChange('edit');
            }
          });
          return;
        }

        if (this.enableSystemAccessEdit && !existingUserId) {
          this.ensureSuggestedUsernameFor(this.userToEdit);
          if (!(this.userToEdit.username_system || '').trim()) {
            this.toastr.warning('No se pudo generar un usuario automáticamente. Completa el campo Usuario.');
            return;
          }
          this.usersService.createUserFromPerson({
            person_id: personId,
            username_system: (this.userToEdit.username_system || '').trim(),
            password_system: (this.userToEdit.doc_number || '').trim(),
            role_system: this.userToEdit.role_system || 'USUARIO',
            force_password_change: Number(this.userToEdit.force_password_change ? 1 : 0)
          }).subscribe({
            next: () => {
              this.toastr.success('Persona actualizada y acceso habilitado.');
              this.afterPersonAccessChange('edit');
            },
            error: (err) => {
              this.toastr.warning(err?.error?.error || 'Persona actualizada, pero no se pudo dar acceso al sistema.');
              this.afterPersonOnlyChange('edit');
            }
          });
          return;
        }

        this.toastr.success('Persona actualizada correctamente.');
        this.afterPersonOnlyChange('edit');
      },
      error: (err) => {
        this.toastr.error(err?.error?.error || 'Error al actualizar la persona.');
      }
    });
  }

  private afterPersonOnlyChange(which: 'new' | 'edit' = 'edit') {
    this.closeModalByDataId(which === 'new' ? 'users-new-user-modal' : 'users-edit-user-modal');
    this.clean();
    this.loadPersonsWithoutUser();
    this.usersService.getAllUsers().subscribe((res: any[]) => { this.users = res; });
    this.activeTab = 'persons';
  }

  private afterPersonAccessChange(which: 'new' | 'edit' = 'edit') {
    this.closeModalByDataId(which === 'new' ? 'users-new-user-modal' : 'users-edit-user-modal');
    this.clean();
    this.loadPersonsWithoutUser();
    this.usersService.getAllUsers().subscribe((res: any[]) => { this.users = res; });
    this.activeTab = 'users';
  }

  /** Listar personas que aún no tienen usuario (para convertir en usuario) */
  loadPersonsWithoutUser() {
    this.loadingPersonsWithoutUser = true;
    this.usersService.getPersons({ without_user: 1 }).subscribe({
      next: (res: any) => {
        this.loadingPersonsWithoutUser = false;
        this.hasLoadedPersonsWithoutUser = true;
        const raw = (res && res.data) ? res.data : (Array.isArray(res) ? res : []);
        this.personsWithoutUser = (raw || []).map((p: any) => ({
          ...p,
          property_category: (p?.property_category || p?.person_type || 'RESIDENTE').toString().toUpperCase()
        }));
        this.personsCurrentPage = 1;
      },
      error: () => {
        this.loadingPersonsWithoutUser = false;
        this.toastr.error('No se pudo cargar la lista de personas sin acceso.');
      }
    });
  }

  /** Abrir modal para dar acceso a una persona */
  openGiveAccessModal(person: any) {
    this.giveAccessPerson = person;
    this.giveAccessUsername = '';
    this.giveAccessPassword = '';
    this.giveAccessRole = 'USUARIO';
    document.getElementById('users-give-access-button')?.click();
  }

  /** Crear usuario desde persona (dar acceso) */
  saveGiveAccess() {
    if (!this.giveAccessPerson || !this.giveAccessUsername?.trim() || !this.giveAccessPassword?.trim()) {
      this.toastr.error('Complete usuario y contraseña.');
      return;
    }
    const pt = String(this.giveAccessPerson?.property_category || this.giveAccessPerson?.person_type || '')
      .trim()
      .toUpperCase();
    if (pt === 'INVITADO') {
      this.toastr.error(
        'No se puede dar acceso a INVITADO. Edite la persona y cambie el tipo a PROPIETARIO, RESIDENTE o INQUILINO.'
      );
      return;
    }
    this.savingGiveAccess = true;
    this.usersService.createUserFromPerson({
      person_id: this.giveAccessPerson.id,
      username_system: this.giveAccessUsername.trim(),
      password_system: this.giveAccessPassword,
      role_system: this.giveAccessRole
    }).subscribe({
      next: () => {
        this.savingGiveAccess = false;
        this.toastr.success('Usuario creado. La persona ya puede iniciar sesión.');
        document.getElementById('users-close-give-access-modal')?.click();
        this.loadPersonsWithoutUser();
        this.usersService.getAllUsers().subscribe((res: any[]) => { this.users = res; });
      },
      error: (err) => {
        this.savingGiveAccess = false;
        this.toastr.error(err?.error?.error || err?.message || 'Error al crear usuario.');
      }
    });
  }
}
