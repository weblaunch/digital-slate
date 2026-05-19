import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import {
  Project,
  ProjectOverviewScene,
  ProjectOverviewShootDay,
  ProjectOverviewSlate,
  SlateDatabaseService,
} from '../services/slate-database.service';

interface OverviewScene extends ProjectOverviewScene {
  slates: ProjectOverviewSlate[];
}

interface OverviewShootDay extends ProjectOverviewShootDay {
  scenes: OverviewScene[];
}

@Component({
  selector: 'app-project-overview',
  templateUrl: './project-overview.page.html',
  styleUrls: ['./project-overview.page.scss'],
  standalone: false,
})
export class ProjectOverviewPage implements OnInit {
  public project: Project | null = null;
  public shoot_days: OverviewShootDay[] = [];
  public loading = true;

  private route = inject(ActivatedRoute);
  private database = inject(SlateDatabaseService);

  async ngOnInit(): Promise<void> {
    await this.load_overview();
  }

  async ionViewWillEnter(): Promise<void> {
    await this.load_overview();
  }

  scene_link(shoot_day: OverviewShootDay, scene: OverviewScene): unknown[] {
    return ['/projects', shoot_day.project_id, 'shoot-days', shoot_day.shoot_day_id, 'scenes', scene.scene_id, 'takes'];
  }

  shoot_day_link(shoot_day: OverviewShootDay): unknown[] {
    return ['/projects', shoot_day.project_id, 'shoot-days', shoot_day.shoot_day_id, 'scenes'];
  }

  slate_link(shoot_day: OverviewShootDay, slate: ProjectOverviewSlate): unknown[] {
    return [
      '/projects',
      shoot_day.project_id,
      'shoot-days',
      shoot_day.shoot_day_id,
      'slates',
      slate.slate_id,
      'scenes',
      slate.slate_scene_id,
      'takes',
    ];
  }

  count_label(count: number | null | undefined, singular: string, plural: string): string {
    const value = count ?? 0;
    return `${value} ${value === 1 ? singular : plural}`;
  }

  scene_context(scene: OverviewScene): string {
    return [scene.location, scene.time_of_day].filter(Boolean).join(' · ');
  }

  display_date(date: string): string {
    const [year, month, day] = date.split('-');
    if (!year || !month || !day) {
      return date;
    }
    return `${day}-${month}-${year}`;
  }

  private async load_overview(): Promise<void> {
    this.loading = true;
    const project_id = this.route.snapshot.paramMap.get('project_id');
    if (!project_id) {
      this.project = null;
      this.shoot_days = [];
      this.loading = false;
      return;
    }

    const [project, shoot_days, scenes, slates] = await Promise.all([
      this.database.get_project(project_id),
      this.database.list_project_overview_shoot_days(project_id),
      this.database.list_project_overview_scenes(project_id),
      this.database.list_project_overview_slates(project_id),
    ]);

    const slates_by_scene = new Map<string, ProjectOverviewSlate[]>();
    slates.forEach((slate) => {
      const scene_slates = slates_by_scene.get(slate.scene_id) ?? [];
      scene_slates.push(slate);
      slates_by_scene.set(slate.scene_id, scene_slates);
    });

    const scenes_by_day = new Map<string, OverviewScene[]>();
    scenes.forEach((scene) => {
      const day_scenes = scenes_by_day.get(scene.shoot_day_id) ?? [];
      day_scenes.push({
        ...scene,
        slates: slates_by_scene.get(scene.scene_id) ?? [],
      });
      scenes_by_day.set(scene.shoot_day_id, day_scenes);
    });

    this.project = project
      ? { ...project, shoot_day_count: shoot_days.length, scene_count: scenes.length }
      : null;
    this.shoot_days = shoot_days.map((shoot_day) => ({
      ...shoot_day,
      scenes: scenes_by_day.get(shoot_day.shoot_day_id) ?? [],
    }));
    this.loading = false;
  }
}
