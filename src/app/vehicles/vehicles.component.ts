import { AfterViewInit, Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Vehicle } from '../vehicle';
import { House } from '../house';
import { initFlowbite } from 'flowbite';
import { EntranceService } from '../entrance.service';
import { ExternalVehicle, EXTERNAL_VISIT_DURATION_OPTIONS } from '../externalVehicle';
import { ToastrService } from 'ngx-toastr';
import { ApiService } from '../api.service';
import { NavPermissionService } from '../nav-permission.service';
import { ExpandableRowId, isExpandableRowOpen, toggleExpandableRow } from '../shared/expandable-row';
import { PublicRegistrationService } from '../public-registration/public-registration.service';
import {
  VEHICLE_TYPE_VALUES,
  vehicleTypeRequiresLicensePlate,
  vehicleTypeRequiresVehiclePhoto
} from '../vehicle-types';
import {
  PERUVIAN_LICENSE_PLATE_ERROR,
  isValidPeruvianLicensePlate,
  normalizePeruvianLicensePlate,
} from '../shared/license-plate';
import {
  IDENTITY_DOCUMENT_TYPES,
  identityDocumentError,
  isValidIdentityDocument,
  normalizeIdentityDocument,
} from '../shared/identity-document';
import { compressImageFile, MOBILE_PHOTO_COMPRESS } from '../shared/compress-image';

type VehiclesPageSection = 'residents' | 'external';

@Component({
  selector: 'app-vehicles',
  templateUrl: './vehicles.component.html',
  styleUrls: ['./vehicles.component.css']
})
export class VehiclesComponent implements OnInit, AfterViewInit{

  vehicles: Vehicle[] = [];
  vehicleToAdd: Vehicle = new Vehicle('', 'AUTOMOVIL', 0, 'PERMITIDO', '', '', 'PROPIETARIO', '', '', '');
  vehicleToEdit: Vehicle = new Vehicle('', 'AUTOMOVIL', 0, 'PERMITIDO', '', '', 'PROPIETARIO', '', '', '');

  types: string[] = [...VEHICLE_TYPE_VALUES];
  categories: string[] = ['PROPIETARIO','RESIDENTE','INVITADO','INQUILINO'];
  status: string[] = ['PERMITIDO','DENEGADO','OBSERVADO'];
  
  vehicleTypeIcons: { [key: string]: string } = {
    'MOTOCICLETA': 'two_wheeler',
    'MOTOTAXI': 'two_wheeler',
    'MOTO ELECTRICA': 'two_wheeler',
    'AUTOMOVIL': 'directions_car',
    'CAMIONETA': 'local_shipping',
    'CAMION': 'local_shipping',
    'MINIVAN': 'directions_bus',
    'MINI BUS': 'directions_bus',
    'BICICLETA': 'two_wheeler',
    'FURGONETA': 'local_shipping'
  };

  uploadingNewVehiclePhoto = false;
  compressingNewVehiclePhoto = false;
  uploadingNewExternalVehiclePhoto = false;
  uploadingEditExternalVehiclePhoto = false;
  compressingNewExternalVehiclePhoto = false;
  compressingEditExternalVehiclePhoto = false;

  houses: House[] = [];
  
  externalVehicleTypeIcons: { [key: string]: string } = {
    'DELIVERY': 'local_shipping',
    'COLECTIVO': 'directions_bus',
    'TAXI': 'directions_car'
  };

  externalVehicles: ExternalVehicle[] = [];
  externalVehicleToAdd: ExternalVehicle = new ExternalVehicle('','','','','','','','');
  externalVehicleToEdit: ExternalVehicle = new ExternalVehicle('','','','','','','','');
  temp_visit_type:string[]=['DELIVERY','COLECTIVO','TAXI'];
  readonly externalDocumentTypes = IDENTITY_DOCUMENT_TYPES;
  readonly externalDurationOptions = EXTERNAL_VISIT_DURATION_OPTIONS;
  externalDurationMinutes = 120;
  externalStaffHouseId = 0;

  searchTerm: string = '';
  externalSearchTerm: string = '';
  selectedBlock: string = '';
  selectedLot: string = '';
  externalSelectedBlock: string = '';
  externalSelectedLot: string = '';
  residentCurrentPage: number = 1;
  residentPageSize: number = 10;
  externalCurrentPage: number = 1;
  externalPageSize: number = 10;
  pageSizeOptions: number[] = [10, 25, 50, 100];

  expandedResidentRowId: ExpandableRowId = null;
  expandedExternalRowId: ExpandableRowId = null;
  readonly residentTableColspan = 7;
  readonly externalTableColspan = 9;

  showViewPhotoDialog = false;
  viewPhotoUrl: string | null = null;
  viewPhotoTitle = '';
  currentSection: VehiclesPageSection = 'residents';

  constructor(
    private entranceService: EntranceService,
    private toastr: ToastrService,
    private api: ApiService,
    private publicReg: PublicRegistrationService,
    private navPerm: NavPermissionService,
    private route: ActivatedRoute,
  ){}

  get showResidentVehiclesTab(): boolean {
    return this.navPerm.canView('vehicles');
  }

  get showStaffExternalVehiclesTab(): boolean {
    return this.navPerm.canView('external_visits');
  }

  get canEditExternalVisits(): boolean {
    return this.navPerm.canManage('external_visits');
  }

  get canManageVehiclesCrud(): boolean {
    return this.navPerm.canManage('vehicles');
  }

  get pageTitle(): string {
    if (this.currentSection === 'external') {
      return 'Visitas externas';
    }
    return 'Vehiculos';
  }

  get pageDescription(): string {
    if (this.currentSection === 'external') {
      return 'Vista global: todos los registros de visitas temporales de todas las casas.';
    }
    return 'Gestiona los vehículos residentes registrados en el condominio.';
  }

  get showResidentVehiclesView(): boolean {
    return this.currentSection === 'residents' && this.showResidentVehiclesTab;
  }

  get showExternalVehiclesView(): boolean {
    return this.currentSection === 'external' && this.showStaffExternalVehiclesTab;
  }

  ngOnInit(): void {
    this.route.data.subscribe((data) => {
      this.resolveCurrentSection((data['defaultTab'] as VehiclesPageSection | undefined) ?? 'residents');
    });
    if (this.showResidentVehiclesTab) {
      this.entranceService.getAllVehicles().subscribe({
        next: (res: any) => {
          this.vehicles = Array.isArray(res) ? res : (res?.data ?? []);
        },
        error: (err) => { console.error('Error obteniendo vehículos:', err); }
      });
    }
    this.entranceService.getAllHouses().subscribe({
      next: (res: any) => {
        this.houses = Array.isArray(res) ? res : (res?.data ?? []);
      },
      error: (err) => { console.error('Error obteniendo casas:', err); }
    });
    this.reloadExternalVehicles();
  }

  private resolveCurrentSection(routeDefault: VehiclesPageSection = 'residents'): void {
    if (routeDefault === 'external' && this.showStaffExternalVehiclesTab) {
      this.currentSection = 'external';
      return;
    }
    if (routeDefault === 'residents' && this.showResidentVehiclesTab) {
      this.currentSection = 'residents';
      return;
    }
    if (this.showStaffExternalVehiclesTab) {
      this.currentSection = 'external';
      return;
    }
    this.currentSection = 'residents';
  }

  private reloadExternalVehicles(): void {
    if (!this.showStaffExternalVehiclesTab) {
      this.externalVehicles = [];
      return;
    }
    this.entranceService.getAllExternalVehicles().subscribe({
      next: (res: any) => {
        this.externalVehicles = Array.isArray(res) ? res : (res?.data ?? []);
      },
      error: (err) => { console.error('Error obteniendo vehículos externos:', err); }
    });
  }

  private isFlowbiteInitialized = false;

  ngAfterViewInit(): void {
    if (this.isFlowbiteInitialized) return;
    // Flowbite vincula eventos en base al DOM disponible. Como los permisos
    // se resuelven async, inicializamos después de cargar permisos y con un tick extra.
    this.navPerm.load().subscribe(() => {
      setTimeout(() => {
        initFlowbite();
        this.isFlowbiteInitialized = true;
      }, 0);
    });
  }
//VEHÍCULOS DE RESIDENTES

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

  onNewVehiclePhotoPick(file: File): void {
    void this.uploadNewVehiclePhoto(file);
  }

  private async uploadNewVehiclePhoto(file: File): Promise<void> {
    if (!file?.type.startsWith('image/')) {
      this.toastr.warning('Seleccione una imagen (JPG, PNG o GIF).');
      return;
    }
    this.compressingNewVehiclePhoto = true;
    let ready = file;
    try {
      ready = await compressImageFile(file, MOBILE_PHOTO_COMPRESS);
    } catch {
      this.toastr.warning('No se pudo optimizar la foto; se usará el original.');
    }
    this.compressingNewVehiclePhoto = false;
    this.uploadingNewVehiclePhoto = true;
    this.publicReg.uploadVehiclePhoto(ready, { skipCompress: true }).subscribe({
      next: (res) => {
        this.uploadingNewVehiclePhoto = false;
        if (res.success && res.photo_url) {
          this.vehicleToAdd.photo_url = res.photo_url;
          this.toastr.success('Foto del vehículo cargada.');
        } else {
          this.toastr.error(res.error || 'Error al subir la foto.');
        }
      },
      error: (err) => {
        this.uploadingNewVehiclePhoto = false;
        this.toastr.error(err?.error?.error || err?.message || 'Error al subir la foto.');
      }
    });
  }

  onNewExternalVehiclePhotoPick(file: File): void {
    void this.uploadExternalVehiclePhoto(file, 'add');
  }

  onEditExternalVehiclePhotoPick(file: File): void {
    void this.uploadExternalVehiclePhoto(file, 'edit');
  }

  private async uploadExternalVehiclePhoto(file: File, mode: 'add' | 'edit'): Promise<void> {
    if (!file?.type.startsWith('image/')) {
      this.toastr.warning('Seleccione una imagen (JPG, PNG o GIF).');
      return;
    }
    const target = mode === 'add' ? this.externalVehicleToAdd : this.externalVehicleToEdit;
    if (mode === 'add') {
      this.compressingNewExternalVehiclePhoto = true;
    } else {
      this.compressingEditExternalVehiclePhoto = true;
    }

    let ready = file;
    try {
      ready = await compressImageFile(file, MOBILE_PHOTO_COMPRESS);
    } catch {
      this.toastr.warning('No se pudo optimizar la foto; se usará el original.');
    }

    if (mode === 'add') {
      this.compressingNewExternalVehiclePhoto = false;
      this.uploadingNewExternalVehiclePhoto = true;
    } else {
      this.compressingEditExternalVehiclePhoto = false;
      this.uploadingEditExternalVehiclePhoto = true;
    }

    this.publicReg.uploadVehiclePhoto(ready, { skipCompress: true }).subscribe({
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
      },
      error: (err) => {
        if (mode === 'add') {
          this.uploadingNewExternalVehiclePhoto = false;
        } else {
          this.uploadingEditExternalVehiclePhoto = false;
        }
        this.toastr.error(err?.error?.error || err?.message || 'Error al subir la foto.');
      },
    });
  }

  clearExternalVehiclePhoto(mode: 'add' | 'edit'): void {
    const target = mode === 'add' ? this.externalVehicleToAdd : this.externalVehicleToEdit;
    target.photo_url = undefined;
  }

  newVehicle(){
    document.getElementById('vehicles-new-vehicle-button')?.click();
  }

  editVehicle(vehicle:Vehicle){
    this.vehicleToEdit = vehicle;
    document.getElementById('vehicles-edit-vehicle-button')?.click();
  }

  get filteredVehicles(): Vehicle[] {
    if (!this.searchTerm.trim() && !this.selectedBlock && !this.selectedLot) {
      return this.vehicles;
    }
    const search = this.searchTerm.toLowerCase();
    return this.vehicles.filter(v => {
      const matchesSearch = !this.searchTerm.trim() ||
        v.type_vehicle.toLowerCase().includes(search) ||
        (v.license_plate ?? '').toString().toLowerCase().includes(search);
      
      const house = this.houses.find(h => h.house_id === v.house_id);
      const blockVal = (house?.block_house ?? '').toString();
      const lotVal = (house?.lot ?? '').toString();
      
      const matchesBlock = !this.selectedBlock || blockVal === this.selectedBlock;
      const matchesLot = !this.selectedLot || lotVal === this.selectedLot;
      
      return matchesSearch && matchesBlock && matchesLot;
    });
  }

  get filteredExternalVehicles(): ExternalVehicle[] {
    if (!this.externalSearchTerm.trim() && !this.externalSelectedBlock && !this.externalSelectedLot) {
      return this.externalVehicles;
    }
    const search = this.externalSearchTerm.toLowerCase();
    return this.externalVehicles.filter(ev => {
      const matchesSearch = !this.externalSearchTerm.trim() ||
        ev.temp_visit_type.toLowerCase().includes(search) ||
        ev.temp_visit_plate.toLowerCase().includes(search) ||
        (ev.temp_visit_name && ev.temp_visit_name.toLowerCase().includes(search)) ||
        (ev.temp_visit_company && ev.temp_visit_company.toLowerCase().includes(search)) ||
        (ev.temp_visit_doc && ev.temp_visit_doc.toLowerCase().includes(search));
      // Visitas temporales no van ligadas a un lote; filtros Mz/Lt no aplican salvo que añadas otro modelo.
      return matchesSearch;
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

  get uniqueExternalBlocks(): string[] {
    return [...new Set(this.houses.map(h => h.block_house.toString()))].sort();
  }

  get uniqueExternalLots(): string[] {
    const filtered = this.externalSelectedBlock 
      ? this.houses.filter(h => h.block_house.toString() === this.externalSelectedBlock)
      : this.houses;
    return [...new Set(filtered.map(h => h.lot.toString()))].sort((a, b) => parseInt(a) - parseInt(b));
  }

  get vehiclesTotalPages(): number {
    return Math.max(1, Math.ceil(this.filteredVehicles.length / this.residentPageSize));
  }

  get paginatedVehicles(): Vehicle[] {
    const safePage = Math.min(this.residentCurrentPage, this.vehiclesTotalPages);
    if (safePage !== this.residentCurrentPage) {
      this.residentCurrentPage = safePage;
    }
    const start = (safePage - 1) * this.residentPageSize;
    return this.filteredVehicles.slice(start, start + this.residentPageSize);
  }

  get externalVehiclesTotalPages(): number {
    return Math.max(1, Math.ceil(this.filteredExternalVehicles.length / this.externalPageSize));
  }

  get paginatedExternalVehicles(): ExternalVehicle[] {
    const safePage = Math.min(this.externalCurrentPage, this.externalVehiclesTotalPages);
    if (safePage !== this.externalCurrentPage) {
      this.externalCurrentPage = safePage;
    }
    const start = (safePage - 1) * this.externalPageSize;
    return this.filteredExternalVehicles.slice(start, start + this.externalPageSize);
  }

  onResidentPageSizeChange(): void {
    this.residentCurrentPage = 1;
    this.expandedResidentRowId = null;
  }

  previousResidentPage(): void {
    if (this.residentCurrentPage > 1) {
      this.residentCurrentPage -= 1;
      this.expandedResidentRowId = null;
    }
  }

  nextResidentPage(): void {
    if (this.residentCurrentPage < this.vehiclesTotalPages) {
      this.residentCurrentPage += 1;
      this.expandedResidentRowId = null;
    }
  }

  onExternalPageSizeChange(): void {
    this.externalCurrentPage = 1;
    this.expandedExternalRowId = null;
  }

  previousExternalPage(): void {
    if (this.externalCurrentPage > 1) {
      this.externalCurrentPage -= 1;
      this.expandedExternalRowId = null;
    }
  }

  nextExternalPage(): void {
    if (this.externalCurrentPage < this.externalVehiclesTotalPages) {
      this.externalCurrentPage += 1;
      this.expandedExternalRowId = null;
    }
  }

  getResidentRowId(v: Vehicle): string | number {
    return v.vehicle_id ?? `${v.type_vehicle}-${v.license_plate}`;
  }

  isResidentRowOpen(v: Vehicle): boolean {
    return isExpandableRowOpen(this.expandedResidentRowId, this.getResidentRowId(v));
  }

  toggleResidentRow(v: Vehicle): void {
    this.expandedResidentRowId = toggleExpandableRow(this.expandedResidentRowId, this.getResidentRowId(v));
  }

  getExternalRowId(ev: ExternalVehicle): string | number {
    return ev.id ?? ev.temp_visit_id ?? `${ev.temp_visit_plate}-${ev.temp_visit_name}`;
  }

  isExternalRowOpen(ev: ExternalVehicle): boolean {
    return isExpandableRowOpen(this.expandedExternalRowId, this.getExternalRowId(ev));
  }

  toggleExternalRow(ev: ExternalVehicle): void {
    this.expandedExternalRowId = toggleExpandableRow(this.expandedExternalRowId, this.getExternalRowId(ev));
  }

  openViewPhoto(vehicle: Vehicle): void {
    this.viewPhotoUrl = this.api.getPhotoUrl(vehicle.photo_url!);
    const pl = (vehicle.license_plate ?? '').toString().trim();
    this.viewPhotoTitle = pl ? `Vehículo ${pl}` : `Vehículo (${vehicle.type_vehicle || '—'})`;
    this.showViewPhotoDialog = true;
  }

  closeViewPhoto(): void {
    this.showViewPhotoDialog = false;
    this.viewPhotoUrl = null;
  }

  getPhotoUrl(photoUrl?: string | null): string {
    return this.api.getPhotoUrl(photoUrl || '') || '';
  }

  getVehicleIcon(vehicleType: string): string {
    return this.vehicleTypeIcons[vehicleType] || '🚗';
  }

  getExternalVehicleIcon(vehicleType: string): string {
    return this.externalVehicleTypeIcons[vehicleType] || '🚚';
  }

  getHouseLocation(v: Vehicle): string {
    const house = this.houses.find(h => h.house_id === v.house_id);
    const block = (house?.block_house ?? v.block_house ?? '-').toString().toUpperCase();
    const lot = (house?.lot ?? v.lot ?? '-').toString().toUpperCase();
    const apt = (house?.apartment ?? v.apartment ?? '').toString().trim();
    let result = `MZ:${block} LT:${lot}`;
    if (apt !== '') {
      result += ` DPTO:${apt.toUpperCase()}`;
    }
    return result;
  }

  saveEditVehicle(){
    if (!this.vehicleToEdit.house_id || !this.vehicleToEdit.type_vehicle) {
      this.toastr.error('Los campos obligatorios no pueden estar vacíos');
      this.clean();
      return;
    }
    const t = this.vehicleToEdit.type_vehicle;
    if (vehicleTypeRequiresLicensePlate(t)) {
      if (!isValidPeruvianLicensePlate(this.vehicleToEdit.license_plate)) {
        this.toastr.error(PERUVIAN_LICENSE_PLATE_ERROR);
        return;
      }
    } else if (!(this.vehicleToEdit.photo_url ?? '').toString().trim()) {
      this.toastr.error('Para bicicleta y moto eléctrica debe tener foto del vehículo.');
      return;
    }
    const payloadEdit = { ...this.vehicleToEdit } as Vehicle;
    if (vehicleTypeRequiresLicensePlate(t)) {
      payloadEdit.license_plate = normalizePeruvianLicensePlate(payloadEdit.license_plate);
    } else {
      (payloadEdit as any).license_plate = null;
    }
    this.entranceService.updateVehicle(payloadEdit).subscribe({
      next:(resUpdate:any)=>{
        if(resUpdate.success){
          this.toastr.success(resUpdate.message);
          this.handleSuccess();
        }
        else{
          console.log(resUpdate.message);
          this.toastr.error('Error al actualizar el vehículo');
        }
      },
      error:(err)=>{
        console.log(err);
        this.toastr.error('Error al actualizar el vehículo')
      },
    })
  }

  saveNewVehicle(): void {
    if (!this.vehicleToAdd.house_id || !this.vehicleToAdd.type_vehicle) {
      this.toastr.error('Los campos obligatorios no pueden estar vacíos');
      this.clean();
      return;
    }
    const tv = this.vehicleToAdd.type_vehicle;
    if (vehicleTypeRequiresLicensePlate(tv)) {
      if (!isValidPeruvianLicensePlate(this.vehicleToAdd.license_plate)) {
        this.toastr.error(PERUVIAN_LICENSE_PLATE_ERROR);
        return;
      }
    } else if (!(this.vehicleToAdd.photo_url ?? '').toString().trim()) {
      this.toastr.error('Para bicicleta y moto eléctrica debe subir una foto del vehículo.');
      return;
    }
    this.vehicleToAdd.status_system='ACTIVO'
    if (!this.vehicleToAdd.status_validated){
      this.vehicleToAdd.status_validated='PERMITIDO'
    }
    const payloadNew = { ...this.vehicleToAdd } as Vehicle;
    if (vehicleTypeRequiresLicensePlate(tv)) {
      payloadNew.license_plate = normalizePeruvianLicensePlate(payloadNew.license_plate);
    } else {
      (payloadNew as any).license_plate = null;
    }
    this.entranceService.addVehicle(payloadNew).subscribe({
      next:(res:any)=>{
        if(res.success){
          this.toastr.success(res.message);
          this.handleSuccess();
        } else {
          console.log(res.message);
          this.toastr.error('Error al guardar el vehículo');
        }
      },
      error:(err)=>{
        console.error(err);
        this.toastr.error('Error al guardar el vehículo')
      }
    });
  }
  
  //VEHÍCULOS EXTERNOS
  newExternalVehicle(){
    this.externalDurationMinutes = 120;
    this.externalStaffHouseId = 0;
    this.externalVehicleToAdd = new ExternalVehicle('','','','','DELIVERY','PERMITIDO','','ACTIVO');
    document.getElementById('vehicles-new-external-vehicle-button')?.click();
  }

  lookupExternalVisitOnIdentifierBlur(forEdit = false): void {
    const target = forEdit ? this.externalVehicleToEdit : this.externalVehicleToAdd;
    const plate = (target.temp_visit_plate || '').trim();
    const doc = (target.temp_visit_doc || '').trim();
    if (!plate && !doc) {
      return;
    }
    this.entranceService.lookupExternalVisit({
      plate: plate || undefined,
      doc: doc || undefined,
      document_type: doc ? target.temp_visit_doc_type : undefined,
    }).subscribe({
      next: (res: any) => {
        const body = res?.data ?? res;
        if (!body?.found || !body?.profile) {
          return;
        }
        const p = body.profile;
        if (p.temp_visit_name) target.temp_visit_name = p.temp_visit_name;
        if (p.temp_visit_company) target.temp_visit_company = p.temp_visit_company;
        if (p.temp_visit_cel) target.temp_visit_cel = p.temp_visit_cel;
        if (p.temp_visit_type) target.temp_visit_type = p.temp_visit_type;
        if (p.temp_visit_plate && !plate) target.temp_visit_plate = p.temp_visit_plate;
        if (p.temp_visit_doc && !doc) target.temp_visit_doc = p.temp_visit_doc;
        if (forEdit && p.photo_url) target.photo_url = p.photo_url;
        if (!forEdit && p.photo_url) target.photo_url = p.photo_url;
        if (forEdit && p.operator_notes) target.operator_notes = p.operator_notes;
        this.toastr.info('Datos reutilizados del registro global');
      },
    });
  }

  editExternalVehicle(externalVehicle: ExternalVehicle) {
    this.externalVehicleToEdit = { ...externalVehicle } as ExternalVehicle;
    const tid = (externalVehicle as any).temp_visit_id ?? (externalVehicle as any).id;
    if (tid) {
      (this.externalVehicleToEdit as any).id = tid;
    }
    document.getElementById('vehicles-edit-external-vehicle-button')?.click();
  }

  saveEditExternalVehicle(){
    // Validar campos obligatorios
    if (!this.externalVehicleToEdit.temp_visit_name?.trim() || !this.normalizeExternalIdentity(this.externalVehicleToEdit)) {
      this.toastr.error('Los campos obligatorios no pueden estar vacíos');
      this.clean();
      return;
    }
  
    this.entranceService.updateExternalVehicle(this.externalVehicleToEdit).subscribe({
      next: (resUpdateExternalVehicle: any) => {
        if (resUpdateExternalVehicle.success) {
          this.toastr.success(resUpdateExternalVehicle.message);
          this.handleSuccess();
        } else {
          console.log(resUpdateExternalVehicle.message);
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
    if (!this.externalVehicleToAdd.temp_visit_name?.trim() || !this.normalizeExternalIdentity(this.externalVehicleToAdd)) {
      this.toastr.error('Los campos obligatorios no pueden estar vacíos');
      this.clean();
      return;
    }
  
    this.externalVehicleToAdd.status_system = 'ACTIVO';

    if (!this.externalVehicleToAdd.status_validated) {
      this.externalVehicleToAdd.status_validated = 'PERMITIDO';
    }

    if (!this.externalStaffHouseId) {
      this.toastr.error('Seleccione la casa destino');
      return;
    }

    const payload = {
      ...this.externalVehicleToAdd,
      house_id: this.externalStaffHouseId,
      duration_minutes: this.externalDurationMinutes,
    } as ExternalVehicle;

    this.entranceService.addExternalVehicle(payload).subscribe({
      next: (res: any) => {
        if (res.success) {
          this.toastr.success(res.message);
          this.handleSuccess();
        } else {
          console.log(res.message);
          this.toastr.error('Error al guardar la visita externa');
        }
      },
      error: (err) => {
        console.error(err);
        this.toastr.error('Error al guardar la visita externa');
      },
    });
  }

  private normalizeExternalIdentity(target: ExternalVehicle): boolean {
    if (!isValidPeruvianLicensePlate(target.temp_visit_plate)) {
      this.toastr.error(PERUVIAN_LICENSE_PLATE_ERROR);
      return false;
    }
    target.temp_visit_plate = normalizePeruvianLicensePlate(target.temp_visit_plate);
    const doc = target.temp_visit_doc?.trim();
    if (doc) {
      const type = target.temp_visit_doc_type || 'DNI';
      if (!isValidIdentityDocument(type, doc)) {
        this.toastr.error(identityDocumentError(type));
        return false;
      }
      target.temp_visit_doc = normalizeIdentityDocument(type, doc);
    }
    return true;
  }
  

  private handleSuccess() {
    this.clean();
    this.entranceService.getAllVehicles().subscribe((res: any) => {
      this.vehicles = Array.isArray(res) ? res : (res?.data ?? []);
    });
    this.reloadExternalVehicles();
  }
  
  public clean(){
    this.vehicleToAdd = new Vehicle('', 'AUTOMOVIL', 0, 'PERMITIDO', '', '', 'PROPIETARIO', '', '', '');
    this.vehicleToEdit = new Vehicle('', 'AUTOMOVIL', 0, 'PERMITIDO', '', '', 'PROPIETARIO', '', '', '');
    this.externalVehicleToAdd = new ExternalVehicle('','','','','','','','',);
    this.externalVehicleToEdit = new ExternalVehicle('','','','','','','','',);
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

}


