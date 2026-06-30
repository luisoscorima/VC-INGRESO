import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AppComponent } from '../app.component';
import { AuthService } from '../auth.service';
import { ApiService } from '../api.service';
import { UsersService } from '../users.service';
import { ToastrService } from 'ngx-toastr';
import { NavPermissionService } from '../nav-permission.service';
import { VersionCheckService } from '../version-check.service';
import { NavModuleDef } from '../nav-modules.config';
import { User } from '../user';

@Component({
  selector: 'app-side-nav',
  templateUrl: './side-nav.component.html',
  styleUrls: ['./side-nav.component.css']
})
export class SideNavComponent extends AppComponent implements OnInit {
  uploadingPhoto = false;
  infoSectionExpanded = false;
  gestionModules: NavModuleDef[] = [];
  adminModules: NavModuleDef[] = [];

  constructor(
    router: Router,
    auth: AuthService,
    usersService: UsersService,
    toastr: ToastrService,
    api: ApiService,
    versionCheck: VersionCheckService,
    private navPerm: NavPermissionService
  ) {
    super(router, auth, usersService, toastr, api, versionCheck);
  }

  ngOnInit(): void {
    this.syncUserFromAuth(this.auth.getUser());
    this.auth.user$.subscribe((u) => this.syncUserFromAuth(u));

    this.refreshNavModules();
    this.navPerm.permissions$.subscribe(() => this.refreshNavModules());
    if (this.auth.isAuthenticated()) {
      this.navPerm.load().subscribe();
    }
  }

  /** Side-nav es instancia aparte de AppComponent; hay que sincronizar user desde AuthService. */
  private syncUserFromAuth(u: User | null): void {
    if (u) {
      this.user = u;
      this.logged = true;
    }
  }

  private refreshNavModules(): void {
    if (!this.auth.isSessionRolePersonValid()) {
      this.gestionModules = [];
      this.adminModules = [];
      return;
    }
    this.gestionModules = this.navPerm.getVisibleModules('gestion');
    this.adminModules = this.navPerm.getVisibleModules('admin');
  }

  showGestionSection(): boolean {
    return this.gestionModules.length > 0;
  }

  showAdminSection(): boolean {
    return this.adminModules.length > 0;
  }

  onProfilePhotoClick(): void {
    const el = document.getElementById('profile-photo-input') as HTMLInputElement;
    if (el) el.click();
  }

  onProfilePhotoChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      this.toastr.warning('Seleccione una imagen (JPG, PNG o GIF).');
      input.value = '';
      return;
    }
    this.uploadingPhoto = true;
    this.api.uploadProfilePhoto(file).subscribe({
      next: (res: any) => {
        this.uploadingPhoto = false;
        input.value = '';
        const user = res?.data;
        if (user) {
          this.auth.updateCurrentUser(user);
          this.toastr.success('Foto de perfil actualizada.');
        }
      },
      error: () => {
        this.uploadingPhoto = false;
        input.value = '';
      }
    });
  }

  onNavPointerDown(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    const link = target.closest('a.nav-item') as HTMLElement | null;
    if (!link) {
      return;
    }

    link.blur();
  }

  onNavInteraction(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    const link = target.closest('a.nav-item') as HTMLElement | null;
    if (!link) {
      return;
    }

    link.blur();
    const main = document.querySelector('main') as HTMLElement | null;
    if (main) {
      const hadTabIndex = main.hasAttribute('tabindex');
      if (!hadTabIndex) {
        main.setAttribute('tabindex', '-1');
      }
      main.focus({ preventScroll: true });
      if (!hadTabIndex) {
        setTimeout(() => main.removeAttribute('tabindex'), 0);
      }
    }

    this.closeMobileSidebarSafely();
  }

  private closeMobileSidebarSafely(): void {
    if (window.innerWidth >= 640) {
      return;
    }

    this.setMobileSidebarOpen(false);

    setTimeout(() => {
      this.setMobileSidebarOpen(false);
      document.body.classList.remove('overflow-hidden');
      this.removeMobileDrawerBackdrops();
    }, 0);

    document.body.classList.remove('overflow-hidden');
    this.removeMobileDrawerBackdrops();
  }

  isStaffUser(): boolean {
    return this.auth.isStaff();
  }

  showCodigoQrNav(): boolean {
    return this.auth.isStaff() || this.auth.canGenerateHouseAccessQr();
  }

  showReservationsNav(): boolean {
    return this.auth.canAccessReservationsPage();
  }

  showGestionNav(): boolean {
    return this.showGestionSection();
  }

  showAccessPointsNav(): boolean {
    return this.showAdminSection();
  }

  toggleInfoSection(): void {
    this.infoSectionExpanded = !this.infoSectionExpanded;
  }

  private removeMobileDrawerBackdrops(): void {
    const backdropSelectors = [
      '[drawer-backdrop]',
      '[data-drawer-backdrop]',
      '.drawer-backdrop',
      'div.fixed.inset-0.z-30.bg-gray-900\\/50',
      'div.fixed.inset-0.z-30.dark\\:bg-gray-900\\/80'
    ];

    backdropSelectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => el.remove());
    });
  }
}