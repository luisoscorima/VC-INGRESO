import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../api.service';

export interface LprCamera {
  camera_id: number;
  name: string;
  access_point_id: number;
  access_point_name?: string;
  direction: 'INGRESO' | 'EGRESO';
  stream_url?: string | null;
  snapshot_url?: string | null;
  is_enabled: number | boolean;
  min_confidence: number;
  debounce_seconds: number;
  poll_interval_ms: number;
  last_seen_at?: string | null;
}

export interface LprEvent {
  event_id: number;
  camera_id: number;
  camera_name?: string;
  access_point_id: number;
  access_point_name?: string;
  license_plate: string;
  confidence?: number | null;
  direction: 'INGRESO' | 'EGRESO';
  result: string;
  status_validated?: string | null;
  message?: string | null;
  snapshot_url?: string | null;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class LprService {
  constructor(private api: ApiService) {}

  listCameras(): Observable<any> {
    return this.api.get('api/v1/lpr/cameras');
  }

  createCamera(body: Partial<LprCamera>): Observable<any> {
    return this.api.post('api/v1/lpr/cameras', body);
  }

  updateCamera(id: number, body: Partial<LprCamera>): Observable<any> {
    return this.api.put(`api/v1/lpr/cameras/${id}`, body);
  }

  listEvents(limit = 50, result?: string): Observable<any> {
    let path = `api/v1/lpr/events?limit=${limit}`;
    if (result) {
      path += `&result=${encodeURIComponent(result)}`;
    }
    return this.api.get(path);
  }
}
