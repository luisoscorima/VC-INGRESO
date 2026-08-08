import { Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { ApiResponse, ApiService } from '../api.service';

export interface AccessCamera {
  camera_id: number;
  name: string;
  access_point_id: number;
  access_point_name: string;
  api_key_prefix: string;
  debounce_seconds: number;
  is_active: number | boolean;
  last_seen_at?: string | null;
}

export interface CameraAccessEvent {
  event_id: number;
  camera_id: number;
  camera_name: string;
  access_point_id: number;
  access_point_name: string;
  license_plate_raw: string;
  license_plate_norm: string;
  confidence?: number | null;
  match_type: 'REGISTRY' | 'EXTERNAL' | 'NONE' | 'DENIED';
  result: 'ALLOWED' | 'DENIED' | 'IGNORED_DUPLICATE';
  photo_url?: string | null;
  captured_at: string;
  created_at: string;
  brand?: string | null;
  model?: string | null;
  temp_visit_name?: string | null;
}

export interface CameraSecret {
  camera_id: number;
  api_key: string;
  api_key_prefix: string;
}

export interface EventsPage {
  data: CameraAccessEvent[];
  pagination: { page: number; limit: number; total: number; total_pages: number };
}

@Injectable({ providedIn: 'root' })
export class CameraAccessService {
  constructor(private api: ApiService) {}

  getCameras(): Observable<AccessCamera[]> {
    return this.api.get<AccessCamera[]>('api/v1/access-cameras').pipe(
      map((res) => res.data ?? [])
    );
  }

  createCamera(body: Record<string, unknown>): Observable<ApiResponse<CameraSecret>> {
    return this.api.post('api/v1/access-cameras', body) as Observable<ApiResponse<CameraSecret>>;
  }

  updateCamera(id: number, body: Record<string, unknown>): Observable<ApiResponse<unknown>> {
    return this.api.put(`api/v1/access-cameras/${id}`, body);
  }

  rotateKey(id: number): Observable<ApiResponse<CameraSecret>> {
    return this.api.post(`api/v1/access-cameras/${id}/rotate-key`, {}) as Observable<ApiResponse<CameraSecret>>;
  }

  getEvents(params: Record<string, string | number | boolean>): Observable<EventsPage> {
    return this.api.getRaw('api/v1/camera-access/events', params).pipe(
      map((res) => ({
        data: res?.data ?? [],
        pagination: res?.pagination ?? { page: 1, limit: 50, total: 0, total_pages: 0 },
      }))
    );
  }
}
