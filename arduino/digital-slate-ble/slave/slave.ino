#include <Arduino.h>
#include <SPI.h>
#include <Wire.h>
#include <RF24.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_MAX1704X.h>
#include <Adafruit_LC709203F.h>

// ------------------ CONFIG ------------------

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_I2C_ADDRESS 0x3C

#define OLED_REFRESH_MS 100

#define FRAME_RATE 25
#define RF24_TIMEOUT_MS 600

#define RF24_CE_PIN 13
#define RF24_CSN_PIN 12

#define LTC_OUTPUT_PIN 9

Adafruit_SSD1306 oled(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);
RF24 radio(RF24_CE_PIN, RF24_CSN_PIN);
const byte rf24_address[6] = "TC001";

// ------------------ TIMECODE ------------------

struct timecode_t {
  uint8_t h = 0;
  uint8_t m = 0;
  uint8_t s = 0;
  uint8_t f = 0;
};

timecode_t tc_live;

uint32_t last_frame_us = 0;
uint32_t last_oled_refresh_ms = 0;

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
uint32_t last_rf_sequence = 0;

// timing/diagnostic fields from master
uint32_t last_master_frame_counter = 0;
uint32_t last_master_frame_decode_us = 0;
uint32_t last_master_tx_us = 0;
bool have_seen_first_master_frame = false;

uint32_t local_frame_counter = 0;

// RF diagnostics
uint32_t rf_rx_count = 0;
uint32_t rf_missed_frame_count = 0;
uint32_t last_rf_stats_ms = 0;
uint32_t last_rf_rx_us = 0;

// ------------------ LTC TIMER STATE ------------------

hw_timer_t *ltc_timer = nullptr;
portMUX_TYPE ltc_timer_mux = portMUX_INITIALIZER_UNLOCKED;

volatile uint8_t ltc_active_frame[10] = { 0 };
volatile uint8_t ltc_pending_frame[10] = { 0 };
volatile bool ltc_pending_valid = false;

volatile uint8_t ltc_bit_index = 0;   // 0..79
volatile bool ltc_half_cell = false;  // false = first half, true = second half
volatile bool ltc_output_state = false;

uint8_t current_ltc_fps = FRAME_RATE;
uint32_t current_ltc_halfcell_hz = FRAME_RATE * 160UL;

// ------------------ OLED NARROW FONT ------------------

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

#define OLED_TC_X 0
#define OLED_TC_Y 24
#define OLED_TC_SCALE 3
#define OLED_DIGIT_WIDTH 3
#define OLED_DIGIT_SPACING 1
#define OLED_COLON_WIDTH 1
#define OLED_COLON_SPACING 1

// ------------------ BATTERY INDICATOR ------------------

Adafruit_MAX17048 max17048;
Adafruit_LC709203F lc709203f;

enum BatteryMonitorType {
  BATTERY_NONE,
  BATTERY_MAX17048,
  BATTERY_LC709203F
};

BatteryMonitorType battery_monitor_type = BATTERY_NONE;

float battery_percent = -1;
float battery_voltage = -1;

// ------------------ FUNCTION DECLARATIONS ------------------

void init_rf24(void);
void read_rf24(void);
void apply_rf_packet(const tc_packet_t &packet);
void check_rf_timeout(void);
void print_rf_stats(void);

void update_timecode(void);
void increment_timecode(timecode_t &tc);

void init_ltc_output(void);
void restart_ltc_timer(uint8_t fps);
void queue_ltc_frame_update(void);
void build_ltc_frame_from_timecode(const timecode_t &tc, bool drop_frame, uint8_t *frame_bytes);
void update_ltc_timer_rate_if_needed(void);
void clear_ltc_pending_state(void);
void ARDUINO_ISR_ATTR on_ltc_timer(void);

void update_oled(void);
void draw_oled_timecode(int16_t x, int16_t y, const timecode_t &tc, uint8_t scale);
void draw_oled_digit(int16_t x, int16_t y, char c, uint8_t scale);
void draw_oled_colon(int16_t x, int16_t y, uint8_t scale);
const uint8_t *get_oled_digit(char c);

// ------------------ SETUP ------------------

void setup() {
  Serial.begin(115200);
  // delay(1000);
  Serial.println();
  Serial.println("Slave starting");

  pinMode(LTC_OUTPUT_PIN, OUTPUT);
  digitalWrite(LTC_OUTPUT_PIN, LOW);

  SPI.begin(SCK, MISO, MOSI);
  Wire.begin();

  if (!oled.begin(SSD1306_SWITCHCAPVCC, OLED_I2C_ADDRESS)) {
    Serial.println("OLED init failed");
    while (true) {
    }
  }

  oled.clearDisplay();
  oled.display();

  init_rf24();
  init_ltc_output();

  last_frame_us = micros();
  last_oled_refresh_ms = millis();
  last_rf_stats_ms = millis();

  setupBatteryMonitor();

  update_oled();
}

// ------------------ LOOP ------------------

void loop() {
  read_rf24();
  check_rf_timeout();
  update_timecode();
  update_ltc_timer_rate_if_needed();

  if (millis() - last_oled_refresh_ms >= OLED_REFRESH_MS) {
    last_oled_refresh_ms = millis();
    update_oled();
  }

  // print_rf_stats();
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

  int32_t frame_error = 0;

  if (have_seen_first_master_frame) {
    frame_error = (int32_t)(packet.frame_counter - local_frame_counter);
  }


  tc_live.h = packet.hours;
  tc_live.m = packet.minutes;
  tc_live.s = packet.seconds;
  tc_live.f = packet.frames;

  local_frame_counter = packet.frame_counter;
  last_rf_rx_us = micros();
  last_frame_us = last_rf_rx_us;

  clear_ltc_pending_state();
  queue_ltc_frame_update();

  rf_fps = (packet.fps > 0) ? packet.fps : FRAME_RATE;
  rf_drop_frame = ((packet.flags & TC_FLAG_DROP_FRAME) != 0);
  rf_reversed = ((packet.flags & TC_FLAG_REVERSED) != 0);
  rf_signal_present = ((packet.flags & TC_FLAG_SIGNAL) != 0);

  last_rf_sequence = packet.sequence;
  last_rf_rx_ms = millis();
  last_rf_rx_us = micros();
  last_frame_us = last_rf_rx_us;
  rf_rx_count++;

  last_master_frame_counter = packet.frame_counter;
  last_master_frame_decode_us = packet.frame_decode_us;
  last_master_tx_us = packet.tx_us;
  have_seen_first_master_frame = true;

  clear_ltc_pending_state();
  queue_ltc_frame_update();

  Serial.print("RF RX ");
  Serial.print(tc_live.h);
  Serial.print(":");
  if (tc_live.m < 10) Serial.print("0");
  Serial.print(tc_live.m);
  Serial.print(":");
  if (tc_live.s < 10) Serial.print("0");
  Serial.print(tc_live.s);
  Serial.print(rf_drop_frame ? ";" : ":");
  if (tc_live.f < 10) Serial.print("0");
  Serial.print(tc_live.f);
  Serial.print(" fc=");
  Serial.print(last_master_frame_counter);
  Serial.print(" seq=");
  Serial.println(last_rf_sequence);
}

void check_rf_timeout(void) {
  if (rf_signal_present && (millis() - last_rf_rx_ms > RF24_TIMEOUT_MS)) {
    rf_signal_present = false;
    Serial.println("RF timeout");
  }
}

void print_rf_stats(void) {
  if (millis() - last_rf_stats_ms >= 1000) {
    last_rf_stats_ms += 1000;
    Serial.print("RF packets/sec: ");
    Serial.print(rf_rx_count);
    Serial.print("  missed frames: ");
    Serial.println(rf_missed_frame_count);
    rf_rx_count = 0;
    rf_missed_frame_count = 0;
  }
}

// ------------------ TIMECODE FREE-RUN ------------------

void update_timecode(void) {
  uint32_t now_us = micros();
  uint8_t active_fps = (rf_fps > 0) ? rf_fps : FRAME_RATE;
  uint32_t frame_interval_us = 1000000UL / active_fps;

  while ((uint32_t)(now_us - last_frame_us) >= frame_interval_us) {
    last_frame_us += frame_interval_us;

    increment_timecode(tc_live);
    local_frame_counter++;
    queue_ltc_frame_update();
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

// ------------------ LTC OUTPUT ------------------

void init_ltc_output(void) {
  uint8_t initial_frame[10];
  build_ltc_frame_from_timecode(tc_live, false, initial_frame);

  noInterrupts();
  for (uint8_t i = 0; i < 10; i++) {
    ltc_active_frame[i] = initial_frame[i];
    ltc_pending_frame[i] = initial_frame[i];
  }
  ltc_pending_valid = false;
  ltc_bit_index = 0;
  ltc_half_cell = false;
  ltc_output_state = false;
  interrupts();

  current_ltc_fps = (rf_fps > 0) ? rf_fps : FRAME_RATE;
  restart_ltc_timer(current_ltc_fps);

  Serial.println("LTC output ready");
}

void restart_ltc_timer(uint8_t fps) {
  if (fps == 0) {
    fps = FRAME_RATE;
  }

  current_ltc_fps = fps;
  current_ltc_halfcell_hz = (uint32_t)fps * 160UL;

  if (ltc_timer != nullptr) {
    timerEnd(ltc_timer);
    ltc_timer = nullptr;
  }

  ltc_timer = timerBegin(current_ltc_halfcell_hz);

  if (ltc_timer == nullptr) {
    Serial.println("LTC timer init failed");
    return;
  }

  timerAttachInterrupt(ltc_timer, &on_ltc_timer);
  timerAlarm(ltc_timer, 1, true, 0);
}

void update_ltc_timer_rate_if_needed(void) {
  uint8_t wanted_fps = (rf_fps > 0) ? rf_fps : FRAME_RATE;

  if (wanted_fps != current_ltc_fps) {
    restart_ltc_timer(wanted_fps);
  }
}

void clear_ltc_pending_state(void) {
  noInterrupts();
  ltc_pending_valid = false;
  interrupts();
}

void queue_ltc_frame_update(void) {
  uint8_t frame_bytes[10];
  build_ltc_frame_from_timecode(tc_live, rf_drop_frame, frame_bytes);

  noInterrupts();
  for (uint8_t i = 0; i < 10; i++) {
    ltc_pending_frame[i] = frame_bytes[i];
  }
  ltc_pending_valid = true;
  interrupts();
}

void build_ltc_frame_from_timecode(const timecode_t &tc, bool drop_frame, uint8_t *frame_bytes) {
  frame_bytes[0] = (tc.h / 10) & 0x03;
  frame_bytes[1] = (tc.h % 10) & 0x0F;

  frame_bytes[2] = (tc.m / 10) & 0x07;
  frame_bytes[3] = (tc.m % 10) & 0x0F;

  frame_bytes[4] = (tc.s / 10) & 0x07;
  frame_bytes[5] = (tc.s % 10) & 0x0F;

  frame_bytes[6] = (tc.f / 10) & 0x03;
  if (drop_frame) {
    frame_bytes[6] |= 0x04;
  }

  frame_bytes[7] = (tc.f % 10) & 0x0F;

  frame_bytes[8] = 0xBF;
  frame_bytes[9] = 0xFC;
}

void ARDUINO_ISR_ATTR on_ltc_timer(void) {
  portENTER_CRITICAL_ISR(&ltc_timer_mux);

  if (ltc_bit_index == 0 && !ltc_half_cell && ltc_pending_valid) {
    for (uint8_t i = 0; i < 10; i++) {
      ltc_active_frame[i] = ltc_pending_frame[i];
    }
    ltc_pending_valid = false;
  }

  uint8_t wire_byte_index = 9 - (ltc_bit_index >> 3);
  uint8_t bit_mask = 1 << (ltc_bit_index & 0x07);
  bool current_bit = ((ltc_active_frame[wire_byte_index] & bit_mask) != 0);

  if (!ltc_half_cell) {
    ltc_output_state = !ltc_output_state;
    gpio_set_level((gpio_num_t)LTC_OUTPUT_PIN, ltc_output_state);
    ltc_half_cell = true;
  } else {
    if (current_bit) {
      ltc_output_state = !ltc_output_state;
      gpio_set_level((gpio_num_t)LTC_OUTPUT_PIN, ltc_output_state);
    }

    ltc_half_cell = false;
    ltc_bit_index++;

    if (ltc_bit_index >= 80) {
      ltc_bit_index = 0;
    }
  }

  portEXIT_CRITICAL_ISR(&ltc_timer_mux);
}

// ------------------ OLED ------------------

void update_oled(void) {
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);

  oled.setTextSize(2);
  oled.setCursor(0, 0);

  if (rf_signal_present) {
    oled.println("JAM");
  } else {
    oled.println("HOLD");
  }

  draw_oled_timecode(OLED_TC_X, OLED_TC_Y, tc_live, OLED_TC_SCALE);

  oled.setTextSize(2);
  oled.setCursor(0, 48);

  char status_line[24];
  snprintf(
    status_line,
    sizeof(status_line),
    "%ufps %s",
    rf_fps,
    rf_signal_present ? "RF" : "--");
  oled.print(status_line);

  updateBatteryInfo();
  drawBatteryIndicator(108, 6);

  oled.display();
}

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
          SSD1306_WHITE);
      }
    }
  }
}

void draw_oled_colon(int16_t x, int16_t y, uint8_t scale) {
  int16_t upper_y = y + (1 * scale);
  int16_t lower_y = y + (3 * scale);

  oled.fillRect(x, upper_y, scale, scale, SSD1306_WHITE);
  oled.fillRect(x, lower_y, scale, scale, SSD1306_WHITE);
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

void updateBatteryInfo() {
  switch (battery_monitor_type) {
    case BATTERY_MAX17048:
      battery_percent = max17048.cellPercent();
      battery_voltage = max17048.cellVoltage();
      break;

    case BATTERY_LC709203F:
      battery_percent = lc709203f.cellPercent();
      battery_voltage = lc709203f.cellVoltage();
      break;

    default:
      battery_percent = -1;
      battery_voltage = -1;
      break;
  }

  if (battery_percent > 100) battery_percent = 100;
  if (battery_percent < 0 && battery_monitor_type != BATTERY_NONE) battery_percent = 0;
}

void setupBatteryMonitor() {
  if (max17048.begin()) {
    battery_monitor_type = BATTERY_MAX17048;
    return;
  }

  if (lc709203f.begin()) {
    battery_monitor_type = BATTERY_LC709203F;
    lc709203f.setPackSize(LC709203F_APA_500MAH);
    battery_monitor_type = BATTERY_LC709203F;
    return;
  }

  battery_monitor_type = BATTERY_NONE;
}

void drawBatteryIndicator(int x, int y) {
  const int body_w = 18;
  const int body_h = 36;
  const int cap_w = 6;
  const int cap_h = 4;

  oled.drawRect(x, y + cap_h, body_w, body_h, SSD1306_WHITE);  // battery
  // oled.drawRect(x + (body_w - cap_w) / 2, y, cap_w, cap_h + 1, SSD1306_WHITE); // cap
  oled.fillRect(x + (body_w - cap_w) / 2, y - 1, cap_w, cap_h, SSD1306_WHITE);  // cap

  if (battery_percent >= 0) {
    int inner_h = body_h - 4;
    int fill_h = round(inner_h * (battery_percent / 100.0));

    int fill_x = x + 2;
    int fill_y = y + cap_h + body_h - 4 - fill_h;
    int fill_w = body_w - 4;

    oled.fillRect(fill_x, fill_y, fill_w, fill_h, SSD1306_WHITE);
  }

  // oled.setTextSize(2);
  // oled.setTextColor(SSD1306_WHITE);

  if (battery_percent >= 0) {
    int pct = round(battery_percent);

    char pct_text[6];
    snprintf(pct_text, sizeof(pct_text), "%d%", pct);

    // int text_x = x - 2;
    // if (pct < 10) text_x = x + 2;
    // else if (pct < 100) text_x = x - 1;
    // else text_x = x - 4;

    // oled.setCursor(text_x, y + cap_h + body_h + 4);
    // oled.print(pct_text);
    if (pct == 100) x = x - 8;
    drawNumberString(x, y + cap_h + body_h + 4, pct_text);
  } else {
    oled.setCursor(x - 1, y + cap_h + body_h + 4);
    oled.print("--%");
  }
}

void drawNumberString(int x, int y, const char *str) {
  int cursor_x = x;

  for (int i = 0; str[i] != '\0'; i++) {
    char c = str[i];

    if (c >= '0' && c <= '9') {
      draw_oled_digit(cursor_x, y, c, OLED_TC_SCALE);
      cursor_x += 10;  // 5px glyph + 1px spacing (matches your TC)
    } else if (c == '%') {
      // Simple % symbol (since you don't have a glyph)
      oled.drawCircle(cursor_x + 2, y + 2, 1, SSD1306_WHITE);
      oled.drawCircle(cursor_x + 4, y + 6, 1, SSD1306_WHITE);
      oled.drawLine(cursor_x + 1, y + 8, cursor_x + 5, y, SSD1306_WHITE);
      cursor_x += 6;
    }
  }
}