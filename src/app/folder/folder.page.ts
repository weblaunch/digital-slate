import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { ActivatedRoute } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { Subscription } from 'rxjs';

import {
  ExportTake,
  Flag,
  Project,
  SearchFilterType,
  SearchResult,
  ShootDay,
  SlateConnectionTarget,
  SlateDatabaseService,
} from '../services/slate-database.service';
import {
  SlateBleLogEntry,
  SlateBleService,
  SlateBleStatus,
  slate_ble_event_characteristic_uuid,
  slate_ble_service_uuid,
} from '../services/slate-ble.service';

@Component({
  selector: 'app-folder',
  templateUrl: './folder.page.html',
  styleUrls: ['./folder.page.scss'],
  standalone: false,
})
export class FolderPage implements OnInit, OnDestroy {
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
  public export_sharing = false;
  public ble_status: SlateBleStatus = {
    state: 'idle',
    device_id: null,
    device_name: null,
    connected_devices: [],
    last_error: null,
  };
  public ble_log: SlateBleLogEntry[] = [];
  public ble_service_uuid = slate_ble_service_uuid;
  public ble_event_characteristic_uuid = slate_ble_event_characteristic_uuid;
  public slate_connection_targets: SlateConnectionTarget[] = [];
  public slate_connection_targets_loading = false;
  public new_managed_slate_name = '';

  private activatedRoute = inject(ActivatedRoute);
  private alert_controller = inject(AlertController);
  private database = inject(SlateDatabaseService);
  private slate_ble = inject(SlateBleService);
  private ble_subscriptions: Subscription[] = [];

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
    } else if (this.folder === 'slate-connection') {
      this.ble_status = this.slate_ble.status;
      this.ble_subscriptions = [
        this.slate_ble.status$.subscribe((status) => {
          this.ble_status = status;
        }),
        this.slate_ble.log$.subscribe((log) => {
          this.ble_log = log;
        }),
      ];
      await this.load_slate_connection_targets();
      void this.reconnect_known_slates();
    }
  }

  ngOnDestroy(): void {
    this.ble_subscriptions.forEach((subscription) => subscription.unsubscribe());
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

  async share_export_csv(): Promise<void> {
    await this.share_text_file(this.export_file_name('csv'), this.build_export_csv(), 'text/csv');
  }

  async share_export_json(): Promise<void> {
    await this.share_text_file(this.export_file_name('json'), this.build_export_json(), 'application/json');
  }

  private build_export_csv(): string {
    const rows = this.export_takes.map((take) => this.export_take_row(take));
    const headers = [
      'project',
      'shoot_date',
      'location',
      'camera',
      'scene',
      'setup',
      'take',
      'reel',
      'card',
      'source_clip',
      'suggested_clip_name',
      'slate_open_tc',
      'slate_close_tc',
      'trim_in_tc',
      'open_marker',
      'close_marker',
      'flags',
      'notes',
    ];
    const csv = [
      headers.join(','),
      ...rows.map((row) => headers.map((header) => csv_cell(row[header] ?? '')).join(',')),
    ].join('\n');

    return csv;
  }

  private build_export_json(): string {
    const project = this.export_projects.find((candidate) => candidate.project_id === this.export_project_id);
    const shoot_day = this.export_shoot_days.find((candidate) => candidate.shoot_day_id === this.export_shoot_day_id);
    const payload = {
      exported_at: new Date().toISOString(),
      format: 'digital-slate-resolve-prep-v1',
      project: project ? {
        project_id: project.project_id,
        name: project.name,
        director: project.director ?? '',
        dop: project.dop ?? '',
        camera_op: project.camera_op ?? '',
      } : null,
      shoot_day: shoot_day ? {
        shoot_day_id: shoot_day.shoot_day_id,
        date: format_display_date(shoot_day.date),
        location: shoot_day.location ?? '',
      } : null,
      take_count: this.export_takes.length,
      takes: this.export_takes.map((take) => {
        const { project: _project, ...row } = this.export_take_row(take);
        return row;
      }),
    };

    return JSON.stringify(payload, null, 2);
  }

  export_count_label(): string {
    const count = this.export_takes.length;
    return `${count} ${count === 1 ? 'take' : 'takes'} ready`;
  }

  export_day_label(day: ShootDay): string {
    return day.location ? `${format_display_date(day.date)} · ${day.location}` : format_display_date(day.date);
  }

  async connect_slate(): Promise<void> {
    try {
      await this.slate_ble.request_and_connect();
    } catch {
      // The service status/log streams carry the user-facing error.
    }
  }

  async disconnect_slate(): Promise<void> {
    await this.slate_ble.disconnect();
  }

  clear_ble_log(): void {
    this.slate_ble.clear_log();
  }

  async load_slate_connection_targets(): Promise<void> {
    this.slate_connection_targets_loading = true;
    this.slate_connection_targets = await this.database.list_slate_connection_targets();
    this.slate_connection_targets_loading = false;
  }

  async reconnect_known_slates(): Promise<void> {
    const device_ids = this.slate_connection_targets
      .map((target) => target.bluetooth_device_id)
      .filter((device_id): device_id is string => Boolean(device_id));
    await this.slate_ble.reconnect_known_devices(device_ids);
  }

  async add_managed_slate(): Promise<void> {
    if (!this.new_managed_slate_name.trim()) {
      return;
    }

    await this.database.create_managed_slate({
      camera: this.new_managed_slate_name,
    });
    this.new_managed_slate_name = '';
    await this.load_slate_connection_targets();
  }

  async bind_connected_device_to_slate(camera: string): Promise<void> {
    if (!this.ble_status.device_id) {
      return;
    }

    await this.database.update_slate_device_binding_by_camera({
      camera,
      bluetooth_device_id: this.ble_status.device_id,
      bluetooth_device_name: this.ble_status.device_name,
    });
    await this.load_slate_connection_targets();
  }

  async unbind_device_from_slate(camera: string): Promise<void> {
    await this.database.update_slate_device_binding_by_camera({
      camera,
      bluetooth_device_id: null,
      bluetooth_device_name: null,
    });
    await this.load_slate_connection_targets();
  }

  slate_target_device_label(target: SlateConnectionTarget): string {
    return target.bluetooth_device_name || target.bluetooth_device_id || 'No device bound';
  }

  slate_target_connected(target: SlateConnectionTarget): boolean {
    return this.ble_device_connected(target.bluetooth_device_id);
  }

  display_date(date: string | null | undefined): string {
    return date ? format_display_date(date) : '';
  }

  export_take_timecode(take: ExportTake): string {
    return take.slate_open_timecode || take.slate_close_timecode || 'No timecode';
  }

  export_suggested_clip_name(take: ExportTake): string {
    const scene_name = take.scene_name.trim();
    const suggested_scene_name = scene_name.toLowerCase().startsWith('sc') ? scene_name : `Sc${scene_name}`;
    const setup_suffix = take.setup_suffix ?? '';
    return `${suggested_scene_name}${setup_suffix} T${String(take.take_number).padStart(2, '0')}`;
  }

  ble_connected(): boolean {
    return this.ble_status.connected_devices.length > 0;
  }

  ble_busy(): boolean {
    return ['initializing', 'scanning', 'connecting', 'disconnecting'].includes(this.ble_status.state);
  }

  ble_state_label(): string {
    if (this.ble_status.connected_devices.length > 1) {
      return `${this.ble_status.connected_devices.length} slates connected`;
    }

    const labels: Record<string, string> = {
      idle: 'Not connected',
      initializing: 'Initializing',
      scanning: 'Scanning',
      connecting: 'Connecting',
      connected: 'Connected',
      disconnecting: 'Disconnecting',
      error: 'Connection error',
    };

    return labels[this.ble_status.state] ?? this.ble_status.state;
  }

  ble_device_connected(device_id: string | null | undefined): boolean {
    if (!device_id) {
      return false;
    }

    return this.ble_status.connected_devices.some((device) => device.device_id === device_id);
  }

  private export_take_row(take: ExportTake): Record<string, string> {
    const setup_suffix = take.setup_suffix ?? '';
    const suggested_clip_name = this.export_suggested_clip_name(take);
    const is_end_slate = (take.flag_ids ?? '').split(',').includes('end_slate');
    return {
      project: take.project_name,
      shoot_date: format_display_date(take.shoot_date),
      location: take.location ?? '',
      camera: take.camera,
      scene: take.scene_name,
      setup: setup_suffix,
      take: String(take.take_number),
      reel: take.roll_name ?? '',
      card: take.card_label ?? '',
      source_clip: take.clip_name ?? '',
      suggested_clip_name,
      slate_open_tc: take.slate_open_timecode ?? '',
      slate_close_tc: take.slate_close_timecode ?? '',
      trim_in_tc: is_end_slate ? '' : take.slate_close_timecode ?? '',
      open_marker: take.slate_open_timecode ? 'Slate Open' : '',
      close_marker: take.slate_close_timecode ? (is_end_slate ? 'End Slate' : 'Slate Close / Trim In') : '',
      flags: normalize_export_flags(take.flags),
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

  private async share_text_file(file_name: string, content: string, mime_type: string): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      this.download_text_file(file_name, content, `${mime_type};charset=utf-8`);
      return;
    }

    this.export_sharing = true;
    try {
      await Filesystem.writeFile({
        path: file_name,
        data: content,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      });
      const file = await Filesystem.getUri({
        path: file_name,
        directory: Directory.Cache,
      });

      await Share.share({
        title: file_name,
        text: 'Digital Slate export',
        url: file.uri,
        dialogTitle: `Share ${file_name}`,
      });
    } catch (error) {
      await this.show_export_error(error);
    } finally {
      this.export_sharing = false;
    }
  }

  private async show_export_error(error: unknown): Promise<void> {
    const alert = await this.alert_controller.create({
      header: 'Export failed',
      message: error instanceof Error ? error.message : String(error),
      buttons: ['OK'],
    });
    await alert.present();
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

const normalize_export_flags = (flags: string | null | undefined): string => {
  return (flags ?? '')
    .split(',')
    .map((flag) => flag.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''))
    .filter(Boolean)
    .join(',');
};

const slug_part = (value: string): string => {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export';
};
