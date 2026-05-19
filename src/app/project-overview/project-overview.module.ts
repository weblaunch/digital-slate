import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular';

import { ProjectOverviewPageRoutingModule } from './project-overview-routing.module';
import { ProjectOverviewPage } from './project-overview.page';

@NgModule({
  imports: [
    CommonModule,
    IonicModule,
    RouterModule,
    ProjectOverviewPageRoutingModule,
  ],
  declarations: [ProjectOverviewPage],
})
export class ProjectOverviewPageModule {}
