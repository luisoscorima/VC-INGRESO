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
import { compressImageFile, MOBILE_PHOTO_COMPRESS } from '../shared/compress-image';

@Component({
  selector: 'app-side-nav',
  templateUrl: './side-nav.component.html',
  styleUrls: ['./side-nav.component.css']
})
export class SideNavComponent extends AppComponent implements OnInit {
  uploadingPhoto = false;
  compressingProfilePhoto = false;
  showProfilePhotoPicker = false;
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
    this.showProfilePhotoPicker = true;
  }

  closeProfilePhotoPicker(): void {
    this.showProfilePhotoPicker = false;
  }

  isProfilePhotoBusy(): boolean {
    return this.compressingProfilePhoto || this.uploadingPhoto;
  }

  onProfilePhotoSelected(file: File): void {
    void this.uploadProfilePhoto(file);
  }

  private async uploadProfilePhoto(file: File): Promise<void> {
    if (!file?.type.startsWith('image/')) {
      this.toastr.warning('Seleccione una imagen (JPG, PNG o GIF).');
      return;
    }

    this.compressingProfilePhoto = true;
    let ready = file;
    try {
      ready = await compressImageFile(file, MOBILE_PHOTO_COMPRESS);
    } catch {
      this.toastr.warning('No se pudo optimizar la foto; se usará el original.');
    }
    this.compressingProfilePhoto = false;
    this.uploadingPhoto = true;
    this.api.uploadProfilePhoto(ready, { skipCompress: true }).subscribe({
      next: (res: any) => {
        this.uploadingPhoto = false;
        const user = res?.data;
        if (user) {
          this.auth.updateCurrentUser(user);
          this.syncUserFromAuth(user);
          this.toastr.success('Foto de perfil actualizada.');
          this.closeProfilePhotoPicker();
        }
      },
      error: () => {
        this.uploadingPhoto = false;
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