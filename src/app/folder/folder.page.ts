import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import {
  ExportTake,
  Flag,
  Project,
  SearchFilterType,
  SearchResult,
  ShootDay,
  SlateDatabaseService,
} from '../services/slate-database.service';

@Component({
  selector: 'app-folder',
  templateUrl: './folder.page.html',
  styleUrls: ['./folder.page.scss'],
  standalone: false,
})
export class FolderPage implements OnInit {
  public folder!: string;
  public page_title!: string;
  public page_summary!: string;
  public search_query = '';
  public search_type: SearchFilterType = 'all';
  public search_flag_id = '';
  public search_results: SearchResult[] = [];
  public search_loading = false;
  public search_has_run = false;
  public flags: Flag[] = [];
  public export_projects: Project[] = [];
  public export_shoot_days: ShootDay[] = [];
  public export_project_id = '';
  public export_shoot_day_id = '';
  public export_takes: ExportTake[] = [];
  public export_loading = false;

  private activatedRoute = inject(ActivatedRoute);
  private database = inject(SlateDatabaseService);

  async ngOnInit(): Promise<void> {
    this.folder = this.activatedRoute.snapshot.paramMap.get('id') as string;
    const page = section_pages[this.folder] ?? section_pages['projects'];
    this.page_title = page.title;
    this.page_summary = page.summary;

    if (this.folder === 'search') {
      this.flags = await this.database.list_flags();
    } else if (this.folder === 'export') {
      this.export_projects = await this.database.list_projects();
      this.export_project_id = this.export_projects[0]?.project_id ?? '';
      await this.load_export_scope();
    }
  }

  async run_search(): Promise<void> {
    if (this.folder !== 'search') {
      return;
    }

    const has_search = Boolean(this.search_query.trim() || this.search_flag_id);
    this.search_has_run = has_search;
    if (!has_search) {
      this.search_results = [];
      return;
    }

    this.search_loading = true;
    this.search_results = await this.database.search({
      query: this.search_query,
      result_type: this.search_type,
      flag_id: this.search_flag_id,
    });
    this.search_loading = false;
  }

  async clear_search(): Promise<void> {
    this.search_query = '';
    this.search_flag_id = '';
    this.search_results = [];
    this.search_has_run = false;
  }

  result_type_label(result: SearchResult): string {
    const labels: Record<string, string> = {
      project: 'Project',
      shoot_day: 'Day',
      slate: 'Slate',
      scene: 'Scene',
      take: 'Take',
    };

    return labels[result.result_type] ?? result.result_type;
  }

  result_title(result: SearchResult): string {
    if (result.result_type === 'shoot_day') {
      return format_display_date(result.title);
    }

    return result.title;
  }

  result_subtitle(result: SearchResult): string {
    return format_context_dates(result.subtitle ?? '');
  }

  result_context(result: SearchResult): string {
    return format_context_dates(result.context ?? '');
  }

  result_match(result: SearchResult): string {
    return format_context_dates(result.matched_text ?? '');
  }

  result_link(result: SearchResult): unknown[] {
    if (result.result_type === 'project' && result.project_id) {
      return ['/projects', result.project_id, 'shoot-days'];
    }

    if (result.result_type === 'shoot_day' && result.project_id && result.shoot_day_id) {
      return ['/projects', result.project_id, 'shoot-days', result.shoot_day_id, 'slates'];
    }

    if (result.result_type === 'slate' && result.project_id && result.shoot_day_id && result.slate_id) {
      return ['/projects', result.project_id, 'shoot-days', result.shoot_day_id, 'slates', result.slate_id, 'scenes'];
    }

    if (result.project_id && result.shoot_day_id && result.slate_id && result.slate_scene_id) {
      return [
        '/projects',
        result.project_id,
        'shoot-days',
        result.shoot_day_id,
        'slates',
        result.slate_id,
        'scenes',
        result.slate_scene_id,
        'takes',
      ];
    }

    return ['/projects'];
  }

  async load_export_scope(): Promise<void> {
    if (!this.export_project_id) {
      this.export_shoot_days = [];
      this.export_shoot_day_id = '';
      this.export_takes = [];
      return;
    }

    this.export_loading = true;
    this.export_shoot_days = await this.database.list_shoot_days(this.export_project_id);
    if (this.export_shoot_day_id && !this.export_shoot_days.some((day) => day.shoot_day_id === this.export_shoot_day_id)) {
      this.export_shoot_day_id = '';
    }
    this.export_takes = await this.database.list_export_takes({
      project_id: this.export_project_id,
      shoot_day_id: this.export_shoot_day_id,
    });
    this.export_loading = false;
  }

  async set_export_project(project_id: string): Promise<void> {
    this.export_project_id = project_id;
    this.export_shoot_day_id = '';
    await this.load_export_scope();
  }

  async set_export_shoot_day(shoot_day_id: string): Promise<void> {
    this.export_shoot_day_id = shoot_day_id;
    await this.load_export_scope();
  }

  download_export_csv(): void {
    const rows = this.export_takes.map((take) => this.export_take_row(take));
    const headers = [
      'project',
      'shoot_date',
      'location',
      'camera',
      'scene',
      'take',
      'reel',
      'card',
      'source_clip',
      'suggested_clip_name',
      'slate_open_tc',
      'slate_close_tc',
      'trim_out_tc',
      'open_marker',
      'close_marker',
      'flags',
      'notes',
    ];
    const csv = [
      headers.join(','),
      ...rows.map((row) => headers.map((header) => csv_cell(row[header] ?? '')).join(',')),
    ].join('\n');

    this.download_text_file(this.export_file_name('csv'), csv, 'text/csv;charset=utf-8');
  }

  download_export_json(): void {
    const payload = {
      exported_at: new Date().toISOString(),
      format: 'digital-slate-resolve-prep-v1',
      take_count: this.export_takes.length,
      takes: this.export_takes.map((take) => this.export_take_row(take)),
    };

    this.download_text_file(
      this.export_file_name('json'),
      JSON.stringify(payload, null, 2),
      'application/json;charset=utf-8',
    );
  }

  export_count_label(): string {
    const count = this.export_takes.length;
    return `${count} ${count === 1 ? 'take' : 'takes'} ready`;
  }

  export_day_label(day: ShootDay): string {
    return day.location ? `${format_display_date(day.date)} · ${day.location}` : format_display_date(day.date);
  }

  private export_take_row(take: ExportTake): Record<string, string> {
    const suggested_clip_name = `Sc${take.scene_name} T${String(take.take_number).padStart(2, '0')}`;
    const is_end_slate = (take.flag_ids ?? '').split(',').includes('end_slate');
    return {
      project: take.project_name,
      shoot_date: format_display_date(take.shoot_date),
      location: take.location ?? '',
      camera: take.camera,
      scene: take.scene_name,
      take: String(take.take_number),
      reel: take.roll_name ?? '',
      card: take.card_label ?? '',
      source_clip: take.clip_name ?? '',
      suggested_clip_name,
      slate_open_tc: take.slate_open_timecode ?? '',
      slate_close_tc: take.slate_close_timecode ?? '',
      trim_out_tc: is_end_slate ? '' : take.slate_close_timecode ?? '',
      open_marker: take.slate_open_timecode ? 'Slate Open' : '',
      close_marker: take.slate_close_timecode ? (is_end_slate ? 'End Slate' : 'Slate Close / Trim Out') : '',
      flags: take.flags ?? '',
      notes: take.notes ?? '',
    };
  }

  private export_file_name(extension: 'csv' | 'json'): string {
    const project = this.export_projects.find((candidate) => candidate.project_id === this.export_project_id);
    const day = this.export_shoot_days.find((candidate) => candidate.shoot_day_id === this.export_shoot_day_id);
    const parts = [
      project?.name ?? 'digital-slate',
      day ? format_display_date(day.date) : 'all-days',
      'resolve-export',
    ];

    return `${parts.map(slug_part).join('-')}.${extension}`;
  }

  private download_text_file(file_name: string, content: string, type: string): void {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = file_name;
    link.click();
    URL.revokeObjectURL(url);
  }
}

const section_pages: Record<string, { title: string; summary: string }> = {
  projects: {
    title: 'Projects',
    summary: 'Create and manage productions, shoot days, slates, shared scenes, and takes.',
  },
  search: {
    title: 'Search',
    summary: 'Find scenes, takes, notes, flags, and timecode metadata across the current project.',
  },
  export: {
    title: 'Export',
    summary: 'Prepare CSV and JSON exports for editorial workflows and future Resolve helpers.',
  },
  'slate-connection': {
    title: 'Slate Connection',
    summary: 'Connect to physical slates over Bluetooth, or use fake slate events during app development.',
  },
  settings: {
    title: 'Settings',
    summary: 'Configure app preferences, connection defaults, export options, and slate behaviour.',
  },
};

const format_display_date = (date: string): string => {
  const iso_match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  return iso_match ? `${iso_match[3]}-${iso_match[2]}-${iso_match[1]}` : date;
};

const format_context_dates = (value: string): string => {
  return value.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_match, year, month, day) => `${day}-${month}-${year}`);
};

const csv_cell = (value: string): string => `"${value.replace(/"/g, '""')}"`;

const slug_part = (value: string): string => {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export';
};
