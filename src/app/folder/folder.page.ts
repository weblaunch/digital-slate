import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import {
  Flag,
  SearchFilterType,
  SearchResult,
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

  private activatedRoute = inject(ActivatedRoute);
  private database = inject(SlateDatabaseService);

  async ngOnInit(): Promise<void> {
    this.folder = this.activatedRoute.snapshot.paramMap.get('id') as string;
    const page = section_pages[this.folder] ?? section_pages['projects'];
    this.page_title = page.title;
    this.page_summary = page.summary;

    if (this.folder === 'search') {
      this.flags = await this.database.list_flags();
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
