export const database_schema_version = 2;

export const default_flags = [
  { flag_id: 'good', label: 'Good', color: '#1f9d55', sort_order: 10 },
  { flag_id: 'bad', label: 'Bad', color: '#d64545', sort_order: 20 },
  { flag_id: 'circle', label: 'Circle', color: '#2563eb', sort_order: 30 },
  { flag_id: 'false_start', label: 'False start', color: '#d97706', sort_order: 40 },
  { flag_id: 'boom_visible', label: 'Boom visible', color: '#7c3aed', sort_order: 50 },
  { flag_id: 'focus_issue', label: 'Focus issue', color: '#be185d', sort_order: 60 },
  { flag_id: 'sound_issue', label: 'Sound issue', color: '#0f766e', sort_order: 70 },
] as const;

export const create_schema_sql = [
  `CREATE TABLE IF NOT EXISTS project (
    project_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    director TEXT,
    dop TEXT,
    camera_op TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS shoot_day (
    shoot_day_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    date TEXT NOT NULL,
    location TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES project(project_id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS slate (
    slate_id TEXT PRIMARY KEY,
    shoot_day_id TEXT NOT NULL,
    camera TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (shoot_day_id) REFERENCES shoot_day(shoot_day_id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS scene (
    scene_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    scene_name TEXT NOT NULL,
    location TEXT,
    time_of_day TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES project(project_id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS slate_scene (
    slate_scene_id TEXT PRIMARY KEY,
    slate_id TEXT NOT NULL,
    scene_id TEXT NOT NULL,
    scene_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (slate_id) REFERENCES slate(slate_id) ON DELETE CASCADE,
    FOREIGN KEY (scene_id) REFERENCES scene(scene_id) ON DELETE CASCADE,
    UNIQUE (slate_id, scene_id)
  )`,

  `CREATE TABLE IF NOT EXISTS take (
    take_id TEXT PRIMARY KEY,
    shoot_day_id TEXT NOT NULL,
    slate_id TEXT NOT NULL,
    slate_scene_id TEXT NOT NULL,
    take_number INTEGER NOT NULL,
    slate_open_timecode TEXT,
    slate_close_timecode TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (shoot_day_id) REFERENCES shoot_day(shoot_day_id) ON DELETE CASCADE,
    FOREIGN KEY (slate_id) REFERENCES slate(slate_id) ON DELETE CASCADE,
    FOREIGN KEY (slate_scene_id) REFERENCES slate_scene(slate_scene_id) ON DELETE CASCADE,
    UNIQUE (shoot_day_id, slate_id, slate_scene_id, take_number)
  )`,

  `CREATE TABLE IF NOT EXISTS flag (
    flag_id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    color TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    system_flag INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS take_flag (
    take_id TEXT NOT NULL,
    flag_id TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (take_id, flag_id),
    FOREIGN KEY (take_id) REFERENCES take(take_id) ON DELETE CASCADE,
    FOREIGN KEY (flag_id) REFERENCES flag(flag_id) ON DELETE RESTRICT
  )`,

  `CREATE INDEX IF NOT EXISTS idx_shoot_day_project_id
    ON shoot_day(project_id)`,

  `CREATE INDEX IF NOT EXISTS idx_slate_shoot_day_id
    ON slate(shoot_day_id)`,

  `CREATE INDEX IF NOT EXISTS idx_scene_project_id
    ON scene(project_id)`,

  `CREATE INDEX IF NOT EXISTS idx_slate_scene_slate_id
    ON slate_scene(slate_id)`,

  `CREATE INDEX IF NOT EXISTS idx_slate_scene_scene_id
    ON slate_scene(scene_id)`,

  `CREATE INDEX IF NOT EXISTS idx_take_slate_scene_id
    ON take(slate_scene_id)`,

  `CREATE INDEX IF NOT EXISTS idx_take_flag_flag_id
    ON take_flag(flag_id)`,
] as const;

export const build_seed_default_flags_sql = (created_at: string) => {
  return default_flags.map((flag) => ({
    statement: `INSERT INTO flag (
      flag_id,
      label,
      color,
      sort_order,
      system_flag,
      active,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, 1, 1, ?, ?)
    ON CONFLICT(flag_id) DO UPDATE SET
      label = excluded.label,
      color = excluded.color,
      sort_order = excluded.sort_order,
      system_flag = excluded.system_flag,
      updated_at = excluded.updated_at`,
    values: [
      flag.flag_id,
      flag.label,
      flag.color,
      flag.sort_order,
      created_at,
      created_at,
    ],
  }));
};
