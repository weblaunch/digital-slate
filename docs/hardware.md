# Hardware Notes

Digital Slate is designed around ESP32-based devices that distribute timecode, detect slate open/close events, and report those events to the mobile app.

The system is comprised of 3 hardware units; the timecode transmitter, timecode receiver and digital slate.

### Transmitter (master)
The transmitter ingests LTC timecode from a device such as an audio recorder, displays that timecode and transmits it to the other units.

The transmitter requires some signal conditioning on the input:

<img src="https://github.com/weblaunch/digital-slate/blob/main/assets/photos/tc_input_conditioning.webp?raw=true" alt="Input conditioning circuit">

### Receiver (slave)
The receiver is connected to the camera(s) and displays and passes the LTC from the transmitter. These two devices would be enough to use Resolve's sync by timecode facility, removing the need to sync video and audio by slate alone.

The receiver requires some signal conditioning on the output:

<img src="https://github.com/weblaunch/digital-slate/blob/main/assets/photos/tc_output_conditioning.png?raw=true" alt="Output conditioning circuit" width="600">

### Digital Slate (slate)
The slate receives and dispays timecode from the transmitter and connects to the app via Bluetooth. The visual display on the face of the slate is a fallback in case timecode does not reach the camera; clips can still be manually synced using this visual reference. Of course, if that also fails, it's still possible to sync the old fashioned way - syncing the slate clap.

The app records open and close events against other information including Scene, Take and camera file name enabling the script to sync assets later in Resolve. Audio file names are expected in the format Sc001-T01.

## Core Parts

- Adafruit Feather ESP32-S3
- NRF24L01 RF module using the RF24 library
- MAX7219 FC16_HW LED matrix modules, 8 devices chained
- SH1106 or SSD1306 OLED display
- Hall sensor for slate open/close detection

## Known Pin Assignments

RF24:

```cpp
#define RF24_CE_PIN 13
#define RF24_CSN_PIN 12
```

LED matrix:

```cpp
#define MATRIX_DATA_PIN 17
#define MATRIX_CLK_PIN 18
#define MATRIX_CS_PIN 16
```

Hall sensor:

```cpp
#define HALL_PIN 5
```

OLED address:

```cpp
0x3C
```

## Build Notes

The RF24 module and MAX7219 matrix should use separate SPI buses where possible. Sharing one SPI bus between RF and matrix display has proven unreliable.

## Photos

Put hardware photos, wiring references, and build images in [../assets/photos](../assets/photos).
