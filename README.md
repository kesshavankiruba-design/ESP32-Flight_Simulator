# Skyline Flight Simulator

A local 3D flight simulator controlled over USB by an ESP32, a GY-6500 (MPU-6500) motion sensor, and an analog joystick. Practice takeoffs and landings in a 3D airport with terrain, hills, an animated aircraft, cockpit and exterior views, flight instruments, and an optional landing guide.

The simulator runs in a browser. Three.js is bundled in this repository, so it does not need to download a rendering library at startup.

## Components

- ESP32 Dev Module (classic ESP32)
- GY-6500 / MPU-6500 IMU
- Two-axis analog joystick with a push switch
- Momentary pushbutton for the landing guide
- 10 kΩ resistor for the GPIO 35 button pull-up
- Breadboard and jumper wires
- USB data cable

## Wiring

Connect the components to the ESP32 as follows. Use 3.3 V for the sensor and joystick, and connect all grounds together.

| Component | ESP32 connection |
| --- | --- |
| GY-6500 VCC | 3V3 |
| GY-6500 GND | GND |
| GY-6500 SDA | GPIO 22 |
| GY-6500 SCL | GPIO 21 |
| Joystick VCC | 3V3 |
| Joystick GND | GND |
| Joystick VRX | GPIO 4 |
| Joystick VRY | GPIO 34 |
| Joystick SW | GPIO 2 |
| Landing-guide button | GPIO 35 and GND |

GPIO 35 is input-only and has no internal pull-up. Add a 10 kΩ resistor from GPIO 35 to 3V3; connect the button between GPIO 35 and GND.

GPIO 2 is a boot-strapping pin. Leave the joystick switch released while resetting or uploading the ESP32. GPIO 4 is an ADC2 pin; this firmware does not use Wi-Fi.

## Build and upload the ESP32 firmware

1. Open this project folder in VS Code.
2. Install the **PlatformIO IDE** extension.
3. Connect the ESP32 using a USB data cable.
4. Build the firmware using PlatformIO **Build**, or run this in the VS Code terminal:

   ```sh
   pio run
   ```

5. Upload using PlatformIO **Upload**, or run:

   ```sh
   pio run --target upload
   ```

The project is configured for the `esp32dev` board and Espressif 32 platform 7.1.3. Hold the GY-6500 still and release the joystick during startup calibration.

The firmware reads the MPU-6500 over I²C and streams sensor and joystick readings over USB serial at 115200 baud. It checks I²C addresses `0x68` and `0x69` and expects the MPU-6500 identity value `0x70`.

## Run the simulator

From the project folder, start a local web server:

```sh
python -m http.server 8087
```

If `python` is not recognized on Windows, try:

```powershell
py -m http.server 8087
```

Then open this address in Chrome or Edge:

[http://localhost:8087/flight_simulator.html](http://localhost:8087/flight_simulator.html)

Keep the terminal running while using the simulator. Open **Connect ESP32** in the simulator and select the board’s serial port. Close PlatformIO’s Serial Monitor before connecting through the browser. Web Serial requires a supported Chromium browser; `localhost` provides the required local secure context.

## Simulator controls

- **GY-6500:** Tilt to control pitch; nose-up climbs and nose-down descends. Tilt left or right to bank and turn.
- **Joystick VRY:** Push or pull to adjust the on-screen throttle. If the direction is reversed, use **Reverse VRY Direction** in the simulator.
- **Joystick VRX:** Rudder and ground steering.
- **Joystick SW (GPIO 2):** Toggle the landing gear.
- **Landing-guide button (GPIO 35):** Short press toggles the green route in landing mode. Hold for about 650 ms to toggle the landing gear.
- **On-screen controls:** Adjust throttle, parking brake, landing gear, and flaps.
- **Camera:** Switch between cockpit and exterior chase views, or press **V**.
- **Keyboard fallback:** W/S pitch, A/D bank, comma/period rudder, Page Up/Page Down throttle, B parking brake, G landing gear, and F flaps.

Use **1 · TAKEOFF** to start on runway 36 or **2 · LANDING** to begin on final approach to that runway. In landing mode, lower the gear, reduce throttle, follow the optional green route, and make a gentle nose-up flare for a main-wheel-first touchdown.

## Project files

- `src/main.cpp` — ESP32 firmware for the GY-6500 and joystick.
- `platformio.ini` — PlatformIO board and framework configuration.
- `flight_simulator.html` — simulator interface, flight physics, and USB serial connection.
- `assets/flight3d-world.js` — 3D terrain, airport, aircraft, camera, and scenery.
- `assets/three.module.js` — bundled Three.js runtime.
- `assets/THREE-LICENSE.txt` — Three.js license.
- `assets/flight-mark.svg` — browser tab icon.

## Troubleshooting

- **No sensor found:** Check 3V3, GND, SDA on GPIO 22, SCL on GPIO 21, and the GY-6500 module.
- **No browser serial option:** Use Chrome or Edge, keep the simulator on `localhost`, and close any other program using the ESP32 serial port.
- **Joystick throttle moves backward:** Use **Reverse VRY Direction** in the simulator.
- **ESP32 will not boot or upload:** Make sure the joystick switch on GPIO 2 is released during reset and upload.
- **Landing-guide button does not respond:** Check the GPIO 35 button wiring and the external 10 kΩ pull-up to 3V3.

This project is a desktop simulator; it does not control a real aircraft.
