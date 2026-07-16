import { Component, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ToastrService } from 'ngx-toastr';
import { ApiService } from '../api.service';
import { AuthService } from '../auth.service';

interface TutorialVideo {
  title: string;
  youtubeId: string;
}

interface TutorialTopic {
  title: string;
  description?: string | null;
  videos: TutorialVideo[];
}

@Component({
  selector: 'app-tutorial',
  templateUrl: './tutorial.component.html',
  styleUrls: ['./tutorial.component.css']
})
export class TutorialComponent implements OnInit {
  topics: TutorialTopic[] = [];
  loading = false;
  saving = false;
  editorOpen = false;

  draftTopicTitle = '';
  draftTopicDescription = '';
  draftVideoTitle = '';
  draftYoutubeId = '';
  selectedTopicIndex: number | null = null;

  constructor(
    public readonly auth: AuthService,
    private readonly sanitizer: DomSanitizer,
    private readonly api: ApiService,
    private readonly toastr: ToastrService
  ) {}

  ngOnInit(): void {
    this.loadTopics();
  }

  private loadTopics(): void {
    this.loading = true;
    this.api.get<{ tutorial_topics: TutorialTopic[] }>('api/v1/readonly/content').subscribe({
      next: (res) => {
        const topics = res?.data?.tutorial_topics;
        this.topics = Array.isArray(topics) ? topics.map((t) => ({
          title: t.title,
          description: t.description ?? null,
          videos: Array.isArray(t.videos) ? t.videos.map((v) => ({
            title: v.title,
            youtubeId: v.youtubeId
          })) : []
        })) : [];
        this.loading = false;
      },
      error: () => {
        this.topics = [];
        this.loading = false;
      }
    });
  }

  embedUrl(youtubeId: string): SafeResourceUrl {
    const id = String(youtubeId ?? '').trim();
    return this.sanitizer.bypassSecurityTrustResourceUrl(`https://www.youtube.com/embed/${encodeURIComponent(id)}`);
  }

  toggleEditor(): void {
    this.editorOpen = !this.editorOpen;
  }

  addTopic(): void {
    const title = this.draftTopicTitle.trim();
    if (!title) {
      this.toastr.warning('Ingrese el título del tema.');
      return;
    }
    this.topics = [
      ...this.topics,
      {
        title,
        description: this.draftTopicDescription.trim() || null,
        videos: []
      }
    ];
    this.draftTopicTitle = '';
    this.draftTopicDescription = '';
    this.persist('Tema agregado.');
  }

  removeTopic(index: number): void {
    this.topics = this.topics.filter((_, i) => i !== index);
    if (this.selectedTopicIndex === index) {
      this.selectedTopicIndex = null;
    } else if (this.selectedTopicIndex !== null && this.selectedTopicIndex > index) {
      this.selectedTopicIndex -= 1;
    }
    this.persist('Tema eliminado.');
  }

  addVideo(): void {
    if (this.selectedTopicIndex === null || !this.topics[this.selectedTopicIndex]) {
      this.toastr.warning('Seleccione un tema.');
      return;
    }
    const title = this.draftVideoTitle.trim();
    const youtubeId = this.extractYoutubeId(this.draftYoutubeId);
    if (!title || !youtubeId) {
      this.toastr.warning('Ingrese título y YouTube ID (o URL) válidos.');
      return;
    }
    const topic = this.topics[this.selectedTopicIndex];
    topic.videos = [...topic.videos, { title, youtubeId }];
    this.topics = [...this.topics];
    this.draftVideoTitle = '';
    this.draftYoutubeId = '';
    this.persist('Video agregado.');
  }

  removeVideo(topicIndex: number, videoIndex: number): void {
    const topic = this.topics[topicIndex];
    if (!topic) return;
    topic.videos = topic.videos.filter((_, i) => i !== videoIndex);
    this.topics = [...this.topics];
    this.persist('Video eliminado.');
  }

  private extractYoutubeId(raw: string): string {
    const value = String(raw ?? '').trim();
    if (!value) return '';
    const match = value.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{6,})/);
    if (match?.[1]) return match[1];
    return value.replace(/[?&].*$/, '').replace(/[^A-Za-z0-9_-]/g, '');
  }

  private persist(successMessage?: string): void {
    if (!this.auth.isAdministratorRole()) {
      return;
    }
    this.saving = true;
    this.api.put('api/v1/readonly/content/tutorials', { tutorial_topics: this.topics }).subscribe({
      next: (res) => {
        const topics = res?.data?.tutorial_topics;
        if (Array.isArray(topics)) {
          this.topics = topics;
        }
        this.saving = false;
        if (successMessage) {
          this.toastr.success(successMessage);
        }
      },
      error: (e) => {
        this.saving = false;
        this.toastr.error(e?.message || 'No se pudo guardar.');
        this.loadTopics();
      }
    });
  }
}
