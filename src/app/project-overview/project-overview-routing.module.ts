import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { ProjectOverviewPage } from './project-overview.page';

const routes: Routes = [
  {
    path: '',
    component: ProjectOverviewPage,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ProjectOverviewPageRoutingModule {}
