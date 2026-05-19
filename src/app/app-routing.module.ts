import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  {
    path: '',
    redirectTo: 'projects',
    pathMatch: 'full'
  },
  {
    path: 'projects',
    loadChildren: () => import('./projects/projects.module').then(m => m.ProjectsPageModule)
  },
  {
    path: 'projects/:project_id/overview',
    loadChildren: () => import('./project-overview/project-overview.module').then(m => m.ProjectOverviewPageModule)
  },
  {
    path: 'projects/:project_id/shoot-days',
    loadChildren: () => import('./hierarchy/hierarchy.module').then(m => m.HierarchyPageModule),
    data: { level: 'shoot_days' }
  },
  {
    path: 'projects/:project_id/shoot-days/:shoot_day_id/scenes',
    loadChildren: () => import('./hierarchy/hierarchy.module').then(m => m.HierarchyPageModule),
    data: { level: 'slate_scenes' }
  },
  {
    path: 'projects/:project_id/shoot-days/:shoot_day_id/scenes/:scene_id/takes',
    loadChildren: () => import('./hierarchy/hierarchy.module').then(m => m.HierarchyPageModule),
    data: { level: 'takes' }
  },
  {
    path: 'projects/:project_id/shoot-days/:shoot_day_id/slates',
    loadChildren: () => import('./hierarchy/hierarchy.module').then(m => m.HierarchyPageModule),
    data: { level: 'slates' }
  },
  {
    path: 'projects/:project_id/shoot-days/:shoot_day_id/slates/:slate_id/scenes',
    loadChildren: () => import('./hierarchy/hierarchy.module').then(m => m.HierarchyPageModule),
    data: { level: 'slate_scenes' }
  },
  {
    path: 'projects/:project_id/shoot-days/:shoot_day_id/slates/:slate_id/scenes/:slate_scene_id/takes',
    loadChildren: () => import('./hierarchy/hierarchy.module').then(m => m.HierarchyPageModule),
    data: { level: 'takes' }
  },
  {
    path: 'folder/:id',
    loadChildren: () => import('./folder/folder.module').then( m => m.FolderPageModule)
  }
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })
  ],
  exports: [RouterModule]
})
export class AppRoutingModule {}
