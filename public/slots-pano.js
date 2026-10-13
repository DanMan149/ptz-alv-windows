/*
 * slots-pano.js  (loads after click-preset.js)
 *  1. Middle click a stream slot  -> selects the camera that is in that slot.
 *  2. Right click a stream slot   -> zoom menu for the camera in that slot.
 *  3. Pano button                 -> map of all presets for a camera, click one to load it.
 *
 * Chat safety: nothing here sends anything on its own. Middle click only selects a camera in the UI.
 * The zoom menu sends a normal "!ptzzoom cam n" only when you pick a value. Pano sends a normal
 * "!ptzload cam preset" only when you click a preset. Slot learning just reads chat.
 */
(() => {
    'use strict';
    const $ = (s, r = document) => r.querySelector(s);
    const LS = {
        get(k) { try { return localStorage.getItem(k); } catch { return null; } },
        set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
    };
    const jget = (k, d) => { try { return JSON.parse(LS.get(k)) ?? d; } catch { return d; } };

    // ------------------------------------------------------------------ slot knowledge
    // Slots are numbered by position on the stream: 1-3 left column (top to bottom), 4-5 bottom row, 6 = big main.
    // The chat bot numbers them differently (its 1 = big main), so we keep a geo -> bot number map too.
    let slotCam = jget('slotCams', {});                                     // geo -> camera (lowercase)
    const botNum = { 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 1 };                 // screen position -> bot slot number (1 = big main, 2 top left, 3 below it, 4 bottom left, 5 bottom middle, 6 bottom right)
    let lastClick = null;
    const saveSlots = () => { LS.set('slotCams', JSON.stringify(slotCam)); };

    const geoOfXY = (x, y) => {
        if (x >= 640 && y < 720) return 6;
        if (x < 640) return y < 360 ? 1 : y < 720 ? 2 : 3;
        return x < 1280 ? 4 : 5;
    };
    const geoOfBot = (n) => Object.keys(botNum).find(g => +botNum[g] === +n);

    const prevSend = window.sendCommand;
    window.sendCommand = function (command) {
        try { observe(String(command || '')); } catch { /* never break sending */ }
        return prevSend.apply(this, arguments);
    };
    // The bot confirms every swap in chat: "Swapped fox(6) toastcrunch(6)". We learn from that line only,
    // so a failed swap never changes the map. Numbers are the bot's slot numbers.
    let ownSwapAt = 0;
    function handleSwapReply(text) {
        const r = /swapped\s+([a-z0-9_]+)\((\d)\)\s+([a-z0-9_]+)\((\d)\)/i.exec(text);
        if (!r) return false;
        const A = r[1].toLowerCase(), B = r[3].toLowerCase(), gn = geoOfBot(r[2]), gm = geoOfBot(r[4]);
        if (!gn || !gm) return true;
        const rA = resolveCam(A), rB = resolveCam(B);
        const is = (g, name, rn) => slotCam[g] && (clean(slotCam[g]) === clean(name) || (rn && resolveCam(slotCam[g]) === rn));
        let incoming = null;
        if (gn === gm) {
            // an off-stream camera took over slot n; the one that was there (or the selected one) went off
            if (is(gn, A, rA)) { slotCam[gn] = B; incoming = rB; }
            else if (is(gn, B, rB)) { slotCam[gn] = A; incoming = rA; }
            else {
                // map didn't know the old camera: the one still unknown is the new one (second name is usually it)
                const aElsewhere = Object.keys(slotCam).some(g => g !== String(gn) && is(g, A, rA));
                const bElsewhere = Object.keys(slotCam).some(g => g !== String(gn) && is(g, B, rB));
                if (aElsewhere && !bElsewhere) { slotCam[gn] = B; incoming = rB; }
                else if (bElsewhere && !aElsewhere) { slotCam[gn] = A; incoming = rA; }
                else { slotCam[gn] = B; incoming = rB; }
            }
        } else {
            // two on-stream cameras traded places
            if (is(gn, A, rA) || is(gm, B, rB)) { slotCam[gm] = A; slotCam[gn] = B; }
            else { slotCam[gn] = A; slotCam[gm] = B; }
        }
        saveSlots();
        if (Date.now() - ownSwapAt < 20000) {
            // follow my own swap: if the selected camera was one of the two, select the other one
            const sel = resolveCam(selectedCamera);
            const other = sel && sel === rA ? rB : sel && sel === rB ? rA : null;
            if (other) setTimeout(() => selectCamera(other), 0);
            ownSwapAt = 0;
        }
        return true;
    }
    function observe(cmd) {
        const p = cmd.trim().split(/\s+/), name = (p[0] || '').toLowerCase();
        if (name === '!ptzclick' && !isNaN(+p[1]) && !isNaN(+p[2])) {
            lastClick = { geo: geoOfXY(+p[1], +p[2]), t: Date.now() };
        } else if (name === '!swap' && p[1] && p[2]) {
            ownSwapAt = Date.now();
        }
    }

    // ------------------------------------------------------------------ chat watching (read only)
    let me = '';
    fetch('/status').then(r => r.json()).then(j => { me = clean(j.username); }).catch(() => { });
    try {
        const es = new EventSource('/chat-stream');
        es.onmessage = (ev) => {
            try {
                const m = JSON.parse(ev.data);
                if (m.system || !m.text) return;
                if (!(m.ts && Date.now() - m.ts > 120000) && handleSwapReply(m.text)) return;
                onSceneReply(m);
                onChatCommand(m);
                if (!lastClick || Date.now() - lastClick.t > 30000) return;
                const r = /click on (\d)\s*:\s*([a-z0-9_]+)/i.exec(m.text);
                if (!r) return;
                slotCam[lastClick.geo] = r[2].toLowerCase();
                lastClick = null; saveSlots();
            } catch { /* ignore */ }
        };
    } catch { /* ignore */ }

    // Someone else (mod, bot, viewer) changed the scene: swap or a scene command like !toastcam.
    const FRESH = 10 * 60 * 1000;
    function onChatCommand(m) {
        if (clean(m.user) === me || (m.ts && Date.now() - m.ts > 60000)) return;   // our own commands are handled in observe()
        const t = String(m.text).trim();
        if (t[0] !== '!') return;
        const w = t.slice(1).split(/\s+/), cmd = clean(w[0]);
        if (cmd === 'swap') return;   // the bot's "Swapped a(n) b(n)" reply tells us what really happened
        else if (cmd === 'swapcam' || cmd === 'resetcam' || cmd === 'resetlivecam' || cmd === 'resetlivecams') scheduleAutoSync();
        else if (/cam\d*$/.test(cmd) && ALIASES[norm(cmd)]) scheduleAutoSync();
    }

    // Auto sync: after a scene change is seen, re-run !scenecams once (debounced, at most once per 15 s).
    let autoSync = LS.get('slotAutoSync') !== 'false', autoTimer = null, lastAuto = 0;
    function scheduleAutoSync() {
        if (!autoSync) { markStale(true); return; }
        clearTimeout(autoTimer);
        autoTimer = setTimeout(() => {
            if (Date.now() - lastAuto < 15000) return;
            lastAuto = Date.now();
            syncSlots();
        }, 5000);
    }
    function markStale(on) { const b = $('#syncBtn'); if (b) b.style.outline = on ? '2px solid #e6a23c' : ''; }

    // Sync: sends !scenecams and reads the bot reply (e.g. "1: wolf, 2: pasture ...") to fill the slot map.
    let syncAt = 0, syncTimer = null;
    function parseScene(text) {
        const out = {};
        const re = /(?:slot\s*)?\b([1-6])\s*[:=\-–>)]+\s*([A-Za-z0-9_]+)/gi;
        let m;
        while ((m = re.exec(text))) { const g = geoOfBot(m[1]); if (g) out[g] = m[2].toLowerCase(); }
        return out;
    }
    function syncSlots() {
        syncAt = Date.now();
        setSyncLabel('Syncing...');
        clearTimeout(syncTimer);
        syncTimer = setTimeout(() => { if (syncAt) { syncAt = 0; setSyncLabel('Sync Slots'); const b = $('#syncBtn'); if (b) b.title = 'No readable !scenecams reply yet'; } }, 20000);
        sendCommand('!scenecams');
    }
    function setSyncLabel(t) { const b = $('#syncBtn'); if (b) b.textContent = t; }
    function onSceneReply(m) {
        if (!m.text || /^\s*!/.test(m.text)) return;
        const found = parseScene(m.text);
        const n = Object.keys(found).length;
        // accept our own sync reply, or anyone's !scenecams reply ("... Cams: 1: x, 2: y ...")
        const passive = n >= 3 && /cams?\s*:\s*1\s*:/i.test(m.text) && (!m.ts || Date.now() - m.ts < 60000);
        const mineWaiting = syncAt && n >= 1 && (!m.ts || m.ts >= syncAt - 2000);
        if (!passive && !mineWaiting) return;
        slotCam = found; saveSlots();
        window.__slots.lastSync = m.text;
        markStale(false);
        if (syncAt) {
            syncAt = 0; clearTimeout(syncTimer);
            setSyncLabel('Synced ✓');
            setTimeout(() => setSyncLabel('Sync Slots'), 2500);
        }
    }

    // ------------------------------------------------------------------ helpers
    const cp = () => window.__cp;
    const camNames = () => (typeof camerasData !== 'undefined' && camerasData?.cameras ? camerasData.cameras.map(c => c.name) : []);
    // Cameras have several names (parrot = parrots = littles). Resolve any of them to the app's camera.
    let ALIASES = {};   // normalized alias -> app camera (lowercase), from cam-aliases.json (generated from the bot config)
    fetch('cam-aliases.json').then(r => r.json()).then(d => { ALIASES = d.aliases || {}; }).catch(() => { });
    let userAlias = jget('camAliases', {});
    const clean = (n) => String(n || '').trim().toLowerCase();
    const norm = (n) => clean(n).replace(/[^a-z0-9]/g, '').replace(/(camera|cam)$/, '');
    function resolveCam(name) {
        const n = clean(name), nn = norm(name), list = (typeof camerasData !== 'undefined' && camerasData?.cameras) ? camerasData.cameras.map(c => c.name) : [];
        const find = (x) => list.find(c => clean(c) === clean(x));
        const hit = find(n) || find(userAlias[n]) || find(ALIASES[nn]) || find(ALIASES[n]);
        if (hit) return hit;
        const pre = list.filter(c => clean(c).startsWith(nn));
        return nn && pre.length === 1 ? pre[0] : null;
    }
    // scroll the camera list so the selected camera is visible (centred in the list)
    function showSelectedInList() {
        const el = $('.camera-button.selected');
        if (!el) return;
        let p = el.parentElement;
        while (p && p !== document.body) {
            const oy = getComputedStyle(p).overflowY;
            if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 2) {
                const pr = p.getBoundingClientRect(), er = el.getBoundingClientRect();
                p.scrollTo({ top: p.scrollTop + (er.top - pr.top) - (pr.height - er.height) / 2, behavior: 'auto' });
                return;
            }
            p = p.parentElement;
        }
    }
    function selectByName(cam) {
        const c = resolveCam(cam);
        if (c) { selectCamera(c); setTimeout(showSelectedInList, 60); setTimeout(showSelectedInList, 450); return true; }
        return false;
    }
    function toast(text, x, y, ok = true) {
        $('#slotToast')?.remove();
        const t = document.createElement('div');
        t.id = 'slotToast'; t.textContent = text;
        Object.assign(t.style, {
            position: 'fixed', left: Math.min(x + 12, innerWidth - 260) + 'px', top: Math.max(8, y - 36) + 'px', zIndex: 100005,
            background: ok ? 'rgba(21,101,192,.95)' : 'rgba(170,40,40,.95)', color: '#fff', padding: '6px 10px', borderRadius: '6px', fontSize: '13px', pointerEvents: 'none',
        });
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 1800);
    }
    function closeMenu() { $('#slotMenu')?.remove(); }
    function menuBox(x, y, width = 190) {
        closeMenu();
        const m = document.createElement('div');
        m.id = 'slotMenu';
        Object.assign(m.style, {
            position: 'fixed', left: x + 'px', top: y + 'px', zIndex: 100004, background: '#1c1c1c', color: '#ddd', border: '1px solid #555',
            borderRadius: '8px', padding: '8px', fontSize: '13px', width: width + 'px', boxShadow: '0 6px 20px rgba(0,0,0,.6)', maxHeight: '80vh', overflowY: 'auto',
        });
        document.body.appendChild(m);
        const place = () => {
            const r = m.getBoundingClientRect();
            m.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
            m.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
        };
        setTimeout(() => {
            place();
            document.addEventListener('mousedown', function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', off, true); } }, true);
        }, 0);
        return m;
    }
    const btnCss = 'background:#3c3c3c;color:#fff;border:0;border-radius:4px;padding:5px 8px;cursor:pointer;margin:2px;font-size:13px';

    function chooseCam(geo, x, y, done, title) {
        const m = menuBox(x, y, 230);
        m.innerHTML = `<div style="margin-bottom:6px"><b>${title || `Which camera is in slot ${geo}?`}</b></div>`;
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;flex-wrap:wrap';
        camNames().slice().sort((a, b) => a.localeCompare(b)).forEach(n => {
            const b = document.createElement('button');
            b.style.cssText = btnCss; b.textContent = n;
            b.onclick = () => { slotCam[geo] = n.toLowerCase(); saveSlots(); closeMenu(); done(n.toLowerCase()); };
            wrap.appendChild(b);
        });
        m.appendChild(wrap);
    }

    // ------------------------------------------------------------------ mouse handling over the stream
    function ensureOverlay() {
        const vc = $('#video-container');
        if (vc && !$('#slotOverlay')) {
            const ov = document.createElement('div');
            ov.id = 'slotOverlay';
            Object.assign(ov.style, { position: 'absolute', inset: '0', zIndex: 1 });
            vc.appendChild(ov);
        }
    }
    const inVideo = (e) => !!(e.target && e.target.closest && e.target.closest('#video-container') &&
        !e.target.closest('#cpPanel,#cpMenu,#slotMenu,#panoModal,.button-container'));
    function geoAt(e) {
        const f = $('#twitchIframe');
        if (!f || !cp()) return null;
        const i = cp().slotRects(f).findIndex(b => e.clientX >= b.left && e.clientX <= b.left + b.width && e.clientY >= b.top && e.clientY <= b.top + b.height);
        return i < 0 ? null : i + 1;
    }
    function onMiddle(e) {
        const g = geoAt(e);
        if (!g) return;
        const cam = slotCam[g];
        const pick = (c) => { const ok = selectByName(c); toast(ok ? `${resolveCam(c)} selected` : `${c} not in camera list`, e.clientX, e.clientY, ok); };
        if (cam && !e.shiftKey) {
            if (resolveCam(cam)) pick(cam);
            else chooseCam(g, e.clientX, e.clientY, (c) => { userAlias[clean(cam)] = clean(c); LS.set('camAliases', JSON.stringify(userAlias)); slotCam[g] = clean(c); saveSlots(); pick(c); }, `Slot ${g} says "${cam}". Which camera is that?`);
        } else chooseCam(g, e.clientX, e.clientY, pick);
    }
    function onRight(e) {
        const g = geoAt(e);
        if (!g) return;
        const go = (cam) => zoomMenu(resolveCam(cam) ? clean(resolveCam(cam)) : cam, g, e.clientX, e.clientY);
        const cam = slotCam[g];
        if (cam && !e.shiftKey) {
            if (resolveCam(cam)) go(cam);
            else chooseCam(g, e.clientX, e.clientY, (c) => { userAlias[clean(cam)] = clean(c); LS.set('camAliases', JSON.stringify(userAlias)); slotCam[g] = clean(c); saveSlots(); go(c); }, `Slot ${g} says "${cam}". Which camera is that?`);
        } else chooseCam(g, e.clientX, e.clientY, go);
    }
    function zoomMenu(cam, g, x, y) {
        const m = menuBox(x, y, 250);
        m.style.overflowY = 'visible';
        m.innerHTML = `<div style="display:flex;gap:10px"><div id="zmCol" style="flex:1"></div><div id="fcCol" style="flex:1"></div></div>`;
        const send = (cmd) => { closeMenu(); sendCommand(cmd); };
        const col = (id, title, vals, fmt, cmd) => {
            const c = $(id, m);
            c.innerHTML = `<div style="font-weight:600;margin-bottom:4px">${title}</div>`;
            const box = document.createElement('div');
            box.style.cssText = 'border:1px solid #444;border-radius:6px;background:#111';
            vals.forEach(v => {
                const b = document.createElement('div');
                b.textContent = fmt(v);
                b.style.cssText = 'padding:6px 10px;cursor:pointer;text-align:center';
                b.onmouseenter = () => { b.style.background = '#2e7d32'; }; b.onmouseleave = () => { b.style.background = ''; };
                b.onclick = () => send(cmd(v));
                box.appendChild(b);
            });
            c.appendChild(box);
        };
        col('#zmCol', `Zoom ${cam}`, [10, 50, 70, 90, 125, 150, 200, 400, 600], v => v + '%', v => `!ptzzoom ${cam} ${v}`);
        col('#fcCol', 'Focus', [-1000, -500, -300, -200, -100, -50, 50, 100, 200, 300, 500, 1000], v => String(v), v => `!ptzfocus ${cam} ${v}`);
    }
    const block = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
    window.addEventListener('mousedown', (e) => { if ((e.button === 1 || e.button === 2) && inVideo(e)) { block(e); if (e.button === 1) onMiddle(e); } }, true);
    window.addEventListener('mouseup', (e) => { if ((e.button === 1 || e.button === 2) && inVideo(e)) block(e); }, true);
    window.addEventListener('auxclick', (e) => { if (inVideo(e)) block(e); }, true);
    window.addEventListener('contextmenu', (e) => { if (inVideo(e)) { block(e); onRight(e); } }, true);

    // ------------------------------------------------------------------ pano
    let POS = {};
    fetch('preset-positions.json').then(r => r.json()).then(d => { POS = d.cameras || {}; }).catch(() => { });
    const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

    function openPano(startCam) {
        $('#panoModal')?.remove(); $('#panoTip')?.remove();
        const cams = Object.keys(POS).filter(c => Object.keys(POS[c]).length).sort();
        if (!cams.length) { alert('Preset positions not loaded.'); return; }
        let cam = (startCam || String(selectedCamera).toLowerCase());
        if (!POS[cam]) cam = cams[0];
        const modal = document.createElement('div');
        modal.id = 'panoModal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:100003;background:#111;display:flex;flex-direction:column;color:#ddd;font-size:13px';
        modal.innerHTML = `
          <div style="display:flex;align-items:center;gap:14px;padding:10px 16px;background:#161616;border-bottom:1px solid #333;flex-wrap:wrap">
            <b style="font-size:15px">Pano</b>
            <select id="panoCam" style="background:#111;color:#fff;border:1px solid #444;border-radius:4px;padding:3px">${cams.map(c => `<option value="${c}">${c}</option>`).join('')}</select>
            <label>Spread <input id="panoSize" type="range" min="3" max="40" step="0.5" style="vertical-align:middle;width:160px"></label>
            <span style="opacity:.65">Hover for a preview, click to load. Esc closes.</span>
            <span id="panoX" style="margin-left:auto;font-size:26px;cursor:pointer;line-height:1">&times;</span>
          </div>
          <div id="panoScroll" style="flex:1;overflow:auto;position:relative;background:#111"><div id="panoCanvas" style="position:relative"></div></div>`;
        document.body.appendChild(modal);
        const sel = $('#panoCam', modal), size = $('#panoSize', modal);
        sel.value = cam;
        const tip = document.createElement('div');
        tip.id = 'panoTip';
        tip.style.cssText = 'position:fixed;z-index:100010;display:none;pointer-events:none;background:#000;border:1px solid #888;border-radius:6px;padding:4px;box-shadow:0 6px 20px rgba(0,0,0,.7);width:340px';
        document.body.appendChild(tip);
        const close = () => { modal.remove(); tip.remove(); document.removeEventListener('keydown', esc, true); };
        const esc = (e) => { if (e.key === 'Escape') close(); };
        document.addEventListener('keydown', esc, true);
        $('#panoX', modal).onclick = close;

        let ppd = parseFloat(LS.get('panoPpd')) || 0, autoFit = !ppd;
        const BH = 24;
        const measure = document.createElement('canvas').getContext('2d');
        measure.font = '13px sans-serif';
        function showTip(cur, name, v, ev) {
            tip.innerHTML = `<img src="button-img/${thumbDir(cur)}/${name}.png" style="width:100%;display:block;border-radius:3px" onerror="this.style.display='none'"><div style="padding:3px 4px;font-size:12px">${name} <span style="opacity:.6">pan ${v[0]}, tilt ${v[1]}, zoom ${v[2]}</span></div>`;
            tip.style.display = 'block';
            const w = 348, h = tip.offsetHeight || 220;
            let x = ev.clientX + 16, y = ev.clientY + 16;
            if (x + w > innerWidth - 8) x = ev.clientX - w - 16;
            if (y + h > innerHeight - 8) y = innerHeight - h - 8;
            tip.style.left = Math.max(8, x) + 'px'; tip.style.top = Math.max(8, y) + 'px';
        }
        function render() {
            const canvas = $('#panoCanvas', modal), scroller = $('#panoScroll', modal);
            canvas.innerHTML = '';
            const cur = sel.value;
            const entries = Object.entries(POS[cur]);
            // seam: start after the largest gap between sorted pans
            const pans = entries.map(([, v]) => v[0]).sort((a, b) => a - b);
            let origin = pans[0], best = -1;
            for (let i = 0; i < pans.length; i++) {
                const nxt = pans[(i + 1) % pans.length] + (i + 1 === pans.length ? 360 : 0);
                if (nxt - pans[i] > best) { best = nxt - pans[i]; origin = pans[(i + 1) % pans.length]; }
            }
            if (pans.length === 1) origin = pans[0];
            const rel = (p) => ((((p - origin) % 360) + 360) % 360);
            const tilts = entries.map(([, v]) => v[1]);
            const maxT = Math.max(...tilts), minT = Math.min(...tilts);
            const span = Math.max(...entries.map(([, v]) => rel(v[0])), 1);
            const PAD = 70;
            if (autoFit) { ppd = Math.max(3, Math.min(40, (scroller.clientWidth - PAD * 2) / span)); }
            size.value = ppd;
            const items = entries.map(([name, v]) => ({
                name, v, x: PAD + rel(v[0]) * ppd, y: PAD + (maxT - v[1]) * ppd,
                w: Math.ceil(measure.measureText(name).width) + 18, h: BH,
            }));
            // de-overlap: place each button at the free spot nearest its true position (wide shots first)
            const placed = [];
            const hit = (r) => placed.some(p => r.l < p.l + p.w + 3 && r.l + r.w + 3 > p.l && r.t < p.t + p.h + 3 && r.t + r.h + 3 > p.t);
            items.sort((a, b) => b.v[2] - a.v[2]);
            items.forEach(it => {
                let r = { l: it.x - it.w / 2, t: it.y - it.h / 2, w: it.w, h: it.h };
                if (hit(r)) {
                    let found = false;
                    for (let k = 1; k < 80 && !found; k++) {
                        const step = k * 14;
                        for (let a = 0; a < 16 && !found; a++) {
                            const ang = (a / 16) * Math.PI * 2;
                            const c = { l: it.x - it.w / 2 + Math.cos(ang) * step * 1.4, t: it.y - it.h / 2 + Math.sin(ang) * step * 0.7, w: it.w, h: it.h };
                            if (c.l >= 4 && c.t >= 4 && !hit(c)) { r = c; found = true; }
                        }
                    }
                }
                it.r = r; placed.push(r);
            });
            const W = Math.ceil(Math.max(...placed.map(p => p.l + p.w)) + PAD), H = Math.ceil(Math.max(...placed.map(p => p.t + p.h)) + PAD);
            canvas.style.width = Math.max(W, scroller.clientWidth - 2) + 'px'; canvas.style.height = Math.max(H, 200) + 'px';
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', canvas.style.width.replace('px', '')); svg.setAttribute('height', canvas.style.height.replace('px', ''));
            svg.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
            canvas.appendChild(svg);
            const NS = 'http://www.w3.org/2000/svg';
            const t0 = cp()?.track()[cur];
            items.forEach(it => {
                const cx = it.r.l + it.w / 2, cy = it.r.t + it.h / 2;
                if (Math.hypot(cx - it.x, cy - it.y) > 8) {
                    const ln = document.createElementNS(NS, 'line');
                    ln.setAttribute('x1', it.x); ln.setAttribute('y1', it.y); ln.setAttribute('x2', cx); ln.setAttribute('y2', cy);
                    ln.setAttribute('stroke', 'rgba(255,255,255,.18)'); svg.appendChild(ln);
                }
                const dot = document.createElementNS(NS, 'circle');
                dot.setAttribute('cx', it.x); dot.setAttribute('cy', it.y); dot.setAttribute('r', 2.5); dot.setAttribute('fill', 'rgba(255,255,255,.45)');
                svg.appendChild(dot);
            });
            items.forEach(it => {
                const b = document.createElement('button');
                b.textContent = it.name;
                b.dataset.preset = it.name;
                const tight = it.v[2] > 30;   // zoomed-in presets get a blue tint
                b.style.cssText = `position:absolute;left:${it.r.l}px;top:${it.r.t}px;width:${it.w}px;height:${it.h}px;box-sizing:border-box;border:1px solid ${tight ? '#3b6ea8' : '#555'};border-radius:5px;background:${tight ? '#1f3a5a' : '#2d2d2d'};color:#fff;font-size:13px;padding:0 4px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`;
                b.onmouseenter = (ev) => { b.style.background = '#2e7d32'; b.style.zIndex = 5; showTip(cur, it.name, it.v, ev); };
                b.onmousemove = (ev) => showTip(cur, it.name, it.v, ev);
                b.onmouseleave = () => { b.style.background = tight ? '#1f3a5a' : '#2d2d2d'; b.style.zIndex = ''; tip.style.display = 'none'; };
                b.onclick = () => { selectByName(cur); sendLoadCommand(cur, it.name); close(); };
                canvas.appendChild(b);
            });
            if (t0) {
                const r = rel(t0.pan);
                const ring = document.createElement('div');
                ring.title = 'tracked position';
                ring.style.cssText = `position:absolute;left:${PAD + r * ppd - 10}px;top:${PAD + (maxT - t0.tilt) * ppd - 10}px;width:20px;height:20px;border-radius:50%;border:3px solid #ff5252;pointer-events:none;z-index:6`;
                canvas.appendChild(ring);
            }
        }
        sel.onchange = () => { autoFit = !parseFloat(LS.get('panoPpd')); render(); };
        size.oninput = () => { ppd = parseFloat(size.value); autoFit = false; LS.set('panoPpd', ppd); render(); };
        render();
    }
    window.openPano = openPano;

    // ------------------------------------------------------------------ toolbar
    function ensureUi() {
        ensureOverlay();
        const bar = $('#video-container-card .button-container');
        if (bar && !$('#panoBtn')) {
            const b = document.createElement('button');
            b.id = 'panoBtn'; b.className = 'vidbutton'; b.textContent = 'Pano';
            b.addEventListener('click', () => openPano());
            bar.appendChild(b);
        }
        if (bar && !$('#syncBtn')) {
            const b = document.createElement('button');
            b.id = 'syncBtn'; b.className = 'vidbutton'; b.textContent = 'Sync Slots';
            b.title = 'Sends !scenecams and reads which camera is in which slot';
            b.addEventListener('click', syncSlots);
            bar.appendChild(b);
        }
        if (bar && !$('#autoSyncBtn')) {
            const b = document.createElement('button');
            b.id = 'autoSyncBtn'; b.className = 'vidbutton';
            const paint = () => { b.textContent = 'Auto Sync: ' + (autoSync ? 'On' : 'Off'); b.classList.toggle('highlighted', autoSync); };
            b.title = 'When a swap or scene command is seen in chat, re-run !scenecams automatically (max once per 15 s)';
            b.addEventListener('click', () => { autoSync = !autoSync; LS.set('slotAutoSync', autoSync); paint(); });
            paint();
            bar.appendChild(b);
        }
    }
    new MutationObserver(ensureUi).observe(document.body, { childList: true, subtree: true });
    ensureUi();

    // ------------------------------------------------------------------ Alt: swap within the camera group
    const GROUPS = [
        ['pasture', 'pasturel', 'pasturefeeder', 'garden'],
        ['wolf', 'wolfcorner', 'wolfindoor', 'wolfswitch', 'wolfden', 'wolfden2'],
        ['fox', 'foxc', 'foxin'],
        ['crowout', 'crowin'],
        ['marmout', 'marmin'],
        ['serval', 'servalin', 'servalc'],
        ['emu', 'emuc', 'emupond'],
        ['pushpop', 'pushc', 'pushin'],
        ['chin1', 'chin2', 'chin3'],
        ['parrots', 'macaws'],
        ['chicken', 'chickenin'],
        ['toast', 'toastcrunch'],
    ];
    const SWAP_NAME = { pushin: 'pushpopindoor', pushc: 'pushpopcrunch', parrots: 'parrot', chin1: 'chin' };   // names the bot expects when they differ from the app's
    const swapName = (n) => SWAP_NAME[clean(n)] || clean(n);
    // is camera g (a GROUPS key) on stream? Compare raw slot names first, then what they resolve to.
    function isLive(g, group) {
        const raws = Object.values(slotCam).map(clean);
        if (raws.includes(g) || raws.includes(swapName(g))) return true;
        const others = group.filter(o => o !== g).flatMap(o => [o, swapName(o)]);
        return raws.some(r => !others.includes(r) && clean(resolveCam(r) || '') === g);
    }
    const appName = (key) => (typeof camerasData !== 'undefined' && camerasData?.cameras ? camerasData.cameras.find(c => clean(c.name) === key)?.name : null) || key;
    function closeAlt() { $('#altMenu')?.remove(); document.removeEventListener('keydown', altKeys, true); document.removeEventListener('mousedown', altOutside, true); }
    const altOutside = (e) => { const m = $('#altMenu'); if (m && !m.contains(e.target)) closeAlt(); };
    const altKeys = (e) => {
        const m = $('#altMenu');
        if (!m) return;
        if (e.key === 'Escape') { e.preventDefault(); closeAlt(); return; }
        const b = /^[1-9]$/.test(e.key) && m.querySelectorAll('button')[+e.key - 1];
        if (b) { e.preventDefault(); e.stopImmediatePropagation(); b.click(); }
    };
    function openAltMenu(x, y) {
        const sel = clean(resolveCam(selectedCamera) || selectedCamera);
        const group = GROUPS.find(g => g.includes(sel));
        $('#altMenu')?.remove();
        const m = document.createElement('div');
        m.id = 'altMenu';
        Object.assign(m.style, {
            position: 'fixed', left: x + 'px', top: y + 'px', zIndex: 100006, background: '#1c1c1c', color: '#ddd', border: '1px solid #555',
            borderRadius: '8px', padding: '8px', fontSize: '13px', minWidth: '170px', boxShadow: '0 6px 20px rgba(0,0,0,.6)',
        });
        if (!group || group.length < 2) {
            m.innerHTML = `<div>No other cameras in the group of <b>${appName(sel)}</b></div>`;
        } else {
            // the camera to take off the stream: the selected one if it is live, else the group member that is
            const from = isLive(sel, group) ? sel : (group.find(g => isLive(g, group)) || sel);
            m.innerHTML = `<div style="margin-bottom:6px;opacity:.8">Swap <b>${appName(from)}</b> with:</div>`;
            group.filter(g => g !== from).forEach((g, i) => {
                const b = document.createElement('button');
                b.style.cssText = 'display:block;width:100%;text-align:left;background:#3c3c3c;color:#fff;border:0;border-radius:4px;padding:6px 10px;cursor:pointer;margin:3px 0;font-size:13px';
                b.innerHTML = `<span style="opacity:.55;margin-right:8px">${i + 1}</span>${appName(g)}${isLive(g, group) ? ' <span style="opacity:.55">(on stream)</span>' : ''}`;
                b.onmouseenter = () => { b.style.background = '#2e7d32'; }; b.onmouseleave = () => { b.style.background = '#3c3c3c'; };
                b.onclick = () => {
                    closeAlt();
                    sendCommand(`!swap ${swapName(from)} ${swapName(g)}`);
                    ownSwapAt = 0;                       // we select the new camera ourselves
                    selectByName(g);   // cameras that only exist for swapping (like pushc) are not selectable
                };
                m.appendChild(b);
            });
        }
        document.body.appendChild(m);
        const r = m.getBoundingClientRect();
        m.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
        m.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
        document.addEventListener('keydown', altKeys, true);
        setTimeout(() => document.addEventListener('mousedown', altOutside, true), 0);
    }
    let mx = innerWidth / 2, my = innerHeight / 2;
    document.addEventListener('mousemove', (e) => { mx = e.clientX; my = e.clientY; });
    // Hold Alt for a moment to open the menu (a quick tap is left alone). The ` key opens it too.
    let altTimer = null;
    const typing = () => /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
    document.addEventListener('keydown', (e) => {
        if (typing()) return;
        if (e.key === 'Alt' && !e.repeat && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
            e.preventDefault();
            clearTimeout(altTimer);
            altTimer = setTimeout(() => { if (!$('#altMenu')) openAltMenu(mx + 12, my + 12); }, 250);
        } else if (e.key === 'Alt') {
            e.preventDefault();
        } else if (e.key === '`' && !e.ctrlKey && !e.altKey && !e.metaKey) {
            e.preventDefault();
            if ($('#altMenu')) closeAlt(); else openAltMenu(mx + 12, my + 12);
        }
    });
    document.addEventListener('keyup', (e) => { if (e.key === 'Alt') { e.preventDefault(); clearTimeout(altTimer); } });
    window.addEventListener('blur', () => clearTimeout(altTimer));


    // ------------------------------------------------------------------ Alt + click on a slot: swap the selected camera with that slot's camera
    let altDown = false;
    document.addEventListener('keydown', (e) => { if (e.key === 'Alt') altDown = true; }, true);
    document.addEventListener('keyup', (e) => { if (e.key === 'Alt') altDown = false; }, true);
    window.addEventListener('blur', () => { altDown = false; });
    function altSwapClick(e) {
        const g = geoAt(e);
        if (!g) return;
        const from = clean(resolveCam(selectedCamera) || selectedCamera);
        const doSwap = () => {
            const gFrom = Object.keys(slotCam).find(k => clean(resolveCam(slotCam[k]) || slotCam[k]) === from);
            if (!gFrom) { toast(`${appName(from)} is not on stream (slot unknown)`, e.clientX, e.clientY, false); return; }
            if (+gFrom === +g) { toast('Same slot', e.clientX, e.clientY, false); return; }
            sendCommand(`!swap ${botNum[gFrom]} ${botNum[g]}`);
            ownSwapAt = 0;   // keep the selected camera selected
            toast(`Swapping slot ${botNum[gFrom]} with ${botNum[g]}`, e.clientX, e.clientY, true);
        };
        doSwap();
    }
    ['mousedown', 'mouseup', 'click'].forEach(t => window.addEventListener(t, (e) => {
        if (!altDown || e.button !== 0 || !inVideo(e) || e.target.closest('#altMenu')) return;
        block(e);
        if (t === 'mousedown') { clearTimeout(altTimer); closeAlt(); altSwapClick(e); }
    }, true));


    // ------------------------------------------------------------------ yellow box around the selected camera's slot
    function updateHighlight() {
        const vc = $('#video-container'), f = $('#twitchIframe');
        let h = $('#slotHighlight');
        if (!vc || !f || !f.clientWidth || !cp()) { if (h) h.style.display = 'none'; return; }
        const sel = clean(resolveCam(selectedCamera) || selectedCamera);
        const g = Object.keys(slotCam).find(k => clean(resolveCam(slotCam[k]) || slotCam[k]) === sel);
        if (!g) { if (h) h.style.display = 'none'; return; }
        const r = cp().slotRects(f)[g - 1], v = vc.getBoundingClientRect();
        if (!r) return;
        if (!h) {
            h = document.createElement('div');
            h.id = 'slotHighlight';
            h.style.cssText = 'position:absolute;box-sizing:border-box;border:3px solid #ffd400;box-shadow:0 0 8px rgba(255,212,0,.7);pointer-events:none;z-index:2';
            vc.appendChild(h);
        }
        h.style.display = 'block';
        h.style.left = (r.left - v.left) + 'px'; h.style.top = (r.top - v.top) + 'px';
        h.style.width = r.width + 'px'; h.style.height = r.height + 'px';
    }
    setInterval(updateHighlight, 300);
    window.addEventListener('resize', updateHighlight);

    window.__slots = { camFor: (g) => (slotCam[g] ? resolveCam(slotCam[g]) : null), handleSwapReply, onChatCommand, resolveCam, parseScene, slotCam: () => slotCam, botNum: () => botNum, geoOfXY };
})();
