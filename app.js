/**
 * app.js
 * Hoofdcontroller voor vroonphoto met 25-Foto Batch Beheer & Mapkeuze op Apparaat
 * Geïnspireerd op de architectuur en stijl van Peters eerdere apps (PetersWorld)
 * Ondersteunt laptops én iPads met touch-bediening, Filmstrip, Rasteroverzicht,
 * File System Access API ("Kies map op apparaat") en iOS "Bewaar in Bestanden".
 */

const CFG = {
    appName: 'vroonphoto',
    versionFile: 'version.json',
    wasmFile: 'vroonphoto.wasm',
    maxPhotos: 25
};

let currentVersion = null;

// ═══════════════════════════════════════════════════════
//  1. VERSIEDETECTIE & GEFORCEERDE UPDATE (PETERSWORLD ENGINE)
// ═══════════════════════════════════════════════════════

async function forceAppUpdate() {
    console.log('🔄 Bezig met forceren van app update & cache purge...');
    try {
        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (const reg of registrations) await reg.unregister();
        }
    } catch (e) {}

    try {
        if ('caches' in window) {
            const keys = await caches.keys();
            for (const k of keys) await caches.delete(k);
        }
    } catch (e) {}

    try {
        localStorage.clear();
        sessionStorage.clear();
    } catch (e) {}

    let latestVer = Date.now();
    try {
        const res = await fetch(`${CFG.versionFile}?nocache=${Date.now()}`, { cache: 'no-store' });
        if (res.ok) {
            const data = await res.json();
            if (data && data.version) latestVer = data.version;
        }
    } catch (e) {}

    setTimeout(() => {
        window.location.replace(`index.html?v=${latestVer}&t=${Date.now()}`);
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
            await forceAppUpdate();
        }
    } catch (e) {
        if (!silent) await forceAppUpdate();
    }
}

async function applyUpdate() {
    await forceAppUpdate();
}

// ═══════════════════════════════════════════════════════
//  2. WEBASSEMBLY HARDWARE KERNEL
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
                    console.log(`⚡ [vroonphoto WASM] Hardware acceleratie geactiveerd via ${path}`);
                    return true;
                }
            } catch (e) {}
        }
        console.warn('⚠️ [vroonphoto WASM] Fallback naar geoptimaliseerde JS routines');
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

    removeStageBanding(imageData, strength) {
        const { data, width, height } = imageData;
        const totalBytes = width * height * 4;

        if (this.isReady && this.instance.exports.vroon_remove_stage_banding) {
            this.ensureMemory(totalBytes);
            const mem = new Uint8Array(this.memory.buffer);
            mem.set(data.subarray(0, totalBytes), 0);
            this.instance.exports.vroon_remove_stage_banding(0, width, height, strength);
            data.set(mem.subarray(0, totalBytes));
            return;
        }

        // JS Fallback
        if (strength <= 0.01) return;
        const s = strength / 100.0;
        const halfWin = 10;
        const rowAvgR = new Float32Array(height);
        const rowAvgG = new Float32Array(height);
        const rowAvgB = new Float32Array(height);

        for (let y = 0; y < height; y++) {
            let sumR = 0, sumG = 0, sumB = 0;
            const rOffset = y * width * 4;
            for (let x = 0; x < width; x++) {
                const idx = rOffset + x * 4;
                sumR += data[idx];
                sumG += data[idx + 1];
                sumB += data[idx + 2];
            }
            rowAvgR[y] = sumR / width;
            rowAvgG[y] = sumG / width;
            rowAvgB[y] = sumB / width;
        }

        const baseR = new Float32Array(height);
        const baseG = new Float32Array(height);
        const baseB = new Float32Array(height);

        for (let y = 0; y < height; y++) {
            let bR = 0, bG = 0, bB = 0, cnt = 0;
            for (let dy = -halfWin; dy <= halfWin; dy++) {
                const py = y + dy;
                if (py >= 0 && py < height) {
                    bR += rowAvgR[py];
                    bG += rowAvgG[py];
                    bB += rowAvgB[py];
                    cnt++;
                }
            }
            baseR[y] = bR / cnt;
            baseG[y] = bG / cnt;
            baseB[y] = bB / cnt;
        }

        for (let y = 0; y < height; y++) {
            const rawR = rowAvgR[y], bR = baseR[y];
            const rawG = rowAvgG[y], bG = baseG[y];
            const rawB = rowAvgB[y], bB = baseB[y];

            const corrR = rawR > 1.0 ? 1.0 + ((bR / rawR) - 1.0) * s : 1.0;
            const corrG = rawG > 1.0 ? 1.0 + ((bG / rawG) - 1.0) * s : 1.0;
            const corrB = rawB > 1.0 ? 1.0 + ((bB / rawB) - 1.0) * s : 1.0;

            const clampR = Math.max(0.65, Math.min(1.45, corrR));
            const clampG = Math.max(0.65, Math.min(1.45, corrG));
            const clampB = Math.max(0.65, Math.min(1.45, corrB));

            const rOffset = y * width * 4;
            for (let x = 0; x < width; x++) {
                const idx = rOffset + x * 4;
                data[idx]     = Math.min(255, Math.max(0, (data[idx] * clampR) | 0));
                data[idx + 1] = Math.min(255, Math.max(0, (data[idx + 1] * clampG) | 0));
                data[idx + 2] = Math.min(255, Math.max(0, (data[idx + 2] * clampB) | 0));
            }
        }
    }

    denoise(imageData, radius, spatialSigma, rangeSigma, chromaStrength) {
        const { data, width, height } = imageData;
        const totalBytes = width * height * 4;

        if (this.isReady && this.instance.exports.vroon_denoise_bilateral) {
            const srcOff = 0, dstOff = totalBytes;
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

    punchyBW(imageData, rw, gw, bw, contrast, clarity, grain) {
        const { data, width, height } = imageData;
        const totalBytes = width * height * 4;

        if (this.isReady && this.instance.exports.vroon_punchy_bw) {
            const srcOff = 0, dstOff = totalBytes;
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

    smartDeblur(imageData, sharpnessAmount, skinProtection = 75.0) {
        const { data, width, height } = imageData;
        const totalBytes = width * height * 4;

        if (this.isReady && this.instance.exports.vroon_smart_deblur) {
            this.ensureMemory(totalBytes);
            const mem = new Uint8Array(this.memory.buffer);
            mem.set(data.subarray(0, totalBytes), 0);
            this.instance.exports.vroon_smart_deblur(
                0, width, height, sharpnessAmount, skinProtection
            );
            data.set(mem.subarray(0, totalBytes));
            return;
        }

        // JS Fallback met gezichtsbehoud
        if (sharpnessAmount <= 0.01) return;
        const boost = (sharpnessAmount / 100.0) * 1.25;
        const skinSafe = (skinProtection / 100.0);
        const copy = new Uint8ClampedArray(data);

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = (y * width + x) * 4;
                const r = copy[idx], g = copy[idx + 1], b = copy[idx + 2];
                const up = ((y - 1) * width + x) * 4;
                const dn = ((y + 1) * width + x) * 4;
                const lf = (y * width + (x - 1)) * 4;
                const rt = (y * width + (x + 1)) * 4;

                const avgR = (copy[up] + copy[dn] + copy[lf] + copy[rt]) * 0.25;
                const avgG = (copy[up + 1] + copy[dn + 1] + copy[lf + 1] + copy[rt + 1]) * 0.25;
                const avgB = (copy[up + 2] + copy[dn + 2] + copy[lf + 2] + copy[rt + 2]) * 0.25;

                let effBoost = boost;
                // Menselijke huidskleur detectie
                if (r > 60 && r > g && g > b) {
                    const skinRatio = (g - b) / (r - b + 0.001);
                    if (skinRatio > 0.25 && skinRatio < 0.70) {
                        effBoost = boost * (1.0 - skinSafe * 0.75);
                    }
                }

                data[idx]     = Math.min(255, Math.max(0, (r + (r - avgR) * effBoost) | 0));
                data[idx + 1] = Math.min(255, Math.max(0, (g + (g - avgG) * effBoost) | 0));
                data[idx + 2] = Math.min(255, Math.max(0, (b + (b - avgB) * effBoost) | 0));
            }
        }
    }
}

// ═══════════════════════════════════════════════════════
//  3. VROONPHOTO 25-FOTO BATCH & WORKSPACE MANAGER
// ═══════════════════════════════════════════════════════

class VroonPhotoApp {
    constructor() {
        this.wasm = new WasmKernel();
        this.canvas = document.getElementById('main-canvas');
        this.ctx = this.canvas ? this.canvas.getContext('2d', { willReadFrequently: true }) : null;

        // Multi-Foto Array (max 25 foto's)
        this.photos = [];
        this.activePhotoIndex = -1;
        this.viewMode = 'develop'; // 'develop' of 'grid'

        this.isBeforeAfterActive = false;
        this.splitComparePos = 0.5;
        this.activeTool = 'adjust';

        this.maskCanvas = null;
        this.maskCtx = null;

        // Touch, Hand & Pen (Apple Pencil / Stylus) & Zoom State
        this.zoomLevel = 1.0;
        this.panX = 0;
        this.panY = 0;
        this.activePointerType = 'mouse';
        this.activePointers = new Map();
        this.lastPointerPos = null;
        this.initialPinchDist = 0;
        this.initialZoom = 1.0;
        this.lastPenTime = 0;
        this.lastTapTime = 0;

        // Aangepast Automatisch Import Profiel (bv. ruisonderdrukking, rood licht, banding reductie)
        this.customImportPreset = this.loadCustomImportPreset();
    }

    getDefaultState() {
        return {
            exposure: 0, contrast: 0, highlights: 0, shadows: 0,
            temp: 0, tint: 0, vibrance: 0, saturation: 0,
            stageRedFix: 0, colorBleedReduction: 0, skinProtection: 50, gamutCompress: 50,
            stageBandingReduction: 0,
            smartDeblur: 0, deblurSkinProtect: 75,
            denoiseLuma: 0, denoiseChroma: 0, denoiseDetail: 50,
            bwEnabled: false, bwRed: 40, bwGreen: 10, bwBlue: -10,
            bwContrast: 35, bwClarity: 45, bwGrain: 10
        };
    }

    loadCustomImportPreset() {
        try {
            const raw = localStorage.getItem('vroonphoto_import_preset');
            if (raw) {
                const parsed = JSON.parse(raw);
                return {
                    enabled: parsed.enabled !== false,
                    settings: parsed.settings || null
                };
            }
        } catch (e) {
            console.warn('Kon opgeslagen import profiel niet laden:', e);
        }
        return { enabled: true, settings: null };
    }

    saveCurrentAsImportPreset() {
        const photo = this.getActivePhoto();
        if (!photo) {
            alert("Open eerst een foto of pas sliders aan om als import profiel op te slaan.");
            return;
        }

        const settingsCopy = JSON.parse(JSON.stringify(photo.state));
        this.customImportPreset = {
            enabled: true,
            settings: settingsCopy
        };
        try {
            localStorage.setItem('vroonphoto_import_preset', JSON.stringify(this.customImportPreset));
        } catch (e) {
            console.warn('Kon import profiel niet opslaan in localStorage:', e);
        }

        this.updateImportPresetUI();
        alert("✅ Huidige bewerkingsinstellingen zijn opgeslagen als automatisch import profiel! Nieuwe foto's krijgen deze instellingen automatisch bij het importeren.");
    }

    resetImportPreset() {
        try {
            localStorage.removeItem('vroonphoto_import_preset');
        } catch (e) {}
        this.customImportPreset = { enabled: false, settings: null };
        this.updateImportPresetUI();
        alert("ℹ️ Automatisch import profiel gereset naar fabrieksinstellingen.");
    }

    updateImportPresetUI() {
        const toggle = document.getElementById('toggle-auto-import-preset');
        const summary = document.getElementById('import-preset-summary');
        if (!summary) return;

        if (toggle) {
            toggle.checked = this.customImportPreset && this.customImportPreset.enabled;
        }

        if (this.customImportPreset && this.customImportPreset.settings) {
            const s = this.customImportPreset.settings;
            const parts = [];
            if (s.stageRedFix > 0) parts.push(`Rood ${s.stageRedFix}%`);
            if (s.stageBandingReduction > 0) parts.push(`Banding ${s.stageBandingReduction}%`);
            if (s.denoiseLuma > 0 || s.denoiseChroma > 0) parts.push(`Ruis ${s.denoiseLuma || s.denoiseChroma}%`);
            if (s.smartDeblur > 0) parts.push(`Focus ${s.smartDeblur}%`);
            if (s.exposure !== 0) parts.push(`Belichting ${s.exposure > 0 ? '+' : ''}${s.exposure}`);
            if (s.bwEnabled) parts.push(`Zwart-Wit`);
            const desc = parts.length > 0 ? parts.join(', ') : 'Aangepaste waarden';
            summary.innerHTML = `<span style="color: #38bdf8;">⚡ Actief profiel:</span> ${desc}`;
        } else {
            summary.innerHTML = `Standaard fabrieksinstellingen (geen profiel opgeslagen)`;
        }
    }

    applyImportPresetToAll() {
        if (!this.customImportPreset || !this.customImportPreset.settings) {
            alert("Er is nog geen import profiel opgeslagen. Pas eerst de gewenste sliders aan en klik op 'Huidige sliders opslaan als Import Profiel'.");
            return;
        }
        const s = this.customImportPreset.settings;
        let count = 0;
        this.photos.forEach(photo => {
            Object.assign(photo.state, JSON.parse(JSON.stringify(s)));
            count++;
        });
        const active = this.getActivePhoto();
        if (active) this.syncSliderUIFromPhoto(active);
        this.renderActivePhoto();
        alert(`✅ Automatisch import profiel succesvol toegepast op alle ${count} foto's in de sessie!`);
    }

    getActivePhoto() {
        if (this.activePhotoIndex >= 0 && this.activePhotoIndex < this.photos.length) {
            return this.photos[this.activePhotoIndex];
        }
        return null;
    }

    async init() {
        await this.wasm.init();
        await checkVersion(true);

        setInterval(() => checkVersion(true), 5 * 60 * 1000);

        this.initHistogram();
        this.initToneCurve();
        this.updateImportPresetUI();
        this.setupEventListeners();
        this.setupTouchInteractions();
        this.setupShortcuts();
        this.setupDropzone();

        // Standaard batch van voorbeeldfoto's laden voor directe demonstratie
        this.loadSampleBatch();
    }

    setupEventListeners() {
        // Automatisch Import Profiel bediening
        document.getElementById('toggle-auto-import-preset')?.addEventListener('change', (e) => {
            this.customImportPreset.enabled = e.target.checked;
            try {
                localStorage.setItem('vroonphoto_import_preset', JSON.stringify(this.customImportPreset));
            } catch (err) {}
            this.updateImportPresetUI();
        });
        document.getElementById('btn-save-as-import-preset')?.addEventListener('click', () => this.saveCurrentAsImportPreset());
        document.getElementById('btn-apply-import-preset-all')?.addEventListener('click', () => this.applyImportPresetToAll());
        document.getElementById('btn-reset-import-preset')?.addEventListener('click', () => this.resetImportPreset());

        // Sliders binding
        document.querySelectorAll('.param-slider').forEach(slider => {
            const param = slider.dataset.param;
            const valSpan = document.getElementById(`${slider.id}-val`);
            slider.addEventListener('input', (e) => {
                const photo = this.getActivePhoto();
                if (!photo) return;
                const val = parseFloat(e.target.value);
                if (param) photo.state[param] = val;
                if (valSpan) valSpan.textContent = val;
                this.renderActivePhoto();
            });
        });

        // Penseelgrootte slider binding & update
        const brushSlider = document.getElementById('inpaint-brush-size');
        const brushSpan = document.getElementById('brush-size-val');
        brushSlider?.addEventListener('input', (e) => {
            if (brushSpan) brushSpan.textContent = `${e.target.value}px`;
        });

        // Reset secties
        document.querySelectorAll('.btn-reset-section').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.resetSection(e.target.dataset.section);
            });
        });

        // Zwart-Wit Presets & Toggle
        document.querySelectorAll('.bw-preset-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.applyBWPreset(e.currentTarget.dataset.preset));
        });
        document.querySelectorAll('.preset-card').forEach(card => {
            card.addEventListener('click', (e) => this.applyGlobalPreset(e.currentTarget.dataset.preset));
        });
        const bwToggle = document.getElementById('toggle-bw-mode');
        bwToggle?.addEventListener('change', (e) => {
            const photo = this.getActivePhoto();
            if (!photo) return;
            photo.state.bwEnabled = e.target.checked;
            document.getElementById('bw-mixer-panel')?.classList.toggle('disabled', !photo.state.bwEnabled);
            this.renderActivePhoto();
        });

        // Topaz Super-Resolution
        document.getElementById('btn-upscale-2x')?.addEventListener('click', () => this.upscale(2));
        document.getElementById('btn-upscale-4x')?.addEventListener('click', () => this.upscale(4));

        // Object / Persoon Verwijderen Tool (Inpaint)
        document.getElementById('tool-inpaint')?.addEventListener('click', () => {
            this.activeTool = this.activeTool === 'inpaint' ? 'adjust' : 'inpaint';
            const isActive = this.activeTool === 'inpaint';
            document.getElementById('tool-inpaint').classList.toggle('active', isActive);
            const circle = document.getElementById('brush-cursor-circle');
            if (circle && !isActive) circle.style.display = 'none';
        });
        document.getElementById('btn-apply-heal')?.addEventListener('click', () => this.applyInpaint());
        document.getElementById('btn-clear-heal')?.addEventListener('click', () => this.clearMask());

        // Voor/Na toggle
        document.getElementById('btn-compare-toggle')?.addEventListener('click', () => {
            this.isBeforeAfterActive = !this.isBeforeAfterActive;
            document.getElementById('btn-compare-toggle').classList.toggle('active', this.isBeforeAfterActive);
            this.drawActiveCanvas();
        });

        // Navigatie Vorige / Volgende
        document.getElementById('btn-prev-photo')?.addEventListener('click', () => this.selectPrevPhoto());
        document.getElementById('btn-next-photo')?.addEventListener('click', () => this.selectNextPhoto());

        // Raster Overzicht Toggle
        document.getElementById('btn-toggle-grid')?.addEventListener('click', () => this.toggleGridMode());
        document.getElementById('btn-close-grid')?.addEventListener('click', () => this.toggleGridMode(false));

        // Synchroniseer instellingen naar alle foto's
        document.getElementById('btn-sync-all')?.addEventListener('click', () => this.syncSettingsToAll());
        document.getElementById('btn-filmstrip-sync')?.addEventListener('click', () => this.syncSettingsToAll());

        // Roterend
        document.getElementById('btn-rotate-left')?.addEventListener('click', () => this.rotateActivePhoto(-90));
        document.getElementById('btn-rotate-right')?.addEventListener('click', () => this.rotateActivePhoto(90));
        document.getElementById('btn-flip-h')?.addEventListener('click', () => this.flipActivePhotoH());

        // Opslaan & Exporteren Modal
        document.getElementById('btn-open-export')?.addEventListener('click', () => {
            document.getElementById('export-modal')?.classList.remove('hidden');
        });
        document.getElementById('btn-close-export')?.addEventListener('click', () => {
            document.getElementById('export-modal')?.classList.add('hidden');
        });
        document.getElementById('btn-choose-folder-export')?.addEventListener('click', () => this.exportWithFolderPicker());

        // Bestandsformaat wissel: update kwaliteitsopties dynamisch
        const exportFormatSel = document.getElementById('export-format');
        const exportQualitySel = document.getElementById('export-quality');
        exportFormatSel?.addEventListener('change', (e) => {
            const fmt = e.target.value;
            if (fmt === 'image/tiff' || fmt === 'image/x-adobe-dng' || fmt === 'image/png') {
                if (exportQualitySel) {
                    exportQualitySel.innerHTML = `
                        <option value="1.0">100% — Ongecomprimeerd / Lossless (Volledige Kwaliteit)</option>
                    `;
                }
            } else {
                if (exportQualitySel) {
                    exportQualitySel.innerHTML = `
                        <option value="0.95">95% — Maximale Professionele Kwaliteit (Aanbevolen)</option>
                        <option value="0.85">85% — Hoge Kwaliteit</option>
                        <option value="0.75">75% — Compact</option>
                    `;
                }
            }
        });

        // Zoom knoppen (Hand, Pen & Muis)
        document.getElementById('btn-zoom-in')?.addEventListener('click', () => this.setZoom(this.zoomLevel + 0.35));
        document.getElementById('btn-zoom-out')?.addEventListener('click', () => this.setZoom(this.zoomLevel - 0.35));
        document.getElementById('btn-zoom-reset')?.addEventListener('click', () => this.resetZoom());
        document.getElementById('zoom-level-text')?.addEventListener('click', () => this.resetZoom());

        // Update banner knoppen
        document.getElementById('btn-apply-upd')?.addEventListener('click', () => applyUpdate());
        document.getElementById('btn-dismiss-upd')?.addEventListener('click', () => {
            document.getElementById('update-banner')?.classList.remove('show');
        });

        // Bestanden openen (Header & Grid - Volledige JPG & RAW support)
        document.getElementById('file-upload-input')?.addEventListener('change', (e) => {
            if (e.target.files) this.loadMultipleFiles(e.target.files);
        });
        document.getElementById('grid-add-file-input')?.addEventListener('change', (e) => {
            if (e.target.files) this.loadMultipleFiles(e.target.files);
        });

        // Voorbeelden laden (Uniforme knop '📸 5 Voorbeeldfoto's')
        document.getElementById('btn-load-sample-batch')?.addEventListener('click', () => {
            this.loadSampleBatch();
        });
        document.getElementById('sample-photos-select')?.addEventListener('change', (e) => {
            if (e.target.value === 'batch_5') this.loadSampleBatch();
            else this.loadSingleSample(e.target.value);
        });
    }

    // Zoom & Pan Functies voor Hand (Touch), Pen en Muis
    setZoom(level, px = null, py = null) {
        this.zoomLevel = Math.max(1.0, Math.min(5.0, level));
        if (this.zoomLevel <= 1.02) {
            this.zoomLevel = 1.0;
            this.panX = 0;
            this.panY = 0;
        } else {
            if (px !== null) this.panX = px;
            if (py !== null) this.panY = py;
        }
        this.updateCanvasTransform();
        const txt = document.getElementById('zoom-level-text');
        if (txt) txt.textContent = `${Math.round(this.zoomLevel * 100)}%`;
    }

    resetZoom() {
        this.setZoom(1.0, 0, 0);
    }

    updateCanvasTransform() {
        if (!this.canvas) return;
        if (this.zoomLevel === 1.0 && this.panX === 0 && this.panY === 0) {
            this.canvas.style.transform = 'none';
        } else {
            this.canvas.style.transform = `scale(${this.zoomLevel}) translate(${this.panX / this.zoomLevel}px, ${this.panY / this.zoomLevel}px)`;
        }
    }

    // Invoermodus Detectie & Badge (Muis, Hand / Touch, Pen / Apple Pencil)
    updateInputMode(pointerType, pressure = 0) {
        this.activePointerType = pointerType || 'mouse';
        const badge = document.getElementById('input-mode-badge');
        if (!badge) return;

        badge.classList.remove('pen-mode', 'touch-mode');
        if (pointerType === 'pen') {
            this.lastPenTime = Date.now();
            badge.classList.add('pen-mode');
            const pressTxt = pressure > 0 ? ` (${Math.round(pressure * 100)}%)` : '';
            badge.textContent = `✏️ Pen / Stylus${pressTxt}`;
            badge.title = 'Apple Pencil of stylus pen actief met drukgevoeligheid';
        } else if (pointerType === 'touch') {
            badge.classList.add('touch-mode');
            badge.textContent = `👆 Hand / Touch`;
            badge.title = 'Aanraakscherm / vingerbediening actief';
        } else {
            badge.textContent = `🖱️ Muis`;
            badge.title = 'Muis of trackpad actief';
        }
    }

    // Vloeiende Penseelstreken met Drukgevoeligheid (Apple Pencil / Stylus)
    paintMaskStroke(clientX, clientY, pressure = 0.5, isStart = false) {
        if (!this.maskCtx || !this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const sx = this.canvas.width / rect.width;
        const sy = this.canvas.height / rect.height;
        const x = (clientX - rect.left) * sx;
        const y = (clientY - rect.top) * sy;

        const baseSize = parseInt(document.getElementById('inpaint-brush-size')?.value || 35);
        let effectiveRadius = baseSize;
        if (this.activePointerType === 'pen' && pressure > 0) {
            // Apple Pencil / Stylus pen drukgevoeligheid
            effectiveRadius = Math.max(4, baseSize * (0.35 + 0.65 * pressure));
        }

        this.maskCtx.fillStyle = '#ffffff';
        this.maskCtx.strokeStyle = '#ffffff';
        this.maskCtx.lineCap = 'round';
        this.maskCtx.lineJoin = 'round';
        this.maskCtx.lineWidth = effectiveRadius * 2;

        if (isStart || !this.lastPointerPos) {
            this.maskCtx.beginPath();
            this.maskCtx.arc(x, y, effectiveRadius, 0, Math.PI * 2);
            this.maskCtx.fill();
        } else {
            this.maskCtx.beginPath();
            this.maskCtx.moveTo(this.lastPointerPos.x, this.lastPointerPos.y);
            this.maskCtx.lineTo(x, y);
            this.maskCtx.stroke();
        }

        this.lastPointerPos = { x, y };
        this.drawActiveCanvas();
    }

    // Geünificeerde Pointer Events (Muis, Hand / Touch, Pen / Apple Pencil)
    setupTouchInteractions() {
        const updateCursorCircle = (clientX, clientY, pressure = 0.5) => {
            const circle = document.getElementById('brush-cursor-circle');
            if (!circle) return;
            if (this.activeTool !== 'inpaint') {
                circle.style.display = 'none';
                return;
            }
            const rect = this.canvas.getBoundingClientRect();
            if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
                circle.style.display = 'none';
                return;
            }
            const baseBrushSize = parseInt(document.getElementById('inpaint-brush-size')?.value || 35);
            let brushSize = baseBrushSize;
            if (this.activePointerType === 'pen' && pressure > 0) {
                brushSize = Math.max(4, baseBrushSize * (0.35 + 0.65 * pressure));
            }
            const scale = rect.width / this.canvas.width;
            const displayDiam = Math.max(10, brushSize * 2 * scale);
            circle.style.display = 'block';
            circle.style.width = `${displayDiam}px`;
            circle.style.height = `${displayDiam}px`;
            circle.style.left = `${clientX}px`;
            circle.style.top = `${clientY}px`;
        };

        // Pointer Down
        this.canvas.addEventListener('pointerdown', (e) => {
            this.updateInputMode(e.pointerType, e.pressure);

            // Palm Rejection: negeer onbedoelde palm touches als pen recent actief is geweest
            if (e.pointerType === 'touch' && (Date.now() - this.lastPenTime < 500)) {
                return;
            }

            try {
                this.canvas.setPointerCapture(e.pointerId);
            } catch (err) {}

            this.activePointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY, type: e.pointerType });

            // Detecteer dubbeltik (hand/pen/muis) voor snelle 100% Fit / 200% Zoom wissel
            const now = Date.now();
            if (now - this.lastTapTime < 320) {
                if (this.zoomLevel > 1.05) this.resetZoom();
                else this.setZoom(2.0, -(e.clientX - window.innerWidth / 2) * 0.6, -(e.clientY - window.innerHeight / 2) * 0.6);
                this.lastTapTime = 0;
                return;
            }
            this.lastTapTime = now;

            if (this.activePointers.size === 1) {
                this.lastPointerPos = null;
                if (this.activeTool === 'inpaint') {
                    this.paintMaskStroke(e.clientX, e.clientY, e.pressure, true);
                } else if (this.isBeforeAfterActive) {
                    const rect = this.canvas.getBoundingClientRect();
                    this.splitComparePos = Math.max(0.05, Math.min(0.95, (e.clientX - rect.left) / rect.width));
                    this.drawActiveCanvas();
                }
            } else if (this.activePointers.size === 2) {
                // Twee vingers (hand) pinch-to-zoom start
                this.lastPointerPos = null;
                const pts = Array.from(this.activePointers.values());
                this.initialPinchDist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
                this.initialZoom = this.zoomLevel;
                const circle = document.getElementById('brush-cursor-circle');
                if (circle) circle.style.display = 'none';
            }
            updateCursorCircle(e.clientX, e.clientY, e.pressure);
        });

        // Pointer Move
        window.addEventListener('pointermove', (e) => {
            if (this.activePointers.has(e.pointerId)) {
                this.activePointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY, type: e.pointerType });
                this.updateInputMode(e.pointerType, e.pressure);

                if (this.activePointers.size === 1) {
                    if (this.activeTool === 'inpaint') {
                        this.paintMaskStroke(e.clientX, e.clientY, e.pressure, false);
                    } else if (this.isBeforeAfterActive) {
                        const rect = this.canvas.getBoundingClientRect();
                        this.splitComparePos = Math.max(0.05, Math.min(0.95, (e.clientX - rect.left) / rect.width));
                        this.drawActiveCanvas();
                    } else if (this.zoomLevel > 1.0) {
                        // Hand of muis pan bij ingezoomde foto
                        this.panX += e.movementX || 0;
                        this.panY += e.movementY || 0;
                        this.updateCanvasTransform();
                    }
                } else if (this.activePointers.size === 2) {
                    // Twee vingers pinch-to-zoom en pan
                    const pts = Array.from(this.activePointers.values());
                    const currentDist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
                    if (this.initialPinchDist > 5) {
                        const scaleFactor = currentDist / this.initialPinchDist;
                        this.setZoom(this.initialZoom * scaleFactor);
                    }
                }
            }
            updateCursorCircle(e.clientX, e.clientY, e.pressure);
        });

        // Pointer Up & Pointer Cancel
        const handlePointerUp = (e) => {
            if (this.activePointers.has(e.pointerId)) {
                try {
                    this.canvas.releasePointerCapture(e.pointerId);
                } catch (err) {}
                this.activePointers.delete(e.pointerId);
            }
            if (this.activePointers.size === 0) {
                this.lastPointerPos = null;
            }
        };
        window.addEventListener('pointerup', handlePointerUp);
        window.addEventListener('pointercancel', handlePointerUp);

        this.canvas.addEventListener('pointerleave', () => {
            const circle = document.getElementById('brush-cursor-circle');
            if (circle) circle.style.display = 'none';
        });
    }

    setupShortcuts() {
        window.addEventListener('keydown', (e) => {
            if (e.key === '\\') {
                e.preventDefault();
                document.getElementById('btn-compare-toggle')?.click();
            } else if (e.key === 'ArrowRight' && !e.target.matches('input, select')) {
                this.selectNextPhoto();
            } else if (e.key === 'ArrowLeft' && !e.target.matches('input, select')) {
                this.selectPrevPhoto();
            }
        });
    }

    setupDropzone() {
        const drop = document.getElementById('viewport-dropzone');
        if (!drop) return;
        ['dragenter', 'dragover'].forEach(n => drop.addEventListener(n, e => e.preventDefault()));
        drop.addEventListener('drop', (e) => {
            e.preventDefault();
            if (e.dataTransfer.files) this.loadMultipleFiles(e.dataTransfer.files);
        });
    }

    // ═══════════════════════════════════════════════════════
    //  4. FOTO BEHEER (TOT 25 FOTO'S GELIJCKTIJDIG)
    // ═══════════════════════════════════════════════════════

    async loadMultipleFiles(fileList) {
        if (!fileList || fileList.length === 0) return;
        document.getElementById('loading-overlay')?.classList.remove('hidden');

        const remainingSlots = CFG.maxPhotos - this.photos.length;
        if (remainingSlots <= 0) {
            alert(`Het maximum van ${CFG.maxPhotos} foto's is bereikt. Verwijder eerst foto's om nieuwe toe te voegen.`);
            document.getElementById('loading-overlay')?.classList.add('hidden');
            return;
        }

        const filesToLoad = Array.from(fileList).slice(0, remainingSlots);

        for (const file of filesToLoad) {
            try {
                const bitmap = await createImageBitmap(file);
                const c = document.createElement('canvas');
                c.width = bitmap.width; c.height = bitmap.height;
                const ctx = c.getContext('2d');
                ctx.drawImage(bitmap, 0, 0);
                const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);

                this.addPhotoToSession(imgData, {
                    filename: file.name,
                    filesize: `${(file.size / 1024 / 1024).toFixed(2)} MB`
                });
            } catch (err) {
                console.warn('Fout bij importeren van foto:', file.name, err);
            }
        }

        document.getElementById('loading-overlay')?.classList.add('hidden');
        this.updateFilmstripUI();
        this.updateGridUI();
    }

    addPhotoToSession(imageData, meta = {}) {
        if (this.photos.length >= CFG.maxPhotos) return;

        // Maak kleine thumbnail voor de filmstrip
        const thumbCanvas = document.createElement('canvas');
        const aspect = imageData.width / imageData.height;
        thumbCanvas.width = 140;
        thumbCanvas.height = Math.round(140 / aspect);
        const tCtx = thumbCanvas.getContext('2d');

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = imageData.width; tempCanvas.height = imageData.height;
        tempCanvas.getContext('2d').putImageData(imageData, 0, 0);
        tCtx.drawImage(tempCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
        const thumbUrl = thumbCanvas.toDataURL('image/jpeg', 0.7);

        const photo = {
            id: 'photo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            filename: meta.filename || `Foto_${this.photos.length + 1}.jpg`,
            filesize: meta.filesize || '4.0 MB',
            originalImageData: new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height),
            currentImageData: new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height),
            thumbUrl: thumbUrl,
            state: this.getDefaultState(),
            hasStageRed: false
        };

        // Automatische podium rood licht en LED interferentiestrepen analyse per foto
        photo.hasStageRed = this.checkStageRed(photo.originalImageData);
        if (photo.hasStageRed) {
            photo.state.stageRedFix = 85;
            photo.state.colorBleedReduction = 65;
            photo.state.stageBandingReduction = 75; // Bij aanvang verdwijnen interferentiestrepen direct!
        }

        // Automatisch aangepast import profiel toepassen (indien ingeschakeld door gebruiker)
        if (this.customImportPreset && this.customImportPreset.enabled && this.customImportPreset.settings) {
            Object.assign(photo.state, JSON.parse(JSON.stringify(this.customImportPreset.settings)));
        }

        this.photos.push(photo);

        if (this.activePhotoIndex === -1) {
            this.setActivePhoto(0);
        } else {
            this.updateFilmstripUI();
            this.updateGridUI();
        }
    }

    setActivePhoto(index) {
        if (index < 0 || index >= this.photos.length) return;
        this.activePhotoIndex = index;
        const photo = this.photos[index];

        this.canvas.width = photo.currentImageData.width;
        this.canvas.height = photo.currentImageData.height;
        this.initMask(photo.currentImageData.width, photo.currentImageData.height);

        // Update info badge
        const badge = document.getElementById('photo-counter-badge');
        if (badge) badge.textContent = `${index + 1} / ${this.photos.length} Foto's`;

        const info = document.getElementById('photo-info-display');
        if (info) {
            info.textContent = `${photo.filename} | ${photo.currentImageData.width}×${photo.currentImageData.height}px | ${photo.filesize}`;
        }

        // Toon alert als rood podiumlicht actief is
        const alertBox = document.getElementById('stage-red-detected-alert');
        if (alertBox) {
            if (photo.hasStageRed) {
                alertBox.classList.remove('hidden');
                alertBox.innerHTML = `⚠️ <strong>Rood podiumlicht & LED interferentiestrepen gedetecteerd!</strong> Rood Licht Herstel & Banding Onderdrukking staan actief voor deze foto.`;
            } else {
                alertBox.classList.add('hidden');
            }
        }

        this.syncSliderUIFromPhoto(photo);
        this.renderActivePhoto();
        this.updateFilmstripUI();
        this.updateGridUI();
    }

    selectPrevPhoto() {
        if (this.photos.length <= 1) return;
        const nextIdx = (this.activePhotoIndex - 1 + this.photos.length) % this.photos.length;
        this.setActivePhoto(nextIdx);
    }

    selectNextPhoto() {
        if (this.photos.length <= 1) return;
        const nextIdx = (this.activePhotoIndex + 1) % this.photos.length;
        this.setActivePhoto(nextIdx);
    }

    removePhoto(index, e) {
        if (e) e.stopPropagation();
        if (this.photos.length <= 1) {
            alert('Je moet minstens één foto in de sessie behouden.');
            return;
        }
        this.photos.splice(index, 1);
        if (this.activePhotoIndex >= this.photos.length) {
            this.activePhotoIndex = this.photos.length - 1;
        }
        this.setActivePhoto(this.activePhotoIndex);
    }

    // Synchroniseer huidige bewerking naar alle foto's in de batch
    syncSettingsToAll() {
        const active = this.getActivePhoto();
        if (!active || this.photos.length <= 1) return;

        const count = this.photos.length;
        this.photos.forEach(p => {
            if (p.id !== active.id) {
                p.state = JSON.parse(JSON.stringify(active.state));
            }
        });

        this.renderActivePhoto();
        alert(`⚡ De instellingen van '${active.filename}' zijn succesvol gesynchroniseerd naar alle ${count} foto's!`);
    }

    toggleGridMode(forceState = null) {
        const gridCont = document.getElementById('grid-overview-container');
        const devPort = document.getElementById('develop-viewport');
        const toggleBtn = document.getElementById('btn-toggle-grid');

        if (forceState !== null) {
            this.viewMode = forceState ? 'grid' : 'develop';
        } else {
            this.viewMode = this.viewMode === 'develop' ? 'grid' : 'develop';
        }

        const isGrid = this.viewMode === 'grid';
        gridCont?.classList.toggle('hidden', !isGrid);
        devPort?.classList.toggle('hidden', isGrid);
        toggleBtn?.classList.toggle('active', isGrid);

        if (isGrid) this.updateGridUI();
    }

    // Filmstrip UI rendering
    updateFilmstripUI() {
        const container = document.getElementById('filmstrip-scroll');
        const countTxt = document.getElementById('filmstrip-count-txt');
        if (!container) return;
        if (countTxt) countTxt.textContent = `${this.photos.length} / ${CFG.maxPhotos}`;

        container.innerHTML = '';

        this.photos.forEach((photo, idx) => {
            const item = document.createElement('div');
            item.className = `filmstrip-item ${idx === this.activePhotoIndex ? 'active' : ''}`;
            item.title = `${photo.filename} (Foto ${idx + 1})`;
            item.onclick = () => this.setActivePhoto(idx);

            item.innerHTML = `
                <img src="${photo.thumbUrl}" alt="Thumb ${idx + 1}">
                <span class="filmstrip-badge">#${idx + 1}</span>
                <span class="filmstrip-close" title="Verwijderen" onclick="vroonApp.removePhoto(${idx}, event)">✕</span>
            `;
            container.appendChild(item);
        });

        // Voeg '+' toe als er nog ruimte is voor 25 foto's
        if (this.photos.length < CFG.maxPhotos) {
            const addCard = document.createElement('label');
            addCard.className = 'filmstrip-add-card';
            addCard.title = "Voeg foto's toe (tot 25)";
            addCard.innerHTML = `
                <span style="font-size: 16px;">➕</span>
                <span>Toevoegen</span>
                <input type="file" multiple accept="image/*,.raw,.dng,.cr2,.cr3,.nef,.arw,.rw2,.raf,.orf,.pef,.tiff,.tif" style="display:none;" onchange="vroonApp.loadMultipleFiles(this.files)">
            `;
            container.appendChild(addCard);
        }
    }

    // Raster Overzicht UI rendering (25 foto's overzichtelijk scherm)
    updateGridUI() {
        const grid = document.getElementById('photos-grid');
        const countTxt = document.getElementById('grid-count-txt');
        if (!grid) return;
        if (countTxt) countTxt.textContent = `${this.photos.length} / ${CFG.maxPhotos}`;

        grid.innerHTML = '';

        this.photos.forEach((photo, idx) => {
            const card = document.createElement('div');
            card.className = `grid-photo-card ${idx === this.activePhotoIndex ? 'active' : ''}`;
            card.onclick = () => {
                this.setActivePhoto(idx);
                this.toggleGridMode(false);
            };

            card.innerHTML = `
                <img class="grid-photo-thumb" src="${photo.thumbUrl}" alt="Photo ${idx + 1}">
                <div class="grid-photo-meta">
                    <span class="grid-photo-title">#${idx + 1} ${photo.filename}</span>
                    <span class="grid-photo-sub">
                        <span>${photo.filesize}</span>
                        ${photo.state.bwEnabled ? '<span style="color:#fff;">⚡ Zwart-Wit</span>' : ''}
                        ${photo.state.stageRedFix > 0 ? '<span style="color:#ef4444;">🔴 Rood Fix</span>' : ''}
                    </span>
                </div>
            `;
            grid.appendChild(card);
        });
    }

    syncSliderUIFromPhoto(photo) {
        document.querySelectorAll('.param-slider').forEach(s => {
            const p = s.dataset.param;
            if (photo.state[p] !== undefined) {
                s.value = photo.state[p];
                const span = document.getElementById(`${s.id}-val`);
                if (span) span.textContent = photo.state[p];
            }
        });
        const bwToggle = document.getElementById('toggle-bw-mode');
        if (bwToggle) bwToggle.checked = photo.state.bwEnabled;
        document.getElementById('bw-mixer-panel')?.classList.toggle('disabled', !photo.state.bwEnabled);
    }

    checkStageRed(imgData) {
        const d = imgData.data;
        let count = 0;
        const total = imgData.width * imgData.height;
        for (let i = 0; i < d.length; i += 4) {
            if (d[i] > 190 && d[i] > Math.max(d[i + 1], d[i + 2]) * 1.35) count++;
        }
        return (count / total) * 100 > 2.0;
    }

    // ═══════════════════════════════════════════════════════
    //  5. BEWERKINGSENGINE (PER FOTO WEERGAVE & RENDERING)
    // ═══════════════════════════════════════════════════════

    renderActivePhoto() {
        const photo = this.getActivePhoto();
        if (!photo) return;

        const img = new ImageData(
            new Uint8ClampedArray(photo.originalImageData.data),
            photo.originalImageData.width,
            photo.originalImageData.height
        );
        const data = img.data;

        // 1. Rood licht & Bleed recovery
        if (photo.state.stageRedFix > 0) {
            this.wasm.recoverRedLight(
                img,
                0.68,
                photo.state.stageRedFix / 100.0,
                photo.state.skinProtection / 100.0,
                photo.state.colorBleedReduction / 100.0
            );
        }

        // 1b. Podium LED Interferentiestrepen verwijderen (PWM Rolling Shutter Banding)
        if (photo.state.stageBandingReduction > 0) {
            this.wasm.removeStageBanding(img, photo.state.stageBandingReduction);
        }

        // 2. Ruisonderdrukking
        if (photo.state.denoiseLuma > 0 || photo.state.denoiseChroma > 0) {
            this.wasm.denoise(
                img,
                photo.state.denoiseLuma > 60 ? 2 : 1,
                1.0 + (photo.state.denoiseLuma / 100.0) * 2.5,
                15.0 + (photo.state.denoiseLuma / 100.0) * 35.0,
                photo.state.denoiseChroma / 100.0
            );
        }

        // 3. Slimme Focus & Deblur met Gezichtsbehoud
        if (photo.state.smartDeblur > 0) {
            this.wasm.smartDeblur(
                img,
                photo.state.smartDeblur,
                photo.state.deblurSkinProtect !== undefined ? photo.state.deblurSkinProtect : 75.0
            );
        }

        // 4. Lightroom Basics
        const exp = Math.pow(2.0, photo.state.exposure / 2.0);
        const cont = (photo.state.contrast + 100.0) / 100.0;
        const temp = (photo.state.temp / 100.0) * 35.0;
        const tint = (photo.state.tint / 100.0) * 20.0;
        const sat = (photo.state.saturation + 100.0) / 100.0;
        const vib = (photo.state.vibrance / 100.0);

        for (let i = 0; i < data.length; i += 4) {
            let r = data[i] * exp + temp + tint * 0.25;
            let g = data[i + 1] * exp - tint * 0.5;
            let b = data[i + 2] * exp - temp + tint * 0.25;

            r = 128.0 + (r - 128.0) * cont;
            g = 128.0 + (g - 128.0) * cont;
            b = 128.0 + (b - 128.0) * cont;

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
        if (photo.state.bwEnabled) {
            this.wasm.punchyBW(
                img,
                (photo.state.bwRed + 100) / 100.0,
                (photo.state.bwGreen + 100) / 100.0,
                (photo.state.bwBlue + 100) / 100.0,
                photo.state.bwContrast,
                photo.state.bwClarity,
                photo.state.bwGrain
            );
        }

        photo.currentImageData = img;
        this.drawActiveCanvas();
        this.updateHistogram(img);
    }

    drawActiveCanvas() {
        const photo = this.getActivePhoto();
        if (!photo || !this.ctx) return;

        const w = photo.currentImageData.width, h = photo.currentImageData.height;
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w; this.canvas.height = h;
        }

        if (this.isBeforeAfterActive) {
            this.ctx.putImageData(photo.currentImageData, 0, 0);
            const splitX = Math.floor(w * this.splitComparePos);
            this.ctx.save();
            this.ctx.beginPath();
            this.ctx.rect(0, 0, splitX, h);
            this.ctx.clip();
            this.ctx.putImageData(photo.originalImageData, 0, 0);
            this.ctx.restore();

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
            this.ctx.putImageData(photo.currentImageData, 0, 0);
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
        const photo = this.getActivePhoto();
        if (!photo) return;
        const sharpness = parseFloat(document.getElementById('upscale-sharpness')?.value || 50);
        document.getElementById('loading-overlay')?.classList.remove('hidden');

        setTimeout(() => {
            let res = this.wasm.superRes2x(photo.currentImageData, sharpness);
            if (scale === 4) res = this.wasm.superRes2x(res, sharpness * 0.7);
            photo.originalImageData = res;
            photo.currentImageData = res;
            this.setActivePhoto(this.activePhotoIndex);
            document.getElementById('loading-overlay')?.classList.add('hidden');
            alert(`✨ Foto succesvol vergroot naar ${res.width} × ${res.height} pixels met Topaz Super-Resolution!`);
        }, 50);
    }

    // Firefly Inpaint
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
        this.drawActiveCanvas();
    }
    paintMaskAtPoint(clientX, clientY) {
        this.paintMaskStroke(clientX, clientY, 0.5, false);
    }
    applyInpaint() {
        const photo = this.getActivePhoto();
        if (!photo) return;
        const mData = this.maskCtx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height).data;
        const mask = new Uint8Array(this.maskCanvas.width * this.maskCanvas.height);
        let hasMaskPixels = false;
        for (let i = 0, j = 0; i < mData.length; i += 4, j++) {
            mask[j] = mData[i];
            if (mData[i] > 100) hasMaskPixels = true;
        }

        if (!hasMaskPixels) {
            alert("Schilder eerst met de muis of je vinger over het object of de persoon die je wilt verwijderen.");
            return;
        }

        document.getElementById('loading-overlay')?.classList.remove('hidden');
        setTimeout(() => {
            // Multi-pass contextuele synthese voor naadloze objectverwijdering
            for (let pass = 0; pass < 3; pass++) {
                this.wasm.smartInpaint(photo.originalImageData, mask, 8);
            }
            this.clearMask();
            this.renderActivePhoto();
            document.getElementById('loading-overlay')?.classList.add('hidden');
        }, 40);
    }

    // Presets (12 Lightroom & AI Presets)
    applyBWPreset(preset) {
        const photo = this.getActivePhoto();
        if (!photo) return;
        photo.state.bwEnabled = true;
        document.getElementById('toggle-bw-mode').checked = true;
        document.getElementById('bw-mixer-panel')?.classList.remove('disabled');

        const map = {
            'knallend_contrast': { r: 45, g: 10, b: -25, c: 50, cl: 55, gr: 12 },
            'ansel_adams':       { r: 35, g: 20, b: -15, c: 35, cl: 40, gr: 8 },
            'film_noir':         { r: 50, g: -10, b: -35, c: 65, cl: 50, gr: 25 },
            'dramatic_street':   { r: 30, g: 15, b: -10, c: 30, cl: 65, gr: 18 }
        };
        const p = map[preset] || map['knallend_contrast'];
        photo.state.bwRed = p.r; photo.state.bwGreen = p.g; photo.state.bwBlue = p.b;
        photo.state.bwContrast = p.c; photo.state.bwClarity = p.cl; photo.state.bwGrain = p.gr;
        this.syncSliderUIFromPhoto(photo);
        this.renderActivePhoto();
    }

    applyGlobalPreset(name) {
        const photo = this.getActivePhoto();
        if (!photo) return;
        const d = this.getDefaultState();

        if (name === 'golden_hour') {
            photo.state.bwEnabled = false;
            photo.state.exposure = 0.25; photo.state.contrast = 15;
            photo.state.temp = 24; photo.state.tint = 6;
            photo.state.vibrance = 28; photo.state.saturation = 12;
            photo.state.smartDeblur = 15;
        } else if (name === 'matte_film') {
            photo.state.bwEnabled = false;
            photo.state.exposure = 0.15; photo.state.contrast = -12;
            photo.state.temp = -4; photo.state.tint = 8;
            photo.state.vibrance = 14; photo.state.saturation = -8;
            photo.state.bwGrain = 15;
        } else if (name === 'hdr_arch') {
            photo.state.bwEnabled = false;
            photo.state.exposure = 0.1; photo.state.contrast = 30;
            photo.state.temp = -5; photo.state.vibrance = 45; photo.state.saturation = 15;
            photo.state.smartDeblur = 40; photo.state.denoiseLuma = 15;
        } else if (name === 'soft_portrait') {
            photo.state.bwEnabled = false;
            photo.state.exposure = 0.25; photo.state.contrast = -6;
            photo.state.temp = 8; photo.state.tint = 4;
            photo.state.vibrance = 12; photo.state.saturation = 5;
            photo.state.denoiseLuma = 25; photo.state.denoiseChroma = 35;
            photo.state.skinProtection = 80; photo.state.deblurSkinProtect = 90;
        } else if (name === 'teal_orange') {
            photo.state.bwEnabled = false;
            photo.state.exposure = 0.0; photo.state.contrast = 26;
            photo.state.temp = 16; photo.state.tint = -12;
            photo.state.vibrance = 50; photo.state.saturation = 14;
            photo.state.smartDeblur = 20;
        } else if (name === 'autumn_amber') {
            photo.state.bwEnabled = false;
            photo.state.exposure = 0.1; photo.state.contrast = 22;
            photo.state.temp = 32; photo.state.tint = 14;
            photo.state.vibrance = 38; photo.state.saturation = 20;
        } else if (name === 'winter_cool') {
            photo.state.bwEnabled = false;
            photo.state.exposure = 0.2; photo.state.contrast = 16;
            photo.state.temp = -38; photo.state.tint = -8;
            photo.state.vibrance = -10; photo.state.saturation = -6;
            photo.state.smartDeblur = 25;
        } else if (name === 'smart_focus_deblur') {
            photo.state.bwEnabled = false;
            photo.state.smartDeblur = 80;
            photo.state.deblurSkinProtect = 85;
            photo.state.contrast = 15;
            photo.state.vibrance = 15;
        } else if (name === 'ansel_bw') {
            this.applyBWPreset('ansel_adams');
            return;
        } else if (name === 'film_noir') {
            this.applyBWPreset('film_noir');
            return;
        } else if (name === 'stage_fix') {
            photo.state.bwEnabled = false;
            photo.state.stageRedFix = 90; photo.state.colorBleedReduction = 75; photo.state.skinProtection = 65;
            photo.state.exposure = 0.0; photo.state.contrast = 10;
        } else if (name === 'denoise_high_iso') {
            photo.state.bwEnabled = false;
            photo.state.denoiseLuma = 75; photo.state.denoiseChroma = 85; photo.state.denoiseDetail = 50;
        }

        this.syncSliderUIFromPhoto(photo);
        this.renderActivePhoto();
    }

    resetSection(s) {
        const photo = this.getActivePhoto();
        if (!photo) return;
        const d = this.getDefaultState();
        if (s === 'stage_red') ['stageRedFix', 'colorBleedReduction', 'skinProtection', 'gamutCompress', 'stageBandingReduction'].forEach(k => photo.state[k] = d[k]);
        if (s === 'deblur') ['smartDeblur', 'deblurSkinProtect'].forEach(k => photo.state[k] = d[k]);
        if (s === 'denoise') ['denoiseLuma', 'denoiseChroma', 'denoiseDetail'].forEach(k => photo.state[k] = d[k]);
        if (s === 'tone') ['exposure', 'contrast', 'highlights', 'shadows', 'temp', 'tint', 'vibrance', 'saturation'].forEach(k => photo.state[k] = d[k]);
        this.syncSliderUIFromPhoto(photo);
        this.renderActivePhoto();
    }

    rotateActivePhoto(deg) {
        const photo = this.getActivePhoto();
        if (!photo) return;
        const s = photo.originalImageData, dst = new ImageData(s.height, s.width);
        for (let y = 0; y < s.height; y++) {
            for (let x = 0; x < s.width; x++) {
                const sI = (y * s.width + x) * 4;
                const dx = deg === 90 ? s.height - 1 - y : y;
                const dy = deg === 90 ? x : s.width - 1 - x;
                const dI = (dy * dst.width + dx) * 4;
                for (let c = 0; c < 4; c++) dst.data[dI + c] = s.data[sI + c];
            }
        }
        photo.originalImageData = dst;
        this.setActivePhoto(this.activePhotoIndex);
    }

    flipActivePhotoH() {
        const photo = this.getActivePhoto();
        if (!photo) return;
        const s = photo.originalImageData, dst = new ImageData(s.width, s.height);
        for (let y = 0; y < s.height; y++) {
            for (let x = 0; x < s.width; x++) {
                const sI = (y * s.width + x) * 4;
                const dI = (y * s.width + (s.width - 1 - x)) * 4;
                for (let c = 0; c < 4; c++) dst.data[dI + c] = s.data[sI + c];
            }
        }
        photo.originalImageData = dst;
        this.setActivePhoto(this.activePhotoIndex);
    }

    // Histogram & Curves
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

    initToneCurve() {
        this.cCanvas = document.getElementById('curve-canvas');
        this.cCtx = this.cCanvas ? this.cCanvas.getContext('2d') : null;
        this.curvePoints = [{ x: 0, y: 0 }, { x: 0.25, y: 0.25 }, { x: 0.75, y: 0.75 }, { x: 1, y: 1 }];
        this.curveLut = new Uint8Array(256);
        this.updateCurveLut();
        this.drawCurve();

        // Touch, Pen & Muis bediening voor de Tone Curve
        let isCurveDragging = false;
        const handleCurvePointer = (e) => {
            if (!this.cCanvas) return;
            const rect = this.cCanvas.getBoundingClientRect();
            const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const ny = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));

            // Vind het dichtstbijzijnde punt (1 of 2)
            const d1 = Math.abs(this.curvePoints[1].x - nx);
            const d2 = Math.abs(this.curvePoints[2].x - nx);
            const targetIdx = d1 <= d2 ? 1 : 2;

            this.curvePoints[targetIdx].y = ny;
            if (targetIdx === 1) this.curvePoints[1].x = Math.max(0.05, Math.min(this.curvePoints[2].x - 0.05, nx));
            if (targetIdx === 2) this.curvePoints[2].x = Math.max(this.curvePoints[1].x + 0.05, Math.min(0.95, nx));

            this.updateCurveLut();
            this.drawCurve();
            this.renderActivePhoto();
        };

        this.cCanvas?.addEventListener('pointerdown', (e) => {
            isCurveDragging = true;
            try { this.cCanvas.setPointerCapture(e.pointerId); } catch (err) {}
            handleCurvePointer(e);
        });

        window.addEventListener('pointermove', (e) => {
            if (isCurveDragging) handleCurvePointer(e);
        });

        const stopCurveDrag = (e) => {
            if (isCurveDragging) {
                isCurveDragging = false;
                try { this.cCanvas.releasePointerCapture(e.pointerId); } catch (err) {}
            }
        };
        window.addEventListener('pointerup', stopCurveDrag);
        window.addEventListener('pointercancel', stopCurveDrag);

        document.getElementById('btn-reset-curve')?.addEventListener('click', () => {
            this.curvePoints = [{ x: 0, y: 0 }, { x: 0.25, y: 0.25 }, { x: 0.75, y: 0.75 }, { x: 1, y: 1 }];
            this.updateCurveLut();
            this.drawCurve();
            this.renderActivePhoto();
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

        // Teken tastbare aanraakpunten voor vingers en stylus
        this.curvePoints.forEach((pt, idx) => {
            const px = pt.x * w, py = (1.0 - pt.y) * h;
            this.cCtx.fillStyle = idx === 0 || idx === 3 ? '#64748b' : '#38bdf8';
            this.cCtx.beginPath();
            this.cCtx.arc(px, py, idx === 0 || idx === 3 ? 4 : 7, 0, Math.PI * 2);
            this.cCtx.fill();
            this.cCtx.strokeStyle = '#ffffff';
            this.cCtx.lineWidth = 1.5;
            this.cCtx.stroke();
        });
    }

    // ═══════════════════════════════════════════════════════
    //  6. ZELF OPSLAGMAP KIEZEN OP HET APPARAAT
    // ═══════════════════════════════════════════════════════

    async exportWithFolderPicker() {
        const scope = document.getElementById('export-scope')?.value || 'all';
        const format = document.getElementById('export-format')?.value || 'image/jpeg';
        const quality = parseFloat(document.getElementById('export-quality')?.value || 0.95);
        
        let ext = 'jpg';
        if (format === 'image/png') ext = 'png';
        else if (format === 'image/webp') ext = 'webp';
        else if (format === 'image/tiff') ext = 'tif';
        else if (format === 'image/x-adobe-dng') ext = 'dng';

        const photosToExport = scope === 'all' ? this.photos : [this.getActivePhoto()];
        if (photosToExport.length === 0 || !photosToExport[0]) return;

        document.getElementById('export-modal')?.classList.add('hidden');
        document.getElementById('loading-overlay')?.classList.remove('hidden');

        try {
            // OPTIE A: Moderne desktop/laptop native map-keuze (File System Access API)
            if ('showDirectoryPicker' in window && photosToExport.length > 1) {
                console.log('📁 Native Directory Picker geopend...');
                const dirHandle = await window.showDirectoryPicker();
                let savedCount = 0;

                for (let i = 0; i < photosToExport.length; i++) {
                    const p = photosToExport[i];
                    const blob = await this.renderPhotoToBlob(p, format, quality);
                    const cleanName = p.filename.replace(/\.[^/.]+$/, "") + `_bewerkt.${ext}`;
                    const fileHandle = await dirHandle.getFileHandle(cleanName, { create: true });
                    const writable = await fileHandle.createWritable();
                    await writable.write(blob);
                    await writable.close();
                    savedCount++;
                }

                alert(`✅ Succesvol ${savedCount} foto's geconverteerd en opgeslagen als .${ext} in de gekozen map!`);
                document.getElementById('loading-overlay')?.classList.add('hidden');
                return;
            }

            // OPTIE B: Enkele foto met Save File Picker op laptop/desktop
            if ('showSaveFilePicker' in window && photosToExport.length === 1) {
                const p = photosToExport[0];
                const cleanName = p.filename.replace(/\.[^/.]+$/, "") + `_bewerkt.${ext}`;
                const fileHandle = await window.showSaveFilePicker({
                    suggestedName: cleanName,
                    types: [{
                        description: `Afbeelding (.${ext})`,
                        accept: { [format]: [`.${ext}`] }
                    }]
                });
                const blob = await this.renderPhotoToBlob(p, format, quality);
                const writable = await fileHandle.createWritable();
                await writable.write(blob);
                await writable.close();
                alert(`✅ Foto succesvol opgeslagen als .${ext} op de gekozen locatie!`);
                document.getElementById('loading-overlay')?.classList.add('hidden');
                return;
            }

            // OPTIE C: iPad / iOS Web Share API ("Bewaar in Bestanden")
            if (navigator.canShare && navigator.canShare({ files: [] })) {
                const filesArray = [];
                for (let i = 0; i < photosToExport.length; i++) {
                    const p = photosToExport[i];
                    const blob = await this.renderPhotoToBlob(p, format, quality);
                    const cleanName = p.filename.replace(/\.[^/.]+$/, "") + `_bewerkt_${i + 1}.${ext}`;
                    filesArray.push(new File([blob], cleanName, { type: format }));
                }

                if (navigator.canShare({ files: filesArray })) {
                    await navigator.share({
                        files: filesArray,
                        title: 'vroonphoto export',
                        text: `${filesArray.length} bewerkte foto('s) van vroonphoto (.${ext})`
                    });
                    document.getElementById('loading-overlay')?.classList.add('hidden');
                    return;
                }
            }

            // OPTIE D: Standaard download fallback
            for (let i = 0; i < photosToExport.length; i++) {
                const p = photosToExport[i];
                const blob = await this.renderPhotoToBlob(p, format, quality);
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = p.filename.replace(/\.[^/.]+$/, "") + `_bewerkt_${i + 1}.${ext}`;
                a.click();
                await new Promise(r => setTimeout(r, 200));
                URL.revokeObjectURL(url);
            }
            alert(`✅ ${photosToExport.length} foto('s) succesvol geëxporteerd als .${ext} naar je apparaat!`);

        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('Opslag fout:', err);
                alert(`Fout bij opslaan: ${err.message}`);
            }
        } finally {
            document.getElementById('loading-overlay')?.classList.add('hidden');
        }
    }

    renderPhotoToBlob(photo, format, quality) {
        return new Promise(resolve => {
            // TIFF (.tif) of Adobe Digital Negative (.dng) RAW Container
            if (format === 'image/tiff' || format === 'image/x-adobe-dng') {
                const isDNG = format === 'image/x-adobe-dng';
                const tiffBytes = this.encodeTiffOrDng(photo.currentImageData, isDNG);
                const blob = new Blob([tiffBytes.buffer], { type: format });
                resolve(blob);
                return;
            }

            // Standaard Canvas formaten: JPEG, PNG, WebP
            const expCanvas = document.createElement('canvas');
            expCanvas.width = photo.currentImageData.width;
            expCanvas.height = photo.currentImageData.height;
            const ctx = expCanvas.getContext('2d');
            ctx.putImageData(photo.currentImageData, 0, 0);
            expCanvas.toBlob(blob => resolve(blob), format, quality);
        });
    }

    // Pure WebAssembly/JS TIFF & DNG (Digital Negative) Encoder
    encodeTiffOrDng(imageData, isDNG = false) {
        const width = imageData.width;
        const height = imageData.height;
        const rgbaData = imageData.data;

        const numTags = isDNG ? 15 : 12;
        const ifdSize = 2 + numTags * 12 + 4;
        const extraOffset = 8 + ifdSize;

        const bitsOffset = extraOffset;
        const xresOffset = bitsOffset + 6;
        const yresOffset = xresOffset + 8;
        const modelOffset = yresOffset + 8;
        const modelStr = 'vroonphoto WASM\0';
        const extraLen = isDNG ? (modelOffset + modelStr.length - extraOffset) : (yresOffset + 8 - extraOffset);
        const pixelOffset = (extraOffset + extraLen + 3) & ~3;

        const totalBytes = pixelOffset + width * height * 3;
        const buffer = new ArrayBuffer(totalBytes);
        const view = new DataView(buffer);
        const u8 = new Uint8Array(buffer);

        // 1. TIFF Header (Little-Endian 'II')
        u8[0] = 0x49; u8[1] = 0x49;
        view.setUint16(2, 42, true);
        view.setUint32(4, 8, true);

        // 2. IFD entries
        let pos = 8;
        view.setUint16(pos, numTags, true); pos += 2;

        const writeTag = (tag, type, count, val) => {
            view.setUint16(pos, tag, true); pos += 2;
            view.setUint16(pos, type, true); pos += 2;
            view.setUint32(pos, count, true); pos += 4;
            if (type === 3 && count === 1) {
                view.setUint16(pos, val, true);
                view.setUint16(pos + 2, 0, true);
            } else if (type === 1 && count === 4) {
                view.setUint32(pos, val, true);
            } else {
                view.setUint32(pos, val, true);
            }
            pos += 4;
        };

        writeTag(0x0100, 4, 1, width); // ImageWidth
        writeTag(0x0101, 4, 1, height); // ImageLength
        writeTag(0x0102, 3, 3, bitsOffset); // BitsPerSample
        writeTag(0x0103, 3, 1, 1); // Compression: 1 (Uncompressed)
        writeTag(0x0106, 3, 1, 2); // PhotometricInterpretation: 2 (RGB)
        writeTag(0x0111, 4, 1, pixelOffset); // StripOffsets
        writeTag(0x0115, 3, 1, 3); // SamplesPerPixel: 3
        writeTag(0x0116, 4, 1, height); // RowsPerStrip
        writeTag(0x0117, 4, 1, width * height * 3); // StripByteCounts
        writeTag(0x011A, 5, 1, xresOffset); // XResolution (300 DPI)
        writeTag(0x011B, 5, 1, yresOffset); // YResolution (300 DPI)
        writeTag(0x0128, 3, 1, 2); // ResolutionUnit: 2 (Inch)

        if (isDNG) {
            writeTag(0xC612, 1, 4, 0x00000401); // DNGVersion: 1.4.0.0
            writeTag(0xC613, 1, 4, 0x00000101); // DNGBackwardVersion: 1.1.0.0
            writeTag(0xC614, 2, modelStr.length, modelOffset); // UniqueCameraModel
        }

        view.setUint32(pos, 0, true); // Next IFD = 0

        // Extra tag data waarden
        view.setUint16(bitsOffset, 8, true);
        view.setUint16(bitsOffset + 2, 8, true);
        view.setUint16(bitsOffset + 4, 8, true);

        view.setUint32(xresOffset, 300, true);
        view.setUint32(xresOffset + 4, 1, true);

        view.setUint32(yresOffset, 300, true);
        view.setUint32(yresOffset + 4, 1, true);

        if (isDNG) {
            for (let i = 0; i < modelStr.length; i++) {
                u8[modelOffset + i] = modelStr.charCodeAt(i);
            }
        }

        // 3. Pixel data (RGB strip geconverteerd uit RGBA)
        let pIdx = pixelOffset;
        for (let i = 0; i < rgbaData.length; i += 4) {
            u8[pIdx++] = rgbaData[i];
            u8[pIdx++] = rgbaData[i + 1];
            u8[pIdx++] = rgbaData[i + 2];
        }

        return u8;
    }

    // ═══════════════════════════════════════════════════════
    //  7. VOORBEELDFOTO GENERATOREN VOOR BATCH TESTEN
    // ═══════════════════════════════════════════════════════

    loadSampleBatch() {
        this.photos = [];
        this.activePhotoIndex = -1;

        const w = 1200, h = 800;

        // 1. Concert Podium Rood Licht (met LED Rolling Shutter Interferentiestrepen)
        const c1 = document.createElement('canvas'); c1.width = w; c1.height = h;
        const ctx1 = c1.getContext('2d');
        const bg1 = ctx1.createLinearGradient(0, 0, w, h);
        bg1.addColorStop(0, '#0a0305'); bg1.addColorStop(1, '#1e050c');
        ctx1.fillStyle = bg1; ctx1.fillRect(0, 0, w, h);
        ctx1.fillStyle = '#9a6b55';
        ctx1.beginPath(); ctx1.arc(600, 390, 110, 0, Math.PI * 2); ctx1.fill();
        const redGlow = ctx1.createRadialGradient(600, 370, 20, 600, 370, 440);
        redGlow.addColorStop(0, 'rgba(255, 20, 15, 1.0)');
        redGlow.addColorStop(0.4, 'rgba(255, 0, 30, 0.95)');
        redGlow.addColorStop(0.7, 'rgba(220, 0, 45, 0.65)');
        redGlow.addColorStop(1, 'rgba(90, 0, 20, 0.0)');
        ctx1.fillStyle = redGlow; ctx1.fillRect(0, 0, w, h);
        ctx1.strokeStyle = '#e2e8f0'; ctx1.lineWidth = 6;
        ctx1.beginPath(); ctx1.moveTo(560, 490); ctx1.lineTo(600, 410); ctx1.stroke();

        // Simuleer realistische LED podiumverlichting interferentiestrepen (PWM rolling shutter banding)
        const imgD1 = ctx1.getImageData(0, 0, w, h);
        for (let y = 0; y < h; y++) {
            const ripple = Math.sin(y * 0.14) * 32.0 + Math.sin(y * 0.045) * 14.0;
            const rOffset = y * w * 4;
            for (let x = 0; x < w; x++) {
                const idx = rOffset + x * 4;
                imgD1.data[idx]     = Math.min(255, Math.max(0, imgD1.data[idx] + ripple * 1.1));
                imgD1.data[idx + 1] = Math.min(255, Math.max(0, imgD1.data[idx + 1] + ripple * 0.5));
                imgD1.data[idx + 2] = Math.min(255, Math.max(0, imgD1.data[idx + 2] + ripple * 0.7));
            }
        }
        ctx1.putImageData(imgD1, 0, 0);
        this.addPhotoToSession(ctx1.getImageData(0, 0, w, h), { filename: 'Concert_Stage_Red.dng' });

        // 2. Hoge ISO Nachtopname (Ruis)
        const c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
        const ctx2 = c2.getContext('2d');
        ctx2.fillStyle = '#0b0f19'; ctx2.fillRect(0, 0, w, h);
        ctx2.fillStyle = '#1e293b'; ctx2.fillRect(150, 280, 220, 520);
        ctx2.fillRect(440, 180, 320, 620); ctx2.fillRect(830, 320, 250, 480);
        const imgD2 = ctx2.getImageData(0, 0, w, h);
        for (let i = 0; i < imgD2.data.length; i += 4) {
            const n = (Math.random() - 0.5) * 80;
            const cR = (Math.random() - 0.5) * 60, cB = (Math.random() - 0.5) * 60;
            imgD2.data[i] = Math.min(255, Math.max(0, imgD2.data[i] + n + cR));
            imgD2.data[i + 1] = Math.min(255, Math.max(0, imgD2.data[i + 1] + n));
            imgD2.data[i + 2] = Math.min(255, Math.max(0, imgD2.data[i + 2] + n + cB));
        }
        ctx2.putImageData(imgD2, 0, 0);
        this.addPhotoToSession(ctx2.getImageData(0, 0, w, h), { filename: 'Nacht_ISO6400_Ruis.cr2' });

        // 3. Berglandschap (Knallend Zwart-Wit Test)
        const c3 = document.createElement('canvas'); c3.width = w; c3.height = h;
        const ctx3 = c3.getContext('2d');
        const sky = ctx3.createLinearGradient(0, 0, 0, h);
        sky.addColorStop(0, '#38bdf8'); sky.addColorStop(0.5, '#bae6fd');
        sky.addColorStop(0.51, '#15803d'); sky.addColorStop(1, '#14532d');
        ctx3.fillStyle = sky; ctx3.fillRect(0, 0, w, h);
        ctx3.fillStyle = '#475569';
        ctx3.beginPath(); ctx3.moveTo(100, 400); ctx3.lineTo(350, 140); ctx3.lineTo(600, 400); ctx3.fill();
        ctx3.beginPath(); ctx3.moveTo(500, 400); ctx3.lineTo(750, 120); ctx3.lineTo(1050, 400); ctx3.fill();
        this.addPhotoToSession(ctx3.getImageData(0, 0, w, h), { filename: 'Alpen_Landschap.nef' });

        // 4. Gouden Uur Portret
        const c4 = document.createElement('canvas'); c4.width = w; c4.height = h;
        const ctx4 = c4.getContext('2d');
        const sun = ctx4.createRadialGradient(900, 200, 50, 900, 200, 700);
        sun.addColorStop(0, '#fef08a'); sun.addColorStop(0.5, '#f97316'); sun.addColorStop(1, '#7c2d12');
        ctx4.fillStyle = sun; ctx4.fillRect(0, 0, w, h);
        ctx4.fillStyle = '#d97706';
        ctx4.beginPath(); ctx4.arc(450, 400, 140, 0, Math.PI * 2); ctx4.fill();
        this.addPhotoToSession(ctx4.getImageData(0, 0, w, h), { filename: 'Portret_Golden_Hour.arw' });

        // 5. Straatfotografie
        const c5 = document.createElement('canvas'); c5.width = w; c5.height = h;
        const ctx5 = c5.getContext('2d');
        ctx5.fillStyle = '#1e293b'; ctx5.fillRect(0, 0, w, h);
        ctx5.fillStyle = '#334155'; ctx5.fillRect(200, 100, 300, 700); ctx5.fillRect(700, 150, 350, 650);
        ctx5.fillStyle = '#f8fafc'; ctx5.fillRect(520, 450, 40, 90);
        this.addPhotoToSession(ctx5.getImageData(0, 0, w, h), { filename: 'Straat_Contrast_Noir.dng' });

        // 6. Vakantie Strand JPG (Object Verwijderen Test)
        const c6 = document.createElement('canvas'); c6.width = w; c6.height = h;
        const ctx6 = c6.getContext('2d');
        // Hemelsblauw & Zee
        const skySea = ctx6.createLinearGradient(0, 0, 0, h);
        skySea.addColorStop(0, '#38bdf8');
        skySea.addColorStop(0.45, '#0284c7');
        skySea.addColorStop(0.46, '#0ea5e9');
        skySea.addColorStop(0.65, '#fde047');
        skySea.addColorStop(1, '#eab308');
        ctx6.fillStyle = skySea; ctx6.fillRect(0, 0, w, h);
        // Strandtextuur
        ctx6.fillStyle = '#ca8a04';
        for (let i = 0; i < 400; i++) {
            ctx6.fillRect(Math.random() * w, 520 + Math.random() * 280, 3, 3);
        }
        // In de weg staande rode waarschuwingspaal / object om te wissen
        ctx6.fillStyle = '#475569';
        ctx6.fillRect(588, 380, 24, 220); // Paal
        ctx6.fillStyle = '#dc2626';
        ctx6.fillRect(550, 300, 100, 90);  // Bord
        ctx6.fillStyle = '#ffffff';
        ctx6.font = 'bold 38px system-ui';
        ctx6.fillText('⚠️', 580, 360);
        this.addPhotoToSession(ctx6.getImageData(0, 0, w, h), { filename: 'Vakantie_Strand_Object_Test.jpg' });

        // 7. Bewogen Portret (Scherpte Herstel & Gezichtsbehoud Test)
        const c7 = document.createElement('canvas'); c7.width = w; c7.height = h;
        const ctx7 = c7.getContext('2d');
        // Achtergrond natuur
        const bgGrad = ctx7.createLinearGradient(0, 0, w, h);
        bgGrad.addColorStop(0, '#166534'); bgGrad.addColorStop(1, '#14532d');
        ctx7.fillStyle = bgGrad; ctx7.fillRect(0, 0, w, h);
        // Gezicht & Haar
        ctx7.fillStyle = '#3f2e1e'; // Haar
        ctx7.beginPath(); ctx7.arc(600, 370, 145, 0, Math.PI * 2); ctx7.fill();
        ctx7.fillStyle = '#f6d7b0'; // Huidtint
        ctx7.beginPath(); ctx7.arc(600, 390, 115, 0, Math.PI * 2); ctx7.fill();
        // Ogen & Mond
        ctx7.fillStyle = '#1e293b';
        ctx7.beginPath(); ctx7.arc(560, 370, 12, 0, Math.PI * 2); ctx7.fill(); // Linkeroog
        ctx7.beginPath(); ctx7.arc(640, 370, 12, 0, Math.PI * 2); ctx7.fill(); // Rechteroog
        ctx7.fillStyle = '#b91c1c';
        ctx7.beginPath(); ctx7.ellipse(600, 440, 24, 8, 0, 0, Math.PI * 2); ctx7.fill(); // Lippen
        // Pas lichte onscherpte (blur) toe zodat het herbouwd kan worden
        const blurImgD = ctx7.getImageData(0, 0, w, h);
        const bData = blurImgD.data;
        const bCopy = new Uint8ClampedArray(bData);
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const idx = (y * w + x) * 4;
                for (let c = 0; c < 3; c++) {
                    bData[idx + c] = (
                        bCopy[idx + c] * 4 +
                        bCopy[((y - 1) * w + x) * 4 + c] +
                        bCopy[((y + 1) * w + x) * 4 + c] +
                        bCopy[(y * w + (x - 1)) * 4 + c] +
                        bCopy[(y * w + (x + 1)) * 4 + c]
                    ) / 8;
                }
            }
        }
        ctx7.putImageData(blurImgD, 0, 0);
        this.addPhotoToSession(ctx7.getImageData(0, 0, w, h), { filename: 'Bewogen_Portret_Focus_Test.jpg' });

        this.setActivePhoto(0);
    }

    loadSingleSample(id) {
        // Laad 1 specifieke foto
        this.loadSampleBatch();
        const map = {
            'concert_red': 0,
            'noisy_night': 1,
            'landscape': 2,
            'jpg_object': 5,
            'blurry_portrait': 6
        };
        this.setActivePhoto(map[id] !== undefined ? map[id] : 0);
    }
}

// Start app bij DOMContentLoaded
window.addEventListener('DOMContentLoaded', () => {
    window.vroonApp = new VroonPhotoApp();
    window.vroonApp.init();
});
