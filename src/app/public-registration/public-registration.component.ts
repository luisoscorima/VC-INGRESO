import { Component, OnInit } from '@angular/core';
import { AbstractControl, FormArray, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import {
  PublicRegistrationService,
  PublicRegisterHouse,
  PublicRegisterOwner,
  PublicRegisterVehicle,
  PublicRegisterPet,
  PublicRegisterPayload,
  PublicRegisterResponseData,
  ReniecDniData,
  HouseFromApi
} from './public-registration.service';
import { switchMap, of } from 'rxjs';
import {
  VEHICLE_TYPE_OPTIONS,
  vehicleTypeRequiresLicensePlate,
  normalizeLicensePlateClient
} from '../vehicle-types';
import { peruvianLicensePlateValidator } from '../shared/license-plate';
import {
  IDENTITY_DOCUMENT_TYPES,
  IdentityDocumentType,
  identityDocumentValidator,
  isValidIdentityDocument,
  normalizeIdentityDocument,
  normalizeIdentityDocumentType,
} from '../shared/identity-document';

const DOC_TYPES: readonly IdentityDocumentType[] = IDENTITY_DOCUMENT_TYPES;
/** Estado civil (guardado en mayúsculas en BD, alineado con apidev/Nuevo Residente) */
const CIVIL_STATUS_OPTIONS = ['SOLTERO', 'CASADO', 'CONVIVIENTE', 'VIUDO', 'DIVORCIADO', 'OTRO'];
/** Categoría de mascota (plan: PERRO, GATO, AVE, pequeño mamífero, Acuático, EXÓTICO, OTROS) */
const PET_CATEGORY_OPTIONS: { value: string; label: string; icon: string }[] = [
  { value: 'PERRO', label: 'Perro', icon: '🐕' },
  { value: 'GATO', label: 'Gato', icon: '🐈' },
  { value: 'AVE', label: 'Ave', icon: '🐦' },
  { value: 'PEQUEÑO MAMÍFERO', label: 'Pequeño mamífero', icon: '🐹' },
  { value: 'ACUÁTICO', label: 'Acuático', icon: '🐠' },
  { value: 'EXÓTICO', label: 'Exótico', icon: '🦎' },
  { value: 'OTRO', label: 'Otros', icon: '📝' }
];
/** Colores comunes vehículos (para círculos de selección rápida) */
const VEHICLE_COLOR_PRESETS = ['Blanco', 'Negro', 'Plata', 'Gris', 'Rojo', 'Azul', 'Verde', 'Beige', 'Otro'];
/** Colores comunes mascotas */
const PET_COLOR_PRESETS = ['Blanco', 'Negro', 'Café', 'Gris', 'Crema', 'Atigrado', 'Otro'];

/** Opciones para "Tipo de vivienda": botones con ícono + texto */
const HOUSE_TYPE_OPTIONS: { value: string; label: string; icon: string }[] = [
  { value: 'CASA', label: 'Casa', icon: '🏠' },
  { value: 'DEPARTAMENTO', label: 'Departamento', icon: '🏢' },
  { value: 'LOCAL COMERCIAL', label: 'Comercio', icon: '🏪' }
];

@Component({
  selector: 'app-public-registration',
  templateUrl: './public-registration.component.html',
  styleUrls: ['./public-registration.component.css']
})
export class PublicRegistrationComponent implements OnInit {
  step = 1;
  maxStep = 5;
  docTypes = DOC_TYPES;
  civilStatusOptions = CIVIL_STATUS_OPTIONS;
  vehicleTypeOptions = VEHICLE_TYPE_OPTIONS;
  petCategoryOptions = PET_CATEGORY_OPTIONS;
  vehicleColorPresets = VEHICLE_COLOR_PRESETS;
  petColorPresets = PET_COLOR_PRESETS;
  houseTypeOptions = HOUSE_TYPE_OPTIONS;

  /** Casas cargadas desde la API (solo lo que hay en BD) */
  houses: HouseFromApi[] = [];
  loadingHouses = false;
  /** Tipo de vivienda elegido: filtra Manzana por house_type (CASA → A-N, P-V; DEPARTAMENTO → O; LOCAL COMERCIAL → LC) */
  selectedHouseType = '';
  /** Opciones para desplegables: manzana (según tipo), lote (según Mz), departamento (solo si tipo=DEPARTAMENTO, según Mz+Lt) */
  mzOptions: string[] = [];
  ltOptions: number[] = [];
  aptOptions: (string | null)[] = [];
  selectedMz = '';
  selectedLt: number | '' = '';
  selectedApt: string | null | '' = '';

  hasSecondOwner = false;
  wantVehicles = false;
  wantPets = false;

  mainForm: FormGroup;
  loadingDni = false;
  submitting = false;
  /** Índice del vehículo cuya foto se está subiendo (-1 = ninguno) */
  uploadingVehicleIndex: number = -1;
  /** Índice de la mascota cuya foto se está subiendo (-1 = ninguna) */
  uploadingPetIndex: number = -1;

  constructor(
    private fb: FormBuilder,
    private publicReg: PublicRegistrationService,
    private toastr: ToastrService,
    private router: Router
  ) {
    this.mainForm = this.buildForm();
  }

  ngOnInit(): void {
    this.loadHouses();
  }

  private loadHouses(): void {
    this.loadingHouses = true;
    this.publicReg.getHouses().subscribe({
      next: (res) => {
        this.loadingHouses = false;
        this.houses = res?.data ?? [];
        this.buildMzOptions();
      },
      error: () => {
        this.loadingHouses = false;
        this.toastr.error('No se pudo cargar la lista de domicilios.');
      }
    });
  }

  /** Manzanas filtradas por tipo de vivienda (desde BD: CASA→A-N,P-V; DEPARTAMENTO→O; LOCAL COMERCIAL→LC) */
  private buildMzOptions(): void {
    if (!this.selectedHouseType) {
      this.mzOptions = [];
      return;
    }
    const set = new Set(
      this.houses
        .filter(h => h.house_type === this.selectedHouseType)
        .map(h => h.block_house)
    );
    this.mzOptions = Array.from(set).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  }

  /** Al cambiar tipo de vivienda: se filtran manzanas por house_type y se resetean Mz/Lt/Apt */
  onHouseTypeChange(): void {
    this.selectedMz = '';
    this.selectedLt = '';
    this.selectedApt = '';
    this.ltOptions = [];
    this.aptOptions = [];
    this.buildMzOptions();
    this.house.patchValue({
      house_type: this.selectedHouseType,
      block_house: '',
      lot: '',
      apartment: null
    });
  }

  /** Casas filtradas por la manzana elegida (block_house en BD) */
  get filteredByMz(): HouseFromApi[] {
    if (!this.selectedMz) return [];
    const mz = String(this.selectedMz).trim();
    return this.houses.filter(h => String(h.block_house).trim() === mz);
  }

  /** Casas filtradas por manzana + lote (lot en BD); comparación numérica para evitar "1" !== 1 */
  get filteredByMzLt(): HouseFromApi[] {
    if (this.selectedLt === '' || this.selectedLt === null || this.selectedLt === undefined) return [];
    const lotNum = Number(this.selectedLt);
    if (Number.isNaN(lotNum)) return [];
    return this.filteredByMz.filter(h => Number(h.lot) === lotNum);
  }

  onMzChange(): void {
    this.selectedLt = '';
    this.selectedApt = '';
    this.aptOptions = [];
    const byMz = this.filteredByMz;
    const lots = [...new Set(byMz.map(h => h.lot))].sort((a, b) => a - b);
    this.ltOptions = lots;
    this.clearHouseSelection();
  }

  onLtChange(): void {
    const byMzLt = this.filteredByMzLt;
    // Para DEPARTAMENTO: apartment tiene valor (101, 102, ...); para CASA/LC puede ser null
    const rawApts = byMzLt.map(h => h.apartment);
    const apts = [...new Set(rawApts)]
      .filter(a => a != null && a !== '')
      .map(a => (typeof a === 'number' ? String(a) : a) as string)
      .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
    // Si no hay apartamentos (CASA/LC), dejamos lista vacía; si hay uno solo, preseleccionar
    this.aptOptions = apts.length > 0 ? apts : [];
    this.selectedApt = apts.length === 1 ? apts[0] : '';
    this.applyHouseSelection();
  }

  onAptChange(): void {
    this.applyHouseSelection();
  }

  private clearHouseSelection(): void {
    this.house.patchValue({
      house_type: this.selectedHouseType,
      block_house: '',
      lot: '',
      apartment: null
    });
  }

  private applyHouseSelection(): void {
    const byMzLt = this.filteredByMzLt;
    if (byMzLt.length === 0) return;
    let chosen: HouseFromApi;
    const aptVal = this.selectedApt !== '' && this.selectedApt != null ? String(this.selectedApt) : null;
    if (this.aptOptions.length === 0) {
      chosen = byMzLt[0];
    } else if (aptVal) {
      chosen = byMzLt.find(h => String(h.apartment ?? '') === aptVal) ?? byMzLt[0];
    } else {
      chosen = byMzLt[0];
    }
    this.house.patchValue({
      house_type: chosen.house_type,
      block_house: chosen.block_house,
      lot: chosen.lot,
      apartment: chosen.apartment
    });
  }

  /** Formato lote para mostrar (ej. 1 → "01") */
  formatLot(lot: number): string {
    return lot < 10 ? `0${lot}` : String(lot);
  }

  get house(): FormGroup {
    return this.mainForm.get('house') as FormGroup;
  }

  get owners(): FormArray {
    return this.mainForm.get('owners') as FormArray;
  }

  get owner1(): FormGroup {
    return this.owners.at(0) as FormGroup;
  }

  get owner2(): FormGroup {
    return this.owners.at(1) as FormGroup;
  }

  get vehicles(): FormArray {
    return this.mainForm.get('vehicles') as FormArray;
  }

  get pets(): FormArray {
    return this.mainForm.get('pets') as FormArray;
  }

  /** URL del documento "Autorización de uso de datos personales" (HTML en assets). */
  dataAuthDocUrl = '/assets/docs/autorizacion-uso-datos-personales.html';

  private buildForm(): FormGroup {
    return this.fb.group({
      house: this.fb.group({
        house_type: ['CASA', Validators.required],
        block_house: ['', Validators.required],
        lot: ['', Validators.required],
        apartment: [null as string | null]
      }),
      owners: this.fb.array([
        this.buildOwnerGroup(),
        this.buildOwnerGroup()
      ]),
      vehicles: this.fb.array([]),
      pets: this.fb.array([]),
      acceptDataUse: [false, Validators.requiredTrue]
    });
  }

  private buildOwnerGroup(): FormGroup {
    const group = this.fb.group({
      type_doc: ['DNI', Validators.required],
      doc_number: ['', Validators.required],
      first_name: ['', Validators.required],
      paternal_surname: ['', Validators.required],
      maternal_surname: [''],
      cel_number: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      gender: [null as string | null],
      birth_date: [null as string | null],
      address: [null as string | null],
      district: [null as string | null],
      province: [null as string | null],
      region: [null as string | null],
      civil_status: [null as string | null]
    });
    const typeControl = group.get('type_doc')!;
    const docControl = group.get('doc_number')!;
    docControl.addValidators(identityDocumentValidator(typeControl));
    typeControl.valueChanges.subscribe(() => docControl.updateValueAndValidity());
    return group;
  }

  private buildVehicleGroup(): FormGroup {
    const g = this.fb.group({
      type_vehicle: ['AUTOMOVIL', Validators.required],
      license_plate: [''],
      brand: ['', Validators.required],
      model: [''],
      color: ['', Validators.required],
      photo_url: [null as string | null]
    });
    this.applyVehicleValidators(g);
    return g;
  }

  /** Expuesto a la plantilla */
  requiresVehiclePlate(type: unknown): boolean {
    return vehicleTypeRequiresLicensePlate(String(type ?? ''));
  }

  onVehicleTypeChange(index: number): void {
    const g = this.vehicles.at(index) as FormGroup;
    this.applyVehicleValidators(g);
  }

  private applyVehicleValidators(g: FormGroup): void {
    const type = g.get('type_vehicle')?.value as string;
    const plateCtrl = g.get('license_plate');
    const photoCtrl = g.get('photo_url');
    if (vehicleTypeRequiresLicensePlate(type)) {
      plateCtrl?.setValidators([Validators.required, peruvianLicensePlateValidator]);
      photoCtrl?.clearValidators();
    } else {
      plateCtrl?.clearValidators();
      plateCtrl?.setValue('', { emitEvent: false });
      photoCtrl?.setValidators([Validators.required]);
    }
    plateCtrl?.updateValueAndValidity({ emitEvent: false });
    photoCtrl?.updateValueAndValidity({ emitEvent: false });
  }

  private buildPetGroup(): FormGroup {
    return this.fb.group({
      species: ['PERRO', Validators.required],
      species_other: [''], // cuando species === 'OTRO'
      name: ['', Validators.required],
      breed: [''],
      color: ['', Validators.required],
      age_years: [null as number | null],
      photo_url: [null as string | null]
    });
  }

  setVehicleColor(vehicleIndex: number, color: string): void {
    const g = this.vehicles.at(vehicleIndex) as FormGroup;
    g.get('color')?.setValue(color);
  }

  setPetColor(petIndex: number, color: string): void {
    const g = this.pets.at(petIndex) as FormGroup;
    g.get('color')?.setValue(color);
  }

  /** Hex para círculos de color vehículo (preset por nombre) */
  getVehicleColorHex(name: string): string {
    const map: Record<string, string> = {
      'Blanco': '#fff', 'Negro': '#1a1a1a', 'Plata': '#c0c0c0', 'Gris': '#808080',
      'Rojo': '#c0392b', 'Azul': '#2980b9', 'Verde': '#27ae60', 'Beige': '#d4b896', 'Otro': '#ddd'
    };
    return map[name] ?? '#ddd';
  }

  /** Hex para círculos de color mascota */
  getPetColorHex(name: string): string {
    const map: Record<string, string> = {
      'Blanco': '#fff', 'Negro': '#1a1a1a', 'Café': '#8b4513', 'Gris': '#808080',
      'Crema': '#f5e6d3', 'Atigrado': '#c4a574', 'Otro': '#ddd'
    };
    return map[name] ?? '#ddd';
  }

  addVehicle(): void {
    this.vehicles.push(this.buildVehicleGroup());
  }

  removeVehicle(i: number): void {
    this.vehicles.removeAt(i);
  }

  addPet(): void {
    this.pets.push(this.buildPetGroup());
  }

  removePet(i: number): void {
    this.pets.removeAt(i);
  }

  /** Sube la foto del vehículo en el índice i y asigna la URL al formulario. */
  onVehiclePhotoSelect(vehicleIndex: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      this.toastr.warning('Seleccione una imagen (JPG, PNG o GIF).');
      return;
    }
    this.uploadingVehicleIndex = vehicleIndex;
    this.publicReg.uploadVehiclePhoto(file).subscribe({
      next: (res) => {
        this.uploadingVehicleIndex = -1;
        if (res.success && res.photo_url) {
          const g = this.vehicles.at(vehicleIndex) as FormGroup;
          g.patchValue({ photo_url: res.photo_url });
          this.toastr.success('Foto del vehículo cargada.');
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

  /** Sube la foto de la mascota en el índice i y asigna la URL al formulario. */
  onPetPhotoSelect(petIndex: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      this.toastr.warning('Seleccione una imagen (JPG, PNG o GIF).');
      return;
    }
    this.uploadingPetIndex = petIndex;
    this.publicReg.uploadPetPhoto(file).subscribe({
      next: (res) => {
        this.uploadingPetIndex = -1;
        if (res.success && res.photo_url) {
          const g = this.pets.at(petIndex) as FormGroup;
          g.patchValue({ photo_url: res.photo_url });
          this.toastr.success('Foto de la mascota cargada.');
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

  /** Quita la foto del vehículo en el índice i. */
  clearVehiclePhoto(vehicleIndex: number): void {
    const g = this.vehicles.at(vehicleIndex) as FormGroup;
    g.patchValue({ photo_url: null });
  }

  /** Quita la foto de la mascota en el índice i. */
  clearPetPhoto(petIndex: number): void {
    const g = this.pets.at(petIndex) as FormGroup;
    g.patchValue({ photo_url: null });
  }

  /** Convierte el valor del control a mayúsculas (para placa, marca, modelo, nombre mascota, raza). */
  toUpperCaseField(control: AbstractControl | null): void {
    if (!control) return;
    const v = control.value;
    if (v != null && typeof v === 'string') {
      control.setValue(v.toUpperCase(), { emitEvent: false });
    }
  }

  /** Consulta DNI y rellena el owner en el índice indicado (0 o 1). */
  fetchDni(ownerIndex: number): void {
    const group = this.owners.at(ownerIndex) as FormGroup;
    const doc = group.get('doc_number')?.value?.trim();
    if (group.get('type_doc')?.value !== 'DNI') {
      this.toastr.info('La consulta automática solo está disponible para DNI');
      return;
    }
    if (!isValidIdentityDocument('DNI', doc)) {
      this.toastr.warning('El DNI debe contener exactamente 8 dígitos.');
      return;
    }
    this.loadingDni = true;
    this.publicReg.checkDocRegistered(doc).pipe(
      switchMap(registered => {
        if (registered) {
          this.loadingDni = false;
          this.toastr.warning('Este DNI ya está registrado.');
          return of(null);
        }
        return this.publicReg.getDniData(doc);
      })
    ).subscribe({
      next: (data: ReniecDniData | null) => {
        if (data == null) return;
        this.loadingDni = false;
        if (data) {
          const sexToGender = (s: string) => (s === 'M' || s === 'F' ? s : (s === 'MASCULINO' ? 'M' : s === 'FEMENINO' ? 'F' : s || null));
          const birth = data.fecha_nacimiento ? this.normalizeBirthDate(data.fecha_nacimiento) : null;
          const civil = ((data as { estado_civil?: string }).estado_civil || '').toString().trim().toUpperCase();
          group.patchValue({
            doc_number: data.numero || doc,
            first_name: this.normalizeName(data.nombres),
            paternal_surname: this.normalizeName(data.apellido_paterno),
            maternal_surname: this.normalizeName(data.apellido_materno || ''),
            gender: sexToGender((data.sexo || '').trim()),
            birth_date: birth,
            address: (data.direccion_completa || data.direccion || '').trim() || null,
            district: (data.distrito || '').trim() || null,
            province: (data.provincia || '').trim() || null,
            region: (data.departamento || '').trim() || null,
            civil_status: civil || null
          });
          this.toastr.success('Datos obtenidos. Revise y complete si es necesario.');
        } else {
          this.toastr.warning('No se encontraron datos para este DNI');
        }
      },
      error: () => {
        this.loadingDni = false;
        this.toastr.error('Error al consultar DNI. Verifique conexión o intente más tarde.');
      }
    });
  }

  private normalizeName(s: string): string {
    if (!s) return '';
    return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }

  /** Convierte fecha RENIEC (DD/MM/YYYY o YYYY-MM-DD) a YYYY-MM-DD para persons.birth_date */
  private normalizeBirthDate(value: string): string | null {
    if (!value || typeof value !== 'string') return null;
    const t = value.trim();
    const ddmmyyyy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(t);
    if (ddmmyyyy) {
      const [, d, m, y] = ddmmyyyy;
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    return null;
  }

  nextStep(): void {
    if (this.step < this.maxStep) this.step++;
  }

  prevStep(): void {
    if (this.step > 1) this.step--;
  }

  goToStep(s: number): void {
    this.step = s;
  }

  /** Valida solo la sección actual antes de avanzar. */
  canProceedSection1(): boolean {
    return this.house.valid && this.owner1.valid;
  }

  canProceedSection2(): boolean {
    if (!this.hasSecondOwner) return true;
    return this.owner2.valid;
  }

  buildPayload(): PublicRegisterPayload {
    const houseVal = this.house.value;
    const lotNum = houseVal.lot == null || houseVal.lot === '' ? null : Number(houseVal.lot);
    const house: PublicRegisterHouse = {
      house_type: houseVal.house_type,
      block_house: String(houseVal.block_house).trim(),
      lot: lotNum,
      apartment: houseVal.apartment == null || houseVal.apartment === '' ? null : String(houseVal.apartment).trim()
    };

    const owners: PublicRegisterOwner[] = [];
    owners.push(this.ownerToPayload(this.owner1));
    if (this.hasSecondOwner) owners.push(this.ownerToPayload(this.owner2));

    const vehicles: PublicRegisterVehicle[] = this.wantVehicles
      ? this.vehicles.controls.map(c => this.vehicleToPayload(c as FormGroup))
      : [];
    const pets: PublicRegisterPet[] = this.wantPets
      ? this.pets.controls.map(c => this.petToPayload(c as FormGroup))
      : [];

    return { house, owners, vehicles, pets };
  }

  private ownerToPayload(g: FormGroup): PublicRegisterOwner {
    const v = g.value;
    const type = normalizeIdentityDocumentType(v.type_doc) ?? 'DNI';
    const o: PublicRegisterOwner = {
      type_doc: type,
      doc_number: normalizeIdentityDocument(type, v.doc_number),
      first_name: String(v.first_name).trim(),
      paternal_surname: String(v.paternal_surname).trim()
    };
    if (v.maternal_surname?.trim()) o.maternal_surname = v.maternal_surname.trim();
    if (v.cel_number?.trim()) o.cel_number = v.cel_number.trim();
    if (v.email?.trim()) o.email = v.email.trim();
    if (v.gender?.trim()) o.gender = v.gender.trim();
    if (v.birth_date) o.birth_date = v.birth_date;
    if (v.address?.trim()) o.address = v.address.trim();
    if (v.district?.trim()) o.district = v.district.trim();
    if (v.province?.trim()) o.province = v.province.trim();
    if (v.region?.trim()) o.region = v.region.trim();
    if (v.civil_status?.trim()) o.civil_status = v.civil_status.trim();
    return o;
  }

  private vehicleToPayload(g: FormGroup): PublicRegisterVehicle {
    const v = g.value;
    const typeVehicle = String(v.type_vehicle ?? '').trim();
    const out: PublicRegisterVehicle = {
      type_vehicle: typeVehicle,
      brand: v.brand?.trim() || undefined,
      model: v.model?.trim() || undefined,
      color: v.color?.trim() || undefined,
      photo_url: v.photo_url?.trim() || null
    };
    if (vehicleTypeRequiresLicensePlate(typeVehicle)) {
      out.license_plate = normalizeLicensePlateClient(String(v.license_plate ?? ''));
    } else {
      out.license_plate = null;
    }
    return out;
  }

  private petToPayload(g: FormGroup): PublicRegisterPet {
    const v = g.value;
    let species = (v.species || '').toString().trim().toUpperCase();
    if (species === 'OTRO' && v.species_other?.trim()) {
      species = v.species_other.trim().toUpperCase();
    }
    const allowed = ['PERRO', 'GATO', 'AVE', 'PEQUEÑO MAMÍFERO', 'ACUÁTICO', 'EXÓTICO', 'OTRO'];
    const finalSpecies = allowed.includes(species) ? species : (species || 'OTRO');
    return {
      species: finalSpecies,
      name: String(v.name).trim(),
      breed: v.breed?.trim() || undefined,
      color: v.color?.trim() || undefined,
      age_years: v.age_years == null || v.age_years === '' ? null : Number(v.age_years),
      photo_url: v.photo_url?.trim() || null
    };
  }

  /** Normaliza documento para comparar (trim, sin espacios extra). */
  private normalizedDoc(g: FormGroup): string {
    const v = g.value;
    const type = normalizeIdentityDocumentType(v?.type_doc);
    return type ? `${type}:${normalizeIdentityDocument(type, v?.doc_number)}` : '';
  }

  /** Detecta si hay propietarios duplicados (mismo DNI en 1 y 2). */
  private hasDuplicateOwners(): boolean {
    if (!this.hasSecondOwner) return false;
    const d1 = this.normalizedDoc(this.owner1);
    const d2 = this.normalizedDoc(this.owner2);
    return d1 !== '' && d2 !== '' && d1 === d2;
  }

  /** Detecta si hay vehículos duplicados (misma placa en la lista). */
  private hasDuplicateVehicles(): boolean {
    if (!this.wantVehicles || this.vehicles.length < 2) return false;
    const plates = this.vehicles.controls.map(c => {
      const v = (c as FormGroup).value;
      if (!vehicleTypeRequiresLicensePlate(v?.type_vehicle)) {
        return '';
      }
      return normalizeLicensePlateClient(String(v?.license_plate ?? ''));
    });
    const seen = new Set<string>();
    for (const p of plates) {
      if (p === '') continue;
      if (seen.has(p)) return true;
      seen.add(p);
    }
    return false;
  }

  /** Detecta si hay mascotas duplicadas (misma especie + nombre). */
  private hasDuplicatePets(): boolean {
    if (!this.wantPets || this.pets.length < 2) return false;
    const keys = this.pets.controls.map(c => {
      const v = (c as FormGroup).value;
      const species = String(v?.species ?? '').trim().toUpperCase();
      const name = String(v?.name ?? '').trim().toUpperCase();
      return species + '|' + name;
    });
    const seen = new Set<string>();
    for (const k of keys) {
      if (k === '|') continue;
      if (seen.has(k)) return true;
      seen.add(k);
    }
    return false;
  }

  submit(): void {
    if (!this.mainForm.get('acceptDataUse')?.value) {
      this.toastr.error('Debe aceptar la autorización de uso de datos personales para enviar el registro.');
      return;
    }
    if (!this.canProceedSection1() || (this.hasSecondOwner && !this.canProceedSection2())) {
      this.toastr.error('Complete los datos obligatorios de propietarios y vivienda.');
      return;
    }
    if (this.hasDuplicateOwners()) {
      this.toastr.error('No puede registrar el mismo propietario dos veces. Los dos titulares deben tener DNI diferente.');
      return;
    }
    if (this.wantVehicles && this.vehicles.length === 0) {
      this.toastr.error('Agregue al menos un vehículo o seleccione "No" en registrar vehículos.');
      return;
    }
    if (this.hasDuplicateVehicles()) {
      this.toastr.error('Hay vehículos duplicados. Cada vehículo debe tener una placa distinta.');
      return;
    }
    if (this.wantPets && this.pets.length === 0) {
      this.toastr.error('Agregue al menos una mascota o seleccione "No" en registrar mascotas.');
      return;
    }
    if (this.hasDuplicatePets()) {
      this.toastr.error('Hay mascotas duplicadas. Cada mascota debe tener especie y nombre distintos.');
      return;
    }
    const payload = this.buildPayload();
    this.submitting = true;
    this.publicReg.register(payload).subscribe({
      next: (res: { data?: PublicRegisterResponseData }) => {
        this.submitting = false;
        const created = res?.data?.created_users;
        if (created?.length) {
          const first = created[0];
          this.toastr.success(
            `Registro completado. Usuario: ${first.username_system}, Contraseña temporal: ${first.temporary_password}. Debe cambiar la contraseña en el primer acceso.`,
            undefined,
            { timeOut: 12000 }
          );
          this.router.navigate(['/login'], { queryParams: { username: first.username_system } });
        } else {
          this.toastr.success('Registro completado.');
          this.router.navigate(['/login']);
        }
      },
      error: err => {
        this.submitting = false;
        const msg = this.getRegisterErrorMessage(err);
        this.toastr.error(msg);
      }
    });
  }

  /** Mensaje corto y claro según el error del backend. */
  private getRegisterErrorMessage(err: any): string {
    const body = err?.error;
    const text = (body?.error ?? body?.message ?? err?.message ?? '').toString();
    const status = err?.status;
    if (status === 409 || /ya existe.*persona|persona con documento|documento.*registrado/i.test(text)) {
      return 'Este DNI ya está registrado. No se puede registrar al mismo propietario dos veces.';
    }
    if (/ya existe.*vehículo|vehículo con la placa/i.test(text)) {
      return 'Ya existe un vehículo con esa placa. Use otra placa o verifique en el sistema.';
    }
    if (status === 400 && text) {
      if (/propietario duplicado|mismo DNI.*titular/i.test(text)) return 'No puede registrar el mismo propietario dos veces. Los dos titulares deben tener DNI diferente.';
      if (/vehículo duplicado|misma placa/i.test(text)) return 'Hay vehículos duplicados. Cada vehículo debe tener una placa distinta.';
      if (/mascota duplicada|misma mascota/i.test(text)) return 'Hay mascotas duplicadas. Cada mascota debe tener especie y nombre distintos.';
      if (/propietario|doc_number|first_name|obligatorio/i.test(text)) return 'Faltan datos obligatorios. Revise el formulario.';
      return text.length > 60 ? 'Datos incorrectos. Revise el formulario.' : text;
    }
    if (status === 404) return 'No se encontró la vivienda seleccionada.';
    return 'Error desconocido. Intente de nuevo o contacte soporte.';
  }
}
