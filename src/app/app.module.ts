
import { BrowserModule } from '@angular/platform-browser';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
//import { DialogConfirm } from './lista-activos/lista-activos.component';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatInputModule } from '@angular/material/input';
import { DashboardComponent } from './dashboard/dashboard.component';
import { MatTableModule } from '@angular/material/table';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { DialogHistoryDetail, HistoryComponent } from './history/history.component';
import { MatDialogModule } from '@angular/material/dialog';
import {MatSnackBarModule} from '@angular/material/snack-bar';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatRadioModule } from '@angular/material/radio';
import { MatNativeDateModule, MAT_DATE_LOCALE } from '@angular/material/core';
import {MatSelectModule} from '@angular/material/select';
import {ReactiveFormsModule} from '@angular/forms';
import {MatPaginatorModule} from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
//import { DialogRevisar } from './lista-activos/lista-activos.component';
import { DialogRevalidar} from './dashboard/dashboard.component';
import {MatCardModule} from '@angular/material/card';

import { ToastrModule } from 'ngx-toastr';

import { HashLocationStrategy, LocationStrategy } from '@angular/common';
import { DialogDatos, BirthdayComponent } from './birthday/birthday.component';

import {MatGridListModule} from '@angular/material/grid-list';
import { GoogleChartsModule } from 'angular-google-charts';

import {MatTabsModule} from '@angular/material/tabs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';

import { LoginComponent } from './login/login.component';
import { NavBarComponent } from './nav-bar/nav-bar.component';
import { SideNavComponent } from './side-nav/side-nav.component';
import { SettingsComponent } from './settings/settings.component';
import { UsersComponent } from './users/users.component';
import { HousesComponent } from './houses/houses.component';
import { VehiclesComponent } from './vehicles/vehicles.component';
import { MyHouseComponent } from './my-house/my-house.component';
import { ModalUppercaseDirective } from './my-house/modal-uppercase.directive';
import { PetsComponent } from './pets/pets.component';
import { WebcamComponent } from './webcam/webcam.component';
import { ReservationsComponent } from './reservations/reservations.component';
import { QrScannerComponent } from './qr/qr-scanner.component';
import { CodigoQrPageComponent } from './qr/codigo-qr-page.component';
import { PublicRegistrationComponent } from './public-registration/public-registration.component';
import { LandingComponent } from './landing/landing.component';
import { AccessPointsComponent } from './access-points/access-points.component';
import { TutorialComponent } from './readonly/tutorial.component';
import { DocumentsComponent } from './readonly/documents.component';
import { EmergencyContactsComponent } from './readonly/emergency-contacts.component';
import { AnnouncementsComponent } from './announcements/announcements.component';
import { SurveysComponent } from './surveys/surveys.component';
import { EventLogsComponent } from './event-logs/event-logs.component';

import { NgChartsModule } from 'ng2-charts';
import { Chart, registerables } from 'chart.js';
import { authInterceptor } from './auth.interceptor';
import { errorInterceptor } from './error.interceptor';

Chart.register(...registerables);


@NgModule({ declarations: [
        AppComponent,
        DashboardComponent,
        HistoryComponent,
        BirthdayComponent,
        DialogRevalidar,
        DialogDatos,
        DialogHistoryDetail,
        LoginComponent,
        LandingComponent,
        NavBarComponent,
        SideNavComponent,
        SettingsComponent,
        UsersComponent,
        HousesComponent,
        VehiclesComponent,
        MyHouseComponent,
        ModalUppercaseDirective,
        PetsComponent,
        WebcamComponent,
        PublicRegistrationComponent,
        AccessPointsComponent,
        TutorialComponent,
        DocumentsComponent,
        EmergencyContactsComponent,
        AnnouncementsComponent,
        SurveysComponent,
        EventLogsComponent,
    ],
    bootstrap: [AppComponent], imports: [BrowserModule,
        AppRoutingModule,
        FormsModule,
        BrowserAnimationsModule,
        MatSidenavModule,
        MatToolbarModule,
        MatListModule,
        MatIconModule,
        MatButtonModule,
        MatExpansionModule,
        MatFormFieldModule,
        MatInputModule,
        MatTableModule,
        MatDialogModule,
        MatSnackBarModule,
        MatCheckboxModule,
        MatRadioModule,
        MatDatepickerModule,
        MatNativeDateModule,
        MatSelectModule,
        ReactiveFormsModule,
        MatPaginatorModule,
        MatSortModule,
        MatCardModule,
        MatGridListModule,
        GoogleChartsModule,
        MatTabsModule,
        MatProgressSpinnerModule,
        MatTooltipModule,
        MatChipsModule,
        NgChartsModule,
        ToastrModule.forRoot(),
        ReservationsComponent,
        QrScannerComponent,
        CodigoQrPageComponent
    ],
    providers: [
        { provide: LocationStrategy, useClass: HashLocationStrategy },
        { provide: MAT_DATE_LOCALE, useValue: 'es-ES' },
        provideHttpClient(
            withInterceptors([authInterceptor, errorInterceptor])
        )] })
export class AppModule { }
