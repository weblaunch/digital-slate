import { Component, OnInit, inject } from '@angular/core';
import { AlertController } from '@ionic/angular';

import { Project, SlateDatabaseService } from '../services/slate-database.service';

@Component({
  selector: 'app-projects',
  templateUrl: './projects.page.html',
  styleUrls: ['./projects.page.scss'],
  standalone: false,
})
export class ProjectsPage implements OnInit {
  public projects: Project[] = [];
  public loading = true;

  private alert_controller = inject(AlertController);
  private database = inject(SlateDatabaseService);

  async ngOnInit(): Promise<void> {
    await this.load_projects();
  }

  async ionViewWillEnter(): Promise<void> {
    await this.load_projects();
  }

  async add_project(): Promise<void> {
    await this.open_project_form();
  }

  async edit_project(event: Event, project: Project): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    await this.open_project_form(project);
  }

  async delete_project(event: Event, project: Project): Promise<void> {
    event.preventDefault();
    event.stopPropagation();

    const alert = await this.alert_controller.create({
      header: 'Delete project?',
      message: `This permanently removes "${project.name}" and all shoot days, slates, scenes, takes, flags on takes, rolls, and export data beneath it.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            await this.database.delete_project(project.project_id);
            await this.load_projects();
          },
        },
      ],
    });

    await alert.present();
  }

  private async open_project_form(project?: Project): Promise<void> {
    const is_editing = Boolean(project);
    const alert = await this.alert_controller.create({
      header: is_editing ? 'Edit Project' : 'New Project',
      inputs: [
        { name: 'name', type: 'text', placeholder: 'Project name', value: project?.name ?? '' },
        { name: 'director', type: 'text', placeholder: 'Director', value: project?.director ?? '' },
        { name: 'dop', type: 'text', placeholder: 'DOP', value: project?.dop ?? '' },
        { name: 'camera_op', type: 'text', placeholder: 'Camera op', value: project?.camera_op ?? '' },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: is_editing ? 'Update' : 'Add',
          handler: async (values: Record<string, string>) => {
            if (!values['name']?.trim()) {
              return false;
            }

            if (project) {
              await this.database.update_project({
                project_id: project.project_id,
                name: values['name'],
                director: values['director'],
                dop: values['dop'],
                camera_op: values['camera_op'],
              });
            } else {
              await this.database.create_project({
                name: values['name'],
                director: values['director'],
                dop: values['dop'],
                camera_op: values['camera_op'],
              });
            }

            await this.load_projects();
            return true;
          },
        },
      ],
    });

    await alert.present();
  }

  private async load_projects(): Promise<void> {
    this.loading = true;
    this.projects = await this.database.list_projects();
    this.loading = false;
  }
}
