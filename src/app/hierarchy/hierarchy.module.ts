import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

import { HierarchyPageRoutingModule } from './hierarchy-routing.module';
import { HierarchyPage } from './hierarchy.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    HierarchyPageRoutingModule,
  ],
  declarations: [HierarchyPage],
})
export class HierarchyPageModule {}
