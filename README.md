# Wanderer Astro v4 Flats Panel Remote Control

A local web application designed to remotely monitor and control the **Wanderer Astro v4 EC Pro flat panel cover** for astronomy telescopes.

It exposes a lightweight FastAPI python server that connects to the flats panel over a USB serial connection, listens to telemetry reports, and broadcasts live status (angle, voltage, model info) to a premium glassmorphic web dashboard over WebSockets.

---

## Features

- **Responsive Web Dashboard**: Deep astronomy-themed dark interface built with responsive flexbox/grid layout (perfect for desktops, tablets, and phones at the telescope).
- **Cover Control**: Open/Close cover buttons with an interactive SVG needle-arc visualizer gauge and active motion indicators (e.g., "Opening...", "Closing...").
- **Flats Light Panel**: Brightness slider (0–255), on/off toggle, and a customizable filter preset grid (L, R, G, B, Ha, OIII, SII) that stores values in `localStorage`.
- **Dew Heater Control**: Slider matching the hardware's 0-150 PWM range.
- **Diagnostics Console**: Terminal log that shows incoming serial messages, commands sent, and allows typing custom hex/command codes directly to the device.
- **Virtual Simulator**: Built-in mock mode to test and develop without physical hardware.

---

## Installation & Setup

### 1. Prerequisites
Ensure you have **Python 3.9+** installed on the computer connected to the Wanderer flats panel cover.

### 2. Download and Extract
Clone this repository or download the source code files:
```bash
git clone https://github.com/your-username/wanderer-remote.git
cd wanderer-remote
```

### 3. Install Dependencies
Open a command prompt (Windows) or terminal (macOS/Linux) in the folder and run:
```bash
pip install -r requirements.txt
```

---

## Running the Application

### 1. Start the Server
Run the python backend:
```bash
python server.py
```
By default, the server runs on port `8000` and binds to all network interfaces (`0.0.0.0`), allowing any device on your local network to connect.

### 2. Access the Dashboard
- **Locally (on the same PC)**: Open your browser and navigate to `http://localhost:8000`.
- **Remotely (from tablet/mac/phone)**: Ensure both devices are on the same local network, find the host PC's local IP address (e.g. `192.168.1.150`), and navigate to `http://192.168.1.150:8000`.

### 3. Connect to Device
1. Find the serial COM/USB port assigned to the device (e.g., `COM3` on Windows, `/dev/ttyUSB0` on Linux, `/dev/cu.usbmodem...` on macOS).
   - *Note: If no hardware is attached, you can select `VIRTUAL_MOCK` from the dropdown list to run the simulator.*
2. Select the port and click **Connect**.
3. **IMPORTANT**: Make sure other astrophotography software suites (like N.I.N.A., SGP, or ASCOM drivers) are disconnected from the COM port before connecting through this web app to avoid connection conflicts.

---

## License

This software is released under the [MIT License](LICENSE).
