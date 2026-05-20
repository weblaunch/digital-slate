# Setup

This page is for the end-to-end setup flow: app, firmware, hardware, and Resolve helper.

## App

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm start
```

Build the app:

```bash
npm run build
```

## Firmware

Open the sketch you want to upload in Arduino IDE:

```text
../arduino/digital-slate-ble/master/master.ino
../arduino/digital-slate-ble/slate/slate.ino
../arduino/digital-slate-ble/slave/slave.ino
```

Install the required Arduino libraries listed in
[../arduino/digital-slate-ble/README.md](../arduino/digital-slate-ble/README.md).

## Hardware

See [hardware.md](hardware.md).

## Resolve Helper

Install the Lua helper from [../tools/resolve](../tools/resolve) into Resolve's
per-user Utility scripts folder:

```text
~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility/
```

Run it from Resolve via:

```text
Workspace > Scripts > Utility > digital_slate_resolve_helper
```
