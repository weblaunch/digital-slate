#include <MD_MAX72xx.h>
#include <SPI.h>
#include <Wire.h>
#include <RF24.h>
#include <Preferences.h>
#include <Adafruit_GFX.h>
// #include <Adafruit_SSD1306.h>
#include <Adafruit_SH110X.h>
#include <Adafruit_MMA8451.h>
#include <Adafruit_Sensor.h>#include <NimBLEDevice.h>
#include <NimBLEDevice.h>

// ------------------ CONFIG ------------------

#define BLE_SERVICE_UUID "7b2f0001-8f4b-4c71-9a0c-0d151a7e0001"
#define BLE_EVENT_UUID "7b2f0002-8f4b-4c71-9a0c-0d151a7e0001"

NimBLECharacteristic *ble_event_characteristic = nullptr;
bool ble_connected = false;

Adafruit_MMA8451 mma = Adafruit_MMA8451();


#define HARDWARE_TYPE MD_MAX72XX::FC16_HW
#define MAX_DEVICES 8

#define MATRIX_CS_PIN 16
#define MATRIX_DATA_PIN 17
#define MATRIX_CLK_PIN 18

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_I2C_ADDRESS 0x3C

#define HALL_PIN 5

#define MENU_LEFT_PIN 9
#define MENU_ENTER_PIN 10
#define MENU_RIGHT_PIN 11

#define FRAME_RATE 25
#define OLED_REFRESH_MS 100
#define RF24_TIMEOUT_MS 600
#define MASTER_PACKET_FRAME_INTERVAL 5

#define RF24_CE_PIN 13
#define RF24_CSN_PIN 12

#define DEFAULT_MATRIX_INTENSITY 3
#define DEFAULT_SLEEP_SECONDS 5
#define DEFAULT_FRAME_OFFSET 1

#define HALL_DEBOUNCE_MS 3

#define BATTERY_ADC_PIN A5

const uint8_t sleep_options[] = { 0, 1, 2, 3, 5, 10, 20 };
#define SLEEP_OPTION_COUNT (sizeof(sleep_options) / sizeof(sleep_options[0]))

MD_MAX72XX mx = MD_MAX72XX(HARDWARE_TYPE, MATRIX_DATA_PIN, MATRIX_CLK_PIN, MATRIX_CS_PIN, MAX_DEVICES);
// Adafruit_SSD1306 oled(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);
Adafruit_SH1106G oled(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);
RF24 radio(RF24_CE_PIN, RF24_CSN_PIN);
Preferences prefs;

const byte rf24_address[6] = "TC001";

#define HALL_CLOSED_STATE_HIGH false

// ------------------ STATE ------------------

enum slate_state_t {
  STATE_OPEN,
  STATE_CLOSED,
  STATE_SLEEP
};

enum menu_item_t {
  MENU_FRAME_OFFSET,
  MENU_BRIGHTNESS,
  MENU_SLEEP_TIME,
  MENU_ITEM_COUNT
};

slate_state_t slate_state = STATE_OPEN;
// uint8_t slate_inverted = 1;

bool menu_active = false;
uint8_t current_menu_item = MENU_FRAME_OFFSET;

// ------------------ SETTINGS ------------------

int8_t slate_frame_offset = DEFAULT_FRAME_OFFSET;
uint8_t matrix_intensity = DEFAULT_MATRIX_INTENSITY;
uint8_t sleep_seconds = DEFAULT_SLEEP_SECONDS;

// ------------------ TIMECODE ------------------

struct timecode_t {
  uint8_t h = 0;
  uint8_t m = 0;
  uint8_t s = 0;
  uint8_t f = 0;
};

timecode_t tc_live;
timecode_t tc_frozen;

uint32_t last_frame_us = 0;
uint32_t closed_at_ms = 0;
uint32_t last_oled_refresh_ms = 0;

bool flash_close_markers = false;
uint32_t close_markers_started_us = 0;

bool matrix_dirty = true;
bool oled_dirty = true;

// ------------------ RF PACKET ------------------

struct tc_packet_t {
  uint32_t sync_word;
  uint32_t sequence;
  uint32_t frame_counter;
  uint32_t frame_decode_us;
  uint32_t tx_us;

  uint8_t hours;
  uint8_t minutes;
  uint8_t seconds;
  uint8_t frames;

  uint8_t fps;
  uint8_t flags;
};

#define TC_FLAG_VALID 0x01
#define TC_FLAG_DROP_FRAME 0x02
#define TC_FLAG_REVERSED 0x04
#define TC_FLAG_SIGNAL 0x08

bool rf_signal_present = false;
bool rf_drop_frame = false;
bool rf_reversed = false;
uint8_t rf_fps = FRAME_RATE;
uint32_t last_rf_rx_ms = 0;
uint32_t last_rf_rx_us = 0;
uint32_t last_rf_sequence = 0;

uint32_t last_master_frame_counter = 0;
uint32_t last_master_frame_decode_us = 0;
uint32_t last_master_tx_us = 0;
bool have_seen_first_master_frame = false;

uint32_t rf_rx_count = 0;
uint32_t rf_missed_frame_count = 0;
uint32_t rf_bad_interval_count = 0;
uint32_t last_rf_stats_ms = 0;

uint32_t local_frame_counter = 0;

// ------------------ HALL ------------------

bool hall_state = false;
bool last_hall_state = false;
bool last_raw_hall_state = false;
uint32_t last_hall_change_ms = 0;

// ------------------ ACCELEROMETER ------------------

uint8_t slate_inverted = 0;

#define ACCEL_READ_INTERVAL_MS 250
#define ACCEL_INVERT_THRESHOLD 4.0  // m/s^2, roughly 0.6g

unsigned long last_accel_read_ms = 0;

// ------------------ MENU BUTTONS ------------------

bool last_left_state = HIGH;
bool last_enter_state = HIGH;
bool last_right_state = HIGH;

uint32_t last_button_read_ms = 0;
#define BUTTON_DEBOUNCE_MS 35

// ------------------ MATRIX FONT ------------------

const uint8_t glyph_0[5] = { 0x3E, 0x51, 0x49, 0x45, 0x3E };
const uint8_t glyph_1[5] = { 0x00, 0x42, 0x7F, 0x40, 0x00 };
const uint8_t glyph_2[5] = { 0x62, 0x51, 0x49, 0x49, 0x46 };
const uint8_t glyph_3[5] = { 0x22, 0x41, 0x49, 0x49, 0x36 };
const uint8_t glyph_4[5] = { 0x18, 0x14, 0x12, 0x7F, 0x10 };
const uint8_t glyph_5[5] = { 0x2F, 0x49, 0x49, 0x49, 0x31 };
const uint8_t glyph_6[5] = { 0x3E, 0x49, 0x49, 0x49, 0x32 };
const uint8_t glyph_7[5] = { 0x01, 0x71, 0x09, 0x05, 0x03 };
const uint8_t glyph_8[5] = { 0x36, 0x49, 0x49, 0x49, 0x36 };
const uint8_t glyph_9[5] = { 0x26, 0x49, 0x49, 0x49, 0x3E };
const uint8_t glyph_colon[1] = { 0x14 };
const uint8_t glyph_blank[5] = { 0x00, 0x00, 0x00, 0x00, 0x00 };

#define DIGIT_WIDTH 5
#define DIGIT_ADVANCE 6
#define COLON_WIDTH 1
#define COLON_ADVANCE 2

#define MATRIX_PIXEL_WIDTH (MAX_DEVICES * 8)
#define TIMECODE_PIXEL_WIDTH ((8 * DIGIT_ADVANCE) + (3 * COLON_ADVANCE))
#define TIMECODE_X_OFFSET ((MATRIX_PIXEL_WIDTH - TIMECODE_PIXEL_WIDTH) / 2)

// ------------------ OLED FONT ------------------

const uint8_t oled_digit_0[3] = { 0x1F, 0x11, 0x1F };
const uint8_t oled_digit_1[3] = { 0x00, 0x1F, 0x00 };
const uint8_t oled_digit_2[3] = { 0x1D, 0x15, 0x17 };
const uint8_t oled_digit_3[3] = { 0x15, 0x15, 0x1F };
const uint8_t oled_digit_4[3] = { 0x07, 0x04, 0x1F };
const uint8_t oled_digit_5[3] = { 0x17, 0x15, 0x1D };
const uint8_t oled_digit_6[3] = { 0x1F, 0x15, 0x1D };
const uint8_t oled_digit_7[3] = { 0x01, 0x01, 0x1F };
const uint8_t oled_digit_8[3] = { 0x1F, 0x15, 0x1F };
const uint8_t oled_digit_9[3] = { 0x17, 0x15, 0x1F };

#define OLED_TC_X 4
#define OLED_TC_Y 0
#define OLED_TC_SCALE 3
#define OLED_DIGIT_WIDTH 3
#define OLED_DIGIT_SPACING 1
#define OLED_COLON_WIDTH 1
#define OLED_COLON_SPACING 1

// ------------------ BATTERY ------------------

enum battery_level_t {
  BATTERY_EMPTY = 0,
  BATTERY_LOW = 1,
  BATTERY_MEDIUM = 2,
  BATTERY_FULL = 3
};

float read_battery_voltage(void);
void update_battery_status(void);
battery_level_t get_battery_level(float v);
battery_level_t update_battery_level(float v);
bool should_shutdown_for_battery(float v);
void shutdown_for_low_battery(void);
void drawBatteryIndicator(int x, int y);

const float battery_r1 = 100000.0;
const float battery_r2 = 47000.0;
const float adc_ref_voltage = 3.3;

#define BATTERY_FULL_VOLTAGE 7.80
#define BATTERY_MEDIUM_VOLTAGE 7.50
#define BATTERY_LOW_VOLTAGE 7.30
#define BATTERY_SHUTDOWN_VOLTAGE 7.22

#define BATTERY_HYSTERESIS 0.05
#define BATTERY_READ_INTERVAL_MS 1000
#define BATTERY_SHUTDOWN_DELAY_MS 10000

float current_battery_voltage = 0.0;
battery_level_t current_battery_level = BATTERY_FULL;

uint32_t last_battery_read_ms = 0;
uint32_t battery_low_since_ms = 0;

// ------------------ DECLARATIONS ------------------

void load_settings(void);
void save_settings(void);

void init_rf24(void);
void read_rf24(void);
void apply_rf_packet(const tc_packet_t &packet);
void check_rf_timeout(void);
void print_rf_stats(void);

void update_timecode(void);
void increment_timecode(timecode_t &tc);
void decrement_timecode(timecode_t &tc);
timecode_t offset_timecode(const timecode_t &tc, int8_t offset_frames);

void read_hall(void);
bool is_slate_closed(bool raw_state);
void on_slate_closed(void);
void on_slate_open(void);
void update_state(void);
void update_close_markers(void);

void read_menu_buttons(void);
void handle_menu_press(void);
void adjust_menu_value(int8_t direction);

void mark_display_dirty(void);
void update_displays(void);
void update_matrix(void);
void update_oled(void);
char get_state_symbol(void);

void draw_timecode_to_matrix(const timecode_t &tc, bool draw_markers);
void draw_char_to_matrix(uint8_t x, char c);
void draw_close_markers(void);
const uint8_t *get_glyph(char c);
uint8_t get_glyph_width(char c);

void draw_oled_timecode(int16_t x, int16_t y, const timecode_t &tc, uint8_t scale);
void draw_oled_digit(int16_t x, int16_t y, char c, uint8_t scale);
void draw_oled_colon(int16_t x, int16_t y, uint8_t scale);
const uint8_t *get_oled_digit(char c);

uint8_t reverse_bits(uint8_t value);



class SlateServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer *server, NimBLEConnInfo &connInfo) override {
    ble_connected = true;
    Serial.println("BLE connected callback fired");
  }

  void onDisconnect(NimBLEServer *server, NimBLEConnInfo &connInfo, int reason) override {
    ble_connected = false;
    Serial.println("BLE disconnected callback fired");
    NimBLEDevice::startAdvertising();
  }
};

// ------------------ SETUP ------------------

void setup() {
  Serial.begin(115200);
  delay(3000);
  Serial.println();
  Serial.println("Feather slate starting");

  pinMode(HALL_PIN, INPUT_PULLUP);
  pinMode(MENU_LEFT_PIN, INPUT_PULLUP);
  pinMode(MENU_ENTER_PIN, INPUT_PULLUP);
  pinMode(MENU_RIGHT_PIN, INPUT_PULLUP);

  // SPI.begin(SCK, MISO, MOSI);
  Wire.begin();
  Wire.setClock(100000);

  load_settings();

  mx.begin();
  mx.control(MD_MAX72XX::INTENSITY, matrix_intensity);
  mx.control(MD_MAX72XX::UPDATE, MD_MAX72XX::OFF);
  mx.clear();
  mx.update();

  if (!oled.begin(OLED_I2C_ADDRESS, true)) {
    Serial.println("OLED init failed");
    while (true) {
    }
  }

  oled.clearDisplay();
  oled.display();

  if (!mma.begin()) {
    Serial.println("MMA8451 not found");
    while (1)
      ;
  }

  Serial.println("MMA8451 found");

  mma.setRange(MMA8451_RANGE_2_G);

  init_rf24();

  hall_state = digitalRead(HALL_PIN);
  last_hall_state = hall_state;
  last_raw_hall_state = hall_state;
  last_hall_change_ms = millis();

  if (is_slate_closed(hall_state)) {
    tc_frozen = offset_timecode(tc_live, slate_frame_offset);
    slate_state = STATE_CLOSED;
    closed_at_ms = millis();
  } else {
    slate_state = STATE_OPEN;
  }

  last_frame_us = micros();
  last_oled_refresh_ms = millis();
  last_rf_stats_ms = millis();

  analogReadResolution(12);
  analogSetPinAttenuation(BATTERY_ADC_PIN, ADC_11db);

  current_battery_voltage = read_battery_voltage();
  current_battery_level = get_battery_level(current_battery_voltage);

  setup_ble();

  mark_display_dirty();
  update_displays();
}

// ------------------ LOOP ------------------

void loop() {
  read_rf24();
  check_rf_timeout();
  update_timecode();
  read_hall();
  update_state();
  update_close_markers();
  read_menu_buttons();
  update_slate_orientation();
  update_battery_status();
  update_displays();
  print_rf_stats();
}

// ------------------ SETTINGS ------------------

void load_settings(void) {
  prefs.begin("slate", false);

  slate_frame_offset = prefs.getChar("offset", DEFAULT_FRAME_OFFSET);
  matrix_intensity = prefs.getUChar("bright", DEFAULT_MATRIX_INTENSITY);
  sleep_seconds = prefs.getUChar("sleep", DEFAULT_SLEEP_SECONDS);

  if (slate_frame_offset < -5 || slate_frame_offset > 5) {
    slate_frame_offset = DEFAULT_FRAME_OFFSET;
  }

  if (matrix_intensity > 15) {
    matrix_intensity = DEFAULT_MATRIX_INTENSITY;
  }

  bool sleep_valid = false;

  for (uint8_t i = 0; i < SLEEP_OPTION_COUNT; i++) {
    if (sleep_options[i] == sleep_seconds) {
      sleep_valid = true;
      break;
    }
  }

  if (!sleep_valid) {
    sleep_seconds = DEFAULT_SLEEP_SECONDS;
  }
}

void save_settings(void) {
  prefs.putChar("offset", slate_frame_offset);
  prefs.putUChar("bright", matrix_intensity);
  prefs.putUChar("sleep", sleep_seconds);
}

// ------------------ RF24 ------------------

void init_rf24(void) {
  if (!radio.begin()) {
    Serial.println("RF24 init failed");
    return;
  }

  radio.setPALevel(RF24_PA_MIN);
  radio.setDataRate(RF24_250KBPS);
  radio.setChannel(76);
  radio.setAutoAck(false);
  radio.disableAckPayload();
  radio.openReadingPipe(1, rf24_address);
  radio.startListening();

  Serial.println("RF24 RX ready");
}

void read_rf24(void) {
  while (radio.available()) {
    tc_packet_t packet;
    radio.read(&packet, sizeof(packet));
    apply_rf_packet(packet);
  }
}

void apply_rf_packet(const tc_packet_t &packet) {
  if (packet.sync_word != 0x54433031) {
    return;
  }

  if ((packet.flags & TC_FLAG_VALID) == 0) {
    return;
  }

  if (have_seen_first_master_frame) {
    int32_t frame_delta = (int32_t)(packet.frame_counter - last_master_frame_counter);

    if (frame_delta <= 0) {
      return;
    }

    if (frame_delta != MASTER_PACKET_FRAME_INTERVAL) {
      rf_bad_interval_count++;

      if (frame_delta > MASTER_PACKET_FRAME_INTERVAL) {
        rf_missed_frame_count += (uint32_t)(frame_delta - MASTER_PACKET_FRAME_INTERVAL);
      }
    }
  }

  rf_fps = (packet.fps > 0) ? packet.fps : FRAME_RATE;
  rf_drop_frame = ((packet.flags & TC_FLAG_DROP_FRAME) != 0);
  rf_reversed = ((packet.flags & TC_FLAG_REVERSED) != 0);
  rf_signal_present = ((packet.flags & TC_FLAG_SIGNAL) != 0);

  last_rf_sequence = packet.sequence;
  last_rf_rx_ms = millis();
  last_rf_rx_us = micros();
  rf_rx_count++;

  last_master_frame_counter = packet.frame_counter;
  last_master_frame_decode_us = packet.frame_decode_us;
  last_master_tx_us = packet.tx_us;

  tc_live.h = packet.hours;
  tc_live.m = packet.minutes;
  tc_live.s = packet.seconds;
  tc_live.f = packet.frames;

  local_frame_counter = packet.frame_counter;
  last_frame_us = last_rf_rx_us;

  have_seen_first_master_frame = true;

  if (slate_state == STATE_OPEN || slate_state == STATE_SLEEP) {
    mark_display_dirty();
  }
}

void check_rf_timeout(void) {
  if (rf_signal_present && (millis() - last_rf_rx_ms > RF24_TIMEOUT_MS)) {
    rf_signal_present = false;
    Serial.println("RF timeout - free-running");
    last_frame_us = micros();
    mark_display_dirty();
  }
}

void print_rf_stats(void) {
  if (millis() - last_rf_stats_ms >= 1000) {
    last_rf_stats_ms += 1000;

    // Serial.print("RF packets/sec: ");
    // Serial.print(rf_rx_count);

    // Serial.print("  missed frames: ");
    // Serial.print(rf_missed_frame_count);

    // Serial.print("  bad intervals: ");
    // Serial.println(rf_bad_interval_count);

    rf_rx_count = 0;
    rf_missed_frame_count = 0;
    rf_bad_interval_count = 0;
  }
}

// ------------------ TIMECODE ------------------

void update_timecode(void) {
  uint32_t now_us = micros();
  uint8_t active_fps = (rf_fps > 0) ? rf_fps : FRAME_RATE;
  uint32_t frame_interval_us = 1000000UL / active_fps;

  while ((uint32_t)(now_us - last_frame_us) >= frame_interval_us) {
    last_frame_us += frame_interval_us;

    increment_timecode(tc_live);
    local_frame_counter++;

    if (slate_state == STATE_OPEN || slate_state == STATE_SLEEP) {
      mark_display_dirty();
    }
  }
}

void increment_timecode(timecode_t &tc) {
  uint8_t active_fps = (rf_fps > 0) ? rf_fps : FRAME_RATE;

  tc.f++;

  if (tc.f >= active_fps) {
    tc.f = 0;
    tc.s++;
  }

  if (tc.s >= 60) {
    tc.s = 0;
    tc.m++;
  }

  if (tc.m >= 60) {
    tc.m = 0;
    tc.h++;
  }

  if (tc.h >= 24) {
    tc.h = 0;
  }
}

void decrement_timecode(timecode_t &tc) {
  uint8_t active_fps = (rf_fps > 0) ? rf_fps : FRAME_RATE;

  if (tc.f > 0) {
    tc.f--;
    return;
  }

  tc.f = active_fps - 1;

  if (tc.s > 0) {
    tc.s--;
    return;
  }

  tc.s = 59;

  if (tc.m > 0) {
    tc.m--;
    return;
  }

  tc.m = 59;

  if (tc.h > 0) {
    tc.h--;
    return;
  }

  tc.h = 23;
}

timecode_t offset_timecode(const timecode_t &tc, int8_t offset_frames) {
  timecode_t out = tc;

  while (offset_frames > 0) {
    increment_timecode(out);
    offset_frames--;
  }

  while (offset_frames < 0) {
    decrement_timecode(out);
    offset_frames++;
  }

  return out;
}

// ------------------ HALL ------------------

void read_hall(void) {
  bool raw_state = digitalRead(HALL_PIN);
  uint32_t now_ms = millis();

  if (raw_state != last_raw_hall_state) {
    last_raw_hall_state = raw_state;
    last_hall_change_ms = now_ms;
  }

  if (raw_state != hall_state && (now_ms - last_hall_change_ms >= HALL_DEBOUNCE_MS)) {
    hall_state = raw_state;

    if (is_slate_closed(hall_state)) {
      on_slate_closed();
    } else {
      on_slate_open();
    }

    last_hall_state = hall_state;
  }
}

bool is_slate_closed(bool raw_state) {
  if (HALL_CLOSED_STATE_HIGH) {
    return (raw_state == HIGH);
  }

  return (raw_state == LOW);
}

void on_slate_closed(void) {
  send_slate_ble_event("close");
  tc_frozen = offset_timecode(tc_live, slate_frame_offset);
  closed_at_ms = millis();
  slate_state = STATE_CLOSED;

  flash_close_markers = true;
  close_markers_started_us = micros();

  mark_display_dirty();
}

void on_slate_open(void) {
  send_slate_ble_event("open");
  slate_state = STATE_OPEN;
  mx.control(MD_MAX72XX::SHUTDOWN, MD_MAX72XX::OFF);
  flash_close_markers = false;

  mark_display_dirty();
}

void update_close_markers(void) {
  uint8_t active_fps = (rf_fps > 0) ? rf_fps : FRAME_RATE;
  uint32_t frame_interval_us = 1000000UL / active_fps;

  if (flash_close_markers) {
    if ((uint32_t)(micros() - close_markers_started_us) >= frame_interval_us) {
      flash_close_markers = false;
      mark_display_dirty();
    }
  }
}

// ------------------ MENU ------------------

void read_menu_buttons(void) {
  if (millis() - last_button_read_ms < BUTTON_DEBOUNCE_MS) {
    return;
  }

  last_button_read_ms = millis();

  bool left_state = digitalRead(MENU_LEFT_PIN);
  bool enter_state = digitalRead(MENU_ENTER_PIN);
  bool right_state = digitalRead(MENU_RIGHT_PIN);

  bool left_pressed = (last_left_state == HIGH && left_state == LOW);
  bool enter_pressed = (last_enter_state == HIGH && enter_state == LOW);
  bool right_pressed = (last_right_state == HIGH && right_state == LOW);

  last_left_state = left_state;
  last_enter_state = enter_state;
  last_right_state = right_state;

  if (enter_pressed) {
    handle_menu_press();
  }

  if (menu_active && left_pressed) {
    adjust_menu_value(-1);
  }

  if (menu_active && right_pressed) {
    adjust_menu_value(1);
  }
}

void handle_menu_press(void) {
  if (!menu_active) {
    menu_active = true;
    current_menu_item = MENU_FRAME_OFFSET;
  } else {
    current_menu_item++;

    if (current_menu_item >= MENU_ITEM_COUNT) {
      menu_active = false;
      save_settings();
    }
  }

  mark_display_dirty();
}

void adjust_menu_value(int8_t direction) {
  switch (current_menu_item) {
    case MENU_FRAME_OFFSET:
      slate_frame_offset += direction;
      if (slate_frame_offset < -5) slate_frame_offset = -5;
      if (slate_frame_offset > 5) slate_frame_offset = 5;
      break;

    case MENU_BRIGHTNESS:
      if (direction > 0 && matrix_intensity < 15) matrix_intensity++;
      if (direction < 0 && matrix_intensity > 0) matrix_intensity--;
      mx.control(MD_MAX72XX::INTENSITY, matrix_intensity);
      break;

    case MENU_SLEEP_TIME:
      uint8_t current_index = 0;

      for (uint8_t i = 0; i < SLEEP_OPTION_COUNT; i++) {
        if (sleep_options[i] == sleep_seconds) {
          current_index = i;
          break;
        }
      }

      if (direction > 0 && current_index < SLEEP_OPTION_COUNT - 1) {
        current_index++;
      }

      if (direction < 0 && current_index > 0) {
        current_index--;
      }

      sleep_seconds = sleep_options[current_index];
      break;
  }

  save_settings();
  mark_display_dirty();
}

// ------------------ STATE MACHINE ------------------

void update_state(void) {
  if (slate_state == STATE_CLOSED) {
    if (sleep_seconds > 0 && (millis() - closed_at_ms >= ((uint32_t)sleep_seconds * 1000UL))) {
      slate_state = STATE_SLEEP;
      mx.control(MD_MAX72XX::SHUTDOWN, MD_MAX72XX::ON);
      mark_display_dirty();
    }
  }
}

// ------------------ DISPLAY ------------------

void mark_display_dirty(void) {
  matrix_dirty = true;
  oled_dirty = true;
}

char get_state_symbol(void) {
  switch (slate_state) {
    case STATE_OPEN: return '>';
    case STATE_CLOSED: return '=';
    case STATE_SLEEP: return 'Z';
  }

  return '?';
}

void update_displays(void) {
  if (matrix_dirty) {
    update_matrix();
    matrix_dirty = false;
  }

  if (millis() - last_oled_refresh_ms >= OLED_REFRESH_MS) {
    last_oled_refresh_ms = millis();

    if (oled_dirty) {
      update_oled();
      oled_dirty = false;
    }
  }
}

void update_matrix(void) {
  if (slate_state == STATE_SLEEP) {
    return;
  }

  if (slate_state == STATE_OPEN) {
    timecode_t display_tc = offset_timecode(tc_live, slate_frame_offset);
    draw_timecode_to_matrix(display_tc, false);
  } else {
    draw_timecode_to_matrix(tc_frozen, flash_close_markers);
  }
}

void update_oled(void) {
  oled.clearDisplay();
  oled.setTextColor(SH110X_WHITE);

  if (menu_active) {
    oled.setTextSize(1);
    oled.setCursor(0, 0);

    switch (current_menu_item) {
      case MENU_FRAME_OFFSET:
        oled.println("Frame Offset");
        oled.setCursor(0, 24);
        oled.print(slate_frame_offset > 0 ? "+" : "");
        oled.print(slate_frame_offset);
        oled.print(" fr");
        break;

      case MENU_BRIGHTNESS:
        oled.println("Brightness");
        oled.setCursor(0, 24);
        oled.print(matrix_intensity);
        oled.print(" / 15");
        break;

      case MENU_SLEEP_TIME:
        oled.println("Sleep Secs");
        oled.setCursor(0, 24);
        if (sleep_seconds == 0) {
          oled.print("Never");
        } else {
          oled.print(sleep_seconds);
          oled.print(" sec");
        }
        break;
    }

    oled.setTextSize(1);
    oled.setCursor(0, 56);
    oled.print("< > adjust enter=next");

    oled.display();
    return;
  }

  timecode_t display_tc = (slate_state == STATE_CLOSED)
                            ? tc_frozen
                            : offset_timecode(tc_live, slate_frame_offset);

  draw_oled_timecode(OLED_TC_X, OLED_TC_Y, display_tc, OLED_TC_SCALE);

  oled.setTextSize(1);
  oled.setCursor(0, 22);

  char status_line[24];
  snprintf(
    status_line,
    sizeof(status_line),
    "%ufps %c %s",
    rf_fps,
    get_state_symbol(),
    rf_signal_present ? "RF" : "--");
  oled.print(status_line);

  oled.setTextSize(1);
  oled.setCursor(0, 54);
  oled.print("Press enter for menu");

  drawBatteryIndicator(108, 1);

  oled.display();
}

// ------------------ MATRIX FONT RENDERING ------------------

void draw_timecode_to_matrix(const timecode_t &tc, bool draw_markers) {
  char buffer[12];

  snprintf(
    buffer,
    sizeof(buffer),
    "%02u:%02u:%02u:%02u",
    tc.h,
    tc.m,
    tc.s,
    tc.f);

  mx.clear();

  uint8_t x = TIMECODE_X_OFFSET;

  for (uint8_t i = 0; i < 11; i++) {
    char c = buffer[i];

    draw_char_to_matrix(x, c);

    if (c == ':') {
      x += COLON_ADVANCE;
    } else {
      x += DIGIT_ADVANCE;
    }
  }

  if (draw_markers) {
    draw_close_markers();
  }

  mx.update();
}

uint8_t reverse_bits(uint8_t value) {
  value = (value & 0xF0) >> 4 | (value & 0x0F) << 4;
  value = (value & 0xCC) >> 2 | (value & 0x33) << 2;
  value = (value & 0xAA) >> 1 | (value & 0x55) << 1;

  return value;
}

void draw_char_to_matrix(uint8_t x, char c) {
  const uint8_t *glyph = get_glyph(c);
  uint8_t glyph_width = get_glyph_width(c);

  for (uint8_t col = 0; col < glyph_width; col++) {
    uint8_t matrix_col = x + col;

    if (matrix_col < MATRIX_PIXEL_WIDTH) {
      if (slate_inverted) {
        mx.setColumn(matrix_col, reverse_bits(glyph[col]));
      } else {
        mx.setColumn((MATRIX_PIXEL_WIDTH - 1) - matrix_col, glyph[col]);
      }
    }
  }
}

void draw_close_markers(void) {
  const uint8_t block_2x2 = 0x18;

  for (uint8_t col = 0; col < 2; col++) {
    mx.setColumn((MATRIX_PIXEL_WIDTH - 1) - col, block_2x2);
  }

  for (uint8_t col = MATRIX_PIXEL_WIDTH - 2; col < MATRIX_PIXEL_WIDTH; col++) {
    mx.setColumn((MATRIX_PIXEL_WIDTH - 1) - col, block_2x2);
  }
}

const uint8_t *get_glyph(char c) {
  switch (c) {
    case '0': return glyph_0;
    case '1': return glyph_1;
    case '2': return glyph_2;
    case '3': return glyph_3;
    case '4': return glyph_4;
    case '5': return glyph_5;
    case '6': return glyph_6;
    case '7': return glyph_7;
    case '8': return glyph_8;
    case '9': return glyph_9;
    case ':': return glyph_colon;
    default: return glyph_blank;
  }
}

uint8_t get_glyph_width(char c) {
  switch (c) {
    case ':':
      return COLON_WIDTH;
    default:
      return DIGIT_WIDTH;
  }
}

// ------------------ OLED TIMECODE RENDERING ------------------

void draw_oled_timecode(int16_t x, int16_t y, const timecode_t &tc, uint8_t scale) {
  char buffer[12];

  snprintf(
    buffer,
    sizeof(buffer),
    "%02u:%02u:%02u:%02u",
    tc.h,
    tc.m,
    tc.s,
    tc.f);

  int16_t cursor_x = x;

  for (uint8_t i = 0; i < 11; i++) {
    if (buffer[i] == ':') {
      draw_oled_colon(cursor_x, y, scale);
      cursor_x += (OLED_COLON_WIDTH * scale) + OLED_COLON_SPACING;
    } else {
      draw_oled_digit(cursor_x, y, buffer[i], scale);
      cursor_x += (OLED_DIGIT_WIDTH * scale) + OLED_DIGIT_SPACING;
    }
  }
}

void draw_oled_digit(int16_t x, int16_t y, char c, uint8_t scale) {
  const uint8_t *glyph = get_oled_digit(c);

  if (glyph == nullptr) {
    return;
  }

  for (uint8_t col = 0; col < OLED_DIGIT_WIDTH; col++) {
    for (uint8_t row = 0; row < 5; row++) {
      if (glyph[col] & (1 << row)) {
        oled.fillRect(
          x + (col * scale),
          y + (row * scale),
          scale,
          scale,
          SH110X_WHITE);
      }
    }
  }
}

void draw_oled_colon(int16_t x, int16_t y, uint8_t scale) {
  int16_t upper_y = y + (1 * scale);
  int16_t lower_y = y + (3 * scale);

  oled.fillRect(x, upper_y, scale, scale, SH110X_WHITE);
  oled.fillRect(x, lower_y, scale, scale, SH110X_WHITE);
}

const uint8_t *get_oled_digit(char c) {
  switch (c) {
    case '0': return oled_digit_0;
    case '1': return oled_digit_1;
    case '2': return oled_digit_2;
    case '3': return oled_digit_3;
    case '4': return oled_digit_4;
    case '5': return oled_digit_5;
    case '6': return oled_digit_6;
    case '7': return oled_digit_7;
    case '8': return oled_digit_8;
    case '9': return oled_digit_9;
    default: return nullptr;
  }
}

// float read_battery_voltage(void) {
//   const uint8_t samples = 16;
//   uint32_t total = 0;

//   for (uint8_t i = 0; i < samples; i++) {
//     total += analogRead(BATTERY_ADC_PIN);
//     delayMicroseconds(250);
//   }

//   float raw = total / (float)samples;
//   float adc_voltage = (raw / 4095.0) * adc_ref_voltage;
//   float battery_voltage = adc_voltage * ((battery_r1 + battery_r2) / battery_r2);

//   return battery_voltage;
// }
float read_battery_voltage(void) {
  const uint8_t samples = 16;
  uint32_t total = 0;

  for (uint8_t i = 0; i < samples; i++) {
    total += analogRead(BATTERY_ADC_PIN);
    delayMicroseconds(250);
  }

  float raw = total / (float)samples;
  float adc_voltage = (raw / 4095.0) * adc_ref_voltage;
  float battery_voltage = adc_voltage * ((battery_r1 + battery_r2) / battery_r2);

  // Serial.print("ADC raw: ");
  // Serial.print(raw);
  // Serial.print("  ADC volts: ");
  // Serial.print(adc_voltage, 3);
  // Serial.print("  Battery volts: ");
  // Serial.println(battery_voltage, 3);

  return battery_voltage;
}

battery_level_t get_battery_level(float v) {
  if (v >= BATTERY_FULL_VOLTAGE) return BATTERY_FULL;
  if (v >= BATTERY_MEDIUM_VOLTAGE) return BATTERY_MEDIUM;
  if (v >= BATTERY_LOW_VOLTAGE) return BATTERY_LOW;

  return BATTERY_EMPTY;
}

battery_level_t update_battery_level(float v) {
  switch (current_battery_level) {
    case BATTERY_FULL:
      if (v < BATTERY_FULL_VOLTAGE - BATTERY_HYSTERESIS) {
        current_battery_level = BATTERY_MEDIUM;
      }
      break;

    case BATTERY_MEDIUM:
      if (v >= BATTERY_FULL_VOLTAGE + BATTERY_HYSTERESIS) {
        current_battery_level = BATTERY_FULL;
      } else if (v < BATTERY_MEDIUM_VOLTAGE - BATTERY_HYSTERESIS) {
        current_battery_level = BATTERY_LOW;
      }
      break;

    case BATTERY_LOW:
      if (v >= BATTERY_MEDIUM_VOLTAGE + BATTERY_HYSTERESIS) {
        current_battery_level = BATTERY_MEDIUM;
      } else if (v < BATTERY_LOW_VOLTAGE - BATTERY_HYSTERESIS) {
        current_battery_level = BATTERY_EMPTY;
      }
      break;

    case BATTERY_EMPTY:
      if (v >= BATTERY_LOW_VOLTAGE + BATTERY_HYSTERESIS) {
        current_battery_level = BATTERY_LOW;
      }
      break;
  }

  return current_battery_level;
}

void update_battery_status(void) {
  uint32_t now_ms = millis();

  if (now_ms - last_battery_read_ms < BATTERY_READ_INTERVAL_MS) {
    return;
  }

  last_battery_read_ms = now_ms;

  current_battery_voltage = read_battery_voltage();
  current_battery_level = update_battery_level(current_battery_voltage);

  // Serial.print("Battery voltage calculated: ");
  // Serial.println(current_battery_voltage, 3);

  oled_dirty = true;

  if (should_shutdown_for_battery(current_battery_voltage)) {
    shutdown_for_low_battery();
  }
}

bool should_shutdown_for_battery(float v) {
  if (v < BATTERY_SHUTDOWN_VOLTAGE) {
    if (battery_low_since_ms == 0) {
      battery_low_since_ms = millis();
    }

    return millis() - battery_low_since_ms >= BATTERY_SHUTDOWN_DELAY_MS;
  }

  battery_low_since_ms = 0;
  return false;
}

void shutdown_for_low_battery(void) {
  mx.clear();
  mx.update();
  mx.control(MD_MAX72XX::SHUTDOWN, MD_MAX72XX::ON);

  oled.clearDisplay();
  oled.setTextColor(SH110X_WHITE);
  oled.setTextSize(1);
  oled.setCursor(0, 20);
  oled.println("BATTERY LOW");
  oled.setCursor(0, 34);
  oled.println("Shutting down");
  oled.display();

  delay(2000);

  oled.clearDisplay();
  oled.display();

  esp_deep_sleep_start();
}

void drawBatteryIndicator(int x, int y) {
  const int body_w = 18;
  const int body_h = 32;
  const int cap_w = 6;
  const int cap_h = 4;

  const int inner_x = x + 2;
  const int inner_y = y + cap_h + 2;
  const int inner_w = body_w - 4;
  const int inner_h = body_h - 4;

  const int segment_gap = 2;
  const int segment_h = 8;
  const int segment_w = inner_w;

  oled.drawRect(x, y + cap_h, body_w, body_h, SH110X_WHITE);
  oled.fillRect(x + (body_w - cap_w) / 2, y - 1, cap_w, cap_h, SH110X_WHITE);

  for (int i = 0; i < current_battery_level; i++) {
    int segment_x = inner_x;
    int segment_y = inner_y + inner_h - segment_h - (i * (segment_h + segment_gap));

    oled.fillRect(segment_x, segment_y, segment_w, segment_h, SH110X_WHITE);
  }

  if (current_battery_voltage < BATTERY_SHUTDOWN_VOLTAGE) {
    oled.setCursor(x - 1, y + cap_h + body_h + 4);
    oled.setTextSize(1);
    oled.print("LOW");
  }
}

void update_slate_orientation() {
  unsigned long now = millis();

  if (now - last_accel_read_ms < ACCEL_READ_INTERVAL_MS) {
    return;
  }

  last_accel_read_ms = now;

  sensors_event_t event;
  mma.getEvent(&event);

  float y = event.acceleration.y;

  // Serial.print("y:");
  // Serial.println(y);

  // Y points down when right-way-up.
  // Use threshold so small movements don't flicker the display.
  if (y > ACCEL_INVERT_THRESHOLD) {
    slate_inverted = 0;
  } else if (y < -ACCEL_INVERT_THRESHOLD) {
    slate_inverted = 1;
  }
}

void setup_ble() {
  NimBLEDevice::init("Digital Slate");

  NimBLEServer *server = NimBLEDevice::createServer();
  server->setCallbacks(new SlateServerCallbacks());

  NimBLEService *service = server->createService(BLE_SERVICE_UUID);

  ble_event_characteristic = service->createCharacteristic(
    BLE_EVENT_UUID,
    NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);

  ble_event_characteristic->setValue("{\"type\":\"ready\"}");

  service->start();

  NimBLEAdvertising *advertising = NimBLEDevice::getAdvertising();
  advertising->addServiceUUID(BLE_SERVICE_UUID);
  advertising->setName("Digital Slate");
  advertising->start();
}

void send_slate_ble_event(const char *event_type) {
  Serial.print("Slate event detected: ");
  Serial.println(event_type);

  Serial.print("ble_connected = ");
  Serial.println(ble_connected ? "true" : "false");

  Serial.print("ble_event_characteristic = ");
  Serial.println(ble_event_characteristic == nullptr ? "null" : "ok");

  if (!ble_connected || ble_event_characteristic == nullptr) {
    return;
  }

  char payload[160];

  timecode_t display_tc = offset_timecode(tc_live, slate_frame_offset);

  snprintf(
    payload,
    sizeof(payload),
    "{\"type\":\"%s\",\"device_id\":\"slate-a\",\"timecode\":\"%02d:%02d:%02d:%02d\",\"battery_voltage\":%.2f,\"inverted\":%d}",
    event_type,
    display_tc.h,
    display_tc.m,
    display_tc.s,
    display_tc.f,
    read_battery_voltage(),
    (slate_inverted)?0:1
    );

  ble_event_characteristic->setValue(payload);
  ble_event_characteristic->notify();

  Serial.println(payload);
}