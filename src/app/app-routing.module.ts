
import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { DashboardComponent } from './dashboard/dashboard.component';
import { HistoryComponent } from './history/history.component';
import { BirthdayComponent } from './birthday/birthday.component';
import { LoginComponent } from './login/login.component';
import { SettingsComponent } from './settings/settings.component';
import { UsersComponent } from './users/users.component';
import { HousesComponent } from './houses/houses.component';
import { VehiclesComponent } from './vehicles/vehicles.component';
import { MyHouseComponent } from './my-house/my-house.component';
import { PetsComponent } from './pets/pets.component';
import { AccessPointsComponent } from './access-points/access-points.component';
import { ReservationsComponent } from './reservations/reservations.component';
import { PublicRegistrationComponent } from './public-registration/public-registration.component';
import { LandingComponent } from './landing/landing.component';
import { CodigoQrPageComponent } from './qr/codigo-qr-page.component';
import { AuthGuard } from './auth.guard';
import { MyHouseGuard } from './my-house.guard';
import { CodigoQrGuard } from './qr/codigo-qr.guard';
import { ReservationsGuard } from './reservations.guard';
import { ModuleGuard } from './module.guard';
import { TutorialComponent } from './readonly/tutorial.component';
import { DocumentsComponent } from './readonly/documents.component';
import { EmergencyContactsComponent } from './readonly/emergency-contacts.component';
import { AnnouncementsComponent } from './announcements/announcements.component';
import { SurveysComponent } from './surveys/surveys.component';
import { IncidentsComponent } from './incidents/incidents.component';

const routes: Routes = [
  { path: "login", component: LoginComponent },
  { path: "landing", component: LandingComponent },
  { path: "registro", component: PublicRegistrationComponent },
  { path: "", component: DashboardComponent, canActivate: [AuthGuard] },
  { path: "history", component: HistoryComponent, canActivate: [AuthGuard] },
  { path: "hb", component: BirthdayComponent, canActivate: [AuthGuard] },
  { path: "settings", component: SettingsComponent, canActivate: [AuthGuard] },
  { path: "users", component: UsersComponent, canActivate: [AuthGuard, ModuleGuard], data: { module: 'users' } },
  { path: "houses", component: HousesComponent, canActivate: [AuthGuard, ModuleGuard], data: { module: 'houses' } },
  { path: "vehicles", component: VehiclesComponent, canActivate: [AuthGuard, ModuleGuard], data: { module: 'vehicles' } },
  { path: "my-house", component: MyHouseComponent, canActivate: [AuthGuard, MyHouseGuard] },
  { path: "pets", component: PetsComponent, canActivate: [AuthGuard, ModuleGuard], data: { module: 'pets' } },
  { path: "access-points", component: AccessPointsComponent, canActivate: [AuthGuard, ModuleGuard], data: { module: 'access_points' } },
  { path: "reservations", component: ReservationsComponent, canActivate: [AuthGuard, ReservationsGuard] },
  { path: "calendar", redirectTo: "reservations", pathMatch: "full" },
  { path: "codigo-qr", component: CodigoQrPageComponent, canActivate: [AuthGuard, CodigoQrGuard] },
  { path: "scanner", redirectTo: "codigo-qr", pathMatch: "full" },
  { path: "tutorials", component: TutorialComponent, canActivate: [AuthGuard] },
  { path: "documents", component: DocumentsComponent, canActivate: [AuthGuard] },
  { path: "emergency-contacts", component: EmergencyContactsComponent, canActivate: [AuthGuard] },
  { path: "announcements", component: AnnouncementsComponent, canActivate: [AuthGuard, ModuleGuard], data: { module: 'announcements' } },
  { path: "surveys", component: SurveysComponent, canActivate: [AuthGuard, ModuleGuard], data: { module: 'surveys' } },
  { path: "incidents", component: IncidentsComponent, canActivate: [AuthGuard, ModuleGuard], data: { module: 'incidents' } },
  //{ path: "", redirectTo: "/clientes", pathMatch: "full" },// Cuando es la raíz
  //{ path: "**", redirectTo: "/clientes" }
];

@NgModule({
  imports: [RouterModule.forRoot(routes),
  ],
  exports: [RouterModule]
})
export class AppRoutingModule { }
