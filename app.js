// app.js — Core, UI, Admin, Export
let registeredFaces = [];
let attendanceList  = [];
let leaveList       = [];

// ── Configuration (Global for cross-file access) ──
var CONFIG = {
    FACE_MATCH_THRESHOLD: 0.48,
    FACE_DETECT_MIN_CONFIDENCE: 0.5,
    ATTENDANCE_START_TIME: '07:30',
    LATE_TIME: '08:00',
    ATTENDANCE_END_TIME: '08:30',
    DETECTION_INTERVAL_MS: 250,
    MAX_DETECTION_FPS: 4,
    ADMIN_CREDENTIALS: { user: 'วิจิตรา', pass: 'วิจิตรา' },
    // ⚠️ WARNING: Admin credentials are hardcoded in frontend code.
    // This is NOT secure for production. Replace with backend authentication.
    // Current implementation is for DEMO/TESTING only.
    STORAGE_KEYS: {
        students: 'fg_students',
        attendance: 'fg_attendance',
        leaves: 'fg_leaves'
    }
};

// นำค่าที่อาจารย์เคยตั้งไว้ (หน้าตั้งค่า) มาทับค่าเริ่มต้นใน CONFIG ทันทีตอนโหลดสคริปต์
// ต้องทำแบบ synchronous ตรงนี้ (ไม่ใช่รอ async model-load) เพราะ scan.js อ่านค่าพวกนี้จาก CONFIG โดยตรงตอนสแกนจริง
(function applySavedSettingsToConfig() {
    try {
        const raw = localStorage.getItem('fg_settings');
        if (!raw) return;
        const s = JSON.parse(raw);
        if (s.attendanceStartTime) CONFIG.ATTENDANCE_START_TIME = s.attendanceStartTime;
        if (s.lateTime)            CONFIG.LATE_TIME = s.lateTime;
        if (s.attendanceEndTime)   CONFIG.ATTENDANCE_END_TIME = s.attendanceEndTime;
        if (s.faceMatchThreshold)  CONFIG.FACE_MATCH_THRESHOLD = parseFloat(s.faceMatchThreshold);
        if (s.faceMinConfidence)   CONFIG.FACE_DETECT_MIN_CONFIDENCE = parseFloat(s.faceMinConfidence);
    } catch (e) { console.error('applySavedSettingsToConfig error:', e); }
})();

// ── Date Helpers (Thailand / Asia/Bangkok) ──
var DateHelper = {
    today() {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    },
    now() {
        return new Date();
    },
    toThaiTime(date) {
        if (!date) date = new Date();
        return date.toLocaleTimeString('th-TH', { hour12: false, timeZone: 'Asia/Bangkok' });
    },
    toThaiDate(date) {
        if (!date) date = new Date();
        return date.toLocaleDateString('th-TH', {
            year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Bangkok'
        });
    },
    toThaiDateLong(date) {
        if (!date) date = new Date();
        return date.toLocaleDateString('th-TH', {
            year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', timeZone: 'Asia/Bangkok'
        });
    },
    isLate(timeStr) {
        if (!timeStr) return false;
        const p = timeStr.split(':');
        if (p.length < 2) return false;
        const h = parseInt(p[0], 10);
        const m = parseInt(p[1], 10);
        const [lh, lm] = CONFIG.LATE_TIME.split(':').map(Number);
        return h > lh || (h === lh && m > lm);
    },
    isAfterEndTime(timeStr) {
        if (!timeStr) return false;
        const p = timeStr.split(':');
        if (p.length < 2) return false;
        const h = parseInt(p[0], 10);
        const m = parseInt(p[1], 10);
        const [eh, em] = CONFIG.ATTENDANCE_END_TIME.split(':').map(Number);
        return h > eh || (h === eh && m >= em);
    },
    normalizeThaiDate(dateStr) {
        if (!dateStr) return dateStr;
        // Convert Buddhist Era year to CE if needed
        const beToCe = (y) => y > 2500 ? y - 543 : y;
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            const year = parseInt(dateStr.substring(0, 4), 10);
            if (year > 2500) {
                const ceYear = beToCe(year);
                return dateStr.substring(0, 4).replace(String(year), String(ceYear));
            }
            return dateStr;
        }
        const dmy = dateStr.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
        if (dmy) {
            const a = parseInt(dmy[1]), b = parseInt(dmy[2]), y = parseInt(dmy[3], 10);
            const ceY = beToCe(y);
            if (a > 12) return `${ceY}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
            if (b > 12) return `${ceY}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
            return `${ceY}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
        }
        return dateStr;
    },
    getAcademicWeekNum(date) {
        if (!date) date = new Date();
        const start = new Date(date.getFullYear(), 4, 1);
        const diff = date - start;
        const weekNum = Math.max(1, Math.min(18, Math.ceil(diff / (7 * 24 * 60 * 60 * 1000))));
        return weekNum;
    }
};

// ── Data Layer Abstraction ──
var DataStore = {
    _storageErrors: [],
    _get(key) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                console.warn('DataStore: expected array for', key, 'got', typeof parsed);
                return [];
            }
            return parsed;
        } catch (e) {
            console.error('DataStore read error:', key, e);
            DataStore._storageErrors.push({ key, error: e.message });
            return null;
        }
    },
    _set(key, value) {
        try {
            if (!Array.isArray(value)) {
                throw new Error('DataStore: value must be array for ' + key);
            }
            const json = JSON.stringify(value);
            if (json.length > 5 * 1024 * 1024) {
                throw new Error('DataStore: data too large for ' + key);
            }
            localStorage.setItem(key, json);
            return true;
        } catch (e) {
            if (e.name === 'QuotaExceededError' || e.code === 22) {
                showToast('❌ พื้นที่จัดเก็บข้อมูลเต็ม กรุณาลบข้อมูลเก่าบางส่วน');
            } else {
                console.error('DataStore write error:', key, e);
                showToast('❌ ไม่สามารถบันทึกข้อมูลได้: ' + e.message);
            }
            return false;
        }
    },
    getStorageErrors() {
        return DataStore._storageErrors;
    },
    clearStorageErrors() {
        DataStore._storageErrors = [];
    },
    validateStudent(student) {
        if (!student || typeof student !== 'object') return false;
        if (!student.id || typeof student.id !== 'string' || student.id.trim().length === 0) return false;
        if (!student.name || typeof student.name !== 'string' || student.name.trim().length === 0) return false;
        if (!Array.isArray(student.descriptors)) return false;
        if (student.descriptors.length === 0) return false;
        for (const desc of student.descriptors) {
            if (!Array.isArray(desc) || desc.length !== 128) return false;
        }
        return true;
    },
    validateAttendance(record) {
        if (!record || typeof record !== 'object') return false;
        if (!record.studentId || !record.date || !record.time) return false;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(record.date)) return false;
        if (!/^\d{2}:\d{2}$/.test(record.time)) return false;
        return true;
    },
    validateLeave(leave) {
        if (!leave || typeof leave !== 'object') return false;
        if (!leave.studentId || !leave.date || !leave.type || !leave.reason) return false;
        return true;
    },
    getStudents() {
        const raw = DataStore._get(CONFIG.STORAGE_KEYS.students);
        return raw === null ? [] : raw.filter(s => DataStore.validateStudent(s));
    },
    getAttendance() {
        const raw = DataStore._get(CONFIG.STORAGE_KEYS.attendance);
        return raw === null ? [] : raw.filter(r => DataStore.validateAttendance(r));
    },
    getLeaves() {
        const raw = DataStore._get(CONFIG.STORAGE_KEYS.leaves);
        return raw === null ? [] : raw.filter(r => DataStore.validateLeave(r));
    },
    saveStudents(list) {
        const valid = list.filter(s => DataStore.validateStudent(s));
        return DataStore._set(CONFIG.STORAGE_KEYS.students, valid);
    },
    saveAttendance(list) {
        const valid = list.filter(r => DataStore.validateAttendance(r));
        return DataStore._set(CONFIG.STORAGE_KEYS.attendance, valid);
    },
    saveLeaves(list) {
        const valid = list.filter(r => DataStore.validateLeave(r));
        return DataStore._set(CONFIG.STORAGE_KEYS.leaves, valid);
    },
    getTodayAttendance() {
        const today = DateHelper.today();
        return DataStore.getAttendance().filter(r => r.date === today);
    },
    isAttendedToday(studentId) {
        const today = DateHelper.today();
        return DataStore.getAttendance().some(r => r.studentId === studentId && r.date === today);
    },
    getTodayLeaves() {
        const today = DateHelper.today();
        return DataStore.getLeaves().filter(r => r.date === today);
    },
    addStudent(student) {
        const list = DataStore.getStudents();
        list.push(student);
        return DataStore.saveStudents(list);
    },
    removeStudent(index) {
        const list = DataStore.getStudents();
        if (index < 0 || index >= list.length) return false;
        list.splice(index, 1);
        return DataStore.saveStudents(list);
    },
    findStudentById(id) {
        return DataStore.getStudents().find(s => s.id === id);
    },
    findStudentByName(name) {
        return DataStore.getStudents().find(s => s.name === name);
    },
    addAttendance(record) {
        const list = DataStore.getAttendance();
        list.push(record);
        return DataStore.saveAttendance(list);
    },
    addLeave(leave) {
        const list = DataStore.getLeaves();
        list.push(leave);
        return DataStore.saveLeaves(list);
    },
    removeLeave(index) {
        const list = DataStore.getLeaves();
        if (index < 0 || index >= list.length) return false;
        list.splice(index, 1);
        return DataStore.saveLeaves(list);
    },
    setLeaveStatus(index, status) {
        const list = DataStore.getLeaves();
        if (index < 0 || index >= list.length) return false;
        list[index].status = status;
        return DataStore.saveLeaves(list);
    },
    // ── Settings (plain object, not array — separate from the _get/_set array helpers above) ──
    getSettings() {
        try {
            const raw = localStorage.getItem('fg_settings');
            return raw ? JSON.parse(raw) : {};
        } catch (e) { console.error('DataStore settings read error:', e); return {}; }
    },
    saveSettings(obj) {
        try {
            localStorage.setItem('fg_settings', JSON.stringify(obj));
            return true;
        } catch (e) {
            console.error('DataStore settings write error:', e);
            showToast('❌ ไม่สามารถบันทึกการตั้งค่าได้: ' + e.message);
            return false;
        }
    }
};

// เก็บสถานะว่าล็อกอินอาจารย์แล้วหรือยังในเซสชันนี้ (ใช้เปิด/ปิดปุ่มอนุมัติใบลา ฯลฯ)
let isAdminSession = false;

// ── LocalStorage ──
function loadLocalData() {
    let loaded = { students: 0, attendance: 0, leaves: 0 };
    let errors = [];
    
    try {
        const students = DataStore.getStudents();
        registeredFaces = students;
        loaded.students = students.length;
    } catch (e) {
        errors.push('ข้อมูลนักศึกษาสูญหาย');
        registeredFaces = [];
    }
    
    try {
        const attendance = DataStore.getAttendance();
        attendanceList = attendance;
        loaded.attendance = attendance.length;
    } catch (e) {
        errors.push('ข้อมูลเข้าแถวสูญหาย');
        attendanceList = [];
    }
    
    try {
        const leaves = DataStore.getLeaves();
        leaveList = leaves;
        loaded.leaves = leaves.length;
    } catch (e) {
        errors.push('ข้อมูลการลาสูญหาย');
        leaveList = [];
    }
    
    if (errors.length > 0) {
        showToast('⚠️ ' + errors.join(', ') + ' — ระบบทำงานกับข้อมูลที่เหลืออยู่');
    }
    
    // Migrate old date formats
    let migrated = false;
    attendanceList.forEach(r => {
        const norm = DateHelper.normalizeThaiDate(r.date);
        if (norm !== r.date) { r.date = norm; migrated = true; }
        if (r.weekNum === undefined || r.weekNum === null) {
            const d = r.timestamp ? new Date(r.timestamp) : new Date(r.date);
            if (!isNaN(d.getTime())) {
                r.weekNum = DateHelper.getAcademicWeekNum(d);
                migrated = true;
            }
        }
    });
    leaveList.forEach(r => {
        const norm = DateHelper.normalizeThaiDate(r.date);
        if (norm !== r.date) { r.date = norm; migrated = true; }
    });
    if (migrated) {
        DataStore.saveAttendance(attendanceList);
        DataStore.saveLeaves(leaveList);
    }
    
    updateStats();
}
function saveStudents()   { DataStore.saveStudents(registeredFaces); }
function saveAttendance() { DataStore.saveAttendance(attendanceList); }
function saveLeaves()     { DataStore.saveLeaves(leaveList); }

// ── โหลด AI ──
const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
Promise.all([
    faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
]).then(() => {
    loadLocalData();
    loadUserSettings();
    setAIStatus('ready', '✅ ระบบ AI พร้อมใช้งาน');
    showSection('dashboard'); // แดชบอร์ดเป็นหน้าเริ่มต้น — ไม่เปิดกล้องจนกว่าจะเข้าหน้าสแกน/ลงทะเบียน (ประหยัดทรัพยากร)
}).catch(err => {
    console.error('AI load error:', err);
    let msg = '❌ ไม่สามารถโหลดระบบ AI ได้';
    if (err.message && err.message.includes('fetch')) {
        msg = '❌ ไม่สามารถโหลดโมเดล AI ได้ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต';
    }
    setAIStatus('error', msg);
});

function setAIStatus(state, text) {
    const dot = document.getElementById('aiDot');
    const txt = document.getElementById('aiStatusText');
    const banner = document.getElementById('aiErrorBanner');
    if (dot) dot.className = 'status-dot ' + state;
    if (txt) txt.textContent = text.replace(/^[✅❌🤖]\s*/, '');
    // อัปเดตการ์ดสถานะในหน้าสแกนด้วย เฉพาะตอนยังไม่ได้กำลังสแกนอยู่ (กันชนกับสถานะ detecting/recognizing แบบเรียลไทม์ใน scan.js)
    if (typeof isScanning === 'undefined' || !isScanning) {
        if (typeof setStatusCard === 'function') {
            setStatusCard(state === 'error' ? 'unknown' : 'detecting', state === 'ready' ? '✅' : state === 'error' ? '❌' : '🤖', text);
        }
    }
    if (banner) {
        if (state === 'error') {
            banner.style.display = 'flex';
            banner.querySelector('span').textContent = text;
        } else {
            banner.style.display = 'none';
        }
    }
}

// ── กล้อง ──
let currentStream = null;
let cameraActive = false;
let cameraRetryCount = 0;

async function startCamera() {
    if (cameraActive && currentStream) return;
    cameraRetryCount = Math.min(cameraRetryCount + 1, 3);
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
        });
        currentStream = stream;
        cameraActive = true;
        cameraRetryCount = 0;
        const v = document.getElementById('video');
        const v2 = document.getElementById('video2');
        if (v)  { v.srcObject  = stream; v.style.transform  = 'scaleX(-1)'; }
        if (v2) { v2.srcObject = stream; v2.style.transform = 'scaleX(-1)'; }
        await loadCameraList();
        setAIStatus('ready', '✅ ระบบ AI พร้อมใช้งาน');
    } catch (err) {
        console.error('Camera error:', err);
        cameraActive = false;
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            setAIStatus('error', '❌ ไม่ได้รับสิทธิ์เข้าถึงกล้อง กรุณาเปิดสิทธิ์');
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            setAIStatus('error', '❌ ไม่พบกล้องในอุปกรณ์นี้');
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
            setAIStatus('error', '❌ กล้องไม่พร้อมใช้งาน หรือใช้งานโดยโปรแกรมอื่น');
        } else {
            setAIStatus('error', '❌ ไม่สามารถเปิดกล้องได้');
        }
    }
}
function stopCamera() {
    if (currentStream) {
        currentStream.getTracks().forEach(t => t.stop());
        currentStream = null;
        cameraActive = false;
    }
    const v = document.getElementById('video');
    const v2 = document.getElementById('video2');
    if (v)  v.srcObject  = null;
    if (v2) v2.srcObject = null;
}
async function loadCameraList() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter(d => d.kind === 'videoinput');
        const sel = document.getElementById('cameraSelect');
        if (!sel) return;
        sel.innerHTML = '';
        cams.forEach((d, i) => {
            const o = document.createElement('option');
            o.value = d.deviceId;
            o.text  = d.label || `กล้อง ${i+1}`;
            sel.appendChild(o);
        });
    } catch(e) { console.error('loadCameraList error:', e); }
}
async function switchCamera() {
    const sel = document.getElementById('cameraSelect');
    if (!sel) return;
    const id = sel.value;
    stopCamera();
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: id } } });
        currentStream = stream;
        cameraActive = true;
        const v  = document.getElementById('video');
        const v2 = document.getElementById('video2');
        if (v)  { v.srcObject  = stream; v.style.transform  = 'scaleX(-1)'; }
        if (v2) { v2.srcObject = stream; v2.style.transform = 'scaleX(-1)'; }
        setAIStatus('ready', '✅ เปลี่ยนกล้องแล้ว');
    } catch (err) {
        console.error('switchCamera error:', err);
        setAIStatus('error', '❌ ไม่สามารถเปลี่ยนกล้องได้');
        await startCamera();
    }
}

// ── Navigation ──
function showSection(name) {
    document.querySelectorAll('.section-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    const section = document.getElementById('section-' + name);
    if (section) section.classList.add('active');
    const navItem = document.querySelector(`[data-section="${name}"]`);
    if (navItem) navItem.classList.add('active');
    const titles = { dashboard:'แดชบอร์ด', scan:'สแกนใบหน้า', register:'ลงทะเบียนใบหน้า', database:'นักศึกษา', attendance:'เข้าแถว', leave:'แจ้งลา', reports:'รายงาน', settings:'ตั้งค่า' };
    document.getElementById('topbarTitle').textContent = titles[name] || name;
    if (name === 'dashboard')  renderDashboard();
    if (name === 'database')   { populateClassFilters(); renderDBTable(); }
    if (name === 'attendance') { populateClassFilters(); renderAttendanceTable(); }
    if (name === 'leave')      renderLeaveTable();
    if (name === 'reports')    { populateClassFilters(); renderReports(); }
    if (name === 'settings')   loadUserSettings();
    if (name === 'register')   { if (typeof initRegisterUI === 'function') initRegisterUI(); }
    if (window.innerWidth < 768) {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.remove('open');
        const scrim = document.getElementById('sidebarScrim');
        if (scrim) scrim.classList.remove('open');
    }
    // Camera lifecycle: only run the camera on sections that actually use it —
    // stops tracks/frees the device everywhere else to avoid unnecessary battery/CPU use.
    if (name === 'scan' || name === 'register') {
        if (!cameraActive) startCamera();
    } else {
        if (isScanning) stopScanning();
        stopCamera();
    }
}
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const hamburger = document.querySelector('.hamburger');
    const scrim = document.getElementById('sidebarScrim');
    const isOpen = sidebar.classList.toggle('open');
    if (scrim) scrim.classList.toggle('open', isOpen);
    if (hamburger) hamburger.setAttribute('aria-expanded', isOpen);
}

// ── Modal ──
function openModal(id) {
    const m = document.getElementById(id);
    if (m) {
        m.classList.add('open');
        // set today as default leave date
        if (id === 'loginModal') {
            const errEl = document.getElementById('loginError');
            if (errEl) errEl.style.display = 'none';
        }
    }
}
function closeModal(id) { const m = document.getElementById(id); if (m) m.classList.remove('open'); }
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.modal-overlay').forEach(o => {
        o.addEventListener('click', function(e) { if (e.target === this) this.classList.remove('open'); });
    });
    // set default leave date / attendance date filter = today
    const ld = document.getElementById('leaveDate');
    if (ld) ld.value = DateHelper.today();
    const ad = document.getElementById('attendanceDate');
    if (ad) ad.value = DateHelper.today();
    // Handle page visibility — stop camera when tab is hidden
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && isScanning) {
            stopScanning();
        }
    });
});

// ── Security Helpers ──
function escapeHtml(str) {
    if (str == null) return '';
    const s = String(str);
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function sanitizeHtml(html) {
    if (html == null) return '';
    const s = String(html);
    // Only allow specific safe tags used by the system
    const allowed = ['b', 'i', 'u', 'br', 'span'];
    const tagRegex = /<\/?([a-z][a-z0-9]*)[^>]*>/gi;
    return s.replace(tagRegex, (match, tag) => {
        const lower = tag.toLowerCase();
        if (allowed.includes(lower)) {
            return lower === 'span' ? match : match.replace(/\s+[^>]*/g, '');
        }
        return '';
    });
}

// ── Toast ──
function showToast(msg, ms = 3000) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), ms);
}

// ── Clock ──
function updateClock() {
    const now = new Date();
    const cl = document.getElementById('liveClock');
    const dt = document.getElementById('liveDate');
    if (cl) cl.textContent = now.toLocaleTimeString('th-TH', { hour12:false });
    if (dt) dt.textContent = now.toLocaleDateString('th-TH', { weekday:'short', year:'numeric', month:'short', day:'numeric' });
}
setInterval(updateClock, 1000);
updateClock();

// ── Stats ──
function updateStats() {
    const today = DateHelper.today();
    const todayList = DataStore.getTodayAttendance();
    const todayCount = todayList.length;
    const total = DataStore.getStudents().length;
    const s1 = document.getElementById('statTotal');
    const s2 = document.getElementById('statRegistered');
    const s3 = document.getElementById('statPercent');
    if (s1) s1.textContent = todayCount;
    if (s2) s2.textContent = total;
    if (s3) s3.textContent = total ? Math.round(todayCount / total * 100) + '%' : '0%';
}

// ── DB Table (Students) ──
function renderDBTable() {
    const tbody  = document.getElementById('dbBody');
    const empty  = document.getElementById('dbEmpty');
    const table  = document.getElementById('dbTable');
    const cardsWrap = document.getElementById('dbCardsMobile');
    if (!tbody) return;
    const q = (document.getElementById('searchDB')?.value || '').toLowerCase();
    const classF  = document.getElementById('classFilterDB')?.value || 'all';
    const statusF = document.getElementById('statusFilterDB')?.value || 'all';
    const today = DateHelper.today();

    let list = registeredFaces.filter(s => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q));
    if (classF !== 'all') list = list.filter(s => (s.year||'—') === classF);
    if (statusF !== 'all') {
        list = list.filter(s => {
            const presentToday = attendanceList.some(r => r.studentId === s.id && r.date === today);
            return statusF === 'present' ? presentToday : !presentToday;
        });
    }

    if (list.length === 0) {
        tbody.innerHTML = '';
        if (cardsWrap) cardsWrap.innerHTML = '';
        if (empty) empty.style.display = 'block';
        if (table) table.style.display = 'none';
        return;
    }
    if (empty) empty.style.display = 'none';
    if (table) table.style.display = '';

    tbody.innerHTML = list.map((s, i) => {
        const oi = registeredFaces.indexOf(s);
        const cnt = s.descriptors ? s.descriptors.length : 0;
        const presentToday = attendanceList.some(r => r.studentId === s.id && r.date === today);
        const initial = escapeHtml((s.name||'?').trim().charAt(0));
        return `<tr onclick="openStudentDetail(${oi})" style="cursor:pointer;">
            <td><div class="student-row-photo">${initial}</div></td>
            <td style="font-family:var(--font-mono)">${escapeHtml(s.id)}</td>
            <td style="font-weight:600">${escapeHtml(s.name)}</td>
            <td>${escapeHtml(s.year||'—')}</td>
            <td><span class="badge badge-green">${cnt} มุม</span></td>
            <td><span class="badge ${presentToday?'badge-green':'badge-red'}">${presentToday?'✓ มาแล้ว':'ยังไม่มา'}</span></td>
            <td onclick="event.stopPropagation()"><button class="btn-del" onclick="deleteStudent(${oi})">🗑️ ลบ</button></td>
        </tr>`;
    }).join('');

    if (cardsWrap) {
        cardsWrap.innerHTML = list.map(s => {
            const oi = registeredFaces.indexOf(s);
            const cnt = s.descriptors ? s.descriptors.length : 0;
            const presentToday = attendanceList.some(r => r.studentId === s.id && r.date === today);
            return `<div class="student-card-mobile" onclick="openStudentDetail(${oi})">
                <div class="student-card-row"><b>${escapeHtml(s.name)}</b><span class="badge ${presentToday?'badge-green':'badge-red'}">${presentToday?'มาแล้ว':'ยังไม่มา'}</span></div>
                <div class="student-card-row"><span class="label">รหัส</span><span style="font-family:var(--font-mono)">${escapeHtml(s.id)}</span></div>
                <div class="student-card-row"><span class="label">ชั้นปี</span><span>${escapeHtml(s.year||'—')}</span></div>
                <div class="student-card-row"><span class="label">ใบหน้าที่บันทึก</span><span>${cnt} มุม</span></div>
            </div>`;
        }).join('');
    }
}
function filterDB() { renderDBTable(); }
function populateClassFilters() {
    const classes = getClassList();
    const opts = '<option value="all">ทุกชั้นปี</option>' + classes.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    ['classFilterDB', 'classFilterAttendance', 'reportClassFilter'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const cur = el.value;
        el.innerHTML = opts;
        if (classes.includes(cur) || cur === 'all') el.value = cur;
    });
    const studentSel = document.getElementById('reportStudentFilter');
    if (studentSel) {
        const cur = studentSel.value;
        studentSel.innerHTML = '<option value="all">นักศึกษาทั้งหมด</option>' +
            registeredFaces.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} (${escapeHtml(s.id)})</option>`).join('');
        studentSel.value = cur || 'all';
    }
}
function getClassList() {
    const set = new Set(registeredFaces.map(s => s.year || '—'));
    return Array.from(set).sort();
}
function deleteStudent(i) {
    if (!confirm(`⚠️ ลบ "${registeredFaces[i].name}" ออกจากระบบ?\n\nรหัส: ${registeredFaces[i].id}\n\nการลบจะไม่สามารถกู้คืนได้!`)) return;
    if (!confirm('⚠️ ยืนยันอีกครั้ง?\n\nข้อมูลใบหน้าของนักศึกษาคนนี้จะหายไปถาวร!')) return;
    DataStore.removeStudent(i);
    registeredFaces = DataStore.getStudents();
    renderDBTable(); updateStats();
    showToast('🗑️ ลบข้อมูลแล้ว');
}

// ── Student Detail Modal ──
let currentDetailIndex = null;
function openStudentDetail(i) {
    const s = registeredFaces[i];
    if (!s) return;
    currentDetailIndex = i;
    document.getElementById('sdAvatar').textContent = (s.name||'?').trim().charAt(0);
    document.getElementById('sdName').textContent = s.name;
    document.getElementById('sdSub').textContent = `${s.id} • ${s.year||'—'} • ${s.descriptors?.length||0} มุมที่บันทึก`;
    document.getElementById('sdNameInput').value = s.name;
    document.getElementById('sdYearInput').value = s.year || '';
    const history = attendanceList.filter(r => r.studentId === s.id).slice().reverse().slice(0, 10);
    const hist = document.getElementById('sdHistory');
    hist.innerHTML = history.length === 0
        ? '<p style="color:var(--text-muted);font-size:0.85rem;">ยังไม่มีประวัติการเข้าแถว</p>'
        : history.map(r => `<div class="mini-history-row"><span>${escapeHtml(r.date)} • ${escapeHtml(r.time)}</span><span class="badge ${DateHelper.isLate(r.time)?'badge-yellow':'badge-green'}">${DateHelper.isLate(r.time)?'มาสาย':'ตรงเวลา'}</span></div>`).join('');
    openModal('studentDetailModal');
}
function saveStudentEdit() {
    if (currentDetailIndex === null) return;
    const name = document.getElementById('sdNameInput').value.trim();
    const year = document.getElementById('sdYearInput').value.trim();
    if (!name) { showToast('⚠️ กรุณากรอกชื่อ-นามสกุล'); return; }
    registeredFaces[currentDetailIndex].name = name;
    registeredFaces[currentDetailIndex].year = year;
    saveStudents();
    renderDBTable(); updateStats();
    showToast('💾 บันทึกการแก้ไขแล้ว');
    closeModal('studentDetailModal');
}
function deleteStudentFromDetail() {
    if (currentDetailIndex === null) return;
    const i = currentDetailIndex;
    closeModal('studentDetailModal');
    deleteStudent(i);
}

// ── Attendance Table ──
// สถานะที่แสดงมี 4 แบบ: present/late (จากบันทึกเช็กชื่อจริง), leave (จากใบลาที่อนุมัติแล้ว),
// absent (คำนวณเฉพาะตอนเลือกวันที่เจาะจง = นักศึกษาที่ไม่มีบันทึกเช็กชื่อและไม่มีใบลาอนุมัติในวันนั้น)
function renderAttendanceTable() {
    const tbody = document.getElementById('attendanceBody');
    const empty = document.getElementById('attendanceEmpty');
    const table = document.getElementById('attendanceTable');
    if (!tbody) return;

    const q       = (document.getElementById('searchAttendance')?.value || '').toLowerCase();
    const dateVal = document.getElementById('attendanceDate')?.value || '';
    const classF  = document.getElementById('classFilterAttendance')?.value || 'all';
    const statusF = document.getElementById('statusFilterAttendance')?.value || 'all';

    let rows = [];

    if (statusF === 'leave') {
        let leaves = leaveList.filter(r => r.status === 'approved');
        if (dateVal) leaves = leaves.filter(r => r.date === dateVal);
        rows = leaves.map(r => ({ date:r.date, time:'—', studentId:r.studentId, name:r.name, year:r.year, method:'ลาอนุมัติ', kind:'leave' }));
    } else if (statusF === 'absent') {
        if (!dateVal) {
            tbody.innerHTML = '';
            if (empty) { empty.style.display = 'block'; const p = empty.querySelector('p'); if (p) p.textContent = 'เลือกวันที่เพื่อดูรายชื่อที่ขาด'; }
            if (table) table.style.display = 'none';
            return;
        }
        const presentIds = new Set(attendanceList.filter(r => r.date === dateVal).map(r => r.studentId));
        const leaveIds   = new Set(leaveList.filter(r => r.date === dateVal && r.status === 'approved').map(r => r.studentId));
        rows = registeredFaces.filter(s => !presentIds.has(s.id) && !leaveIds.has(s.id))
            .map(s => ({ date:dateVal, time:'—', studentId:s.id, name:s.name, year:s.year, method:'—', kind:'absent' }));
    } else {
        rows = attendanceList
            .filter(r => !dateVal || r.date === dateVal)
            .map(r => ({ date:r.date, time:r.time, studentId:r.studentId, name:r.name, year:r.year, method:r.method||'ใบหน้า (AI)', kind: DateHelper.isLate(r.time) ? 'late' : 'present' }));
        if (statusF === 'present') rows = rows.filter(r => r.kind === 'present');
        if (statusF === 'late')    rows = rows.filter(r => r.kind === 'late');
    }

    if (classF !== 'all') rows = rows.filter(r => (r.year||'—') === classF);
    if (q) rows = rows.filter(r => r.name.toLowerCase().includes(q) || (r.studentId||'').toLowerCase().includes(q));

    if (rows.length === 0) {
        tbody.innerHTML = '';
        if (empty) { empty.style.display = 'block'; const p = empty.querySelector('p'); if (p) p.textContent = 'ยังไม่มีรายชื่อ'; }
        if (table) table.style.display = 'none';
        return;
    }
    if (empty) empty.style.display = 'none';
    if (table) table.style.display = '';

    const kindBadge = { present:['badge-green','✓ ตรงเวลา'], late:['badge-yellow','⏰ มาสาย'], leave:['badge-blue','📝 ลา'], absent:['badge-red','✕ ขาด'] };
    tbody.innerHTML = rows.slice().reverse().map((r, i) => {
        const [cls, lbl] = kindBadge[r.kind];
        return `<tr>
            <td style="color:var(--text-muted);font-family:var(--font-mono)">${i+1}</td>
            <td style="font-family:var(--font-mono)">${escapeHtml(r.time)}</td>
            <td style="font-family:var(--font-mono)">${escapeHtml(r.studentId||'—')}</td>
            <td style="font-weight:600">${escapeHtml(r.name)}</td>
            <td>${escapeHtml(r.year||'—')}</td>
            <td style="font-size:0.78rem;color:var(--text-muted)">${escapeHtml(r.method)}</td>
            <td><span class="badge ${cls}">${lbl}</span></td>
        </tr>`;
    }).join('');
}
function filterAttendance() { renderAttendanceTable(); }
function isLate(t) {
    return DateHelper.isLate(t);
}
function clearAttendance() {
    const today = DateHelper.today();
    if (!confirm(`ล้างรายชื่อวันนี้ (${DateHelper.toThaiDate()})?\n\nข้อมูลทั้งหมดของวันนี้จะหายไป และไม่สามารถกู้คืนได้!`)) return;
    if (!confirm('⚠️ ยืนยันอีกครั้ง?\n\nข้อมูลจะหายไปถาวร!')) return;
    attendanceList = attendanceList.filter(r => r.date !== today);
    saveAttendance(); renderAttendanceTable(); updateStats();
    showToast('🗑️ ล้างรายชื่อวันนี้แล้ว');
}
function clearAllData() {
    if (!confirm('⚠️ ล้างข้อมูลทั้งหมด?\n\nจะลบ:\n- รายชื่อเข้าแถวทั้งหมด\n- ประวัติการลาทั้งหมด\n\nไม่สามารถกู้คืนได้!')) return;
    if (!confirm('⚠️ ยืนยันอีกครั้ง?\n\nข้อมูลจะหายไปถาวร และไม่สามารถกู้คืนได้!')) return;
    attendanceList = [];
    leaveList = [];
    saveAttendance();
    saveLeaves();
    renderAttendanceTable();
    renderLeaveTable();
    updateStats();
    showToast('🗑️ ล้างข้อมูลทั้งหมดแล้ว');
    closeModal('adminDashboardModal');
}

// ── Export CSV ──
function exportCSV(type) {
    let rows = [], filename = '';
    const today = DateHelper.today();
    if (type === 'students') {
        rows.push(['รหัส','ชื่อ-นามสกุล','ชั้นปี','มุมที่บันทึก']);
        registeredFaces.forEach(s => rows.push([s.id, s.name, s.year||'', s.descriptors?.length||0]));
        filename = `students_${today}.csv`;
    } else if (type === 'attendance') {
        rows.push(['วันที่','เวลา','รหัส','ชื่อ-นามสกุล','ชั้นปี','วิธีตรวจสอบ','สถานะ']);
        attendanceList.forEach(r => rows.push([r.date, r.time, r.studentId||'', r.name, r.year||'', r.method||'ใบหน้า (AI)', DateHelper.isLate(r.time)?'มาสาย':'ตรงเวลา']));
        filename = `attendance_${today}.csv`;
    } else if (type === 'leave') {
        rows.push(['วันที่ลา','รหัส','ชื่อ','ชั้นปี','ประเภท','เหตุผล','สถานะ']);
        const statusTh = { pending:'รออนุมัติ', approved:'อนุมัติแล้ว', rejected:'ไม่อนุมัติ' };
        leaveList.forEach(r => rows.push([r.date, r.studentId||'', r.name, r.year||'', r.type, r.reason||'', statusTh[r.status||'pending']]));
        filename = `leave_${today}.csv`;
    } else if (type === 'all') {
        rows.push(['=== ข้อมูลนักศึกษา ===']); rows.push(['รหัส','ชื่อ','ชั้นปี']);
        registeredFaces.forEach(s => rows.push([s.id, s.name, s.year||'']));
        rows.push([]); rows.push(['=== รายชื่อเข้าแถว ===']); rows.push(['วันที่','เวลา','รหัส','ชื่อ','สถานะ']);
        attendanceList.forEach(r => rows.push([r.date, r.time, r.studentId||'', r.name, DateHelper.isLate(r.time)?'มาสาย':'ตรงเวลา']));
        rows.push([]); rows.push(['=== ประวัติลา ===']); rows.push(['วันที่','รหัส','ชื่อ','ประเภท','เหตุผล']);
        leaveList.forEach(r => rows.push([r.date, r.studentId||'', r.name, r.type, r.reason||'']));
        filename = `export_all_${today}.csv`;
    }
    const csv  = '\uFEFF' + rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    showToast('📥 Export สำเร็จ!');
}

// ── Backup / Restore ──
function exportBackup() {
    try {
        const data = {
            students: DataStore.getStudents(),
            attendance: DataStore.getAttendance(),
            leaves: DataStore.getLeaves(),
            exportedAt: new Date().toISOString(),
            version: '1.0',
            _meta: {
                totalStudents: DataStore.getStudents().length,
                totalAttendance: DataStore.getAttendance().length,
                totalLeaves: DataStore.getLeaves().length,
                warning: 'ไฟล์นี้มีข้อมูลชีวมิติ (face descriptors) ของนักศึกษา — ควรเก็บรักษาอย่างปลอดภัย'
            }
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `backup_${DateHelper.today()}.json`; a.click();
        URL.revokeObjectURL(url);
        showToast('📦 สำรองข้อมูลสำเร็จ!');
    } catch (e) {
        console.error('exportBackup error:', e);
        showToast('❌ ไม่สามารถสำรองข้อมูลได้');
    }
}
function importBackup() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        if (file.size > 10 * 1024 * 1024) {
            showToast('❌ ไฟล์ใหญ่เกินไป (สูงสุด 10MB)');
            return;
        }
        
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const data = JSON.parse(ev.target.result);
                
                if (!data || typeof data !== 'object') {
                    showToast('❌ ไฟล์ข้อมูลไม่ถูกต้อง: ไม่ใช่ JSON object');
                    return;
                }
                if (!Array.isArray(data.students) || !Array.isArray(data.attendance) || !Array.isArray(data.leaves)) {
                    showToast('❌ ไฟล์ข้อมูลไม่ถูกต้อง: ขาด array ที่จำเป็น');
                    return;
                }
                if (typeof data.version !== 'string') {
                    showToast('❌ ไฟล์ข้อมูลไม่ถูกต้อง: ขาด version');
                    return;
                }
                
                const validStudents = data.students.filter(s => DataStore.validateStudent(s));
                const validAttendance = data.attendance.filter(r => DataStore.validateAttendance(r));
                const validLeaves = data.leaves.filter(r => DataStore.validateLeave(r));
                
                if (validStudents.length !== data.students.length) {
                    showToast(`⚠️ พบข้อมูลนักศึกษาที่ไม่ถูกต้อง ${data.students.length - validStudents.length} รายการ จะไม่นำเข้าบางส่วน`);
                }
                if (validAttendance.length !== data.attendance.length) {
                    showToast(`⚠️ พบข้อมูลเข้าแถวที่ไม่ถูกต้อง ${data.attendance.length - validAttendance.length} รายการ จะไม่นำเข้าบางส่วน`);
                }
                if (validLeaves.length !== data.leaves.length) {
                    showToast(`⚠️ พบข้อมูลการลาที่ไม่ถูกต้อง ${data.leaves.length - validLeaves.length} รายการ จะไม่นำเข้าบางส่วน`);
                }
                
                if (validStudents.length === 0 && validAttendance.length === 0 && validLeaves.length === 0) {
                    showToast('❌ ไฟล์ข้อมูลว่างเปล่า');
                    return;
                }
                
                const totalRecords = validStudents.length + validAttendance.length + validLeaves.length;
                const confirmMsg = `⚠️ การนำเข้าข้อมูลจะเขียนทับข้อมูลเดิมทั้งหมด!\n\n` +
                    `นักศึกษา: ${validStudents.length} คน\n` +
                    `รายการเข้าแถว: ${validAttendance.length} รายการ\n` +
                    `รายการลา: ${validLeaves.length} รายการ\n\n` +
                    `ยืนยัน?`;
                
                if (!confirm(confirmMsg)) return;
                if (!confirm('⚠️ ยืนยันอีกครั้ง?\n\nข้อมูลเดิมจะหายไปถาวร!')) return;
                
                const s1 = DataStore.saveStudents(validStudents);
                const s2 = DataStore.saveAttendance(validAttendance);
                const s3 = DataStore.saveLeaves(validLeaves);
                
                if (!s1 || !s2 || !s3) {
                    showToast('❌ ไม่สามารถบันทึกข้อมูลได้ครบถ้วน');
                    return;
                }
                
                registeredFaces = DataStore.getStudents();
                attendanceList = DataStore.getAttendance();
                leaveList = DataStore.getLeaves();
                
                updateStats();
                renderDBTable();
                renderAttendanceTable();
                renderLeaveTable();
                showToast(`📥 นำเข้าข้อมูลสำเร็จ! (${totalRecords} รายการ)`);
            } catch (err) {
                showToast('❌ ไม่สามารถอ่านไฟล์ข้อมูลได้');
                console.error(err);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

// ── Admin ──
function checkAdminLogin() {
    const u = document.getElementById('adminUser').value.trim();
    const p = document.getElementById('adminPass').value.trim();
    const e = document.getElementById('loginError');
    if (u === CONFIG.ADMIN_CREDENTIALS.user && p === CONFIG.ADMIN_CREDENTIALS.pass) {
        isAdminSession = true;
        document.getElementById('adminUser').value = '';
        document.getElementById('adminPass').value = '';
        if (e) e.style.display = 'none';
        closeModal('loginModal');
        openModal('adminDashboardModal');
    } else {
        if (e) { e.style.display = 'block'; setTimeout(() => e.style.display='none', 3000); }
    }
}
function openAdminWeekly() {
    closeModal('adminDashboardModal');
    document.getElementById('adminDataTitle').textContent = '📅 รายชื่อการเข้าแถวสัปดาห์นี้';
    document.getElementById('adminTableHead').innerHTML = '<tr><th>#</th><th>วันที่</th><th>เวลา</th><th>รหัส</th><th>ชื่อ-นามสกุล</th><th>สถานะ</th></tr>';
    const recs = getThisWeekRecords();
    document.getElementById('adminTableBody').innerHTML = recs.length === 0
        ? '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:32px">ยังไม่มีข้อมูลสัปดาห์นี้</td></tr>'
        : recs.map((r,i) => `<tr><td style="color:var(--text-muted)">${i+1}</td><td style="font-family:var(--font-mono)">${escapeHtml(r.date)}</td><td style="font-family:var(--font-mono)">${escapeHtml(r.time)}</td><td style="font-family:var(--font-mono)">${escapeHtml(r.studentId||'—')}</td><td>${escapeHtml(r.name)}</td><td><span class="badge ${isLate(r.time)?'badge-yellow':'badge-green'}">${isLate(r.time)?'มาสาย':'ตรงเวลา'}</span></td></tr>`).join('');
    openModal('adminDataModal');
}
function openAdminStats() {
    closeModal('adminDashboardModal');
    document.getElementById('adminDataTitle').textContent = '📊 สถิติการเข้าแถว 18 สัปดาห์';
    document.getElementById('adminTableHead').innerHTML = '<tr><th>สัปดาห์ที่</th><th>จำนวนเข้าแถว</th><th>นักศึกษาทั้งหมด</th><th>เปอร์เซ็นต์</th><th>สถานะ</th></tr>';
    document.getElementById('adminTableBody').innerHTML = Array.from({length:18}, (_,i) => {
        const cnt   = attendanceList.filter(r => r.weekNum === i+1).length;
        const total = registeredFaces.length || 1;
        const pct   = Math.round(cnt / total * 100);
        const bc    = pct>=80?'badge-green':pct>=60?'badge-yellow':'badge-red';
        const lbl   = pct>=80?'🟢 ดี':pct>=60?'🟡 ปานกลาง':'🔴 น้อย';
        return `<tr><td style="font-family:var(--font-mono)">สัปดาห์ที่ ${i+1}</td><td style="font-family:var(--font-mono)">${cnt}</td><td style="font-family:var(--font-mono)">${registeredFaces.length}</td><td><span class="badge ${bc}">${pct}%</span></td><td>${lbl}</td></tr>`;
    }).join('');
    openModal('adminDataModal');
}
function openAdminAllWeeks() {
    closeModal('adminDashboardModal');
    document.getElementById('weekGrid').innerHTML = Array.from({length:18}, (_,i) => `<button class="week-btn" onclick="viewSpecificWeek(${i+1})">สัปดาห์ ${i+1}</button>`).join('');
    openModal('weekSelectModal');
}
function viewSpecificWeek(w) {
    closeModal('weekSelectModal');
    document.getElementById('adminDataTitle').textContent = `📂 ข้อมูลการเข้าแถว สัปดาห์ที่ ${w}`;
    document.getElementById('adminTableHead').innerHTML = '<tr><th>#</th><th>วันที่</th><th>เวลา</th><th>ชื่อ-นามสกุล</th><th>ชั้นปี</th><th>สถานะ</th></tr>';
    const recs = attendanceList.filter(r => r.weekNum === w);
    document.getElementById('adminTableBody').innerHTML = recs.length === 0
        ? `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:32px">ยังไม่มีข้อมูลสัปดาห์ที่ ${w}</td></tr>`
        : recs.map((r,i) => `<tr><td style="color:var(--text-muted)">${i+1}</td><td style="font-family:var(--font-mono)">${escapeHtml(r.date)}</td><td style="font-family:var(--font-mono)">${escapeHtml(r.time)}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.year||'—')}</td><td><span class="badge ${isLate(r.time)?'badge-yellow':'badge-green'}">${isLate(r.time)?'มาสาย':'ตรงเวลา'}</span></td></tr>`).join('');
    openModal('adminDataModal');
}
function openAdminLeave() {
    closeModal('adminDashboardModal');
    document.getElementById('adminDataTitle').textContent = '📝 สถิติการลาแต่ละคน';
    document.getElementById('adminTableHead').innerHTML = '<tr><th>รหัส</th><th>ชื่อ-นามสกุล</th><th>ชั้นปี</th><th>ลาทั้งหมด</th><th>ลาป่วย</th><th>ลากิจ</th></tr>';
    // นับจำนวนลาแต่ละคน
    const summary = {};
    leaveList.forEach(r => {
        if (!summary[r.studentId]) summary[r.studentId] = { name:r.name, year:r.year||'—', total:0, sick:0, personal:0 };
        summary[r.studentId].total++;
        if (r.type === 'ลาป่วย')  summary[r.studentId].sick++;
        if (r.type === 'ลากิจ') summary[r.studentId].personal++;
    });
    const rows = Object.entries(summary);
    document.getElementById('adminTableBody').innerHTML = rows.length === 0
        ? '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:32px">ยังไม่มีข้อมูลการลา</td></tr>'
        : rows.map(([id, d]) => `<tr>
            <td style="font-family:var(--font-mono)">${escapeHtml(id)}</td>
            <td style="font-weight:600">${escapeHtml(d.name)}</td>
            <td>${escapeHtml(d.year)}</td>
            <td><span class="badge ${d.total>=3?'badge-red':d.total>=2?'badge-yellow':'badge-green'}">${d.total} ครั้ง</span></td>
            <td><span class="badge badge-blue">${d.sick} ครั้ง</span></td>
            <td><span class="badge badge-yellow">${d.personal} ครั้ง</span></td>
          </tr>`).join('');
    openModal('adminDataModal');
}

// ── Helpers ──
function getThisWeekRecords() {
    const now = new Date();
    const day = now.getDay();
    const mon = new Date(now); mon.setDate(now.getDate() - (day===0?6:day-1)); mon.setHours(0,0,0,0);
    const sun = new Date(mon); sun.setDate(mon.getDate()+6); sun.setHours(23,59,59,999);
    return attendanceList.filter(r => {
        const d = r.timestamp ? new Date(r.timestamp) : new Date(r.date + 'T00:00:00');
        return !isNaN(d.getTime()) && d >= mon && d <= sun;
    });
}
function getAcademicWeekNum(date) {
    if (!date) date = new Date();
    const start = new Date(date.getFullYear(), 4, 1);
    return DateHelper.getAcademicWeekNum(date);
}

// ══════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════
let dashTrendRange = 7;
function setTrendRange(days) {
    dashTrendRange = days;
    document.getElementById('trendTab7')?.classList.toggle('active', days === 7);
    document.getElementById('trendTab30')?.classList.toggle('active', days === 30);
    renderDashboard();
}

function renderDashboard() {
    const dl = document.getElementById('dashDateLine');
    if (dl) dl.textContent = DateHelper.toThaiDateLong();

    const today = DateHelper.today();
    const todayAtt = attendanceList.filter(r => r.date === today);
    const presentOnTime = todayAtt.filter(r => !DateHelper.isLate(r.time)).length;
    const late = todayAtt.filter(r => DateHelper.isLate(r.time)).length;
    const total = registeredFaces.length;
    const leaveToday = leaveList.filter(r => r.date === today && r.status === 'approved').length;
    const presentIds = new Set(todayAtt.map(r => r.studentId));
    const leaveIds = new Set(leaveList.filter(r => r.date === today && r.status === 'approved').map(r => r.studentId));
    const absent = registeredFaces.filter(s => !presentIds.has(s.id) && !leaveIds.has(s.id)).length;

    setText('kpiTotal', total);
    setText('kpiPresent', presentOnTime);
    setText('kpiLate', late);
    setText('kpiAbsent', absent);
    setText('kpiLeave', leaveToday);

    renderTrendChart('trendChart', dashTrendRange);
    renderRecentList();
    renderClassCompare('classCompareBody');
    renderAttentionList();
}
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

// สร้างข้อมูลแนวโน้ม N วันล่าสุดจากข้อมูลจริงใน attendanceList/leaveList (ไม่มี mock data)
function buildTrendData(days) {
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
        const dateStr = `${y}-${m}-${day}`;
        const recs = attendanceList.filter(r => r.date === dateStr);
        const present = recs.filter(r => !DateHelper.isLate(r.time)).length;
        const lateN   = recs.filter(r => DateHelper.isLate(r.time)).length;
        const leaveN  = leaveList.filter(r => r.date === dateStr && r.status === 'approved').length;
        const total   = registeredFaces.length;
        const absentN = Math.max(0, total - present - lateN - leaveN);
        out.push({ date: dateStr, label: d.toLocaleDateString('th-TH', { day:'numeric', month:'short' }), present, late: lateN, leave: leaveN, absent: absentN });
    }
    return out;
}
function renderTrendChart(elId, days, dataOverride) {
    const el = document.getElementById(elId);
    if (!el) return;
    const data = dataOverride || buildTrendData(days);
    const maxTotal = Math.max(1, ...data.map(d => d.present + d.late + d.leave + d.absent));
    el.innerHTML = data.map(d => {
        const totalDay = d.present + d.late + d.leave + d.absent;
        const scale = totalDay > 0 ? (totalDay / maxTotal) * 100 : 0;
        const segs = [
            d.present ? `<div class="trend-bar-seg present" style="height:${(d.present/Math.max(1,totalDay))*100}%" title="ตรงเวลา ${d.present}"></div>` : '',
            d.late    ? `<div class="trend-bar-seg late"    style="height:${(d.late/Math.max(1,totalDay))*100}%"    title="มาสาย ${d.late}"></div>`    : '',
            d.leave   ? `<div class="trend-bar-seg leaveseg" style="height:${(d.leave/Math.max(1,totalDay))*100}%"  title="ลา ${d.leave}"></div>`      : '',
        ].join('');
        return `<div class="trend-bar-wrap">
            <div class="trend-bar-stack" style="height:${Math.max(4,scale)}%">${segs}</div>
            <div class="trend-label">${escapeHtml(d.label)}</div>
        </div>`;
    }).join('') || '<div style="color:var(--text-muted);font-size:0.85rem;padding:20px;text-align:center;width:100%;">ยังไม่มีข้อมูล</div>';
}

function renderRecentList() {
    const el = document.getElementById('recentList');
    if (!el) return;
    const recent = attendanceList.slice().sort((a,b) => (b.timestamp||0)-(a.timestamp||0)).slice(0, 8);
    el.innerHTML = recent.length === 0
        ? '<p style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:16px 0;">ยังไม่มีข้อมูลการเข้าแถว</p>'
        : recent.map(r => {
            const late = DateHelper.isLate(r.time);
            const initial = escapeHtml((r.name||'?').trim().charAt(0));
            return `<div class="recent-row">
                <div class="recent-avatar">${initial}</div>
                <div class="recent-info"><div class="recent-name">${escapeHtml(r.name)}</div><div class="recent-sub">${escapeHtml(r.studentId||'—')} • ${escapeHtml(r.date)}</div></div>
                <span class="badge ${late?'badge-yellow':'badge-green'}">${escapeHtml(r.time)}</span>
            </div>`;
        }).join('');
}

// เปรียบเทียบเปอร์เซ็นต์เข้าแถว "วันนี้" ตามชั้นปี — ใช้ elId เดียวกันได้ทั้งแดชบอร์ดและรายงาน
function renderClassCompare(elId, dateFilter) {
    const el = document.getElementById(elId);
    if (!el) return;
    const date = dateFilter || DateHelper.today();
    const classes = getClassList();
    if (classes.length === 0) { el.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">ยังไม่มีข้อมูลนักศึกษา</p>'; return; }
    el.innerHTML = classes.map(c => {
        const inClass = registeredFaces.filter(s => (s.year||'—') === c);
        const ids = new Set(inClass.map(s => s.id));
        const presentCount = attendanceList.filter(r => r.date === date && ids.has(r.studentId)).length;
        const pct = inClass.length ? Math.round(presentCount / inClass.length * 100) : 0;
        return `<div class="class-compare-row">
            <div class="class-compare-name">${escapeHtml(c)}</div>
            <div class="class-compare-bar-track"><div class="class-compare-bar-fill" style="width:${pct}%"></div></div>
            <div class="class-compare-pct">${pct}%</div>
        </div>`;
    }).join('');
}

// นักศึกษาที่ควรดูแลเป็นพิเศษ — จัดอันดับจากจำนวนครั้งมาสายใน 30 วันล่าสุด (ข้อมูลจริงเท่านั้น)
function renderAttentionList() {
    const el = document.getElementById('attentionList');
    if (!el) return;
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
    const recent = attendanceList.filter(r => { const d = new Date(r.timestamp||r.date); return !isNaN(d) && d >= cutoff; });
    const lateCounts = {};
    recent.forEach(r => { if (DateHelper.isLate(r.time)) lateCounts[r.studentId] = (lateCounts[r.studentId]||0) + 1; });
    const ranked = Object.entries(lateCounts).filter(([,c]) => c >= 2).sort((a,b) => b[1]-a[1]).slice(0, 6);
    if (ranked.length === 0) { el.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">ยังไม่มีนักศึกษาที่มาสายซ้ำในช่วง 30 วันล่าสุด</p>'; return; }
    el.innerHTML = ranked.map(([id, count]) => {
        const s = DataStore.findStudentById(id);
        return `<div class="attention-row">
            <div class="recent-avatar" style="background:var(--yellow-dim);color:var(--yellow);">${escapeHtml((s?.name||'?').charAt(0))}</div>
            <div class="recent-info"><div class="recent-name">${escapeHtml(s?.name||id)}</div><div class="recent-sub">${escapeHtml(id)} • ${escapeHtml(s?.year||'—')}</div></div>
            <span class="attention-badge" style="color:var(--yellow);">${count} ครั้ง</span>
        </div>`;
    }).join('');
}

// ══════════════════════════════════════════════
// REPORTS
// ══════════════════════════════════════════════
function reportDateRange() {
    const period = document.getElementById('reportPeriod')?.value || 'daily';
    const days = period === 'monthly' ? 30 : period === 'weekly' ? 7 : 1;
    const end = DateHelper.today();
    const startD = new Date(); startD.setDate(startD.getDate() - (days - 1));
    const start = `${startD.getFullYear()}-${String(startD.getMonth()+1).padStart(2,'0')}-${String(startD.getDate()).padStart(2,'0')}`;
    return { start, end, days };
}
function renderReports() {
    const { start, end, days } = reportDateRange();
    const classF   = document.getElementById('reportClassFilter')?.value || 'all';
    const studentF = document.getElementById('reportStudentFilter')?.value || 'all';

    let students = registeredFaces;
    if (classF !== 'all') students = students.filter(s => (s.year||'—') === classF);
    if (studentF !== 'all') students = students.filter(s => s.id === studentF);
    const studentIds = new Set(students.map(s => s.id));

    const attInRange   = attendanceList.filter(r => r.date >= start && r.date <= end && studentIds.has(r.studentId));
    const leaveInRange = leaveList.filter(r => r.date >= start && r.date <= end && r.status === 'approved' && studentIds.has(r.studentId));

    const present = attInRange.filter(r => !DateHelper.isLate(r.time)).length;
    const late    = attInRange.filter(r => DateHelper.isLate(r.time)).length;
    const leaveN  = leaveInRange.length;
    // "โรงเรียนเปิดวันไหนบ้าง" ดูจากวันที่มีบันทึกเช็กชื่อจริงอย่างน้อย 1 รายการในช่วงนี้ (ไม่เดาปฏิทินเทอม)
    const schoolDays = Array.from(new Set(attendanceList.filter(r => r.date >= start && r.date <= end).map(r => r.date)));
    let absent = 0;
    students.forEach(s => {
        schoolDays.forEach(d => {
            const hasAtt = attInRange.some(r => r.studentId === s.id && r.date === d);
            const hasLeave = leaveInRange.some(r => r.studentId === s.id && r.date === d);
            if (!hasAtt && !hasLeave) absent++;
        });
    });
    const totalSlots = students.length * schoolDays.length;
    const pct = totalSlots > 0 ? Math.round((present + late) / totalSlots * 100) : 0;

    const grid = document.getElementById('reportSummaryGrid');
    if (grid) grid.innerHTML = `
        <div class="report-mini-card"><div class="report-mini-num" style="color:var(--green)">${present}</div><div class="report-mini-label">ตรงเวลา</div></div>
        <div class="report-mini-card"><div class="report-mini-num" style="color:var(--yellow)">${late}</div><div class="report-mini-label">มาสาย</div></div>
        <div class="report-mini-card"><div class="report-mini-num" style="color:var(--red)">${absent}</div><div class="report-mini-label">ขาด</div></div>
        <div class="report-mini-card"><div class="report-mini-num" style="color:var(--blue)">${leaveN}</div><div class="report-mini-label">ลา</div></div>
        <div class="report-mini-card"><div class="report-mini-num" style="color:var(--accent)">${pct}%</div><div class="report-mini-label">อัตราเข้าแถว</div></div>`;

    renderTrendChart('reportTrendChart', days);
    renderClassCompare('reportClassCompare');

    // มาสายบ่อย / ขาดบ่อย ในช่วงที่เลือก (เฉพาะกลุ่มนักศึกษาที่ผ่านตัวกรอง)
    const lateCounts = {}, absentCounts = {};
    students.forEach(s => {
        lateCounts[s.id] = attInRange.filter(r => r.studentId === s.id && DateHelper.isLate(r.time)).length;
        absentCounts[s.id] = schoolDays.filter(d => !attInRange.some(r => r.studentId === s.id && r.date === d) && !leaveInRange.some(r => r.studentId === s.id && r.date === d)).length;
    });
    const lateBody = document.getElementById('reportLateBody');
    if (lateBody) {
        const rows = students.map(s => ({ s, c: lateCounts[s.id] })).filter(x => x.c > 0).sort((a,b) => b.c - a.c).slice(0, 10);
        lateBody.innerHTML = rows.length === 0 ? '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:20px;">ไม่มีข้อมูล</td></tr>'
            : rows.map(({s,c}) => `<tr><td style="font-family:var(--font-mono)">${escapeHtml(s.id)}</td><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.year||'—')}</td><td><span class="badge badge-yellow">${c} ครั้ง</span></td></tr>`).join('');
    }
    const absentBody = document.getElementById('reportAbsentBody');
    if (absentBody) {
        const rows = students.map(s => ({ s, c: absentCounts[s.id] })).filter(x => x.c > 0).sort((a,b) => b.c - a.c).slice(0, 10);
        absentBody.innerHTML = rows.length === 0 ? '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:20px;">ไม่มีข้อมูล</td></tr>'
            : rows.map(({s,c}) => `<tr><td style="font-family:var(--font-mono)">${escapeHtml(s.id)}</td><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.year||'—')}</td><td><span class="badge badge-red">${c} ครั้ง</span></td></tr>`).join('');
    }
}

// ══════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════
function loadUserSettings() {
    const s = DataStore.getSettings();
    setVal('setStartTime', CONFIG.ATTENDANCE_START_TIME);
    setVal('setLateTime',  CONFIG.LATE_TIME);
    setVal('setEndTime',   CONFIG.ATTENDANCE_END_TIME);
    setVal('setThreshold', CONFIG.FACE_MATCH_THRESHOLD);
    setVal('setMinConf',   CONFIG.FACE_DETECT_MIN_CONFIDENCE);
    setVal('setOrgName',   s.orgName || '');
    setText('setThresholdVal', CONFIG.FACE_MATCH_THRESHOLD);
    setText('setMinConfVal', CONFIG.FACE_DETECT_MIN_CONFIDENCE);
}
function setVal(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
function saveAttendanceSettings() {
    const start = document.getElementById('setStartTime').value;
    const late  = document.getElementById('setLateTime').value;
    const end   = document.getElementById('setEndTime').value;
    if (!start || !late || !end) { showToast('⚠️ กรุณากรอกเวลาให้ครบ'); return; }
    CONFIG.ATTENDANCE_START_TIME = start;
    CONFIG.LATE_TIME = late;
    CONFIG.ATTENDANCE_END_TIME = end;
    const s = DataStore.getSettings();
    s.attendanceStartTime = start; s.lateTime = late; s.attendanceEndTime = end;
    DataStore.saveSettings(s);
    showToast('💾 บันทึกช่วงเวลาเช็กชื่อแล้ว');
    renderDashboard();
}
function saveFaceSettings() {
    const th = parseFloat(document.getElementById('setThreshold').value);
    const mc = parseFloat(document.getElementById('setMinConf').value);
    CONFIG.FACE_MATCH_THRESHOLD = th;
    CONFIG.FACE_DETECT_MIN_CONFIDENCE = mc;
    const s = DataStore.getSettings();
    s.faceMatchThreshold = th; s.faceMinConfidence = mc;
    DataStore.saveSettings(s);
    showToast('💾 บันทึกการตั้งค่าการจดจำใบหน้าแล้ว (มีผลตั้งแต่การสแกนครั้งถัดไป)');
}
function saveOrgSettings() {
    const name = document.getElementById('setOrgName').value.trim();
    const s = DataStore.getSettings();
    s.orgName = name;
    DataStore.saveSettings(s);
    showToast('💾 บันทึกข้อมูลสถาบันแล้ว');
}
