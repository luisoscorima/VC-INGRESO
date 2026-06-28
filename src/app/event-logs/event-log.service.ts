import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from '../api.service';

export interface EventLogItem {
  id: number;
  occurred_at: string;
  actor_user_id?: number | null;
  actor_role?: string | null;
  actor_username?: string | null;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  summary: string;
  details_json?: unknown;
  ip_address?: string | null;
  user_agent?: string | null;
}

export interface EventLogListResult {
  items: EventLogItem[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
  filters: {
    from: string;
    to: string;
    retention_days: number;
  };
}

export interface EventLogQuery {
  from?: string;
  to?: string;
  action?: string;
  entity_type?: string;
  actor_user_id?: number;
  q?: string;
  page?: number;
  page_size?: number;
}

@Injectable({ providedIn: 'root' })
export class EventLogService {
  constructor(private api: ApiService) {}

  list(query: EventLogQuery = {}): Observable<EventLogListResult> {
    const params: Record<string, string | number> = {};
    if (query.from) params['from'] = query.from;
    if (query.to) params['to'] = query.to;
    if (query.action) params['action'] = query.action;
    if (query.entity_type) params['entity_type'] = query.entity_type;
    if (query.actor_user_id) params['actor_user_id'] = query.actor_user_id;
    if (query.q) params['q'] = query.q;
    if (query.page) params['page'] = query.page;
    if (query.page_size) params['page_size'] = query.page_size;

    return this.api.getRaw('api/v1/admin/event-logs', params).pipe(
      map((res: any) => {
        const data = res?.data ?? res ?? {};
        return {
          items: (data.items ?? []) as EventLogItem[],
          pagination: data.pagination ?? { page: 1, page_size: 50, total: 0, total_pages: 0 },
          filters: data.filters ?? { from: '', to: '', retention_days: 30 },
        };
      })
    );
  }

  getActions(): Observable<string[]> {
    return this.api.getRaw('api/v1/admin/event-logs/actions').pipe(
      map((res: any) => {
        const data = res?.data ?? res ?? {};
        return (data.actions ?? []) as string[];
      })
    );
  }
}
