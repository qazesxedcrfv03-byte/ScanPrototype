// scan.js — สแกนใบหน้า
let scanInterval         = null;
let currentDetectedLabel = null;
let isScanning           = false;
let isProcessing         = false;
let lastCheckinAt        = 0;
const CHECKIN_COOLDOWN_MS = 3000; // กันกดซ้ำ/ยิงบันทึกซ้ำเร็วเกินไปหลังเช็กอินสำเร็จ

async function startScanning() {
    if (!registeredFaces || registeredFaces.length === 0) {
        showToast('⚠️ ยังไม่มีข้อมูลในระบบ กรุณาลงทะเบียนก่อน');
        return;
    }
    if (isScanning) return;
    if (!cameraActive) {
        showToast('⚠️ กล้องยังไม่พร้อม กรุณารอสักครู่');
        await startCamera();
        if (!cameraActive) return;
    }
    isScanning = true;

    document.getElementById('startBtn').disabled = true;
    document.getElementById('stopBtn').disabled  = false;
    document.getElementById('recDot').classList.add('active');
    document.getElementById('scanOverlay').style.display = 'none';
    setStatusCard('detecting', '🔍', 'กำลังตรวจจับใบหน้า...');

    const video = document.getElementById('video');
    const canvas = document.getElementById('canvas');
    if (!video || !canvas) { stopScanning(); return; }

    const displaySize = { width: video.videoWidth || 640, height: video.videoHeight || 480 };
    faceapi.matchDimensions(canvas, displaySize);

    const labeled = registeredFaces
        .filter(s => s.descriptors && s.descriptors.length > 0)
        .map(s => new faceapi.LabeledFaceDescriptors(
            `${s.name}|||${s.id}|||${s.year||''}`,
            s.descriptors.map(d => new Float32Array(d))
        ));

    if (labeled.length === 0) {
        showToast('⚠️ ไม่พบข้อมูลใบหน้าในระบบ');
        stopScanning();
        return;
    }

    // อ่านค่าความเข้มงวดจาก CONFIG สดทุกครั้งที่เริ่มสแกน (รองรับการปรับจากหน้าตั้งค่าโดยไม่ต้องรีเฟรช)
    const matcher = new faceapi.FaceMatcher(labeled, CONFIG.FACE_MATCH_THRESHOLD);
    const ctx = canvas.getContext('2d');

    scanInterval = setInterval(async () => {
        if (!isScanning || isProcessing) return;
        isProcessing = true;
        try {
            const detections = await faceapi
                .detectAllFaces(video, new faceapi.SsdMobilenetv1Options({ minConfidence: CONFIG.FACE_DETECT_MIN_CONFIDENCE }))
                .withFaceLandmarks()
                .withFaceDescriptors();

            const dSize   = { width: video.videoWidth || 640, height: video.videoHeight || 480 };
            const resized = faceapi.resizeResults(detections, dSize);
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            if (resized.length === 0) {
                hideDetectCard(); hideUnknownCard();
                setStatusCard('detecting', '🔍', 'กำลังตรวจจับใบหน้า...');
                return;
            }

            // Validate: only 1 face at a time
            if (resized.length > 1) {
                setStatusCard('detecting', '⚠️', 'กรุณาให้มีเพียง 1 คนในกรอบ');
                hideDetectCard(); hideUnknownCard();
                return;
            }

            setStatusCard('recognizing', '🧬', 'กำลังจดจำใบหน้า...');

            const results = resized.map(d => matcher.findBestMatch(d.descriptor));
            let foundKnown = false, foundUnknown = false;

            results.forEach((result, i) => {
                const { detection, landmarks } = resized[i];
                const box      = detection.box;
                const isUnknown = result.label === 'unknown';
                const color    = isUnknown ? '#dc2626' : '#0ea5e9';

                // Face size validation
                const faceArea = box.width * box.height;
                const frameArea = video.videoWidth * video.videoHeight;
                if (faceArea < frameArea * 0.05) {
                    setStatusCard('detecting', '↔️', 'ขยับเข้าใกล้กล้องอีกนิด');
                    return;
                }

                new faceapi.draw.DrawFaceLandmarks(landmarks, { lineWidth:1, drawLines:true, color }).draw(canvas);
                drawCornerBox(ctx, box, color);

                const label = isUnknown ? '[ UNKNOWN ]' : `[ ${result.label.split('|||')[0]} ]`;
                const conf  = Math.round((1 - result.distance) * 100);
                ctx.save(); ctx.scale(-1,1);
                ctx.fillStyle = color;
                ctx.font = 'bold 13px JetBrains Mono, monospace';
                ctx.fillText(label, -(box.x + box.width), box.y - 8);
                if (!isUnknown) { ctx.fillStyle='rgba(14,165,233,0.85)'; ctx.font='11px monospace'; ctx.fillText(`${conf}%`, -(box.x + box.width), box.y + box.height + 16); }
                ctx.restore();

                if (!isUnknown) {
                    foundKnown = true;
                    if (currentDetectedLabel !== result.label) {
                        currentDetectedLabel = result.label;
                        showDetectCard(result.label, conf);
                    }
                } else {
                    foundUnknown = true;
                }
            });
            if (!foundKnown) hideDetectCard();
            if (foundUnknown && !foundKnown) showUnknownCard(); else hideUnknownCard();
            if (foundKnown) setStatusCard('success', '✅', 'พบข้อมูลนักศึกษา');
        } catch (err) {
            console.error('Scan detection error:', err);
        } finally {
            isProcessing = false;
        }
    }, CONFIG.DETECTION_INTERVAL_MS);
}

function drawCornerBox(ctx, box, color) {
    const { x, y, width:w, height:h } = box;
    const s = 22;
    ctx.strokeStyle = color; ctx.lineWidth = 2.5;
    ctx.save(); ctx.scale(-1,1);
    const mx = -(x + w);
    ctx.beginPath();
    ctx.moveTo(mx, y+s);    ctx.lineTo(mx, y);     ctx.lineTo(mx+s, y);
    ctx.moveTo(mx+w-s, y);  ctx.lineTo(mx+w, y);   ctx.lineTo(mx+w, y+s);
    ctx.moveTo(mx, y+h-s);  ctx.lineTo(mx, y+h);   ctx.lineTo(mx+s, y+h);
    ctx.moveTo(mx+w-s, y+h);ctx.lineTo(mx+w, y+h); ctx.lineTo(mx+w, y+h-s);
    ctx.restore();
    ctx.stroke();
}

// สลับสถานะการ์ดสถานะ AI ด้านบน (detecting/recognizing/success/unknown)
function setStatusCard(state, icon, text) {
    const card = document.getElementById('statusCard');
    if (card) card.className = 'status-card state-' + state;
    const iconEl = document.getElementById('statusIcon');
    if (iconEl) iconEl.textContent = icon;
    const textEl = document.getElementById('statusText');
    if (textEl) textEl.textContent = text;
}

function showDetectCard(label, confidence) {
    hideUnknownCard();
    const parts = label.split('|||');
    const studentId = parts[1] || '';
    document.getElementById('detectedName').textContent = parts[0]||'—';
    document.getElementById('detectedSub').textContent  = `${parts[1]||'—'}  •  ${parts[2]||'—'}`;
    const confEl = document.getElementById('detectConfidence');
    if (confEl) confEl.textContent = `ความมั่นใจในการจับคู่: ${confidence}%`;
    document.getElementById('detectCard').style.display  = 'block';
    document.getElementById('checkinSuccess').style.display = 'none';
    document.getElementById('checkinBtn').style.display     = 'flex';

    const existing = DataStore.getAttendance().find(r => r.studentId === studentId && r.date === DateHelper.today());
    if (existing) {
        document.getElementById('checkinBtn').style.display     = 'none';
        document.getElementById('checkinSuccess').style.display = 'block';
        document.getElementById('checkinSuccess').className     = 'checkin-duplicate';
        document.getElementById('checkinSuccess').textContent   = `⚠️ นักเรียนคนนี้เช็กชื่อแล้ว (เวลา ${existing.time})`;
        setStatusCard('duplicate', '⚠️', 'เช็กชื่อไปแล้ววันนี้');
    }
}

function hideDetectCard() {
    if (!currentDetectedLabel) return;
    currentDetectedLabel = null;
    const dc = document.getElementById('detectCard');
    if (dc) dc.style.display = 'none';
    const cs = document.getElementById('checkinSuccess');
    if (cs) cs.className = 'checkin-success';
}
function showUnknownCard() {
    const el = document.getElementById('unknownCard');
    if (el) el.style.display = 'block';
    setStatusCard('unknown', '❌', 'ไม่พบข้อมูลในระบบ');
}
function hideUnknownCard() {
    const el = document.getElementById('unknownCard');
    if (el) el.style.display = 'none';
}

function stopScanning() {
    clearInterval(scanInterval); scanInterval = null; isScanning = false; currentDetectedLabel = null; isProcessing = false;
    const canvas = document.getElementById('canvas');
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    document.getElementById('startBtn').disabled = false;
    document.getElementById('stopBtn').disabled  = true;
    document.getElementById('recDot').classList.remove('active');
    document.getElementById('scanOverlay').style.display = 'flex';
    document.getElementById('detectCard').style.display  = 'none';
    hideUnknownCard();
    setStatusCard('detecting', '✅', 'ระบบ AI พร้อมใช้งาน');
}

function confirmCheckIn() {
    if (!currentDetectedLabel) return;
    if (Date.now() - lastCheckinAt < CHECKIN_COOLDOWN_MS) return; // กันกดซ้ำเร็วเกินไป
    const btn = document.getElementById('checkinBtn');
    if (btn) btn.disabled = true;

    const parts     = currentDetectedLabel.split('|||');
    const name      = parts[0]||'—';
    const studentId = parts[1]||'—';
    const year      = parts[2]||'—';
    const now       = DateHelper.now();
    const today     = DateHelper.today();
    const time      = DateHelper.toThaiTime(now);
    const weekNum   = DateHelper.getAcademicWeekNum(now);

    if (DataStore.isAttendedToday(studentId)) {
        showToast(`⚠️ ${name} ลงชื่อแล้ววันนี้`);
        if (btn) btn.disabled = false;
        return;
    }
    if (DateHelper.isAfterEndTime(time)) {
        showToast('⏰ เกินเวลาสิ้นสุดการเช็กชื่อแล้ว');
        if (btn) btn.disabled = false;
        return;
    }

    const record = { name, studentId, year, date:today, time, weekNum, method:'ใบหน้า (AI)', timestamp: now.getTime() };
    DataStore.addAttendance(record);
    attendanceList = DataStore.getAttendance();
    updateStats();
    lastCheckinAt = Date.now();

    document.getElementById('checkinBtn').style.display     = 'none';
    document.getElementById('checkinSuccess').className     = 'checkin-success';
    document.getElementById('checkinSuccess').style.display = 'block';
    document.getElementById('checkinSuccess').textContent   = '✅ บันทึกการเข้าแถวสำเร็จ!';
    showToast(`✅ ${name} ลงชื่อเข้าแถวแล้ว (${time})`);
    if (btn) btn.disabled = false;
}
