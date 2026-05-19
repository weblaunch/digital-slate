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
  connected_devices: SlateBleConnectedDevice[];
  last_error: string | null;
}

export interface SlateBleConnectedDevice {
  device_id: string;
  device_name: string | null;
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
  private connected_devices = new Map<string, BleDevice>();
  private reconnecting_known_devices = false;
  private event_buffer = '';
  private decoder = new TextDecoder();
  private status_subject = new BehaviorSubject<SlateBleStatus>({
    state: 'idle',
    device_id: null,
    device_name: null,
    connected_devices: [],
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

      this.set_status({
        state: 'connecting',
        device_id: device.deviceId,
        device_name: device.name ?? null,
        last_error: null,
      });
      this.add_log('status', `Connecting to ${this.device_label(device)}.`);

      await this.connect_device(device);
    } catch (error) {
      const message = error_message(error);
      this.set_status({
        state: this.connected_devices.size > 0 ? 'connected' : 'error',
        connected_devices: this.connected_device_statuses(),
        last_error: message,
      });
      this.add_log('error', message);
      throw error;
    }
  }

  async reconnect_known_devices(device_ids: string[]): Promise<void> {
    const unique_device_ids = Array.from(new Set(device_ids.filter(Boolean)));
    const pending_device_ids = unique_device_ids.filter((device_id) => !this.connected_devices.has(device_id));
    if (pending_device_ids.length === 0 || this.reconnecting_known_devices) {
      return;
    }

    this.reconnecting_known_devices = true;
    try {
      await this.ensure_initialized();
      this.set_status({ state: 'connecting', last_error: null });
      this.add_log('status', `Trying ${pending_device_ids.length} known slate ${pending_device_ids.length === 1 ? 'device' : 'devices'}.`);

      const known_devices = await this.find_known_devices(pending_device_ids);
      if (known_devices.length === 0) {
        this.set_status({
          state: this.connected_devices.size > 0 ? 'connected' : 'idle',
          connected_devices: this.connected_device_statuses(),
          last_error: null,
        });
        this.add_log('status', 'No known slate devices are currently available to reconnect.');
        return;
      }

      for (const device of known_devices) {
        try {
          await this.connect_device(device, 3000);
        } catch (error) {
          this.add_log('error', `Could not reconnect ${this.device_label(device)}: ${error_message(error)}`);
        }
      }

      this.set_status({
        state: this.connected_devices.size > 0 ? 'connected' : 'idle',
        connected_devices: this.connected_device_statuses(),
        last_error: null,
      });
    } catch (error) {
      this.add_log('error', `Known slate reconnect failed: ${error_message(error)}`);
      this.set_status({
        state: this.connected_devices.size > 0 ? 'connected' : 'idle',
        connected_devices: this.connected_device_statuses(),
        last_error: null,
      });
    } finally {
      this.reconnecting_known_devices = false;
    }
  }

  async disconnect(): Promise<void> {
    const devices = Array.from(this.connected_devices.values());
    if (devices.length === 0) {
      this.set_status({ state: 'idle', device_id: null, device_name: null, last_error: null });
      return;
    }

    this.set_status({ state: 'disconnecting', last_error: null });
    for (const device of devices) {
      try {
        await BleClient.stopNotifications(
          device.deviceId,
          slate_ble_service_uuid,
          slate_ble_event_characteristic_uuid,
        );
      } catch {
        // If the device has already gone away there is nothing left to unsubscribe from.
      }

      try {
        await BleClient.disconnect(device.deviceId);
      } catch {
        // The native stack may already have reported the disconnect.
      }
      this.add_log('status', `Disconnected from ${this.device_label(device)}.`);
    }

    this.connected_devices.clear();
    this.event_buffer = '';
    this.set_status({
      state: 'idle',
      device_id: null,
      device_name: null,
      connected_devices: [],
      last_error: null,
    });
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

  private async connect_device(device: BleDevice, timeout?: number): Promise<void> {
    if (!this.connected_devices.has(device.deviceId)) {
      await BleClient.connect(
        device.deviceId,
        (device_id) => this.handle_disconnect(device_id),
        timeout ? { timeout } : undefined,
      );
    }
    await BleClient.startNotifications(
      device.deviceId,
      slate_ble_service_uuid,
      slate_ble_event_characteristic_uuid,
      (value) => this.handle_notification(value, device.deviceId),
    );

    this.connected_devices.set(device.deviceId, device);
    this.set_status({
      state: 'connected',
      device_id: device.deviceId,
      device_name: device.name ?? null,
      connected_devices: this.connected_device_statuses(),
      last_error: null,
    });
    this.add_log('status', `Connected to ${this.device_label(device)}.`);
  }

  private async find_known_devices(device_ids: string[]): Promise<BleDevice[]> {
    const devices_by_id = new Map<string, BleDevice>();

    try {
      const devices = await BleClient.getDevices(device_ids);
      devices.forEach((device) => devices_by_id.set(device.deviceId, device));
    } catch (error) {
      this.add_log('error', `Could not retrieve known devices: ${error_message(error)}`);
    }

    try {
      const connected_devices = await BleClient.getConnectedDevices([slate_ble_service_uuid]);
      connected_devices
        .filter((device) => device_ids.includes(device.deviceId))
        .forEach((device) => devices_by_id.set(device.deviceId, device));
    } catch (error) {
      this.add_log('error', `Could not retrieve connected devices: ${error_message(error)}`);
    }

    return Array.from(devices_by_id.values());
  }

  private handle_notification(value: DataView, fallback_device_id: string): void {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const chunk = this.decoder.decode(bytes);
    this.add_log('raw', printable_log_message(chunk));
    this.event_buffer += chunk.replace(/\0/g, '\n');

    const { messages, remainder } = extract_json_messages(this.event_buffer);
    this.event_buffer = remainder;
    messages.forEach((message) => this.ingest_message(message, fallback_device_id));
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
    const device_name = this.connected_devices.get(device_id)?.name ?? null;
    this.connected_devices.delete(device_id);
    this.event_buffer = '';
    this.set_status({
      state: this.connected_devices.size > 0 ? 'connected' : 'idle',
      device_id: this.last_connected_device()?.deviceId ?? null,
      device_name: this.last_connected_device()?.name ?? null,
      connected_devices: this.connected_device_statuses(),
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

  private connected_device_statuses(): SlateBleConnectedDevice[] {
    return Array.from(this.connected_devices.values()).map((device) => ({
      device_id: device.deviceId,
      device_name: device.name ?? null,
    }));
  }

  private last_connected_device(): BleDevice | null {
    const devices = Array.from(this.connected_devices.values());
    return devices[devices.length - 1] ?? null;
  }
}

const error_message = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

const printable_log_message = (message: string): string => {
  const printable = message.replace(/\0/g, '\\0').trim();
  return printable || '[empty notification]';
};

const extract_json_messages = (buffer: string): { messages: string[]; remainder: string } => {
  const messages: string[] = [];
  let start = -1;
  let depth = 0;
  let in_string = false;
  let escaped = false;
  let last_consumed_index = 0;

  for (let index = 0; index < buffer.length; index += 1) {
    const character = buffer[index];

    if (start === -1) {
      if (character === '{') {
        start = index;
        depth = 1;
        in_string = false;
        escaped = false;
      } else {
        last_consumed_index = index + 1;
      }
      continue;
    }

    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === '\\') {
      escaped = in_string;
      continue;
    }

    if (character === '"') {
      in_string = !in_string;
      continue;
    }

    if (in_string) {
      continue;
    }

    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        messages.push(buffer.slice(start, index + 1));
        start = -1;
        in_string = false;
        escaped = false;
        last_consumed_index = index + 1;
      }
    }
  }

  if (start !== -1) {
    return { messages, remainder: buffer.slice(start) };
  }

  return { messages, remainder: buffer.slice(last_consumed_index) };
};
