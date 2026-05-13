# Digital Slate Project – README for Codex

## Overview

This project is a custom open-source digital film slate ecosystem consisting of:

1. A MASTER device which reads LTC timecode from a recorder.
2. One or more SLATE devices which display timecode and physically clap.
3. One or more CAMERA SLAVE devices which receive RF timecode and output LTC.
4. A future Ionic/Angular/Capacitor mobile app communicating via Bluetooth.

The system is designed primarily for film production workflows.

Primary goals:

- Reliable wireless timecode distribution.
- Accurate slate close frame capture.
- Simple multicam workflow.
- Logging and metadata export for editing.
- Davinci Resolve friendly workflow.
- Open source.

---

# Hardware Summary

## MCU Platform

Primary MCU:

- Adafruit Feather ESP32-S3

Important notes:

- Uses 3.3V logic.
- Includes LiPo charging.
- Uses JST-PH 2-pin battery connector.
- Uses multiple SPI buses in some builds to avoid RF/display conflicts.

---

# RF Architecture

## RF Module

Using:

- NRF24L01
- RF24 library

Known issue:

The RF24 and MAX7219 matrix do NOT behave reliably on the same SPI bus.

Solution:

- Separate SPI buses/pins.
- Sometimes separate power rails.
- RF module may benefit from bulk capacitance across power rails.

Final known stable RF pins:

```cpp
#define RF24_CE_PIN 13
#define RF24_CSN_PIN 12
```

RF timeout currently:

```cpp
#define RF24_TIMEOUT_MS 600
```

Master currently transmits packets every:

```cpp
MASTER_PACKET_FRAME_INTERVAL = 5
```

RF packets contain:

- sync_word
- sequence
- frame_counter
- tx timestamp
- decoded LTC
- fps
- flags

---

# MASTER Device

## Purpose

Reads LTC from recorder (Zoom F4 tested), decodes it, and transmits timecode over RF.

## LTC Input Conditioning

Known working conditioning:

- 2N3904 transistor
- 10K resistor
- 2.2uF capacitor inline from recorder output

User also tested:

- 3.3uF capacitor

which also worked correctly.

## LTC Notes

LTC frame:

- 80 bits
- Biphase mark encoded

Target frame rate:

- Primarily 25fps

Potential future support:

- 24fps
- 30fps
- Drop frame

Drop-frame bit handled in:

```cpp
frame_bytes[6] |= 0x04;
```

---

# SLATE Device

## Purpose

Displays timecode visually and captures physical clap timing.

## Displays

### LED Matrix

Using:

- MAX7219 FC16_HW modules
- 8 devices chained
- MD_MAX72XX library

Current matrix pins:

```cpp
#define MATRIX_DATA_PIN 17
#define MATRIX_CLK_PIN 18
#define MATRIX_CS_PIN 16
```

### OLED

Using:

- SH1106 or SSD1306 depending on module
- Adafruit_GFX
- Adafruit_SH110X

Known OLED address:

```cpp
0x3C
```

Some SH1106 displays exhibit horizontal offset behaviour.

---

# Hall Sensor

Used to detect slate open/close.

Tested sensors:

- DRV5032
- Considering Allegro A1120EUA-T

Current pin:

```cpp
#define HALL_PIN 5
```

---

# Accelerometer

Planned purpose:

- Detect slate inversion automatically.

Current logic already added:

```cpp
slate_inverted = 0
```

When true:

- OLED timecode displays upside-down.

Known accelerometer notes:

- LIS3DH discovered at address 0x1D.
- User uses SDA GPIO3 and SCL GPIO4 on Feather.

---

# Battery Monitoring

Battery type:

- NP-F battery

Battery monitoring methods discussed:

1. ADC voltage divider.
2. Dedicated fuel gauge.

Potential fuel gauges:

- MAX17043
- MAX17048
- MAX17049
- LC709203F

Example voltage thresholds:

```text
>7.97V = full
>7.67V = medium
>7.49V = low
<7.49V = empty
<7.22V = shutdown
```

OLED battery UI currently uses segments rather than percentages.

---

# SLATE Behaviour

## Important Behaviour

When slate closes:

- Freeze displayed timecode.
- Apply configurable frame offset.
- Display close markers.
- Later sleep LED matrix.
- OLED continues running.

Current defaults:

```cpp
#define DEFAULT_MATRIX_INTENSITY 3
#define DEFAULT_SLEEP_SECONDS 5
#define DEFAULT_FRAME_OFFSET 1
```

Sleep options:

```cpp
const uint8_t sleep_options[] = { 0, 1, 2, 3, 5, 10, 20 };
```

Preferences are persisted using:

- Preferences library

---

# Camera Slave Device

## Purpose

Receives RF timecode and outputs LTC to camera.

Current known pin:

```cpp
#define LTC_OUTPUT_PIN 9
```

## Important Design Requirement

Camera slave drift MUST remain tightly constrained.

Conversation conclusion:

Allowing both slate and slave to drift by up to 2 frames is NOT acceptable.

Future logic should:

- Force more aggressive resync.
- Avoid cumulative drift.
- Use small correction strategy.
- Force-sync on larger discrepancies.

Current slave logic already includes:

- Free-running between RF packets.
- Timeout detection.
- RF correction logic.

---

# App Architecture

## Platform

Planned stack:

- Ionic
- Angular
- Capacitor

Using:

- Ionic Side Menu starter app

## Core Concept

App communicates with digital slate via Bluetooth.

Bluetooth is NOT yet implemented in ESP32 sketches.

---

# App Data Model

## Final Agreed Structure

```text
Project
    -> ShootDay
        -> Slate
            -> SlateScene
                -> Take

Scene
    shared scene definition
```

---

# Entity Definitions

## Project

Properties:

- name
- director
- dop
- camera_op

## ShootDay

Properties:

- date
- location

## Slate

Represents:

- A camera slate
- Example: A Cam, B Cam

Properties:

- camera

## Scene

MASTER/shared scene definition.

Properties:

- scene_name
- location
- time_of_day
- notes

Scene records are shared between multiple slates.

Editing a scene updates all linked slates.

## SlateScene

Join table between:

- Slate
- Scene

Purpose:

- Allow one scene to appear on multiple slates.
- Preserve separate takes per camera/slate.

Suggested fields:

```text
slate_scene_id
slate_id
scene_id
scene_order
active
```

## Take

Properties:

- take_number
- slate_open_timecode
- slate_close_timecode
- flags
- notes
- created_at

Takes belong to:

- slate_scene

NOT directly to scene.

---

# Flags

Suggested default flags:

```text
good
bad
circle
false_start
boom_visible
focus_issue
sound_issue
custom
```

---

# App Menu Structure

Suggested side menu:

```text
Projects
Search
Export
Bluetooth / Slate Connection
Settings
```

---

# Search

Planned search capability:

- Search notes
- Search flags
- Search scenes
- Search take metadata

---

# Export

Initial export formats:

```text
CSV
JSON
```

Potential future formats:

```text
FCPXML
EDL
Resolve metadata formats
```

Main editorial goals:

- Syncing audio/video/multicam.
- Renaming clips by scene/take.
- Finding slate close points.
- Marking good takes.
- Additional metadata markers.

---

# Bluetooth Architecture

## Development Strategy

Recommended approach:

Build app FIRST using fake BLE events.

Then integrate real BLE later.

---

# Bluetooth Service Design

Recommended service abstraction:

```ts
SlateBluetoothService
  scan()
  connect(device_id)
  disconnect()
  send_command(command)
  messages$
  status$
```

Both fake and real implementations should expose identical APIs.

---

# Fake BLE System

## Purpose

Allow full app development before ESP32 BLE implementation exists.

Recommended fake service:

```text
FakeSlateBluetoothService
```

App should not know whether messages are fake or real.

---

# Example BLE Messages

```ts
{
  type: 'slate_closed',
  slate_id: 'fake-a-cam',
  camera: 'A Cam',
  timecode: '10:14:22:08',
  battery: 82,
  signal: 'fake',
  created_at: new Date().toISOString()
}
```

Suggested event types:

```text
slate_opened
slate_closed
battery_update
rf_signal
status
```

---

# Suggested BLE Commands

Potential future commands:

```text
GET_STATUS
SET_PROJECT
SET_SCENE
SET_TAKE
ARM_SLATE
MARK_OPEN
MARK_CLOSE
SYNC_TIME
SET_CAMERA_NAME
```

---

# Fake BLE Testing

Suggested developer page:

```text
Fake Slate
- Connect fake slate
- Set current camera
- Set timecode
- Slate open
- Slate close
- Good take
- Bad take
- Add note
```

Suggested auto mode:

Automatically generate realistic fake shoot data.

Useful for:

- Search testing
- Export testing
- UI scaling
- Multicam workflows

---

# Database Recommendation

Strong recommendation:

Use SQLite for structured data.

Avoid storing all project data as nested JSON blobs.

Use Capacitor Preferences only for:

- App settings
- Connection settings
- User preferences

---

# Coding Style Notes

User preferences:

- snake_case preferred.
- Avoid camelCase.
- User values exact integration details.
- User prefers complete code rather than placeholders.

---

# Important Future Tasks

## ESP32 BLE

Need to implement:

- BLE service
- BLE characteristics
- Message protocol
- Device pairing
- Reconnection handling

## App

Need:

- SQLite schema
- Angular services
- BLE abstraction layer
- Search UI
- Export system
- Project browser
- Scene/take editor

## Future Integration Ideas

Potential future app features:

- Davinci Resolve helper exports.
- Slate marker generation.
- Clip renaming assistance.
- Metadata sync.
- Good take tagging.
- Boom visible markers.
- Multicam syncing assistance.

---

# Suggested Immediate Development Order

1. SQLite schema.
2. Angular services.
3. Project/shoot/slate UI.
4. Fake BLE service.
5. Automatic take generation.
6. Search.
7. Export.
8. Real ESP32 BLE implementation.
9. Resolve/editorial workflow integration.
