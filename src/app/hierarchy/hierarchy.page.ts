import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { Subscription } from 'rxjs';

import {
  Flag,
  Project,
  ReusableSlate,
  Roll,
  SceneSummary,
  ShootDay,
  Slate,
  SlateDatabaseService,
  SlateScene,
  Take,
} from '../services/slate-database.service';
import { SlateBleService, SlateBleStatus } from '../services/slate-ble.service';
import { SlateEventService, SlateHardwareEvent } from '../services/slate-event.service';

type HierarchyLevel = 'shoot_days' | 'slates' | 'slate_scenes' | 'takes';
type HierarchyItem = ShootDay | Slate | SlateScene | SceneSummary | Take;
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
  public slate_allocations: SlateScene[] = [];
  public active_slate_scene_id = '';
  public unread_take_counts_by_slate_scene: Record<string, number> = {};
  public slate_preview_timecode = preview_timecode(new Date());
  public slate_timecodes_by_slate_scene: Record<string, string> = {};
  public slate_inverted_by_slate_scene: Record<string, boolean> = {};
  public slate_open_by_slate_scene: Record<string, boolean> = {};
  public capture_enabled = false;
  public capture_status_message = '';
  public take_page_roll_id = '';
  public setup_suffix_options = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  public take_page_setup_suffix = '';
  public take_form_open = false;
  public take_form_title = 'New Take';
  public take_form_take: Take | null = null;
  public take_form_roll_id = '';
  public take_form_clip_name = '';
  public take_form_take_number = 1;
  public take_form_setup_suffix = '';
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
    connected_devices: [],
    last_error: null,
  };

  private project: Project | null = null;
  private shoot_day: ShootDay | null = null;
  private slate: Slate | null = null;
  private scene: SceneSummary | null = null;
  private slate_scene: SlateScene | null = null;
  private initialized = false;
  private date_prompt_shoot_day_id: string | null = null;
  private date_prompt_shown = false;
  private ble_event_subscription?: Subscription;
  private ble_status_subscription?: Subscription;
  private slate_preview_timecode_interval?: ReturnType<typeof setInterval>;
  private ble_reconnect_interval?: ReturnType<typeof setInterval>;
  private last_slate_open_event_by_slate_scene: Record<string, SlateHardwareEvent> = {};
  private pending_clip_name_by_roll: Record<string, string> = {};
  private mismatched_ble_device_alert_shown = false;

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private alert_controller = inject(AlertController);
  private database = inject(SlateDatabaseService);
  private slate_ble = inject(SlateBleService);
  private slate_events = inject(SlateEventService);

  async ngOnInit(): Promise<void> {
    this.ble_event_subscription = this.slate_ble.event$.subscribe((slate_event) => {
      void this.handle_slate_hardware_event(slate_event).catch((error) => {
        this.capture_status_message = `Capture error: ${error instanceof Error ? error.message : String(error)}`;
      });
    });
    this.ble_status = this.slate_ble.status;
    this.ble_status_subscription = this.slate_ble.status$.subscribe((status) => {
      this.ble_status = status;
    });
    this.slate_preview_timecode_interval = setInterval(() => {
      this.slate_preview_timecode = preview_timecode(new Date());
    }, 1000);
    await this.load_page();
    this.initialized = true;
  }

  ngOnDestroy(): void {
    this.ble_event_subscription?.unsubscribe();
    this.ble_status_subscription?.unsubscribe();
    if (this.slate_preview_timecode_interval) {
      clearInterval(this.slate_preview_timecode_interval);
    }
    this.stop_take_page_ble_reconnect();
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
      if (this.slate) {
        await this.open_slate_scene_form();
      } else {
        await this.open_scene_form();
      }
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
      if (is_scene_summary(item)) {
        await this.open_scene_form(item as SceneSummary);
      } else {
        await this.open_slate_scene_form(item as SlateScene);
      }
    } else {
      await this.open_take_form(item as Take);
    }
  }

  async delete_item(event: Event, item: HierarchyItem): Promise<void> {
    event.preventDefault();
    event.stopPropagation();

    const delete_copy = this.delete_copy_for_item(item);
    const alert = await this.alert_controller.create({
      header: delete_copy.header,
      message: delete_copy.message,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            await this.delete_hierarchy_item(item);
            await this.load_page();
          },
        },
      ],
    });

    await alert.present();
  }

  private delete_copy_for_item(item: HierarchyItem): { header: string; message: string } {
    if (this.level === 'shoot_days') {
      return {
        header: 'Delete shoot day?',
        message: `This permanently removes ${this.item_title(item)} and all slates, scenes, takes, flags on takes, and rolls recorded on that day.`,
      };
    }

    if (this.level === 'slates') {
      return {
        header: 'Delete slate?',
        message: `This permanently removes ${this.item_title(item)} from this shoot day, including its scene allocations, takes, take flags, and rolls. The managed slate name remains available for future days.`,
      };
    }

    if (this.level === 'slate_scenes') {
      return {
        header: 'Delete scene?',
        message: is_scene_summary(item)
          ? `This permanently removes scene ${this.item_title(item)}, every allocated slate for that scene, and all takes and flags beneath it.`
          : `This permanently removes ${this.item_title(item)} for this slate, including the takes and flags beneath it.`,
      };
    }

    return {
      header: 'Delete take?',
      message: 'This removes the take and, if it was the latest clip on its roll, rewinds the next suggested clip name.',
    };
  }

  private async delete_hierarchy_item(item: HierarchyItem): Promise<void> {
    if (this.level === 'shoot_days') {
      await this.database.delete_shoot_day((item as ShootDay).shoot_day_id);
      return;
    }

    if (this.level === 'slates') {
      await this.database.delete_slate((item as Slate).slate_id);
      return;
    }

    if (this.level === 'slate_scenes') {
      if (is_scene_summary(item)) {
        await this.database.delete_scene((item as SceneSummary).scene_id);
      } else {
        await this.database.delete_slate_scene((item as SlateScene).slate_scene_id);
      }
      return;
    }

    await this.database.delete_take((item as Take).take_id);
  }

  async fake_slate_open(): Promise<void> {
    await this.handle_slate_hardware_event(this.slate_events.create_fake_event('open'));
  }

  async fake_slate_close(): Promise<void> {
    await this.handle_slate_hardware_event(this.slate_events.create_fake_event('close'));
  }

  async toggle_capture(): Promise<void> {
    if (this.capture_enabled) {
      this.capture_enabled = false;
      this.capture_status_message = 'Capture off.';
      return;
    }

    if (this.level !== 'takes' || !this.slate_scene) {
      this.capture_status_message = 'Open a scene with an allocated slate before capturing.';
      return;
    }

    if (!this.take_page_roll_id) {
      this.capture_status_message = 'Select a roll before capturing.';
      await this.show_message('Roll required', 'Select or add a roll before capturing so the app can assign a clip name.');
      return;
    }

    const capture_clip_name = await this.ensure_clip_name_for_capture(this.take_page_roll_id);
    if (!capture_clip_name) {
      this.capture_status_message = 'Capture cancelled: clip name required.';
      return;
    }

    this.mismatched_ble_device_alert_shown = false;
    this.capture_enabled = true;
    this.capture_status_message = 'Capture armed. Waiting for slate open.';

    const active_allocation = this.resolve_active_slate_scene();
    const open_event = active_allocation
      ? this.last_slate_open_event_by_slate_scene[active_allocation.slate_scene_id]
      : null;

    if (active_allocation && open_event) {
      const take_created = await this.create_take_from_slate_event(open_event, active_allocation);
      if (take_created) {
        this.capture_status_message = `${active_allocation.camera ?? 'Slate'} already open at ${open_event.timecode}. Waiting for slate close.`;
      }
    }
  }

  capture_button_color(): string {
    return 'danger';
  }

  capture_button_label(): string {
    return this.capture_enabled ? 'Capturing' : 'Capture';
  }

  capture_button_needs_attention(): boolean {
    return !this.capture_enabled && this.slate_allocations.some((allocation) => this.allocation_is_open(allocation));
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
      return is_scene_summary(item) ? (item as SceneSummary).scene_name : (item as SlateScene).scene_name;
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
      return is_scene_summary(item) ? (item as SceneSummary).scene_id : (item as SlateScene).slate_scene_id;
    }

    return (item as Take).take_id;
  }

  item_subtitle(item: HierarchyItem): string {
    if (this.level === 'shoot_days') {
      const shoot_day = item as ShootDay;
      const scene_count = shoot_day.scene_count || 0;
      return [
        `${scene_count} ${scene_count === 1 ? 'scene' : 'scenes'}`,
        shoot_day.location,
      ].filter(Boolean).join(' · ');
    }

    if (this.level === 'slates') {
      const slate = item as Slate;
      const count = slate.scene_count || 0;
      return `${count} ${count === 1 ? 'scene' : 'scenes'}`;
    }

    if (this.level === 'slate_scenes') {
      if (is_scene_summary(item)) {
        const scene = item as SceneSummary;
        const slate_count = scene.slate_count || 0;
        const take_count = scene.take_count || 0;
        return [
          `${slate_count} ${slate_count === 1 ? 'slate' : 'slates'}`,
          `${take_count} ${take_count === 1 ? 'take' : 'takes'}`,
          scene.location,
        ].filter(Boolean).join(' · ');
      }

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

  take_setup(item: HierarchyItem): string {
    if (this.level !== 'takes') {
      return '';
    }

    return (item as Take).setup_suffix ?? '';
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

  allocation_label(allocation: SlateScene): string {
    return allocation.camera || 'Slate';
  }

  allocation_connected(allocation: SlateScene): boolean {
    return this.ble_device_connected(allocation.bluetooth_device_id);
  }

  allocation_is_open(allocation: SlateScene): boolean {
    const live_state = this.slate_open_by_slate_scene[allocation.slate_scene_id];
    if (typeof live_state === 'boolean') {
      return live_state;
    }

    if (allocation.slate_scene_id === this.active_slate_scene_id) {
      return this.slate_is_open();
    }

    return Boolean(allocation.open_take_count);
  }

  allocation_inverted(allocation: SlateScene): boolean {
    return Boolean(this.slate_inverted_by_slate_scene[allocation.slate_scene_id]);
  }

  allocation_timecode(allocation: SlateScene): string {
    if (this.allocation_connected(allocation)) {
      return this.slate_preview_timecode;
    }

    return this.slate_timecodes_by_slate_scene[allocation.slate_scene_id] ?? 'No TC';
  }

  allocation_state_icon(allocation: SlateScene): string {
    return this.allocation_is_open(allocation) ? '<' : '=';
  }

  unread_take_count(allocation: SlateScene): number {
    return this.unread_take_counts_by_slate_scene[allocation.slate_scene_id] ?? 0;
  }

  async select_slate_allocation(slate_scene_id: unknown): Promise<void> {
    if (typeof slate_scene_id !== 'string') {
      return;
    }

    if (this.active_slate_scene_id === slate_scene_id) {
      return;
    }

    this.active_slate_scene_id = slate_scene_id;
    delete this.unread_take_counts_by_slate_scene[slate_scene_id];
    this.slate_scene = this.resolve_active_slate_scene();
    this.slate = this.slate_scene?.slate_id ? await this.database.get_slate(this.slate_scene.slate_id) : null;
    await this.load_take_page_rolls();
    this.load_take_page_setup_suffix();
    this.items = this.slate_scene ? await this.database.list_takes(this.slate_scene.slate_scene_id) : [];
    this.set_page_copy();
    this.set_breadcrumbs();
  }

  connected_ble_matches_slate(): boolean {
    return this.ble_device_connected(this.slate?.bluetooth_device_id);
  }

  can_bind_connected_ble_slate(): boolean {
    return Boolean(this.level === 'takes' && this.slate && this.ble_status.connected_devices.length > 0 && this.ble_status.device_id);
  }

  ble_device_connected(device_id: string | null | undefined): boolean {
    if (!device_id) {
      return false;
    }

    return this.ble_status.connected_devices.some((device) => device.device_id === device_id);
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

  async open_scene_slate_picker(): Promise<void> {
    if (!this.scene) {
      return;
    }

    const available_slates = await this.database.list_unallocated_slates_for_scene(this.scene.scene_id);
    const reusable_slates = await this.database.list_reusable_slates(this.scene.shoot_day_id);
    const buttons = [
      ...available_slates.map((slate) => ({
        text: slate.camera,
        handler: async () => {
          await this.database.allocate_slate_to_scene({
            scene_id: this.scene!.scene_id,
            slate_id: slate.slate_id,
          });
          await this.load_page();
        },
      })),
      ...reusable_slates.map((slate) => ({
        text: slate.camera,
        handler: async () => {
          const slate_id = await this.database.create_slate({
            shoot_day_id: this.scene!.shoot_day_id,
            camera: slate.camera,
            bluetooth_device_id: slate.bluetooth_device_id,
            bluetooth_device_name: slate.bluetooth_device_name,
          });
          await this.database.allocate_slate_to_scene({
            scene_id: this.scene!.scene_id,
            slate_id,
          });
          await this.load_page();
        },
      })),
      { text: 'Cancel', role: 'cancel' },
    ];

    const alert = await this.alert_controller.create({
      header: 'Add Slate',
      message: available_slates.length + reusable_slates.length > 0
        ? 'Choose one of the managed slates for this scene.'
        : 'No managed slates are available. Add slate names in Slate Management first.',
      buttons,
    });

    await alert.present();
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

    this.rolls = await this.list_available_rolls();
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
            this.rolls = await this.list_available_rolls();
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

  set_take_page_setup_suffix(setup_suffix: string): void {
    this.take_page_setup_suffix = normalize_setup_suffix_for_ui(setup_suffix);
    const storage_key = this.take_page_setup_storage_key();
    if (!storage_key) {
      return;
    }

    if (this.take_page_setup_suffix) {
      localStorage.setItem(storage_key, this.take_page_setup_suffix);
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

  async on_take_form_setup_changed(setup_suffix: string): Promise<void> {
    this.take_form_setup_suffix = normalize_setup_suffix_for_ui(setup_suffix);
    if (this.take_form_take || !this.slate_scene) {
      return;
    }

    this.take_form_take_number = await this.database.get_next_take_number(
      this.slate_scene.slate_scene_id,
      this.take_form_setup_suffix,
    );
  }

  async close_take_form(): Promise<void> {
    this.take_form_open = false;
    this.take_form_take = null;
    this.take_form_roll_id = '';
    this.take_form_clip_name = '';
    this.take_form_setup_suffix = '';
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
        setup_suffix: this.take_form_setup_suffix,
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
        setup_suffix: this.take_form_setup_suffix,
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
      return ['/projects', project_id, 'shoot-days', (item as ShootDay).shoot_day_id, 'scenes'];
    }

    if (this.level === 'slates' && project_id && shoot_day_id) {
      return ['/projects', project_id, 'shoot-days', shoot_day_id, 'slates', (item as Slate).slate_id, 'scenes'];
    }

    if (this.level === 'slate_scenes' && project_id && shoot_day_id && is_scene_summary(item)) {
      return ['/projects', project_id, 'shoot-days', shoot_day_id, 'scenes', (item as SceneSummary).scene_id, 'takes'];
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
    this.stop_take_page_ble_reconnect();
    this.level = this.route.snapshot.data['level'] as HierarchyLevel;

    const params = this.route.snapshot.paramMap;
    const project_id = params.get('project_id');
    const shoot_day_id = params.get('shoot_day_id');
    const slate_id = params.get('slate_id');
    const scene_id = params.get('scene_id');
    const slate_scene_id = params.get('slate_scene_id');

    this.project = project_id ? await this.database.get_project(project_id) : null;
    this.shoot_day = shoot_day_id ? await this.database.get_shoot_day(shoot_day_id) : null;
    this.slate = slate_id ? await this.database.get_slate(slate_id) : null;
    this.scene = scene_id ? await this.database.get_scene(scene_id) : null;
    this.slate_allocations = scene_id ? await this.database.list_scene_slate_allocations(scene_id) : [];
    this.slate_scene = slate_scene_id ? await this.database.get_slate_scene(slate_scene_id) : null;
    if (this.level === 'takes' && this.scene) {
      this.slate_scene = this.resolve_active_slate_scene();
      this.slate = this.slate_scene?.slate_id ? await this.database.get_slate(this.slate_scene.slate_id) : null;
    }
    this.flags = await this.database.list_flags();
    await this.load_take_page_rolls();
    this.load_take_page_setup_suffix();

    if (await this.prompt_for_current_shoot_day()) {
      return;
    }

    if (this.level === 'shoot_days' && project_id) {
      this.items = await this.database.list_shoot_days(project_id);
    } else if (this.level === 'slates' && shoot_day_id) {
      this.items = await this.database.list_slates(shoot_day_id);
    } else if (this.level === 'slate_scenes' && shoot_day_id && !slate_id) {
      this.items = await this.database.list_scenes_for_shoot_day(shoot_day_id);
    } else if (this.level === 'slate_scenes' && slate_id) {
      this.items = await this.database.list_slate_scenes(slate_id);
    } else if (this.level === 'takes' && this.slate_scene) {
      this.items = await this.database.list_takes(this.slate_scene.slate_scene_id);
    } else {
      this.items = [];
    }

    this.set_page_copy();
    this.set_breadcrumbs();
    this.loading = false;
    this.sync_take_page_ble_reconnect();
  }

  private sync_take_page_ble_reconnect(): void {
    this.stop_take_page_ble_reconnect();

    if (this.level !== 'takes' || this.bound_slate_device_ids().length === 0) {
      return;
    }

    void this.reconnect_bound_slates();
    this.ble_reconnect_interval = setInterval(() => {
      void this.reconnect_bound_slates();
    }, 5000);
  }

  private stop_take_page_ble_reconnect(): void {
    if (this.ble_reconnect_interval) {
      clearInterval(this.ble_reconnect_interval);
      this.ble_reconnect_interval = undefined;
    }
  }

  private async reconnect_bound_slates(): Promise<void> {
    if (this.level !== 'takes') {
      return;
    }

    if (['initializing', 'scanning', 'connecting', 'disconnecting'].includes(this.ble_status.state)) {
      return;
    }

    const missing_device_ids = this.bound_slate_device_ids()
      .filter((device_id) => !this.ble_device_connected(device_id));
    if (missing_device_ids.length === 0) {
      return;
    }

    await this.slate_ble.reconnect_known_devices(missing_device_ids);
  }

  private bound_slate_device_ids(): string[] {
    return Array.from(new Set(this.slate_allocations
      .map((allocation) => allocation.bluetooth_device_id)
      .filter((device_id): device_id is string => Boolean(device_id))));
  }

  private async load_take_page_rolls(): Promise<void> {
    if (this.level !== 'takes' || (!this.project && !this.slate)) {
      this.rolls = [];
      this.take_page_roll_id = '';
      return;
    }

    this.rolls = await this.list_available_rolls();
    const stored_roll_id = this.take_page_roll_storage_key()
      ? localStorage.getItem(this.take_page_roll_storage_key()!)
      : null;
    const preferred_roll_id = stored_roll_id || this.take_page_roll_id || '';
    this.take_page_roll_id = this.rolls.some((roll) => roll.roll_id === preferred_roll_id)
      ? preferred_roll_id
      : '';
    if (!this.take_page_roll_id && this.rolls.length === 1) {
      await this.set_take_page_roll(this.rolls[0].roll_id);
    }
  }

  private load_take_page_setup_suffix(): void {
    if (this.level !== 'takes') {
      this.take_page_setup_suffix = '';
      return;
    }

    const storage_key = this.take_page_setup_storage_key();
    this.take_page_setup_suffix = storage_key
      ? normalize_setup_suffix_for_ui(localStorage.getItem(storage_key))
      : '';
  }

  private async list_available_rolls(): Promise<Roll[]> {
    if (this.project) {
      return this.database.list_rolls_for_project(this.project.project_id);
    }

    if (this.slate) {
      return this.database.list_rolls_for_slate(this.slate.slate_id);
    }

    return [];
  }

  private resolve_active_slate_scene(): SlateScene | null {
    if (this.active_slate_scene_id) {
      const active_allocation = this.slate_allocations.find((allocation) => allocation.slate_scene_id === this.active_slate_scene_id);
      if (active_allocation) {
        return active_allocation;
      }
    }

    const first_allocation = this.slate_allocations[0] ?? null;
    this.active_slate_scene_id = first_allocation?.slate_scene_id ?? '';
    return first_allocation;
  }

  private take_page_roll_storage_key(slate = this.slate): string | null {
    if (!this.project || !slate) {
      return null;
    }

    return `digital-slate-selected-roll:${this.project.project_id}:${slate.camera.toLowerCase()}`;
  }

  private take_page_setup_storage_key(): string | null {
    const scene_id = this.scene?.scene_id ?? this.slate_scene?.scene_id;
    if (!this.project || !scene_id) {
      return null;
    }

    return `digital-slate-selected-setup:${this.project.project_id}:${scene_id}`;
  }

  private selected_roll_id_for_allocation(allocation: SlateScene): string {
    if (allocation.slate_scene_id === this.active_slate_scene_id) {
      return this.take_page_roll_id;
    }

    const storage_key = this.project && allocation.camera
      ? `digital-slate-selected-roll:${this.project.project_id}:${allocation.camera.toLowerCase()}`
      : null;
    return storage_key ? localStorage.getItem(storage_key) ?? '' : '';
  }

  private async get_clip_name_for_new_take(roll_id = this.take_page_roll_id, interactive = true): Promise<string | null> {
    if (!roll_id) {
      if (interactive) {
        await this.show_message('Roll required', 'Select or add a roll before opening a take so the app can assign a clip name.');
      }
      return null;
    }

    const suggested_clip_name = await this.database.suggest_clip_name_for_roll(roll_id);
    if (suggested_clip_name) {
      return suggested_clip_name;
    }

    if (!interactive) {
      return null;
    }

    return this.prompt_for_clip_name('First clip name', 'Enter the next camera clip name for this roll.');
  }

  private async ensure_clip_name_for_capture(roll_id: string): Promise<string | null> {
    const pending_clip_name = this.pending_clip_name_by_roll[roll_id];
    if (pending_clip_name) {
      return pending_clip_name;
    }

    const suggested_clip_name = await this.database.suggest_clip_name_for_roll(roll_id);
    if (suggested_clip_name) {
      return suggested_clip_name;
    }

    const prompted_clip_name = await this.prompt_for_clip_name(
      'First clip name',
      'Enter the next camera clip name for this roll.',
    );
    if (!prompted_clip_name) {
      return null;
    }

    this.pending_clip_name_by_roll[roll_id] = prompted_clip_name;
    return prompted_clip_name;
  }

  private async handle_slate_hardware_event(slate_event: SlateHardwareEvent): Promise<void> {
    if (this.level !== 'takes' || (!this.slate_scene && this.slate_allocations.length === 0)) {
      this.capture_status_message = `${slate_event.event_type.toUpperCase()} ignored: not on a takes page.`;
      return;
    }

    const allocation = this.find_allocation_for_event(slate_event);
    if (!allocation) {
      if (!this.capture_enabled) {
        this.capture_status_message = `${slate_event.event_type.toUpperCase()} ignored: Capture is off.`;
        return;
      }

      if (!this.mismatched_ble_device_alert_shown) {
        this.mismatched_ble_device_alert_shown = true;
        await this.show_message(
          'Bluetooth slate mismatch',
          `${slate_event.device_id} sent an event, but this scene does not have a matching slate allocation.`,
        );
      }
      this.capture_status_message = `${slate_event.event_type.toUpperCase()} ignored: slate is not allocated to this scene.`;
      return;
    }

    this.slate_timecodes_by_slate_scene[allocation.slate_scene_id] = slate_event.timecode;
    this.slate_inverted_by_slate_scene[allocation.slate_scene_id] = Boolean(slate_event.inverted);
    const remembered_open_event = this.last_slate_open_event_by_slate_scene[allocation.slate_scene_id];
    this.slate_open_by_slate_scene[allocation.slate_scene_id] = slate_event.event_type === 'open';
    if (slate_event.event_type === 'open') {
      this.last_slate_open_event_by_slate_scene[allocation.slate_scene_id] = slate_event;
    } else if (!this.capture_enabled) {
      delete this.last_slate_open_event_by_slate_scene[allocation.slate_scene_id];
    }

    if (!this.capture_enabled) {
      this.capture_status_message = `${allocation.camera ?? 'Slate'} ${slate_event.event_type} seen. Capture is off.`;
      return;
    }

    this.capture_status_message = `${slate_event.event_type.toUpperCase()} received from ${slate_event.device_id}.`;

    if (slate_event.event_type === 'open') {
      const take_created = await this.create_take_from_slate_event(slate_event, allocation);
      if (take_created) {
        this.capture_status_message = `${allocation.camera ?? 'Slate'} opened at ${slate_event.timecode}.`;
      }
    } else {
      const take_closed = await this.close_take_from_slate_event(slate_event, allocation, remembered_open_event);
      if (take_closed) {
        delete this.last_slate_open_event_by_slate_scene[allocation.slate_scene_id];
        this.capture_enabled = false;
        this.capture_status_message = `${allocation.camera ?? 'Slate'} closed at ${slate_event.timecode}. Capture off.`;
      }
    }
  }

  private find_allocation_for_event(slate_event: SlateHardwareEvent): SlateScene | null {
    const connected_allocation = this.slate_allocations.find((allocation) => (
      allocation.bluetooth_device_id && allocation.bluetooth_device_id === slate_event.device_id
    ));

    return connected_allocation ?? this.slate_scene;
  }

  private async create_take_from_slate_event(slate_event: SlateHardwareEvent, allocation = this.slate_scene): Promise<boolean> {
    if (!allocation) {
      return false;
    }

    const is_active_allocation = allocation.slate_scene_id === this.active_slate_scene_id;
    const roll_id = this.selected_roll_id_for_allocation(allocation);
    const clip_name = roll_id && this.pending_clip_name_by_roll[roll_id]
      ? this.pending_clip_name_by_roll[roll_id]
      : await this.get_clip_name_for_new_take(roll_id, is_active_allocation);
    if (clip_name === null) {
      this.capture_status_message = `${allocation.camera ?? 'Slate'} open ignored: no roll or clip name is available.`;
      return false;
    }

    const next_take_number = await this.database.get_next_take_number(
      allocation.slate_scene_id,
      this.take_page_setup_suffix,
    );

    await this.database.create_take({
      slate_scene_id: allocation.slate_scene_id,
      roll_id,
      clip_name,
      take_number: next_take_number,
      setup_suffix: this.take_page_setup_suffix,
      slate_open_timecode: slate_event.timecode,
    });
    if (roll_id) {
      delete this.pending_clip_name_by_roll[roll_id];
    }

    if (!is_active_allocation) {
      this.unread_take_counts_by_slate_scene[allocation.slate_scene_id] = this.unread_take_count(allocation) + 1;
    }

    await this.load_page();
    return true;
  }

  private async close_take_from_slate_event(
    slate_event: SlateHardwareEvent,
    allocation = this.slate_scene,
    remembered_open_event?: SlateHardwareEvent,
  ): Promise<boolean> {
    if (!allocation) {
      return false;
    }

    let closed_take_id = await this.database.close_latest_open_take({
      slate_scene_id: allocation.slate_scene_id,
      slate_close_timecode: slate_event.timecode,
    });

    if (!closed_take_id && remembered_open_event) {
      const take_created = await this.create_take_from_slate_event(remembered_open_event, allocation);
      if (take_created) {
        closed_take_id = await this.database.close_latest_open_take({
          slate_scene_id: allocation.slate_scene_id,
          slate_close_timecode: slate_event.timecode,
        });
      }
    }

    if (!closed_take_id) {
      await this.show_message('No open take', 'Open a take before sending a close event.');
      return false;
    }

    if (slate_event.inverted) {
      await this.database.add_take_flag({
        take_id: closed_take_id,
        flag_id: 'end_slate',
      });
    }

    await this.load_page();
    return true;
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
    await this.router.navigate(['/projects', this.project.project_id, 'shoot-days', shoot_day_id, 'scenes']);
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
        link: this.level === 'slate_scenes' && !this.slate
          ? null
          : ['/projects', this.project.project_id, 'shoot-days', this.shoot_day.shoot_day_id, 'scenes'],
      });
    }

    if (this.project && this.shoot_day && this.scene) {
      breadcrumbs.push({
        label: this.scene.scene_name,
        link: this.level === 'takes'
          ? null
          : ['/projects', this.project.project_id, 'shoot-days', this.shoot_day.shoot_day_id, 'scenes', this.scene.scene_id, 'takes'],
      });
      this.breadcrumbs = breadcrumbs;
      return;
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
      this.parent_title = [this.project?.name, format_display_date(this.shoot_day?.date)].filter(Boolean).join(' · ');
      this.add_label = 'Add Scene';
      this.empty_title = 'No scenes yet';
      this.empty_summary = 'Add the first scene for this shoot day, then allocate the slates that will roll.';
      return;
    }

    this.page_title = 'Takes';
    this.parent_title = [this.scene?.scene_name ?? this.slate_scene?.scene_name, this.slate?.camera].filter(Boolean).join(' · ');
    this.add_label = 'Add Take';
    this.empty_title = 'No takes yet';
    this.empty_summary = '';
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
    this.slate_picker_loading = false;
  }

  private async open_scene_form(scene?: SceneSummary): Promise<void> {
    if (!this.project || !this.shoot_day) {
      return;
    }

    const is_editing = Boolean(scene);
    const alert = await this.alert_controller.create({
      header: is_editing ? 'Edit Scene' : 'New Scene',
      inputs: [
        { name: 'scene_name', type: 'text', placeholder: 'Scene name', value: scene?.scene_name ?? '' },
        { name: 'location', type: 'text', placeholder: 'Location', value: scene?.location ?? '' },
        { name: 'time_of_day', type: 'text', placeholder: 'Time of day', value: scene?.time_of_day ?? '' },
        { name: 'notes', type: 'textarea', placeholder: 'Notes', value: scene?.notes ?? '' },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: is_editing ? 'Update' : 'Add',
          handler: async (values: Record<string, string>) => {
            if (!values['scene_name']?.trim()) {
              return false;
            }

            if (scene) {
              await this.database.update_scene({
                scene_id: scene.scene_id,
                scene_name: values['scene_name'],
                location: values['location'],
                time_of_day: values['time_of_day'],
                notes: values['notes'],
              });
            } else {
              await this.database.create_scene({
                project_id: this.project!.project_id,
                shoot_day_id: this.shoot_day!.shoot_day_id,
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

    const setup_suffix = take?.setup_suffix ?? this.take_page_setup_suffix;
    const next_take_number = this.slate_scene
      ? await this.database.get_next_take_number(this.slate_scene.slate_scene_id, setup_suffix)
      : 1;
    this.take_form_take = take ?? null;
    this.take_form_title = take ? 'Edit Take' : 'New Take';
    this.rolls = await this.list_available_rolls();
    this.take_form_roll_id = take?.roll_id ?? this.take_page_roll_id;
    this.take_form_clip_name = take?.clip_name ?? (
      this.take_form_roll_id ? await this.database.suggest_clip_name_for_roll(this.take_form_roll_id) : ''
    );
    this.take_form_take_number = take?.take_number ?? next_take_number;
    this.take_form_setup_suffix = setup_suffix;
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

const preview_timecode = (date: Date): string => {
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  const seconds = `${date.getSeconds()}`.padStart(2, '0');

  return `${hours}:${minutes}:${seconds}:00`;
};

const normalize_setup_suffix_for_ui = (value: string | null | undefined): string => {
  const trimmed = value?.trim().toUpperCase();
  return trimmed && /^[A-Z]$/.test(trimmed) ? trimmed : '';
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

const is_scene_summary = (item: HierarchyItem): item is SceneSummary => {
  return 'scene_id' in item && !('slate_scene_id' in item);
};
