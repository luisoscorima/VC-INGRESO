import { AfterViewInit, Component, OnInit } from '@angular/core';
import { ToastrService } from 'ngx-toastr';
import { initFlowbite } from 'flowbite';
import { Pet } from '../pet';
import { ApiService } from '../api.service';
import { PetsService } from '../pets.service';
import { UsersService } from '../users.service';
import { User } from '../user';
import { EntranceService } from '../entrance.service';
import { House } from '../house';
import { AuthService } from '../auth.service';
import { NavPermissionService } from '../nav-permission.service';
import { ExpandableRowId, isExpandableRowOpen, toggleExpandableRow } from '../shared/expandable-row';

@Component({
  selector: 'app-pets',
  templateUrl: './pets.component.html',
  styleUrls: ['./pets.component.css']
})
export class PetsComponent implements OnInit, AfterViewInit {

  pets: Pet[] = [];
  houses: House[] = [];
  owners: User[] = [];
  
  showViewPhotoDialog = false;
  viewPhotoUrl: string | null = null;
  viewPhotoTitle = '';

  petToAdd: Partial<Pet> = { status_validated: 'PERMITIDO' };
  petToEdit: Pet | null = null;
  
  searchTerm: string = '';
  selectedBlock: string = '';
  selectedLot: string = '';
  currentPage: number = 1;
  pageSize: number = 10;
  pageSizeOptions: number[] = [10, 25, 50, 100];

  expandedRowId: ExpandableRowId = null;
  readonly tableColspan = 9;

  constructor(
    private api: ApiService,
    private petsService: PetsService,
    private usersService: UsersService,
    private entranceService: EntranceService,
    private toastr: ToastrService,
    private auth: AuthService,
    private navPerm: NavPermissionService
  ) {}

  get canManagePetsCrud(): boolean {
    return this.navPerm.canManage('pets');
  }

  ngOnInit(): void {
    this.loadPets();
    this.loadHouses();
    this.loadOwners();
  }

  ngAfterViewInit(): void {
    initFlowbite();
  }

  /** URL completa para mostrar la foto de la mascota (desde el servidor o API). */
  getPhotoUrl(url: string | null | undefined): string | null {
    return this.api.getPhotoUrl(url);
  }

  loadHouses(): void {
    this.entranceService.getAllHouses().subscribe({
      next: (res: any) => {
        const list = Array.isArray(res) ? res : (res?.data ?? []);
        this.houses = list;
      },
      error: () => this.toastr.error('Error al cargar casas')
    });
  }

  loadPets(): void {
    this.petsService.getPets().subscribe({
      next: (res) => {
        const pets = (res && (res as any).data) ? (res as any).data : (Array.isArray(res) ? res : []);
        this.pets = pets;
      },
      error: (err) => {
        this.toastr.error('Error al cargar mascotas: ' + err.message);
      }
    });
  }

  loadOwners(): void {
    this.usersService.getPersons({}).subscribe({
      next: (res) => {
        const persons = (res && (res as any).data) ? (res as any).data : (Array.isArray(res) ? res : []);
        this.owners = persons;
      },
      error: (err) => {
        this.toastr.error('Error al cargar propietarios');
      }
    });
  }

  newPet(): void {
    initFlowbite();
    this.petToAdd = { 
      name: '', 
      species: 'PERRO', 
      breed: '', 
      color: '',
      house_id: 0,
      status_validated: 'PERMITIDO'
    };
    document.getElementById('pets-new-pet-button')?.click();
  }

  editPet(pet: Pet): void {
    initFlowbite();
    this.petToEdit = { ...pet };
    document.getElementById('pets-edit-pet-button')?.click();
  }

  get filteredPets(): Pet[] {
    if (!this.searchTerm.trim() && !this.selectedBlock && !this.selectedLot) {
      return this.pets;
    }
    const search = this.searchTerm.toLowerCase();
    return this.pets.filter(p => {
      const matchesSearch = !this.searchTerm.trim() ||
        p.name.toLowerCase().includes(search) ||
        p.species.toLowerCase().includes(search) ||
        (p.breed && p.breed.toLowerCase().includes(search));
      
      const house = this.houses.find(h => h.house_id === p.house_id);
      const blockVal = (house?.block_house ?? '').toString();
      const lotVal = (house?.lot ?? '').toString();
      
      const matchesBlock = !this.selectedBlock || blockVal === this.selectedBlock;
      const matchesLot = !this.selectedLot || lotVal === this.selectedLot;
      
      return matchesSearch && matchesBlock && matchesLot;
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

  get petsTotalPages(): number {
    return Math.max(1, Math.ceil(this.filteredPets.length / this.pageSize));
  }

  get paginatedPets(): Pet[] {
    const safePage = Math.min(this.currentPage, this.petsTotalPages);
    if (safePage !== this.currentPage) {
      this.currentPage = safePage;
    }
    const start = (safePage - 1) * this.pageSize;
    return this.filteredPets.slice(start, start + this.pageSize);
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
    if (this.currentPage < this.petsTotalPages) {
      this.currentPage += 1;
      this.expandedRowId = null;
    }
  }

  getPetRowId(p: Pet): string | number {
    return p.id ?? p.name;
  }

  isRowOpen(p: Pet): boolean {
    return isExpandableRowOpen(this.expandedRowId, this.getPetRowId(p));
  }

  toggleRow(p: Pet): void {
    this.expandedRowId = toggleExpandableRow(this.expandedRowId, this.getPetRowId(p));
  }

  openViewPhoto(pet: Pet): void {
    this.viewPhotoUrl = this.api.getPhotoUrl(pet.photo_url);
    this.viewPhotoTitle = pet.name || 'Foto';
    this.showViewPhotoDialog = true;
  }

  closeViewPhoto(): void {
    this.showViewPhotoDialog = false;
    this.viewPhotoUrl = null;
  }

  createPet(): void {
    if (!this.validatePet(this.petToAdd)) {
      this.toastr.warning('Por favor complete los campos requeridos');
      return;
    }

    this.petsService.createPet(this.petToAdd).subscribe({
      next: (created) => {
        this.toastr.success('Mascota registrada exitosamente');
        this.clean();
        this.loadPets();
      },
      error: (err) => {
        this.toastr.error('Error al crear mascota: ' + err.message);
      }
    });
  }

  updatePet(): void {
    if (!this.petToEdit?.id) return;

    if (!this.validatePet(this.petToEdit)) {
      this.toastr.warning('Por favor complete los campos requeridos');
      return;
    }

    this.petsService.updatePet(this.petToEdit.id, this.petToEdit).subscribe({
      next: () => {
        this.toastr.success('Mascota actualizada');
        this.clean();
        this.loadPets();
      },
      error: (err) => {
        this.toastr.error('Error al actualizar: ' + err.message);
      }
    });
  }

  deletePet(pet: Pet): void {
    if (!confirm(`¿Está seguro de eliminar a ${pet.name}?`)) return;

    this.petsService.deletePet(pet.id!).subscribe({
      next: () => {
        this.toastr.success('Mascota eliminada');
        this.loadPets();
      },
      error: (err) => {
        this.toastr.error('Error al eliminar: ' + err.message);
      }
    });
  }

  validatePet(pet: Partial<Pet>): boolean {
    return !!(pet.name && pet.species && pet.house_id);
  }

  getHouseDisplay(pet: Pet): string {
    if (pet.block_house != null && pet.lot != null) {
      return `Mz:${pet.block_house} Lt:${pet.lot}`;
    }
    const house = this.houses.find(h => h.house_id === pet.house_id);
    if (house) return `Mz:${house.block_house} Lt:${house.lot}`;
    return `Casa #${pet.house_id}`;
  }

  getOwnerName(ownerId: number | undefined): string {
    if (ownerId == null) return '-';
    const owner = this.owners.find(o => (o as any).id === ownerId || o.user_id === ownerId);
    return owner ? `${owner.first_name} ${owner.paternal_surname}` : 'Desconocido';
  }

  getPetIcon(species: string): string {
    const icons: { [key: string]: string } = {
      'PERRO': 'pets',
      'GATO': 'pets',
      'AVE': 'pets',
      'PEQUEÑO MAMÍFERO': 'pets',
      'ACUÁTICO': 'pets',
      'EXÓTICO': 'pets',
      'OTRO': 'pets'
    };
    return icons[species] || 'pets';
  }

  clean(): void {
    this.petToAdd = { status_validated: 'PERMITIDO' };
    this.petToEdit = null;
  }
}
