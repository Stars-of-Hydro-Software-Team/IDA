// =================================================================
// ENDÜSTRİYEL RF TELEMETRİ ALTYAPISI VE GÜVENLİ ASENKRON MOTOR
// =================================================================

{
    let serialPort = null;
    let serialReader = null;
    let serialWriter = null;
    let keepReading = false;
    let joyInterval = null;
    let writeQueue = Promise.resolve();

    // DOM Tanımlamaları
    const hwBaud = document.getElementById("hw-baud");
    const btnConnect = document.getElementById("btn-connect");
    const hwStatusDot = document.getElementById("hw-status-dot");
    const txtMode = document.getElementById("txt-mode");
    const headerTime = document.getElementById("header-time");
    const themeBtn = document.getElementById("theme-btn");
    const htmlElement = document.documentElement;

    const posX = document.getElementById("pos-x");
    const posY = document.getElementById("pos-y");
    const imuAngle = document.getElementById("imu-angle");
    const lidar = document.getElementById("lidar");
    const activeWp = document.getElementById("active-wp");
    const batPercent = document.getElementById("bat-percent");
    const batBar = document.getElementById("bat-bar");

    const tabComp = document.getElementById("tab-competition");
    const tabVideo = document.getElementById("tab-video");
    const layerComp = document.getElementById("track-competition");
    const layerVideo = document.getElementById("track-video");
    const vehicleComp = document.getElementById("vehicle-comp");
    const vehicleVideo = document.getElementById("vehicle-video");
    const btnAuto = document.getElementById("btn-auto");
    const btnManual = document.getElementById("btn-manual");
    const startBtn = document.getElementById("start-btn");

    const confirmModal = document.getElementById("modal-mode-confirm");
    const btnModalConfirm = document.getElementById("btn-modal-confirm");
    const btnModalCancel = document.getElementById("btn-modal-cancel");

    const joyContainer = document.getElementById("joy-container");
    const joyKnob = document.getElementById("joy-knob");
    const jsAngle = document.getElementById("js-angle");
    const jsPower = document.getElementById("js-power");

    // TAM İZOLASYON: İki parkurun verileri tamamen ayrı tutuluyor
    const telemetryState = {
        competition: { x: 10.0, y: 80.0, angle: 0.0, wp: "GN2" },
        video:       { x: 0.0, y: 100.0, angle: 0.0, wp: "2" },
        lidar: 0,
        battery: 0, 
        isChanged: true 
    };

    let dragActive = false;
    let outAngle = 0;
    let outPower = 0;
    let pendingJoystickAction = null;
    let activeTrackName = "competition";
    let isMissionStarted = false; 

    const COMPETITION_WAYPOINTS = [
        { "name": "GN1", "x": 10.0, "y": 80.0, "status": "TAMAMLANDI" },
        { "name": "GN2", "x": 25.0, "y": 30.0, "status": "HEDEF" },
        { "name": "GN3", "x": 40.0, "y": 70.0, "status": "BEKLİYOR" },
        { "name": "GN4", "x": 55.0, "y": 30.0, "status": "BEKLİYOR" },
        { "name": "GN5", "x": 85.0, "y": 50.0, "status": "BEKLİYOR" }
    ];

    const VIDEO_WAYPOINTS = [
        { "name": "1", "x": 0.0, "y": 100.0, "status": "TAMAMLANDI" },
        { "name": "2", "x": 0.0, "y": 0.0, "status": "HEDEF" },
        { "name": "3", "x": 100.0, "y": 0.0, "status": "BEKLİYOR" },
        { "name": "4", "x": 100.0, "y": 100.0, "status": "BEKLİYOR" }
    ];

    setInterval(() => { headerTime.innerText = new Date().toTimeString().split(' ')[0]; }, 1000);

    themeBtn.addEventListener("click", () => {
        htmlElement.classList.toggle("dark");
        htmlElement.classList.toggle("light");
    });

    if ("serial" in navigator) {
        navigator.serial.addEventListener("disconnect", (event) => {
            if (serialPort && event.target === serialPort) {
                console.warn("RF Donanım Bağlantısı Kesildi.");
                handleDisconnect();
                alert("Kritik Uyarı: RF Bağlantısı Koptu!");
            }
        });
    }

    function handleDisconnect() {
        keepReading = false;
        if (joyInterval) { clearInterval(joyInterval); joyInterval = null; }
        try { if (serialReader) { serialReader.releaseLock(); } } catch(e){}
        try { if (serialWriter) { serialWriter.releaseLock(); } } catch(e){}
        serialReader = null;
        serialWriter = null;
        serialPort = null;
        btnConnect.innerText = "RF BAĞLAN";
        btnConnect.className = "bg-cyan-600 hover:bg-cyan-500 text-white font-black text-[10px] px-3 py-1.5 rounded transition-colors flex items-center gap-1.5";
        hwStatusDot.className = "w-2.5 h-2.5 rounded-full bg-neonRed shadow-md";
    }

    // DÜZELTME: Teşhis mekanizmalı bağlantı motoru
    btnConnect.addEventListener("click", async () => {
        if (!("serial" in navigator)) { 
            alert("Tarayıcınız Web Serial API desteklemiyor. Lütfen Chrome veya Edge kullanın."); 
            return; 
        }
        if (serialPort) return;

        try {
            serialPort = await navigator.serial.requestPort();
            await serialPort.open({ baudRate: parseInt(hwBaud.value) });

            const textDecoder = new TextDecoderStream();
            serialPort.readable.pipeTo(textDecoder.writable);
            serialReader = textDecoder.readable.getReader();

            const textEncoder = new TextEncoderStream();
            textEncoder.readable.pipeTo(serialPort.writable);
            serialWriter = textEncoder.writable.getWriter();

            btnConnect.innerText = "BAĞLANDI";
            btnConnect.className = "bg-green-600 text-white font-black text-[10px] px-3 py-1.5 rounded cursor-default flex items-center gap-1.5";
            btnConnect.innerHTML = `<i class="fas fa-check"></i> RF AKTİF`;
            hwStatusDot.className = "w-2.5 h-2.5 rounded-full bg-neonGreen shadow-[0_0_8px_#00e676] animate-pulse";
            keepReading = true;
            readSerialLoop();
            renderWaypoints();
        } catch (err) {
            // Hata sessizce yutulmaz, konsola basılır ve ekranda gösterilir
            console.error("WEB SERIAL BAĞLANTI HATASI DETAYI:", err);
            alert("Bağlantı Başarısız!\nHata Nedeni: " + err.message + "\n\nKonsolu (F12) kontrol edin.");
            handleDisconnect();
        }
    });

    function calculateChecksum(str) {
        let total = 0;
        for (let i = 0; i < str.length; i++) { total += str.charCodeAt(i); }
        return (total % 256).toString(16).toUpperCase().padStart(2, '0');
    }

    function sendCommand(rawPayload) {
        if (!serialWriter) return;
        const finalPacket = `${rawPayload}*${calculateChecksum(rawPayload)}\n`;
        writeQueue = writeQueue.then(async () => {
            if (!serialWriter) return;
            try { await serialWriter.write(finalPacket); } catch (err) {}
        });
    }

    startBtn.addEventListener("click", () => {
        if (serialWriter) {
            sendCommand("CMD:START");
            isMissionStarted = true; 
            alert("Görevi Başlat (START) emri iletildi. Kilit açıldı.");
        } else {
            alert("Önce RF Cihazına Bağlanmalısınız!");
        }
    });

    async function readSerialLoop() {
        let buffer = "";
        while (serialPort && serialPort.readable && keepReading) {
            try {
                const { value, done } = await serialReader.read();
                if (done) break;
                if (value) {
                    buffer += value;
                    let lines = buffer.split('\n');
                    buffer = lines.pop();
                    for (let line of lines) { processRFLine(line.trim()); }
                }
            } catch (error) {
                handleDisconnect();
                break;
            }
        }
    }

    function processRFLine(line) {
        if (!line || !line.includes('*')) return;
        const parts = line.split('*');
        if (parts.length !== 2) return;
        if (parts[1].toUpperCase() !== calculateChecksum(parts[0])) return;

        const subParts = parts[0].split(':');
        if (subParts.length !== 2) return;
        const header = subParts[0];
        const dataCSV = subParts[1].split(',');

        if (header === "N" && dataCSV.length === 3) {
            telemetryState[activeTrackName].x = parseFloat(dataCSV[0]);
            telemetryState[activeTrackName].y = parseFloat(dataCSV[1]);
            telemetryState[activeTrackName].angle = parseFloat(dataCSV[2]);
            telemetryState.isChanged = true;
        }
        else if (header === "S" && dataCSV.length === 2) {
            telemetryState.lidar = parseInt(dataCSV[0]) || 0;
            const rxWp = dataCSV[1].trim();
            telemetryState[activeTrackName].wp = rxWp;
            telemetryState.isChanged = true;

            const activeWps = activeTrackName === "competition" ? COMPETITION_WAYPOINTS : VIDEO_WAYPOINTS;
            let foundCurrent = false;
            for (let i = 0; i < activeWps.length; i++) {
                if (activeWps[i].name === rxWp) {
                    activeWps[i].status = "HEDEF";
                    foundCurrent = true;
                } else {
                    activeWps[i].status = foundCurrent ? "BEKLİYOR" : "TAMAMLANDI";
                }
            }
            renderWaypoints();
        }
        else if (header === "D" && dataCSV.length === 1) {
            telemetryState.battery = parseFloat(dataCSV[0]);
            telemetryState.isChanged = true;
        }
    }

    function renderLoop() {
        if (telemetryState.isChanged) {
            vehicleComp.style.left = `${telemetryState.competition.x}%`;
            vehicleComp.style.top = `${telemetryState.competition.y}%`;
            vehicleComp.style.transform = `translate(-50%, -50%) rotate(${telemetryState.competition.angle}deg)`;

            vehicleVideo.style.left = `${telemetryState.video.x}%`;
            vehicleVideo.style.top = `${telemetryState.video.y}%`;
            vehicleVideo.style.transform = `translate(-50%, -50%) rotate(${telemetryState.video.angle}deg)`;

            posX.innerText = telemetryState[activeTrackName].x.toFixed(1);
            posY.innerText = telemetryState[activeTrackName].y.toFixed(1);
            imuAngle.innerText = telemetryState[activeTrackName].angle.toFixed(1);
            activeWp.innerText = telemetryState[activeTrackName].wp;

            lidar.innerText = telemetryState.lidar;
            batPercent.innerText = `%${telemetryState.battery.toFixed(0)}`;
            batPercent.className = "text-xl font-black font-mono text-neonGreen";
            
            const batIcon = document.getElementById("bat-icon");
            batIcon.className = telemetryState.battery < 20 ? "fas fa-battery-quarter text-base text-neonRed" : "fas fa-battery-full text-base text-neonGreen";
            batBar.style.width = `${telemetryState.battery}%`;
            batBar.className = telemetryState.battery < 20 ? "bg-neonRed h-full transition-all" : "bg-gradient-to-r from-neonGreen to-green-400 h-full transition-all";

            telemetryState.isChanged = false;
        }
        requestAnimationFrame(renderLoop);
    }
    requestAnimationFrame(renderLoop);

    if (tabComp && tabVideo) {
        function switchTrack(trackName) {
            activeTrackName = trackName;
            
            COMPETITION_WAYPOINTS[0].status = "HEDEF";
            for(let i=1; i<5; i++) COMPETITION_WAYPOINTS[i].status = "BEKLİYOR";
            VIDEO_WAYPOINTS[0].status = "HEDEF";
            for(let i=1; i<4; i++) VIDEO_WAYPOINTS[i].status = "BEKLİYOR";

            if (trackName === "competition") {
                layerComp.style.display = "block"; layerVideo.style.display = "none";
                tabComp.className = "px-4 h-10 text-[11px] font-bold border-b-2 border-neonCyan text-neonCyan";
                tabVideo.className = "px-4 h-10 text-[11px] font-bold border-b-2 border-transparent text-gray-500 dark:text-gray-400";
                sendCommand("TRACK:COMPETITION"); 
            } else {
                layerComp.style.display = "none"; layerVideo.style.display = "flex";
                tabVideo.className = "px-4 h-10 text-[11px] font-bold border-b-2 border-neonCyan text-neonCyan";
                tabComp.className = "px-4 h-10 text-[11px] font-bold border-b-2 border-transparent text-gray-500 dark:text-gray-400";
                sendCommand("TRACK:VIDEO"); 
            }
            
            telemetryState.isChanged = true;
            renderWaypoints();
        }
        tabComp.addEventListener("click", () => switchTrack("competition"));
        tabVideo.addEventListener("click", () => switchTrack("video"));
    }

    function renderWaypoints() {
        const compMarkers = document.getElementById("comp-markers");
        const videoMarkers = document.getElementById("video-markers");
        if (!compMarkers || !videoMarkers) return;
        
        compMarkers.innerHTML = ""; videoMarkers.innerHTML = "";

        const isComp = layerComp.style.display !== "none";
        const targetContainer = isComp ? compMarkers : videoMarkers;
        const activeWps = isComp ? COMPETITION_WAYPOINTS : VIDEO_WAYPOINTS;

        activeWps.forEach((wp) => {
            targetContainer.innerHTML += `
                <div class="absolute w-4 h-4 rounded-full border bg-bgCard text-[8px] font-black flex items-center justify-center ${wp.status === 'HEDEF' ? 'border-neonOrange text-neonOrange shadow-md animate-pulse': (wp.status === 'TAMAMLANDI' ? 'border-neonGreen text-neonGreen' : 'border-gray-600 text-gray-400')}" style="left: ${wp.x}%; top: ${wp.y}%; transform: translate(-50%, -50%);">
                    ${wp.name.replace("GN", "")[0]}
                </div>`;
        });
    }

    function calculateJoystickValues(clientX, clientY) {
        const rect = joyContainer.getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const deltaX = (clientX - rect.left) - centerX;
        const deltaY = (clientY - rect.top) - centerY;
        const maxRadius = (rect.width / 2) - (joyKnob.clientWidth / 2);
        const distance = Math.min(Math.hypot(deltaX, deltaY), maxRadius);
        let rad = Math.atan2(-deltaY, deltaX);
        let deg = rad * (180 / Math.PI);
        if (deg < 0) deg += 360;
        let compassDeg = (450 - Math.round(deg)) % 360;
        if (distance === 0) compassDeg = 0;
        return { distance, maxRadius, angle: compassDeg, rad };
    }

    function moveKnob(clientX, clientY) {
        const metrics = calculateJoystickValues(clientX, clientY);
        if (!isMissionStarted) {
            if (metrics.distance > 5) {
                dragActive = false; stopKnob();
                alert("Kritik Güvenlik Uyarısı: Görevi başlatmadan joystick kontrolü sağlayamazsınız!");
            }
            return;
        }
        if (txtMode.innerText === "AUTONOMOUS") {
            if (metrics.distance > 8) {
                dragActive = false;
                if (joyInterval) { clearInterval(joyInterval); joyInterval = null; }
                joyKnob.style.transform = `translate(0px, 0px)`;
                pendingJoystickAction = { angle: metrics.angle, power: Math.round((metrics.distance / metrics.maxRadius) * 100) };
                confirmModal.classList.remove("hidden"); confirmModal.classList.add("flex");
            }
            return;
        }
        const finalX = metrics.distance * Math.cos(metrics.rad);
        const finalY = -metrics.distance * Math.sin(metrics.rad);
        joyKnob.style.transform = `translate(${finalX}px, ${finalY}px)`;
        outAngle = metrics.angle;
        outPower = Math.round((metrics.distance / metrics.maxRadius) * 100);
        jsAngle.innerText = `${outAngle}°`;
        jsPower.innerText = `%${outPower}`;
    }

    function stopKnob() {
        dragActive = false; outAngle = 0; outPower = 0;
        joyKnob.style.transform = `translate(0px, 0px)`;
        jsAngle.innerText = "0°"; jsPower.innerText = "%0";
        if (joyInterval) { clearInterval(joyInterval); joyInterval = null; }
        if (serialWriter && txtMode.innerText === "MANUEL") { sendCommand("JOY:0,0"); }
    }

    btnModalConfirm.addEventListener("click", () => {
        confirmModal.classList.replace("flex", "hidden");
        txtMode.innerText = "MANUEL"; setUIModeVisual(false);
        sendCommand("MODE:MANUEL");
        if (pendingJoystickAction) sendCommand(`JOY:${pendingJoystickAction.angle},${pendingJoystickAction.power}`);
        pendingJoystickAction = null; dragActive = false;
    });

    btnModalCancel.addEventListener("click", () => {
        confirmModal.classList.replace("flex", "hidden");
        pendingJoystickAction = null; dragActive = false; stopKnob();
    });

    function startJoystickCommunication() {
        if (joyInterval) clearInterval(joyInterval);
        joyInterval = setInterval(() => { 
            if (serialWriter && dragActive && txtMode.innerText === "MANUEL") { sendCommand(`JOY:${outAngle},${outPower}`); }
        }, 100);
    }

    joyContainer.addEventListener("mousedown", (e) => {
        if (txtMode.innerText === "AUTONOMOUS") { moveKnob(e.clientX, e.clientY); return; }
        dragActive = true; moveKnob(e.clientX, e.clientY); startJoystickCommunication();
    });
    document.addEventListener("mousemove", (e) => { if (dragActive) moveKnob(e.clientX, e.clientY); });
    document.addEventListener("mouseup", () => { if (dragActive) stopKnob(); });

    joyContainer.addEventListener("touchstart", (e) => {
        if (txtMode.innerText === "AUTONOMOUS") { moveKnob(e.touches[0].clientX, e.touches[0].clientY); return; }
        dragActive = true; moveKnob(e.touches[0].clientX, e.touches[0].clientY); startJoystickCommunication();
    });
    document.addEventListener("touchmove", (e) => { if (dragActive) moveKnob(e.touches[0].clientX, e.touches[0].clientY); });
    document.addEventListener("touchend", () => { if (dragActive) stopKnob(); });

    function setUIModeVisual(isAuto) {
        if (isAuto) {
            btnAuto.className = "p-2 rounded border border-neonCyan bg-neonCyan/10 text-[10px] font-black text-neonCyan flex items-center justify-center gap-1";
            btnManual.className = "p-2 rounded border border-gray-300 dark:border-gray-700 bg-bgCard text-[10px] font-black text-gray-500 dark:text-gray-400 flex items-center justify-center gap-1";
        } else {
            btnManual.className = "p-2 rounded border border-neonCyan bg-neonCyan/10 text-[10px] font-black text-neonCyan flex items-center justify-center gap-1";
            btnAuto.className = "p-2 rounded border border-gray-300 dark:border-gray-700 bg-bgCard text-[10px] font-black text-gray-500 dark:text-gray-400 flex items-center justify-center gap-1";
        }
    }

    btnAuto.addEventListener("click", () => { 
        txtMode.innerText = "AUTONOMOUS"; setUIModeVisual(true); sendCommand("MODE:AUTONOMOUS");
    });
    btnManual.addEventListener("click", () => { 
        txtMode.innerText = "MANUEL"; setUIModeVisual(false); sendCommand("MODE:MANUEL");
    });

    const killBtn = document.getElementById("kill-btn");
    const emergencyOverlay = document.getElementById("emergency-overlay");
    const overlayResetBtn = document.getElementById("overlay-reset-btn");

    function triggerKill() {
        if (joyInterval) { clearInterval(joyInterval); joyInterval = null; }
        sendCommand("CMD:FAILSAFE"); isMissionStarted = false; 
        emergencyOverlay.classList.remove("hidden"); emergencyOverlay.classList.add("flex");
    }
    killBtn.addEventListener("click", triggerKill);
    window.addEventListener("keydown", (e) => { if (e.code === "Space") { e.preventDefault(); triggerKill(); } });
    overlayResetBtn.addEventListener("click", () => { 
        emergencyOverlay.classList.replace("flex", "hidden"); 
        sendCommand("MODE:MANUEL"); switchTrack("competition"); 
    });

    renderWaypoints();
}
