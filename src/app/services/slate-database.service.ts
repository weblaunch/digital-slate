import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import {
  CapacitorSQLite,
  SQLiteConnection,
  SQLiteDBConnection,
} from '@capacitor-community/sqlite';

import {
  build_seed_default_flags_sql,
  create_schema_sql,
  database_schema_version,
} from '../data/database-schema';

export interface Project {
  project_id: string;
  name: string;
  director: string | null;
  dop: string | null;
  camera_op: string | null;
  shoot_day_count?: number;
  scene_count?: number;
  created_at: string;
  updated_at: string;
}

export interface ShootDay {
  shoot_day_id: string;
  project_id: string;
  date: string;
  location: string | null;
  slate_count?: number;
  scene_count?: number;
  created_at: string;
  updated_at: string;
}

export interface Slate {
  slate_id: string;
  shoot_day_id: string;
  camera: string;
  bluetooth_device_id: string | null;
  bluetooth_device_name: string | null;
  scene_count?: number;
  created_at: string;
  updated_at: string;
}

export interface SceneSummary {
  scene_id: string;
  project_id: string;
  shoot_day_id: string;
  scene_name: string;
  location: string | null;
  time_of_day: string | null;
  notes: string | null;
  slate_count?: number;
  take_count?: number;
  open_take_count?: number;
  created_at: string;
  updated_at: string;
}

export interface ReusableSlate {
  managed_slate_id?: string;
  camera: string;
  bluetooth_device_id: string | null;
  bluetooth_device_name: string | null;
  last_used_date: string | null;
  usage_count: number;
}

export interface SlateConnectionTarget {
  managed_slate_id: string;
  camera: string;
  bluetooth_device_id: string | null;
  bluetooth_device_name: string | null;
  last_used_date: string | null;
  usage_count: number;
}

export interface SlateScene {
  slate_scene_id: string;
  slate_id: string;
  scene_id: string;
  shoot_day_id?: string;
  camera?: string;
  bluetooth_device_id?: string | null;
  bluetooth_device_name?: string | null;
  scene_name: string;
  location: string | null;
  time_of_day: string | null;
  notes: string | null;
  scene_order: number;
  take_count?: number;
  open_take_count?: number;
  created_at: string;
  updated_at: string;
}

export interface Take {
  take_id: string;
  shoot_day_id: string;
  slate_id: string;
  slate_scene_id: string;
  roll_id: string | null;
  roll_name?: string | null;
  card_label?: string | null;
  clip_name: string | null;
  take_number: number;
  setup_suffix: string | null;
  slate_open_timecode: string | null;
  slate_close_timecode: string | null;
  notes: string | null;
  flags?: string | null;
  flag_ids?: string | null;
  created_at: string;
  updated_at: string;
}

export interface MediaCard {
  card_id: string;
  label: string;
  media_type: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface Roll {
  roll_id: string;
  project_id: string;
  shoot_day_id: string;
  slate_id: string;
  card_id: string | null;
  roll_name: string;
  last_clip_name: string | null;
  notes: string | null;
  card_label?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Flag {
  flag_id: string;
  label: string;
  color: string;
  sort_order: number;
  system_flag: number;
  active: number;
  created_at: string;
  updated_at: string;
}

export type SearchResultType = 'project' | 'shoot_day' | 'slate' | 'scene' | 'take';
export type SearchFilterType = 'all' | SearchResultType | 'flag';

export interface SearchResult {
  result_type: SearchResultType;
  title: string;
  subtitle: string | null;
  context: string | null;
  matched_text: string | null;
  project_id: string | null;
  shoot_day_id: string | null;
  slate_id: string | null;
  slate_scene_id: string | null;
  take_id: string | null;
  flag_ids?: string | null;
  flags?: string | null;
}

export interface ExportTake {
  project_id: string;
  project_name: string;
  shoot_day_id: string;
  shoot_date: string;
  location: string | null;
  slate_id: string;
  camera: string;
  slate_scene_id: string;
  scene_name: string;
  scene_location: string | null;
  time_of_day: string | null;
  take_id: string;
  take_number: number;
  roll_id: string | null;
  roll_name: string | null;
  card_label: string | null;
  clip_name: string | null;
  setup_suffix: string | null;
  slate_open_timecode: string | null;
  slate_close_timecode: string | null;
  notes: string | null;
  flags: string | null;
  flag_ids: string | null;
}

export interface ProjectOverviewShootDay {
  shoot_day_id: string;
  project_id: string;
  date: string;
  location: string | null;
  scene_count: number;
  slate_count: number;
  take_count: number;
}

export interface ProjectOverviewScene {
  scene_id: string;
  shoot_day_id: string;
  scene_name: string;
  location: string | null;
  time_of_day: string | null;
  slate_count: number;
  take_count: number;
}

export interface ProjectOverviewSlate {
  slate_scene_id: string;
  slate_id: string;
  scene_id: string;
  shoot_day_id: string;
  camera: string;
  take_count: number;
  open_take_count: number;
}

@Injectable({ providedIn: 'root' })
export class SlateDatabaseService {
  private sqlite = new SQLiteConnection(CapacitorSQLite);
  private database: SQLiteDBConnection | null = null;
  private init_promise: Promise<SQLiteDBConnection> | null = null;

  async init(): Promise<SQLiteDBConnection> {
    if (this.database) {
      return this.database;
    }

    this.init_promise ??= this.open_database();
    try {
      this.database = await this.init_promise;
      return this.database;
    } catch (error) {
      this.init_promise = null;
      this.database = null;
      throw error;
    }
  }

  async list_projects(): Promise<Project[]> {
    const db = await this.init();
    const result = await db.query(`
      SELECT
        p.*,
        COUNT(DISTINCT sd.shoot_day_id) AS shoot_day_count,
        COUNT(DISTINCT sc.scene_id) AS scene_count
      FROM project p
      LEFT JOIN shoot_day sd ON sd.project_id = p.project_id
      LEFT JOIN scene sc ON sc.project_id = p.project_id
      GROUP BY p.project_id
      ORDER BY p.updated_at DESC, p.name COLLATE NOCASE ASC
    `);
    return (result.values ?? []) as Project[];
  }

  async list_export_takes(input: {
    project_id: string;
    shoot_day_id?: string | null;
  }): Promise<ExportTake[]> {
    const shoot_day_filter = input.shoot_day_id ? 'AND sd.shoot_day_id = ?' : '';
    const values = input.shoot_day_id ? [input.project_id, input.shoot_day_id] : [input.project_id];

    return this.query<ExportTake>(`
      SELECT
        p.project_id,
        p.name AS project_name,
        sd.shoot_day_id,
        sd.date AS shoot_date,
        sd.location,
        s.slate_id,
        s.camera,
        ss.slate_scene_id,
        sc.scene_name,
        sc.location AS scene_location,
        sc.time_of_day,
        t.take_id,
        t.take_number,
        t.roll_id,
        r.roll_name,
        mc.label AS card_label,
        t.clip_name,
        t.setup_suffix,
        t.slate_open_timecode,
        t.slate_close_timecode,
        t.notes,
        GROUP_CONCAT(DISTINCT f.label) AS flags,
        GROUP_CONCAT(DISTINCT f.flag_id) AS flag_ids
      FROM take t
      JOIN slate_scene ss ON ss.slate_scene_id = t.slate_scene_id
      JOIN scene sc ON sc.scene_id = ss.scene_id
      JOIN slate s ON s.slate_id = t.slate_id
      JOIN shoot_day sd ON sd.shoot_day_id = t.shoot_day_id
      JOIN project p ON p.project_id = sd.project_id
      LEFT JOIN roll r ON r.roll_id = t.roll_id
      LEFT JOIN media_card mc ON mc.card_id = r.card_id
      LEFT JOIN take_flag tf ON tf.take_id = t.take_id
      LEFT JOIN flag f ON f.flag_id = tf.flag_id
      WHERE p.project_id = ?
        ${shoot_day_filter}
      GROUP BY t.take_id
      ORDER BY
        sd.date ASC,
        COALESCE(t.slate_open_timecode, t.slate_close_timecode, '') ASC,
        t.created_at ASC,
        s.camera COLLATE NOCASE ASC,
        ss.scene_order ASC,
        t.take_number ASC
    `, values);
  }

  async list_project_overview_shoot_days(project_id: string): Promise<ProjectOverviewShootDay[]> {
    return this.query<ProjectOverviewShootDay>(`
      SELECT
        sd.shoot_day_id,
        sd.project_id,
        sd.date,
        sd.location,
        COUNT(DISTINCT sc.scene_id) AS scene_count,
        COUNT(DISTINCT s.slate_id) AS slate_count,
        COUNT(DISTINCT t.take_id) AS take_count
      FROM shoot_day sd
      LEFT JOIN scene sc ON sc.shoot_day_id = sd.shoot_day_id
      LEFT JOIN slate s ON s.shoot_day_id = sd.shoot_day_id
      LEFT JOIN slate_scene ss ON ss.scene_id = sc.scene_id AND ss.active = 1
      LEFT JOIN take t ON t.slate_scene_id = ss.slate_scene_id
      WHERE sd.project_id = ?
      GROUP BY sd.shoot_day_id
      ORDER BY sd.date DESC, sd.created_at DESC
    `, [project_id]);
  }

  async list_project_overview_scenes(project_id: string): Promise<ProjectOverviewScene[]> {
    return this.query<ProjectOverviewScene>(`
      SELECT
        sc.scene_id,
        sc.shoot_day_id,
        sc.scene_name,
        sc.location,
        sc.time_of_day,
        COUNT(DISTINCT ss.slate_id) AS slate_count,
        COUNT(DISTINCT t.take_id) AS take_count
      FROM scene sc
      LEFT JOIN slate_scene ss ON ss.scene_id = sc.scene_id AND ss.active = 1
      LEFT JOIN take t ON t.slate_scene_id = ss.slate_scene_id
      WHERE sc.project_id = ?
      GROUP BY sc.scene_id
      ORDER BY sc.created_at ASC, sc.scene_name COLLATE NOCASE ASC
    `, [project_id]);
  }

  async list_project_overview_slates(project_id: string): Promise<ProjectOverviewSlate[]> {
    return this.query<ProjectOverviewSlate>(`
      SELECT
        ss.slate_scene_id,
        ss.slate_id,
        ss.scene_id,
        s.shoot_day_id,
        s.camera,
        COUNT(t.take_id) AS take_count,
        SUM(CASE WHEN t.slate_open_timecode IS NOT NULL AND t.slate_close_timecode IS NULL THEN 1 ELSE 0 END) AS open_take_count
      FROM slate_scene ss
      JOIN slate s ON s.slate_id = ss.slate_id
      JOIN shoot_day sd ON sd.shoot_day_id = s.shoot_day_id
      LEFT JOIN take t ON t.slate_scene_id = ss.slate_scene_id
      WHERE sd.project_id = ? AND ss.active = 1
      GROUP BY ss.slate_scene_id
      ORDER BY s.camera COLLATE NOCASE ASC
    `, [project_id]);
  }

  async create_project(input: {
    name: string;
    director?: string | null;
    dop?: string | null;
    camera_op?: string | null;
  }): Promise<void> {
    const now = timestamp();
    await this.run(
      `INSERT INTO project (
        project_id, name, director, dop, camera_op, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        create_id('project'),
        input.name.trim(),
        empty_to_null(input.director),
        empty_to_null(input.dop),
        empty_to_null(input.camera_op),
        now,
        now,
      ],
    );
  }

  async update_project(input: {
    project_id: string;
    name: string;
    director?: string | null;
    dop?: string | null;
    camera_op?: string | null;
  }): Promise<void> {
    await this.run(
      `UPDATE project
       SET
        name = ?,
        director = ?,
        dop = ?,
        camera_op = ?,
        updated_at = ?
       WHERE project_id = ?`,
      [
        input.name.trim(),
        empty_to_null(input.director),
        empty_to_null(input.dop),
        empty_to_null(input.camera_op),
        timestamp(),
        input.project_id,
      ],
    );
  }

  async get_project(project_id: string): Promise<Project | null> {
    return this.query_one<Project>('SELECT * FROM project WHERE project_id = ?', [project_id]);
  }

  async delete_project(project_id: string): Promise<void> {
    const db = await this.init();
    await db.executeSet([
      {
        statement: `DELETE FROM take_flag
          WHERE take_id IN (
            SELECT t.take_id
            FROM take t
            JOIN shoot_day sd ON sd.shoot_day_id = t.shoot_day_id
            WHERE sd.project_id = ?
          )`,
        values: [project_id],
      },
      {
        statement: `DELETE FROM take
          WHERE shoot_day_id IN (
            SELECT shoot_day_id FROM shoot_day WHERE project_id = ?
          )`,
        values: [project_id],
      },
      {
        statement: `DELETE FROM slate_scene
          WHERE scene_id IN (
            SELECT scene_id FROM scene WHERE project_id = ?
          )
          OR slate_id IN (
            SELECT s.slate_id
            FROM slate s
            JOIN shoot_day sd ON sd.shoot_day_id = s.shoot_day_id
            WHERE sd.project_id = ?
          )`,
        values: [project_id, project_id],
      },
      {
        statement: `DELETE FROM roll WHERE project_id = ?`,
        values: [project_id],
      },
      {
        statement: `DELETE FROM slate
          WHERE shoot_day_id IN (
            SELECT shoot_day_id FROM shoot_day WHERE project_id = ?
          )`,
        values: [project_id],
      },
      {
        statement: `DELETE FROM scene WHERE project_id = ?`,
        values: [project_id],
      },
      {
        statement: `DELETE FROM shoot_day WHERE project_id = ?`,
        values: [project_id],
      },
      {
        statement: `DELETE FROM project WHERE project_id = ?`,
        values: [project_id],
      },
    ]);
    await this.save_if_web();
  }

  async list_shoot_days(project_id: string): Promise<ShootDay[]> {
    const result = await this.query<ShootDay>(`
      SELECT
        sd.*,
        COUNT(DISTINCT s.slate_id) AS slate_count,
        COUNT(DISTINCT sc.scene_id) AS scene_count
      FROM shoot_day sd
      LEFT JOIN slate s ON s.shoot_day_id = sd.shoot_day_id
      LEFT JOIN scene sc ON sc.shoot_day_id = sd.shoot_day_id
      WHERE sd.project_id = ?
      GROUP BY sd.shoot_day_id
      ORDER BY sd.date DESC, sd.created_at DESC
    `, [project_id]);
    return result;
  }

  async create_shoot_day(input: {
    project_id: string;
    date: string;
    location?: string | null;
  }): Promise<string> {
    const now = timestamp();
    const shoot_day_id = create_id('shoot_day');
    await this.run(
      `INSERT INTO shoot_day (
        shoot_day_id, project_id, date, location, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        shoot_day_id,
        input.project_id,
        input.date,
        empty_to_null(input.location),
        now,
        now,
      ],
    );
    return shoot_day_id;
  }

  async update_shoot_day(input: {
    shoot_day_id: string;
    date: string;
    location?: string | null;
  }): Promise<void> {
    await this.run(
      `UPDATE shoot_day
       SET
        date = ?,
        location = ?,
        updated_at = ?
       WHERE shoot_day_id = ?`,
      [
        input.date,
        empty_to_null(input.location),
        timestamp(),
        input.shoot_day_id,
      ],
    );
  }

  async get_shoot_day(shoot_day_id: string): Promise<ShootDay | null> {
    return this.query_one<ShootDay>('SELECT * FROM shoot_day WHERE shoot_day_id = ?', [shoot_day_id]);
  }

  async delete_shoot_day(shoot_day_id: string): Promise<void> {
    const db = await this.init();
    await db.executeSet([
      {
        statement: `DELETE FROM take_flag
          WHERE take_id IN (
            SELECT take_id FROM take WHERE shoot_day_id = ?
          )`,
        values: [shoot_day_id],
      },
      {
        statement: `DELETE FROM take WHERE shoot_day_id = ?`,
        values: [shoot_day_id],
      },
      {
        statement: `DELETE FROM slate_scene
          WHERE scene_id IN (
            SELECT scene_id FROM scene WHERE shoot_day_id = ?
          )
          OR slate_id IN (
            SELECT slate_id FROM slate WHERE shoot_day_id = ?
          )`,
        values: [shoot_day_id, shoot_day_id],
      },
      {
        statement: `DELETE FROM roll WHERE shoot_day_id = ?`,
        values: [shoot_day_id],
      },
      {
        statement: `DELETE FROM slate WHERE shoot_day_id = ?`,
        values: [shoot_day_id],
      },
      {
        statement: `DELETE FROM scene WHERE shoot_day_id = ?`,
        values: [shoot_day_id],
      },
      {
        statement: `DELETE FROM shoot_day WHERE shoot_day_id = ?`,
        values: [shoot_day_id],
      },
    ]);
    await this.save_if_web();
  }

  async get_shoot_day_by_date(project_id: string, date: string): Promise<ShootDay | null> {
    return this.query_one<ShootDay>(
      `SELECT *
       FROM shoot_day
       WHERE project_id = ? AND date = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [project_id, date],
    );
  }

  async list_slates(shoot_day_id: string): Promise<Slate[]> {
    return this.query<Slate>(`
      SELECT
        s.*,
        COUNT(ss.slate_scene_id) AS scene_count
      FROM slate s
      LEFT JOIN slate_scene ss ON ss.slate_id = s.slate_id
      WHERE s.shoot_day_id = ?
      GROUP BY s.slate_id
      ORDER BY s.camera COLLATE NOCASE ASC
    `, [shoot_day_id]);
  }

  async list_reusable_slates(shoot_day_id: string): Promise<ReusableSlate[]> {
    return this.query<ReusableSlate>(`
      SELECT
        ms.managed_slate_id,
        ms.camera,
        ms.bluetooth_device_id,
        ms.bluetooth_device_name,
        (
          SELECT MAX(sd.date)
          FROM slate s
          JOIN shoot_day sd ON sd.shoot_day_id = s.shoot_day_id
          WHERE s.camera = ms.camera COLLATE NOCASE
        ) AS last_used_date,
        (
          SELECT COUNT(s.slate_id)
          FROM slate s
          WHERE s.camera = ms.camera COLLATE NOCASE
        ) AS usage_count
      FROM managed_slate ms
      WHERE NOT EXISTS (
        SELECT 1
        FROM slate current_slate
        WHERE current_slate.shoot_day_id = ?
        AND current_slate.camera = ms.camera COLLATE NOCASE
      )
      ORDER BY ms.camera COLLATE NOCASE ASC
    `, [shoot_day_id]);
  }

  async create_managed_slate(input: {
    camera: string;
    bluetooth_device_id?: string | null;
    bluetooth_device_name?: string | null;
  }): Promise<string> {
    const existing = await this.query_one<{ managed_slate_id: string }>(
      `SELECT managed_slate_id
       FROM managed_slate
       WHERE camera = ? COLLATE NOCASE`,
      [input.camera.trim()],
    );

    if (existing) {
      return existing.managed_slate_id;
    }

    const now = timestamp();
    const managed_slate_id = create_id('managed_slate');
    await this.run(
      `INSERT INTO managed_slate (
        managed_slate_id, camera, bluetooth_device_id, bluetooth_device_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        managed_slate_id,
        input.camera.trim(),
        empty_to_null(input.bluetooth_device_id),
        empty_to_null(input.bluetooth_device_name),
        now,
        now,
      ],
    );
    return managed_slate_id;
  }

  async create_slate(input: {
    shoot_day_id: string;
    camera: string;
    bluetooth_device_id?: string | null;
    bluetooth_device_name?: string | null;
  }): Promise<string> {
    const existing = await this.query_one<{ slate_id: string }>(
      `SELECT slate_id
       FROM slate
       WHERE shoot_day_id = ?
       AND camera = ? COLLATE NOCASE`,
      [input.shoot_day_id, input.camera.trim()],
    );

    if (existing) {
      return existing.slate_id;
    }

    const managed_slate = await this.query_one<{
      bluetooth_device_id: string | null;
      bluetooth_device_name: string | null;
    }>(
      `SELECT bluetooth_device_id, bluetooth_device_name
       FROM managed_slate
       WHERE camera = ? COLLATE NOCASE
       LIMIT 1`,
      [input.camera.trim()],
    );
    const bluetooth_device_id = input.bluetooth_device_id ?? managed_slate?.bluetooth_device_id ?? null;
    const bluetooth_device_name = input.bluetooth_device_name ?? managed_slate?.bluetooth_device_name ?? null;
    const now = timestamp();
    const slate_id = create_id('slate');
    await this.run(
      `INSERT INTO slate (
        slate_id, shoot_day_id, camera, bluetooth_device_id, bluetooth_device_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        slate_id,
        input.shoot_day_id,
        input.camera.trim(),
        empty_to_null(bluetooth_device_id),
        empty_to_null(bluetooth_device_name),
        now,
        now,
      ],
    );
    await this.create_managed_slate({
      camera: input.camera,
      bluetooth_device_id,
      bluetooth_device_name,
    });
    return slate_id;
  }

  async update_slate(input: {
    slate_id: string;
    camera: string;
  }): Promise<void> {
    await this.run(
      `UPDATE slate
       SET
        camera = ?,
        updated_at = ?
       WHERE slate_id = ?`,
      [
        input.camera.trim(),
        timestamp(),
        input.slate_id,
      ],
    );
  }

  async update_slate_device_binding(input: {
    slate_id: string;
    bluetooth_device_id: string | null;
    bluetooth_device_name?: string | null;
  }): Promise<void> {
    await this.run(
      `UPDATE slate
       SET
        bluetooth_device_id = ?,
        bluetooth_device_name = ?,
        updated_at = ?
       WHERE slate_id = ?`,
      [
        empty_to_null(input.bluetooth_device_id),
        empty_to_null(input.bluetooth_device_name),
        timestamp(),
        input.slate_id,
      ],
    );
  }

  async list_slate_connection_targets(): Promise<SlateConnectionTarget[]> {
    return this.query<SlateConnectionTarget>(`
      SELECT
        ms.managed_slate_id,
        ms.camera,
        ms.bluetooth_device_id,
        ms.bluetooth_device_name,
        (
          SELECT MAX(sd.date)
          FROM slate s
          JOIN shoot_day sd ON sd.shoot_day_id = s.shoot_day_id
          WHERE s.camera = ms.camera COLLATE NOCASE
        ) AS last_used_date,
        (
          SELECT COUNT(s.slate_id)
          FROM slate s
          WHERE s.camera = ms.camera COLLATE NOCASE
        ) AS usage_count
      FROM managed_slate ms
      ORDER BY ms.camera COLLATE NOCASE ASC
    `);
  }

  async update_slate_device_binding_by_camera(input: {
    camera: string;
    bluetooth_device_id: string | null;
    bluetooth_device_name?: string | null;
  }): Promise<void> {
    await this.create_managed_slate({
      camera: input.camera,
      bluetooth_device_id: input.bluetooth_device_id,
      bluetooth_device_name: input.bluetooth_device_name,
    });
    const now = timestamp();
    const values = [
      empty_to_null(input.bluetooth_device_id),
      empty_to_null(input.bluetooth_device_name),
      now,
      input.camera.trim(),
    ];
    await this.run(
      `UPDATE managed_slate
       SET
        bluetooth_device_id = ?,
        bluetooth_device_name = ?,
        updated_at = ?
       WHERE camera = ? COLLATE NOCASE`,
      values,
    );
    await this.run(
      `UPDATE slate
       SET
        bluetooth_device_id = ?,
        bluetooth_device_name = ?,
        updated_at = ?
       WHERE camera = ? COLLATE NOCASE`,
      values,
    );
  }

  async get_slate(slate_id: string): Promise<Slate | null> {
    return this.query_one<Slate>('SELECT * FROM slate WHERE slate_id = ?', [slate_id]);
  }

  async delete_slate(slate_id: string): Promise<void> {
    const db = await this.init();
    await db.executeSet([
      {
        statement: `DELETE FROM take_flag
          WHERE take_id IN (
            SELECT take_id FROM take WHERE slate_id = ?
          )`,
        values: [slate_id],
      },
      {
        statement: `DELETE FROM take WHERE slate_id = ?`,
        values: [slate_id],
      },
      {
        statement: `DELETE FROM slate_scene WHERE slate_id = ?`,
        values: [slate_id],
      },
      {
        statement: `DELETE FROM roll WHERE slate_id = ?`,
        values: [slate_id],
      },
      {
        statement: `DELETE FROM slate WHERE slate_id = ?`,
        values: [slate_id],
      },
    ]);
    await this.save_if_web();
  }

  async list_scenes_for_shoot_day(shoot_day_id: string): Promise<SceneSummary[]> {
    return this.query<SceneSummary>(`
      SELECT
        sc.*,
        COUNT(DISTINCT ss.slate_id) AS slate_count,
        COUNT(DISTINCT t.take_id) AS take_count
      FROM scene sc
      LEFT JOIN slate_scene ss ON ss.scene_id = sc.scene_id AND ss.active = 1
      LEFT JOIN take t ON t.slate_scene_id = ss.slate_scene_id
      WHERE sc.shoot_day_id = ?
      GROUP BY sc.scene_id
      ORDER BY sc.created_at ASC, sc.scene_name COLLATE NOCASE ASC
    `, [shoot_day_id]);
  }

  async create_scene(input: {
    project_id: string;
    shoot_day_id: string;
    scene_name: string;
    location?: string | null;
    time_of_day?: string | null;
    notes?: string | null;
  }): Promise<string> {
    const now = timestamp();
    const scene_id = create_id('scene');
    await this.run(
      `INSERT INTO scene (
        scene_id, project_id, shoot_day_id, scene_name, location, time_of_day, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        scene_id,
        input.project_id,
        input.shoot_day_id,
        input.scene_name.trim(),
        empty_to_null(input.location),
        empty_to_null(input.time_of_day),
        empty_to_null(input.notes),
        now,
        now,
      ],
    );
    return scene_id;
  }

  async update_scene(input: {
    scene_id: string;
    scene_name: string;
    location?: string | null;
    time_of_day?: string | null;
    notes?: string | null;
  }): Promise<void> {
    await this.run(
      `UPDATE scene
       SET
        scene_name = ?,
        location = ?,
        time_of_day = ?,
        notes = ?,
        updated_at = ?
       WHERE scene_id = ?`,
      [
        input.scene_name.trim(),
        empty_to_null(input.location),
        empty_to_null(input.time_of_day),
        empty_to_null(input.notes),
        timestamp(),
        input.scene_id,
      ],
    );
  }

  async get_scene(scene_id: string): Promise<SceneSummary | null> {
    return this.query_one<SceneSummary>('SELECT * FROM scene WHERE scene_id = ?', [scene_id]);
  }

  async delete_scene(scene_id: string): Promise<void> {
    const db = await this.init();
    await db.executeSet([
      {
        statement: `DELETE FROM take_flag
          WHERE take_id IN (
            SELECT t.take_id
            FROM take t
            JOIN slate_scene ss ON ss.slate_scene_id = t.slate_scene_id
            WHERE ss.scene_id = ?
          )`,
        values: [scene_id],
      },
      {
        statement: `DELETE FROM take
          WHERE slate_scene_id IN (
            SELECT slate_scene_id FROM slate_scene WHERE scene_id = ?
          )`,
        values: [scene_id],
      },
      {
        statement: `DELETE FROM slate_scene WHERE scene_id = ?`,
        values: [scene_id],
      },
      {
        statement: `DELETE FROM scene WHERE scene_id = ?`,
        values: [scene_id],
      },
    ]);
    await this.save_if_web();
  }

  async list_scene_slate_allocations(scene_id: string): Promise<SlateScene[]> {
    return this.query<SlateScene>(`
      SELECT
        ss.*,
        s.camera,
        s.bluetooth_device_id,
        s.bluetooth_device_name,
        sc.shoot_day_id,
        sc.scene_name,
        sc.location,
        sc.time_of_day,
        sc.notes,
        COUNT(t.take_id) AS take_count,
        SUM(CASE WHEN t.slate_open_timecode IS NOT NULL AND t.slate_close_timecode IS NULL THEN 1 ELSE 0 END) AS open_take_count
      FROM slate_scene ss
      JOIN slate s ON s.slate_id = ss.slate_id
      JOIN scene sc ON sc.scene_id = ss.scene_id
      LEFT JOIN take t ON t.slate_scene_id = ss.slate_scene_id
      WHERE ss.scene_id = ? AND ss.active = 1
      GROUP BY ss.slate_scene_id
      ORDER BY s.camera COLLATE NOCASE ASC
    `, [scene_id]);
  }

  async list_unallocated_slates_for_scene(scene_id: string): Promise<Slate[]> {
    return this.query<Slate>(`
      SELECT s.*
      FROM slate s
      JOIN scene sc ON sc.shoot_day_id = s.shoot_day_id
      WHERE sc.scene_id = ?
      AND NOT EXISTS (
        SELECT 1
        FROM slate_scene ss
        WHERE ss.scene_id = sc.scene_id
        AND ss.slate_id = s.slate_id
        AND ss.active = 1
      )
      ORDER BY s.camera COLLATE NOCASE ASC
    `, [scene_id]);
  }

  async allocate_slate_to_scene(input: {
    scene_id: string;
    slate_id: string;
  }): Promise<string> {
    const existing = await this.query_one<{ slate_scene_id: string }>(
      `SELECT slate_scene_id
       FROM slate_scene
       WHERE scene_id = ? AND slate_id = ?`,
      [input.scene_id, input.slate_id],
    );

    if (existing) {
      await this.run(
        `UPDATE slate_scene
         SET active = 1, updated_at = ?
         WHERE slate_scene_id = ?`,
        [timestamp(), existing.slate_scene_id],
      );
      return existing.slate_scene_id;
    }

    const now = timestamp();
    const slate_scene_id = create_id('slate_scene');
    await this.run(
      `INSERT INTO slate_scene (
        slate_scene_id, slate_id, scene_id, scene_order, active, created_at, updated_at
      ) VALUES (?, ?, ?, 0, 1, ?, ?)`,
      [slate_scene_id, input.slate_id, input.scene_id, now, now],
    );
    return slate_scene_id;
  }

  async create_slate_for_scene(input: {
    scene_id: string;
    camera: string;
  }): Promise<string> {
    const scene = await this.get_scene(input.scene_id);
    if (!scene) {
      throw new Error(`Cannot create slate for missing scene ${input.scene_id}`);
    }

    await this.create_slate({
      shoot_day_id: scene.shoot_day_id,
      camera: input.camera,
    });
    const slate = await this.query_one<Slate>(
      `SELECT *
       FROM slate
       WHERE shoot_day_id = ? AND camera = ? COLLATE NOCASE
       LIMIT 1`,
      [scene.shoot_day_id, input.camera.trim()],
    );
    if (!slate) {
      throw new Error(`Cannot allocate missing slate ${input.camera}`);
    }

    return this.allocate_slate_to_scene({
      scene_id: input.scene_id,
      slate_id: slate.slate_id,
    });
  }

  async list_slate_scenes(slate_id: string): Promise<SlateScene[]> {
    return this.query<SlateScene>(`
      SELECT
        ss.*,
        sc.scene_name,
        sc.location,
        sc.time_of_day,
        sc.notes,
        COUNT(t.take_id) AS take_count
      FROM slate_scene ss
      JOIN scene sc ON sc.scene_id = ss.scene_id
      LEFT JOIN take t ON t.slate_scene_id = ss.slate_scene_id
      WHERE ss.slate_id = ? AND ss.active = 1
      GROUP BY ss.slate_scene_id
      ORDER BY ss.scene_order ASC, sc.scene_name COLLATE NOCASE ASC
    `, [slate_id]);
  }

  async create_slate_scene(input: {
    project_id: string;
    slate_id: string;
    scene_name: string;
    location?: string | null;
    time_of_day?: string | null;
    notes?: string | null;
  }): Promise<void> {
    const now = timestamp();
    const scene_id = create_id('scene');
    const slate_scene_id = create_id('slate_scene');
    const db = await this.init();
    const next_order = await this.next_scene_order(input.slate_id);
    const slate = await this.get_slate(input.slate_id);
    if (!slate) {
      throw new Error(`Cannot create scene for missing slate ${input.slate_id}`);
    }

    await db.executeSet([
      {
        statement: `INSERT INTO scene (
          scene_id, project_id, shoot_day_id, scene_name, location, time_of_day, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        values: [
          scene_id,
          input.project_id,
          slate.shoot_day_id,
          input.scene_name.trim(),
          empty_to_null(input.location),
          empty_to_null(input.time_of_day),
          empty_to_null(input.notes),
          now,
          now,
        ],
      },
      {
        statement: `INSERT INTO slate_scene (
          slate_scene_id, slate_id, scene_id, scene_order, active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, ?, ?)`,
        values: [slate_scene_id, input.slate_id, scene_id, next_order, now, now],
      },
    ]);
    await this.save_if_web();
  }

  async update_slate_scene(input: {
    slate_scene_id: string;
    scene_name: string;
    location?: string | null;
    time_of_day?: string | null;
    notes?: string | null;
  }): Promise<void> {
    await this.run(
      `UPDATE scene
       SET
        scene_name = ?,
        location = ?,
        time_of_day = ?,
        notes = ?,
        updated_at = ?
       WHERE scene_id = (
        SELECT scene_id
        FROM slate_scene
        WHERE slate_scene_id = ?
       )`,
      [
        input.scene_name.trim(),
        empty_to_null(input.location),
        empty_to_null(input.time_of_day),
        empty_to_null(input.notes),
        timestamp(),
        input.slate_scene_id,
      ],
    );
  }

  async get_slate_scene(slate_scene_id: string): Promise<SlateScene | null> {
    return this.query_one<SlateScene>(`
      SELECT
        ss.*,
        sc.scene_name,
        sc.location,
        sc.time_of_day,
        sc.notes
      FROM slate_scene ss
      JOIN scene sc ON sc.scene_id = ss.scene_id
      WHERE ss.slate_scene_id = ?
    `, [slate_scene_id]);
  }

  async delete_slate_scene(slate_scene_id: string): Promise<void> {
    const db = await this.init();
    await db.executeSet([
      {
        statement: `DELETE FROM take_flag
          WHERE take_id IN (
            SELECT take_id FROM take WHERE slate_scene_id = ?
          )`,
        values: [slate_scene_id],
      },
      {
        statement: `DELETE FROM take WHERE slate_scene_id = ?`,
        values: [slate_scene_id],
      },
      {
        statement: `DELETE FROM slate_scene WHERE slate_scene_id = ?`,
        values: [slate_scene_id],
      },
    ]);
    await this.save_if_web();
  }

  async list_takes(slate_scene_id: string): Promise<Take[]> {
    return this.query<Take>(`
      SELECT
        t.*,
        r.roll_name,
        mc.label AS card_label,
        GROUP_CONCAT(f.label, ', ') AS flags,
        GROUP_CONCAT(f.flag_id, ',') AS flag_ids
      FROM take t
      LEFT JOIN roll r ON r.roll_id = t.roll_id
      LEFT JOIN media_card mc ON mc.card_id = r.card_id
      LEFT JOIN take_flag tf ON tf.take_id = t.take_id
      LEFT JOIN flag f ON f.flag_id = tf.flag_id
      WHERE t.slate_scene_id = ?
      GROUP BY t.take_id
      ORDER BY t.take_number DESC
    `, [slate_scene_id]);
  }

  async list_rolls_for_slate(slate_id: string): Promise<Roll[]> {
    return this.query<Roll>(`
      SELECT
        r.*,
        mc.label AS card_label
      FROM roll r
      LEFT JOIN media_card mc ON mc.card_id = r.card_id
      WHERE r.project_id = (
        SELECT sd.project_id
        FROM slate s
        JOIN shoot_day sd ON sd.shoot_day_id = s.shoot_day_id
        WHERE s.slate_id = ?
      )
      ORDER BY r.roll_name COLLATE NOCASE ASC
    `, [slate_id]);
  }

  async list_rolls_for_project(project_id: string): Promise<Roll[]> {
    return this.query<Roll>(`
      SELECT
        r.*,
        mc.label AS card_label
      FROM roll r
      LEFT JOIN media_card mc ON mc.card_id = r.card_id
      WHERE r.project_id = ?
      ORDER BY r.roll_name COLLATE NOCASE ASC
    `, [project_id]);
  }

  async create_roll(input: {
    slate_id: string;
    roll_name: string;
    card_label?: string | null;
    notes?: string | null;
  }): Promise<Roll> {
    const roll_name = input.roll_name.trim();
    if (!roll_name) {
      throw new Error('Roll name is required.');
    }

    const context = await this.query_one<{ project_id: string; shoot_day_id: string }>(
      `SELECT
        sd.project_id,
        s.shoot_day_id
       FROM slate s
       JOIN shoot_day sd ON sd.shoot_day_id = s.shoot_day_id
       WHERE s.slate_id = ?`,
      [input.slate_id],
    );

    if (!context) {
      throw new Error(`Cannot create roll for missing slate ${input.slate_id}`);
    }

    const existing = await this.query_one<Roll>(
      `SELECT
        r.*,
        mc.label AS card_label
       FROM roll r
       LEFT JOIN media_card mc ON mc.card_id = r.card_id
       WHERE r.project_id = ? AND r.roll_name = ? COLLATE NOCASE
       LIMIT 1`,
      [context.project_id, roll_name],
    );

    if (existing) {
      return existing;
    }

    const now = timestamp();
    const card_id = await this.find_or_create_media_card(input.card_label, now);
    const roll: Roll = {
      roll_id: create_id('roll'),
      project_id: context.project_id,
      shoot_day_id: context.shoot_day_id,
      slate_id: input.slate_id,
      card_id,
      roll_name,
      last_clip_name: null,
      notes: empty_to_null(input.notes),
      card_label: input.card_label?.trim() || null,
      created_at: now,
      updated_at: now,
    };

    await this.run(
      `INSERT INTO roll (
        roll_id,
        project_id,
        shoot_day_id,
        slate_id,
        card_id,
        roll_name,
        last_clip_name,
        notes,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        roll.roll_id,
        roll.project_id,
        roll.shoot_day_id,
        roll.slate_id,
        roll.card_id,
        roll.roll_name,
        roll.last_clip_name,
        roll.notes,
        roll.created_at,
        roll.updated_at,
      ],
    );

    return roll;
  }

  async suggest_clip_name_for_roll(roll_id: string): Promise<string> {
    const roll = await this.query_one<Roll>(
      `SELECT *
       FROM roll
       WHERE roll_id = ?`,
      [roll_id],
    );

    return this.next_available_clip_name_for_roll(roll_id, increment_clip_name(roll?.last_clip_name ?? ''));
  }

  async list_flags(): Promise<Flag[]> {
    return this.query<Flag>(`
      SELECT *
      FROM flag
      WHERE active = 1
      ORDER BY sort_order ASC, label COLLATE NOCASE ASC
    `);
  }

  async create_flag(input: {
    label: string;
    color: string;
  }): Promise<Flag> {
    const now = timestamp();
    const existing = await this.query_one<Flag>(
      `SELECT *
       FROM flag
       WHERE label = ? COLLATE NOCASE
       LIMIT 1`,
      [input.label.trim()],
    );

    if (existing) {
      if (!existing.active) {
        await this.run(
          `UPDATE flag
           SET
            active = 1,
            color = ?,
            updated_at = ?
           WHERE flag_id = ?`,
          [input.color, now, existing.flag_id],
        );
        return {
          ...existing,
          active: 1,
          color: input.color,
          updated_at: now,
        };
      }

      return existing;
    }

    const sort_order_row = await this.query_one<{ sort_order: number }>(
      `SELECT COALESCE(MAX(sort_order), 0) + 10 AS sort_order
       FROM flag`,
    );
    const flag: Flag = {
      flag_id: create_id('flag'),
      label: input.label.trim(),
      color: input.color,
      sort_order: sort_order_row?.sort_order ?? 100,
      system_flag: 0,
      active: 1,
      created_at: now,
      updated_at: now,
    };

    await this.run(
      `INSERT INTO flag (
        flag_id,
        label,
        color,
        sort_order,
        system_flag,
        active,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, 0, 1, ?, ?)`,
      [
        flag.flag_id,
        flag.label,
        flag.color,
        flag.sort_order,
        flag.created_at,
        flag.updated_at,
      ],
    );

    return flag;
  }

  async search(input: {
    query: string;
    result_type?: SearchFilterType;
    flag_id?: string;
  }): Promise<SearchResult[]> {
    const query_text = input.query.trim();
    const result_type = input.result_type ?? 'all';
    const flag_id = input.flag_id?.trim() || '';

    if (!query_text && !flag_id) {
      return [];
    }

    const like = `%${escape_like(query_text)}%`;
    const results: SearchResult[] = [];

    if ((result_type === 'all' || result_type === 'project') && query_text) {
      results.push(...await this.search_projects(like));
    }

    if ((result_type === 'all' || result_type === 'shoot_day') && query_text) {
      results.push(...await this.search_shoot_days(like));
    }

    if ((result_type === 'all' || result_type === 'slate') && query_text) {
      results.push(...await this.search_slates(like));
    }

    if ((result_type === 'all' || result_type === 'scene') && query_text) {
      results.push(...await this.search_scenes(like));
    }

    if (result_type === 'all' || result_type === 'take' || result_type === 'flag') {
      results.push(...await this.search_takes({
        like,
        has_query: Boolean(query_text),
        flag_id,
        match_flags_only: result_type === 'flag',
      }));
    }

    return results;
  }

  async get_next_take_number(slate_scene_id: string, setup_suffix?: string | null): Promise<number> {
    const normalized_setup_suffix = normalize_setup_suffix(setup_suffix) ?? '';
    const row = await this.query_one<{ next_take_number: number }>(
      `SELECT COALESCE(MAX(take_number), 0) + 1 AS next_take_number
       FROM take
       WHERE slate_scene_id = ?
       AND COALESCE(setup_suffix, '') = ?`,
      [slate_scene_id, normalized_setup_suffix],
    );
    return row?.next_take_number ?? 1;
  }

  async create_take(input: {
    slate_scene_id: string;
    roll_id?: string | null;
    clip_name?: string | null;
    take_number: number;
    setup_suffix?: string | null;
    slate_open_timecode?: string | null;
    slate_close_timecode?: string | null;
    notes?: string | null;
    flag_ids?: string[];
  }): Promise<void> {
    const now = timestamp();
    const take_id = create_id('take');
    const context = await this.query_one<{ shoot_day_id: string; slate_id: string }>(
      `SELECT
        s.shoot_day_id,
        s.slate_id
       FROM slate_scene ss
       JOIN slate s ON s.slate_id = ss.slate_id
       WHERE ss.slate_scene_id = ?`,
      [input.slate_scene_id],
    );

    if (!context) {
      throw new Error(`Cannot create take for missing slate scene ${input.slate_scene_id}`);
    }

    const clip_name = await this.prepare_clip_name_for_new_take(input.roll_id, input.clip_name);

    await this.run(
      `INSERT INTO take (
        take_id,
        shoot_day_id,
        slate_id,
        slate_scene_id,
        roll_id,
        clip_name,
        take_number,
        setup_suffix,
        slate_open_timecode,
        slate_close_timecode,
        notes,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        take_id,
        context.shoot_day_id,
        context.slate_id,
        input.slate_scene_id,
        empty_to_null(input.roll_id),
        clip_name,
        input.take_number,
        normalize_setup_suffix(input.setup_suffix),
        empty_to_null(input.slate_open_timecode),
        empty_to_null(input.slate_close_timecode),
        empty_to_null(input.notes),
        now,
        now,
      ],
    );
    await this.update_roll_clip_counter(input.roll_id, clip_name);
    await this.set_take_flags(take_id, input.flag_ids ?? []);
  }

  async update_take(input: {
    take_id: string;
    roll_id?: string | null;
    clip_name?: string | null;
    take_number: number;
    setup_suffix?: string | null;
    slate_open_timecode?: string | null;
    slate_close_timecode?: string | null;
    notes?: string | null;
    flag_ids?: string[];
  }): Promise<void> {
    await this.run(
      `UPDATE take
       SET
        roll_id = ?,
        clip_name = ?,
        take_number = ?,
        setup_suffix = ?,
        slate_open_timecode = ?,
        slate_close_timecode = ?,
        notes = ?,
        updated_at = ?
       WHERE take_id = ?`,
      [
        empty_to_null(input.roll_id),
        empty_to_null(input.clip_name),
        input.take_number,
        normalize_setup_suffix(input.setup_suffix),
        empty_to_null(input.slate_open_timecode),
        empty_to_null(input.slate_close_timecode),
        empty_to_null(input.notes),
        timestamp(),
        input.take_id,
      ],
    );
    await this.update_roll_clip_counter(input.roll_id, input.clip_name);
    await this.set_take_flags(input.take_id, input.flag_ids ?? []);
  }

  async delete_take(take_id: string): Promise<void> {
    const take = await this.query_one<Take>(
      `SELECT *
       FROM take
       WHERE take_id = ?`,
      [take_id],
    );

    if (!take) {
      return;
    }

    const db = await this.init();
    await db.executeSet([
      {
        statement: 'DELETE FROM take_flag WHERE take_id = ?',
        values: [take_id],
      },
      {
        statement: 'DELETE FROM take WHERE take_id = ?',
        values: [take_id],
      },
    ]);

    if (take.roll_id && take.clip_name) {
      await this.rewind_roll_clip_counter_if_current(take.roll_id, take.clip_name);
    }

    await this.save_if_web();
  }

  async add_take_flag(input: {
    take_id: string;
    flag_id: string;
  }): Promise<void> {
    await this.run(
      `INSERT OR IGNORE INTO take_flag (
        take_id,
        flag_id,
        created_at
      ) VALUES (?, ?, ?)`,
      [input.take_id, input.flag_id, timestamp()],
    );
  }

  private async update_roll_clip_counter(
    roll_id: string | null | undefined,
    clip_name: string | null | undefined,
  ): Promise<void> {
    const normalized_roll_id = roll_id?.trim();
    const normalized_clip_name = clip_name?.trim();
    if (!normalized_roll_id || !normalized_clip_name) {
      return;
    }

    await this.run(
      `UPDATE roll
       SET last_clip_name = ?, updated_at = ?
       WHERE roll_id = ?`,
      [normalized_clip_name, timestamp(), normalized_roll_id],
    );
  }

  private async prepare_clip_name_for_new_take(
    roll_id: string | null | undefined,
    clip_name: string | null | undefined,
  ): Promise<string | null> {
    const normalized_roll_id = roll_id?.trim();
    const normalized_clip_name = clip_name?.trim();
    if (!normalized_roll_id || !normalized_clip_name) {
      return empty_to_null(normalized_clip_name);
    }

    return this.next_available_clip_name_for_roll(normalized_roll_id, normalized_clip_name);
  }

  private async next_available_clip_name_for_roll(roll_id: string, clip_name: string): Promise<string> {
    let next_clip_name = clip_name;

    while (next_clip_name) {
      const existing = await this.query_one<{ take_id: string }>(
        `SELECT take_id
         FROM take
         WHERE roll_id = ?
           AND clip_name = ? COLLATE NOCASE
         LIMIT 1`,
        [roll_id, next_clip_name],
      );

      if (!existing) {
        return next_clip_name;
      }

      next_clip_name = increment_clip_name(next_clip_name);
    }

    return next_clip_name;
  }

  private async rewind_roll_clip_counter_if_current(roll_id: string, deleted_clip_name: string): Promise<void> {
    const roll = await this.query_one<Roll>(
      `SELECT *
       FROM roll
       WHERE roll_id = ?`,
      [roll_id],
    );

    if (roll?.last_clip_name !== deleted_clip_name) {
      return;
    }

    const previous_take = await this.query_one<{ clip_name: string }>(
      `SELECT clip_name
       FROM take
       WHERE roll_id = ?
         AND clip_name IS NOT NULL
         AND TRIM(clip_name) != ''
       ORDER BY created_at DESC, take_number DESC
       LIMIT 1`,
      [roll_id],
    );

    await this.run(
      `UPDATE roll
       SET last_clip_name = ?, updated_at = ?
       WHERE roll_id = ?`,
      [previous_take?.clip_name ?? null, timestamp(), roll_id],
    );
  }

  private async repair_duplicate_clip_names(db: SQLiteDBConnection): Promise<void> {
    const rows = await db.query(`
      SELECT
        take_id,
        roll_id,
        clip_name
      FROM take
      WHERE roll_id IS NOT NULL
        AND TRIM(roll_id) != ''
        AND clip_name IS NOT NULL
        AND TRIM(clip_name) != ''
      ORDER BY roll_id ASC, created_at ASC, take_number ASC
    `);
    const used_clip_names_by_roll = new Map<string, Set<string>>();
    const last_clip_name_by_roll = new Map<string, string>();
    const now = timestamp();

    for (const row of rows.values ?? []) {
      const take_id = String(row['take_id']);
      const roll_id = String(row['roll_id']);
      const original_clip_name = String(row['clip_name']).trim();
      const used_clip_names = used_clip_names_by_roll.get(roll_id) ?? new Set<string>();
      let clip_name = original_clip_name;

      while (clip_name && used_clip_names.has(clip_name.toLowerCase())) {
        clip_name = increment_clip_name(clip_name);
      }

      if (clip_name !== original_clip_name) {
        await db.run(
          `UPDATE take
           SET clip_name = ?, updated_at = ?
           WHERE take_id = ?`,
          [clip_name, now, take_id],
        );
      }

      used_clip_names.add(clip_name.toLowerCase());
      used_clip_names_by_roll.set(roll_id, used_clip_names);
      last_clip_name_by_roll.set(roll_id, clip_name);
    }

    for (const [roll_id, clip_name] of last_clip_name_by_roll.entries()) {
      await db.run(
        `UPDATE roll
         SET last_clip_name = ?, updated_at = ?
         WHERE roll_id = ?`,
        [clip_name, now, roll_id],
      );
    }
  }

  async close_latest_open_take(input: {
    slate_scene_id: string;
    slate_close_timecode: string;
  }): Promise<string | null> {
    const open_take = await this.query_one<{ take_id: string }>(
      `SELECT take_id
       FROM take
       WHERE slate_scene_id = ?
       AND slate_close_timecode IS NULL
       ORDER BY take_number DESC, created_at DESC
       LIMIT 1`,
      [input.slate_scene_id],
    );

    if (!open_take) {
      return null;
    }

    await this.run(
      `UPDATE take
       SET
        slate_close_timecode = ?,
        updated_at = ?
       WHERE take_id = ?`,
      [
        input.slate_close_timecode,
        timestamp(),
        open_take.take_id,
      ],
    );
    return open_take.take_id;
  }

  private async open_database(): Promise<SQLiteDBConnection> {
    if (Capacitor.getPlatform() === 'web') {
      throw new Error('SQLite web storage has been removed. Run Digital Slate on iOS.');
    }

    const db = await this.sqlite.createConnection(
      'digital_slate',
      false,
      'no-encryption',
      database_schema_version,
      false,
    );
    await db.open();
    await db.execute('PRAGMA foreign_keys = ON');

    for (const statement of create_schema_sql) {
      await db.execute(statement);
    }

    await this.ensure_scene_shoot_day_column(db);
    await this.ensure_slate_device_columns(db);
    await this.ensure_managed_slates(db);
    await this.ensure_take_context_columns(db);
    await this.repair_duplicate_clip_names(db);
    await db.executeSet(build_seed_default_flags_sql(timestamp()));
    this.database = db;
    await this.save_if_web();
    return db;
  }

  private async ensure_scene_shoot_day_column(db: SQLiteDBConnection): Promise<void> {
    const table_info = await db.query(`PRAGMA table_info('scene')`);
    const columns = new Set((table_info.values ?? []).map((row) => String(row['name'])));

    if (!columns.has('shoot_day_id')) {
      await db.execute(`ALTER TABLE scene ADD COLUMN shoot_day_id TEXT`);
    }

    await db.execute(`
      UPDATE scene
      SET shoot_day_id = (
        SELECT s.shoot_day_id
        FROM slate_scene ss
        JOIN slate s ON s.slate_id = ss.slate_id
        WHERE ss.scene_id = scene.scene_id
        ORDER BY ss.created_at ASC
        LIMIT 1
      )
      WHERE shoot_day_id IS NULL
    `);

    await db.execute(`CREATE INDEX IF NOT EXISTS idx_scene_shoot_day_id ON scene(shoot_day_id)`);
  }

  private async ensure_slate_device_columns(db: SQLiteDBConnection): Promise<void> {
    const table_info = await db.query(`PRAGMA table_info('slate')`);
    const columns = new Set((table_info.values ?? []).map((row) => String(row['name'])));

    if (!columns.has('bluetooth_device_id')) {
      await db.execute(`ALTER TABLE slate ADD COLUMN bluetooth_device_id TEXT`);
    }

    if (!columns.has('bluetooth_device_name')) {
      await db.execute(`ALTER TABLE slate ADD COLUMN bluetooth_device_name TEXT`);
    }

    await db.execute(`CREATE INDEX IF NOT EXISTS idx_slate_bluetooth_device_id ON slate(bluetooth_device_id)`);
  }

  private async ensure_managed_slates(db: SQLiteDBConnection): Promise<void> {
    await db.execute(`
      INSERT OR IGNORE INTO managed_slate (
        managed_slate_id,
        camera,
        bluetooth_device_id,
        bluetooth_device_name,
        created_at,
        updated_at
      )
      SELECT
        'managed_slate_' || lower(hex(randomblob(8))),
        TRIM(s.camera),
        (
          SELECT bound_slate.bluetooth_device_id
          FROM slate bound_slate
          WHERE bound_slate.camera = s.camera COLLATE NOCASE
          AND bound_slate.bluetooth_device_id IS NOT NULL
          ORDER BY bound_slate.updated_at DESC
          LIMIT 1
        ),
        (
          SELECT bound_slate.bluetooth_device_name
          FROM slate bound_slate
          WHERE bound_slate.camera = s.camera COLLATE NOCASE
          AND bound_slate.bluetooth_device_name IS NOT NULL
          ORDER BY bound_slate.updated_at DESC
          LIMIT 1
        ),
        MIN(s.created_at),
        MAX(s.updated_at)
      FROM slate s
      WHERE TRIM(s.camera) != ''
      GROUP BY s.camera COLLATE NOCASE
    `);

    await db.execute(`CREATE INDEX IF NOT EXISTS idx_managed_slate_bluetooth_device_id ON managed_slate(bluetooth_device_id)`);
  }

  private async ensure_take_context_columns(db: SQLiteDBConnection): Promise<void> {
    const table_info = await db.query(`PRAGMA table_info('take')`);
    const columns = new Set((table_info.values ?? []).map((row) => String(row['name'])));

    if (!columns.has('shoot_day_id')) {
      await db.execute(`ALTER TABLE take ADD COLUMN shoot_day_id TEXT`);
    }

    if (!columns.has('slate_id')) {
      await db.execute(`ALTER TABLE take ADD COLUMN slate_id TEXT`);
    }

    if (!columns.has('roll_id')) {
      await db.execute(`ALTER TABLE take ADD COLUMN roll_id TEXT`);
    }

    if (!columns.has('clip_name')) {
      await db.execute(`ALTER TABLE take ADD COLUMN clip_name TEXT`);
    }

    if (!columns.has('setup_suffix')) {
      await db.execute(`ALTER TABLE take ADD COLUMN setup_suffix TEXT`);
    }

    await this.ensure_roll_context_columns(db);

    const refreshed_table_info = await db.query(`PRAGMA table_info('take')`);
    const refreshed_columns = new Set((refreshed_table_info.values ?? []).map((row) => String(row['name'])));

    await db.execute(`
      UPDATE take
      SET
        shoot_day_id = (
          SELECT s.shoot_day_id
          FROM slate_scene ss
          JOIN slate s ON s.slate_id = ss.slate_id
          WHERE ss.slate_scene_id = take.slate_scene_id
        ),
        slate_id = (
          SELECT s.slate_id
          FROM slate_scene ss
          JOIN slate s ON s.slate_id = ss.slate_id
          WHERE ss.slate_scene_id = take.slate_scene_id
        )
      WHERE shoot_day_id IS NULL OR slate_id IS NULL
    `);

    await db.execute(`CREATE INDEX IF NOT EXISTS idx_take_shoot_day_id ON take(shoot_day_id)`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_take_slate_id ON take(slate_id)`);
    await this.ensure_take_setup_unique_constraint(db);
    if (refreshed_columns.has('roll_id')) {
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_take_roll_id ON take(roll_id)`);
      await this.migrate_roll_text_values(db, refreshed_columns);
    }
  }

  private async ensure_take_setup_unique_constraint(db: SQLiteDBConnection): Promise<void> {
    const table_sql = await db.query(`
      SELECT sql
      FROM sqlite_master
      WHERE type = 'table'
      AND name = 'take'
      LIMIT 1
    `);
    const create_sql = String(table_sql.values?.[0]?.['sql'] ?? '');
    const has_old_take_number_constraint = /UNIQUE\s*\(\s*shoot_day_id\s*,\s*slate_id\s*,\s*slate_scene_id\s*,\s*take_number\s*\)/i
      .test(create_sql);

    if (has_old_take_number_constraint) {
      await this.rebuild_take_table_for_setup_unique_constraint(db);
    }

    await db.execute(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_take_number_by_setup
      ON take(shoot_day_id, slate_id, slate_scene_id, take_number, COALESCE(setup_suffix, ''))
    `);
  }

  private async rebuild_take_table_for_setup_unique_constraint(db: SQLiteDBConnection): Promise<void> {
    await db.execute(`PRAGMA foreign_keys = OFF`);
    try {
      await db.execute(`DROP TABLE IF EXISTS take_next`);
      await db.execute(`
        CREATE TABLE take_next (
          take_id TEXT PRIMARY KEY,
          shoot_day_id TEXT NOT NULL,
          slate_id TEXT NOT NULL,
          slate_scene_id TEXT NOT NULL,
          roll_id TEXT,
          clip_name TEXT,
          take_number INTEGER NOT NULL,
          setup_suffix TEXT,
          slate_open_timecode TEXT,
          slate_close_timecode TEXT,
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (shoot_day_id) REFERENCES shoot_day(shoot_day_id) ON DELETE CASCADE,
          FOREIGN KEY (slate_id) REFERENCES slate(slate_id) ON DELETE CASCADE,
          FOREIGN KEY (slate_scene_id) REFERENCES slate_scene(slate_scene_id) ON DELETE CASCADE,
          FOREIGN KEY (roll_id) REFERENCES roll(roll_id) ON DELETE SET NULL
        )
      `);
      await db.execute(`
        INSERT INTO take_next (
          take_id,
          shoot_day_id,
          slate_id,
          slate_scene_id,
          roll_id,
          clip_name,
          take_number,
          setup_suffix,
          slate_open_timecode,
          slate_close_timecode,
          notes,
          created_at,
          updated_at
        )
        SELECT
          take_id,
          shoot_day_id,
          slate_id,
          slate_scene_id,
          roll_id,
          clip_name,
          take_number,
          setup_suffix,
          slate_open_timecode,
          slate_close_timecode,
          notes,
          created_at,
          updated_at
        FROM take
      `);
      await db.execute(`DROP TABLE take`);
      await db.execute(`ALTER TABLE take_next RENAME TO take`);
    } finally {
      await db.execute(`PRAGMA foreign_keys = ON`);
    }
  }

  private async ensure_roll_context_columns(db: SQLiteDBConnection): Promise<void> {
    const table_info = await db.query(`PRAGMA table_info('roll')`);
    const columns = new Set((table_info.values ?? []).map((row) => String(row['name'])));

    if (!columns.has('last_clip_name')) {
      await db.execute(`ALTER TABLE roll ADD COLUMN last_clip_name TEXT`);
    }
  }

  private async set_take_flags(take_id: string, flag_ids: string[]): Promise<void> {
    const db = await this.init();
    const now = timestamp();
    const unique_flag_ids = Array.from(new Set(flag_ids.filter(Boolean)));
    const statements = [
      {
        statement: 'DELETE FROM take_flag WHERE take_id = ?',
        values: [take_id],
      },
      ...unique_flag_ids.map((flag_id) => ({
        statement: `INSERT INTO take_flag (
          take_id,
          flag_id,
          created_at
        ) VALUES (?, ?, ?)`,
        values: [take_id, flag_id, now],
      })),
    ];

    await db.executeSet(statements);
    await this.save_if_web();
  }

  private async migrate_roll_text_values(db: SQLiteDBConnection, take_columns: Set<string>): Promise<void> {
    if (!take_columns.has('roll')) {
      return;
    }

    const rows = await db.query(`
      SELECT DISTINCT
        t.roll AS roll_name,
        t.project_id,
        t.shoot_day_id,
        t.slate_id
      FROM (
        SELECT
          take.roll,
          take.shoot_day_id,
          take.slate_id,
          sd.project_id
        FROM take
        JOIN shoot_day sd ON sd.shoot_day_id = take.shoot_day_id
        WHERE take.roll IS NOT NULL
          AND TRIM(take.roll) != ''
          AND take.roll_id IS NULL
      ) t
    `);

    for (const row of rows.values ?? []) {
      const roll_name = String(row['roll_name']).trim();
      const project_id = String(row['project_id']);
      const shoot_day_id = String(row['shoot_day_id']);
      const slate_id = String(row['slate_id']);
      const now = timestamp();
      const existing_result = await db.query(
        `SELECT *
         FROM roll
         WHERE project_id = ? AND roll_name = ? COLLATE NOCASE
         LIMIT 1`,
        [project_id, roll_name],
      );
      const existing = existing_result.values?.[0] as { roll_id?: string } | undefined;
      const roll_id = existing?.roll_id ?? create_id('roll');

      if (!existing) {
        await db.run(
          `INSERT INTO roll (
            roll_id,
            project_id,
            shoot_day_id,
            slate_id,
            card_id,
            roll_name,
            last_clip_name,
            notes,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, NULL, ?, NULL, NULL, ?, ?)`,
          [roll_id, project_id, shoot_day_id, slate_id, roll_name, now, now],
        );
      }

      await db.run(
        `UPDATE take
         SET roll_id = ?
         WHERE roll_id IS NULL
           AND roll IS NOT NULL
           AND TRIM(roll) = ?
           AND slate_id = ?`,
        [roll_id, roll_name, slate_id],
      );
    }

    await this.save_if_web();
  }

  private async find_or_create_media_card(card_label: string | null | undefined, now: string): Promise<string | null> {
    const label = card_label?.trim();
    if (!label) {
      return null;
    }

    const existing = await this.query_one<MediaCard>(
      `SELECT *
       FROM media_card
       WHERE label = ? COLLATE NOCASE
       LIMIT 1`,
      [label],
    );

    if (existing) {
      return existing.card_id;
    }

    const card_id = create_id('card');
    await this.run(
      `INSERT INTO media_card (
        card_id,
        label,
        media_type,
        active,
        created_at,
        updated_at
      ) VALUES (?, ?, 'SxS', 1, ?, ?)`,
      [card_id, label, now, now],
    );
    return card_id;
  }

  private async search_projects(like: string): Promise<SearchResult[]> {
    return this.query<SearchResult>(`
      SELECT
        'project' AS result_type,
        p.name AS title,
        NULLIF(TRIM(COALESCE(p.director, '') || ' ' || COALESCE(p.dop, '') || ' ' || COALESCE(p.camera_op, '')), '') AS subtitle,
        NULL AS context,
        NULLIF(TRIM(COALESCE(p.director, '') || ' ' || COALESCE(p.dop, '') || ' ' || COALESCE(p.camera_op, '')), '') AS matched_text,
        p.project_id,
        NULL AS shoot_day_id,
        NULL AS slate_id,
        NULL AS slate_scene_id,
        NULL AS take_id,
        NULL AS flag_ids,
        NULL AS flags
      FROM project p
      WHERE
        p.name LIKE ? ESCAPE '\\'
        OR p.director LIKE ? ESCAPE '\\'
        OR p.dop LIKE ? ESCAPE '\\'
        OR p.camera_op LIKE ? ESCAPE '\\'
      ORDER BY p.updated_at DESC, p.name COLLATE NOCASE ASC
      LIMIT 25
    `, [like, like, like, like]);
  }

  private async search_shoot_days(like: string): Promise<SearchResult[]> {
    return this.query<SearchResult>(`
      SELECT
        'shoot_day' AS result_type,
        sd.date AS title,
        sd.location AS subtitle,
        p.name AS context,
        sd.location AS matched_text,
        p.project_id,
        sd.shoot_day_id,
        NULL AS slate_id,
        NULL AS slate_scene_id,
        NULL AS take_id,
        NULL AS flag_ids,
        NULL AS flags
      FROM shoot_day sd
      JOIN project p ON p.project_id = sd.project_id
      WHERE
        sd.date LIKE ? ESCAPE '\\'
        OR sd.location LIKE ? ESCAPE '\\'
      ORDER BY sd.date DESC, sd.created_at DESC
      LIMIT 25
    `, [like, like]);
  }

  private async search_slates(like: string): Promise<SearchResult[]> {
    return this.query<SearchResult>(`
      SELECT
        'slate' AS result_type,
        s.camera AS title,
        sd.date AS subtitle,
        p.name AS context,
        s.camera AS matched_text,
        p.project_id,
        sd.shoot_day_id,
        s.slate_id,
        NULL AS slate_scene_id,
        NULL AS take_id,
        NULL AS flag_ids,
        NULL AS flags
      FROM slate s
      JOIN shoot_day sd ON sd.shoot_day_id = s.shoot_day_id
      JOIN project p ON p.project_id = sd.project_id
      WHERE s.camera LIKE ? ESCAPE '\\'
      ORDER BY sd.date DESC, s.camera COLLATE NOCASE ASC
      LIMIT 25
    `, [like]);
  }

  private async search_scenes(like: string): Promise<SearchResult[]> {
    return this.query<SearchResult>(`
      SELECT
        'scene' AS result_type,
        sc.scene_name AS title,
        NULLIF(TRIM(COALESCE(sc.location, '') || ' ' || COALESCE(sc.time_of_day, '')), '') AS subtitle,
        p.name || ' > ' || sd.date || ' > ' || s.camera AS context,
        NULLIF(TRIM(COALESCE(sc.location, '') || ' ' || COALESCE(sc.time_of_day, '') || ' ' || COALESCE(sc.notes, '')), '') AS matched_text,
        p.project_id,
        sd.shoot_day_id,
        s.slate_id,
        ss.slate_scene_id,
        NULL AS take_id,
        NULL AS flag_ids,
        NULL AS flags
      FROM slate_scene ss
      JOIN scene sc ON sc.scene_id = ss.scene_id
      JOIN slate s ON s.slate_id = ss.slate_id
      JOIN shoot_day sd ON sd.shoot_day_id = s.shoot_day_id
      JOIN project p ON p.project_id = sd.project_id
      WHERE ss.active = 1
        AND (
          sc.scene_name LIKE ? ESCAPE '\\'
          OR sc.location LIKE ? ESCAPE '\\'
          OR sc.time_of_day LIKE ? ESCAPE '\\'
          OR sc.notes LIKE ? ESCAPE '\\'
        )
      ORDER BY sd.date DESC, ss.scene_order ASC, sc.scene_name COLLATE NOCASE ASC
      LIMIT 40
    `, [like, like, like, like]);
  }

  private async search_takes(input: {
    like: string;
    has_query: boolean;
    flag_id: string;
    match_flags_only: boolean;
  }): Promise<SearchResult[]> {
    const query_filter = input.has_query
      ? input.match_flags_only
        ? `AND f.label LIKE ? ESCAPE '\\'`
        : `AND (
          CAST(t.take_number AS TEXT) LIKE ? ESCAPE '\\'
          OR r.roll_name LIKE ? ESCAPE '\\'
          OR mc.label LIKE ? ESCAPE '\\'
          OR t.clip_name LIKE ? ESCAPE '\\'
          OR t.slate_open_timecode LIKE ? ESCAPE '\\'
          OR t.slate_close_timecode LIKE ? ESCAPE '\\'
          OR t.notes LIKE ? ESCAPE '\\'
          OR f.label LIKE ? ESCAPE '\\'
        )`
      : '';
    const flag_filter = input.flag_id
      ? `AND EXISTS (
        SELECT 1
        FROM take_flag selected_tf
        WHERE selected_tf.take_id = t.take_id
        AND selected_tf.flag_id = ?
      )`
      : '';
    const query_values = input.has_query
      ? input.match_flags_only
        ? [input.like]
        : [input.like, input.like, input.like, input.like, input.like, input.like, input.like, input.like]
      : [];
    const values = [
      ...query_values,
      ...(input.flag_id ? [input.flag_id] : []),
    ];

    return this.query<SearchResult>(`
      SELECT
        'take' AS result_type,
        CASE
          WHEN r.roll_name IS NOT NULL THEN r.roll_name || ' / Take ' || t.take_number
          ELSE 'Take ' || t.take_number
        END AS title,
        NULLIF(TRIM(COALESCE(t.slate_close_timecode, '') || ' ' || COALESCE(GROUP_CONCAT(DISTINCT f.label), '')), '') AS subtitle,
        p.name || ' > ' || sd.date || ' > ' || s.camera || ' > ' || sc.scene_name AS context,
        NULLIF(TRIM(COALESCE(r.roll_name, '') || ' ' || COALESCE(mc.label, '') || ' ' || COALESCE(t.clip_name, '') || ' ' || COALESCE(t.notes, '')), '') AS matched_text,
        p.project_id,
        sd.shoot_day_id,
        s.slate_id,
        ss.slate_scene_id,
        t.take_id,
        GROUP_CONCAT(DISTINCT f.flag_id) AS flag_ids,
        GROUP_CONCAT(DISTINCT f.label) AS flags
      FROM take t
      LEFT JOIN roll r ON r.roll_id = t.roll_id
      LEFT JOIN media_card mc ON mc.card_id = r.card_id
      JOIN slate_scene ss ON ss.slate_scene_id = t.slate_scene_id
      JOIN scene sc ON sc.scene_id = ss.scene_id
      JOIN slate s ON s.slate_id = t.slate_id
      JOIN shoot_day sd ON sd.shoot_day_id = t.shoot_day_id
      JOIN project p ON p.project_id = sd.project_id
      LEFT JOIN take_flag tf ON tf.take_id = t.take_id
      LEFT JOIN flag f ON f.flag_id = tf.flag_id
      WHERE 1 = 1
        ${query_filter}
        ${flag_filter}
      GROUP BY t.take_id
      ORDER BY sd.date DESC, t.take_number DESC
      LIMIT 60
    `, values);
  }

  private async next_scene_order(slate_id: string): Promise<number> {
    const row = await this.query_one<{ next_order: number }>(
      `SELECT COALESCE(MAX(scene_order), 0) + 1 AS next_order
       FROM slate_scene
       WHERE slate_id = ?`,
      [slate_id],
    );
    return row?.next_order ?? 1;
  }

  private async query<T>(statement: string, values: unknown[] = []): Promise<T[]> {
    const db = await this.init();
    const result = await db.query(statement, values);
    return (result.values ?? []) as T[];
  }

  private async query_one<T>(statement: string, values: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(statement, values);
    return rows[0] ?? null;
  }

  private async run(statement: string, values: unknown[] = []): Promise<void> {
    const db = await this.init();
    await db.run(statement, values);
    await this.save_if_web();
  }

  private async save_if_web(): Promise<void> {
    return;
  }
}

const timestamp = (): string => new Date().toISOString();

const empty_to_null = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const normalize_setup_suffix = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim().toUpperCase();
  return trimmed && /^[A-Z]$/.test(trimmed) ? trimmed : null;
};

const increment_clip_name = (clip_name: string): string => {
  const match = clip_name.match(/^(.*?)(\d+)(\D*)$/);
  if (!match) {
    return clip_name ? `${clip_name}_0001` : '';
  }

  const prefix = match[1];
  const number_text = match[2];
  const suffix = match[3];
  const next_number = String(Number(number_text) + 1).padStart(number_text.length, '0');
  return `${prefix}${next_number}${suffix}`;
};

const escape_like = (value: string): string => value.replace(/[\\%_]/g, (match) => `\\${match}`);

const create_id = (prefix: string): string => {
  const random_id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random_id}`;
};
