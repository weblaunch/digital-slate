# DaVinci Resolve Helper

This folder contains `digital_slate_resolve_helper.lua`, a DaVinci Resolve
script for applying Digital Slate exports to media pool clips.

The helper consumes metadata exported from the Digital Slate app and turns it
into Resolve-friendly project data.

## Install

On macOS, copy or symlink the Lua script into Resolve's per-user Utility
scripts folder:

```text
~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility/
```

Then run it from:

```text
Workspace > Scripts > Utility > digital_slate_resolve_helper
```

## Input

The script expects a Digital Slate JSON export with this format marker:

```json
{
  "format": "digital-slate-resolve-prep-v1"
}
```

When launched, the script asks for the JSON export path. The default path can
also be edited near the top of `digital_slate_resolve_helper.lua`:

```lua
local JSON_PATH_DEFAULT = "/path/to/test-all-days-resolve-export.json"
```

## What It Does

Depending on the config flags at the top of the script, it can:

- Match exported slate takes to Media Pool video clips.
- Match related audio clips.
- Verify that matched clips contain the slate timecode.
- Apply clip metadata such as scene, take, camera, reel, date, and location.
- Add slate open/close markers.
- Apply trim marks.
- Rename clip display names.
- Create scene bins under `Digital Slate Synced`.
- Attempt Resolve timecode-based audio sync / multicam-style grouping.

The script includes a `DRY_RUN` config flag for reviewing intended actions
before making changes.

## Dependencies

No Python install or Python packages are required. This helper is Lua and uses a
small built-in JSON decoder.
