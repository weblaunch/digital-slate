import { Injectable } from '@angular/core';

export type SlateHardwareEventType = 'open' | 'close';

export interface SlateHardwareEvent {
  event_type: SlateHardwareEventType;
  device_id: string;
  timecode: string;
  received_at: string;
}

@Injectable({ providedIn: 'root' })
export class SlateEventService {
  create_fake_event(event_type: SlateHardwareEventType): SlateHardwareEvent {
    const received_at = new Date();

    return {
      event_type,
      device_id: 'fake-slate-001',
      timecode: current_slate_timecode(received_at),
      received_at: received_at.toISOString(),
    };
  }
}

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
