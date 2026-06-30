import { Component, HostListener, OnInit } from '@angular/core';
import { AppComponent } from '../app.component';
import { ApiService } from '../api.service';
import { AuthService } from '../auth.service';
import { Router } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { UsersService } from '../users.service';
import { VersionCheckService } from '../version-check.service';

interface AnnouncementItem {
  id?: string | null;
  title: string;
  message: string;
  start_at?: string;
  end_at?: string;
  cta_label?: string;
  cta_url?: string;
  image_url?: string;
  updated_at?: string;
}

const ANNOUNCEMENT_SEEN_STORAGE = 'readonly_announcements_seen_v1';

interface SurveyItem {
  id: number;
  title: string;
  description: string;
  question_type: 'CLOSED' | 'OPEN' | 'MULTIPLE' | 'CHECKBOX';
  options: string[];
  has_answered?: boolean | null;
}

@Component({
  selector: 'app-nav-bar',
  templateUrl: './nav-bar.component.html',
  styleUrls: ['./nav-bar.component.css']
})
export class NavBarComponent extends AppComponent implements OnInit {
  announcements: AnnouncementItem[] = [];
  activeAnnouncements: AnnouncementItem[] = [];
  announcementQueue: AnnouncementItem[] = [];
  announcementQueueIndex = 0;
  currentAnnouncement: AnnouncementItem | null = null;
  isAnnouncementModalOpen = false;
  hasUnreadAnnouncements = false;
  surveys: SurveyItem[] = [];
  pendingSurveys: SurveyItem[] = [];
  currentSurvey: SurveyItem | null = null;
  isSurveyModalOpen = false;
  surveyAnswerOption = '';
  surveyAnswerOptions: string[] = [];
  surveyAnswerText = '';
  submittingSurvey = false;

  constructor(
    router: Router,
    auth: AuthService,
    usersService: UsersService,
    toastr: ToastrService,
    api: ApiService,
    versionCheck: VersionCheckService,
  ) {
    super(router, auth, usersService, toastr, api, versionCheck);
  }

  override ngOnInit(): void {
    super.ngOnInit();
    this.loadAnnouncements();
    this.loadSurveys();
  }

  onBellClick(): void {
    if (this.activeAnnouncements.length > 0) {
      this.startAnnouncementQueue(this.activeAnnouncements);
      return;
    }
    if (this.pendingSurveys.length > 0) {
      this.openPendingSurveyPopup();
      return;
    }
    if (!this.currentAnnouncement) {
      return;
    }
    this.isAnnouncementModalOpen = true;
  }

  closeAnnouncementModal(markSeen: boolean): void {
    if (markSeen && this.currentAnnouncement) {
      this.markAnnouncementAsSeen(this.currentAnnouncement);
      this.hasUnreadAnnouncements = this.activeAnnouncements.some((a) => !this.isAnnouncementSeen(a));
    }
    if (this.moveToNextAnnouncementInQueue()) {
      return;
    }
    this.clearAnnouncementQueue();
    this.isAnnouncementModalOpen = false;
    this.openPendingSurveyPopup();
  }

  onAnnouncementBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closeAnnouncementModal(true);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isAnnouncementModalOpen) {
      this.closeAnnouncementModal(true);
    }
  }

  private loadAnnouncements(): void {
    this.api.get<AnnouncementItem[]>('api/v1/announcements/active').subscribe({
      next: (res) => {
        const rows = Array.isArray(res?.data) ? res.data : [];
        this.announcements = rows;
        this.activeAnnouncements = rows.filter((a) => this.isAnnouncementActive(a));
        this.currentAnnouncement = this.activeAnnouncements[0] ?? null;
        this.hasUnreadAnnouncements = this.activeAnnouncements.some((a) => !this.isAnnouncementSeen(a));
        const unreadAnnouncements = this.activeAnnouncements.filter((a) => !this.isAnnouncementSeen(a));
        if (unreadAnnouncements.length > 0) {
          this.startAnnouncementQueue(unreadAnnouncements);
        }
      },
      error: () => {
        this.announcements = [];
        this.activeAnnouncements = [];
        this.clearAnnouncementQueue();
        this.currentAnnouncement = null;
        this.hasUnreadAnnouncements = false;
      }
    });
  }

  private isAnnouncementActive(item: AnnouncementItem): boolean {
    const now = new Date();
    const startStr = String(item.start_at ?? '').trim();
    const endStr = String(item.end_at ?? '').trim();
    const start = startStr ? new Date(startStr) : null;
    const end = endStr ? new Date(endStr) : null;
    if (start && !isNaN(start.getTime()) && now < start) return false;
    if (end && !isNaN(end.getTime()) && now > end) return false;
    return true;
  }

  private isAnnouncementSeen(item: AnnouncementItem): boolean {
    const seen = this.getSeenAnnouncementKeys();
    return seen.includes(this.announcementKey(item));
  }

  private markAnnouncementAsSeen(item: AnnouncementItem): void {
    const key = this.announcementKey(item);
    const current = this.getSeenAnnouncementKeys();
    if (!current.includes(key)) {
      localStorage.setItem(ANNOUNCEMENT_SEEN_STORAGE, JSON.stringify([...current, key]));
    }
  }

  private getSeenAnnouncementKeys(): string[] {
    try {
      const raw = localStorage.getItem(ANNOUNCEMENT_SEEN_STORAGE);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
    } catch {
      return [];
    }
  }

  private announcementKey(item: AnnouncementItem): string {
    const id = String(item.id ?? '').trim();
    const title = String(item.title ?? '').trim();
    const updated = String(item.updated_at ?? '').trim();
    return `${id || title}::${updated}`;
  }

  announcementImageUrl(item: AnnouncementItem | null): string | null {
    return this.api.getPhotoUrl(item?.image_url);
  }

  private loadSurveys(): void {
    this.api.get<SurveyItem[]>('api/v1/surveys/active').subscribe({
      next: (res) => {
        const rows = Array.isArray(res?.data) ? res.data : [];
        this.surveys = rows;
        this.pendingSurveys = rows.filter((s) => !s.has_answered);
        if (!this.isAnnouncementModalOpen) {
          this.openPendingSurveyPopup();
        }
      },
      error: () => {
        this.surveys = [];
        this.pendingSurveys = [];
      }
    });
  }

  private openPendingSurveyPopup(): void {
    if (this.isAnnouncementModalOpen || this.announcementQueue.length > 0) {
      return;
    }
    if (this.pendingSurveys.length === 0) {
      this.isSurveyModalOpen = false;
      this.currentSurvey = null;
      return;
    }
    this.currentSurvey = this.pendingSurveys[0];
    this.surveyAnswerOption = '';
    this.surveyAnswerOptions = [];
    this.surveyAnswerText = '';
    this.isSurveyModalOpen = true;
  }

  hasBellAlerts(): boolean {
    return this.hasUnreadAnnouncements || this.pendingSurveys.length > 0;
  }

  private startAnnouncementQueue(queue: AnnouncementItem[]): void {
    if (!Array.isArray(queue) || queue.length === 0) {
      this.clearAnnouncementQueue();
      this.isAnnouncementModalOpen = false;
      return;
    }
    this.announcementQueue = [...queue];
    this.announcementQueueIndex = 0;
    this.currentAnnouncement = this.announcementQueue[0] ?? null;
    this.isAnnouncementModalOpen = !!this.currentAnnouncement;
    if (this.isAnnouncementModalOpen) {
      this.isSurveyModalOpen = false;
    }
  }

  private moveToNextAnnouncementInQueue(): boolean {
    if (this.announcementQueue.length === 0) {
      return false;
    }
    this.announcementQueueIndex += 1;
    if (this.announcementQueueIndex >= this.announcementQueue.length) {
      return false;
    }
    this.currentAnnouncement = this.announcementQueue[this.announcementQueueIndex] ?? null;
    this.isAnnouncementModalOpen = !!this.currentAnnouncement;
    return this.isAnnouncementModalOpen;
  }

  private clearAnnouncementQueue(): void {
    this.announcementQueue = [];
    this.announcementQueueIndex = 0;
  }

  closeSurveyModal(): void {
    this.isSurveyModalOpen = false;
  }

  onSurveyBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closeSurveyModal();
    }
  }

  submitSurvey(): void {
    if (!this.currentSurvey || this.submittingSurvey) {
      return;
    }
    const payload: any = {};
    if (this.currentSurvey.question_type === 'OPEN') {
      const txt = this.surveyAnswerText.trim();
      if (!txt) {
        this.toastr.warning('Escribe una respuesta.');
        return;
      }
      payload.answer_text = txt;
    } else if (this.currentSurvey.question_type === 'CHECKBOX') {
      const opts = this.surveyAnswerOptions.filter((x) => String(x ?? '').trim() !== '');
      if (opts.length === 0) {
        this.toastr.warning('Selecciona al menos una opción.');
        return;
      }
      payload.answer_options = opts;
    } else {
      const opt = this.surveyAnswerOption.trim();
      if (!opt) {
        this.toastr.warning('Selecciona una opción.');
        return;
      }
      payload.answer_option = opt;
    }
    this.submittingSurvey = true;
    this.api.post(`api/v1/surveys/${this.currentSurvey.id}/respond`, payload).subscribe({
      next: () => {
        this.submittingSurvey = false;
        this.toastr.success('Respuesta registrada.');
        this.pendingSurveys = this.pendingSurveys.filter((s) => s.id !== this.currentSurvey?.id);
        this.openPendingSurveyPopup();
      },
      error: (e) => {
        this.submittingSurvey = false;
        this.toastr.error(e?.message || 'No se pudo guardar la respuesta.');
      }
    });
  }

  onSurveyOptionToggle(option: string, checked: boolean): void {
    if (checked) {
      if (!this.surveyAnswerOptions.includes(option)) {
        this.surveyAnswerOptions = [...this.surveyAnswerOptions, option];
      }
      return;
    }
    this.surveyAnswerOptions = this.surveyAnswerOptions.filter((x) => x !== option);
  }

  surveyOptions(item: SurveyItem | null): string[] {
    if (!item) {
      return [];
    }
    const opts = Array.isArray(item.options) ? item.options.filter((x) => String(x ?? '').trim() !== '') : [];
    if (opts.length > 0) {
      return opts;
    }
    if (item.question_type === 'CLOSED') {
      return ['Si', 'No', 'Tal vez'];
    }
    return [];
  }

}
