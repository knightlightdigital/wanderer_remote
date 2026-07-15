// DASHBOARD LOGIC FOR WANDERER ASTR REMOTE CONTROL

document.addEventListener("DOMContentLoaded", () => {
    // DOM Elements
    const portSelect = document.getElementById("portSelect");
    const btnScan = document.getElementById("btnScan");
    const btnConnect = document.getElementById("btnConnect");
    const btnDisconnect = document.getElementById("btnDisconnect");
    
    const headerStatusPill = document.getElementById("headerStatusPill");
    const headerStatusText = document.getElementById("headerStatusText");
    
    const telePos = document.getElementById("telePos");
    const telePosState = document.getElementById("telePosState");
    const teleVolts = document.getElementById("teleVolts");
    const teleVoltsState = document.getElementById("teleVoltsState");
    const cardVoltage = document.getElementById("cardVoltage");
    
    const infoModel = document.getElementById("infoModel");
    const infoFirmware = document.getElementById("infoFirmware");
    const infoAsiair = document.getElementById("infoAsiair");
    
    const gaugeNeedle = document.getElementById("gaugeNeedle");
    const visAngle = document.getElementById("visAngle");
    
    const btnOpen = document.getElementById("btnOpen");
    const btnClose = document.getElementById("btnClose");
    
    const heaterPowerVal = document.getElementById("heaterPowerVal");
    const heaterSlider = document.getElementById("heaterSlider");
    const quickHeaterBtns = document.querySelectorAll(".btn-quick-ht");
    
    const lightStateText = document.getElementById("lightStateText");
    const lightToggle = document.getElementById("lightToggle");
    const brightnessSlider = document.getElementById("brightnessSlider");
    const brightnessInput = document.getElementById("brightnessInput");
    const btnSavePresets = document.getElementById("btnSavePresets");
    const presetsGrid = document.getElementById("presetsGrid");
    
    const closeLimitInput = document.getElementById("closeLimitInput");
    const openLimitInput = document.getElementById("openLimitInput");
    const btnSetLimits = document.getElementById("btnSetLimits");
    const btnAutoClose = document.getElementById("btnAutoClose");
    const btnAutoOpen = document.getElementById("btnAutoOpen");
    const asiairToggle = document.getElementById("asiairToggle");
    
    const consoleBody = document.getElementById("consoleBody");
    const btnClearConsole = document.getElementById("btnClearConsole");
    const chkAutoScroll = document.getElementById("chkAutoScroll");
    const customCommandInput = document.getElementById("customCommandInput");
    const btnSendCustom = document.getElementById("btnSendCustom");

    // Local state variables
    let socket = null;
    let wsConnectInterval = null;
    let filterPresets = {
        "Luminance": 120,
        "Red": 140,
        "Green": 140,
        "Blue": 140,
        "H-Alpha": 250,
        "OIII": 250,
        "SII": 250,
        "Dark Flat": 0
    };

    // Load custom presets if saved
    if (localStorage.getItem("wanderer_presets")) {
        try {
            filterPresets = JSON.parse(localStorage.getItem("wanderer_presets"));
        } catch (e) {
            console.error("Error loading presets from local storage:", e);
        }
    }

    // Initialize UI
    scanPorts();
    renderPresets();
    connectWebSocket();

    // Event Listeners
    btnScan.addEventListener("click", scanPorts);
    portSelect.addEventListener("change", () => {
        btnConnect.disabled = !portSelect.value;
    });

    btnConnect.addEventListener("click", () => {
        const selectedPort = portSelect.value;
        if (!selectedPort) return;
        
        btnConnect.disabled = true;
        postData("/api/connect", { port: selectedPort })
            .then(data => {
                appendLogLine("system", `Connection command sent for port: ${selectedPort}`);
            })
            .catch(err => {
                appendLogLine("error", `Failed to initiate connection: ${err.message}`);
                btnConnect.disabled = false;
            });
    });

    btnDisconnect.addEventListener("click", () => {
        btnDisconnect.disabled = true;
        postData("/api/disconnect")
            .then(() => {
                appendLogLine("system", "Disconnect command sent.");
            })
            .catch(err => {
                appendLogLine("error", `Failed to disconnect: ${err.message}`);
                btnDisconnect.disabled = false;
            });
    });

    // Cover positioning
    btnOpen.addEventListener("click", () => {
        postData("/api/cover/open")
            .then(() => appendLogLine("system", "Sent Open Cover command."))
            .catch(err => appendLogLine("error", `Open Cover failed: ${err.message}`));
    });

    btnClose.addEventListener("click", () => {
        postData("/api/cover/close")
            .then(() => appendLogLine("system", "Sent Close Cover command."))
            .catch(err => appendLogLine("error", `Close Cover failed: ${err.message}`));
    });

    // Dew Heater Slider Events
    heaterSlider.addEventListener("input", (e) => {
        const val = parseInt(e.target.value);
        heaterPowerVal.textContent = val === 0 ? "Off" : `${Math.round((val/150)*100)}% (${val})`;
    });

    heaterSlider.addEventListener("change", (e) => {
        const val = parseInt(e.target.value);
        postData("/api/heater", { power: val })
            .then(() => appendLogLine("system", `Sent Heater level: ${val}`))
            .catch(err => appendLogLine("error", `Heater set failed: ${err.message}`));
    });

    // Quick Heater presets
    quickHeaterBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            const val = parseInt(btn.getAttribute("data-val"));
            postData("/api/heater", { power: val })
                .then(() => {
                    heaterSlider.value = val;
                    heaterPowerVal.textContent = val === 0 ? "Off" : `${Math.round((val/150)*100)}% (${val})`;
                    appendLogLine("system", `Sent quick Heater level: ${val}`);
                })
                .catch(err => appendLogLine("error", `Heater set failed: ${err.message}`));
        });
    });

    // Flats light panel events
    lightToggle.addEventListener("change", (e) => {
        const isChecked = e.target.checked;
        if (isChecked) {
            let val = parseInt(brightnessSlider.value);
            if (val === 0) {
                val = 128;
                brightnessSlider.value = val;
                brightnessInput.value = val;
            }
            postData("/api/flat-panel/brightness", { brightness: val })
                .then(() => {
                    appendLogLine("system", `Flat panel turned ON (Brightness: ${val})`);
                    lightStateText.textContent = "ON";
                })
                .catch(err => {
                    appendLogLine("error", `Flat panel turn ON failed: ${err.message}`);
                    lightToggle.checked = false;
                    lightStateText.textContent = "OFF";
                });
        } else {
            postData("/api/flat-panel/off")
                .then(() => {
                    appendLogLine("system", "Flat panel turned OFF");
                    lightStateText.textContent = "OFF";
                })
                .catch(err => {
                    appendLogLine("error", `Flat panel turn OFF failed: ${err.message}`);
                    lightToggle.checked = true;
                    lightStateText.textContent = "ON";
                });
        }
    });

    brightnessSlider.addEventListener("input", (e) => {
        const val = parseInt(e.target.value);
        brightnessInput.value = val;
    });

    // Handle brightness change (drag release)
    brightnessSlider.addEventListener("change", (e) => {
        const val = parseInt(e.target.value);
        setBrightness(val);
    });

    brightnessInput.addEventListener("change", (e) => {
        let val = parseInt(e.target.value);
        if (isNaN(val)) val = 0;
        val = Math.max(0, Math.min(255, val));
        brightnessInput.value = val;
        brightnessSlider.value = val;
        setBrightness(val);
    });

    function setBrightness(val) {
        postData("/api/flat-panel/brightness", { brightness: val })
            .then(() => {
                appendLogLine("system", `Sent Brightness: ${val}`);
                if (val > 0) {
                    lightToggle.checked = true;
                    lightStateText.textContent = "ON";
                } else {
                    lightToggle.checked = false;
                    lightStateText.textContent = "OFF";
                }
            })
            .catch(err => appendLogLine("error", `Brightness set failed: ${err.message}`));
    }

    // Save Preset Values
    btnSavePresets.addEventListener("click", () => {
        const activePresetBtn = document.querySelector(".presets-grid .active");
        if (activePresetBtn) {
            const presetName = activePresetBtn.getAttribute("data-preset");
            const currentVal = parseInt(brightnessSlider.value);
            filterPresets[presetName] = currentVal;
            localStorage.setItem("wanderer_presets", JSON.stringify(filterPresets));
            renderPresets();
            appendLogLine("system", `Saved current brightness (${currentVal}) to preset [${presetName}]`);
        } else {
            alert("Please click and select a preset filter button first to modify its saved value.");
        }
    });

    // Custom Limits Setup
    btnSetLimits.addEventListener("click", () => {
        const closeLim = parseFloat(closeLimitInput.value);
        const openLim = parseFloat(openLimitInput.value);
        if (isNaN(closeLim) || isNaN(openLim)) return;
        
        postData("/api/cover/limits", { close_limit: closeLim, open_limit: openLim })
            .then(() => appendLogLine("system", `Limits sent: Close=${closeLim}°, Open=${openLim}°`))
            .catch(err => appendLogLine("error", `Set Limits failed: ${err.message}`));
    });

    btnAutoClose.addEventListener("click", () => {
        postData("/api/cover/auto-detect-close")
            .then(() => appendLogLine("system", "Initiated Close Limit Auto-Detection."))
            .catch(err => appendLogLine("error", `Auto-detection failed: ${err.message}`));
    });

    btnAutoOpen.addEventListener("click", () => {
        postData("/api/cover/auto-detect-open")
            .then(() => appendLogLine("system", "Initiated Open Limit Auto-Detection."))
            .catch(err => appendLogLine("error", `Auto-detection failed: ${err.message}`));
    });

    asiairToggle.addEventListener("change", (e) => {
        const enabled = e.target.checked;
        postData(`/api/asiair?enable=${enabled}`)
            .then(() => appendLogLine("system", `ASIAIR Control Mode: ${enabled ? 'ENABLED' : 'DISABLED'}`))
            .catch(err => {
                appendLogLine("error", `Failed to set ASIAIR Mode: ${err.message}`);
                asiairToggle.checked = !enabled;
            });
    });

    // Clear logs
    btnClearConsole.addEventListener("click", () => {
        consoleBody.innerHTML = '<div class="console-line system">[SYSTEM] Console cleared.</div>';
    });

    // Custom terminal command
    customCommandInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            sendCustomCmd();
        }
    });
    btnSendCustom.addEventListener("click", sendCustomCmd);

    function sendCustomCmd() {
        const cmd = customCommandInput.value.trim();
        if (!cmd) return;
        
        postData("/api/custom-command", { command: cmd })
            .then(() => {
                appendLogLine("serial_out", cmd);
                customCommandInput.value = "";
            })
            .catch(err => appendLogLine("error", `Command transmission failed: ${err.message}`));
    }

    // Methods
    function scanPorts() {
        portSelect.innerHTML = '<option value="" disabled selected>Scanning ports...</option>';
        fetch("/api/ports")
            .then(res => res.json())
            .then(data => {
                portSelect.innerHTML = "";
                if (data.ports.length === 0) {
                    portSelect.innerHTML = '<option value="" disabled>No serial ports found</option>';
                    return;
                }
                
                data.ports.forEach(p => {
                    const option = document.createElement("option");
                    option.value = p.device;
                    option.textContent = `${p.device} (${p.description})`;
                    portSelect.appendChild(option);
                });
                
                // Select first by default if ports exist
                if (data.ports.length > 0) {
                    portSelect.selectedIndex = 0;
                    btnConnect.disabled = false;
                }
            })
            .catch(err => {
                portSelect.innerHTML = '<option value="" disabled>Failed to scan ports</option>';
                console.error("Port scan error:", err);
            });
    }

    function renderPresets() {
        presetsGrid.innerHTML = "";
        Object.entries(filterPresets).forEach(([filter, val]) => {
            const btn = document.createElement("button");
            btn.className = "btn-preset";
            btn.setAttribute("data-preset", filter);
            btn.innerHTML = `
                <span class="preset-name">${filter}</span>
                <span class="preset-val">${val}</span>
            `;
            
            btn.addEventListener("click", () => {
                // Set active class
                document.querySelectorAll(".btn-preset").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                
                // Apply preset brightness value
                brightnessSlider.value = val;
                brightnessInput.value = val;
                setBrightness(val);
            });
            
            // disable preset button if device is disconnected
            btn.disabled = !btnConnect.classList.contains("hidden");
            presetsGrid.appendChild(btn);
        });
    }

    function connectWebSocket() {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        
        socket = new WebSocket(wsUrl);
        
        socket.onopen = () => {
            console.log("WebSocket connected.");
            clearInterval(wsConnectInterval);
            wsConnectInterval = null;
        };
        
        socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === "update") {
                updateUIState(data.state);
                if (data.logs) {
                    data.logs.forEach(log => {
                        appendLogLine(log.level.toLowerCase(), `[${log.level}] ${log.text}`);
                    });
                }
            }
        };
        
        socket.onclose = () => {
            console.log("WebSocket disconnected. Retrying in 3 seconds...");
            // Reset connection UI on websocket drop
            updateUIState({ connected: false });
            if (!wsConnectInterval) {
                wsConnectInterval = setInterval(connectWebSocket, 3000);
            }
        };
        
        socket.onerror = (err) => {
            console.error("WebSocket encountered error: ", err);
            socket.close();
        };
    }

    function updateUIState(state) {
        const isConnected = state.connected;
        
        // Update connection display
        if (isConnected) {
            btnConnect.classList.add("hidden");
            btnDisconnect.classList.remove("hidden");
            btnDisconnect.disabled = false;
            portSelect.disabled = true;
            btnScan.disabled = true;
            
            // Set status pill class
            headerStatusPill.className = "connection-status-pill " + (state.is_mock ? "mock" : "connected");
            headerStatusText.textContent = state.is_mock ? `Connected (Simulated)` : `Connected: ${state.port}`;
            
            // Enable controls depending on motion state
            const isMoving = state.is_moving;
            
            btnOpen.disabled = isMoving;
            btnClose.disabled = isMoving;
            
            if (isMoving) {
                document.querySelector(".position-visualizer").classList.add("is-moving");
                if (state.target_position === state.close_limit) {
                    btnClose.innerHTML = '<span class="btn-text">Closing...</span><span class="btn-subtext">Cover closing</span>';
                    btnOpen.innerHTML = '<span class="btn-text">Open Cover</span><span class="btn-subtext">Disabled in motion</span>';
                } else {
                    btnOpen.innerHTML = '<span class="btn-text">Opening...</span><span class="btn-subtext">Cover opening</span>';
                    btnClose.innerHTML = '<span class="btn-text">Close Cover</span><span class="btn-subtext">Disabled in motion</span>';
                }
            } else {
                document.querySelector(".position-visualizer").classList.remove("is-moving");
                btnOpen.innerHTML = '<span class="btn-text">Open Cover</span><span class="btn-subtext">Saves optics from dust</span>';
                btnClose.innerHTML = '<span class="btn-text">Close Cover</span><span class="btn-subtext">Takes Flat frames</span>';
            }
            
            heaterSlider.disabled = false;
            brightnessSlider.disabled = false;
            brightnessInput.disabled = false;
            lightToggle.disabled = false;
            closeLimitInput.disabled = false;
            openLimitInput.disabled = false;
            btnSetLimits.disabled = false;
            btnAutoClose.disabled = isMoving;
            btnAutoOpen.disabled = isMoving;
            asiairToggle.disabled = false;
            customCommandInput.disabled = false;
            btnSendCustom.disabled = false;
            
            quickHeaterBtns.forEach(btn => btn.disabled = false);
            
            // Populate Telemetry
            telePos.textContent = state.current_position.toFixed(1);
            visAngle.textContent = state.current_position.toFixed(1);
            
            // Position Label Desc
            let posDesc = "Moving...";
            if (!isMoving) {
                if (Math.abs(state.current_position - state.close_limit) <= 1.0) {
                    posDesc = "Closed";
                } else if (Math.abs(state.current_position - state.open_limit) <= 1.0) {
                    posDesc = "Opened";
                } else {
                    posDesc = "Intermediate";
                }
                telePosState.classList.remove("moving");
            } else {
                telePosState.classList.add("moving");
            }
            telePosState.textContent = posDesc;
            
            teleVolts.textContent = state.voltage.toFixed(1);
            if (state.voltage < 11.5 && state.voltage > 1.0) {
                cardVoltage.classList.add("alert-danger"); // Low power alert visual
                teleVoltsState.textContent = "LOW VOLTAGE";
            } else {
                cardVoltage.classList.remove("alert-danger");
                teleVoltsState.textContent = "Normal";
            }
            
            // Details
            infoModel.textContent = state.device_name;
            infoFirmware.textContent = state.firmware;
            infoAsiair.textContent = state.asiair_mode ? "Enabled" : "Disabled";
            
            // Slider Values sync
            if (document.activeElement !== heaterSlider) {
                heaterSlider.value = state.heater;
                heaterPowerVal.textContent = state.heater === 0 ? "Off" : `${Math.round((state.heater/150)*100)}% (${state.heater})`;
            }
            
            if (document.activeElement !== brightnessSlider && document.activeElement !== brightnessInput) {
                brightnessSlider.value = state.brightness;
                brightnessInput.value = state.brightness;
                
                if (state.brightness > 0) {
                    lightToggle.checked = true;
                    lightStateText.textContent = "ON";
                } else {
                    lightToggle.checked = false;
                    lightStateText.textContent = "OFF";
                }
            }
            
            // Inputs sync
            if (document.activeElement !== closeLimitInput) {
                closeLimitInput.value = state.close_limit.toFixed(1);
            }
            if (document.activeElement !== openLimitInput) {
                openLimitInput.value = state.open_limit.toFixed(1);
            }
            asiairToggle.checked = state.asiair_mode;
            
            // Gauge Need Rotational Transformation
            // Mapping: 0 deg = -135deg rotation, 300 deg = +135deg rotation
            const maxScale = Math.max(state.open_limit, 300.0);
            const needleRotation = -135 + (state.current_position / maxScale) * 270.0;
            gaugeNeedle.style.transform = `rotate(${needleRotation}deg)`;
            gaugeNeedle.setAttribute("transform", `rotate(${needleRotation}, 100, 100)`);
            
        } else {
            // Offline layout
            btnConnect.classList.remove("hidden");
            btnConnect.disabled = !portSelect.value;
            btnDisconnect.classList.add("hidden");
            portSelect.disabled = false;
            btnScan.disabled = false;
            
            headerStatusPill.className = "connection-status-pill disconnected";
            headerStatusText.textContent = "Disconnected";
            
            // Disable all controls
            btnOpen.disabled = true;
            btnClose.disabled = true;
            heaterSlider.disabled = true;
            brightnessSlider.disabled = true;
            brightnessInput.disabled = true;
            lightToggle.disabled = true;
            closeLimitInput.disabled = true;
            openLimitInput.disabled = true;
            btnSetLimits.disabled = true;
            btnAutoClose.disabled = true;
            btnAutoOpen.disabled = true;
            asiairToggle.disabled = true;
            customCommandInput.disabled = true;
            btnSendCustom.disabled = true;
            
            quickHeaterBtns.forEach(btn => btn.disabled = true);
            
            // Offline values reset
            telePos.textContent = "0.0";
            telePosState.textContent = "Offline";
            teleVolts.textContent = "0.0";
            teleVoltsState.textContent = "Offline";
            cardVoltage.classList.remove("alert-danger");
            
            infoModel.textContent = "—";
            infoFirmware.textContent = "—";
            infoAsiair.textContent = "Offline";
            
            visAngle.textContent = "0.0";
            gaugeNeedle.style.transform = "rotate(-135deg)"; // Closed rest position
            gaugeNeedle.setAttribute("transform", "rotate(-135, 100, 100)");
        }
        
        // Refresh presets disable state
        document.querySelectorAll(".btn-preset").forEach(btn => btn.disabled = !isConnected);
    }

    // Helper: Append log lines to UI console
    const uniqueLogs = new Set();
    function appendLogLine(level, text) {
        // De-duplicate fast-firing telemetry packets in console to reduce clutter
        if (level === "serial_in" || level === "serial_mock_out") {
            const lastLog = consoleBody.lastElementChild;
            if (lastLog && lastLog.textContent.includes(text)) {
                return;
            }
        }
        
        const line = document.createElement("div");
        line.className = `console-line ${level}`;
        
        const timestamp = new Date().toLocaleTimeString();
        line.textContent = `[${timestamp}] ${text}`;
        
        consoleBody.appendChild(line);
        
        // Keep console length reasonable
        while (consoleBody.children.length > 100) {
            consoleBody.removeChild(consoleBody.firstChild);
        }
        
        if (chkAutoScroll.checked) {
            consoleBody.scrollTop = consoleBody.scrollHeight;
        }
    }

    // Helper: REST post helper
    function postData(url = "", data = {}) {
        return fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: Object.keys(data).length > 0 ? JSON.stringify(data) : null,
        }).then(res => {
            if (!res.ok) {
                return res.json().then(json => { throw new Error(json.detail || "API request failed"); });
            }
            return res.json();
        });
    }
});
