/*
 * web-features.js
 * Ports the features of the ptz.app web UI onto the local Twitch-chat based backend.
 * Loaded after script.js. It overrides a handful of script.js globals and adds new widgets.
 * Commands are still sent through the local server (/send-command -> Twitch chat).
 */
(() => {
    'use strict';

    // ------------------------------------------------------------------ helpers
    const LS = {
        get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
        set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
        del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
    };
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const cam = () => String(window.selectedCameraName ? window.selectedCameraName() : selectedCamera).trim().toLowerCase();
    window.selectedCameraName = () => selectedCamera;
    const send = (c) => sendCommand(c);

    // ------------------------------------------------------------------ widgets
    const WIDGET_DEFAULTS = {
        ControlWidget: true, SwapWidget: true, SpinWidget: false, ZoomWidget: true,
        PTZWidget: true, FocusWidget: true, IRWidget: true, OtherWidget: true, TwitchChatWidget: true,
    };
    const WIDGET_IDS = {
        ControlWidget: 'directionpadContainer', SwapWidget: 'swapContainer', SpinWidget: 'spinContainer',
        ZoomWidget: 'zoomContainer', PTZWidget: 'ptz-Container', FocusWidget: 'focusContainer',
        IRWidget: 'irContainer', OtherWidget: 'otherContainer', TwitchChatWidget: 'twitchChatContainer',
    };
    const FULL_ONLY = new Set(['PTZWidget', 'IRWidget', 'SpinWidget']);
    const widgetOn = (k) => {
        const v = LS.get(k + 'CheckboxState');
        return v === null ? WIDGET_DEFAULTS[k] : v === 'true';
    };
    const fullPTZ = () => LS.get('fullPTZCheckboxState', 'true') === 'true';

    function applyWidgetVisibility() {
        const full = fullPTZ();
        for (const [key, id] of Object.entries(WIDGET_IDS)) {
            const el = document.getElementById(id);
            if (!el) continue;
            const show = widgetOn(key) && (!FULL_ONLY.has(key) || full);
            el.style.display = show ? 'block' : 'none';
        }
        const move = $('#movePadHeading');
        if (move) move.style.display = full ? '' : 'none';
        const vid = $('#vidIcon');
        if (vid) vid.style.display = full ? 'inline-block' : 'none';
        // if Move tab is gone, fall back to zoom
        if (!full && !$('.direction-pad').classList.contains('hidden')) {
            togglePad('.zoom-pad');
            setActiveHeading('.direction-zoom-heading');
        }
        const circle = $('#enablecriclespin');
        if (circle) circle.style.display = (full && LS.get('isSpinEnabled') === 'true') ? 'inline-block' : 'none';
        window.syncCustomPresetVisibility(full);
    }
    window.applyWidgetVisibility = applyWidgetVisibility;

    window.syncCustomPresetVisibility = function (isVisible) {
        const pad = document.getElementById('customPresetPad');
        const label = $('.custom-label-preset');
        if (!pad || !label) return;
        const parent = pad.closest('.list-layout, .grid-layout');
        const list = parent && parent.classList.contains('list-layout');
        const grid = parent && parent.classList.contains('grid-layout');
        pad.style.display = isVisible ? (list ? 'grid' : grid ? 'flex' : 'block') : 'none';
        label.style.display = isVisible ? 'block' : 'none';
    };

    // script.js calls these from the old UI; the web UI handles visibility itself.
    window.toggleDirectionContainer = () => applyWidgetVisibility();
    window.toggleMPV = () => { };
    window.toggleCFocus = () => { };

    window.loadcheck = function () {
        const saved = LS.get('viewMode');
        const prePad = $('.preset-container');
        if (saved === 'vid') prePad.style.display = 'none';
        else toggleDirectionPad('.preset-container');
        applyWidgetVisibility();
    };

    // ------------------------------------------------------------------ control pad tabs
    window.togglePad = function (selector) {
        const name = selector.replace('.', '');
        $$('.direction-pad, .zoom-pad, .focus-pad').forEach(p => p.classList.toggle('hidden', !p.classList.contains(name)));
    };
    window.setActiveHeading = function (headingClass) {
        $$('.direction-move-heading, .direction-focus-heading, .direction-zoom-heading').forEach(h => h.classList.remove('active'));
        $$(headingClass).forEach(h => h.classList.add('active'));
        LS.set('controlPadActive', headingClass);
    };
    function restoreControlPad() {
        let active = LS.get('controlPadActive');
        if (!active || (active === '.direction-move-heading' && !fullPTZ())) {
            active = fullPTZ() ? '.direction-move-heading' : '.direction-zoom-heading';
        }
        const pad = { '.direction-move-heading': '.direction-pad', '.direction-zoom-heading': '.zoom-pad', '.direction-focus-heading': '.focus-pad' }[active];
        togglePad(pad);
        setActiveHeading(active);
    }

    // value picker popup (used by zoom % / focus step labels)
    function pickValue(anchor, values, onPick, suffix = '') {
        $('#valuePicker')?.remove();
        const box = document.createElement('div');
        box.id = 'valuePicker';
        Object.assign(box.style, {
            position: 'fixed', zIndex: 100000, background: '#1e1e1e', border: '1px solid #444', borderRadius: '6px',
            padding: '4px 0', maxHeight: '260px', overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,.5)', minWidth: '70px',
        });
        const r = anchor.getBoundingClientRect();
        box.style.left = Math.min(r.left, innerWidth - 90) + 'px';
        box.style.top = Math.min(r.bottom + 4, innerHeight - 270) + 'px';
        values.forEach((v, i) => {
            const it = document.createElement('div');
            it.textContent = v + suffix;
            Object.assign(it.style, { padding: '6px 14px', cursor: 'pointer', color: '#ddd', fontSize: '14px' });
            it.onmouseenter = () => it.style.background = '#2a2a2a';
            it.onmouseleave = () => it.style.background = '';
            it.onclick = () => { onPick(i, v); box.remove(); };
            box.appendChild(it);
        });
        document.body.appendChild(box);
        setTimeout(() => document.addEventListener('click', function off(e) {
            if (!box.contains(e.target)) { box.remove(); document.removeEventListener('click', off); }
        }), 0);
    }

    // zoom pad
    window.selectZoom = () => pickValue($('#sliderZoomLabel'), zoomValues, (i) => { currentZoomIndex = i; updateZoomLabel(); }, '%');

    // focus pad
    const focusValues = ['1', '2', '5', '10', '20', '50', '100', '200', '500'];
    let focusIdx = Math.max(0, focusValues.indexOf(LS.get('focusStep', '50')));
    const updateFocusLabel = () => { $('#sliderFocusLabel').textContent = focusValues[focusIdx]; LS.set('focusStep', focusValues[focusIdx]); };
    window.incrementFocus = () => { if (focusIdx < focusValues.length - 1) { focusIdx++; updateFocusLabel(); } };
    window.decrementFocus = () => { if (focusIdx > 0) { focusIdx--; updateFocusLabel(); } };
    window.selectFocus = () => pickValue($('#sliderFocusLabel'), focusValues, (i) => { focusIdx = i; updateFocusLabel(); });

    let nfcOn = false;
    window.sendpadFocus = function (dir) {
        if (nfcOn) return; // handled by mousedown/up in continuous mode
        const v = parseInt(focusValues[focusIdx], 10);
        send(`!ptzfocus ${cam()} ${dir === 'plus' ? v : -v}`);
    };
    window.enableCF = (btn) => enableCFocus(btn);
    window.enableNFC = function (btn) {
        nfcOn = !nfcOn;
        btn.classList.toggle('highlighted', nfcOn);
    };
    // NFC (near/far continuous): hold +/- on the focus pad for continuous focus
    function wireContinuousFocus() {
        [['focusplus', 1], ['focusminus', -1]].forEach(([id, sign]) => {
            const b = document.getElementById(id);
            if (!b) return;
            const start = () => { if (nfcOn) ptzCFocus(sign * SPIN.focus); };
            const stop = () => { if (nfcOn) ptzCFocus(0); };
            b.addEventListener('mousedown', start);
            b.addEventListener('touchstart', start, { passive: true });
            ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach(ev => b.addEventListener(ev, stop));
        });
    }
    window.sendAutoFocusCommand = function (value) {
        send(`!ptzautofocus ${cam()} ${value || 'on'}`);
    };

    // zoom input widget (select + text)
    window.sendZoom = function () {
        const input = $('#zoomInput');
        const sel = $('#zoomSlider');
        const v = (input.value || '').trim() || (sel.value !== '0' ? sel.value : '') || '100';
        send(`!ptzzoom ${cam()} ${v}`);
        input.value = '';
        sel.value = '0';
    };

    // ------------------------------------------------------------------ spin
    function markSpinBtn(btn) {
        $$('button', btn.parentElement).forEach(b => b.classList.remove('highlighted'));
        btn.classList.add('highlighted');
    }
    const spinSetter = (key) => (v, btn) => {
        SPIN[key] = v;
        LS.set('spin_' + key, v);
        if (btn) markSpinBtn(btn);
    };
    window.setPanSpeed = spinSetter('pan');
    window.setTiltSpeed = spinSetter('tilt');
    window.setZoomSpeed = spinSetter('zoom');
    window.setFocusSpeed = spinSetter('focus');
    window.restoreSpinSpeed = () => { };
    function restoreSpinButtons() {
        const map = { pan: '.spin-pan-button', tilt: '.spin-tilt-button', zoom: '.spin-zoom-button', focus: '.spin-focus-button' };
        for (const [k, sel] of Object.entries(map)) {
            const saved = parseInt(LS.get('spin_' + k), 10);
            if (!isNaN(saved)) SPIN[k] = saved;
            const btn = $$(sel).find(b => parseInt(b.textContent, 10) === SPIN[k]) || $$(sel)[0];
            if (btn) markSpinBtn(btn);
        }
    }
    const origEnableSpin = window.enableSpin;
    window.enableSpin = function (button) {
        origEnableSpin(button);
        const on = LS.get('isSpinEnabled') === 'true';
        button.textContent = on ? 'Disable Spin' : 'Enable Spin';
        const c = $('#enablecriclespin');
        if (c) c.style.display = (on && fullPTZ()) ? 'inline-block' : 'none';
        if (!on) removeCircleOverlay();
    };

    // circle spin: drag inside the circle (bottom right of the screen) for analog pan/tilt
    let circleEl = null;
    function removeCircleOverlay() {
        if (circleEl) { circleEl.remove(); circleEl = null; }
        $('#enablecriclespin')?.classList.remove('highlighted');
    }
    window.removeCircleOverlay = removeCircleOverlay;
    window.enableSpinCircle = function (btn) {
        if (circleEl) { removeCircleOverlay(); return; }
        btn.classList.add('highlighted');
        const size = 220;
        circleEl = document.createElement('div');
        Object.assign(circleEl.style, {
            position: 'fixed', right: '24px', bottom: '24px', width: size + 'px', height: size + 'px', borderRadius: '50%',
            background: 'rgba(0,0,0,.55)', border: '2px solid rgba(255,255,255,.35)', zIndex: 90000, touchAction: 'none', cursor: 'crosshair',
        });
        const knob = document.createElement('div');
        Object.assign(knob.style, {
            position: 'absolute', left: size / 2 - 14 + 'px', top: size / 2 - 14 + 'px', width: '28px', height: '28px',
            borderRadius: '50%', background: '#1565c0', pointerEvents: 'none',
        });
        const label = document.createElement('div');
        label.textContent = 'Circle spin: drag';
        Object.assign(label.style, { position: 'absolute', top: '-22px', width: '100%', textAlign: 'center', fontSize: '12px', opacity: .7 });
        circleEl.append(knob, label);
        document.body.appendChild(circleEl);

        let active = false, last = '';
        let lastSent = 0, pending = null, timer = null;
        const push = (pan, tilt) => {
            const cmd = `${pan} ${tilt}`;
            if (cmd === last) return;
            const now = Date.now();
            const wait = Math.max(0, 800 - (now - lastSent)); // chat rate limit friendly
            pending = [pan, tilt];
            if (timer) return;
            timer = setTimeout(() => {
                timer = null;
                if (!pending) return;
                const [p, t] = pending; pending = null;
                last = `${p} ${t}`;
                lastSent = Date.now();
                ptzSpin(p, t, 0);
            }, wait);
        };
        const move = (e) => {
            if (!active) return;
            const r = circleEl.getBoundingClientRect();
            let dx = (e.clientX - (r.left + size / 2)) / (size / 2);
            let dy = (e.clientY - (r.top + size / 2)) / (size / 2);
            const m = Math.hypot(dx, dy);
            if (m > 1) { dx /= m; dy /= m; }
            knob.style.left = size / 2 - 14 + dx * (size / 2 - 14) + 'px';
            knob.style.top = size / 2 - 14 + dy * (size / 2 - 14) + 'px';
            const dead = 0.12;
            const pan = Math.abs(dx) < dead ? 0 : Math.max(-100, Math.min(100, Math.round(dx * SPIN.pan * 2)));
            const tilt = Math.abs(dy) < dead ? 0 : Math.max(-100, Math.min(100, Math.round(-dy * SPIN.tilt * 2)));
            push(pan, tilt);
        };
        circleEl.addEventListener('pointerdown', (e) => { active = true; circleEl.setPointerCapture(e.pointerId); move(e); });
        circleEl.addEventListener('pointermove', move);
        const end = () => {
            if (!active) return;
            active = false;
            knob.style.left = knob.style.top = size / 2 - 14 + 'px';
            if (timer) { clearTimeout(timer); timer = null; }
            pending = null; last = '';
            ptzSpin(0, 0, 0);
        };
        circleEl.addEventListener('pointerup', end);
        circleEl.addEventListener('pointercancel', end);
    };

    // ------------------------------------------------------------------ swap
    const SWAPS = {
        fox: ['fox', 'foxc'], crow: ['crowin', 'crowout'], marm: ['marmin', 'marmout'], wolf: ['wolf', 'wolfcorner'],
        wolfin: ['wolf', 'wolfindoor'], wden: ['wolf', 'wolfden'], winws: ['wolfindoor', 'wolfswitch'], wws: ['wolf', 'wolfswitch'],
        // extras that existed in the local build
        foxin: ['foxc', 'foxin'], serval: ['serval', 'servalc'], servin: ['serval', 'servalin'], servc: ['servalc', 'servalin'],
        feed: ['pasture', 'pasturefeeder'], lower: ['pasture', 'pasturel'], push: ['pushpop', 'pushpopindoor'],
        crnch: ['pushpop', 'pushpopcrunch'], wolfs: ['wolf', 'wolfswitch'], wolfcs: ['wolfcorner', 'wolfswitch'],
        toast: ['toast', 'toastcrunch'], parrot: ['parrot', 'macaws'],
    };
    window.setPresetSwap = function (key) {
        const s = SWAPS[key];
        if (s) send(`!swap ${s[0]} ${s[1]}`);
    };
    function addExtraSwapButtons() {
        const host = $('.swap-container');
        if (!host || $('#extraSwaps')) return;
        const wrap = document.createElement('div');
        wrap.id = 'extraSwaps';
        wrap.className = 'swap-preset-buttons';
        [['feed', 'feed'], ['lower', 'lower'], ['push', 'push'], ['crnch', 'crunch'], ['toast', 'toast'], ['parrot', 'parrot'],
        ['serval', 'serval'], ['servin', 'servin'], ['servc', 'servc'], ['foxin', 'foxin']].forEach(([k, label]) => {
            const b = document.createElement('button');
            b.className = 'swap-preset-button';
            b.textContent = label;
            b.onclick = () => setPresetSwap(k);
            wrap.appendChild(b);
        });
        host.appendChild(wrap);
    }

    // ------------------------------------------------------------------ cameras
    window.updateCameraThumbnailVisibility = function (isChecked) {
        $$('.camera-thumbnail').forEach(t => { t.style.display = isChecked ? 'block' : 'none'; });
        $$('.camera-button').forEach(b => { b.style.width = isChecked ? '140px' : '200px'; b.style.height = isChecked ? '28px' : '30px'; });
    };

    window.populateCameraButtons = function (cameras) {
        const container = $('.camera-container');
        container.innerHTML = '';
        const frag = document.createDocumentFragment();
        cameras.forEach(c => {
            const wrap = document.createElement('div');
            wrap.className = 'camera-button-container';
            const img = document.createElement('img');
            img.className = 'camera-thumbnail';
            img.alt = '';
            img.src = `camera-img/${c.name.toLowerCase()}.webp`;
            img.onerror = () => { img.onerror = null; img.src = 'img/logo.webp'; };
            const btn = document.createElement('button');
            btn.className = 'camera-button';
            btn.textContent = c.name;
            btn.addEventListener('click', () => selectCamera(c.name));
            img.addEventListener('click', () => btn.click());
            wrap.append(img, btn);
            frag.appendChild(wrap);
        });
        container.appendChild(frag);
        updateCameraThumbnailVisibility(LS.get('CamerathumbnailVisibility', 'true') === 'true');
        applyCameraFilter();
    };

    function applyCameraFilter() {
        const q = ($('#cameraSearch')?.value || '').trim().toLowerCase();
        $$('.camera-button-container').forEach(c => {
            const name = c.querySelector('.camera-button').textContent.toLowerCase();
            c.classList.toggle('camera-filter-hidden', !!q && !name.includes(q));
        });
    }

    window.fetchCameraDataAndPopulateUI = async function () {
        try {
            const res = await fetch('cameras.json', { cache: 'no-store' });
            camerasData = await res.json();
            camerasData.cameras.forEach(c => { c.name = String(c.name).trim(); });
            preloadImages(camerasData.cameras);
            populateCameraButtons(camerasData.cameras);
            populateDropdowns(camerasData.cameras);
            await loadHotkeyCache();
            const stored = LS.get('selectedCamera');
            const found = camerasData.cameras.find(c => c.name === stored) || camerasData.cameras[0];
            if (found) selectCamera(found.name);
        } catch (e) {
            console.error('Error fetching camera data:', e);
        }
    };

    // ------------------------------------------------------------------ presets
    const hotkeyCache = { normal: {}, custom: {} };
    async function loadHotkeyCache() {
        try {
            const [n, c] = await Promise.all([fetch('/hotkeys').then(r => r.json()), fetch('/custom-hotkeys').then(r => r.json())]);
            hotkeyCache.normal = n || {}; hotkeyCache.custom = c || {};
        } catch (e) { console.warn('hotkeys not loaded', e); }
    }
    const BLANK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    window.populatePresetPad = function (presets) {
        const pad = document.getElementById('presetPad');
        pad.innerHTML = '';
        const hk = hotkeyCache.normal[selectedCamera] || {};
        const frag = document.createDocumentFragment();
        presets.forEach((preset, i) => {
            const wrap = document.createElement('div');
            wrap.className = 'preset-button-container';
            wrap.dataset.origIndex = i;
            const img = document.createElement('img');
            img.className = 'preset-image';
            img.src = `./button-img/${thumbDir(selectedCamera)}/${preset}.png`;
            img.onerror = function () {
                this.src = `./button-img/${thumbDir(selectedCamera)}/home.png`;
                this.style.backgroundColor = '#222222';
                this.style.filter = 'blur(3px)';
                this.onerror = function () {
                    this.onerror = null;
                    this.src = BLANK;
                    this.style.backgroundColor = '#222222';
                    this.style.borderTopLeftRadius = '15px';
                    this.style.borderTopRightRadius = '15px';
                };
            };
            const btn = document.createElement('button');
            btn.className = 'preset-button';
            btn.dataset.preset = preset;
            btn.append(document.createTextNode(preset));
            if (hk[preset]) {
                const s = document.createElement('span');
                s.style.fontStyle = 'italic';
                s.textContent = ` (${hk[preset]})`;
                btn.appendChild(s);
            }
            btn.addEventListener('click', () => sendLoadCommand(selectedCamera, preset));
            img.addEventListener('click', () => btn.click());
            img.addEventListener('mouseover', () => btn.classList.add('preset-button-hover'));
            img.addEventListener('mouseout', () => btn.classList.remove('preset-button-hover'));
            wrap.append(img, btn);
            frag.appendChild(wrap);
        });
        pad.appendChild(frag);
        applyPresetSort();
        updateThumbnailVisibility(LS.get('thumbnailVisibility', 'true') === 'true');
        updateButtonHeight(LS.get('thumbnailVisibility', 'true') === 'true');
        applyPresetFilter();
    };

    // sort (default / A-Z) and grid size
    function applyPresetSort() {
        const pad = $('#presetPad');
        const mode = LS.get('presetSort', 'orig');
        const items = $$('.preset-button-container', pad);
        items.sort((a, b) => mode === 'az'
            ? a.querySelector('.preset-button').dataset.preset.localeCompare(b.querySelector('.preset-button').dataset.preset)
            : a.dataset.origIndex - b.dataset.origIndex);
        items.forEach(i => pad.appendChild(i));
        $('.sort-orig-item')?.classList.toggle('active', mode === 'orig');
        $('.sort-az-item')?.classList.toggle('active', mode === 'az');
    }
    function applyGridSize() {
        const large = LS.get('gridSize', 'large') === 'large';
        const pc = $('#presetContainer');
        pc.classList.toggle('grid-large', large);
        $('.sort-grid-large-item')?.classList.toggle('active', large);
        $('.sort-grid-small-item')?.classList.toggle('active', !large);
    }
    function wireSortMenu() {
        $('.sort-orig-item').onclick = () => { LS.set('presetSort', 'orig'); applyPresetSort(); };
        $('.sort-az-item').onclick = () => { LS.set('presetSort', 'az'); applyPresetSort(); };
        $('.sort-grid-large-item').onclick = () => { LS.set('gridSize', 'large'); applyGridSize(); };
        $('.sort-grid-small-item').onclick = () => { LS.set('gridSize', 'small'); applyGridSize(); };
        applyGridSize();
    }

    // search (replaces the old filteredPad approach with simple show/hide)
    function applyPresetFilter() {
        const q = ($('#presetSearch')?.value || '').trim().toLowerCase();
        $$('.preset-button-container, .custom-preset-button-container').forEach(c => {
            const b = c.querySelector('.preset-button, .custom-preset-button');
            c.style.display = (!q || (b && b.textContent.toLowerCase().includes(q))) ? '' : 'none';
        });
    }
    function wireSearch() {
        const old = $('#presetSearch');
        const fresh = old.cloneNode(true); // drops the legacy listeners
        old.replaceWith(fresh);
        fresh.addEventListener('input', applyPresetFilter);
        fresh.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const first = $$('.preset-button-container, .custom-preset-button-container').find(c => c.style.display !== 'none');
                first?.querySelector('.preset-button, .custom-preset-button')?.click();
                fresh.value = ''; applyPresetFilter(); fresh.blur();
            } else if (e.key === 'Escape') { fresh.value = ''; applyPresetFilter(); fresh.blur(); }
        });
        const cs = $('#cameraSearch');
        cs.addEventListener('input', applyCameraFilter);
        cs.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                $$('.camera-button-container').find(c => !c.classList.contains('camera-filter-hidden'))?.querySelector('.camera-button')?.click();
                cs.blur();
            } else if (e.key === 'Escape') { cs.value = ''; applyCameraFilter(); cs.blur(); }
            e.stopPropagation();
        });
    }

    // layout icons: top-left grid icon and the one in the preset header act as one
    function wireLayoutIcons() {
        $('#presetGridIcon')?.addEventListener('click', () => $('#gridIcon').click());
        const sync = () => {
            const g = $('#gridIcon').classList.contains('active-icon');
            const l = $('#listIcon').classList.contains('active-icon');
            $('#presetGridIcon').classList.toggle('active-icon', g);
            // keep the top-left grid icon as a "show presets" shortcut
        };
        new MutationObserver(sync).observe($('#gridIcon'), { attributes: true, attributeFilter: ['class'] });
        new MutationObserver(sync).observe($('#listIcon'), { attributes: true, attributeFilter: ['class'] });
        sync();
    }

    // ------------------------------------------------------------------ resizable lists
    function wireResizeHandles() {
        $$('.resize-handle').forEach(h => {
            const key = h.dataset.target;
            const target = key === 'cameraContainer' ? $('#cameraContainer') : $('.twitch-chat-container');
            if (!target) return;
            const saved = LS.get('h_' + key);
            if (saved) target.style.height = saved + 'px';
            h.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                h.classList.add('dragging');
                h.setPointerCapture(e.pointerId);
                const startY = e.clientY, startH = target.getBoundingClientRect().height;
                const zoom = parseFloat(getComputedStyle($('.left-menu')).zoom) || 1;
                const move = (ev) => { target.style.height = Math.max(60, startH + (ev.clientY - startY) / zoom) + 'px'; };
                const up = () => {
                    h.classList.remove('dragging');
                    h.removeEventListener('pointermove', move);
                    h.removeEventListener('pointerup', up);
                    LS.set('h_' + key, parseInt(target.style.height, 10));
                };
                h.addEventListener('pointermove', move);
                h.addEventListener('pointerup', up);
            });
        });
    }

    // ------------------------------------------------------------------ twitch chat widget
    function wireChat() {
        const box = $('#twitchChatMessages');
        const scroller = $('.twitch-chat-container');
        if (!box || !window.EventSource) return;
        const add = (e) => {
            const line = document.createElement('div');
            line.className = 'twitch-chat-message';
            if (e.system) {
                line.style.opacity = '.6';
                line.textContent = `# ${e.channel || ''} ${e.text}`;
            } else {
                const t = document.createElement('span');
                t.className = 'twitch-chat-time';
                t.textContent = new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const u = document.createElement('span');
                u.className = 'twitch-chat-user';
                u.style.color = e.color || '#9aa';
                u.style.fontWeight = '600';
                u.textContent = e.user + ':';
                const m = document.createElement('span');
                m.className = 'twitch-chat-text';
                m.textContent = e.text;
                line.append(t, u, m);
            }
            const stick = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 20;
            box.appendChild(line);
            while (box.children.length > 100) box.firstChild.remove();
            if (stick) scroller.scrollTop = scroller.scrollHeight;
        };
        const es = new EventSource('/chat-stream');
        es.onmessage = (ev) => { try { add(JSON.parse(ev.data)); } catch { /* ignore */ } };
    }

    // ------------------------------------------------------------------ radial camera menu
    // Middle click (or the ` key) opens a pie menu of cameras at the cursor.
    function wireRadial() {
        let menu = null;
        const close = () => { menu?.remove(); menu = null; };
        const open = (x, y) => {
            close();
            const all = (camerasData?.cameras || []).map(c => c.name);
            const lower = new Set(all.map(n => n.toLowerCase()));
            const isCombo = (n) => {
                const l = n.toLowerCase();
                if (/multi$/.test(l) && !l.startsWith('chin')) return true;
                for (let i = 2; i < l.length - 1; i++) {
                    if (!lower.has(l.slice(0, i))) continue;
                    const rest = l.slice(i);
                    if (lower.has(rest)) return true;
                    for (const o of lower) if (o.length >= 3 && rest.startsWith(o)) return true;
                }
                return false;
            };
            const cams = all.filter(n => !isCombo(n));
            if (!cams.length) return;
            const size = Math.min(900, innerHeight - 20), c = size / 2, r0 = 60, r1 = size / 2 - 6;
            const NS = 'http://www.w3.org/2000/svg';
            menu = document.createElement('div');
            Object.assign(menu.style, { position: 'fixed', left: x + 'px', top: y + 'px', transform: 'translate(-50%,-50%)', zIndex: 100000 });
            const svg = document.createElementNS(NS, 'svg');
            svg.setAttribute('width', size); svg.setAttribute('height', size);
            const pt = (r, a) => [c + r * Math.sin(a), c - r * Math.cos(a)];
            const n = cams.length;
            cams.forEach((name, i) => {
                const a0 = (i / n) * 2 * Math.PI, a1 = ((i + 1) / n) * 2 * Math.PI;
                const [x0, y0] = pt(r1, a0), [x1, y1] = pt(r1, a1), [x2, y2] = pt(r0, a1), [x3, y3] = pt(r0, a0);
                const p = document.createElementNS(NS, 'path');
                p.setAttribute('d', `M${x0} ${y0} A${r1} ${r1} 0 0 1 ${x1} ${y1} L${x2} ${y2} A${r0} ${r0} 0 0 0 ${x3} ${y3}Z`);
                const sel = name === selectedCamera;
                p.setAttribute('fill', sel ? '#1565c0' : '#2ecc71');
                p.setAttribute('stroke', '#222');
                p.style.cursor = 'pointer';
                p.addEventListener('mouseenter', () => p.setAttribute('opacity', '.75'));
                p.addEventListener('mouseleave', () => p.setAttribute('opacity', '1'));
                p.addEventListener('click', () => { selectCamera(name); close(); });
                svg.appendChild(p);
                const [tx, ty] = pt(r0 + (r1 - r0) * 0.55, (a0 + a1) / 2);
                const t = document.createElementNS(NS, 'text');
                t.setAttribute('x', tx); t.setAttribute('y', ty);
                t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'middle');
                const deg = (((a0 + a1) / 2) * 180) / Math.PI;
                t.setAttribute('transform', `rotate(${deg > 180 ? deg + 90 : deg - 90} ${tx} ${ty})`);
                t.setAttribute('fill', '#fff'); t.setAttribute('font-size', n > 30 ? 11 : 13); t.setAttribute('pointer-events', 'none');
                t.textContent = name;
                svg.appendChild(t);
            });
            const ctr = document.createElementNS(NS, 'circle');
            ctr.setAttribute('cx', c); ctr.setAttribute('cy', c); ctr.setAttribute('r', r0 - 4);
            ctr.setAttribute('fill', '#3498db'); ctr.style.cursor = 'pointer';
            ctr.addEventListener('click', close);
            svg.appendChild(ctr);
            const ct = document.createElementNS(NS, 'text');
            ct.setAttribute('x', c); ct.setAttribute('y', c); ct.setAttribute('text-anchor', 'middle');
            ct.setAttribute('dominant-baseline', 'middle'); ct.setAttribute('fill', '#fff'); ct.setAttribute('font-size', 13);
            ct.setAttribute('pointer-events', 'none'); ct.textContent = 'Cameras';
            svg.appendChild(ct);
            menu.appendChild(svg);
            document.body.appendChild(menu);
            // keep on screen
            const rect = menu.getBoundingClientRect();
            const dx = Math.max(0, -rect.left) - Math.max(0, rect.right - innerWidth);
            const dy = Math.max(0, -rect.top) - Math.max(0, rect.bottom - innerHeight);
            menu.style.left = x + dx + 'px'; menu.style.top = y + dy + 'px';
        };
        let mx = innerWidth / 2, my = innerHeight / 2;
        document.addEventListener('mousemove', (e) => { mx = e.clientX; my = e.clientY; });
        document.addEventListener('mousedown', (e) => {
            if (e.button === 1) { e.preventDefault(); menu ? close() : open(e.clientX, e.clientY); }
            else if (menu && !menu.contains(e.target)) close();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') close();
            if (e.key === '`' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); menu ? close() : open(mx, my); }
        });
    }

    // ------------------------------------------------------------------ info tour
    window.startTour = function (steps) {
        if (typeof introJs !== 'function') return;
        introJs().setOptions({ steps, showProgress: true, exitOnOverlayClick: true }).start();
    };
    window.startSwapIntro = () => startTour([
        { element: '.swap-buttons', intro: 'Swap camera 1 with camera 2 to 6 on the stream.' },
        { element: '.swap-preset-buttons', intro: 'Quick swaps between related cameras (for example wolf and wolfcorner).' },
    ]);
    window.startSpinIntro = () => startTour([
        { element: '#spinContainer', intro: 'Pick the pan, tilt, zoom and focus speeds, then press Enable Spin. Hold the arrow keys (pan/tilt), = and - (zoom), and , and . (focus, with CF on) to move continuously.' },
    ]);
    function mainTour() {
        startTour([
            { element: '#cameraContainer', intro: 'Pick a camera. Use the search box to filter. Number keys 1-9 also select cameras. In video view, middle click a slot to select its camera and right click a slot to zoom it.' },
            { element: '#directionpadContainer', intro: 'Move, zoom and focus the selected camera. NFC makes the focus +/- buttons continuous while held.' },
            { element: '#presetContainer', intro: 'Click a preset to send it. Use the sort icon for A to Z and grid size. Press Enter to jump to preset search.' },
            { element: '#twitchChatContainer', intro: 'Live Twitch chat so you can see the bot replies.' },
        ].filter(s => document.querySelector(s.element) && document.querySelector(s.element).offsetParent !== null));
    }

    // ------------------------------------------------------------------ boot
    function boot() {
        addExtraSwapButtons();
        wireSortMenu();
        wireSearch();
        wireLayoutIcons();
        wireResizeHandles();
        wireContinuousFocus();
        wireChat();
        restoreSpinButtons();
        restoreControlPad();
        updateFocusLabel();
        updateZoomLabel();
        applyWidgetVisibility();
        fetchTwitchURL();
        $('.custom-info-icon')?.addEventListener('click', mainTour);
        $('#infoIcon')?.addEventListener('click', mainTour);
        const sp = $('#enablespin');
        if (sp && LS.get('isSpinEnabled') !== 'true') sp.textContent = 'Enable Spin';
        // the old script re-renders layout after a delay, so re-apply once it has settled
        setTimeout(applyWidgetVisibility, 1200);
        fetch('/status').then(r => r.json()).then(s => {
            if (!s.canSend) {
                const bar = document.createElement('div');
                bar.textContent = 'No Twitch OAuth key set: commands will not be sent. Open Settings > Twitch Settings.';
                Object.assign(bar.style, { position: 'fixed', top: 0, left: 0, right: 0, background: '#a22', color: '#fff', textAlign: 'center', padding: '6px', zIndex: 200000, fontSize: '13px' });
                document.body.appendChild(bar);
            }
        }).catch(() => { });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
