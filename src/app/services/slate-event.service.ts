import { Injectable } from '@angular/core';

export type SlateHardwareEventType = 'open' | 'close';

export interface SlateHardwareEvent {
  event_type: SlateHardwareEventType;
  device_id: string;
  timecode: string;
  received_at: string;
  raw_message?: string;
}

export interface SlateHardwareEventMessage {
  type: SlateHardwareEventType | 'slate_opened' | 'slate_closed';
  timecode: string;
  device_id?: string;
  sent_at?: string;
  battery?: number;
}

@Injectable({ providedIn: 'root' })
export class SlateEventService {
  create_fake_event(event_type: SlateHardwareEventType): SlateHardwareEvent {
    return this.parse_json_event_message(this.create_fake_event_message(event_type), 'fake-slate-001');
  }

  create_fake_event_message(event_type: SlateHardwareEventType): string {
    const received_at = new Date();

    const message: SlateHardwareEventMessage = {
      type: event_type,
      device_id: 'fake-slate-001',
      timecode: current_slate_timecode(received_at),
      sent_at: received_at.toISOString(),
    };

    return JSON.stringify(message);
  }

  parse_json_event_message(message: string, fallback_device_id = 'unknown-slate'): SlateHardwareEvent {
    const payload = parse_json_object(message);
    const event_type = normalize_event_type(payload['type']);
    const timecode = normalize_timecode(payload['timecode']);
    const device_id = normalize_optional_string(payload['device_id']) || fallback_device_id;

    return {
      event_type,
      device_id,
      timecode,
      received_at: new Date().toISOString(),
      raw_message: message,
    };
  }
}

const parse_json_object = (message: string): Record<string, unknown> => {
  const payload = JSON.parse(message) as unknown;

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Slate event message must be a JSON object.');
  }

  return payload as Record<string, unknown>;
};

const normalize_event_type = (value: unknown): SlateHardwareEventType => {
  if (value === 'open' || value === 'slate_opened') {
    return 'open';
  }

  if (value === 'close' || value === 'slate_closed') {
    return 'close';
  }

  throw new Error(`Unsupported slate event type: ${String(value)}`);
};

const normalize_timecode = (value: unknown): string => {
  if (typeof value !== 'string' || !/^\d{2,}:\d{2}:\d{2}:\d{2}$/.test(value)) {
    throw new Error(`Invalid slate event timecode: ${String(value)}`);
  }

  return value;
};

const normalize_optional_string = (value: unknown): string => {
  return typeof value === 'string' ? value.trim() : '';
};

const slate_start_hour = 9;
const slate_frame_rate = 25;

const current_slate_timecode = (now: Date): string => {
  const slate_start = new Date(now);
  slate_start.setHours(slate_start_hour, 0, 0, 0);

  if (now < slate_start) {
    slate_start.setDate(slate_start.getDate() - 1);
  }

  const elapsed_frames = Math.floor((now.getTime() - slate_start.getTime()) / 1000 * slate_frame_rate);
  const start_frames = slate_start_hour * 60 * 60 * slate_frame_rate;
  const total_frames = start_frames + elapsed_frames;
  const frames_per_hour = 60 * 60 * slate_frame_rate;
  const frames_per_minute = 60 * slate_frame_rate;

  const hours = Math.floor(total_frames / frames_per_hour);
  const minutes = Math.floor(total_frames % frames_per_hour / frames_per_minute);
  const seconds = Math.floor(total_frames % frames_per_minute / slate_frame_rate);
  const frames = total_frames % slate_frame_rate;

  return [
    pad_time_part(hours),
    pad_time_part(minutes),
    pad_time_part(seconds),
    pad_time_part(frames),
  ].join(':');
};

const pad_time_part = (value: number): string => value.toString().padStart(2, '0');
