-- Digital Slate Resolve Helper
--
-- Lua port of digital_slate_resolve_helper.py so the script can run from
-- Resolve's Workspace > Scripts menu without requiring a separate Python install.
--
-- Install location on macOS, per-user:
-- ~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility/

-- -----------------------------------------------------------------------------
-- USER CONFIG - first prototype
-- -----------------------------------------------------------------------------

local JSON_PATH_DEFAULT = "/path/to/test-all-days-resolve-export.json"

-- Leave blank to scan all Media Pool folders.
local VIDEO_BIN_PATH_DEFAULT = ""
local AUDIO_BIN_PATH_DEFAULT = ""
local OUTPUT_ROOT_BIN_PATH_DEFAULT = "Digital Slate Synced"

local DRY_RUN = false
local APPLY_METADATA = true
local APPLY_MARKERS = true
local APPLY_TRIM_MARKS = true
local APPLY_CLIP_DISPLAY_NAMES = true
local CREATE_SCENE_BINS = true
local CREATE_SYNCED_OR_MULTICAM_CLIPS = true
local MOVE_SYNCED_VIDEO_TO_SCENE_BIN = true

-- Verify that matched source clips contain the slate timecode.
-- This is deliberately warning-only: filename matching still finds candidates,
-- but timecode mismatches are called out before anything destructive happens.
local VERIFY_SOURCE_TIMECODE = true
local TIMECODE_TOLERANCE_FRAMES = 0
local REPORT_TIMECODE_OK = true

local DEFAULT_FPS = 25

local MARKER_COLOURS = {
  ["Slate Open"] = "Blue",
  ["Slate Close"] = "Green",
  ["Slate Close / Trim In"] = "Green",
  ["End Slate"] = "Red",
}

local METADATA_MAP = {
  scene = "Scene",
  take = "Take",
  camera = "Camera #",
  reel = "Reel Name",
  shoot_date = "Date Recorded",
  location = "Location",
}

-- -----------------------------------------------------------------------------
-- Small JSON decoder
-- -----------------------------------------------------------------------------

local json = {}

local function json_error(text, pos, message)
  error(string.format("JSON parse error at byte %d: %s", pos, message), 0)
end

local function json_skip_ws(text, pos)
  while true do
    local ch = text:sub(pos, pos)
    if ch == " " or ch == "\t" or ch == "\r" or ch == "\n" then
      pos = pos + 1
    else
      return pos
    end
  end
end

local function json_parse_string(text, pos)
  if text:sub(pos, pos) ~= '"' then
    json_error(text, pos, "expected string")
  end
  pos = pos + 1
  local out = {}
  while pos <= #text do
    local ch = text:sub(pos, pos)
    if ch == '"' then
      return table.concat(out), pos + 1
    elseif ch == "\\" then
      local esc = text:sub(pos + 1, pos + 1)
      if esc == '"' or esc == "\\" or esc == "/" then
        out[#out + 1] = esc
        pos = pos + 2
      elseif esc == "b" then
        out[#out + 1] = "\b"
        pos = pos + 2
      elseif esc == "f" then
        out[#out + 1] = "\f"
        pos = pos + 2
      elseif esc == "n" then
        out[#out + 1] = "\n"
        pos = pos + 2
      elseif esc == "r" then
        out[#out + 1] = "\r"
        pos = pos + 2
      elseif esc == "t" then
        out[#out + 1] = "\t"
        pos = pos + 2
      elseif esc == "u" then
        -- Slate exports are expected to be plain UTF-8. Preserve non-ASCII
        -- escapes as a readable placeholder rather than failing the whole import.
        local hex = text:sub(pos + 2, pos + 5)
        if not hex:match("^%x%x%x%x$") then
          json_error(text, pos, "invalid unicode escape")
        end
        out[#out + 1] = "?"
        pos = pos + 6
      else
        json_error(text, pos, "invalid escape")
      end
    else
      out[#out + 1] = ch
      pos = pos + 1
    end
  end
  json_error(text, pos, "unterminated string")
end

local function json_parse_number(text, pos)
  local start_pos = pos
  local ch = text:sub(pos, pos)
  if ch == "-" then
    pos = pos + 1
  end
  while text:sub(pos, pos):match("%d") do
    pos = pos + 1
  end
  if text:sub(pos, pos) == "." then
    pos = pos + 1
    while text:sub(pos, pos):match("%d") do
      pos = pos + 1
    end
  end
  ch = text:sub(pos, pos)
  if ch == "e" or ch == "E" then
    pos = pos + 1
    ch = text:sub(pos, pos)
    if ch == "+" or ch == "-" then
      pos = pos + 1
    end
    while text:sub(pos, pos):match("%d") do
      pos = pos + 1
    end
  end
  local value = tonumber(text:sub(start_pos, pos - 1))
  if value == nil then
    json_error(text, start_pos, "invalid number")
  end
  return value, pos
end

local json_parse_value

local function json_parse_array(text, pos)
  local arr = {}
  pos = json_skip_ws(text, pos + 1)
  if text:sub(pos, pos) == "]" then
    return arr, pos + 1
  end
  while true do
    local value
    value, pos = json_parse_value(text, pos)
    arr[#arr + 1] = value
    pos = json_skip_ws(text, pos)
    local ch = text:sub(pos, pos)
    if ch == "]" then
      return arr, pos + 1
    elseif ch == "," then
      pos = json_skip_ws(text, pos + 1)
    else
      json_error(text, pos, "expected ',' or ']'")
    end
  end
end

local function json_parse_object(text, pos)
  local obj = {}
  pos = json_skip_ws(text, pos + 1)
  if text:sub(pos, pos) == "}" then
    return obj, pos + 1
  end
  while true do
    local key
    key, pos = json_parse_string(text, pos)
    pos = json_skip_ws(text, pos)
    if text:sub(pos, pos) ~= ":" then
      json_error(text, pos, "expected ':'")
    end
    local value
    value, pos = json_parse_value(text, json_skip_ws(text, pos + 1))
    obj[key] = value
    pos = json_skip_ws(text, pos)
    local ch = text:sub(pos, pos)
    if ch == "}" then
      return obj, pos + 1
    elseif ch == "," then
      pos = json_skip_ws(text, pos + 1)
    else
      json_error(text, pos, "expected ',' or '}'")
    end
  end
end

function json_parse_value(text, pos)
  pos = json_skip_ws(text, pos)
  local ch = text:sub(pos, pos)
  if ch == '"' then
    return json_parse_string(text, pos)
  elseif ch == "{" then
    return json_parse_object(text, pos)
  elseif ch == "[" then
    return json_parse_array(text, pos)
  elseif ch == "-" or ch:match("%d") then
    return json_parse_number(text, pos)
  elseif text:sub(pos, pos + 3) == "true" then
    return true, pos + 4
  elseif text:sub(pos, pos + 4) == "false" then
    return false, pos + 5
  elseif text:sub(pos, pos + 3) == "null" then
    return nil, pos + 4
  end
  json_error(text, pos, "unexpected value")
end

function json.decode(text)
  local value, pos = json_parse_value(text, 1)
  pos = json_skip_ws(text, pos)
  if pos <= #text then
    json_error(text, pos, "trailing data")
  end
  return value
end

-- -----------------------------------------------------------------------------
-- Utilities
-- -----------------------------------------------------------------------------

local function as_string(value)
  if value == nil then
    return ""
  end
  return tostring(value)
end

local function trim(value)
  return as_string(value):match("^%s*(.-)%s*$")
end

local function basename(path)
  local value = as_string(path)
  return value:match("([^/\\]+)$") or value
end

local function strip_extension(name)
  return as_string(name):gsub("%.[^%.]*$", "")
end

local function starts_with(value, prefix)
  return value:sub(1, #prefix) == prefix
end

local function table_values(t)
  local out = {}
  if type(t) ~= "table" then
    return out
  end
  for _, value in pairs(t) do
    out[#out + 1] = value
  end
  return out
end

local function get_resolve()
  local r = nil
  if type(Resolve) == "function" then
    r = Resolve()
  end
  if not r and bmd and type(bmd.scriptapp) == "function" then
    r = bmd.scriptapp("Resolve")
  end
  if not r then
    error("Could not connect to DaVinci Resolve.")
  end
  return r
end

local function get_current_project(resolve)
  local project_manager = resolve:GetProjectManager()
  if not project_manager then
    error("Could not get Resolve ProjectManager.")
  end
  local project = project_manager:GetCurrentProject()
  if not project then
    error("No current Resolve project is open.")
  end
  return project
end

local function request_json_file(resolve)
  local ok, fusion = pcall(function()
    return resolve:Fusion()
  end)
  if ok and fusion and type(fusion.RequestFile) == "function" then
    local selected = fusion:RequestFile("", "", { FReqS_Filter = "JSON files (*.json)|*.json" })
    if selected and trim(selected) ~= "" then
      return trim(selected)
    end
  end
  return JSON_PATH_DEFAULT
end

-- -----------------------------------------------------------------------------
-- Normalisation / matching
-- -----------------------------------------------------------------------------

local function normalise_scene(scene)
  local value = trim(scene):gsub("^[sS][cC]", "")
  return value:upper()
end

local function normalise_take(take)
  local value = trim(take):gsub("^[tT]", "")
  if value:match("^%d+$") then
    return string.format("%03d", tonumber(value))
  end
  return value:upper()
end

local function normalise_setup(setup)
  return trim(setup):upper()
end

local function normalise_flags(flags)
  local out = {}
  for flag in as_string(flags):gmatch("[^,|;%s]+") do
    out[#out + 1] = flag:lower()
  end
  return out
end

local function has_flag(flags, wanted)
  for _, flag in ipairs(normalise_flags(flags)) do
    if flag == wanted then
      return true
    end
  end
  return false
end

local function tc_to_frames(tc, fps)
  local h, m, s, f = trim(tc):match("^(%d%d?):(%d%d):(%d%d):(%d%d)$")
  if not h then
    return nil
  end
  return ((((tonumber(h) * 60) + tonumber(m)) * 60) + tonumber(s)) * fps + tonumber(f)
end

local function duration_to_frames(duration, fps)
  local frames = tc_to_frames(duration, fps)
  if frames ~= nil then
    return frames
  end
  local numeric = tonumber(trim(duration))
  if numeric then
    return numeric
  end
  return nil
end

local function clip_name(clip)
  local ok, value = pcall(function()
    return clip:GetName()
  end)
  if ok and value then
    return as_string(value)
  end
  return ""
end

local function clip_filename(clip)
  for _, key in ipairs({ "File Name", "Filename", "Clip Name" }) do
    local ok, value = pcall(function()
      return clip:GetClipProperty(key)
    end)
    if ok and value and as_string(value) ~= "" then
      return as_string(value)
    end
  end
  return clip_name(clip)
end

local function clip_property(clip, key)
  local ok, value = pcall(function()
    return clip:GetClipProperty(key)
  end)
  if ok and value and as_string(value) ~= "" then
    return as_string(value)
  end
  return ""
end

local function first_clip_property(clip, keys)
  for _, key in ipairs(keys) do
    local value = clip_property(clip, key)
    if value ~= "" then
      return value, key
    end
  end
  return "", ""
end

local function clip_timecode_range(clip, fps)
  local start_tc, start_key = first_clip_property(clip, {
    "Start TC",
    "Start Timecode",
    "Media Start TC",
    "Media Start",
    "In",
  })
  local end_tc, end_key = first_clip_property(clip, {
    "End TC",
    "End Timecode",
    "Media End TC",
    "Media End",
    "Out",
  })

  local start_frame = tc_to_frames(start_tc, fps)
  local end_frame = tc_to_frames(end_tc, fps)

  if start_frame and not end_frame then
    local duration_value = first_clip_property(clip, {
      "Duration",
      "Frames",
      "Frame Count",
    })
    local duration_frames = duration_to_frames(duration_value, fps)
    if duration_frames then
      end_frame = start_frame + duration_frames - 1
      end_key = "Duration"
    end
  end

  if not start_frame then
    return nil
  end

  return {
    start_frame = start_frame,
    end_frame = end_frame,
    start_tc = start_tc,
    end_tc = end_tc,
    start_key = start_key,
    end_key = end_key,
  }
end

local function clip_contains_tc(clip, tc, fps)
  local target_frame = tc_to_frames(tc, fps)
  if not target_frame then
    return nil, "invalid slate timecode " .. as_string(tc)
  end

  local range = clip_timecode_range(clip, fps)
  if not range then
    return nil, "could not read source start timecode"
  end

  local start_frame = range.start_frame - TIMECODE_TOLERANCE_FRAMES
  local end_frame = range.end_frame and (range.end_frame + TIMECODE_TOLERANCE_FRAMES) or nil
  if target_frame < start_frame then
    return false, string.format(
      "%s is before clip start %s",
      tc,
      range.start_tc
    )
  end
  if end_frame and target_frame > end_frame then
    return false, string.format(
      "%s is after clip end %s",
      tc,
      range.end_tc ~= "" and range.end_tc or ("derived from " .. range.end_key)
    )
  end
  return true, string.format(
    "%s is inside source range starting %s%s",
    tc,
    range.start_tc,
    range.end_tc ~= "" and (" ending " .. range.end_tc) or ""
  )
end

local function clip_matches_source_clip(clip, source_clip)
  local source = trim(source_clip):lower()
  if source == "" then
    return false
  end
  for _, candidate in ipairs({ clip_name(clip), clip_filename(clip) }) do
    local base = strip_extension(basename(candidate)):lower()
    if source == base or base:find(source, 1, true) then
      return true
    end
  end
  return false
end

local function audio_matches_take(filename, scene, setup, take)
  local scene_norm = normalise_scene(scene) .. normalise_setup(setup)
  local take_norm = normalise_take(take)
  local name = strip_extension(basename(filename)):upper()

  local scene_num = scene_norm:match("^(%d+)")
  local scene_suffix = scene_norm:match("^%d+([A-Z]*)$") or ""
  local take_num = take_norm:match("^(%d+)$")

  if not scene_num or not take_num then
    return false
  end

  local pattern = "^SC0*" .. tostring(tonumber(scene_num))
  if scene_suffix ~= "" then
    pattern = pattern .. scene_suffix
  end
  pattern = pattern .. "[-_ ]?T0*" .. tostring(tonumber(take_num)) .. "([%._%- ]?.*)$"
  return name:match(pattern) ~= nil
end

-- -----------------------------------------------------------------------------
-- Slate takes
-- -----------------------------------------------------------------------------

local function slate_take_from_row(row, index)
  row = row or {}
  return {
    raw = row,
    index = index,
    project = as_string(row.project),
    shoot_date = as_string(row.shoot_date),
    location = as_string(row.location),
    camera = as_string(row.camera),
    scene = as_string(row.scene),
    setup = as_string(row.setup),
    take = as_string(row.take),
    reel = as_string(row.reel),
    card = as_string(row.card),
    source_clip = as_string(row.source_clip),
    suggested_clip_name = as_string(row.suggested_clip_name),
    slate_open_tc = as_string(row.slate_open_tc),
    slate_close_tc = as_string(row.slate_close_tc),
    trim_in_tc = as_string(row.trim_in_tc),
    open_marker = as_string(row.open_marker),
    close_marker = as_string(row.close_marker),
    flags = as_string(row.flags),
    notes = as_string(row.notes),
    fps = tonumber(row.fps) or DEFAULT_FPS,
  }
end

local function group_key(take)
  return normalise_scene(take.scene) .. "\t" .. normalise_setup(take.setup) .. "\t" .. normalise_take(take.take)
end

local function load_slate_json(path)
  local handle = io.open(path, "rb")
  if not handle then
    error("Could not open JSON file: " .. path)
  end
  local text = handle:read("*a")
  handle:close()

  local payload = json.decode(text)
  if type(payload) ~= "table" then
    error("Slate JSON must be a top-level object.")
  end
  if payload.format ~= "digital-slate-resolve-prep-v1" then
    print("WARNING: unexpected JSON format value: " .. as_string(payload.format))
  end
  if type(payload.takes) ~= "table" then
    error("Slate JSON must contain a takes array.")
  end

  local takes = {}
  for index, row in ipairs(payload.takes) do
    takes[#takes + 1] = slate_take_from_row(row, index)
  end
  return takes
end

-- -----------------------------------------------------------------------------
-- Media Pool traversal
-- -----------------------------------------------------------------------------

local function get_subfolders(folder)
  local ok, value = pcall(function()
    return folder:GetSubFolderList()
  end)
  if ok and type(value) == "table" then
    return table_values(value)
  end
  ok, value = pcall(function()
    return folder:GetSubFolders()
  end)
  if ok and type(value) == "table" then
    return table_values(value)
  end
  return {}
end

local function get_clips(folder)
  local ok, value = pcall(function()
    return folder:GetClipList()
  end)
  if ok and type(value) == "table" then
    return table_values(value)
  end
  ok, value = pcall(function()
    return folder:GetClips()
  end)
  if ok and type(value) == "table" then
    return table_values(value)
  end
  return {}
end

local function walk_folders(folder, path, rows)
  path = path or ""
  rows = rows or {}
  rows[#rows + 1] = { path = path, folder = folder }
  for _, sub in ipairs(get_subfolders(folder)) do
    local name = clip_name(sub)
    if name == "" then
      local ok, value = pcall(function()
        return sub:GetName()
      end)
      name = ok and as_string(value) or "Unnamed"
    end
    local sub_path = path == "" and name or (path .. "/" .. name)
    walk_folders(sub, sub_path, rows)
  end
  return rows
end

local function find_folder_by_path(root_folder, wanted_path)
  if trim(wanted_path) == "" then
    return root_folder
  end
  local wanted = trim(wanted_path):gsub("^/+", ""):gsub("/+$", ""):lower()
  for _, row in ipairs(walk_folders(root_folder)) do
    local path = row.path:gsub("^/+", ""):gsub("/+$", ""):lower()
    if path == wanted then
      return row.folder
    end
  end
  return nil
end

local function get_clips_in_folder_tree(folder)
  local clips = {}
  for _, row in ipairs(walk_folders(folder)) do
    for _, clip in ipairs(get_clips(row.folder)) do
      clips[#clips + 1] = clip
    end
  end
  return clips
end

local function ensure_child_folder(media_pool, parent_folder, name)
  for _, sub in ipairs(get_subfolders(parent_folder)) do
    local ok, sub_name = pcall(function()
      return sub:GetName()
    end)
    if ok and sub_name == name then
      return sub
    end
  end

  if DRY_RUN then
    print("DRY RUN: would create bin: " .. name)
    return parent_folder
  end

  local folder = media_pool:AddSubFolder(parent_folder, name)
  if not folder then
    error("Could not create Media Pool bin: " .. name)
  end
  return folder
end

local function ensure_bin_path(media_pool, root_folder, bin_path)
  local current = root_folder
  for part in trim(bin_path):gmatch("[^/]+") do
    current = ensure_child_folder(media_pool, current, part)
  end
  return current
end

-- -----------------------------------------------------------------------------
-- Resolve operations
-- -----------------------------------------------------------------------------

local function safe_set_metadata(clip, key, value, log_prefix)
  if trim(value) == "" then
    return true
  end
  if DRY_RUN then
    print(string.format("DRY RUN: %sSetMetadata(%q, %q)", log_prefix or "", key, value))
    return true
  end
  local ok, result = pcall(function()
    return clip:SetMetadata(key, value)
  end)
  if not ok or not result then
    print("WARNING: metadata not set: " .. key .. "=" .. value)
    return false
  end
  return true
end

local function apply_metadata(clip, take)
  for json_key, metadata_key in pairs(METADATA_MAP) do
    safe_set_metadata(clip, metadata_key, as_string(take.raw[json_key]), take.suggested_clip_name .. ": ")
  end

  local comments = {}
  if trim(take.notes) ~= "" then
    comments[#comments + 1] = trim(take.notes)
  end
  if trim(take.card) ~= "" then
    comments[#comments + 1] = "Card: " .. trim(take.card)
  end
  if #comments > 0 then
    safe_set_metadata(clip, "Comments", table.concat(comments, "\n"), take.suggested_clip_name .. ": ")
  end
end

local function clip_relative_frame_for_tc(clip, tc, fps)
  local target_frame = tc_to_frames(tc, fps)
  if target_frame == nil then
    return nil, "invalid timecode " .. as_string(tc)
  end

  local range = clip_timecode_range(clip, fps)
  if not range then
    return nil, "could not read source start timecode"
  end

  local frame_id = target_frame - range.start_frame
  if frame_id < 0 then
    return nil, string.format("%s is before clip start %s", tc, range.start_tc)
  end
  if range.end_frame and target_frame > range.end_frame then
    return nil, string.format("%s is after clip end %s", tc, range.end_tc)
  end

  return frame_id, nil
end

local function add_marker_at_tc(clip, tc, fps, name, note)
  local frame_id, err = clip_relative_frame_for_tc(clip, tc, fps)
  if frame_id == nil then
    print("WARNING: failed to calculate marker position for " .. name .. " at " .. tc .. ": " .. err)
    return false
  end
  local colour = MARKER_COLOURS[name] or "Blue"
  if DRY_RUN then
    print(string.format("DRY RUN: AddMarker clip-frame=%d, colour=%s, name=%q, note=%q", frame_id, colour, name, note or ""))
    return true
  end
  local markers_ok, markers = pcall(function()
    return clip:GetMarkers()
  end)
  if markers_ok and type(markers) == "table" then
    for marker_frame, marker in pairs(markers) do
      if tonumber(marker_frame) == frame_id and type(marker) == "table" and marker.name == name then
        print(string.format("MARKER EXISTS: %s at %s (clip-frame=%d)", name, tc, frame_id))
        return true
      end
    end
  end
  local custom_data = "digital-slate:" .. name .. ":" .. tc
  pcall(function()
    clip:DeleteMarkerByCustomData(custom_data)
  end)
  local ok, result = pcall(function()
    return clip:AddMarker(frame_id, colour, name, note or "", 1, custom_data)
  end)
  if not ok or not result then
    local detail = ok and ("returned " .. as_string(result)) or as_string(result)
    print(string.format(
      "WARNING: failed to add marker %s at %s (clip-frame=%d, colour=%s): %s",
      name,
      tc,
      frame_id,
      colour,
      detail
    ))
    return false
  end
  print(string.format("MARKER OK: added %s at %s (clip-frame=%d)", name, tc, frame_id))
  return true
end

local function apply_markers(clip, take)
  if take.slate_open_tc ~= "" and take.open_marker ~= "" then
    add_marker_at_tc(clip, take.slate_open_tc, take.fps, take.open_marker, take.notes)
  end
  if take.slate_close_tc ~= "" and take.close_marker ~= "" then
    add_marker_at_tc(clip, take.slate_close_tc, take.fps, take.close_marker, take.notes)
  end
end

local function apply_trim_marks(clip, take)
  if not APPLY_TRIM_MARKS then
    return
  end
  if trim(take.trim_in_tc) == "" then
    return
  end
  if has_flag(take.flags, "end_slate") then
    print("TRIM SKIPPED: " .. (take.suggested_clip_name ~= "" and take.suggested_clip_name or take.source_clip) .. ": end_slate flag present")
    return
  end

  local mark_in, err = clip_relative_frame_for_tc(clip, take.trim_in_tc, take.fps)
  if mark_in == nil then
    print("WARNING: failed to calculate trim mark-in for " .. (take.suggested_clip_name ~= "" and take.suggested_clip_name or take.source_clip) .. ": " .. err)
    return
  end

  local range = clip_timecode_range(clip, take.fps)
  if not range or not range.end_frame then
    print("WARNING: failed to calculate trim mark-out for " .. (take.suggested_clip_name ~= "" and take.suggested_clip_name or take.source_clip) .. ": could not read clip end")
    return
  end

  local mark_out = range.end_frame - range.start_frame
  if mark_out < mark_in then
    print("WARNING: trim mark-out is before mark-in for " .. (take.suggested_clip_name ~= "" and take.suggested_clip_name or take.source_clip))
    return
  end

  if DRY_RUN then
    print(string.format("DRY RUN: SetMarkInOut(in=%d, out=%d, all) for %s", mark_in, mark_out, take.suggested_clip_name))
    return
  end

  local ok, result = pcall(function()
    return clip:SetMarkInOut(mark_in, mark_out, "all")
  end)
  if ok and result then
    print(string.format("TRIM OK: %s marked in at %s (clip-frame=%d), out at clip-frame=%d", take.suggested_clip_name, take.trim_in_tc, mark_in, mark_out))
    return
  end

  local detail = ok and ("returned " .. as_string(result)) or as_string(result)
  print("WARNING: failed to set trim marks for " .. (take.suggested_clip_name ~= "" and take.suggested_clip_name or take.source_clip) .. ": " .. detail)
end

local function apply_display_name(clip, take)
  if take.suggested_clip_name == "" then
    return
  end
  if DRY_RUN then
    print("DRY RUN: would set Resolve clip display name to " .. take.suggested_clip_name)
    return
  end
  local ok, result = pcall(function()
    return clip:SetClipProperty("Clip Name", take.suggested_clip_name)
  end)
  if not ok or not result then
    print("WARNING: could not set clip display name for " .. clip_name(clip))
  end
end

local function add_clips_to_folder(media_pool, clips, folder)
  if #clips == 0 then
    return false
  end
  local folder_name = clip_name(folder)
  if DRY_RUN then
    print(string.format("DRY RUN: would add %d clip(s) to folder %s", #clips, folder_name))
    return true
  end
  local ok, result = pcall(function()
    return media_pool:AddItemListToFolder(clips, folder)
  end)
  return ok and result
end

local function move_clips_to_folder(media_pool, clips, folder, label)
  if #clips == 0 then
    return false
  end
  local folder_name = clip_name(folder)
  if DRY_RUN then
    print(string.format("DRY RUN: would move %d clip(s) to folder %s", #clips, folder_name))
    return true
  end
  local ok, result = pcall(function()
    return media_pool:MoveClips(clips, folder)
  end)
  if ok and result then
    print(string.format("MOVED: %s: %d clip(s) moved to %s", label or "clips", #clips, folder_name))
    return true
  end
  local detail = ok and ("returned " .. as_string(result)) or as_string(result)
  print(string.format("WARNING: %s: failed to move %d clip(s) to %s: %s", label or "clips", #clips, folder_name, detail))
  return false
end

local function autosync_audio_by_timecode(resolve, media_pool, output_folder, group_name, clips)
  local previous_folder = nil
  pcall(function()
    previous_folder = media_pool:GetCurrentFolder()
  end)

  local folder_call_ok, folder_result = pcall(function()
    return media_pool:SetCurrentFolder(output_folder)
  end)
  if not folder_call_ok or not folder_result then
    print("WARNING: " .. group_name .. ": could not set output bin as current Media Pool folder before AutoSyncAudio.")
  end

  local settings = {}
  if resolve and resolve.AUDIO_SYNC_MODE and resolve.AUDIO_SYNC_TIMECODE then
    settings[resolve.AUDIO_SYNC_MODE] = resolve.AUDIO_SYNC_TIMECODE
  end
  if resolve and resolve.AUDIO_SYNC_RETAIN_EMBEDDED_AUDIO ~= nil then
    settings[resolve.AUDIO_SYNC_RETAIN_EMBEDDED_AUDIO] = false
  end
  if resolve and resolve.AUDIO_SYNC_RETAIN_VIDEO_METADATA ~= nil then
    settings[resolve.AUDIO_SYNC_RETAIN_VIDEO_METADATA] = true
  end

  local ok, result = pcall(function()
    return media_pool:AutoSyncAudio(clips, settings)
  end)

  if previous_folder then
    pcall(function()
      media_pool:SetCurrentFolder(previous_folder)
    end)
  end

  if ok and result then
    print("SUCCESS: " .. group_name .. ": AutoSyncAudio by source timecode completed. Resolve applies this to the source Media Pool item; it may not create a separate visible synced clip.")
    return true
  end

  local detail = ok and "returned false" or as_string(result)
  print("WARNING: " .. group_name .. ": AutoSyncAudio by source timecode failed: " .. detail)
  return false
end

local function create_multicam_or_synced_clip(resolve, media_pool, output_folder, group_name, video_clips, audio_clips)
  local angle_count = #video_clips
  local audio_count = #audio_clips

  if angle_count == 0 then
    print("ERROR: " .. group_name .. ": no video clips found; cannot sync.")
    return
  end

  if angle_count == 1 then
    print(string.format("SYNC JOB: %s: single-camera synced clip: 1 video + %d audio", group_name, audio_count))
  else
    print(string.format("SYNC JOB: %s: multicam clip: %d video angles + %d audio", group_name, angle_count, audio_count))
  end

  if DRY_RUN then
    print("DRY RUN: would create output item in scene bin: " .. group_name)
    return
  end

  if not CREATE_SYNCED_OR_MULTICAM_CLIPS then
    print("SYNC CREATION DISABLED: reviewed sync job only; no synced/multicam clip created for " .. group_name)
    return
  end

  if audio_count == 0 then
    print("WARNING: " .. group_name .. ": no audio clips available; cannot AutoSyncAudio.")
    add_clips_to_folder(media_pool, video_clips, output_folder)
    return
  end

  local clips_to_sync = {}
  for _, clip in ipairs(video_clips) do
    clips_to_sync[#clips_to_sync + 1] = clip
  end
  for _, clip in ipairs(audio_clips) do
    clips_to_sync[#clips_to_sync + 1] = clip
  end

  if autosync_audio_by_timecode(resolve, media_pool, output_folder, group_name, clips_to_sync) then
    if MOVE_SYNCED_VIDEO_TO_SCENE_BIN then
      move_clips_to_folder(media_pool, video_clips, output_folder, group_name)
    end
  else
    print("WARNING: " .. group_name .. ": leaving matched source clips grouped in scene bin for manual sync.")
    add_clips_to_folder(media_pool, clips_to_sync, output_folder)
  end
end

-- -----------------------------------------------------------------------------
-- Main import logic
-- -----------------------------------------------------------------------------

local function index_video_clips(video_clips, slate_takes)
  local matches = {}
  for _, take in ipairs(slate_takes) do
    local match = { slate_take = take, video_clip = nil, audio_clips = {}, errors = {}, warnings = {} }
    local candidates = {}
    for _, clip in ipairs(video_clips) do
      if clip_matches_source_clip(clip, take.source_clip) then
        candidates[#candidates + 1] = clip
      end
    end
    if #candidates == 1 then
      match.video_clip = candidates[1]
    elseif #candidates == 0 then
      match.errors[#match.errors + 1] = "No video clip matched source_clip=" .. take.source_clip
    else
      local names = {}
      for _, candidate in ipairs(candidates) do
        names[#names + 1] = clip_name(candidate)
      end
      match.errors[#match.errors + 1] = "Multiple video clips matched source_clip=" .. take.source_clip .. ": " .. table.concat(names, ", ")
    end
    matches[take.index] = match
  end
  return matches
end

local function attach_audio_matches(matches, audio_clips)
  for _, match in pairs(matches) do
    for _, clip in ipairs(audio_clips) do
      local name = clip_filename(clip)
      if audio_matches_take(name, match.slate_take.scene, match.slate_take.setup, match.slate_take.take) then
        match.audio_clips[#match.audio_clips + 1] = clip
      end
    end
    if #match.audio_clips == 0 then
      match.warnings[#match.warnings + 1] =
        "No Zoom audio matched scene=" .. match.slate_take.scene .. ", setup=" .. match.slate_take.setup .. ", take=" .. match.slate_take.take
    end
  end
end

local function verify_clip_timecode(match, clip, role)
  if not VERIFY_SOURCE_TIMECODE or not clip then
    return
  end

  local checks = {
    { label = match.slate_take.close_marker ~= "" and match.slate_take.close_marker or "Slate Close", tc = match.slate_take.slate_close_tc },
  }

  for _, check in ipairs(checks) do
    if check.tc and check.tc ~= "" then
      local ok, message = clip_contains_tc(clip, check.tc, match.slate_take.fps)
      local clip_label = role .. " " .. clip_filename(clip)
      if ok == false then
        match.warnings[#match.warnings + 1] = clip_label .. " timecode mismatch: " .. message
      elseif ok == nil then
        match.warnings[#match.warnings + 1] = clip_label .. " timecode not verified: " .. message
      elseif REPORT_TIMECODE_OK then
        print("TIMECODE OK: " .. (match.slate_take.suggested_clip_name ~= "" and match.slate_take.suggested_clip_name or match.slate_take.source_clip) .. ": " .. clip_label .. " contains " .. check.label .. " at " .. check.tc)
      end
    end
  end
end

local function verify_matched_timecodes(matches)
  if not VERIFY_SOURCE_TIMECODE then
    return
  end
  for _, match in pairs(matches) do
    verify_clip_timecode(match, match.video_clip, "video")
    for _, audio_clip in ipairs(match.audio_clips) do
      verify_clip_timecode(match, audio_clip, "audio")
    end
  end
end

local function group_matches(matches)
  local grouped = {}
  for _, match in pairs(matches) do
    local key = group_key(match.slate_take)
    if not grouped[key] then
      grouped[key] = {}
    end
    grouped[key][#grouped[key] + 1] = match
  end
  return grouped
end

local function scene_bin_name(scene)
  local scene_norm = normalise_scene(scene)
  if scene_norm ~= "" then
    return "Sc" .. scene_norm
  end
  return "Unscened"
end

local function group_display_name(group)
  for _, match in ipairs(group) do
    if match.slate_take.suggested_clip_name ~= "" then
      return match.slate_take.suggested_clip_name
    end
  end
  local first = group[1].slate_take
  return "Sc" .. normalise_scene(first.scene) .. normalise_setup(first.setup) .. " T" .. normalise_take(first.take)
end

local function sorted_group_keys(grouped)
  local keys = {}
  for key, _ in pairs(grouped) do
    keys[#keys + 1] = key
  end
  table.sort(keys)
  return keys
end

local function process()
  local resolve = get_resolve()
  local project = get_current_project(resolve)
  local media_pool = project:GetMediaPool()
  local root_folder = media_pool:GetRootFolder()

  local json_path = request_json_file(resolve)
  local slate_takes = load_slate_json(json_path)
  print(string.format("Loaded %d slate takes from %s", #slate_takes, json_path))

  local video_root = find_folder_by_path(root_folder, VIDEO_BIN_PATH_DEFAULT)
  local audio_root = find_folder_by_path(root_folder, AUDIO_BIN_PATH_DEFAULT)
  if not video_root then
    error("Video bin not found: " .. VIDEO_BIN_PATH_DEFAULT)
  end
  if not audio_root then
    error("Audio bin not found: " .. AUDIO_BIN_PATH_DEFAULT)
  end

  local output_root = ensure_bin_path(media_pool, root_folder, OUTPUT_ROOT_BIN_PATH_DEFAULT)
  local video_clips = get_clips_in_folder_tree(video_root)
  local audio_clips = get_clips_in_folder_tree(audio_root)
  print(string.format("Scanned %d video candidate clips and %d audio candidate clips", #video_clips, #audio_clips))

  local matches = index_video_clips(video_clips, slate_takes)
  attach_audio_matches(matches, audio_clips)
  verify_matched_timecodes(matches)

  for _, match in pairs(matches) do
    local label = match.slate_take.suggested_clip_name ~= "" and match.slate_take.suggested_clip_name or match.slate_take.source_clip
    if #match.errors > 0 then
      print("ERROR: " .. label .. ": " .. table.concat(match.errors, "; "))
    else
      if #match.warnings > 0 then
        print("WARNING: " .. label .. ": " .. table.concat(match.warnings, "; "))
      end
      if match.video_clip then
        if APPLY_METADATA then
          apply_metadata(match.video_clip, match.slate_take)
        end
        if APPLY_MARKERS then
          apply_markers(match.video_clip, match.slate_take)
        end
        if APPLY_TRIM_MARKS then
          apply_trim_marks(match.video_clip, match.slate_take)
        end
        if APPLY_CLIP_DISPLAY_NAMES then
          apply_display_name(match.video_clip, match.slate_take)
        end
      end
    end
  end

  local grouped = group_matches(matches)
  for _, key in ipairs(sorted_group_keys(grouped)) do
    local group = grouped[key]
    local valid_video_clips = {}
    local audio_by_name = {}
    for _, match in ipairs(group) do
      if match.video_clip and #match.errors == 0 then
        valid_video_clips[#valid_video_clips + 1] = match.video_clip
      end
      for _, audio_clip in ipairs(match.audio_clips) do
        audio_by_name[clip_filename(audio_clip)] = audio_clip
      end
    end

    local valid_audio_clips = {}
    for _, audio_clip in pairs(audio_by_name) do
      valid_audio_clips[#valid_audio_clips + 1] = audio_clip
    end

    local scene_folder = output_root
    if CREATE_SCENE_BINS then
      scene_folder = ensure_child_folder(media_pool, output_root, scene_bin_name(group[1].slate_take.scene))
    end

    create_multicam_or_synced_clip(resolve, media_pool, scene_folder, group_display_name(group), valid_video_clips, valid_audio_clips)
  end

  print("Done.")
end

local ok, err = pcall(process)
if not ok then
  print("Digital Slate Resolve Helper failed:")
  print(err)
end
