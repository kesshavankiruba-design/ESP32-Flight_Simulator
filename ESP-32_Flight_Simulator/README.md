# Skyline Flight Simulator — ESP32 project

A local, USB-connected 3D flight simulator controlled by a classic ESP32 Dev Module, a GY-6500 (MPU-6500), and a two-axis analog joystick. Three.js is bundled locally, so the simulator and scenery run offline. The runway, aircraft, rolling terrain, hills, airport buildings, trees, and drifting clouds share one perspective 3D world. The chase camera follows behind the plane, and the runway sits on the same ground surface as the surrounding terrain. The aircraft has a shaped fuselage, wings, tail, windows, propeller, and animated control surfaces and landing gear.

## Wiring

Use the joystick's 3.3 V supply and share ground with the ESP32. **Move VRY from GPIO 23 to GPIO 34:** GPIO 23 on the classic ESP32 does not have an ADC input, so it cannot read the joystick's analog voltage. GPIO 34 is an ADC1 input and is suitable for VRY.

| Part | Pin / connection |
| --- | --- |
| GY-6500 VCC | ESP32 3V3 |
| GY-6500 GND | ESP32 GND |
| GY-6500 SDA | GPIO 22 |
| GY-6500 SCL | GPIO 21 |
| Joystick VCC | ESP32 3V3 |
| Joystick GND | ESP32 GND |
| Joystick VRX | GPIO 4 |
| Joystick VRY | GPIO 34 (move from GPIO 23) |
| Joystick SW | GPIO 2 |
| Landing-guide pushbutton | GPIO 35 (external pull-up required) |

GPIO 4 is an ADC2 input; this firmware does not enable Wi-Fi, so the pin is available for analog reads. GPIO 34 is input-only, as needed for the joystick signal. GPIO 2 is a boot-strapping pin on classic ESP32 boards; avoid holding the joystick switch down while resetting or uploading. The switch is debounced and toggles the landing gear in the simulator.

GPIO 35 is input-only and has no internal pull-up. Connect the pushbutton between GPIO 35 and GND, and connect a 10 kΩ resistor between GPIO 35 and 3V3. A short press toggles the guide in landing mode; holding the button for about 650 ms toggles the landing gear.

The firmware calls `Wire.begin(22, 21)` (SDA, then SCL), checks I²C addresses `0x68` and `0x69`, and expects the MPU-6500 identity value `0x70`. Leave INT, AD0, and CS disconnected for this I²C wiring.

## Build and upload in VS Code

1. Extract the ZIP into a folder named `esp32-tilt-flight-controller`, then open that folder in VS Code.
2. Install the PlatformIO IDE extension if it is not already installed.
3. Connect the ESP32 with a USB data cable. Hold the GY-6500 still and release the joystick during startup calibration.
4. Use PlatformIO **Build**, then **Upload**. Close PlatformIO's Serial Monitor before connecting from the browser.

`platformio.ini` targets the classic ESP32 Dev Module (`esp32dev`) and Espressif 32 platform 7.1.3. For an ESP32-C3, S3, or a different board, choose the matching PlatformIO board ID and verify its analog-capable pins before wiring the joystick.

## Start the simulator

Open a terminal in this project folder and run:

```powershell
python -m http.server 8087
```

Open [http://localhost:8087/flight_simulator.html](http://localhost:8087/flight_simulator.html) in Chrome or Edge. Choose **Connect ESP32**, select its serial port, and wait for the calibration messages. Web Serial works on supported Chromium browsers on a local secure origin such as `localhost`.

## Controls

- **GY-6500:** bank left/right to turn; point the controller nose up to climb and nose down to descend. Pitch response is more sensitive in the simulator, so a full nose-down tilt produces a clear dive. The ESP32 firmware and sensor mapping stay unchanged. On first use, choose **Map Controls** and capture neutral, right tilt, and nose-up. **Recalibrate** recenters both the IMU and the joystick, so release the stick and hold the module still during recalibration.
- **Joystick VRY:** push up to raise throttle; pull down to reduce it. The spring-centered stick changes the throttle setting while deflected, then holds the selected setting when released. The on-screen engine-power lever follows the joystick and can also be dragged with a mouse or touch as a fallback. The throttle panel shows the live VRY reading and center value; click **Reverse VRY Direction** if pushing up lowers the reading and does not raise throttle. If the panel says **NO VRY DATA**, upload this project's latest ESP32 firmware.
- **Joystick VRX:** rudder and ground steering.
- **Joystick SW / GPIO 2:** toggle landing gear.
- **Pushbutton / GPIO 35:** tap briefly in landing mode to toggle the green dotted route; hold for about 0.65 seconds to deploy or retract the landing gear. GPIO 35 needs the external 10 kΩ pull-up described above; the on-screen **GUIDE** and **LANDING GEAR** controls also work.
- **Camera:** select **EXTERIOR VIEW** or press **V** for the smooth chase camera; select **COCKPIT VIEW** or press **V** again to return.
- **On-screen controls:** parking brake, gear, and flaps. Set flaps for slower approaches; release the parking brake before taxiing or taking off.
- **Keyboard fallback:** **W/S** pitch, **A/D** bank, **,/.** rudder, **Page Up/Page Down** throttle, **B** brakes, **G** gear, **F** flaps.

Use the **1 · TAKEOFF** and **2 · LANDING** buttons to select one of two starting situations. Takeoff begins parked at the start of runway 36 with the parking brake set. Landing begins on an aligned, stable three-degree final to that same runway; the glide cue and PAPI lights show whether you are high or low. Follow the green dotted route, lower the gear, ease throttle toward idle, then make a small nose-up flare and relax it as the rear wheels touch. Touching down off-center, too hard, or nose-first triggers a short crash animation and automatic reset.

## Project files

- `src/main.cpp` — ESP32 firmware for the GY-6500 and joystick, streamed over USB serial at 115200 baud.
- `platformio.ini` — PlatformIO board and framework configuration.
- `flight_simulator.html` — standalone simulator, instruments, and browser serial connection.
- `assets/flight3d-world.js` — 3D airport, terrain, sky, aircraft, camera, and scenery renderer.
- `assets/three.module.js` and `assets/THREE-LICENSE.txt` — bundled Three.js runtime and its license.
- `assets/flight-mark.svg` — local browser tab icon.
- `.vscode/extensions.json` — recommends the PlatformIO IDE extension.
