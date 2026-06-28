import { Component, OnInit } from '@angular/core';
import { AuthService } from '../auth.service';
import { User } from '../user';
import { UsersService } from '../users.service';
import { ToastrService } from 'ngx-toastr';
import { NavPermissionService } from '../nav-permission.service';
import { NAV_PERMISSION_ROLES, NavModuleRow, navModuleLabelByKey } from '../nav-modules.config';

export interface MyPersonForm {
  gender: string;
  birth_date: string;
  cel_number: string;
  email: string;
  address: string;
  district: string;
  province: string;
  region: string;
  civil_status: string;
}

@Component({
  selector: 'app-settings',
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.css']
})
export class SettingsComponent implements OnInit {
  user: User | null = null;
  isAdmin = false;
  settingsTab = 0;
  permissionRoles = [...NAV_PERMISSION_ROLES];
  permissionModules: NavModuleRow[] = [];
  permissionMatrix: Record<string, Record<string, { can_view: number; can_manage: number }>> = {};
  loadingPermissions = false;
  savingPermissions = false;

  personForm: MyPersonForm = {
    gender: '',
    birth_date: '',
    cel_number: '',
    email: '',
    address: '',
    district: '',
    province: '',
    region: '',
    civil_status: ''
  };
  savingPerson = false;
  passwordForm = {
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  };
  savingPassword = false;

  constructor(
    private auth: AuthService,
    private usersService: UsersService,
    private toastr: ToastrService,
    public navPerm: NavPermissionService
  ) {}

  ngOnInit() {
    this.auth.user$.subscribe((u) => {
      this.user = u || null;
      this.isAdmin = this.user?.role_system === 'ADMINISTRADOR';
      this.fillPersonForm();
      if (this.isAdmin && this.settingsTab === 1) {
        this.loadPermissionsMatrix();
      }
    });
    const stored = this.auth.getUser();
    if (stored) {
      this.user = stored;
      this.isAdmin = this.user?.role_system === 'ADMINISTRADOR';
      this.fillPersonForm();
    }
  }

  onSettingsTabChange(index: number): void {
    this.settingsTab = index;
    if (index === 1 && this.isAdmin) {
      this.loadPermissionsMatrix();
    }
  }

  loadPermissionsMatrix(): void {
    this.loadingPermissions = true;
    this.navPerm.getAdminMatrix().subscribe({
      next: (matrix) => {
        this.loadingPermissions = false;
        this.permissionModules = (matrix?.modules || [])
          .map((m) => ({ ...m, label: navModuleLabelByKey(m.module_key, m.label) }))
          .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
        this.permissionMatrix = matrix?.permissions || {};
      },
      error: () => {
        this.loadingPermissions = false;
        this.toastr.error('No se pudieron cargar los permisos.');
      }
    });
  }

  permView(role: string, moduleKey: string): boolean {
    return Number(this.permissionMatrix[role]?.[moduleKey]?.can_view || 0) === 1;
  }

  permManage(role: string, moduleKey: string): boolean {
    return Number(this.permissionMatrix[role]?.[moduleKey]?.can_manage || 0) === 1;
  }

  setPermView(role: string, moduleKey: string, checked: boolean): void {
    if (!this.permissionMatrix[role]) {
      this.permissionMatrix[role] = {};
    }
    if (!this.permissionMatrix[role][moduleKey]) {
      this.permissionMatrix[role][moduleKey] = { can_view: 0, can_manage: 0 };
    }
    this.permissionMatrix[role][moduleKey].can_view = checked ? 1 : 0;
    if (!checked) {
      this.permissionMatrix[role][moduleKey].can_manage = 0;
    }
  }

  setPermManage(role: string, moduleKey: string, checked: boolean): void {
    if (!this.permissionMatrix[role]) {
      this.permissionMatrix[role] = {};
    }
    if (!this.permissionMatrix[role][moduleKey]) {
      this.permissionMatrix[role][moduleKey] = { can_view: 0, can_manage: 0 };
    }
    if (checked) {
      this.permissionMatrix[role][moduleKey].can_view = 1;
      this.permissionMatrix[role][moduleKey].can_manage = 1;
    } else {
      this.permissionMatrix[role][moduleKey].can_manage = 0;
    }
  }

  moduleEnabled(mod: NavModuleRow): boolean {
    return Number(mod.is_enabled || 0) === 1;
  }

  setModuleEnabled(mod: NavModuleRow, checked: boolean): void {
    mod.is_enabled = checked ? 1 : 0;
  }

  savePermissions(): void {
    this.savingPermissions = true;
    const payload = {
      modules: this.permissionModules.map((m) => ({
        module_key: m.module_key,
        is_enabled: Number(m.is_enabled || 0) ? 1 : 0
      })),
      permissions: this.permissionMatrix
    };
    this.navPerm.saveAdminMatrix(payload as any).subscribe({
      next: () => {
        this.savingPermissions = false;
        this.toastr.success('Permisos guardados correctamente.');
        this.loadPermissionsMatrix();
      },
      error: (err) => {
        this.savingPermissions = false;
        this.toastr.error(err?.error?.error || 'No se pudieron guardar los permisos.');
      }
    });
  }

  canViewModuleLink(key: string): boolean {
    return this.navPerm.canView(key);
  }

  private fillPersonForm(): void {
    const u = this.user as any;
    if (!u) return;
    this.personForm = {
      gender: u.gender ?? '',
      birth_date: this.normalizeBirthDateForInput(u.birth_date) ?? '',
      cel_number: u.cel_number ?? '',
      email: u.email ?? '',
      address: u.address ?? '',
      district: u.district ?? '',
      province: u.province ?? '',
      region: u.region ?? '',
      civil_status: u.civil_status ?? ''
    };
  }

  private normalizeBirthDateForInput(value: string | null | undefined): string | null {
    if (!value) return null;
    const s = String(value).trim();
    if (s.length >= 10) return s.substring(0, 10);
    return s || null;
  }

  savePerson(): void {
    this.savingPerson = true;
    this.usersService.updateMyPerson({
      gender: this.personForm.gender || undefined,
      birth_date: this.personForm.birth_date || undefined,
      cel_number: this.personForm.cel_number || undefined,
      email: this.personForm.email || undefined,
      address: this.personForm.address || undefined,
      district: this.personForm.district || undefined,
      province: this.personForm.province || undefined,
      region: this.personForm.region || undefined,
      civil_status: this.personForm.civil_status || undefined
    }).subscribe({
      next: (updated) => {
        this.savingPerson = false;
        if (updated) this.auth.updateCurrentUser(updated);
        this.toastr.success('Datos personales actualizados correctamente.');
      },
      error: () => {
        this.savingPerson = false;
        this.toastr.error('No se pudieron actualizar los datos. Intenta de nuevo.');
      }
    });
  }

  savePassword(): void {
    const { currentPassword, newPassword, confirmPassword } = this.passwordForm;
    if (!currentPassword.trim()) {
      this.toastr.warning('Ingresa tu contraseña actual.');
      return;
    }
    if (!newPassword.trim()) {
      this.toastr.warning('Ingresa la nueva contraseña.');
      return;
    }
    if (newPassword.length < 6) {
      this.toastr.warning('La nueva contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      this.toastr.warning('La nueva contraseña y la confirmación no coinciden.');
      return;
    }
    this.savingPassword = true;
    this.usersService.changeMyPassword(currentPassword.trim(), newPassword.trim()).subscribe({
      next: () => {
        this.savingPassword = false;
        this.passwordForm = { currentPassword: '', newPassword: '', confirmPassword: '' };
        this.toastr.success('Contraseña actualizada correctamente.');
      },
      error: (err) => {
        this.savingPassword = false;
        const msg = err?.error?.error ?? err?.error?.message ?? 'No se pudo cambiar la contraseña. Verifica la contraseña actual.';
        this.toastr.error(msg);
      }
    });
  }
}
