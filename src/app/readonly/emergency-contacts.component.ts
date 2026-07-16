import { Component, OnInit } from '@angular/core';
import { ToastrService } from 'ngx-toastr';
import { ApiService } from '../api.service';
import { AuthService } from '../auth.service';

interface EmergencyContact {
  label: string;
  phone: string;
  detail?: string | null;
}

@Component({
  selector: 'app-emergency-contacts',
  templateUrl: './emergency-contacts.component.html',
  styleUrls: ['./emergency-contacts.component.css']
})
export class EmergencyContactsComponent implements OnInit {
  contacts: EmergencyContact[] = [];
  loading = false;
  saving = false;
  editorOpen = false;

  draftLabel = '';
  draftPhone = '';
  draftDetail = '';

  constructor(
    public readonly auth: AuthService,
    private readonly api: ApiService,
    private readonly toastr: ToastrService
  ) {}

  ngOnInit(): void {
    this.loadContacts();
  }

  private loadContacts(): void {
    this.loading = true;
    this.api.get<{ emergency_contacts: EmergencyContact[] }>('api/v1/readonly/content').subscribe({
      next: (res) => {
        const contacts = res?.data?.emergency_contacts;
        this.contacts = Array.isArray(contacts) ? contacts : [];
        this.loading = false;
      },
      error: () => {
        this.contacts = [];
        this.loading = false;
      }
    });
  }

  telHref(phone: string): string {
    const digits = String(phone ?? '').replace(/\s+/g, '').trim();
    if (!digits) {
      return '';
    }
    return `tel:${digits}`;
  }

  hasDialablePhone(phone: string): boolean {
    return this.telHref(phone).length > 0;
  }

  toggleEditor(): void {
    this.editorOpen = !this.editorOpen;
  }

  addContact(): void {
    const label = this.draftLabel.trim();
    const phone = this.draftPhone.trim();
    const detail = this.draftDetail.trim();
    if (!label) {
      this.toastr.warning('Ingrese la etiqueta del contacto.');
      return;
    }
    this.contacts = [
      ...this.contacts,
      { label, phone, detail: detail || null }
    ];
    this.draftLabel = '';
    this.draftPhone = '';
    this.draftDetail = '';
    this.persist('Contacto agregado.');
  }

  removeContact(index: number): void {
    this.contacts = this.contacts.filter((_, i) => i !== index);
    this.persist('Contacto eliminado.');
  }

  private persist(successMessage?: string): void {
    if (!this.auth.isAdministratorRole()) {
      return;
    }
    this.saving = true;
    this.api.put('api/v1/readonly/content/emergency-contacts', {
      emergency_contacts: this.contacts
    }).subscribe({
      next: (res) => {
        const contacts = res?.data?.emergency_contacts;
        if (Array.isArray(contacts)) {
          this.contacts = contacts;
        }
        this.saving = false;
        if (successMessage) {
          this.toastr.success(successMessage);
        }
      },
      error: (e) => {
        this.saving = false;
        this.toastr.error(e?.message || 'No se pudo guardar.');
        this.loadContacts();
      }
    });
  }
}
