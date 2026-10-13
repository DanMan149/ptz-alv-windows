/*
 * click-preset.js
 * Click on the video to load the nearest preset.
 *
 * Chat safety: this file never sends anything by itself except the normal
 * "!ptzload <camera> <preset>" that a preset button would send, and only when you click
 * a valid spot with "Click Preset" on and "Preview only" off. Calibration, position
 * tracking and previews are 100% local and send nothing.
 *
 * Needs: preset-positions.json (pan/tilt/zoom per preset), the stream view (video icon).
 */
(() => {
    'use strict';

    const LS = {
        get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
        set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
    };
    const $ = (s, r = document) => r.querySelector(s);
    const jget = (k, d) => { try { return JSON.parse(LS.get(k, 'null')) ?? d; } catch { return d; } };

    // ------------------------------------------------------------------ data + state
    let POS = {};                                   // { cam: { preset: [pan, tilt, zoom] } }
    const DEFAULT_CAL = { F0: 60, ZK: 330, samples: [] };
    let cal = jget('ptzCal', {});                   // { cam: { F0, ZK, samples } }
    let track = jget('ptzTrack', {});               // { cam: { preset, pan, tilt, zoom } }
    let modeOn = LS.get('cpModeOn') === 'true';
    let previewOnly = LS.get('cpPreview') === 'true';
    let calStep = null;                             // null | 'click' | 'choose'
    let pendingClick = null;

    const MAX_ERR_BASE = 2;                         // degrees added to the "too far" threshold
    const R = 9 / 16;                               // slot aspect (height / width)

    fetch('preset-positions.json').then(r => r.json()).then(d => { POS = d.cameras || {}; }).catch(() => { });

    const camKey = () => String(selectedCamera || '').trim().toLowerCase();
    const getCal = (cam) => Object.assign({}, DEFAULT_CAL, cal[cam] || {}, { samples: (cal[cam] && cal[cam].samples) || [] });
    const saveCal = () => LS.set('ptzCal', JSON.stringify(cal));
    const saveTrack = () => LS.set('ptzTrack', JSON.stringify(track));
    const wrap = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
    const mag = (z, c) => 1 + Math.max(0, z - 1) / c.ZK;
    const fovAt = (z, c) => c.F0 / mag(z, c);

    // ------------------------------------------------------------------ position tracking (local only)
    // Wrap sendCommand to *observe* outgoing commands. It forwards them untouched.
    const origSend = window.sendCommand;
    window.sendCommand = function (command) {
        try { observe(String(command || '')); } catch { /* never break sending */ }
        return origSend.apply(this, arguments);
    };
    function observe(cmd) {
        const p = cmd.trim().split(/\s+/);
        const name = (p[0] || '').toLowerCase();
        if (name === '!ptzload' && p[1] && p[2]) {
            const cam = p[1].toLowerCase(), preset = p[2];
            const v = POS[cam] && POS[cam][preset];
            if (v) track[cam] = { preset, pan: v[0], tilt: v[1], zoom: v[2] }; else delete track[cam];
        } else if (name === '!ptzseta' && p[1] && p.length >= 5 && !isNaN(+p[2])) {
            track[p[1].toLowerCase()] = { preset: '(custom)', pan: +p[2], tilt: +p[3], zoom: +p[4] };
        } else if (['!ptzmove', '!ptzspin', '!ptzset', '!ptzareazoom', '!ptzcfocus', '!resetcam'].includes(name) && p[1] && isNaN(+p[1])) {
            delete track[p[1].toLowerCase()];
        } else if (name === '!ptzzoom' && p[1] && !isNaN(+p[2])) {
            const cam = p[1].toLowerCase(), t = track[cam];
            if (!t) return;
            const c = getCal(cam);
            const m = Math.max(1, mag(t.zoom, c) * (+p[2] / 100));
            t.zoom = Math.max(1, Math.round(1 + (m - 1) * c.ZK)); t.preset = '(zoomed)';
        } else if (name === '!ptzclick') {
            delete track[camKey()]; // the bot picks the camera, so assume the selected one moved
        } else { return; }
        saveTrack();
        refreshPanel();
    }

    // ------------------------------------------------------------------ geometry
    function slotRects(iframe) {
        const W = iframe.clientWidth, H = iframe.clientHeight;
        const r = iframe.getBoundingClientRect();
        let ew, eh;
        if ((9 / 16) * W > H) { eh = H; ew = (16 / 9) * H; } else { ew = W; eh = (9 / 16) * W; }
        const ox = r.left + (W - ew) / 2, oy = r.top + (H - eh) / 2;
        const sx = ew / 1920, sy = eh / 1080;
        const box = (x, y, w, h) => ({ left: ox + x * sx, top: oy + y * sy, width: w * sx, height: h * sy });
        return [
            box(0, 0, 640, 360), box(0, 360, 640, 360), box(0, 720, 640, 360),
            box(640, 720, 640, 360), box(1280, 720, 640, 360), box(640, 0, 1280, 720),
        ];
    }
    function slotAt(iframe, cx, cy) {
        const rs = slotRects(iframe), i = rs.findIndex(b => cx >= b.left && cx <= b.left + b.width && cy >= b.top && cy <= b.top + b.height);
        return i < 0 ? null : Object.assign({ geo: i + 1 }, rs[i]);
    }

    function targetFor(cam, x, y) {
        const t = track[cam];
        if (!t) return null;
        const c = getCal(cam);
        const f = fovAt(t.zoom, c);
        return { pan: wrap(t.pan + (x - 0.5) * f), tilt: t.tilt - (y - 0.5) * f * R, fov: f, cal: c };
    }

    function nearest(cam, tp, tt, fov, c, curZoom, limit = 5) {
        const list = [];
        const mc = mag(curZoom, c);
        for (const [name, v] of Object.entries(POS[cam] || {})) {
            const d = Math.hypot(wrap(v[0] - tp), v[1] - tt);
            const penalty = 0.1 * fov * Math.abs(Math.log(mag(v[2], c) / mc));
            list.push({ name, d, score: d + penalty, v });
        }
        list.sort((a, b) => a.score - b.score);
        return list.slice(0, limit);
    }

    // ------------------------------------------------------------------ calibration math
    // fov from samples that share one zoom state: least squares over pan and tilt offsets
    function fovFromSample(s) {
        const ax = s.x - 0.5, ay = (s.y - 0.5) * R;
        const dpan = wrap(s.tp - s.pc[0]), dtilt = s.tt - s.pc[1];
        const num = ax * dpan - ay * dtilt, den = ax * ax + ay * ay;
        return den > 1e-4 ? { num, den } : null;
    }
    function refit(cam) {
        const c = getCal(cam);
        const wide = c.samples.filter(s => s.pc[2] <= 30).map(fovFromSample).filter(Boolean);
        if (wide.length) {
            const f = wide.reduce((a, b) => a + b.num, 0) / wide.reduce((a, b) => a + b.den, 0);
            if (f > 5 && f < 180) c.F0 = +f.toFixed(2);
        }
        const ks = [];
        c.samples.filter(s => s.pc[2] > 30).forEach(s => {
            const q = fovFromSample(s);
            if (!q) return;
            const f = q.num / q.den;
            const m = c.F0 / f;
            if (f > 0.05 && m > 1.05) ks.push((s.pc[2] - 1) / (m - 1));
        });
        if (ks.length) c.ZK = +(ks.reduce((a, b) => a + b, 0) / ks.length).toFixed(1);
        cal[cam] = c; saveCal();
    }

    // ------------------------------------------------------------------ overlay + toolbar
    function ensureToolbar() {
        const bar = $('#video-container-card .button-container');
        if (!bar || $('#cpToggle')) { syncButtons(); return; }
        const mk = (id, text, fn) => {
            const b = document.createElement('button');
            b.id = id; b.className = 'vidbutton'; b.textContent = text;
            b.addEventListener('click', fn);
            bar.appendChild(b);
        };
        mk('cpToggle', 'Click Preset', () => { modeOn = !modeOn; LS.set('cpModeOn', modeOn); syncButtons(); });
        syncButtons();
    }
    function syncButtons() {
        $('#cpToggle')?.classList.toggle('highlighted', modeOn);
        const need = modeOn || calStep;
        const container = $('#video-container');
        let ov = $('#cpOverlay');
        if (need && container && !ov) {
            ov = document.createElement('div');
            ov.id = 'cpOverlay';
            Object.assign(ov.style, { position: 'absolute', inset: '0', zIndex: 5, cursor: 'crosshair' });
            container.appendChild(ov);
            ov.addEventListener('click', onOverlayClick);
            ov.addEventListener('contextmenu', (e) => e.preventDefault());
        }
        if (!need && ov) ov.remove();
    }
    new MutationObserver(ensureToolbar).observe(document.body, { childList: true, subtree: true });

    function toast(text, x, y, ok = true) {
        const ov = $('#cpOverlay') || $('#video-container');
        if (!ov) return;
        $('#cpToast')?.remove();
        const t = document.createElement('div');
        t.id = 'cpToast';
        t.textContent = text;
        const r = ov.getBoundingClientRect();
        Object.assign(t.style, {
            position: 'absolute', left: Math.min(Math.max(8, x - r.left + 12), r.width - 280) + 'px', top: Math.max(8, y - r.top - 34) + 'px',
            background: ok ? 'rgba(21,101,192,.95)' : 'rgba(170,40,40,.95)', color: '#fff', padding: '6px 10px', borderRadius: '6px',
            fontSize: '13px', pointerEvents: 'none', zIndex: 6, maxWidth: '270px',
        });
        ov.appendChild(t);
        const dot = document.createElement('div');
        Object.assign(dot.style, { position: 'absolute', left: x - r.left - 7 + 'px', top: y - r.top - 7 + 'px', width: '14px', height: '14px', borderRadius: '50%', border: '2px solid #fff', background: ok ? '#2ecc71' : '#e74c3c', pointerEvents: 'none', zIndex: 6 });
        dot.className = 'cpDot'; ov.appendChild(dot);
        setTimeout(() => { t.remove(); dot.remove(); }, 2600);
    }

    function menu(items, x, y, onPick) {
        $('#cpMenu')?.remove();
        const m = document.createElement('div');
        m.id = 'cpMenu';
        Object.assign(m.style, { position: 'fixed', left: x + 'px', top: y + 'px', background: '#1e1e1e', border: '1px solid #555', borderRadius: '6px', zIndex: 100001, padding: '4px 0', minWidth: '180px' });
        items.forEach(it => {
            const row = document.createElement('div');
            row.textContent = it.label;
            Object.assign(row.style, { padding: '6px 12px', cursor: 'pointer', color: '#ddd', fontSize: '13px' });
            row.onmouseenter = () => row.style.background = '#2a2a2a';
            row.onmouseleave = () => row.style.background = '';
            row.onclick = () => { m.remove(); onPick(it); };
            m.appendChild(row);
        });
        document.body.appendChild(m);
        setTimeout(() => document.addEventListener('click', function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('click', off); } }), 0);
    }

    // ------------------------------------------------------------------ click handling
    function onOverlayClick(e) {
        const iframe = $('#twitchIframe');
        if (!iframe) return;
        const slot = slotAt(iframe, e.clientX, e.clientY);
        if (!slot) return;
        const x = (e.clientX - slot.left) / slot.width, y = (e.clientY - slot.top) / slot.height;
        // Smart click: use the camera that is in the clicked slot (from Sync Slots / swaps), and select it.
        const S = window.__slots;
        const known = S && Object.keys(S.slotCam()).length > 0;
        const slotCamName = S && S.camFor ? S.camFor(slot.geo) : null;
        if (known && !slotCamName) { toast(`Slot ${slot.geo}: camera unknown. Press Sync Slots.`, e.clientX, e.clientY, false); return; }
        if (slotCamName && slotCamName.trim().toLowerCase() !== camKey()) selectCamera(slotCamName);
        const cam = camKey();

        if (calStep === 'click') {
            if (!track[cam]) { toast('Position unknown. Set it in the Calibrate panel first.', e.clientX, e.clientY, false); return; }
            pendingClick = { x, y, pc: [track[cam].pan, track[cam].tilt, track[cam].zoom], cam };
            calStep = 'choose';
            toast('Landmark saved. Pick the preset that points at it in the panel.', e.clientX, e.clientY);
            refreshPanel();
            return;
        }
        if (!modeOn) return;

        if (!POS[cam]) { toast(`No preset positions for ${selectedCamera}`, e.clientX, e.clientY, false); return; }
        const t = targetFor(cam, x, y);
        if (!t) { toast('Position unknown. Load any preset once (or set it in Calibrate).', e.clientX, e.clientY, false); return; }
        const cands = nearest(cam, t.pan, t.tilt, t.fov, t.cal, track[cam].zoom);
        const limit = 0.6 * t.fov + MAX_ERR_BASE;
        const load = (c) => {
            if (previewOnly) { toast(`${c.name} (${c.d.toFixed(1)} deg off) [preview, nothing sent]`, e.clientX, e.clientY); return; }
            toast(`${c.name} (${c.d.toFixed(1)} deg off)`, e.clientX, e.clientY);
            sendLoadCommand(selectedCamera, c.name); // the only chat message this feature can send
        };
        if (e.shiftKey) {
            menu(cands.map(c => ({ label: `${c.name}  (${c.d.toFixed(1)} deg)`, c })), e.clientX, e.clientY, (it) => load(it.c));
            return;
        }
        const best = cands[0];
        if (!best || best.d > limit) {
            toast(`No preset near that spot (nearest ${best ? best.name + ', ' + best.d.toFixed(1) + ' deg' : 'none'})`, e.clientX, e.clientY, false);
            return;
        }
        load(best);
    }

    // ------------------------------------------------------------------ calibration panel
    function togglePanel() {
        const p = $('#cpPanel');
        if (p) { p.remove(); calStep = null; syncButtons(); return; }
        const panel = document.createElement('div');
        panel.id = 'cpPanel';
        Object.assign(panel.style, {
            position: 'fixed', right: '16px', top: '70px', width: '300px', background: '#1c1c1c', color: '#ddd', border: '1px solid #444',
            borderRadius: '8px', padding: '12px', zIndex: 100000, fontSize: '13px', boxShadow: '0 6px 20px rgba(0,0,0,.6)', maxHeight: '85vh', overflowY: 'auto',
        });
        document.body.appendChild(panel);
        refreshPanel();
    }
    window.cpTogglePanel = togglePanel;
    // "Calibrate" lives in Settings > Interface Settings; it sets this flag and returns here
    try {
        if (localStorage.getItem('cpOpenPanel') === '1') {
            localStorage.removeItem('cpOpenPanel');
            setTimeout(() => {
                if (!$('#video-container-card')) document.getElementById('vidIcon')?.click();
                setTimeout(() => { if (!$('#cpPanel')) togglePanel(); }, 900);
            }, 1200);
        }
    } catch { /* ignore */ }

    function refreshPanel() {
        const panel = $('#cpPanel');
        if (!panel) return;
        const cam = camKey();
        const c = getCal(cam);
        const t = track[cam];
        const names = Object.keys(POS[cam] || {}).sort();
        const opts = names.map(n => `<option value="${n}">${n}</option>`).join('');
        const btn = 'style="background:#3c3c3c;color:#fff;border:0;border-radius:4px;padding:5px 9px;cursor:pointer;margin:2px 2px 2px 0"';
        const inp = 'style="width:64px;background:#111;color:#fff;border:1px solid #444;border-radius:4px;padding:3px"';
        panel.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <b>Click-to-preset: ${selectedCamera}</b><span id="cpX" style="cursor:pointer">&times;</span></div>
            <div style="opacity:.75;margin-bottom:8px">Nothing here is sent to chat. Only a click in "Click Preset" mode sends a normal <code>!ptzload</code>.</div>
            <div>Tracked position: <b>${t ? t.preset + ' (' + t.pan.toFixed(1) + ', ' + t.tilt.toFixed(1) + ', z' + t.zoom + ')' : 'unknown'}</b></div>
            <div style="margin:4px 0 8px">Camera is at preset: <select id="cpSetSel">${opts}</select>
                <button id="cpSet" ${btn}>Set</button></div>
            <label><input type="checkbox" id="cpPrev" ${previewOnly ? 'checked' : ''}> Preview only (never load, just show)</label>
            <hr style="border-color:#333">
            <div>Field of view, zoomed out: <input id="cpF0" ${inp} value="${c.F0}"> deg</div>
            <div style="margin-top:4px">Zoom scale: <input id="cpZK" ${inp} value="${c.ZK}"> <span style="opacity:.6">(smaller = zooms tighter)</span></div>
            <div style="margin:6px 0"><button id="cpSaveFov" ${btn}>Save values</button><button id="cpReset" ${btn}>Reset</button></div>
            <hr style="border-color:#333">
            <div><b>Calibration samples: ${c.samples.length}</b></div>
            ${calStep === null ? `<button id="cpAdd" ${btn}>Add sample</button>` : ''}
            ${calStep === 'click' ? `<div style="color:#8fd">Step 1: click a landmark in the video.</div><button id="cpCancel" ${btn}>Cancel</button>` : ''}
            ${calStep === 'choose' ? `<div style="color:#8fd;margin-bottom:4px">Step 2: which preset points at that landmark?</div>
                <select id="cpPick">${opts}</select><button id="cpSave" ${btn}>Save</button><button id="cpCancel" ${btn}>Cancel</button>` : ''}
            <div id="cpSamples" style="margin-top:6px;max-height:110px;overflow:auto">${c.samples.map((s, i) => `<div>${i + 1}. ${s.name} z${s.pc[2]} <span data-del="${i}" style="cursor:pointer;color:#e88">remove</span></div>`).join('')}</div>
            <div style="opacity:.65;margin-top:6px">Tip: take 3 or 4 samples at zoomed-out presets spread across the frame, then 1 or 2 at a zoomed-in preset.</div>`;
        const on = (id, fn) => { const el = $('#' + id, panel); if (el) el.onclick = fn; };
        on('cpX', () => { panel.remove(); calStep = null; syncButtons(); });
        if (t && names.includes(t.preset)) $('#cpSetSel', panel).value = t.preset;
        on('cpSet', () => {
            const n = $('#cpSetSel', panel).value, v = POS[cam][n];
            track[cam] = { preset: n, pan: v[0], tilt: v[1], zoom: v[2] }; saveTrack(); refreshPanel();
        });
        $('#cpPrev', panel).onchange = (e) => { previewOnly = e.target.checked; LS.set('cpPreview', previewOnly); };
        on('cpSaveFov', () => {
            const F0 = parseFloat($('#cpF0', panel).value), ZK = parseFloat($('#cpZK', panel).value);
            if (F0 > 1 && F0 < 180 && ZK > 10) { cal[cam] = Object.assign(getCal(cam), { F0, ZK }); saveCal(); refreshPanel(); }
        });
        on('cpReset', () => { delete cal[cam]; saveCal(); refreshPanel(); });
        on('cpAdd', () => {
            if (!track[cam]) { alert('Set the camera position first ("Camera is at preset").'); return; }
            calStep = 'click'; syncButtons(); refreshPanel();
        });
        on('cpCancel', () => { calStep = null; pendingClick = null; syncButtons(); refreshPanel(); });
        on('cpSave', () => {
            const n = $('#cpPick', panel).value, v = POS[cam][n];
            if (!pendingClick || !v) return;
            const cc = getCal(cam);
            cc.samples.push({ x: pendingClick.x, y: pendingClick.y, pc: pendingClick.pc, tp: v[0], tt: v[1], name: n });
            cal[cam] = cc; refit(cam);
            calStep = null; pendingClick = null; syncButtons(); refreshPanel();
        });
        panel.querySelectorAll('[data-del]').forEach(el => el.onclick = () => {
            const cc = getCal(cam); cc.samples.splice(+el.dataset.del, 1); cal[cam] = cc; refit(cam); refreshPanel();
        });
    }
    // keep the panel in sync when the camera changes
    document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('.camera-button')) setTimeout(refreshPanel, 50); });

    // Esc turns the mode off
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && (modeOn || calStep)) { modeOn = false; calStep = null; LS.set('cpModeOn', false); syncButtons(); refreshPanel(); }
    });

    // exposed for tests
    window.__cp = { fovAt, getCal, nearest, targetFor, track: () => track, POS: () => POS, refit, slotRects };
})();
