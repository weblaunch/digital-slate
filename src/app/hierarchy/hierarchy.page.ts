import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { Subscription } from 'rxjs';

import {
  Flag,
  Project,
  ReusableSlate,
  Roll,
  ShootDay,
  Slate,
  SlateDatabaseService,
  SlateScene,
  Take,
} from '../services/slate-database.service';
import { SlateBleService, SlateBleStatus } from '../services/slate-ble.service';
import { SlateEventService, SlateHardwareEvent } from '../services/slate-event.service';

type HierarchyLevel = 'shoot_days' | 'slates' | 'slate_scenes' | 'takes';
type HierarchyItem = ShootDay | Slate | SlateScene | Take;
interface BreadcrumbItem {
  label: string;
  link: unknown[] | null;
}
interface TakeFlagIcon {
  flag_id: string;
  label: string;
  symbol: string;
  color: string;
}

@Component({
  selector: 'app-hierarchy',
  templateUrl: './hierarchy.page.html',
  styleUrls: ['./hierarchy.page.scss'],
  standalone: false,
})
export class HierarchyPage implements OnInit, OnDestroy {
  public level: HierarchyLevel = 'shoot_days';
  public page_title = '';
  public parent_title = '';
  public add_label = '';
  public empty_title = '';
  public empty_summary = '';
  public breadcrumbs: BreadcrumbItem[] = [];
  public loading = true;
  public items: HierarchyItem[] = [];
  public slate_picker_open = false;
  public reusable_slates: ReusableSlate[] = [];
  public slate_picker_loading = false;
  public show_new_slate_form = false;
  public new_slate_camera = 'A Cam';
  public flags: Flag[] = [];
  public rolls: Roll[] = [];
  public take_page_roll_id = '';
  public take_form_open = false;
  public take_form_title = 'New Take';
  public take_form_take: Take | null = null;
  public take_form_roll_id = '';
  public take_form_clip_name = '';
  public take_form_take_number = 1;
  public take_form_open_timecode = '';
  public take_form_close_timecode = '';
  public take_form_notes = '';
  public take_form_flag_ids = new Set<string>();
  public show_add_flag_form = false;
  public new_flag_label = '';
  public new_flag_color = '#52525b';
  public show_add_roll_form = false;
  public new_roll_name = '';
  public new_roll_card_label = '';
  public ble_status: SlateBleStatus = {
    state: 'idle',
    device_id: null,
    device_name: null,
    last_error: null,
  };

  private project: Project | null = null;
  private shoot_day: ShootDay | null = null;
  private slate: Slate | null = null;
  private slate_scene: SlateScene | null = null;
  private initialized = false;
  private date_prompt_shoot_day_id: string | null = null;
  private date_prompt_shown = false;
  private ble_event_subscription?: Subscription;
  private ble_status_subscription?: Subscription;
  private mismatched_ble_device_alert_shown = false;

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private alert_controller = inject(AlertController);
  private database = inject(SlateDatabaseService);
  private slate_ble = inject(SlateBleService);
  private slate_events = inject(SlateEventService);

  async ngOnInit(): Promise<void> {
    this.ble_event_subscription = this.slate_ble.event$.subscribe((slate_event) => {
      void this.handle_slate_hardware_event(slate_event);
    });
    this.ble_status = this.slate_ble.status;
    this.ble_status_subscription = this.slate_ble.status$.subscribe((status) => {
      this.ble_status = status;
    });
    await this.load_page();
    this.initialized = true;
  }

  ngOnDestroy(): void {
    this.ble_event_subscription?.unsubscribe();
    this.ble_status_subscription?.unsubscribe();
  }

  async ionViewWillEnter(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    await this.load_page();
  }

  async add_item(): Promise<void> {
    if (this.level === 'shoot_days') {
      await this.open_shoot_day_form();
    } else if (this.level === 'slates') {
      await this.open_slate_picker();
    } else if (this.level === 'slate_scenes') {
      await this.open_slate_scene_form();
    } else {
      await this.open_take_form();
    }
  }

  async edit_item(event: Event, item: HierarchyItem): Promise<void> {
    event.preventDefault();
    event.stopPropagation();

    if (this.level === 'shoot_days') {
      await this.open_shoot_day_form(item as ShootDay);
    } else if (this.level === 'slates') {
      await this.open_slate_form(item as Slate);
    } else if (this.level === 'slate_scenes') {
      await this.open_slate_scene_form(item as SlateScene);
    } else {
      await this.open_take_form(item as Take);
    }
  }

  async delete_item(event: Event, item: HierarchyItem): Promise<void> {
    event.preventDefault();
    event.stopPropagation();

    if (this.level !== 'takes') {
      return;
    }

    const take = item as Take;
    const alert = await this.alert_controller.create({
      header: 'Delete take?',
      message: 'This removes the take and, if it was the latest clip on its roll, rewinds the next suggested clip name.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            await this.database.delete_take(take.take_id);
            await this.load_page();
          },
        },
      ],
    });

    await alert.present();
  }

  async fake_slate_open(): Promise<void> {
    await this.create_take_from_slate_event(this.slate_events.create_fake_event('open'));
  }

  async fake_slate_close(): Promise<void> {
    await this.close_take_from_slate_event(this.slate_events.create_fake_event('close'));
  }

  item_title(item: HierarchyItem): string {
    if (this.level === 'shoot_days') {
      const shoot_day = item as ShootDay;
      return format_display_date(shoot_day.date);
    }

    if (this.level === 'slates') {
      return (item as Slate).camera;
    }

    if (this.level === 'slate_scenes') {
      return (item as SlateScene).scene_name;
    }

    return `${(item as Take).take_number}`;
  }

  item_id(item: HierarchyItem): string {
    if (this.level === 'shoot_days') {
      return (item as ShootDay).shoot_day_id;
    }

    if (this.level === 'slates') {
      return (item as Slate).slate_id;
    }

    if (this.level === 'slate_scenes') {
      return (item as SlateScene).slate_scene_id;
    }

    return (item as Take).take_id;
  }

  item_subtitle(item: HierarchyItem): string {
    if (this.level === 'shoot_days') {
      const shoot_day = item as ShootDay;
      return shoot_day.location || 'No location set';
    }

    if (this.level === 'slates') {
      const slate = item as Slate;
      const count = slate.scene_count || 0;
      return `${count} ${count === 1 ? 'scene' : 'scenes'}`;
    }

    if (this.level === 'slate_scenes') {
      const slate_scene = item as SlateScene;
      const count = slate_scene.take_count || 0;
      return `${count} ${count === 1 ? 'take' : 'takes'}${slate_scene.location ? ` · ${slate_scene.location}` : ''}`;
    }

    const take = item as Take;
    return [
      take.slate_open_timecode ? `Open ${take.slate_open_timecode}` : null,
      take.slate_close_timecode ? `Close ${take.slate_close_timecode}` : null,
      take.notes,
    ].filter(Boolean).join(' · ') || 'No metadata yet';
  }

  take_close_timecode(item: HierarchyItem): string {
    if (this.level !== 'takes') {
      return '';
    }

    return (item as Take).slate_close_timecode ?? '';
  }

  take_roll(item: HierarchyItem): string {
    if (this.level !== 'takes') {
      return '';
    }

    return (item as Take).roll_name ?? '';
  }

  roll_label(roll: Roll): string {
    return roll.card_label ? `${roll.roll_name} · ${roll.card_label}` : roll.roll_name;
  }

  connected_ble_label(): string {
    return this.ble_status.device_name || this.ble_status.device_id || 'No slate connected';
  }

  slate_ble_binding_label(): string {
    if (!this.slate?.bluetooth_device_id) {
      return 'No Bluetooth slate bound';
    }

    return this.slate.bluetooth_device_name || this.slate.bluetooth_device_id;
  }

  slate_state_label(): string {
    return this.slate_is_open() ? 'Open' : 'Closed';
  }

  slate_state_icon(): string {
    return this.slate_is_open() ? '<' : '=';
  }

  slate_state_color(): string {
    return this.slate_is_open() ? 'warning' : 'success';
  }

  connected_ble_matches_slate(): boolean {
    return Boolean(
      this.slate?.bluetooth_device_id
      && this.ble_status.device_id
      && this.slate.bluetooth_device_id === this.ble_status.device_id,
    );
  }

  can_bind_connected_ble_slate(): boolean {
    return Boolean(this.level === 'takes' && this.slate && this.ble_status.state === 'connected' && this.ble_status.device_id);
  }

  slate_is_open(): boolean {
    return this.level === 'takes' && this.items.some((item) => {
      const take = item as Take;
      return Boolean(take.slate_open_timecode && !take.slate_close_timecode);
    });
  }

  async bind_connected_ble_slate(): Promise<void> {
    if (!this.slate || !this.ble_status.device_id) {
      return;
    }

    await this.database.update_slate_device_binding({
      slate_id: this.slate.slate_id,
      bluetooth_device_id: this.ble_status.device_id,
      bluetooth_device_name: this.ble_status.device_name,
    });
    this.slate = await this.database.get_slate(this.slate.slate_id);
  }

  async unbind_ble_slate(): Promise<void> {
    if (!this.slate) {
      return;
    }

    await this.database.update_slate_device_binding({
      slate_id: this.slate.slate_id,
      bluetooth_device_id: null,
      bluetooth_device_name: null,
    });
    this.slate = await this.database.get_slate(this.slate.slate_id);
  }

  take_clip_name(item: HierarchyItem): string {
    if (this.level !== 'takes') {
      return '';
    }

    return (item as Take).clip_name ?? '';
  }

  take_notes(item: HierarchyItem): string {
    if (this.level !== 'takes') {
      return '';
    }

    return (item as Take).notes ?? '';
  }

  take_flag_icons(item: HierarchyItem): TakeFlagIcon[] {
    if (this.level !== 'takes') {
      return [];
    }

    const take = item as Take;
    const flag_ids = (take.flag_ids ?? '').split(',').filter(Boolean);

    return flag_ids.map((flag_id) => {
      const flag = this.flags.find((candidate) => candidate.flag_id === flag_id);
      return {
        flag_id,
        label: flag?.label ?? flag_id,
        symbol: flag_symbol(flag_id),
        color: flag?.color ?? '#52525b',
      };
    });
  }

  flag_checked(flag_id: string): boolean {
    return this.take_form_flag_ids.has(flag_id);
  }

  flag_symbol(flag_id: string): string {
    return flag_symbol(flag_id);
  }

  set_flag_checked(flag_id: string, checked: boolean): void {
    if (checked) {
      this.take_form_flag_ids.add(flag_id);
    } else {
      this.take_form_flag_ids.delete(flag_id);
    }
  }

  async add_flag_to_take_form(): Promise<void> {
    if (!this.new_flag_label.trim()) {
      return;
    }

    const flag = await this.database.create_flag({
      label: this.new_flag_label,
      color: this.new_flag_color,
    });

    this.flags = await this.database.list_flags();
    this.take_form_flag_ids.add(flag.flag_id);
    this.new_flag_label = '';
    this.new_flag_color = '#52525b';
    this.show_add_flag_form = false;
  }

  cancel_add_flag(): void {
    this.new_flag_label = '';
    this.new_flag_color = '#52525b';
    this.show_add_flag_form = false;
  }

  async add_roll_to_take_form(): Promise<void> {
    if (!this.slate || !this.new_roll_name.trim()) {
      return;
    }

    const roll = await this.database.create_roll({
      slate_id: this.slate.slate_id,
      roll_name: this.new_roll_name,
      card_label: this.new_roll_card_label,
    });

    this.rolls = await this.database.list_rolls_for_slate(this.slate.slate_id);
    this.take_form_roll_id = roll.roll_id;
    if (!this.take_form_take && !this.take_form_clip_name) {
      this.take_form_clip_name = await this.database.suggest_clip_name_for_roll(roll.roll_id);
    }
    this.cancel_add_roll();
  }

  async open_page_roll_form(): Promise<void> {
    if (!this.slate) {
      return;
    }

    const alert = await this.alert_controller.create({
      header: 'Add Roll',
      inputs: [
        { name: 'roll_name', type: 'text', placeholder: 'Roll name', value: '' },
        { name: 'card_label', type: 'text', placeholder: 'Card', value: '' },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Add',
          handler: async (values: Record<string, string>) => {
            if (!values['roll_name']?.trim()) {
              return false;
            }

            const roll = await this.database.create_roll({
              slate_id: this.slate!.slate_id,
              roll_name: values['roll_name'],
              card_label: values['card_label'],
            });
            this.rolls = await this.database.list_rolls_for_slate(this.slate!.slate_id);
            this.set_take_page_roll(roll.roll_id);
            return true;
          },
        },
      ],
    });

    await alert.present();
  }

  set_take_page_roll(roll_id: string): void {
    this.take_page_roll_id = roll_id;
    const storage_key = this.take_page_roll_storage_key();
    if (!storage_key) {
      return;
    }

    if (roll_id) {
      localStorage.setItem(storage_key, roll_id);
    } else {
      localStorage.removeItem(storage_key);
    }
  }

  cancel_add_roll(): void {
    this.new_roll_name = '';
    this.new_roll_card_label = '';
    this.show_add_roll_form = false;
  }

  async on_take_roll_changed(roll_id: string): Promise<void> {
    this.take_form_roll_id = roll_id;
    if (this.take_form_take || !roll_id) {
      return;
    }

    this.take_form_clip_name = await this.database.suggest_clip_name_for_roll(roll_id);
  }

  async close_take_form(): Promise<void> {
    this.take_form_open = false;
    this.take_form_take = null;
    this.take_form_roll_id = '';
    this.take_form_clip_name = '';
    this.take_form_flag_ids = new Set<string>();
    this.cancel_add_roll();
    this.show_add_flag_form = false;
    this.new_flag_label = '';
    this.new_flag_color = '#52525b';
  }

  async submit_take_form(): Promise<void> {
    if (!this.slate_scene && !this.take_form_take) {
      return;
    }

    const take_number = Number(this.take_form_take_number);
    if (!Number.isInteger(take_number) || take_number < 1) {
      await this.show_message('Invalid take number', 'Take number must be a whole number greater than zero.');
      return;
    }

    const flag_ids = Array.from(this.take_form_flag_ids);
    const clip_name = this.take_form_clip_name.trim();
    if (!clip_name) {
      if (this.take_form_roll_id && !this.take_form_take) {
        const prompted_clip_name = await this.prompt_for_clip_name('First clip name', 'Enter the next camera clip name for this roll.');
        if (!prompted_clip_name) {
          return;
        }
        this.take_form_clip_name = prompted_clip_name;
      } else {
        await this.show_message('Clip name required', 'Add a clip name before saving this take.');
        return;
      }
    }

    if (this.take_form_take) {
      await this.database.update_take({
        take_id: this.take_form_take.take_id,
        roll_id: this.take_form_roll_id,
        clip_name: this.take_form_clip_name.trim(),
        take_number,
        slate_open_timecode: this.take_form_open_timecode,
        slate_close_timecode: this.take_form_close_timecode,
        notes: this.take_form_notes,
        flag_ids,
      });
    } else {
      await this.database.create_take({
        slate_scene_id: this.slate_scene!.slate_scene_id,
        roll_id: this.take_form_roll_id,
        clip_name: this.take_form_clip_name.trim(),
        take_number,
        slate_open_timecode: this.take_form_open_timecode,
        slate_close_timecode: this.take_form_close_timecode,
        notes: this.take_form_notes,
        flag_ids,
      });
    }

    await this.close_take_form();
    await this.load_page();
  }

  item_link(item: HierarchyItem): unknown[] | null {
    const project_id = this.project?.project_id;
    const shoot_day_id = this.shoot_day?.shoot_day_id;
    const slate_id = this.slate?.slate_id;

    if (this.level === 'shoot_days' && project_id) {
      return ['/projects', project_id, 'shoot-days', (item as ShootDay).shoot_day_id, 'slates'];
    }

    if (this.level === 'slates' && project_id && shoot_day_id) {
      return ['/projects', project_id, 'shoot-days', shoot_day_id, 'slates', (item as Slate).slate_id, 'scenes'];
    }

    if (this.level === 'slate_scenes' && project_id && shoot_day_id && slate_id) {
      return [
        '/projects',
        project_id,
        'shoot-days',
        shoot_day_id,
        'slates',
        slate_id,
        'scenes',
        (item as SlateScene).slate_scene_id,
        'takes',
      ];
    }

    return null;
  }

  display_date(date: string | null | undefined): string {
    return format_display_date(date);
  }

  private async load_page(): Promise<void> {
    this.loading = true;
    this.level = this.route.snapshot.data['level'] as HierarchyLevel;

    const params = this.route.snapshot.paramMap;
    const project_id = params.get('project_id');
    const shoot_day_id = params.get('shoot_day_id');
    const slate_id = params.get('slate_id');
    const slate_scene_id = params.get('slate_scene_id');

    this.project = project_id ? await this.database.get_project(project_id) : null;
    this.shoot_day = shoot_day_id ? await this.database.get_shoot_day(shoot_day_id) : null;
    this.slate = slate_id ? await this.database.get_slate(slate_id) : null;
    this.slate_scene = slate_scene_id ? await this.database.get_slate_scene(slate_scene_id) : null;
    this.flags = await this.database.list_flags();
    await this.load_take_page_rolls();

    if (await this.prompt_for_current_shoot_day()) {
      return;
    }

    if (this.level === 'shoot_days' && project_id) {
      this.items = await this.database.list_shoot_days(project_id);
    } else if (this.level === 'slates' && shoot_day_id) {
      this.items = await this.database.list_slates(shoot_day_id);
    } else if (this.level === 'slate_scenes' && slate_id) {
      this.items = await this.database.list_slate_scenes(slate_id);
    } else if (this.level === 'takes' && slate_scene_id) {
      this.items = await this.database.list_takes(slate_scene_id);
    } else {
      this.items = [];
    }

    this.set_page_copy();
    this.set_breadcrumbs();
    this.loading = false;
  }

  private async load_take_page_rolls(): Promise<void> {
    if (this.level !== 'takes' || !this.slate) {
      this.rolls = [];
      this.take_page_roll_id = '';
      return;
    }

    this.rolls = await this.database.list_rolls_for_slate(this.slate.slate_id);
    const stored_roll_id = this.take_page_roll_storage_key()
      ? localStorage.getItem(this.take_page_roll_storage_key()!)
      : null;
    const preferred_roll_id = stored_roll_id || this.take_page_roll_id || '';
    this.take_page_roll_id = this.rolls.some((roll) => roll.roll_id === preferred_roll_id)
      ? preferred_roll_id
      : '';
  }

  private take_page_roll_storage_key(): string | null {
    if (!this.project || !this.slate) {
      return null;
    }

    return `digital-slate-selected-roll:${this.project.project_id}:${this.slate.camera.toLowerCase()}`;
  }

  private async get_clip_name_for_new_take(): Promise<string | null> {
    if (!this.take_page_roll_id) {
      await this.show_message('Roll required', 'Select or add a roll before opening a take so the app can assign a clip name.');
      return null;
    }

    const suggested_clip_name = await this.database.suggest_clip_name_for_roll(this.take_page_roll_id);
    if (suggested_clip_name) {
      return suggested_clip_name;
    }

    return this.prompt_for_clip_name('First clip name', 'Enter the next camera clip name for this roll.');
  }

  private async handle_slate_hardware_event(slate_event: SlateHardwareEvent): Promise<void> {
    if (this.level !== 'takes' || !this.slate_scene) {
      return;
    }

    if (this.slate?.bluetooth_device_id && this.slate.bluetooth_device_id !== slate_event.device_id) {
      if (!this.mismatched_ble_device_alert_shown) {
        this.mismatched_ble_device_alert_shown = true;
        await this.show_message(
          'Bluetooth slate mismatch',
          `${slate_event.device_id} sent an event, but this app slate is bound to ${this.slate_ble_binding_label()}.`,
        );
      }
      return;
    }

    if (slate_event.event_type === 'open') {
      await this.create_take_from_slate_event(slate_event);
    } else {
      await this.close_take_from_slate_event(slate_event);
    }
  }

  private async create_take_from_slate_event(slate_event: SlateHardwareEvent): Promise<void> {
    if (!this.slate_scene) {
      return;
    }

    const clip_name = await this.get_clip_name_for_new_take();
    if (clip_name === null) {
      return;
    }

    const next_take_number = await this.database.get_next_take_number(this.slate_scene.slate_scene_id);

    await this.database.create_take({
      slate_scene_id: this.slate_scene.slate_scene_id,
      roll_id: this.take_page_roll_id,
      clip_name,
      take_number: next_take_number,
      slate_open_timecode: slate_event.timecode,
    });
    await this.load_page();
  }

  private async close_take_from_slate_event(slate_event: SlateHardwareEvent): Promise<void> {
    if (!this.slate_scene) {
      return;
    }

    const closed_take = await this.database.close_latest_open_take({
      slate_scene_id: this.slate_scene.slate_scene_id,
      slate_close_timecode: slate_event.timecode,
    });

    if (!closed_take) {
      await this.show_message('No open take', 'Open a take before sending a close event.');
      return;
    }

    await this.load_page();
  }

  private async prompt_for_clip_name(header: string, message: string): Promise<string | null> {
    const alert = await this.alert_controller.create({
      header,
      message,
      inputs: [
        {
          name: 'clip_name',
          type: 'text',
          placeholder: 'Acam_0001',
        },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Use Clip Name',
          handler: (values: Record<string, string>) => {
            if (!values['clip_name']?.trim()) {
              return false;
            }

            return true;
          },
        },
      ],
    });

    await alert.present();
    const result = await alert.onDidDismiss<{ values?: Record<string, string> }>();
    if (result.role === 'cancel') {
      return null;
    }

    return result.data?.['values']?.['clip_name']?.trim() || null;
  }

  private async prompt_for_current_shoot_day(): Promise<boolean> {
    if (this.level === 'shoot_days' || !this.project || !this.shoot_day) {
      return false;
    }

    if (this.date_prompt_shoot_day_id !== this.shoot_day.shoot_day_id) {
      this.date_prompt_shoot_day_id = this.shoot_day.shoot_day_id;
      this.date_prompt_shown = false;
    }

    const today = today_date();
    if (this.shoot_day.date === today) {
      return false;
    }

    if (this.date_prompt_shown) {
      return false;
    }

    this.date_prompt_shown = true;
    this.loading = false;

    let create_new_date = false;
    const alert = await this.alert_controller.create({
      header: 'Selected date is not today',
      message: `You are working in ${format_display_date(this.shoot_day?.date)}, but today is ${format_display_date(today)}. Do you want to continue here or create today's date?`,
      backdropDismiss: false,
      buttons: [
        {
          text: 'Continue',
          role: 'cancel',
        },
        {
          text: 'Create New Date',
          handler: () => {
            create_new_date = true;
          },
        },
      ],
    });

    await alert.present();
    await alert.onDidDismiss();

    if (!create_new_date) {
      return false;
    }

    const shoot_day_id = await this.get_or_create_today_shoot_day(today);
    await this.router.navigate(['/projects', this.project.project_id, 'shoot-days', shoot_day_id, 'slates']);
    return true;
  }

  private async get_or_create_today_shoot_day(today: string): Promise<string> {
    const existing = await this.database.get_shoot_day_by_date(this.project!.project_id, today);
    if (existing) {
      return existing.shoot_day_id;
    }

    return this.database.create_shoot_day({
      project_id: this.project!.project_id,
      date: today,
      location: this.shoot_day?.location ?? '',
    });
  }

  private set_breadcrumbs(): void {
    const breadcrumbs: BreadcrumbItem[] = [
      { label: 'Projects', link: ['/projects'] },
    ];

    if (this.project) {
      breadcrumbs.push({
        label: this.project.name,
        link: this.level === 'shoot_days'
          ? null
          : ['/projects', this.project.project_id, 'shoot-days'],
      });
    }

    if (this.project && this.shoot_day) {
      breadcrumbs.push({
        label: format_display_date(this.shoot_day.date),
        link: this.level === 'slates'
          ? null
          : ['/projects', this.project.project_id, 'shoot-days', this.shoot_day.shoot_day_id, 'slates'],
      });
    }

    if (this.project && this.shoot_day && this.slate) {
      breadcrumbs.push({
        label: this.slate.camera,
        link: this.level === 'slate_scenes'
          ? null
          : [
            '/projects',
            this.project.project_id,
            'shoot-days',
            this.shoot_day.shoot_day_id,
            'slates',
            this.slate.slate_id,
            'scenes',
          ],
      });
    }

    if (this.project && this.shoot_day && this.slate && this.slate_scene) {
      breadcrumbs.push({
        label: this.slate_scene.scene_name,
        link: this.level === 'takes'
          ? null
          : [
            '/projects',
            this.project.project_id,
            'shoot-days',
            this.shoot_day.shoot_day_id,
            'slates',
            this.slate.slate_id,
            'scenes',
            this.slate_scene.slate_scene_id,
            'takes',
          ],
      });
    }

    this.breadcrumbs = breadcrumbs;
  }

  private set_page_copy(): void {
    if (this.level === 'shoot_days') {
      this.page_title = 'Shoot Days';
      this.parent_title = this.project?.name ?? '';
      this.add_label = 'Add Shoot Day';
      this.empty_title = 'No shoot days yet';
      this.empty_summary = 'Add the first shoot day for this project.';
      return;
    }

    if (this.level === 'slates') {
      this.page_title = 'Slates';
      this.parent_title = [this.project?.name, format_display_date(this.shoot_day?.date)].filter(Boolean).join(' · ');
      this.add_label = 'Add Slate';
      this.empty_title = 'No slates yet';
      this.empty_summary = 'Add A Cam, B Cam, or any other slate used on this shoot day.';
      return;
    }

    if (this.level === 'slate_scenes') {
      this.page_title = 'Scenes';
      this.parent_title = [format_display_date(this.shoot_day?.date), this.slate?.camera].filter(Boolean).join(' · ');
      this.add_label = 'Add Scene';
      this.empty_title = 'No scenes on this slate yet';
      this.empty_summary = 'Add the first shared scene definition for this camera slate.';
      return;
    }

    this.page_title = 'Takes';
    this.parent_title = [this.slate?.camera, this.slate_scene?.scene_name].filter(Boolean).join(' · ');
    this.add_label = 'Add Take';
    this.empty_title = 'No takes yet';
    this.empty_summary = 'Add takes manually now; later these will also be generated from slate events.';
  }

  private async open_shoot_day_form(shoot_day?: ShootDay): Promise<void> {
    if (!this.project) {
      return;
    }

    const is_editing = Boolean(shoot_day);
    const alert = await this.alert_controller.create({
      header: is_editing ? 'Edit Shoot Day' : 'New Shoot Day',
      inputs: [
        { name: 'date', type: 'date', value: shoot_day?.date ?? today_date() },
        { name: 'location', type: 'text', placeholder: 'Location', value: shoot_day?.location ?? '' },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: is_editing ? 'Update' : 'Add',
          handler: async (values: Record<string, string>) => {
            if (!values['date']) {
              return false;
            }

            if (shoot_day) {
              await this.database.update_shoot_day({
                shoot_day_id: shoot_day.shoot_day_id,
                date: values['date'],
                location: values['location'],
              });
            } else {
              await this.database.create_shoot_day({
                project_id: this.project!.project_id,
                date: values['date'],
                location: values['location'],
              });
            }

            await this.load_page();
            return true;
          },
        },
      ],
    });

    await alert.present();
  }

  private async open_slate_form(slate: Slate): Promise<void> {
    const alert = await this.alert_controller.create({
      header: 'Edit Slate',
      inputs: [
        { name: 'camera', type: 'text', placeholder: 'Camera', value: slate.camera },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Update',
          handler: async (values: Record<string, string>) => {
            if (!values['camera']?.trim()) {
              return false;
            }

            await this.database.update_slate({
              slate_id: slate.slate_id,
              camera: values['camera'],
            });
            await this.load_page();
            return true;
          },
        },
      ],
    });

    await alert.present();
  }

  async close_slate_picker(): Promise<void> {
    this.slate_picker_open = false;
    this.show_new_slate_form = false;
    this.new_slate_camera = 'A Cam';
  }

  async select_reusable_slate(reusable_slate: ReusableSlate): Promise<void> {
    if (!this.shoot_day) {
      return;
    }

    await this.database.create_slate({
      shoot_day_id: this.shoot_day.shoot_day_id,
      camera: reusable_slate.camera,
      bluetooth_device_id: reusable_slate.bluetooth_device_id,
      bluetooth_device_name: reusable_slate.bluetooth_device_name,
    });
    await this.close_slate_picker();
    await this.load_page();
  }

  async submit_new_slate(): Promise<void> {
    if (!this.shoot_day || !this.new_slate_camera.trim()) {
      return;
    }

    await this.database.create_slate({
      shoot_day_id: this.shoot_day.shoot_day_id,
      camera: this.new_slate_camera,
    });
    await this.close_slate_picker();
    await this.load_page();
  }

  private async open_slate_picker(): Promise<void> {
    if (!this.shoot_day) {
      return;
    }

    this.slate_picker_open = true;
    this.slate_picker_loading = true;
    this.show_new_slate_form = false;
    this.new_slate_camera = 'A Cam';
    this.reusable_slates = await this.database.list_reusable_slates(this.shoot_day.shoot_day_id);
    this.show_new_slate_form = this.reusable_slates.length === 0;
    this.slate_picker_loading = false;
  }

  private async open_slate_scene_form(slate_scene?: SlateScene): Promise<void> {
    if (!this.project || !this.slate) {
      return;
    }

    const is_editing = Boolean(slate_scene);
    const alert = await this.alert_controller.create({
      header: is_editing ? 'Edit Scene' : 'New Scene',
      inputs: [
        { name: 'scene_name', type: 'text', placeholder: 'Scene name', value: slate_scene?.scene_name ?? '' },
        { name: 'location', type: 'text', placeholder: 'Location', value: slate_scene?.location ?? '' },
        { name: 'time_of_day', type: 'text', placeholder: 'Time of day', value: slate_scene?.time_of_day ?? '' },
        { name: 'notes', type: 'textarea', placeholder: 'Notes', value: slate_scene?.notes ?? '' },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: is_editing ? 'Update' : 'Add',
          handler: async (values: Record<string, string>) => {
            if (!values['scene_name']?.trim()) {
              return false;
            }

            if (slate_scene) {
              await this.database.update_slate_scene({
                slate_scene_id: slate_scene.slate_scene_id,
                scene_name: values['scene_name'],
                location: values['location'],
                time_of_day: values['time_of_day'],
                notes: values['notes'],
              });
            } else {
              await this.database.create_slate_scene({
                project_id: this.project!.project_id,
                slate_id: this.slate!.slate_id,
                scene_name: values['scene_name'],
                location: values['location'],
                time_of_day: values['time_of_day'],
                notes: values['notes'],
              });
            }

            await this.load_page();
            return true;
          },
        },
      ],
    });

    await alert.present();
  }

  private async open_take_form(take?: Take): Promise<void> {
    if (!this.slate_scene && !take) {
      return;
    }

    const next_take_number = this.slate_scene
      ? await this.database.get_next_take_number(this.slate_scene.slate_scene_id)
      : 1;
    this.take_form_take = take ?? null;
    this.take_form_title = take ? 'Edit Take' : 'New Take';
    this.rolls = this.slate ? await this.database.list_rolls_for_slate(this.slate.slate_id) : [];
    this.take_form_roll_id = take?.roll_id ?? this.take_page_roll_id;
    this.take_form_clip_name = take?.clip_name ?? (
      this.take_form_roll_id ? await this.database.suggest_clip_name_for_roll(this.take_form_roll_id) : ''
    );
    this.take_form_take_number = take?.take_number ?? next_take_number;
    this.take_form_open_timecode = take?.slate_open_timecode ?? '';
    this.take_form_close_timecode = take?.slate_close_timecode ?? '';
    this.take_form_notes = take?.notes ?? '';
    this.take_form_flag_ids = new Set((take?.flag_ids ?? '').split(',').filter(Boolean));
    this.show_add_flag_form = false;
    this.new_flag_label = '';
    this.new_flag_color = '#52525b';
    this.take_form_open = true;
  }

  private async show_message(header: string, message: string): Promise<void> {
    const alert = await this.alert_controller.create({
      header,
      message,
      buttons: ['OK'],
    });

    await alert.present();
  }
}

const today_date = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
};

const format_display_date = (date: string | null | undefined): string => {
  if (!date) {
    return '';
  }

  const iso_match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!iso_match) {
    return date;
  }

  return `${iso_match[3]}-${iso_match[2]}-${iso_match[1]}`;
};

const flag_symbol = (flag_id: string): string => {
  const symbols: Record<string, string> = {
    good: '✓',
    bad: '!',
    circle: '○',
    false_start: 'FS',
    boom_visible: 'B',
    focus_issue: 'F',
    sound_issue: 'S',
  };

  return symbols[flag_id] ?? flag_id.slice(0, 2).toUpperCase();
};
