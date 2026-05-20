#include <Arduino.h>
#include <Wire.h>
#include <SPI.h>
#include <RF24.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_MAX1704X.h>
#include <Adafruit_LC709203F.h>

// ------------------ CONFIG ------------------

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_I2C_ADDRESS 0x3C

#define LTC_INPUT_PIN 14
#define STATUS_LED_PIN 15

#define WD_TIMEOUT_MS 250
#define OLED_REFRESH_MS 50

// ------------------ RF24 CONFIG ------------------

#define RF24_CE_PIN 13
#define RF24_CSN_PIN 12

Adafruit_SSD1306 oled(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);
RF24 radio(RF24_CE_PIN, RF24_CSN_PIN);

const byte rf24_address[6] = "TC001";

// ------------------ LTC ISR STATE ------------------

enum isr_state_t {
  isr_null,
  isr_init,
  isr_sync,
  isr_read
};

// ------------------ SERIAL MODE ------------------

enum serial_type_t {
  st_query,
  st_periodic,
  st_continuous
};

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

// ------------------ SHARED ISR VARIABLES ------------------

volatile uint8_t v_tc_buff[10];
volatile bool v_tc_ready = false;
volatile bool v_watchdog = false;
volatile bool v_tc_rvs = false;
volatile uint8_t v_isr_state = isr_init;
volatile uint8_t v_tc_frame_ctr = 0;
volatile uint8_t v_tc_frame_max = 0;

// ------------------ NON-ISR VARIABLES ------------------

uint8_t m_serial_type = st_continuous;
bool m_tc_df = false;
bool m_signal_present = false;

uint32_t m_watchdog_timer = 0;
uint32_t last_oled_refresh_ms = 0;

uint8_t tc_rate = 25;
uint8_t raw_tc[8] = { 0 };

char t_code[12] = "00:00:00:00";
char u_bits[17] = "                ";

// RF state
bool m_rf_ok = false;
uint32_t m_rf_sequence = 0;
uint32_t m_frame_counter = 0;

// latest timing for phase-aware receivers
uint32_t m_last_frame_decode_us = 0;
uint32_t m_last_tx_us = 0;

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

void IRAM_ATTR tc_isr(void);

uint8_t flip8(uint8_t b);
void process_ltc_frame(void);
void update_watchdog(void);
void reset_decoder(void);
void update_oled(void);

void draw_oled_timecode(int16_t x, int16_t y, const char *tc, uint8_t scale);
void draw_oled_digit(int16_t x, int16_t y, char c, uint8_t scale);
void draw_oled_colon(int16_t x, int16_t y, uint8_t scale);
const uint8_t *get_oled_digit(char c);

void init_rf24(void);
void send_rf_timecode_now(bool local_rvs);

// ------------------ SETUP ------------------

void setup() {
  pinMode(LTC_INPUT_PIN, INPUT_PULLUP);
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW);

  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.println("ESP32 LTC master starting");

  SPI.begin(SCK, MISO, MOSI);
  Wire.begin();

  if (!oled.begin(SSD1306_SWITCHCAPVCC, OLED_I2C_ADDRESS)) {
    Serial.println("OLED init failed");
    while (true) {
    }
  }

  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextSize(2);
  oled.setCursor(0, 0);
  oled.println("BOOT");
  oled.display();

  init_rf24();

  v_isr_state = isr_init;
  attachInterrupt(digitalPinToInterrupt(LTC_INPUT_PIN), tc_isr, CHANGE);

  setupBatteryMonitor();

  m_watchdog_timer = millis();
}

// ------------------ LOOP ------------------

void loop() {
  process_ltc_frame();
  update_watchdog();

  if (millis() - last_oled_refresh_ms >= OLED_REFRESH_MS) {
    last_oled_refresh_ms = millis();
    update_oled();
  }
}

// ------------------ RF24 ------------------

void init_rf24(void) {
  pinMode(RF24_CSN_PIN, OUTPUT);
  digitalWrite(RF24_CSN_PIN, HIGH);

  pinMode(RF24_CE_PIN, OUTPUT);
  digitalWrite(RF24_CE_PIN, LOW);

  if (!radio.begin()) {
    Serial.println("RF24 init failed");
    m_rf_ok = false;
    return;
  }

  radio.setPALevel(RF24_PA_MIN);
  radio.setDataRate(RF24_250KBPS);
  radio.setChannel(76);

  // broadcast mode so multiple receivers can listen together
  radio.setAutoAck(false);
  radio.disableAckPayload();

  radio.openWritingPipe(rf24_address);
  radio.stopListening();

  m_rf_ok = true;
  Serial.println("RF24 TX ready");
}

void send_rf_timecode_now(bool local_rvs) {
  if (!m_rf_ok || !m_signal_present) {
    return;
  }

  uint8_t current_frames = ((t_code[9] - '0') * 10) + (t_code[10] - '0');

  if ((current_frames % 5) != 0) {
    m_frame_counter++;
    return;
  }

  tc_packet_t packet;

  packet.sync_word = 0x54433031;  // "TC01"
  packet.sequence = m_rf_sequence++;
  packet.frame_counter = m_frame_counter++;
  packet.frame_decode_us = m_last_frame_decode_us;
  packet.tx_us = micros();

  packet.hours = ((t_code[0] - '0') * 10) + (t_code[1] - '0');
  packet.minutes = ((t_code[3] - '0') * 10) + (t_code[4] - '0');
  packet.seconds = ((t_code[6] - '0') * 10) + (t_code[7] - '0');
  packet.frames = ((t_code[9] - '0') * 10) + (t_code[10] - '0');

  packet.fps = tc_rate;
  packet.flags = 0;

  packet.flags |= TC_FLAG_VALID;

  if (m_tc_df) {
    packet.flags |= TC_FLAG_DROP_FRAME;
  }

  if (local_rvs) {
    packet.flags |= TC_FLAG_REVERSED;
  }

  if (m_signal_present) {
    packet.flags |= TC_FLAG_SIGNAL;
  }

  m_last_tx_us = packet.tx_us;
  radio.write(&packet, sizeof(packet));
}

// ------------------ BIT HELPERS ------------------

uint8_t flip8(uint8_t b) {
  b = (b & 0xF0) >> 4 | (b & 0x0F) << 4;
  b = (b & 0xCC) >> 2 | (b & 0x33) << 2;
  b = (b & 0xAA) >> 1 | (b & 0x55) << 1;
  return b;
}

// ------------------ FRAME PROCESSING ------------------

void process_ltc_frame(void) {
  const char hexchar[] = "0123456789ABCDEF";
  const uint8_t df_flag = 0x04;

  if (!v_tc_ready) {
    return;
  }

  noInterrupts();

  uint8_t local_buff[10];
  bool local_rvs = v_tc_rvs;

  for (uint8_t idx = 0; idx < 10; idx++) {
    local_buff[idx] = v_tc_buff[idx];
  }

  v_tc_ready = false;

  interrupts();

  if (!local_rvs) {
    for (uint8_t idx = 0; idx < 8; idx++) {
      raw_tc[idx] = local_buff[idx];
    }
  } else {
    for (uint8_t idx = 0; idx < 8; idx++) {
      raw_tc[idx] = flip8(local_buff[9 - idx]);
    }
  }

  m_tc_df = (raw_tc[6] & df_flag);

  t_code[2] = ':';
  t_code[5] = ':';
  t_code[8] = m_tc_df ? ';' : ':';
  t_code[11] = '\0';

  t_code[0] = (raw_tc[0] & 0x03) | '0';
  t_code[1] = (raw_tc[1] & 0x0F) | '0';
  t_code[3] = (raw_tc[2] & 0x07) | '0';
  t_code[4] = (raw_tc[3] & 0x0F) | '0';
  t_code[6] = (raw_tc[4] & 0x07) | '0';
  t_code[7] = (raw_tc[5] & 0x0F) | '0';
  t_code[9] = (raw_tc[6] & 0x03) | '0';
  t_code[10] = (raw_tc[7] & 0x0F) | '0';

  for (uint8_t idx = 0; idx < 8; idx++) {
    u_bits[idx + 4] = hexchar[raw_tc[idx] >> 4];
  }

  uint8_t fr_val = ((t_code[9] & 0x03) * 10) + (t_code[10] & 0x0F);

  if (fr_val > v_tc_frame_max) {
    v_tc_frame_max = fr_val;
  }

  if (++v_tc_frame_ctr > 31) {
    tc_rate = v_tc_frame_max + 1;
    v_tc_frame_max = 0;
    v_tc_frame_ctr = 0;
  }

  m_signal_present = true;
  m_watchdog_timer = millis();

  // phase-sensitive timestamp taken as soon as frame is decoded/processed
  m_last_frame_decode_us = micros();

  // transmit immediately, before any serial/debug work
  send_rf_timecode_now(local_rvs);

  // if (m_serial_type == st_continuous) {
  //   Serial.print(t_code);
  //   Serial.print("  ");
  //   Serial.print(tc_rate);
  //   Serial.print("fps ");
  //   Serial.print(m_tc_df ? "DF " : "NDF "); // drop frame / non-drop frame
  //   Serial.print(local_rvs ? "REV " : "FWD ");
  //   Serial.print("dec_us=");
  //   Serial.print(m_last_frame_decode_us);
  //   Serial.print(" tx_us=");
  //   Serial.print(m_last_tx_us);
  //   Serial.print(" fc=");
  //   Serial.println(m_frame_counter - 1);
  // }
}

// ------------------ WATCHDOG ------------------

void update_watchdog(void) {
  if (v_watchdog) {
    v_watchdog = false;
    m_watchdog_timer = millis();
  } else {
    if (m_signal_present && (millis() - m_watchdog_timer > WD_TIMEOUT_MS)) {
      m_signal_present = false;
      reset_decoder();
      Serial.println("LTC signal lost");
    }
  }
}

void reset_decoder(void) {
  noInterrupts();
  v_isr_state = isr_init;
  v_tc_ready = false;
  interrupts();

  digitalWrite(STATUS_LED_PIN, LOW);
}

// ------------------ OLED ------------------

void update_oled(void) {
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);

  oled.setTextSize(2);
  oled.setCursor(0, 0);

  if (m_signal_present) {
    oled.println("LTC OK");
  } else {
    oled.println("NO SIG");
  }

  draw_oled_timecode(OLED_TC_X, OLED_TC_Y, t_code, OLED_TC_SCALE);

  oled.setTextSize(2);
  oled.setCursor(0, 48);

  char status_line[20];
  snprintf(
    status_line,
    sizeof(status_line),
    "%u%s %c",
    tc_rate,
    m_tc_df ? "DF" : "fps",  // drop frame / non-drop frame
    v_tc_rvs ? '<' : '>'); // forward / reverse
  oled.print(status_line);

  updateBatteryInfo();
  drawBatteryIndicator(108, 6);

  oled.display();
}

void draw_oled_timecode(int16_t x, int16_t y, const char *tc, uint8_t scale) {
  int16_t cursor_x = x;

  for (uint8_t i = 0; i < 11; i++) {
    if (tc[i] == ':' || tc[i] == ';') {
      draw_oled_colon(cursor_x, y, scale);
      cursor_x += (OLED_COLON_WIDTH * scale) + OLED_COLON_SPACING;
    } else {
      draw_oled_digit(cursor_x, y, tc[i], scale);
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

void drawBatteryIndicator(int x, int y) {
  const int body_w = 18;
  const int body_h = 36;
  const int cap_w = 6;
  const int cap_h = 4;

  oled.drawRect(x, y + cap_h, body_w, body_h, SSD1306_WHITE); // battery
  // oled.drawRect(x + (body_w - cap_w) / 2, y, cap_w, cap_h + 1, SSD1306_WHITE); // cap
  oled.fillRect(x + (body_w - cap_w) / 2, y - 1, cap_w, cap_h, SSD1306_WHITE); // cap

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

void drawNumberString(int x, int y, const char* str) {
  int cursor_x = x;

  for (int i = 0; str[i] != '\0'; i++) {
    char c = str[i];

    if (c >= '0' && c <= '9') {
      draw_oled_digit(cursor_x, y, c, OLED_TC_SCALE);
      cursor_x += 10; // 5px glyph + 1px spacing (matches your TC)
    } 
    else if (c == '%') {
      // Simple % symbol (since you don't have a glyph)
      oled.drawCircle(cursor_x + 2, y + 2, 1, SSD1306_WHITE);
      oled.drawCircle(cursor_x + 4, y + 6, 1, SSD1306_WHITE);
      oled.drawLine(cursor_x + 1, y + 8, cursor_x + 5, y, SSD1306_WHITE);
      cursor_x += 6;
    }
  }
}

// ------------------ ISR ------------------

void IRAM_ATTR tc_isr(void) {
  const uint8_t z_size = 40;

  static uint8_t shift_reg[10];
  static uint32_t last_edge_us = 0;
  static uint8_t counter = 0;
  static bool eat_edge = false;

  static uint8_t z_count = 0;
  static uint32_t accum = 0;
  static uint32_t cell_one = 0;
  static uint32_t cell_min = 0;
  static uint32_t cell_det = 0;
  static uint32_t cell_max = 0;

  uint8_t new_bit = 0;
  uint8_t idx;
  bool sync_found = false;

  uint32_t now_us = micros();

  if (last_edge_us == 0) {
    last_edge_us = now_us;
    return;
  }

  uint32_t cell_time = now_us - last_edge_us;
  last_edge_us = now_us;

  v_watchdog = true;

  switch (v_isr_state) {
    case isr_init:
      for (idx = 0; idx < 10; idx++) {
        shift_reg[idx] = 0;
      }

      eat_edge = false;
      counter = 0;
      z_count = 0;
      accum = 0;
      cell_one = 0;
      v_tc_rvs = false;
      v_tc_ready = false;
      v_tc_frame_ctr = 0;
      v_tc_frame_max = 0;
      v_isr_state = isr_sync;
      break;

    case isr_sync:
      if (++counter > z_size) {
        if (z_count > 1) {
          cell_one = (accum / (z_count - 1)) / 2;
        } else {
          v_isr_state = isr_init;
          return;
        }

        cell_min = (cell_one / 2);
        cell_det = (cell_min * 3);
        cell_max = (cell_min * 5);
        v_isr_state = isr_read;
      } else {
        if (cell_time >= cell_one) {
          if (++z_count > 1) {
            accum += cell_time;
          } else {
            cell_one = (cell_time * 2) / 3;
          }
        }
      }
      break;

    case isr_read:
      if ((cell_time < cell_min) || (cell_time > cell_max)) {
        v_isr_state = isr_init;
        return;
      }

      if (cell_time > cell_det) {
        if (eat_edge) {
          v_isr_state = isr_init;
          return;
        }
        new_bit = 0;
        digitalWrite(STATUS_LED_PIN, LOW);
      } else {
        if (cell_time > cell_min) {
          if (!eat_edge) {
            eat_edge = true;
            return;
          }
          eat_edge = false;
          new_bit = bit(7);
          digitalWrite(STATUS_LED_PIN, HIGH);
        }
      }

      for (idx = 9; idx > 0; idx--) {
        shift_reg[idx] = (shift_reg[idx] >> 1) | ((shift_reg[idx - 1] & 1) << 7);
      }

      shift_reg[0] = (shift_reg[0] >> 1) | new_bit;

      eat_edge = false;
      new_bit = 0;
      sync_found = false;

      if (shift_reg[8] == 0xBF && shift_reg[9] == 0xFC) {
        sync_found = true;
        v_tc_rvs = false;
      }

      if (!sync_found) {
        if (shift_reg[0] == 0x3F && shift_reg[1] == 0xFD) {
          sync_found = true;
          v_tc_rvs = true;
        }
      }

      if (sync_found) {
        if (v_tc_ready) {
          v_isr_state = isr_init;
          return;
        }

        for (idx = 0; idx < 10; idx++) {
          v_tc_buff[idx] = shift_reg[idx];
        }

        v_tc_ready = true;
      }
      break;

    default:
      break;
  }
}