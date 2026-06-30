import { Injectable, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ToastrService } from 'ngx-toastr';
import { Subscription, interval } from 'rxjs';

const STORAGE_KEY = 'vc_app_deploy_version';
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

interface DeployVersionInfo {
  version: string;
  builtAt?: string;
}

/**
 * Detecta cuando hay un despliegue nuevo y pide recargar la app.
 * Evita que usuarios queden con JS en caché (p. ej. pantallas de licencia ya eliminadas).
 */
@Injectable({ providedIn: 'root' })
export class VersionCheckService implements OnDestroy {
  private pollSub: Subscription | null = null;
  private notified = false;
  private readonly onFocus = () => this.checkNow();

  constructor(
    private http: HttpClient,
    private toastr: ToastrService,
  ) {}

  start(): void {
    if (typeof window === 'undefined') {
      return;
    }
    this.checkNow();
    this.pollSub = interval(CHECK_INTERVAL_MS).subscribe(() => this.checkNow());
    window.addEventListener('focus', this.onFocus);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  ngOnDestroy(): void {
    this.pollSub?.unsubscribe();
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', this.onFocus);
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
  }

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'visible') {
      this.checkNow();
    }
  };

  private checkNow(): void {
    const url = `version.json?_=${Date.now()}`;
    this.http.get<DeployVersionInfo>(url, { responseType: 'json' as 'json' }).subscribe({
      next: (info) => this.handleVersion(info?.version),
      error: () => {
        /* En dev local puede no existir version.json */
      },
    });
  }

  private handleVersion(remoteVersion: string | undefined): void {
    if (!remoteVersion || remoteVersion === 'dev') {
      return;
    }
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored) {
      sessionStorage.setItem(STORAGE_KEY, remoteVersion);
      return;
    }
    if (stored === remoteVersion || this.notified) {
      return;
    }
    this.notified = true;
    const ref = this.toastr.info(
      'Pulse este aviso para recargar y obtener la versión nueva.',
      'Actualización disponible',
      {
        timeOut: 0,
        extendedTimeOut: 0,
        closeButton: true,
        tapToDismiss: false,
      },
    );
    ref.onTap.subscribe(() => this.reloadApp());
    ref.onHidden.subscribe(() => {
      this.notified = false;
    });
  }

  reloadApp(): void {
    sessionStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  }
}
