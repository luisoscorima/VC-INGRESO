import { Component, OnInit } from '@angular/core';
import { ToastrService } from 'ngx-toastr';
import { ApiService } from '../api.service';
import { AuthService } from '../auth.service';
import { NavPermissionService } from '../nav-permission.service';

interface SurveyItem {
  id: number;
  title: string;
  description: string;
  question_type: 'CLOSED' | 'OPEN' | 'MULTIPLE' | 'CHECKBOX';
  options: string[];
  is_active: boolean;
  start_at?: string | null;
  end_at?: string | null;
  answers_count?: number | null;
  option_counts?: Record<string, number> | null;
}

@Component({
  selector: 'app-surveys',
  templateUrl: './surveys.component.html',
  styleUrls: ['./surveys.component.css']
})
export class SurveysComponent implements OnInit {
  loading = false;
  saving = false;
  surveys: SurveyItem[] = [];
  editingId: number | null = null;
  optionsText = '';
  form = this.emptyForm();

  constructor(
    public readonly auth: AuthService,
    public readonly navPerm: NavPermissionService,
    private readonly api: ApiService,
    private readonly toastr: ToastrService
  ) {}

  get canManageSurveys(): boolean {
    return this.navPerm.canManage('surveys');
  }

  ngOnInit(): void {
    this.loadRows();
  }

  private emptyForm() {
    return {
      title: '',
      description: '',
      question_type: 'CLOSED' as 'CLOSED' | 'OPEN' | 'MULTIPLE' | 'CHECKBOX',
      is_active: true,
      start_at: '',
      end_at: ''
    };
  }

  private loadRows(): void {
    this.loading = true;
    this.api.get<SurveyItem[]>('api/v1/surveys').subscribe({
      next: (res) => {
        this.surveys = Array.isArray(res?.data) ? res.data : [];
        this.loading = false;
      },
      error: () => {
        this.surveys = [];
        this.loading = false;
      }
    });
  }

  startCreate(): void {
    this.editingId = null;
    this.form = this.emptyForm();
    this.optionsText = '';
  }

  editRow(row: SurveyItem): void {
    this.editingId = row.id;
    this.form = {
      title: row.title ?? '',
      description: row.description ?? '',
      question_type: row.question_type ?? 'CLOSED',
      is_active: !!row.is_active,
      start_at: this.toDateTimeLocal(row.start_at),
      end_at: this.toDateTimeLocal(row.end_at)
    };
    this.optionsText = Array.isArray(row.options) ? row.options.join('\n') : '';
  }

  save(): void {
    if (!this.canManageSurveys) {
      this.toastr.error('Solo administradores.');
      return;
    }
    const options = this.parseOptions(this.optionsText);
    const payload = {
      title: this.form.title.trim(),
      description: this.form.description.trim(),
      question_type: this.form.question_type,
      options,
      is_active: !!this.form.is_active,
      start_at: this.form.start_at.trim(),
      end_at: this.form.end_at.trim()
    };
    if (!payload.title || !payload.description) {
      this.toastr.warning('Titulo y pregunta son obligatorios.');
      return;
    }
    if ((payload.question_type === 'MULTIPLE' || payload.question_type === 'CHECKBOX') && options.length < 2) {
      this.toastr.warning('Define al menos 2 opciones.');
      return;
    }

    this.saving = true;
    const req = this.editingId
      ? this.api.put(`api/v1/surveys/${this.editingId}`, payload)
      : this.api.post('api/v1/surveys', payload);
    req.subscribe({
      next: () => {
        this.saving = false;
        this.toastr.success(this.editingId ? 'Encuesta actualizada.' : 'Encuesta creada.');
        this.startCreate();
        this.loadRows();
      },
      error: (e) => {
        this.saving = false;
        this.toastr.error(e?.message || 'No se pudo guardar.');
      }
    });
  }

  removeRow(row: SurveyItem): void {
    if (!this.canManageSurveys) {
      return;
    }
    const nextState = !row.is_active;
    if (!window.confirm(`¿Cambiar estado de "${row.title}" a ${nextState ? 'Activa' : 'Inactiva'}?`)) {
      return;
    }
    const payload = {
      title: String(row.title ?? '').trim(),
      description: String(row.description ?? '').trim(),
      question_type: row.question_type,
      options: Array.isArray(row.options) ? row.options : [],
      is_active: nextState,
      start_at: this.toDateTimeLocal(row.start_at),
      end_at: this.toDateTimeLocal(row.end_at)
    };
    this.api.put(`api/v1/surveys/${row.id}`, payload).subscribe({
      next: () => {
        this.toastr.success(`Encuesta ${nextState ? 'activada' : 'inhabilitada'}.`);
        this.loadRows();
      },
      error: (e) => this.toastr.error(e?.message || 'No se pudo actualizar estado.')
    });
  }

  private parseOptions(text: string): string[] {
    return String(text ?? '')
      .split('\n')
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
  }

  private toDateTimeLocal(value: string | null | undefined): string {
    const v = String(value ?? '').trim();
    if (!v) return '';
    return v.replace(' ', 'T').slice(0, 16);
  }

  optionCountsText(row: SurveyItem): string {
    const counts = row.option_counts ?? {};
    const entries = Object.entries(counts);
    if (entries.length === 0) {
      return 'Sin respuestas por alternativa.';
    }
    return entries.map(([k, v]) => `${k}: ${v}`).join(' | ');
  }
}

