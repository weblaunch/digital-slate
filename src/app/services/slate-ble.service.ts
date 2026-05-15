import { Injectable, NgZone, inject } from '@angular/core';
import { BleClient, BleDevice } from '@capacitor-community/bluetooth-le';
import { BehaviorSubject, Subject } from 'rxjs';

import { SlateEventService, SlateHardwareEvent } from './slate-event.service';

export const slate_ble_service_uuid = '7b2f0001-8f4b-4c71-9a0c-0d151a7e0001';
export const slate_ble_event_characteristic_uuid = '7b2f0002-8f4b-4c71-9a0c-0d151a7e0001';

export type SlateBleConnectionState =
  | 'idle'
  | 'initializing'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'error';

export interface SlateBleStatus {
  state: SlateBleConnectionState;
  device_id: string | null;
  device_name: string | null;
  last_error: string | null;
}

export interface SlateBleLogEntry {
  kind: 'status' | 'event' | 'error' | 'raw';
  message: string;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class SlateBleService {
  public readonly status$;
  public readonly log$;
  public readonly event$;

  private initialized = false;
  private connected_device: BleDevice | null = null;
  private event_buffer = '';
  private decoder = new TextDecoder();
  private status_subject = new BehaviorSubject<SlateBleStatus>({
    state: 'idle',
    device_id: null,
    device_name: null,
    last_error: null,
  });
  private log_subject = new BehaviorSubject<SlateBleLogEntry[]>([]);
  private event_subject = new Subject<SlateHardwareEvent>();
  private zone = inject(NgZone);
  private slate_events = inject(SlateEventService);

  constructor() {
    this.status$ = this.status_subject.asObservable();
    this.log$ = this.log_subject.asObservable();
    this.event$ = this.event_subject.asObservable();
  }

  get status(): SlateBleStatus {
    return this.status_subject.value;
  }

  async request_and_connect(): Promise<void> {
    try {
      await this.ensure_initialized();
      this.set_status({ state: 'scanning', last_error: null });
      this.add_log('status', 'Scanning for Digital Slate devices.');

      const device = await BleClient.requestDevice({
        services: [slate_ble_service_uuid],
        optionalServices: [slate_ble_service_uuid],
        displayMode: 'list',
      });

      this.connected_device = device;
      this.set_status({
        state: 'connecting',
        device_id: device.deviceId,
        device_name: device.name ?? null,
        last_error: null,
      });
      this.add_log('status', `Connecting to ${this.device_label(device)}.`);

      await BleClient.connect(device.deviceId, (device_id) => this.handle_disconnect(device_id));
      await BleClient.startNotifications(
        device.deviceId,
        slate_ble_service_uuid,
        slate_ble_event_characteristic_uuid,
        (value) => this.handle_notification(value, device.deviceId),
      );

      this.set_status({
        state: 'connected',
        device_id: device.deviceId,
        device_name: device.name ?? null,
        last_error: null,
      });
      this.add_log('status', `Connected to ${this.device_label(device)}.`);
    } catch (error) {
      const message = error_message(error);
      this.connected_device = null;
      this.set_status({ state: 'error', last_error: message });
      this.add_log('error', message);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    const device = this.connected_device;
    if (!device) {
      this.set_status({ state: 'idle', device_id: null, device_name: null, last_error: null });
      return;
    }

    this.set_status({ state: 'disconnecting', last_error: null });
    try {
      await BleClient.stopNotifications(
        device.deviceId,
        slate_ble_service_uuid,
        slate_ble_event_characteristic_uuid,
      );
    } catch {
      // If the device has already gone away there is nothing left to unsubscribe from.
    }

    await BleClient.disconnect(device.deviceId);
    this.connected_device = null;
    this.event_buffer = '';
    this.set_status({ state: 'idle', device_id: null, device_name: null, last_error: null });
    this.add_log('status', `Disconnected from ${this.device_label(device)}.`);
  }

  clear_log(): void {
    this.log_subject.next([]);
  }

  private async ensure_initialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.set_status({ state: 'initializing', last_error: null });
    await BleClient.initialize({ androidNeverForLocation: true });
    this.initialized = true;
  }

  private handle_notification(value: DataView, fallback_device_id: string): void {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const chunk = this.decoder.decode(bytes);
    this.add_log('raw', chunk.trim() || '[empty notification]');
    this.event_buffer += chunk;

    const lines = this.event_buffer.split(/\r?\n/);
    this.event_buffer = lines.pop() ?? '';
    lines.forEach((line) => this.ingest_message(line, fallback_device_id));

    if (this.event_buffer.trim().endsWith('}')) {
      const message = this.event_buffer;
      this.event_buffer = '';
      this.ingest_message(message, fallback_device_id);
    }
  }

  private ingest_message(message: string, fallback_device_id: string): void {
    const trimmed_message = message.trim();
    if (!trimmed_message) {
      return;
    }

    try {
      const event = this.slate_events.parse_optional_json_event_message(trimmed_message, fallback_device_id);
      if (!event) {
        this.add_log('status', 'Slate ready.');
        return;
      }

      this.add_log('event', `${event.event_type.toUpperCase()} ${event.timecode}`);
      this.emit_event(event);
    } catch (error) {
      this.add_log('error', `Could not parse slate event: ${error_message(error)}`);
    }
  }

  private handle_disconnect(device_id: string): void {
    const device_name = this.connected_device?.name ?? null;
    this.connected_device = null;
    this.event_buffer = '';
    this.set_status({
      state: 'idle',
      device_id: null,
      device_name: null,
      last_error: null,
    });
    this.add_log('status', `Slate disconnected: ${device_name ?? device_id}.`);
  }

  private emit_event(event: SlateHardwareEvent): void {
    this.zone.run(() => {
      this.event_subject.next(event);
    });
  }

  private set_status(patch: Partial<SlateBleStatus>): void {
    this.zone.run(() => {
      this.status_subject.next({
        ...this.status_subject.value,
        ...patch,
      });
    });
  }

  private add_log(kind: SlateBleLogEntry['kind'], message: string): void {
    this.zone.run(() => {
      this.log_subject.next([
        {
          kind,
          message,
          created_at: new Date().toISOString(),
        },
        ...this.log_subject.value,
      ].slice(0, 40));
    });
  }

  private device_label(device: BleDevice): string {
    return device.name ? `${device.name} (${device.deviceId})` : device.deviceId;
  }
}

const error_message = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};
