import asyncio
import json
import logging
import os
import threading
import time
from typing import Dict, List, Optional, Set
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel
import serial
import serial.tools.list_ports

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("WandererRemote")

app = FastAPI(title="Wanderer Astro V4 Remote Control")

# Path to static folder
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
os.makedirs(STATIC_DIR, exist_ok=True)

# Global status representing current state of the device
device_state = {
    "connected": False,
    "port": None,
    "is_mock": False,
    # Hardware read values (default mock/initial state)
    "device_name": "WandererCoverV4",
    "firmware": 20250506,
    "close_limit": 0.0,
    "open_limit": 283.0,
    "current_position": 0.0,
    "voltage": 12.2,
    "brightness": 0,
    "heater": 0,
    "asiair_mode": False,
    "is_moving": False,
    "target_position": 0.0
}

# Logs list for console display in UI
system_logs: List[Dict] = []
asyncio_loop: Optional[asyncio.AbstractEventLoop] = None
last_movement_time = 0.0

def log_message(level: str, text: str):
    log_entry = {"time": time.strftime("%H:%M:%S"), "level": level, "text": text}
    system_logs.append(log_entry)
    if len(system_logs) > 100:
        system_logs.pop(0)
    logger.info(f"[{level}] {text}")
    # Broadcast to WS clients
    if asyncio_loop is not None and asyncio_loop.is_running():
        try:
            asyncio.run_coroutine_threadsafe(broadcast_state_and_logs(), asyncio_loop)
        except Exception:
            pass

# Active WebSockets clients
active_connections: Set[WebSocket] = set()

# Thread variables
serial_port: Optional[serial.Serial] = None
read_thread: Optional[threading.Thread] = None
mock_thread: Optional[threading.Thread] = None
thread_lock = threading.Lock()
should_stop_threads = threading.Event()

@app.on_event("startup")
async def startup_event():
    global asyncio_loop
    asyncio_loop = asyncio.get_running_loop()


# Helper: broadcast to all active websockets
async def broadcast_state_and_logs():
    if not active_connections:
        return
    data = json.dumps({
        "type": "update",
        "state": device_state,
        "logs": system_logs[-20:] # Send last 20 logs to save bandwidth
    })
    # Gather tasks
    tasks = [ws.send_text(data) for ws in active_connections]
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)

def broadcast_telemetry():
    if asyncio_loop is not None and asyncio_loop.is_running():
        try:
            asyncio.run_coroutine_threadsafe(broadcast_state_and_logs(), asyncio_loop)
        except Exception:
            pass

# Pydantic models
class ConnectRequest(BaseModel):
    port: str

class BrightnessRequest(BaseModel):
    brightness: int

class HeaterRequest(BaseModel):
    power: int

class LimitsRequest(BaseModel):
    close_limit: float
    open_limit: float

class CustomCommandRequest(BaseModel):
    command: str

# Serial reader background thread
def serial_read_loop():
    global serial_port
    log_message("SYSTEM", "Serial reader thread started.")
    buffer = ""
    while not should_stop_threads.is_set():
        try:
            with thread_lock:
                if serial_port is None or not serial_port.is_open:
                    time.sleep(0.1)
                    continue
                
                # Check for incoming bytes
                if serial_port.in_waiting > 0:
                    data = serial_port.read(serial_port.in_waiting).decode('utf-8', errors='ignore')
                    buffer += data
                else:
                    time.sleep(0.05)
                    continue

            # Parse lines if we have a newline
            if "\n" in buffer:
                lines = buffer.split("\n")
                # Keep last incomplete fragment in buffer
                buffer = lines[-1]
                
                for line in lines[:-1]:
                    line = line.strip()
                    if not line:
                        continue
                    log_message("SERIAL_IN", line)
                    parse_serial_line(line)
        except Exception as e:
            log_message("ERROR", f"Error in serial read thread: {e}")
            # Try to disconnect safely
            disconnect_device()
            break
    log_message("SYSTEM", "Serial reader thread stopped.")

# Parse incoming string delimited by 'A'
def parse_serial_line(line: str):
    # Format: DeviceName A FirmwareVersion A CloseLimit A OpenLimit A CurrentPos A Voltage A [Brightness] A [Heater] A [AsiairMode]
    # Example: WandererCoverV4A20250506A0A180A90.5A12.4A120A45A0
    tokens = line.split('A')
    if len(tokens) < 6:
        log_message("WARNING", f"Ignoring malformed status report (too few fields): {line}")
        return
    
    try:
        device_state["device_name"] = tokens[0]
        device_state["firmware"] = int(tokens[1])
        device_state["close_limit"] = float(tokens[2])
        device_state["open_limit"] = float(tokens[3])
        device_state["current_position"] = float(tokens[4])
        device_state["voltage"] = float(tokens[5])
        
        # Extended fields (Modern Protocol >= 20250404)
        if len(tokens) >= 8:
            device_state["brightness"] = int(tokens[6])
            device_state["heater"] = int(tokens[7])
        if len(tokens) >= 9:
            device_state["asiair_mode"] = tokens[8] == '1' or tokens[8] == '1\r'
            
        # Check motion state completion
        global last_movement_time
        if device_state["is_moving"]:
            if time.time() - last_movement_time > 15.0:
                device_state["is_moving"] = False
                log_message("SYSTEM", "Movement timeout reached. Setting motion state to idle.")
            else:
                diff = abs(device_state["current_position"] - device_state["target_position"])
                if diff <= 2.0:
                    device_state["is_moving"] = False
                    log_message("SYSTEM", f"Target position reached: {device_state['current_position']}°")
            
        broadcast_telemetry()
    except Exception as e:
        log_message("ERROR", f"Failed to parse status fields from line '{line}': {e}")

# Mock cover motion simulation thread
def mock_motion_loop():
    log_message("SYSTEM", "Mock simulation thread started.")
    while not should_stop_threads.is_set():
        if device_state["is_moving"]:
            curr = device_state["current_position"]
            target = device_state["target_position"]
            step = 10.0 # Degrees per step
            
            if abs(curr - target) < step:
                device_state["current_position"] = target
                device_state["is_moving"] = False
                log_message("MOCK", f"Cover reached destination: {target}°")
            else:
                if curr < target:
                    device_state["current_position"] = curr + step
                else:
                    device_state["current_position"] = curr - step
                log_message("MOCK", f"Moving cover... position: {device_state['current_position']}°")
            
            # Periodically generate mock status string stream
            status_str = generate_mock_status_string()
            log_message("SERIAL_MOCK_OUT", status_str)
            parse_serial_line(status_str)
            
        else:
            # Periodic mock status update even if not moving (every 2 seconds)
            status_str = generate_mock_status_string()
            parse_serial_line(status_str)
            time.sleep(2.0)
            continue
            
        time.sleep(0.2)
    log_message("SYSTEM", "Mock simulation thread stopped.")

def generate_mock_status_string() -> str:
    # Construct mock string to feed parser
    # DeviceName A FirmwareVersion A CloseLimit A OpenLimit A CurrentPos A Voltage A Brightness A Heater A AsiairMode
    name = device_state["device_name"]
    fw = device_state["firmware"]
    cl = device_state["close_limit"]
    ol = device_state["open_limit"]
    cp = device_state["current_position"]
    vol = device_state["voltage"]
    br = device_state["brightness"]
    ht = device_state["heater"]
    ai = "1" if device_state["asiair_mode"] else "0"
    return f"{name}A{fw}A{cl}A{ol}A{cp}A{vol}A{br}A{ht}A{ai}"

# Write a command string to serial port or mock output
def send_device_command(cmd: str):
    log_message("SERIAL_OUT", cmd)
    
    # Intercept movement commands to set state
    global last_movement_time
    if cmd == "1001" or cmd == "100001":
        device_state["is_moving"] = True
        device_state["target_position"] = device_state["open_limit"]
        last_movement_time = time.time()
    elif cmd == "1000" or cmd == "100000":
        device_state["is_moving"] = True
        device_state["target_position"] = device_state["close_limit"]
        last_movement_time = time.time()
        
    # Intercept brightness and heater settings to update state optimistically (e.g. for legacy device support)
    try:
        val = int(cmd)
        if 0 <= val <= 255:
            device_state["brightness"] = val
        elif val == 9999:
            device_state["brightness"] = 0
        elif 2000 <= val <= 2150:
            device_state["heater"] = val - 2000
    except ValueError:
        pass

    if device_state["is_mock"]:
        # Execute mock logic based on command codes
        process_mock_command(cmd)
    else:
        with thread_lock:
            if serial_port and serial_port.is_open:
                try:
                    serial_port.write((cmd + "\n").encode('utf-8'))
                    serial_port.flush()
                except Exception as e:
                    log_message("ERROR", f"Failed to write serial command: {e}")
                    disconnect_device()

def process_mock_command(cmd: str):
    try:
        val = int(cmd)
        if val == 1001:
            # Open cover
            log_message("MOCK", "Command: Open Cover (1001)")
            device_state["target_position"] = device_state["open_limit"]
            device_state["is_moving"] = True
        elif val == 1000:
            # Close cover
            log_message("MOCK", "Command: Close Cover (1000)")
            device_state["target_position"] = device_state["close_limit"]
            device_state["is_moving"] = True
        elif val == 9999:
            # Flat panel off
            log_message("MOCK", "Command: Flat Panel OFF (9999)")
            device_state["brightness"] = 0
        elif val == 100001:
            # Auto detect open position
            log_message("MOCK", "Command: Auto Detect Open (100001)")
            device_state["open_limit"] = 180.0
            device_state["current_position"] = 180.0
        elif val == 100000:
            # Auto detect close position
            log_message("MOCK", "Command: Auto Detect Close (100000)")
            device_state["close_limit"] = 0.0
            device_state["current_position"] = 0.0
        elif 2000 <= val <= 2150:
            # Dew heater power
            power = val - 2000
            log_message("MOCK", f"Command: Dew Heater power to {power} (PWM value {val})")
            device_state["heater"] = power
        elif val == 1500003:
            # Enable ASIAIR
            log_message("MOCK", "Command: Enable ASIAIR control (1500003)")
            device_state["asiair_mode"] = True
        elif val == 1500004:
            # Disable ASIAIR
            log_message("MOCK", "Command: Disable ASIAIR control (1500004)")
            device_state["asiair_mode"] = False
        elif 10000 <= val <= 28000:
            # Close limit angle set: value * 100 + 10000
            # E.g. close limit of 45 deg -> 45 * 100 + 10000 = 14500
            close_limit = (val - 10000) / 100.0
            log_message("MOCK", f"Command: Set close position limit to {close_limit}°")
            device_state["close_limit"] = close_limit
        elif 40000 <= val <= 58000:
            # Open limit angle set: value * 100 + 40000
            # E.g. open limit of 180 deg -> 180 * 100 + 40000 = 58000
            open_limit = (val - 40000) / 100.0
            log_message("MOCK", f"Command: Set open position limit to {open_limit}°")
            device_state["open_limit"] = open_limit
        elif 0 <= val <= 255:
            # Brightness command
            log_message("MOCK", f"Command: Set Flat Panel Brightness to {val}")
            device_state["brightness"] = val
        else:
            log_message("MOCK", f"Command: Set Custom / Extended Code ({val})")
            
        broadcast_telemetry()
    except ValueError:
        log_message("WARNING", f"Received non-numeric command in mock mode: '{cmd}'")

def disconnect_device():
    global serial_port, read_thread, mock_thread
    with thread_lock:
        should_stop_threads.set()
        
        if serial_port and serial_port.is_open:
            try:
                serial_port.close()
            except Exception as e:
                logger.error(f"Failed to close serial port: {e}")
        
        serial_port = None
        
        # Reset state fields
        device_state["connected"] = False
        device_state["port"] = None
        device_state["is_mock"] = False
        device_state["is_moving"] = False
        
    # Wait for threads to stop outside lock
    if read_thread:
        read_thread.join(timeout=1.0)
        read_thread = None
    if mock_thread:
        mock_thread.join(timeout=1.0)
        mock_thread = None
        
    log_message("SYSTEM", "Device disconnected.")

# API Endpoints
@app.get("/api/ports")
def get_serial_ports():
    ports = serial.tools.list_ports.comports()
    port_list = [{"device": p.device, "description": p.description} for p in ports]
    # Add a Virtual Mock port option for testing
    port_list.append({"device": "VIRTUAL_MOCK", "description": "Simulator / Mock mode (no hardware required)"})
    return {"ports": port_list}

@app.post("/api/connect")
def connect_device(req: ConnectRequest):
    global serial_port, read_thread, mock_thread
    
    if device_state["connected"]:
        raise HTTPException(status_code=400, detail="Device is already connected. Disconnect first.")
        
    disconnect_device() # Ensure clean slate
    should_stop_threads.clear()
    
    port_name = req.port
    log_message("SYSTEM", f"Attempting connection to port: {port_name}")
    
    if port_name == "VIRTUAL_MOCK":
        device_state["connected"] = True
        device_state["port"] = "VIRTUAL_MOCK"
        device_state["is_mock"] = True
        log_message("SYSTEM", "Connected in Simulation (MOCK) mode.")
        
        # Start mock simulation thread
        mock_thread = threading.Thread(target=mock_motion_loop, daemon=True)
        mock_thread.start()
        return {"status": "connected", "mode": "mock"}
        
    try:
        # Standard settings: 19200 baud, 8 bits, no parity, 1 stop bit
        serial_port = serial.Serial(
            port=port_name,
            baudrate=19200,
            bytesize=serial.EIGHTBITS,
            parity=serial.PARITY_NONE,
            stopbits=serial.STOPBITS_ONE,
            timeout=1.0
        )
        
        device_state["connected"] = True
        device_state["port"] = port_name
        device_state["is_mock"] = False
        log_message("SYSTEM", f"Connected to {port_name} successfully at 19200 baud.")
        
        # Start reading thread
        read_thread = threading.Thread(target=serial_read_loop, daemon=True)
        read_thread.start()
        
        return {"status": "connected", "mode": "hardware"}
    except Exception as e:
        log_message("ERROR", f"Failed to connect to {port_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/disconnect")
def api_disconnect():
    disconnect_device()
    return {"status": "disconnected"}

@app.post("/api/cover/open")
def cover_open():
    if not device_state["connected"]:
        raise HTTPException(status_code=400, detail="Device not connected")
    send_device_command("1001")
    return {"status": "command_sent"}

@app.post("/api/cover/close")
def cover_close():
    if not device_state["connected"]:
        raise HTTPException(status_code=400, detail="Device not connected")
    send_device_command("1000")
    return {"status": "command_sent"}

@app.post("/api/cover/auto-detect-open")
def cover_auto_detect_open():
    if not device_state["connected"]:
        raise HTTPException(status_code=400, detail="Device not connected")
    send_device_command("100001")
    return {"status": "command_sent"}

@app.post("/api/cover/auto-detect-close")
def cover_auto_detect_close():
    if not device_state["connected"]:
        raise HTTPException(status_code=400, detail="Device not connected")
    send_device_command("100000")
    return {"status": "command_sent"}

@app.post("/api/cover/stop")
def cover_stop():
    if not device_state["connected"]:
        raise HTTPException(status_code=400, detail="Device not connected")
        
    # Halt movement
    if device_state["is_moving"]:
        if not device_state["is_mock"]:
            try:
                # Set limit to current position to trigger motor stop
                if abs(device_state["target_position"] - device_state["open_limit"]) <= 1.0:
                    cmd = str(int(device_state["current_position"] * 100 + 40000))
                    send_device_command(cmd)
                else:
                    cmd = str(int(device_state["current_position"] * 100 + 10000))
                    send_device_command(cmd)
            except Exception as e:
                log_message("ERROR", f"Failed to send stop limit override: {e}")
        
        # Reset local states
        device_state["is_moving"] = False
        log_message("SYSTEM", f"Halted cover motion at {device_state['current_position']}°")
        broadcast_telemetry()
        
    return {"status": "stop_sent"}


@app.post("/api/cover/limits")
def cover_set_limits(req: LimitsRequest):
    if not device_state["connected"]:
        raise HTTPException(status_code=400, detail="Device not connected")
    
    # Calculate limits commands
    close_cmd = str(int(req.close_limit * 100 + 10000))
    open_cmd = str(int(req.open_limit * 100 + 40000))
    
    send_device_command(close_cmd)
    # Yield brief delay for command processing buffer
    time.sleep(0.05)
    send_device_command(open_cmd)
    
    return {"status": "limits_sent"}

@app.post("/api/flat-panel/brightness")
def flat_panel_brightness(req: BrightnessRequest):
    if not device_state["connected"]:
        raise HTTPException(status_code=400, detail="Device not connected")
    if not (0 <= req.brightness <= 255):
        raise HTTPException(status_code=400, detail="Brightness must be between 0 and 255")
    send_device_command(str(req.brightness))
    return {"status": "brightness_sent"}

@app.post("/api/flat-panel/off")
def flat_panel_off():
    if not device_state["connected"]:
        raise HTTPException(status_code=400, detail="Device not connected")
    send_device_command("9999")
    return {"status": "light_turned_off"}

@app.post("/api/heater")
def set_heater(req: HeaterRequest):
    if not device_state["connected"]:
        raise HTTPException(status_code=400, detail="Device not connected")
    if not (0 <= req.power <= 150):
        raise HTTPException(status_code=400, detail="Dew heater power must be between 0 and 150")
    
    # Command is 2000 + value
    cmd = str(2000 + req.power)
    send_device_command(cmd)
    return {"status": "heater_sent"}

@app.post("/api/asiair")
def set_asiair(enable: bool):
    if not device_state["connected"]:
        raise HTTPException(status_code=400, detail="Device not connected")
    
    # Command: 1500003 (enable), 1500004 (disable)
    cmd = "1500003" if enable else "1500004"
    send_device_command(cmd)
    return {"status": "asiair_sent"}

@app.post("/api/custom-command")
def send_custom_cmd(req: CustomCommandRequest):
    if not device_state["connected"]:
        raise HTTPException(status_code=400, detail="Device not connected")
    send_device_command(req.command)
    return {"status": "custom_command_sent"}

# WebSockets endpoint for live telemetry & log stream
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.add(websocket)
    log_message("SYSTEM", "Client connected to telemetry stream.")
    # Push initial state instantly
    try:
        await websocket.send_text(json.dumps({
            "type": "update",
            "state": device_state,
            "logs": system_logs
        }))
        while True:
            # keep socket alive
            await websocket.receive_text()
    except WebSocketDisconnect:
        active_connections.remove(websocket)
        log_message("SYSTEM", "Client disconnected from telemetry stream.")
    except Exception as e:
        if websocket in active_connections:
            active_connections.remove(websocket)
        logger.error(f"WebSocket connection error: {e}")

# Serve UI
@app.get("/")
def read_root():
    # If index.html exists, serve it, otherwise redirect to static folder
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return RedirectResponse(url="/static/index.html")

# Mount static folder
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

if __name__ == "__main__":
    import uvicorn
    # Log starting message
    logger.info("Starting Wanderer Astro Web Server...")
    log_message("SYSTEM", "Server application initiated.")
    uvicorn.run(app, host="0.0.0.0", port=8000)
