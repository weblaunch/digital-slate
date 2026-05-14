# Digital Slate

Digital Slate is an open-source film slate ecosystem made of ESP32-based hardware and an Ionic/Angular/Capacitor mobile app. The system is intended to distribute timecode, capture slate open/close events, log production metadata, and later export editorial-friendly metadata for workflows such as DaVinci Resolve.

## Project Status

The app now has a basic working structure:

- Project, shoot day, slate, scene, and take navigation.
- SQLite-backed local storage with browser support through `jeep-sqlite` and `sql.js`.
- Reusable slates across shoot days, so camera labels such as `A Cam` do not need to be recreated manually every day.
- Shared scene definitions linked to individual slates.
- Take logging scoped by shoot day, slate, and slate scene.
- Fake slate open/close events that generate timecode from a 09:00:00:00 daily slate start.
- Editable projects, shoot days, slates, scenes, and takes.
- Take flags, including default flags and user-created custom flags.
- Clip name tracking per take, with roll-level auto-increment and rollback on deleted takes.
- Breadcrumb navigation through the hierarchy.
- Search across projects, shoot days, slates, scenes, takes, rolls, media cards, notes, locations, timecode, and flags.

Real Bluetooth connection is the next major integration point.

## Hardware Overview

The wider system consists of:

1. A master device that reads LTC timecode from a recorder.
2. One or more slate devices that display timecode and physically clap.
3. One or more camera slave devices that receive RF timecode and output LTC.
4. The Ionic/Capacitor app, which will communicate with slates over Bluetooth.

Primary MCU:

- Adafruit Feather ESP32-S3

RF module:

- NRF24L01 using the RF24 library.

Known stable RF pins:

```cpp
#define RF24_CE_PIN 13
#define RF24_CSN_PIN 12
```

The RF24 module and MAX7219 matrix should use separate SPI buses where possible. Sharing one SPI bus between RF and matrix display has proven unreliable.

## Slate Hardware Notes

Slate display hardware:

- MAX7219 FC16_HW LED matrix modules, 8 devices chained.
- SH1106 or SSD1306 OLED display.

Current matrix pins:

```cpp
#define MATRIX_DATA_PIN 17
#define MATRIX_CLK_PIN 18
#define MATRIX_CS_PIN 16
```

Known OLED address:

```cpp
0x3C
```

Hall sensor:

- Used to detect slate open/close.
- DRV5032 tested.
- Allegro A1120EUA-T also under consideration.

Current hall pin:

```cpp
#define HALL_PIN 5
```

Slate behavior:

- Open state is represented by `<`.
- Closed state is represented by `=`.
- When the slate closes, the displayed timecode freezes and the close frame is captured.
- The app currently mirrors these events with fake open/close buttons.

Current defaults:

```cpp
#define DEFAULT_MATRIX_INTENSITY 3
#define DEFAULT_SLEEP_SECONDS 5
#define DEFAULT_FRAME_OFFSET 1
```

## Timecode

The production timecode scheme follows actual time. In normal use the slate is set to:

```text
09:00:00:00
```

in the morning and then runs all day.

The app fake slate event generator mirrors this behavior at 25fps. It derives current fake timecode from a 09:00 daily start rather than starting from zero when the app opens.

## App Stack

Current stack:

- Ionic
- Angular
- Capacitor
- `@capacitor-community/sqlite`
- `jeep-sqlite` for browser development
- `sql.js@1.11.0` with `src/assets/sql-wasm.wasm`

Capacitor app id:

```text
com.weblaunchuk.digitalslate
```

Useful commands:

```bash
npm start
npm run build
```

`npm run build` currently completes successfully. The build may show a non-blocking `jeep-sqlite` warning about the Node `crypto` module.

## App Navigation

Current app hierarchy:

```text
Projects
  -> Shoot Days
    -> Slates
      -> Scenes
        -> Takes
```

Current side menu:

```text
Projects
Search
Export
Slate Connection
Settings
```

Export, connection, and settings screens are placeholders or future work areas.

The Search screen supports:

- Free-text search.
- Type filtering for scenes, takes, flags, days, slates, and projects.
- Optional flag filtering.
- Deep links back into the relevant hierarchy page.

## Data Model

### Project

Stores production-level metadata:

- name
- director
- dop
- camera_op

### Shoot Day

Stores day-level metadata:

- date
- location

Human-readable dates in the UI should use:

```text
DD-MM-YYYY
```

Stored dates remain ISO-style strings where useful for sorting and database work.

### Slate

Represents a camera slate, such as:

```text
A Cam
B Cam
```

Slates can be reused across shoot days. When adding a slate, the app should offer existing project slates first, with an option to create a new slate.

### Scene

Stores shared scene metadata:

- scene_name
- location
- time_of_day
- notes

Scene records are shared definitions. Editing a scene updates all linked slate scenes.

### Slate Scene

Join between a slate and a shared scene.

Purpose:

- Allow one scene to appear on multiple slates.
- Preserve separate takes per camera/slate.

### Media Card

Represents a reusable physical recording card, such as:

```text
SxS 01
SxS 02
```

Cards are reusable inventory. They can be assigned to many rolls over time.

### Roll

Represents a named recording roll for a project, optionally tied to a reusable media card.

Important fields:

- project_id
- shoot_day_id
- slate_id
- card_id
- roll_name
- last_clip_name
- notes

This allows a small pool of physical cards to be reused while preserving roll metadata per project/day/slate.
The app can use `last_clip_name` to suggest the next camera file name for takes on the roll.

### Take

Takes belong to a slate scene and are also tied to their shoot day and slate.

Important fields:

- shoot_day_id
- slate_id
- slate_scene_id
- roll_id
- clip_name
- take_number
- slate_open_timecode
- slate_close_timecode
- notes

Take uniqueness is scoped by:

```text
shoot_day_id + slate_id + slate_scene_id + take_number
```

This prevents takes from previous days or other camera slates being confused with the current day.

### Flags

Flags are stored in a lookup table and linked to takes through a join table.

Default flags:

- Good
- Bad
- Circle
- False start
- Boom visible
- Focus issue
- Sound issue

Users can also add their own flags from the take modal.

## Bluetooth Plan

The app has fake slate events now. The recommended next step is to keep the app-side event contract stable and swap the fake source for a real BLE source.

Recommended app-side abstraction:

```ts
SlateConnectionService
  scan()
  connect(device_id)
  disconnect()
  send_command(command)
  events$
  status$
```

The fake event service and real BLE service should expose the same event shape.

The physical slate is not expected to transmit app metadata such as:

- slate_id
- camera
- scene
- take_number

The app should infer those from the active app context or from a stored device-to-slate mapping.

BLE notifications should use JSON. Minimal useful payloads:

```json
{ "type": "open", "timecode": "09:14:22:03" }
{ "type": "close", "timecode": "09:14:27:11" }
```

The app normalizes those into internal events with:

```ts
{
  event_type: 'open' | 'close',
  device_id: string,
  timecode: string,
  received_at: string
}
```

Optional JSON fields can be added without changing the core event flow:

```json
{
  "type": "close",
  "device_id": "slate-a",
  "timecode": "09:14:27:11",
  "sent_at": "2026-05-14T09:14:27.440Z",
  "battery": 82
}
```

The parser also accepts `slate_opened` and `slate_closed` as aliases for `open` and `close`.

Suggested first real BLE milestone:

1. Scan for slate devices.
2. Connect to one slate.
3. Receive open and close notifications.
4. Convert notifications into the same event stream as fake events.
5. Open and close takes in the current active slate scene.

## Future Work

Near-term app work:

- Real Bluetooth scan/connect screen.
- Device-to-slate mapping.
- Connection status and reconnect handling.
- Search UI.
- CSV and JSON export.

Later app work:

- DaVinci Resolve friendly exports.
- Clip naming helpers.
- Marker generation.
- Metadata sync.
- Multicam workflow helpers.

ESP32 Bluetooth work:

- BLE service.
- BLE characteristics.
- Open/close notification protocol.
- Battery/status notifications.
- Reconnection behavior.

## Coding Notes

Project style preferences:

- Prefer snake_case in app code.
- Keep data structured in SQLite rather than nested JSON blobs.
- Use Capacitor Preferences only for app settings, connection settings, and user preferences.
- Avoid placeholders where complete working code can be written.
