/*
 * preset-shot.js  (loads after slots-pano.js)
 * Screenshot button: saves what the selected camera is showing in its slot (stream slots 2 to 6) as that
 * camera's preset thumbnail, button-img/<camera>/<preset>.png.
 *
 * Manual only. Nothing is sent to chat. Load the preset, click the button.
 *  - The preset name is the last "!ptzload <cam> <preset>" this app sent for the selected camera.
 *  - Shift+click (or when no preset is known) asks for the preset name instead.
 *  - The first click asks the browser to share this tab (pick "This tab"). The permission is kept until
 *    you stop sharing, so later clicks are one click.
 */
(() => {
    'use strict';
    const $ = (s, r = document) => r.querySelector(s);
    const lastLoad = {};   // camera (lowercase) -> preset name
    let stream = null, vid = null, busy = false;

    // remember the last preset loaded per camera (observes only, forwards the command untouched)
    const prevSend = window.sendCommand;
    window.sendCommand = function (command) {
        try {
            const m = /^!ptzload\s+(\S+)\s+(\S+)/i.exec(String(command || '').trim());
            if (m) lastLoad[m[1].toLowerCase()] = m[2];
        } catch { /* never break sending */ }
        return prevSend.apply(this, arguments);
    };

    function note(text, ok = true) {
        $('#shotNote')?.remove();
        const t = document.createElement('div');
        t.id = 'shotNote'; t.textContent = text;
        Object.assign(t.style, {
            position: 'fixed', left: '50%', top: '70px', transform: 'translateX(-50%)', zIndex: 100020, maxWidth: '80vw',
            background: ok ? 'rgba(21,101,192,.96)' : 'rgba(170,40,40,.96)', color: '#fff', padding: '8px 14px', borderRadius: '7px',
            fontSize: '14px', boxShadow: '0 4px 14px rgba(0,0,0,.5)', pointerEvents: 'none',
        });
        document.body.appendChild(t);
        setTimeout(() => t.remove(), ok ? 2200 : 4200);
    }

    // ------------------------------------------------------------------ which slot is the selected camera in
    function slotOfSelected() {
        const cam = typeof selectedCamera !== 'undefined' ? selectedCamera : '';
        if (!cam) return { err: 'Select a camera first' };
        const S = window.__slots;
        if (!S) return { err: 'Slots are not ready yet' };
        let big = false;
        for (let g = 1; g <= 6; g++) {
            const c = S.camFor(g);
            if (c && String(c).toLowerCase() === String(cam).toLowerCase()) {
                if (g === 6) big = true; else return { cam, geo: g };
            }
        }
        return { err: big ? `${cam} is in the big slot. Swap it into slot 2 to 6 first.` : `${cam} is not in slots 2 to 6. Swap it in and click Scenecams to sync.` };
    }

    // ------------------------------------------------------------------ screen capture of this tab
    async function getVideo() {
        const live = stream && stream.getVideoTracks().some(t => t.readyState === 'live');
        if (live && vid) return vid;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) throw new Error('This browser cannot capture the tab');
        stream = await navigator.mediaDevices.getDisplayMedia({
            video: { displaySurface: 'browser' }, audio: false,
            preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude',
        });
        const track = stream.getVideoTracks()[0];
        const kind = track.getSettings && track.getSettings().displaySurface;
        if (kind && kind !== 'browser') {
            stream.getTracks().forEach(t => t.stop()); stream = null;
            throw new Error('Pick "This tab" (not a window or screen) in the share prompt');
        }
        track.addEventListener('ended', () => { stream = null; vid?.remove(); vid = null; });
        vid = document.createElement('video');
        vid.muted = true; vid.playsInline = true; vid.srcObject = stream;
        vid.style.cssText = 'position:fixed;left:-9999px;top:0;width:4px;height:4px;opacity:0;pointer-events:none';
        document.body.appendChild(vid);
        await vid.play();
        await new Promise(r => setTimeout(r, 400));   // let the first frames arrive
        return vid;
    }

    async function grab(geo) {
        const f = $('#twitchIframe');
        if (!f || !window.__cp) throw new Error('Open the video view first');
        const v = await getVideo();
        // hide everything drawn over the stream (grid, highlight, overlays, tooltips) for the shot
        const st = document.createElement('style');
        st.id = 'shotHide';
        st.textContent = '#video-container > :not(iframe){visibility:hidden !important}.button-container .tbicon::after{display:none !important}#slotToast,#slotMenu,#cpMenu,#shotNote{visibility:hidden !important}';
        document.head.appendChild(st);
        try {
            await new Promise(r => setTimeout(r, 380));
            const r = window.__cp.slotRects(f)[geo - 1];
            const kx = v.videoWidth / innerWidth, ky = v.videoHeight / innerHeight;
            if (!v.videoWidth || Math.abs(kx - ky) / kx > 0.04) throw new Error('Capture size does not match the page. Stop sharing and try again.');
            const c = document.createElement('canvas');
            c.width = 640; c.height = 360;
            const x = c.getContext('2d');
            x.drawImage(v, r.left * kx, r.top * ky, r.width * kx, r.height * ky, 0, 0, 640, 360);
            // blank frame check
            const d = x.getImageData(0, 0, 640, 360).data;
            let sum = 0, n = 0;
            for (let i = 0; i < d.length; i += 4 * 97) { sum += d[i] + d[i + 1] + d[i + 2]; n++; }
            if (sum / n < 6) throw new Error('The captured frame is black. Is the stream playing?');
            return c.toDataURL('image/jpeg', 0.88);
        } finally {
            st.remove();
        }
    }

    // ------------------------------------------------------------------ save
    async function save(cam, preset, image) {
        const dir = typeof thumbDir === 'function' ? thumbDir(cam) : String(cam).toLowerCase();
        const r = await fetch('/save-thumbnail', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dir, preset, image }) });
        if (!r.ok) throw new Error('Could not save (' + ((await r.json().catch(() => ({}))).error || r.status) + ')');
        // refresh any thumbnail already on screen for this preset
        const needle = `button-img/${dir}/${preset}.png`;
        document.querySelectorAll('img').forEach(im => {
            const s = im.getAttribute('src') || '';
            if (s.split('?')[0].endsWith(needle)) {
                im.style.filter = ''; im.style.backgroundColor = '';
                im.src = `./${needle}?t=${Date.now()}`;
            }
        });
        return `${dir}/${preset}`;
    }

    function askPreset(cam, def) {
        return new Promise((resolve) => {
            const ov = document.createElement('div');
            Object.assign(ov.style, { position: 'fixed', inset: '0', background: 'rgba(0,0,0,.6)', zIndex: 100010, display: 'flex', alignItems: 'center', justifyContent: 'center' });
            const box = document.createElement('div');
            Object.assign(box.style, { background: '#1c1c1c', color: '#eee', border: '1px solid #444', borderRadius: '10px', padding: '18px 20px', width: '340px', fontSize: '14px', boxShadow: '0 10px 30px rgba(0,0,0,.7)' });
            const list = (typeof camerasData !== 'undefined' && camerasData?.cameras?.find(c => c.name === cam)?.presets) || [];
            box.innerHTML = `<div style="margin-bottom:10px">Save screenshot as which <b>${cam}</b> preset?</div>
                <input id="shotName" list="shotList" autocomplete="off" style="width:100%;box-sizing:border-box;padding:7px 9px;border-radius:6px;border:1px solid #555;background:#111;color:#fff;font-size:14px">
                <datalist id="shotList">${list.map(p => `<option value="${p}"></option>`).join('')}</datalist>
                <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
                <button id="shotOk" style="background:#1565c0;color:#fff;border:0;border-radius:6px;padding:6px 18px;cursor:pointer">Save</button>
                <button id="shotCancel" style="background:#3c3c3c;color:#fff;border:0;border-radius:6px;padding:6px 18px;cursor:pointer">Cancel</button></div>`;
            ov.appendChild(box); document.body.appendChild(ov);
            const inp = box.querySelector('#shotName'); inp.value = def || ''; inp.focus(); inp.select();
            const done = (v) => { ov.remove(); resolve(v); };
            box.querySelector('#shotOk').onclick = () => done(inp.value.trim());
            box.querySelector('#shotCancel').onclick = () => done(null);
            inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(inp.value.trim()); if (e.key === 'Escape') done(null); });
            ov.addEventListener('mousedown', (e) => { if (e.target === ov) done(null); });
        });
    }

    async function onShot(e) {
        if (busy) return;
        const where = slotOfSelected();
        if (where.err) return note(where.err, false);
        busy = true;
        try {
            let preset = lastLoad[where.cam.toLowerCase()];
            if (!preset || e.shiftKey) {
                preset = await askPreset(where.cam, preset);
                if (!preset) return;
            }
            if (!/^[A-Za-z0-9_-]{1,60}$/.test(preset)) throw new Error('Preset names can only use letters, numbers, - and _');
            const image = await grab(where.geo);
            const saved = await save(where.cam, preset, image);
            note(`Saved thumbnail: ${saved}`);
        } catch (err) {
            note(err && err.name === 'NotAllowedError' ? 'Screen share was cancelled' : (err.message || String(err)), false);
        } finally {
            busy = false;
        }
    }

    // ------------------------------------------------------------------ toolbar button
    function ensureButton() {
        const bar = $('#video-container-card .button-container');
        if (!bar || $('#shotBtn')) return;
        const b = document.createElement('button');
        b.id = 'shotBtn'; b.className = 'vidbutton tbicon'; b.textContent = 'Screenshot';
        b.dataset.tb = 'presetshot'; b.dataset.tip = 'Preset Screenshot (Slots 2-6)'; b.setAttribute('aria-label', 'Preset Screenshot');
        b.style.setProperty('--ic', 'url(img/tb/presetshot.png)');
        b.addEventListener('click', onShot);
        bar.appendChild(b);
    }
    new MutationObserver(ensureButton).observe(document.body, { childList: true, subtree: true });
    ensureButton();
})();
