import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { HierarchyPage } from './hierarchy.page';

const routes: Routes = [
  {
    path: '',
    component: HierarchyPage,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class HierarchyPageRoutingModule {}
