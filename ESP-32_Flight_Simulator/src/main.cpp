#include <Arduino.h>
#include <Wire.h>
#include <math.h>

// User wiring: GY-6500 SCL -> GPIO 21, SDA -> GPIO 22.
// Wire.begin() takes SDA first, then SCL.
constexpr int SDA_PIN = 22;
constexpr int SCL_PIN = 21;
constexpr int JOYSTICK_X_PIN = 4;   // VRX: ADC2 input; this project does not use Wi-Fi.
constexpr int JOYSTICK_Y_PIN = 34;  // VRY: ADC1 input. GPIO 23 has no ADC on classic ESP32.
constexpr int JOYSTICK_SWITCH_PIN = 2;
constexpr int LANDING_GUIDE_BUTTON_PIN = 35;  // Input-only; use an external 10 kOhm pull-up to 3V3.

constexpr uint8_t MPU_ADDR_1 = 0x68;
constexpr uint8_t MPU_ADDR_2 = 0x69;
constexpr uint8_t REG_SMPLRT_DIV = 0x19;
constexpr uint8_t REG_CONFIG = 0x1A;
constexpr uint8_t REG_GYRO_CONFIG = 0x1B;
constexpr uint8_t REG_ACCEL_CONFIG = 0x1C;
constexpr uint8_t REG_ACCEL_CONFIG2 = 0x1D;
constexpr uint8_t REG_ACCEL_XOUT_H = 0x3B;
constexpr uint8_t REG_PWR_MGMT_1 = 0x6B;
constexpr uint8_t REG_WHO_AM_I = 0x75;

constexpr uint32_t SERIAL_BAUD = 115200;
constexpr uint32_t SAMPLE_PERIOD_US = 10000;  // 100 Hz
constexpr uint16_t CALIBRATION_SAMPLES = 400;
constexpr uint32_t CALIBRATION_TIMEOUT_MS = 8000;
constexpr uint32_t BUTTON_DEBOUNCE_MS = 35;
constexpr uint8_t JOYSTICK_CENTER_SAMPLES = 80;
constexpr float GYRO_LSB_PER_DPS = 65.5f;      // +/-500 degrees/second
constexpr float ACCEL_LSB_PER_G = 8192.0f;     // +/-4 g
constexpr float COMPLEMENTARY_ALPHA = 0.98f;
constexpr float DEGREES_PER_RADIAN = 57.2957795f;

struct RawSample {
  int16_t ax;
  int16_t ay;
  int16_t az;
  int16_t temperature;
  int16_t gx;
  int16_t gy;
  int16_t gz;
};

uint8_t mpuAddress = 0;
float gyroBiasX = 0.0f;
float gyroBiasY = 0.0f;
float gyroBiasZ = 0.0f;
float accelRollReference = 0.0f;
float accelPitchReference = 0.0f;
float rollDeg = 0.0f;
float pitchDeg = 0.0f;
float yawDeg = 0.0f;
uint32_t lastSampleUs = 0;
bool joystickSwitchPressed = false;
bool lastJoystickSwitchRaw = false;
uint32_t lastJoystickSwitchChangeMs = 0;
bool landingGuideButtonPressed = false;
bool lastLandingGuideButtonRaw = false;
uint32_t lastLandingGuideButtonChangeMs = 0;
uint16_t joystickCenterX = 2048;
uint16_t joystickCenterY = 2048;
float joystickXFiltered = 2048.0f;
float joystickYFiltered = 2048.0f;
bool joystickAnalogInitialized = false;

bool readJoystickSwitch() {
  const bool rawPressed = digitalRead(JOYSTICK_SWITCH_PIN) == LOW;
  const uint32_t nowMs = millis();
  if (rawPressed != lastJoystickSwitchRaw) {
    lastJoystickSwitchRaw = rawPressed;
    lastJoystickSwitchChangeMs = nowMs;
  }
  if (static_cast<uint32_t>(nowMs - lastJoystickSwitchChangeMs) >= BUTTON_DEBOUNCE_MS) {
    joystickSwitchPressed = lastJoystickSwitchRaw;
  }
  return joystickSwitchPressed;
}

bool readLandingGuideButton() {
  const bool rawPressed = digitalRead(LANDING_GUIDE_BUTTON_PIN) == LOW;
  const uint32_t nowMs = millis();
  if (rawPressed != lastLandingGuideButtonRaw) {
    lastLandingGuideButtonRaw = rawPressed;
    lastLandingGuideButtonChangeMs = nowMs;
  }
  if (static_cast<uint32_t>(nowMs - lastLandingGuideButtonChangeMs) >= BUTTON_DEBOUNCE_MS) {
    landingGuideButtonPressed = lastLandingGuideButtonRaw;
  }
  return landingGuideButtonPressed;
}

void calibrateJoystickCenter() {
  Serial.println("# CENTER JOYSTICK: release the stick and switch...");
  uint32_t sumX = 0;
  uint32_t sumY = 0;
  for (uint8_t i = 0; i < JOYSTICK_CENTER_SAMPLES; ++i) {
    sumX += analogRead(JOYSTICK_X_PIN);
    sumY += analogRead(JOYSTICK_Y_PIN);
    delay(3);
  }
  joystickCenterX = static_cast<uint16_t>(sumX / JOYSTICK_CENTER_SAMPLES);
  joystickCenterY = static_cast<uint16_t>(sumY / JOYSTICK_CENTER_SAMPLES);
  joystickXFiltered = static_cast<float>(joystickCenterX);
  joystickYFiltered = static_cast<float>(joystickCenterY);
  joystickAnalogInitialized = true;
  Serial.print("# Joystick centered at X=");
  Serial.print(joystickCenterX);
  Serial.print(" Y=");
  Serial.println(joystickCenterY);
}

void readJoystickAxes() {
  const float rawX = static_cast<float>(analogRead(JOYSTICK_X_PIN));
  const float rawY = static_cast<float>(analogRead(JOYSTICK_Y_PIN));
  if (!joystickAnalogInitialized) {
    joystickXFiltered = rawX;
    joystickYFiltered = rawY;
    joystickAnalogInitialized = true;
    return;
  }
  // A light low-pass filter reduces ADC jitter while keeping stick movement responsive.
  joystickXFiltered += 0.28f * (rawX - joystickXFiltered);
  joystickYFiltered += 0.28f * (rawY - joystickYFiltered);
}

bool writeRegister(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(mpuAddress);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

bool readRegister(uint8_t reg, uint8_t &value) {
  Wire.beginTransmission(mpuAddress);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(mpuAddress, static_cast<uint8_t>(1), static_cast<uint8_t>(true)) != 1) {
    return false;
  }
  value = Wire.read();
  return true;
}

bool readRawSample(RawSample &sample) {
  Wire.beginTransmission(mpuAddress);
  Wire.write(REG_ACCEL_XOUT_H);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(mpuAddress, static_cast<uint8_t>(14), static_cast<uint8_t>(true)) != 14) {
    return false;
  }

  auto readInt16 = []() -> int16_t {
    const uint16_t high = static_cast<uint16_t>(Wire.read());
    const uint16_t low = static_cast<uint16_t>(Wire.read());
    return static_cast<int16_t>((high << 8) | low);
  };

  sample.ax = readInt16();
  sample.ay = readInt16();
  sample.az = readInt16();
  sample.temperature = readInt16();
  sample.gx = readInt16();
  sample.gy = readInt16();
  sample.gz = readInt16();
  return true;
}

bool findMpu6500() {
  const uint8_t candidates[] = {MPU_ADDR_1, MPU_ADDR_2};
  for (uint8_t candidate : candidates) {
    Wire.beginTransmission(candidate);
    if (Wire.endTransmission() != 0) continue;

    mpuAddress = candidate;
    uint8_t identity = 0;
    if (!readRegister(REG_WHO_AM_I, identity)) continue;

    Serial.print("# I2C device at 0x");
    Serial.print(mpuAddress, HEX);
    Serial.print("; WHO_AM_I=0x");
    Serial.println(identity, HEX);
    if (identity != 0x70) {
      Serial.println("# Expected MPU-6500 WHO_AM_I 0x70. Check the GY-6500 module.");
      return false;
    }
    return true;
  }
  return false;
}

bool configureMpu6500() {
  // Wake the device and select the gyro PLL as its clock source.
  if (!writeRegister(REG_PWR_MGMT_1, 0x01)) return false;
  delay(100);

  // DLPF enabled: 1 kHz internal rate; divider 9 gives 100 Hz.
  // Set gyro to +/-500 dps and accelerometer to +/-4 g.
  return writeRegister(REG_CONFIG, 0x03) &&
         writeRegister(REG_SMPLRT_DIV, 0x09) &&
         writeRegister(REG_GYRO_CONFIG, 0x08) &&
         writeRegister(REG_ACCEL_CONFIG, 0x08) &&
         writeRegister(REG_ACCEL_CONFIG2, 0x03);
}

bool calibrateSensor() {
  calibrateJoystickCenter();
  Serial.println("# CALIBRATING: hold still in the neutral flight position...");

  int64_t sumGx = 0;
  int64_t sumGy = 0;
  int64_t sumGz = 0;
  int64_t sumAx = 0;
  int64_t sumAy = 0;
  int64_t sumAz = 0;
  uint16_t collected = 0;
  const uint32_t startMs = millis();
  RawSample sample{};

  while (collected < CALIBRATION_SAMPLES &&
         static_cast<uint32_t>(millis() - startMs) < CALIBRATION_TIMEOUT_MS) {
    if (readRawSample(sample)) {
      sumGx += sample.gx;
      sumGy += sample.gy;
      sumGz += sample.gz;
      sumAx += sample.ax;
      sumAy += sample.ay;
      sumAz += sample.az;
      ++collected;
    }
    delay(4);
  }

  if (collected < 100) {
    Serial.println("# Calibration failed: I2C samples unavailable.");
    return false;
  }

  gyroBiasX = static_cast<float>(sumGx) / collected;
  gyroBiasY = static_cast<float>(sumGy) / collected;
  gyroBiasZ = static_cast<float>(sumGz) / collected;

  const float ax = static_cast<float>(sumAx) / collected;
  const float ay = static_cast<float>(sumAy) / collected;
  const float az = static_cast<float>(sumAz) / collected;
  accelRollReference = atan2f(ay, az) * DEGREES_PER_RADIAN;
  accelPitchReference = atan2f(-ax, sqrtf(ay * ay + az * az)) * DEGREES_PER_RADIAN;

  rollDeg = 0.0f;
  pitchDeg = 0.0f;
  yawDeg = 0.0f;
  lastSampleUs = micros();
  Serial.println("# Calibration complete. Streaming JSON at 100 Hz.");
  return true;
}

void handleSerialCommands() {
  while (Serial.available() > 0) {
    const char command = static_cast<char>(Serial.read());
    if (command == 'C' || command == 'c') calibrateSensor();
  }
}

void streamOrientation() {
  const uint32_t nowUs = micros();
  if (static_cast<uint32_t>(nowUs - lastSampleUs) < SAMPLE_PERIOD_US) return;

  float dt = static_cast<float>(nowUs - lastSampleUs) / 1000000.0f;
  lastSampleUs = nowUs;
  if (dt <= 0.0f || dt > 0.05f) dt = SAMPLE_PERIOD_US / 1000000.0f;

  RawSample sample{};
  if (!readRawSample(sample)) {
    Serial.println("# I2C read failed");
    return;
  }

  const float ax = static_cast<float>(sample.ax) / ACCEL_LSB_PER_G;
  const float ay = static_cast<float>(sample.ay) / ACCEL_LSB_PER_G;
  const float az = static_cast<float>(sample.az) / ACCEL_LSB_PER_G;
  const float gyroX = (static_cast<float>(sample.gx) - gyroBiasX) / GYRO_LSB_PER_DPS;
  const float gyroY = (static_cast<float>(sample.gy) - gyroBiasY) / GYRO_LSB_PER_DPS;
  const float gyroZ = (static_cast<float>(sample.gz) - gyroBiasZ) / GYRO_LSB_PER_DPS;

  const float measuredRoll = atan2f(ay, az) * DEGREES_PER_RADIAN - accelRollReference;
  const float measuredPitch = atan2f(-ax, sqrtf(ay * ay + az * az)) * DEGREES_PER_RADIAN - accelPitchReference;

  // Accelerometer correction limits long-term roll/pitch drift. Yaw is gyro-only.
  rollDeg = COMPLEMENTARY_ALPHA * (rollDeg + gyroX * dt) +
            (1.0f - COMPLEMENTARY_ALPHA) * measuredRoll;
  pitchDeg = COMPLEMENTARY_ALPHA * (pitchDeg + gyroY * dt) +
             (1.0f - COMPLEMENTARY_ALPHA) * measuredPitch;
  yawDeg += gyroZ * dt;
  if (yawDeg > 180.0f) yawDeg -= 360.0f;
  if (yawDeg < -180.0f) yawDeg += 360.0f;

  Serial.print("{\"roll\":");
  Serial.print(rollDeg, 2);
  Serial.print(",\"pitch\":");
  Serial.print(pitchDeg, 2);
  Serial.print(",\"yaw\":");
  Serial.print(yawDeg, 2);
  readJoystickAxes();
  Serial.print(",\"joyX\":");
  Serial.print(joystickXFiltered, 0);
  Serial.print(",\"joyY\":");
  Serial.print(joystickYFiltered, 0);
  Serial.print(",\"joyCenterX\":");
  Serial.print(joystickCenterX);
  Serial.print(",\"joyCenterY\":");
  Serial.print(joystickCenterY);
  Serial.print(",\"switch\":");
  Serial.print(readJoystickSwitch() ? 1 : 0);
  Serial.print(",\"guideButton\":");
  Serial.print(readLandingGuideButton() ? 1 : 0);
  Serial.println("}");
}

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(300);

  // Arguments are SDA then SCL: SDA=22 and SCL=21.
  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(400000);

  // Joystick VRX=4, VRY=34, SW=2. GPIO 34 is ADC1 and input-only.
  pinMode(JOYSTICK_SWITCH_PIN, INPUT_PULLUP);
  // GPIO 35 cannot use INPUT_PULLUP; wire the button to GND and add a 10 kOhm pull-up to 3V3.
  pinMode(LANDING_GUIDE_BUTTON_PIN, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(JOYSTICK_X_PIN, ADC_11db);
  analogSetPinAttenuation(JOYSTICK_Y_PIN, ADC_11db);
  lastJoystickSwitchRaw = digitalRead(JOYSTICK_SWITCH_PIN) == LOW;
  joystickSwitchPressed = lastJoystickSwitchRaw;
  lastJoystickSwitchChangeMs = millis();
  lastLandingGuideButtonRaw = digitalRead(LANDING_GUIDE_BUTTON_PIN) == LOW;
  landingGuideButtonPressed = lastLandingGuideButtonRaw;
  lastLandingGuideButtonChangeMs = millis();

  if (!findMpu6500()) {
    Serial.println("# MPU-6500 not found. Check 3V3, GND, SDA=22, SCL=21, and I2C address.");
    while (true) delay(1000);
  }
  if (!configureMpu6500()) {
    Serial.println("# Could not configure MPU-6500 over I2C.");
    while (true) delay(1000);
  }
  if (!calibrateSensor()) {
    Serial.println("# Hold the module still, then reset the ESP32 to retry calibration.");
    while (true) delay(1000);
  }
}

void loop() {
  handleSerialCommands();
  streamOrientation();
}
