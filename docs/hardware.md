# Hardware Notes

Digital Slate is designed around ESP32-based devices that distribute timecode, detect slate open/close events, and report those events to the mobile app.

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
