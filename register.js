// register.js — ถ่ายทีละมุม, confirm, ตรวจซ้ำ
const ANGLES = [
    { label: 'มุมที่ 1 / 5 — มองตรง',      hint: '↕ มองตรงๆ',        arrow: '↕ มองตรงๆ' },
    { label: 'มุมที่ 2 / 5 — หันซ้ายนิด',   hint: '← หันซ้ายเล็กน้อย', arrow: '← หันซ้าย' },
    { label: 'มุมที่ 3 / 5 — หันขวานิด',    hint: '→ หันขวาเล็กน้อย',  arrow: '→ หันขวา' },
    { label: 'มุมที่ 4 / 5 — ก้มหน่อย',     hint: '↓ ก้มลงเล็กน้อย',   arrow: '↓ ก้มลง' },
    { label: 'มุมที่ 5 / 5 — เงยหน่อย',     hint: '↑ เงยขึ้นเล็กน้อย',  arrow: '↑ เงยขึ้น' },
];

let capturedDescriptors = [];
let capturedThumbURLs   = [];
let currentAngle        = 0;
let isCapturing         = false;

// เรียกตอนโหลดหน้า register
function initRegisterUI() {
    resetCapture();
}

// ── Stepper (UI เท่านั้น — ไม่แตะ logic การตรวจจับ/บันทึกใบหน้าที่ทำงานอยู่แล้ว) ──
// step 1 กรอกข้อมูล → 2 เตรียมกล้อง (ข้อมูลครบแต่ยังไม่เริ่มถ่าย) → 3 กำลังถ่ายภาพ → 4 ครบ 5 มุม รอตรวจสอบ/ยืนยัน → 5 เสร็จสิ้น
function updateStepper() {
    const name = document.getElementById('name')?.value.trim();
    const id   = document.getElementById('studentId')?.value.trim();
    const year = document.getElementById('year')?.value.trim();
    const infoComplete    = !!(name && id && year);
    const captureStarted  = currentAngle > 0;
    const captureComplete = currentAngle >= 5;

    let active = 1;
    if (captureComplete)          active = 4;
    else if (captureStarted)      active = 3;
    else if (infoComplete)        active = 2;

    for (let i = 1; i <= 5; i++) {
        const el = document.getElementById('step' + i);
        if (!el) continue;
        el.classList.remove('active', 'done');
        if (i < active) el.classList.add('done');
        else if (i === active) el.classList.add('active');
    }
}
function setStepperComplete() {
    for (let i = 1; i <= 5; i++) {
        const el = document.getElementById('step' + i);
        if (!el) continue;
        el.classList.remove('active');
        el.classList.add('done');
    }
    document.getElementById('step5')?.classList.add('active');
}

function resetCapture() {
    capturedDescriptors = [];
    capturedThumbURLs   = [];
    currentAngle        = 0;
    isCapturing         = false;
    updateAngleUI();
    for (let i = 0; i < 5; i++) {
        const s = document.getElementById(`slot${i}`);
        if (!s) continue;
        s.classList.remove('filled', 'active-slot');
        s.innerHTML = `<span>${i+1}</span><div class="slot-label">${['ตรง','ซ้าย','ขวา','ก้ม','เงย'][i]}</div>`;
    }
    const btn = document.getElementById('captureBtn');
    if (btn) { btn.disabled = false; btn.textContent = '📷 ถ่ายรูปมุมนี้'; }
    const rb = document.getElementById('registerBtn');
    if (rb) rb.style.display = 'none';
    const rp = document.getElementById('regProgress');
    if (rp) rp.style.display = 'none';
    highlightCurrentSlot();
    updateStepper();
}

function updateAngleUI() {
    const ang = ANGLES[Math.min(currentAngle, 4)];
    const ci  = document.getElementById('captureInstruction');
    const at  = document.getElementById('currentAngleText');
    const ga  = document.getElementById('guideArrowText');
    if (ci) ci.textContent = `กด "ถ่ายรูป" เพื่อเก็บ${ang.label}`;
    if (at) at.textContent = `📍 ${ang.label}`;
    if (ga) ga.textContent = ang.arrow;
}

function highlightCurrentSlot() {
    for (let i = 0; i < 5; i++) {
        const s = document.getElementById(`slot${i}`);
        if (!s) continue;
        if (i === currentAngle && !s.classList.contains('filled')) s.classList.add('active-slot');
        else s.classList.remove('active-slot');
    }
}

async function captureOneFace() {
    if (isCapturing || currentAngle >= 5) return;
    isCapturing = true;
    const btn = document.getElementById('captureBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังสแกน...'; }

    const videoEl = document.getElementById('video2') || document.getElementById('video');
    if (!videoEl) {
        showToast('❌ ไม่พบกล้อง กรุณาเปิดกล้องก่อน');
        if (btn) { btn.disabled = false; btn.textContent = '📷 ถ่ายรูปมุมนี้'; }
        isCapturing = false;
        return;
    }

    try {
        const detection = await faceapi
            .detectSingleFace(videoEl, new faceapi.SsdMobilenetv1Options({ minConfidence: CONFIG.FACE_DETECT_MIN_CONFIDENCE }))
            .withFaceLandmarks()
            .withFaceDescriptor();

        if (detection) {
            const box = detection.detection.box;
            const frameW = videoEl.videoWidth || 640;
            const frameH = videoEl.videoHeight || 480;
            const faceArea = box.width * box.height;
            const frameArea = frameW * frameH;

            // Face size validation — face should be at least 8% of frame
            if (faceArea < frameArea * 0.08) {
                showToast('⚠️ ขยับเข้าใกล้กล้องอีกนิด');
                if (btn) { btn.disabled = false; btn.textContent = '📷 ถ่ายรูปมุมนี้'; }
                isCapturing = false;
                return;
            }

            // Face position validation — face should be roughly centered
            const centerX = box.x + box.width / 2;
            const centerY = box.y + box.height / 2;
            const marginX = frameW * 0.15;
            const marginY = frameH * 0.1;
            if (centerX < marginX || centerX > frameW - marginX || centerY < marginY || centerY > frameH - marginY) {
                showToast('⚠️ กรุณาอยู่ตรงกลางกรอบ');
                if (btn) { btn.disabled = false; btn.textContent = '📷 ถ่ายรูปมุมนี้'; }
                isCapturing = false;
                return;
            }

            capturedDescriptors.push(Array.from(detection.descriptor));
            const thumbURL = cropFaceThumb(detection, videoEl);
            capturedThumbURLs.push(thumbURL);
            markSlotDone(currentAngle, thumbURL);
            currentAngle++;

            if (currentAngle >= 5) {
                const rb = document.getElementById('registerBtn');
                if (rb) rb.style.display = 'flex';
                const ci = document.getElementById('captureInstruction');
                if (ci) { ci.style.color = 'var(--green)'; ci.textContent = '🎉 ครบ 5 มุมแล้ว! กด "ยืนยันบันทึก" ด้านล่าง'; }
                if (btn) { btn.disabled = true; btn.textContent = '✅ ถ่ายครบแล้ว'; }
                document.getElementById('currentAngleText').textContent = '✅ บันทึกครบทุกมุม — พร้อมบันทึก';
            } else {
                updateAngleUI();
                highlightCurrentSlot();
                showToast(`✅ มุมที่ ${currentAngle} บันทึกแล้ว`);
                if (btn) { btn.disabled = false; btn.textContent = '📷 ถ่ายรูปมุมนี้'; }
            }
            updateStepper();
        } else {
            showToast('❌ หาใบหน้าไม่เจอ ลองขยับให้ตรงกรอบแล้วกดใหม่');
            if (btn) { btn.disabled = false; btn.textContent = '📷 ถ่ายรูปมุมนี้'; }
        }
    } catch (err) {
        console.error('captureOneFace error:', err);
        showToast('❌ เกิดข้อผิดพลาดในการสแกน');
        if (btn) { btn.disabled = false; btn.textContent = '📷 ถ่ายรูปมุมนี้'; }
    }
    isCapturing = false;
}

function cropFaceThumb(detection, videoEl) {
    try {
        const box = detection.detection.box;
        const pad = 16;
        const sx  = Math.max(0, box.x - pad);
        const sy  = Math.max(0, box.y - pad);
        const sw  = Math.min(box.width  + pad*2, videoEl.videoWidth  - sx);
        const sh  = Math.min(box.height + pad*2, videoEl.videoHeight - sy);
        const c   = document.createElement('canvas');
        c.width = 70; c.height = 70;
        const ctx = c.getContext('2d');
        // กล้องถูก mirror — วาดกลับ
        ctx.save(); ctx.scale(-1,1); ctx.translate(-70,0);
        ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, 70, 70);
        ctx.restore();
        return c.toDataURL('image/jpeg', 0.8);
    } catch { return ''; }
}

function markSlotDone(idx, thumbURL) {
    const s = document.getElementById(`slot${idx}`);
    if (!s) return;
    s.classList.remove('active-slot');
    s.classList.add('filled');
    s.innerHTML = '';
    if (thumbURL) {
        const img = document.createElement('img');
        img.src = thumbURL;
        s.appendChild(img);
    }
    const lbl = document.createElement('div');
    lbl.className = 'slot-label';
    lbl.textContent = ['ตรง','ซ้าย','ขวา','ก้ม','เงย'][idx];
    s.appendChild(lbl);
}

// เปิด Confirm Modal
function openConfirmRegister() {
    const nameInput = document.getElementById('name');
    const idInput = document.getElementById('studentId');
    const yearInput = document.getElementById('year');
    
    let name = nameInput.value.trim();
    let id = idInput.value.trim();
    let year = yearInput.value.trim();
    
    if (!name) { showToast('⚠️ กรุณากรอกชื่อ-นามสกุล'); return; }
    if (!id)   { showToast('⚠️ กรุณากรอกรหัสประจำตัว'); return; }
    if (!year) { showToast('⚠️ กรุณากรอกชั้นปี'); return; }
    if (capturedDescriptors.length < 5) { showToast('⚠️ กรุณาถ่ายรูปให้ครบ 5 มุม'); return; }

    // ตรวจชื่อซ้ำ
    const dupName = DataStore.findStudentByName(name);
    if (dupName && dupName.id !== id) {
        if (!confirm(`⚠️ ชื่อ "${name}" มีในระบบแล้ว (รหัส ${dupName.id}) ยืนยันเพิ่มอีกคนใช่มั้ย?`)) return;
    }

    // ตรวจรหัสซ้ำ
    const dupId = DataStore.findStudentById(id);
    if (dupId) { showToast(`❌ รหัส "${id}" มีในระบบแล้ว (${dupId.name})`); return; }

    // ตรวจใบหน้าซ้ำ (optional — check if face descriptor is too similar to existing)
    if (registeredFaces.length > 0 && capturedDescriptors.length > 0) {
        const newDesc = new Float32Array(capturedDescriptors[0]);
        for (const student of DataStore.getStudents()) {
            if (!student.descriptors || student.descriptors.length === 0) continue;
            for (const desc of student.descriptors) {
                const dist = faceapi.euclideanDistance(newDesc, new Float32Array(desc));
                if (dist < CONFIG.FACE_MATCH_THRESHOLD * 0.8) {
                    if (!confirm(`⚠️ ใบหน้านี้อาจใกล้เคียงกับ "${student.name}" (รหัส ${student.id}) ในระบบแล้ว ยืนยันเพิ่มใช่หรือไม่?`)) return;
                    break;
                }
            }
        }
    }

    // แสดง confirm (use escapeHtml for display only)
    const info = document.getElementById('confirmInfo');
    const thumbs = document.getElementById('confirmThumbs');
    if (info) info.innerHTML = `
        <div>👤 <b>ชื่อ:</b> ${escapeHtml(name)}</div>
        <div>🪪 <b>รหัส:</b> ${escapeHtml(id)}</div>
        <div>🎓 <b>ชั้นปี:</b> ${escapeHtml(year)}</div>
        <div>📸 <b>มุมที่บันทึก:</b> ${capturedDescriptors.length} มุม</div>`;
    if (thumbs) thumbs.innerHTML = capturedThumbURLs.map(u => `<img src="${u}" alt="thumb">`).join('');
    openModal('confirmRegisterModal');
}

// บันทึกจริง
function doSaveRegister() {
    const nameInput = document.getElementById('name');
    const idInput = document.getElementById('studentId');
    const yearInput = document.getElementById('year');
    
    const name = nameInput.value.trim();
    const id = idInput.value.trim();
    const year = yearInput.value.trim();
    
    const btn = document.getElementById('registerBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังบันทึก...'; }

    try {
        const student = { name, id, year, descriptors: capturedDescriptors };
        DataStore.addStudent(student);
        registeredFaces = DataStore.getStudents();
        updateStats();

        closeModal('confirmRegisterModal');
        showToast(`✅ ลงทะเบียน "${name}" สำเร็จ! (${capturedDescriptors.length} มุม)`);
        setStepperComplete();

        // reset ฟอร์ม
        setTimeout(() => {
            nameInput.value = '';
            idInput.value = '';
            yearInput.value = '';
            resetCapture();
        }, 900);
    } catch (err) {
        console.error('doSaveRegister error:', err);
        showToast('❌ ไม่สามารถบันทึกข้อมูลได้');
        if (btn) { btn.disabled = false; btn.textContent = '✅ ยืนยันบันทึกข้อมูล'; }
    }
}
