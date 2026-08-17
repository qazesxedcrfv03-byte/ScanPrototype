// leave.js — ระบบแจ้งลา (มีสถานะ รออนุมัติ/อนุมัติ/ไม่อนุมัติ)

function autoFillLeaveInfo() {
    const sid  = document.getElementById('leaveStudentId').value.trim();
    const student = DataStore.findStudentById(sid);
    document.getElementById('leaveName').value = student ? student.name : '';
    document.getElementById('leaveYear').value = student ? (student.year||'') : '';
}

function submitLeave() {
    const sidInput = document.getElementById('leaveStudentId');
    const nameInput = document.getElementById('leaveName');
    const yearInput = document.getElementById('leaveYear');
    const reasonInput = document.getElementById('leaveReason');

    const sid = sidInput.value.trim();
    const name = nameInput.value.trim();
    const year = yearInput.value.trim();
    const date = document.getElementById('leaveDate').value;
    const type = document.getElementById('leaveType').value;
    const reason = reasonInput.value.trim();

    if (!sid)    { showToast('⚠️ กรุณากรอกรหัสนักศึกษา'); return; }
    if (!name)   { showToast('⚠️ ไม่พบรหัสนี้ในระบบ'); return; }
    if (!date)   { showToast('⚠️ กรุณาเลือกวันที่ลา'); return; }
    if (!reason) { showToast('⚠️ กรุณาระบุเหตุผล'); return; }

    // เช็คว่าลาวันเดิมซ้ำแล้วหรือยัง
    const dup = DataStore.getLeaves().find(r => r.studentId === sid && r.date === date);
    if (dup) { showToast(`⚠️ ${name} แจ้งลาวันที่ ${date} ไปแล้ว`); return; }

    const leave = { studentId:sid, name, year, date, type, reason, status:'pending', timestamp: Date.now() };
    DataStore.addLeave(leave);
    leaveList = DataStore.getLeaves();
    renderLeaveTable();
    showToast(`📝 บันทึกใบลา "${name}" สำเร็จ! รออาจารย์อนุมัติ`);

    // reset form
    document.getElementById('leaveStudentId').value = '';
    document.getElementById('leaveName').value = '';
    document.getElementById('leaveYear').value = '';
    document.getElementById('leaveReason').value = '';
    document.getElementById('leaveDate').value = DateHelper.today();
}

function renderLeaveTable() {
    const tbody  = document.getElementById('leaveBody');
    const empty  = document.getElementById('leaveEmpty');
    if (!tbody) return;
    const typeFilter   = document.getElementById('leaveFilter')?.value || 'all';
    const statusFilter = document.getElementById('leaveStatusFilter')?.value || 'all';
    let list = leaveList;
    if (typeFilter !== 'all')   list = list.filter(r => r.type === typeFilter);
    if (statusFilter !== 'all') list = list.filter(r => (r.status || 'pending') === statusFilter);

    if (list.length === 0) {
        tbody.innerHTML = '';
        if (empty) empty.style.display = 'block';
        return;
    }
    if (empty) empty.style.display = 'none';

    const typeBadge = { 'ลาป่วย':'badge-red', 'ลากิจ':'badge-yellow', 'ลาพักร้อน':'badge-green', 'อื่นๆ':'badge-blue' };
    const statusBadge = { pending: ['badge-pending','⏳ รออนุมัติ'], approved: ['badge-approved','✓ อนุมัติแล้ว'], rejected: ['badge-rejected','✕ ไม่อนุมัติ'] };

    tbody.innerHTML = list.slice().reverse().map((r, i) => {
        const actualIndex = leaveList.indexOf(r);
        const status = r.status || 'pending';
        const [sCls, sLbl] = statusBadge[status] || statusBadge.pending;
        const actions = isAdminSession
            ? (status === 'pending'
                ? `<div class="leave-approve-actions">
                        <button class="btn-approve" onclick="approveLeave(${actualIndex})">✓ อนุมัติ</button>
                        <button class="btn-reject" onclick="rejectLeave(${actualIndex})">✕ ไม่อนุมัติ</button>
                        <button class="btn-del" onclick="deleteLeave(${actualIndex})">🗑️</button>
                   </div>`
                : `<button class="btn-del" onclick="deleteLeave(${actualIndex})">🗑️</button>`)
            : `<span style="color:var(--text-muted);font-size:0.75rem;">— (ต้องล็อกอินอาจารย์)</span>`;
        return `
        <tr>
            <td style="color:var(--text-muted);font-family:var(--font-mono)">${i+1}</td>
            <td style="font-family:var(--font-mono)">${escapeHtml(r.date)}</td>
            <td style="font-family:var(--font-mono)">${escapeHtml(r.studentId||'—')}</td>
            <td style="font-weight:600">${escapeHtml(r.name)}</td>
            <td>${escapeHtml(r.year||'—')}</td>
            <td><span class="badge ${typeBadge[r.type]||'badge-blue'}">${escapeHtml(r.type)}</span></td>
            <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.8rem;color:var(--text-secondary)">${escapeHtml(r.reason||'—')}</td>
            <td><span class="badge ${sCls}">${sLbl}</span></td>
            <td>${actions}</td>
        </tr>`;
    }).join('');
}

function deleteLeave(i) {
    if (!confirm(`ลบรายการลาของ "${leaveList[i].name}" วันที่ ${leaveList[i].date}?`)) return;
    DataStore.removeLeave(i);
    leaveList = DataStore.getLeaves();
    renderLeaveTable();
    showToast('🗑️ ลบรายการลาแล้ว');
}

// อนุมัติ/ไม่อนุมัติใบลา — เฉพาะอาจารย์ที่ล็อกอินแล้วในเซสชันนี้ (isAdminSession, กำหนดใน app.js)
function approveLeave(i) {
    if (!isAdminSession) { showToast('⚠️ กรุณาล็อกอินอาจารย์ก่อน'); return; }
    if (!leaveList[i]) return;
    DataStore.setLeaveStatus(i, 'approved');
    leaveList = DataStore.getLeaves();
    renderLeaveTable();
    if (typeof renderDashboard === 'function' && document.getElementById('section-dashboard')?.classList.contains('active')) renderDashboard();
    showToast(`✅ อนุมัติใบลาของ "${leaveList[i].name}" แล้ว`);
}
function rejectLeave(i) {
    if (!isAdminSession) { showToast('⚠️ กรุณาล็อกอินอาจารย์ก่อน'); return; }
    if (!leaveList[i]) return;
    DataStore.setLeaveStatus(i, 'rejected');
    leaveList = DataStore.getLeaves();
    renderLeaveTable();
    showToast(`❌ ไม่อนุมัติใบลาของ "${leaveList[i].name}"`);
}
