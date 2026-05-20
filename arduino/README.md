# Arduino Firmware

This folder contains Arduino sketches for the Digital Slate hardware.

Each sketch lives in its own Arduino IDE folder. The folder name should match
the main `.ino` file name.

Current sketches:

```text
arduino/
  digital-slate-ble/
    master/
      master.ino          LTC reader and RF24 timecode transmitter
    slate/
      slate.ino           LED slate with RF24 receive, BLE events, hall sensor
    slave/
      slave.ino           RF24 receiver and LTC output for camera devices
```

Open the specific sketch folder in Arduino IDE, for example
`arduino/digital-slate-ble/slate/slate.ino`.

See [../docs/hardware.md](../docs/hardware.md) for hardware notes and pin assignments.
