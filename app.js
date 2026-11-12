/**
 * app.js
 * Hoofdcontroller voor vroonphoto
 * Geïnspireerd op de architectuur en stijl van Peters eerdere apps (PetersWorld)
 * Bevat WebAssembly hardware acceleratie, RAW decoder, rood licht herstel,
 * ruisonderdrukking, knallend zwart-wit, Topaz super-resolution en versiecontrole.
 */

const CFG = {
    appName: 'vroonphoto',
    versionFile: 'version.json',
    wasmFile: 'vroonphoto.wasm'
};

let currentVersion = null;

// ═══════════════════════════════════════════════════════
//  1. VERSIEDETECTIE & GEFORCEERDE UPDATE (PETERSWORLD ENGINE)
// ═══════════════════════════════════════════════════════

async function forceAppUpdate() {
    console.log('🔄 Bezig met forceren van app update & cache purge...');
    // 1. Verwijder alle Service Worker registraties
    try {
        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (const reg of registrations) {
                await reg.unregister();
            }
        }
    } catch (e) {}

    // 2. Verwijder alle CacheStorage caches
    try {
        if ('caches' in window) {
            const keys = await caches.keys();
            for (const k of keys) {
                await caches.delete(k);
            }
        }
    } catch (e) {}

    // 3. Wis alle opslag
    try {
        localStorage.clear();
        sessionStorage.clear();
    } catch (e) {}

    // 4. Haal nieuwste versie op van de server
    let latestVer = Date.now();
    try {
        const res = await fetch(`${CFG.versionFile}?nocache=${Date.now()}`, { cache: 'no-store' });
        if (res.ok) {
            const data = await res.json();
            if (data && data.version) latestVer = data.version;
        }
    } catch (e) {}

    // 5. Herlaad direct met cache-busters
    setTimeout(() => {
        const targetUrl = `index.html?v=${latestVer}&t=${Date.now()}`;
        window.location.replace(targetUrl);
    }, 450);
}

async function checkVersion(silent = true) {
    try {
        const res = await fetch(`${CFG.versionFile}?nocache=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) {
            if (!silent) await forceAppUpdate();
            return;
        }
        const data = await res.json();

        const pillTxt = document.getElementById('ver-txt');
        if (pillTxt && !currentVersion) {
            currentVersion = data.version;
            pillTxt.textContent = `v${data.version}`;
        }

        if (data.version && currentVersion && data.version !== currentVersion) {
            const banner = document.getElementById('update-banner');
            document.getElementById('upd-ver').textContent = `v${data.version}`;
            const note = data.features && data.features[0] ? data.features[0] : 'Nieuwe update beschikbaar';
            document.getElementById('upd-note').textContent = note;
            banner.classList.add('show');

            const dot = document.getElementById('ver-dot');
            if (dot) dot.className = 'dot gold';
        } else if (!silent) {
            // Als de gebruiker handmatig op 🔄 klikt: direct geforceerd herladen en cachen wissen!
            await forceAppUpdate();
        }
    } catch (e) {
        if (!silent) {
            await forceAppUpdate();
        } else {
            console.warn('[Versie] Check mislukt:', e);
        }
    }
}

async function applyUpdate() {
    await forceAppUpdate();
}

// ═══════════════════════════════════════════════════════
//  2. WEBASSEMBLY ENGINE (HARDWARE VERSNELLER)
// ═══════════════════════════════════════════════════════

class WasmKernel {
    constructor() {
        this.instance = null;
        this.memory = null;
        this.isReady = false;
    }

    async init() {
        const paths = [CFG.wasmFile, 'src/wasm/vroonphoto_core.wasm'];
        for (const path of paths) {
            try {
                const res = await fetch(`${path}?nocache=${Date.now()}`);
                if (res.ok) {
                    const bytes = await res.arrayBuffer();
                    const module = await WebAssembly.instantiate(bytes, {});
                    this.instance = module.instance;
                    this.memory = this.instance.exports.memory;
                    this.isReady = true;
                    console.log(`⚡ [vroonphoto WASM] Succesvol geladen vanaf ${path} (Hardware-Accelerated)`);
                    return true;
                }
            } catch (e) {
                // probeer volgende pad
            }
        }
        console.warn('⚠️ [vroonphoto WASM] WebAssembly kon niet geladen worden. JS fallback actief.');
        return false;
    }

    ensureMemory(size) {
        if (!this.memory) return;
        const currentBytes = this.memory.buffer.byteLength;
        if (size > currentBytes) {
            const pages = Math.ceil((size - currentBytes) / 65536) + 32;
            this.memory.grow(pages);
        }
    }

    // 1. Rood licht herstel
    recoverRedLight(imageData, threshold, strength, skinProtect, gamutCompress) {
        const { data, width, height } = imageData;
        const totalBytes = width * height * 4;

        if (this.isReady && this.instance.exports.vroon_recover_red_light) {
            this.ensureMemory(totalBytes);
            const mem = new Uint8Array(this.memory.buffer);
            mem.set(data.subarray(0, totalBytes), 0);
            this.instance.exports.vroon_recover_red_light(
                0, width, height, threshold, strength, skinProtect, gamutCompress
            );
            data.set(mem.subarray(0, totalBytes));
            return;
        }

        // JS Fallback
        const threshVal = threshold * 255.0;
        for (let i = 0; i < totalBytes; i += 4) {
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const maxGb = Math.max(g, b);
            if (r > threshVal && r > maxGb * 1.25) {
                const detailLuma = 0.65 * g + 0.35 * b;
                const blowout = Math.min((r - maxGb) / 255.0, 1.0);
                const blend = blowout * strength;
                let rRec = r * (1.0 - blend) + (maxGb + detailLuma * 0.45) * blend;
                if (gamutCompress > 0.01) {
                    const tg = g + (r - maxGb) * 0.32 * gamutCompress;
                    const tb = b + (r - maxGb) * 0.15 * gamutCompress;
                    data[i + 1] = Math.min(255, (g * (1 - gamutCompress * 0.6) + tg * (gamutCompress * 0.6)) | 0);
                    data[i + 2] = Math.min(255, (b * (1 - gamutCompress * 0.6) + tb * (gamutCompress * 0.6)) | 0);
                }
                data[i] = Math.min(255, Math.max(0, rRec | 0));
            }
        }
    }

    // 2. Ruisonderdrukking
    denoise(imageData, radius, spatialSigma, rangeSigma, chromaStrength) {
        const { data, width, height } = imageData;
        const totalBytes = width * height * 4;

        if (this.isReady && this.instance.exports.vroon_denoise_bilateral) {
            const srcOff = 0;
            const dstOff = totalBytes;
            this.ensureMemory(totalBytes * 2);
            const mem = new Uint8Array(this.memory.buffer);
            mem.set(data, srcOff);

            this.instance.exports.vroon_denoise_bilateral(
                srcOff, dstOff, width, height, radius, spatialSigma, rangeSigma
            );
            if (chromaStrength > 0.001) {
                this.instance.exports.vroon_denoise_chroma(dstOff, width, height, chromaStrength);
            }
            data.set(mem.subarray(dstOff, dstOff + totalBytes));
            return;
        }

        // JS Fallback
        const copy = new Uint8ClampedArray(data);
        const twoSpatialSq = 2.0 * spatialSigma * spatialSigma;
        const twoRangeSq = 2.0 * rangeSigma * rangeSigma;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const cIdx = (y * width + x) * 4;
                const cr = copy[cIdx], cg = copy[cIdx + 1], cb = copy[cIdx + 2];
                let sumR = 0, sumG = 0, sumB = 0, sumW = 0;
                for (let dy = -radius; dy <= radius; dy++) {
                    const py = y + dy;
                    if (py < 0 || py >= height) continue;
                    for (let dx = -radius; dx <= radius; dx++) {
                        const px = x + dx;
                        if (px < 0 || px >= width) continue;
                        const pIdx = (py * width + px) * 4;
                        const pr = copy[pIdx], pg = copy[pIdx + 1], pb = copy[pIdx + 2];
                        const distSq = dx * dx + dy * dy;
                        const colorDiffSq = (pr - cr) ** 2 + (pg - cg) ** 2 + (pb - cb) ** 2;
                        const w = (1.0 / (1.0 + distSq / twoSpatialSq)) * (1.0 / (1.0 + colorDiffSq / twoRangeSq));
                        sumR += pr * w; sumG += pg * w; sumB += pb * w; sumW += w;
                    }
                }
                data[cIdx]     = (sumR / sumW) | 0;
                data[cIdx + 1] = (sumG / sumW) | 0;
                data[cIdx + 2] = (sumB / sumW) | 0;
            }
        }
    }

    // 3. Knallend Zwart-Wit
    punchyBW(imageData, rw, gw, bw, contrast, clarity, grain) {
        const { data, width, height } = imageData;
        const totalBytes = width * height * 4;

        if (this.isReady && this.instance.exports.vroon_punchy_bw) {
            const srcOff = 0;
            const dstOff = totalBytes;
            this.ensureMemory(totalBytes * 2);
            const mem = new Uint8Array(this.memory.buffer);
            mem.set(data, srcOff);

            this.instance.exports.vroon_punchy_bw(
                srcOff, dstOff, width, height, rw, gw, bw, contrast, clarity, grain
            );
            data.set(mem.subarray(dstOff, dstOff + totalBytes));
            return;
        }

        // JS Fallback
        const sum = (rw + gw + bw) || 1.0;
        const nr = rw / sum, ng = gw / sum, nb = bw / sum;
        let cFactor = ((contrast + 100.0) / 100.0) ** 2;
        for (let i = 0; i < totalBytes; i += 4) {
            const luma = data[i] * nr + data[i + 1] * ng + data[i + 2] * nb;
            let norm = luma / 255.0;
            let val = 0.5 + (norm - 0.5) * cFactor;
            val = val > 0.5 ? 1.0 - (1.0 - val) * (1.0 - (val - 0.5) * 0.35) : val * (1.0 + (0.5 - val) * 0.35);
            const bVal = Math.min(255, Math.max(0, (val * 255.0) | 0));
            data[i] = data[i + 1] = data[i + 2] = bVal;
        }
    }

    // 4. Topaz Super-Resolution 2x
    superRes2x(srcImageData, sharpness = 50.0) {
        const sw = srcImageData.width, sh = srcImageData.height;
        const dw = sw * 2, dh = sh * 2;
        const srcBytes = sw * sh * 4, dstBytes = dw * dh * 4;
        const dstImageData = new ImageData(dw, dh);

        if (this.isReady && this.instance.exports.vroon_super_res_2x) {
            const srcOff = 0, dstOff = srcBytes;
            this.ensureMemory(srcBytes + dstBytes);
            const mem = new Uint8Array(this.memory.buffer);
            mem.set(srcImageData.data, srcOff);

            this.instance.exports.vroon_super_res_2x(srcOff, dstOff, sw, sh, sharpness);
            dstImageData.data.set(mem.subarray(dstOff, dstOff + dstBytes));
            return dstImageData;
        }

        // JS Fallback
        const src = srcImageData.data, dst = dstImageData.data;
        for (let y = 0; y < dh; y++) {
            const sy = y * 0.5;
            const y0 = Math.floor(sy), y1 = Math.min(y0 + 1, sh - 1), fy = sy - y0;
            for (let x = 0; x < dw; x++) {
                const sx = x * 0.5;
                const x0 = Math.floor(sx), x1 = Math.min(x0 + 1, sw - 1), fx = sx - x0;
                const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4;
                const i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
                const dstIdx = (y * dw + x) * 4;
                for (let c = 0; c < 3; c++) {
                    const top = src[i00 + c] * (1 - fx) + src[i10 + c] * fx;
                    const bot = src[i01 + c] * (1 - fx) + src[i11 + c] * fx;
                    let val = top * (1 - fy) + bot * fy;
                    if (sharpness > 0) val += (val - src[i00 + c]) * (sharpness / 100.0) * 0.4;
                    dst[dstIdx + c] = Math.min(255, Math.max(0, val | 0));
                }
                dst[dstIdx + 3] = 255;
            }
        }
        return dstImageData;
    }

    // 5. Firefly Inpainting
    smartInpaint(imageData, maskArray, radius = 5) {
        const { data, width, height } = imageData;
        const totalBytes = width * height * 4;
        const maskBytes = width * height;

        if (this.isReady && this.instance.exports.vroon_smart_inpaint) {
            const imgOff = 0, maskOff = totalBytes;
            this.ensureMemory(totalBytes + maskBytes);
            const mem = new Uint8Array(this.memory.buffer);
            mem.set(data, imgOff);
            mem.set(maskArray, maskOff);
            this.instance.exports.vroon_smart_inpaint(imgOff, maskOff, width, height, radius);
            data.set(mem.subarray(imgOff, imgOff + totalBytes));
            return;
        }

        // JS Fallback
        for (let iter = 0; iter < 3; iter++) {
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const pIdx = y * width + x;
                    if (maskArray[pIdx] < 128) continue;
                    let sR = 0, sG = 0, sB = 0, sW = 0;
                    for (let dy = -radius; dy <= radius; dy++) {
                        const py = y + dy;
                        if (py < 0 || py >= height) continue;
                        for (let dx = -radius; dx <= radius; dx++) {
                            const px = x + dx;
                            if (px < 0 || px >= width) continue;
                            const nIdx = py * width + px;
                            const isValid = maskArray[nIdx] < 128 ? 1.0 : 0.1;
                            const w = isValid / (dx * dx + dy * dy + 0.1);
                            const nB = nIdx * 4;
                            sR += data[nB] * w; sG += data[nB + 1] * w; sB += data[nB + 2] * w; sW += w;
                        }
                    }
                    if (sW > 0.0001) {
                        const bIdx = pIdx * 4;
                        data[bIdx] = (sR / sW) | 0;
                        data[bIdx + 1] = (sG / sW) | 0;
                        data[bIdx + 2] = (sB / sW) | 0;
                    }
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════
//  3. VROONPHOTO HOOFD APPLICATIE
// ═══════════════════════════════════════════════════════

class VroonPhotoApp {
    constructor() {
        this.wasm = new WasmKernel();
        this.canvas = document.getElementById('main-canvas');
        this.ctx = this.canvas ? this.canvas.getContext('2d', { willReadFrequently: true }) : null;

        this.originalImageData = null;
        this.currentImageData = null;

        this.isBeforeAfterActive = false;
        this.splitComparePos = 0.5;
        this.activeTool = 'adjust';

        this.maskCanvas = null;
        this.maskCtx = null;

        this.state = this.getDefaultState();
    }

    getDefaultState() {
        return {
            exposure: 0, contrast: 0, highlights: 0, shadows: 0,
            temp: 0, tint: 0, vibrance: 0, saturation: 0,
            stageRedFix: 0, colorBleedReduction: 0, skinProtection: 50, gamutCompress: 50,
            denoiseLuma: 0, denoiseChroma: 0, denoiseDetail: 50,
            bwEnabled: false, bwRed: 40, bwGreen: 10, bwBlue: -10,
            bwContrast: 35, bwClarity: 45, bwGrain: 10
        };
    }

    async init() {
        await this.wasm.init();
        await checkVersion(true);

        // Periodieke check elke 5 minuten
        setInterval(() => checkVersion(true), 5 * 60 * 1000);

        this.initHistogram();
        this.initToneCurve();
        this.setupEventListeners();
        this.setupShortcuts();
        this.setupDropzone();

        // Laad standaard concert sample
        this.loadSamplePhoto('concert_red');
    }

    setupEventListeners() {
        // Sliders
        document.querySelectorAll('.param-slider').forEach(slider => {
            const param = slider.dataset.param;
            const valSpan = document.getElementById(`${slider.id}-val`);
            slider.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                this.state[param] = val;
                if (valSpan) valSpan.textContent = val;
                this.render();
            });
        });

        // Reset secties
        document.querySelectorAll('.btn-reset-section').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.resetSection(e.target.dataset.section);
            });
        });

        // B&W Presets
        document.querySelectorAll('.bw-preset-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.applyBWPreset(e.currentTarget.dataset.preset);
            });
        });

        // Global Presets
        document.querySelectorAll('.preset-card').forEach(card => {
            card.addEventListener('click', (e) => {
                this.applyGlobalPreset(e.currentTarget.dataset.preset);
            });
        });

        // Zwart-Wit Toggle
        const bwToggle = document.getElementById('toggle-bw-mode');
        bwToggle?.addEventListener('change', (e) => {
            this.state.bwEnabled = e.target.checked;
            document.getElementById('bw-mixer-panel')?.classList.toggle('disabled', !this.state.bwEnabled);
            this.render();
        });

        // Topaz Super-Resolution
        document.getElementById('btn-upscale-2x')?.addEventListener('click', () => this.upscale(2));
        document.getElementById('btn-upscale-4x')?.addEventListener('click', () => this.upscale(4));

        // Firefly Inpaint Tool
        document.getElementById('tool-inpaint')?.addEventListener('click', () => {
            this.activeTool = this.activeTool === 'inpaint' ? 'adjust' : 'inpaint';
            document.getElementById('tool-inpaint').classList.toggle('active', this.activeTool === 'inpaint');
        });
        document.getElementById('btn-apply-heal')?.addEventListener('click', () => this.applyInpaint());
        document.getElementById('btn-clear-heal')?.addEventListener('click', () => this.clearMask());

        // Voor/Na toggle
        document.getElementById('btn-compare-toggle')?.addEventListener('click', () => {
            this.isBeforeAfterActive = !this.isBeforeAfterActive;
            document.getElementById('btn-compare-toggle').classList.toggle('active', this.isBeforeAfterActive);
            this.drawCanvas();
        });

        // Export Modal
        document.getElementById('btn-open-export')?.addEventListener('click', () => {
            document.getElementById('export-modal')?.classList.remove('hidden');
        });
        document.getElementById('btn-close-export')?.addEventListener('click', () => {
            document.getElementById('export-modal')?.classList.add('hidden');
        });
        document.getElementById('btn-confirm-export')?.addEventListener('click', () => this.exportImage());

        // Update banner knoppen
        document.getElementById('btn-apply-upd')?.addEventListener('click', () => applyUpdate());
        document.getElementById('btn-dismiss-upd')?.addEventListener('click', () => {
            document.getElementById('update-banner')?.classList.remove('show');
        });

        // Roterend
        document.getElementById('btn-rotate-left')?.addEventListener('click', () => this.rotate(-90));
        document.getElementById('btn-rotate-right')?.addEventListener('click', () => this.rotate(90));
        document.getElementById('btn-flip-h')?.addEventListener('click', () => this.flipH());

        // Bestanden
        document.getElementById('file-upload-input')?.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) this.loadFile(e.target.files[0]);
        });
        document.getElementById('sample-photos-select')?.addEventListener('change', (e) => {
            this.loadSamplePhoto(e.target.value);
        });

        // Canvas muis interacties
        this.setupCanvasMouse();
    }

    setupCanvasMouse() {
        let isDown = false;
        this.canvas.addEventListener('mousedown', (e) => {
            isDown = true;
            if (this.activeTool === 'inpaint') {
                this.paintMask(e);
            } else if (this.isBeforeAfterActive) {
                const rect = this.canvas.getBoundingClientRect();
                this.splitComparePos = (e.clientX - rect.left) / rect.width;
                this.drawCanvas();
            }
        });
        window.addEventListener('mousemove', (e) => {
            if (!isDown) return;
            if (this.activeTool === 'inpaint') {
                this.paintMask(e);
            } else if (this.isBeforeAfterActive) {
                const rect = this.canvas.getBoundingClientRect();
                this.splitComparePos = Math.max(0.05, Math.min(0.95, (e.clientX - rect.left) / rect.width));
                this.drawCanvas();
            }
        });
        window.addEventListener('mouseup', () => { isDown = false; });
    }

    setupShortcuts() {
        window.addEventListener('keydown', (e) => {
            if (e.key === '\\') {
                e.preventDefault();
                document.getElementById('btn-compare-toggle')?.click();
            }
        });
    }

    setupDropzone() {
        const drop = document.getElementById('viewport-dropzone');
        if (!drop) return;
        ['dragenter', 'dragover'].forEach(n => drop.addEventListener(n, e => e.preventDefault()));
        drop.addEventListener('drop', (e) => {
            e.preventDefault();
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                this.loadFile(e.dataTransfer.files[0]);
            }
        });
    }

    async loadFile(file) {
        document.getElementById('loading-overlay')?.classList.remove('hidden');
        try {
            console.log(`📂 [vroonphoto] Openen van: ${file.name}`);
            const bitmap = await createImageBitmap(file);
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(bitmap, 0, 0);
            const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
            this.setImage(imgData, {
                filename: file.name,
                filesize: `${(file.size / 1024 / 1024).toFixed(2)} MB`
            });
        } catch (err) {
            console.error('Laadfout:', err);
            alert(`Fout bij laden van foto: ${err.message}`);
        } finally {
            document.getElementById('loading-overlay')?.classList.add('hidden');
        }
    }

    setImage(imageData, metadata = {}) {
        this.originalImageData = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
        this.currentImageData = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);

        this.canvas.width = imageData.width;
        this.canvas.height = imageData.height;

        this.initMask(imageData.width, imageData.height);

        const info = document.getElementById('photo-info-display');
        if (info) {
            info.textContent = `${metadata.filename || 'Afbeelding'} | ${imageData.width}×${imageData.height}px | ${metadata.filesize || ''}`;
        }

        // Automatische podium rood licht detectie
        this.detectStageRed();
        this.render();
    }

    detectStageRed() {
        const d = this.originalImageData.data;
        let blown = 0;
        const total = this.originalImageData.width * this.originalImageData.height;
        for (let i = 0; i < d.length; i += 4) {
            if (d[i] > 195 && d[i] > Math.max(d[i + 1], d[i + 2]) * 1.35) blown++;
        }
        const pct = (blown / total) * 100;
        const alertBox = document.getElementById('stage-red-detected-alert');
        if (alertBox) {
            if (pct > 2.5) {
                alertBox.classList.remove('hidden');
                alertBox.innerHTML = `⚠️ <strong>Rood podiumlicht gedetecteerd (${pct.toFixed(1)}% clipping)!</strong> 'Rood Licht Herstel' staat klaar.`;
                this.state.stageRedFix = 85;
                this.state.colorBleedReduction = 65;
                this.syncUI();
            } else {
                alertBox.classList.add('hidden');
            }
        }
    }

    syncUI() {
        document.querySelectorAll('.param-slider').forEach(s => {
            const param = s.dataset.param;
            if (this.state[param] !== undefined) {
                s.value = this.state[param];
                const span = document.getElementById(`${s.id}-val`);
                if (span) span.textContent = this.state[param];
            }
        });
    }

    render() {
        if (!this.originalImageData) return;

        const img = new ImageData(
            new Uint8ClampedArray(this.originalImageData.data),
            this.originalImageData.width,
            this.originalImageData.height
        );
        const data = img.data;

        // 1. Rood licht & Bleed recovery
        if (this.state.stageRedFix > 0) {
            this.wasm.recoverRedLight(
                img,
                0.68,
                this.state.stageRedFix / 100.0,
                this.state.skinProtection / 100.0,
                this.state.colorBleedReduction / 100.0
            );
        }

        // 2. Ruisonderdrukking
        if (this.state.denoiseLuma > 0 || this.state.denoiseChroma > 0) {
            this.wasm.denoise(
                img,
                this.state.denoiseLuma > 60 ? 2 : 1,
                1.0 + (this.state.denoiseLuma / 100.0) * 2.5,
                15.0 + (this.state.denoiseLuma / 100.0) * 35.0,
                this.state.denoiseChroma / 100.0
            );
        }

        // 3. Lightroom Basics (Exposure, Contrast, Highlights, Shadows, Temp, Tint, Sat)
        const exp = Math.pow(2.0, this.state.exposure / 2.0);
        const cont = (this.state.contrast + 100.0) / 100.0;
        const temp = (this.state.temp / 100.0) * 35.0;
        const tint = (this.state.tint / 100.0) * 20.0;
        const sat = (this.state.saturation + 100.0) / 100.0;
        const vib = (this.state.vibrance / 100.0);

        for (let i = 0; i < data.length; i += 4) {
            let r = data[i] * exp + temp + tint * 0.25;
            let g = data[i + 1] * exp - tint * 0.5;
            let b = data[i + 2] * exp - temp + tint * 0.25;

            // Contrast
            r = 128.0 + (r - 128.0) * cont;
            g = 128.0 + (g - 128.0) * cont;
            b = 128.0 + (b - 128.0) * cont;

            // Verzadiging & Levendigheid
            const gray = 0.299 * r + 0.587 * g + 0.114 * b;
            const maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
            const curSat = maxC === 0 ? 0 : (maxC - minC) / maxC;
            const effSat = sat * (1.0 + (1.0 - curSat) * vib);

            data[i]     = Math.min(255, Math.max(0, (gray + (r - gray) * effSat) | 0));
            data[i + 1] = Math.min(255, Math.max(0, (gray + (g - gray) * effSat) | 0));
            data[i + 2] = Math.min(255, Math.max(0, (gray + (b - gray) * effSat) | 0));
        }

        // 4. Tone Curve
        if (this.curveLut) {
            for (let i = 0; i < data.length; i += 4) {
                data[i]     = this.curveLut[data[i]];
                data[i + 1] = this.curveLut[data[i + 1]];
                data[i + 2] = this.curveLut[data[i + 2]];
            }
        }

        // 5. Knallend Zwart-Wit
        if (this.state.bwEnabled) {
            this.wasm.punchyBW(
                img,
                (this.state.bwRed + 100) / 100.0,
                (this.state.bwGreen + 100) / 100.0,
                (this.state.bwBlue + 100) / 100.0,
                this.state.bwContrast,
                this.state.bwClarity,
                this.state.bwGrain
            );
        }

        this.currentImageData = img;
        this.drawCanvas();
        this.updateHistogram(img);
    }

    drawCanvas() {
        if (!this.currentImageData || !this.ctx) return;
        const w = this.currentImageData.width, h = this.currentImageData.height;
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w; this.canvas.height = h;
        }

        if (this.isBeforeAfterActive) {
            this.ctx.putImageData(this.currentImageData, 0, 0);
            const splitX = Math.floor(w * this.splitComparePos);
            this.ctx.save();
            this.ctx.beginPath();
            this.ctx.rect(0, 0, splitX, h);
            this.ctx.clip();
            this.ctx.putImageData(this.originalImageData, 0, 0);
            this.ctx.restore();

            // Lijn
            this.ctx.strokeStyle = '#38bdf8';
            this.ctx.lineWidth = 2.5;
            this.ctx.beginPath();
            this.ctx.moveTo(splitX, 0);
            this.ctx.lineTo(splitX, h);
            this.ctx.stroke();

            this.ctx.fillStyle = '#ffffff';
            this.ctx.font = 'bold 13px system-ui';
            this.ctx.fillText('VOOR', Math.max(10, splitX - 55), 26);
            this.ctx.fillText('NA', splitX + 12, 26);
        } else {
            this.ctx.putImageData(this.currentImageData, 0, 0);
        }

        if (this.activeTool === 'inpaint' && this.maskCanvas) {
            this.ctx.save();
            this.ctx.globalAlpha = 0.45;
            this.ctx.drawImage(this.maskCanvas, 0, 0);
            this.ctx.restore();
        }
    }

    // Topaz Super-Resolution
    upscale(scale = 2) {
        if (!this.currentImageData) return;
        const sharpness = parseFloat(document.getElementById('upscale-sharpness')?.value || 50);
        document.getElementById('loading-overlay')?.classList.remove('hidden');

        setTimeout(() => {
            let res = this.wasm.superRes2x(this.currentImageData, sharpness);
            if (scale === 4) res = this.wasm.superRes2x(res, sharpness * 0.7);
            this.setImage(res, {
                filename: `topaz_upscale_${scale}x.jpg`,
                filesize: `${(res.width * res.height * 4 / 1024 / 1024).toFixed(1)} MB`
            });
            document.getElementById('loading-overlay')?.classList.add('hidden');
            alert(`✨ Succesvol vergroot naar ${res.width} × ${res.height} pixels met Topaz Super-Resolution!`);
        }, 50);
    }

    // Firefly Inpaint Masker
    initMask(w, h) {
        if (!this.maskCanvas) this.maskCanvas = document.createElement('canvas');
        this.maskCanvas.width = w; this.maskCanvas.height = h;
        this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true });
        this.clearMask();
    }
    clearMask() {
        if (!this.maskCtx) return;
        this.maskCtx.fillStyle = '#000000';
        this.maskCtx.fillRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
        this.drawCanvas();
    }
    paintMask(e) {
        const rect = this.canvas.getBoundingClientRect();
        const sx = this.canvas.width / rect.width, sy = this.canvas.height / rect.height;
        const x = (e.clientX - rect.left) * sx, y = (e.clientY - rect.top) * sy;
        const size = parseInt(document.getElementById('inpaint-brush-size')?.value || 25);
        this.maskCtx.fillStyle = '#ffffff';
        this.maskCtx.beginPath();
        this.maskCtx.arc(x, y, size, 0, Math.PI * 2);
        this.maskCtx.fill();
        this.drawCanvas();
    }
    applyInpaint() {
        if (!this.originalImageData) return;
        const mData = this.maskCtx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height).data;
        const mask = new Uint8Array(this.maskCanvas.width * this.maskCanvas.height);
        for (let i = 0, j = 0; i < mData.length; i += 4, j++) mask[j] = mData[i];
        this.wasm.smartInpaint(this.originalImageData, mask, 6);
        this.clearMask();
        this.render();
    }

    // Presets
    applyBWPreset(preset) {
        this.state.bwEnabled = true;
        document.getElementById('toggle-bw-mode').checked = true;
        document.getElementById('bw-mixer-panel')?.classList.remove('disabled');

        const map = {
            'knallend_contrast': { r: 45, g: 10, b: -25, c: 50, cl: 55, gr: 12 },
            'ansel_adams':       { r: 35, g: 20, b: -15, c: 35, cl: 40, gr: 8 },
            'film_noir':         { r: 50, g: -10, b: -35, c: 65, cl: 50, gr: 25 },
            'dramatic_street':   { r: 30, g: 15, b: -10, c: 30, cl: 65, gr: 18 }
        };
        const p = map[preset] || map['knallend_contrast'];
        this.state.bwRed = p.r; this.state.bwGreen = p.g; this.state.bwBlue = p.b;
        this.state.bwContrast = p.c; this.state.bwClarity = p.cl; this.state.bwGrain = p.gr;
        this.syncUI();
        this.render();
    }

    applyGlobalPreset(name) {
        if (name === 'stage_fix') {
            this.state.stageRedFix = 90; this.state.colorBleedReduction = 75; this.state.skinProtection = 65;
            this.state.highlights = -30; this.state.shadows = 20;
        } else if (name === 'punchy_bw') {
            this.applyBWPreset('knallend_contrast');
        } else if (name === 'crisp_landscape') {
            this.state.exposure = 0.2; this.state.contrast = 25; this.state.highlights = -20; this.state.shadows = 25; this.state.vibrance = 35;
        } else if (name === 'portrait_clean') {
            this.state.exposure = 0.3; this.state.contrast = 10; this.state.denoiseLuma = 30; this.state.denoiseChroma = 45; this.state.temp = 8;
        }
        this.syncUI();
        this.render();
    }

    resetSection(s) {
        const d = this.getDefaultState();
        if (s === 'stage_red') ['stageRedFix', 'colorBleedReduction', 'skinProtection', 'gamutCompress'].forEach(k => this.state[k] = d[k]);
        if (s === 'denoise') ['denoiseLuma', 'denoiseChroma', 'denoiseDetail'].forEach(k => this.state[k] = d[k]);
        if (s === 'tone') ['exposure', 'contrast', 'highlights', 'shadows'].forEach(k => this.state[k] = d[k]);
        this.syncUI();
        this.render();
    }

    rotate(deg) {
        if (!this.originalImageData) return;
        const s = this.originalImageData, dst = new ImageData(s.height, s.width);
        for (let y = 0; y < s.height; y++) {
            for (let x = 0; x < s.width; x++) {
                const sI = (y * s.width + x) * 4;
                const dx = deg === 90 ? s.height - 1 - y : y;
                const dy = deg === 90 ? x : s.width - 1 - x;
                const dI = (dy * dst.width + dx) * 4;
                for (let c = 0; c < 4; c++) dst.data[dI + c] = s.data[sI + c];
            }
        }
        this.setImage(dst);
    }

    flipH() {
        if (!this.originalImageData) return;
        const s = this.originalImageData, dst = new ImageData(s.width, s.height);
        for (let y = 0; y < s.height; y++) {
            for (let x = 0; x < s.width; x++) {
                const sI = (y * s.width + x) * 4;
                const dI = (y * s.width + (s.width - 1 - x)) * 4;
                for (let c = 0; c < 4; c++) dst.data[dI + c] = s.data[sI + c];
            }
        }
        this.setImage(dst);
    }

    // Procedurale voorbeeldfoto's
    loadSamplePhoto(id) {
        const w = 1200, h = 800;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');

        if (id === 'concert_red') {
            const bg = ctx.createLinearGradient(0, 0, w, h);
            bg.addColorStop(0, '#0a0305'); bg.addColorStop(1, '#1e050c');
            ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);

            // Gezicht / Artiest
            ctx.fillStyle = '#9a6b55';
            ctx.beginPath(); ctx.arc(600, 390, 110, 0, Math.PI * 2); ctx.fill();

            // Fel rood podiumlicht blowout
            const redGlow = ctx.createRadialGradient(600, 370, 20, 600, 370, 440);
            redGlow.addColorStop(0, 'rgba(255, 20, 15, 1.0)');
            redGlow.addColorStop(0.4, 'rgba(255, 0, 30, 0.95)');
            redGlow.addColorStop(0.7, 'rgba(220, 0, 45, 0.65)');
            redGlow.addColorStop(1, 'rgba(90, 0, 20, 0.0)');
            ctx.fillStyle = redGlow; ctx.fillRect(0, 0, w, h);

            ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 6;
            ctx.beginPath(); ctx.moveTo(560, 490); ctx.lineTo(600, 410); ctx.stroke();
            ctx.fillStyle = '#ffffff'; ctx.font = 'bold 20px system-ui';
            ctx.fillText('Voorbeeld: Podiumconcert met Overbelicht Rood Licht & Kleurdoorloop', 40, 60);

        } else if (id === 'noisy_night') {
            ctx.fillStyle = '#0b0f19'; ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#1e293b'; ctx.fillRect(150, 280, 220, 520);
            ctx.fillRect(440, 180, 320, 620); ctx.fillRect(830, 320, 250, 480);

            const imgD = ctx.getImageData(0, 0, w, h);
            for (let i = 0; i < imgD.data.length; i += 4) {
                const n = (Math.random() - 0.5) * 80;
                const cR = (Math.random() - 0.5) * 60, cB = (Math.random() - 0.5) * 60;
                imgD.data[i] = Math.min(255, Math.max(0, imgD.data[i] + n + cR));
                imgD.data[i + 1] = Math.min(255, Math.max(0, imgD.data[i + 1] + n));
                imgD.data[i + 2] = Math.min(255, Math.max(0, imgD.data[i + 2] + n + cB));
            }
            ctx.putImageData(imgD, 0, 0);
            ctx.fillStyle = '#ffffff'; ctx.font = 'bold 20px system-ui';
            ctx.fillText('Voorbeeld: Hoge ISO Nachtopname (Veel Luminantie- & Kleurruis)', 40, 60);
        } else {
            const sky = ctx.createLinearGradient(0, 0, 0, h);
            sky.addColorStop(0, '#38bdf8'); sky.addColorStop(0.5, '#bae6fd');
            sky.addColorStop(0.51, '#15803d'); sky.addColorStop(1, '#14532d');
            ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#475569';
            ctx.beginPath(); ctx.moveTo(100, 400); ctx.lineTo(350, 140); ctx.lineTo(600, 400); ctx.fill();
            ctx.beginPath(); ctx.moveTo(500, 400); ctx.lineTo(750, 120); ctx.lineTo(1050, 400); ctx.fill();
            ctx.fillStyle = '#ffffff'; ctx.font = 'bold 20px system-ui';
            ctx.fillText('Voorbeeld: Berglandschap (Perfect voor Knallend Zwart-Wit & Curves)', 40, 60);
        }

        const sample = ctx.getImageData(0, 0, w, h);
        this.setImage(sample, { filename: `${id}.dng`, filesize: '3.6 MB' });
    }

    // Histogram
    initHistogram() {
        this.hCanvas = document.getElementById('histogram-canvas');
        this.hCtx = this.hCanvas ? this.hCanvas.getContext('2d') : null;
    }
    updateHistogram(img) {
        if (!this.hCtx || !this.hCanvas) return;
        const d = img.data, hR = new Uint32Array(256), hG = new Uint32Array(256), hB = new Uint32Array(256);
        const step = Math.max(1, Math.floor(d.length / 400000));
        for (let i = 0; i < d.length; i += 4 * step) {
            hR[d[i]]++; hG[d[i + 1]]++; hB[d[i + 2]]++;
        }
        let max = 1;
        for (let i = 2; i < 254; i++) max = Math.max(max, hR[i], hG[i], hB[i]);
        const w = this.hCanvas.width, h = this.hCanvas.height;
        this.hCtx.clearRect(0, 0, w, h);
        const draw = (arr, color) => {
            this.hCtx.fillStyle = color;
            this.hCtx.beginPath(); this.hCtx.moveTo(0, h);
            for (let i = 0; i < 256; i++) {
                this.hCtx.lineTo((i / 255) * w, h - Math.min(h, (arr[i] / max) * (h * 0.9)));
            }
            this.hCtx.lineTo(w, h); this.hCtx.fill();
        };
        this.hCtx.globalCompositeOperation = 'screen';
        draw(hR, 'rgba(239, 68, 68, 0.45)');
        draw(hG, 'rgba(34, 197, 94, 0.45)');
        draw(hB, 'rgba(56, 189, 248, 0.45)');
        this.hCtx.globalCompositeOperation = 'source-over';
    }

    // Tone Curve
    initToneCurve() {
        this.cCanvas = document.getElementById('curve-canvas');
        this.cCtx = this.cCanvas ? this.cCanvas.getContext('2d') : null;
        this.curvePoints = [{ x: 0, y: 0 }, { x: 0.25, y: 0.25 }, { x: 0.75, y: 0.75 }, { x: 1, y: 1 }];
        this.curveLut = new Uint8Array(256);
        this.updateCurveLut();
        this.drawCurve();

        document.getElementById('btn-reset-curve')?.addEventListener('click', () => {
            this.curvePoints = [{ x: 0, y: 0 }, { x: 0.25, y: 0.25 }, { x: 0.75, y: 0.75 }, { x: 1, y: 1 }];
            this.updateCurveLut();
            this.drawCurve();
            this.render();
        });
    }

    updateCurveLut() {
        for (let i = 0; i < 256; i++) {
            const x = i / 255.0;
            let y = x;
            for (let s = 0; s < this.curvePoints.length - 1; s++) {
                const p0 = this.curvePoints[s], p1 = this.curvePoints[s + 1];
                if (x >= p0.x && x <= p1.x) {
                    const t = (x - p0.x) / (p1.x - p0.x || 0.001);
                    y = p0.y + (p1.y - p0.y) * (t * t * (3 - 2 * t));
                    break;
                }
            }
            this.curveLut[i] = Math.min(255, Math.max(0, (y * 255.0) | 0));
        }
    }

    drawCurve() {
        if (!this.cCtx || !this.cCanvas) return;
        const w = this.cCanvas.width, h = this.cCanvas.height;
        this.cCtx.clearRect(0, 0, w, h);
        this.cCtx.strokeStyle = '#1e293b'; this.cCtx.lineWidth = 1;
        for (let i = 1; i < 4; i++) {
            this.cCtx.beginPath(); this.cCtx.moveTo((i / 4) * w, 0); this.cCtx.lineTo((i / 4) * w, h); this.cCtx.stroke();
            this.cCtx.beginPath(); this.cCtx.moveTo(0, (i / 4) * h); this.cCtx.lineTo(w, (i / 4) * h); this.cCtx.stroke();
        }
        this.cCtx.strokeStyle = '#38bdf8'; this.cCtx.lineWidth = 2.5;
        this.cCtx.beginPath();
        for (let i = 0; i < 256; i++) {
            const cx = (i / 255) * w, cy = (1.0 - (this.curveLut[i] / 255.0)) * h;
            if (i === 0) this.cCtx.moveTo(cx, cy); else this.cCtx.lineTo(cx, cy);
        }
        this.cCtx.stroke();
    }

    // Export
    exportImage() {
        if (!this.currentImageData) return;
        const format = document.getElementById('export-format')?.value || 'image/jpeg';
        const q = parseFloat(document.getElementById('export-quality')?.value || 0.95);
        const expCanvas = document.createElement('canvas');
        expCanvas.width = this.currentImageData.width; expCanvas.height = this.currentImageData.height;
        const ctx = expCanvas.getContext('2d');
        ctx.putImageData(this.currentImageData, 0, 0);
        const url = expCanvas.toDataURL(format, q);
        const ext = format === 'image/png' ? 'png' : (format === 'image/webp' ? 'webp' : 'jpg');
        const a = document.createElement('a');
        a.download = `vroonphoto_${Date.now()}.${ext}`;
        a.href = url;
        a.click();
        document.getElementById('export-modal')?.classList.add('hidden');
    }
}

// Start app bij DOMContentLoaded
window.addEventListener('DOMContentLoaded', () => {
    window.vroonApp = new VroonPhotoApp();
    window.vroonApp.init();
});
