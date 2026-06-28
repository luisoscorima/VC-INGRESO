import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs/operators';
import { environment } from 'src/environments/environment';
import { House } from './house';
import { Vehicle } from './vehicle';
import { ExternalVehicle } from './externalVehicle';

@Injectable({
  providedIn: 'root'
})
export class EntranceService {

  baseUrl = environment.baseUrl;

  constructor(private http: HttpClient) { }

  getPersonsByHouseId(house_id: number) {
    return this.http.get(`${this.baseUrl}/api/v1/houses/${house_id}/members`);
  }

  getVehiclesByHouseId(house_id: number) {
    return this.http.get(`${this.baseUrl}/api/v1/vehicles/by-house?house_id=${house_id}`);
  }

  getAllHouses() {
    return this.http.get(`${this.baseUrl}/api/v1/houses`);
  }

  addHouse(house: House) {
    return this.http.post(`${this.baseUrl}/api/v1/houses`, house);
  }

  updateHouse(house: House) {
    return this.http.put(`${this.baseUrl}/api/v1/houses/${(house as any).house_id}`, house);
  }

  getAllVehicles() {
    return this.http.get(`${this.baseUrl}/api/v1/vehicles`);
  }

  addVehicle(vehicle: Vehicle) {
    return this.http.post(`${this.baseUrl}/api/v1/vehicles`, vehicle);
  }

  updateVehicle(vehicle: Vehicle) {
    return this.http.put(`${this.baseUrl}/api/v1/vehicles/${(vehicle as any).vehicle_id}`, vehicle);
  }

  getAllExternalVehicles() {
    return this.http.get(`${this.baseUrl}/api/v1/external-visits`);
  }

  getActiveExternalVehiclesByHouse(houseId: number) {
    return this.http.get(
      `${this.baseUrl}/api/v1/external-visits?house_id=${houseId}&active=1`
    );
  }

  getMyExternalVehicles(houseId?: number) {
    if (houseId != null && houseId > 0) {
      return this.getActiveExternalVehiclesByHouse(houseId);
    }
    return this.http.get(`${this.baseUrl}/api/v1/external-visits?mine=1`);
  }

  lookupExternalVisit(params: { plate?: string; doc?: string }) {
    const q = new URLSearchParams();
    if (params.plate) {
      q.set('plate', params.plate);
    }
    if (params.doc) {
      q.set('doc', params.doc);
    }
    return this.http.get(`${this.baseUrl}/api/v1/external-visits/lookup?${q.toString()}`);
  }

  addExternalVehicle(externalVehicle: ExternalVehicle) {
    return this.http.post(`${this.baseUrl}/api/v1/external-visits`, externalVehicle);
  }

  updateExternalVehicle(externalVehicle: ExternalVehicle) {
    const id = (externalVehicle as any).id ?? (externalVehicle as any).temp_visit_id;
    return this.http.put(`${this.baseUrl}/api/v1/external-visits/${id}`, externalVehicle);
  }

  cancelExternalVisitAssignment(tempVisitId: number, assignmentId: number) {
    return this.http.delete(
      `${this.baseUrl}/api/v1/external-visits/${tempVisitId}?assignment_id=${assignmentId}`
    );
  }

  getAllAreas() {
    return this.http.get(`${this.baseUrl}/api/v1/catalog/areas`);
  }

  addAccessPoint(body: Record<string, unknown>) {
    return this.http.post(`${this.baseUrl}/api/v1/catalog/access-points`, body);
  }

  updateAccessPoint(id: number, body: Record<string, unknown>) {
    return this.http.put(`${this.baseUrl}/api/v1/catalog/access-points/${id}`, body);
  }

  getAreaById(area_id: number) {
    return this.http.get(`${this.baseUrl}/api/v1/catalog/areas`).pipe(
      map((arr: any) => Array.isArray(arr) ? arr.find((a: any) => a.id === area_id) : null)
    );
  }

  getAllAccessPoints() {
    return this.http.get(`${this.baseUrl}/api/v1/access-logs/access-points`).pipe(
      map((r: any) => r?.data ?? r ?? [])
    );
  }
}
