# Troubleshooting

## App

- If browser storage behaves unexpectedly, clear the browser site data and restart the dev server.
- If `npm run build` reports a `jeep-sqlite` warning about Node `crypto`, treat it as non-blocking unless the build fails.

## Hardware

- If RF communication is unreliable while the LED matrix is active, use separate SPI buses for RF24 and MAX7219.
- If slate open/close detection is unstable, check hall sensor orientation, magnet position, and pull-up/pull-down configuration.

## Resolve Helper

Add known Resolve scripting issues here once the helper script is added.
