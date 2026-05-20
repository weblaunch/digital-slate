# Digital Slate Firmware

This folder contains the current ESP32 Arduino sketches for the Digital Slate
hardware set.

## Sketches

```text
master/master.ino   Reads incoming LTC and broadcasts timecode over NRF24L01.
slate/slate.ino     Receives RF timecode, displays it, detects claps, and sends BLE events to the app.
slave/slave.ino     Receives RF timecode and outputs LTC for camera devices.
```

## Shared RF Settings

The sketches use the same RF24 address:

```cpp
const byte rf24_address[6] = "TC001";
```

Known RF24 pins:

```cpp
#define RF24_CE_PIN 13
#define RF24_CSN_PIN 12
```

The sketches currently use 25fps timecode.

## BLE Slate Events

The app expects BLE notifications using this service and characteristic:

```text
Service:              7b2f0001-8f4b-4c71-9a0c-0d151a7e0001
Event characteristic: 7b2f0002-8f4b-4c71-9a0c-0d151a7e0001
```

Minimal event payloads:

```json
{ "type": "open", "timecode": "09:14:22:03" }
{ "type": "close", "timecode": "09:14:27:11" }
```

The current slate sketch sends payloads in this shape:

```json
{
  "type": "close",
  "device_id": "slate-a",
  "timecode": "09:14:27:11",
  "battery_voltage": 7.40,
  "inverted": 0
}
```

`inverted` is used by the app to flag end-slate takes.

## Arduino Libraries

Install the libraries used by the sketches you are compiling:

- RF24
- MD_MAX72xx
- NimBLE-Arduino
- Adafruit GFX Library
- Adafruit SSD1306
- Adafruit SH110X
- Adafruit MMA8451 Library
- Adafruit Unified Sensor
- Adafruit MAX1704X
- Adafruit LC709203F

Not every sketch uses every library in this list.
