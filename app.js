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
    maxPhotos: Infinity
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

function updateHelpModalFeatures(data) {
    if (!data) return;
    const verEl = document.getElementById('help-modal-ver');
    if (verEl && data.version) verEl.textContent = `v${data.version}`;

    const listEl = document.getElementById('help-features-dynamic-list');
    if (listEl && Array.isArray(data.features)) {
        listEl.innerHTML = data.features.map(f => `
            <div style="padding: 9px 12px; background: rgba(15, 23, 42, 0.7); border-left: 3px solid var(--accent-cyan); border-radius: 4px; font-size: 11px; line-height: 1.45; color: #e2e8f0;">
                ${f}
            </div>
        `).join('');
    }
}

async function checkVersion(silent = true) {
    try {
        const res = await fetch(`${CFG.versionFile}?nocache=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) {
            if (!silent) await forceAppUpdate();
            return;
        }
        const data = await res.json();

        if (data) {
            updateHelpModalFeatures(data);
        }

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
//  1.5 UNIVERSELE RAW & AFBEELDING DECODER
// ═══════════════════════════════════════════════════════

class RawDecoder {
    constructor() {
        this.rawExtensions = ['raw', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'rw2', 'raf', 'orf', 'pef', 'tiff', 'tif'];
    }

    isRaw(filename) {
        if (!filename) return false;
        const ext = filename.split('.').pop().toLowerCase();
        return this.rawExtensions.includes(ext);
    }

    async decode(file) {
        // 1. Probeer eerst createImageBitmap voor standaard webformaten (JPG, PNG, WebP)
        if (!this.isRaw(file.name)) {
            try {
                const bitmap = await createImageBitmap(file);
                const c = document.createElement('canvas');
                c.width = bitmap.width;
                c.height = bitmap.height;
                const ctx = c.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(bitmap, 0, 0);
                const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
                return {
                    imageData: imgData,
                    width: bitmap.width,
                    height: bitmap.height
                };
            } catch (e) {}
        }

        // 2. Camera RAW / DNG / TIFF scanner voor ingebedde JPEG-stream met hoge resolutie
        try {
            const buffer = await file.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            const embedded = await this.extractEmbeddedJpeg(bytes, file.name);
            if (embedded) return embedded;
        } catch (e) {}

        // 3. Fallback via Image element (werkt voor Safari/macOS native TIFF en standaard formaten)
        return await this.decodeViaImageElement(file);
    }

    async extractEmbeddedJpeg(bytes, filename) {
        let largestStart = -1;
        let largestLen = 0;

        // Scan naar JPEG SOI marker (0xFF, 0xD8, 0xFF)
        for (let i = 0; i < bytes.length - 4; i++) {
            if (bytes[i] === 0xFF && bytes[i + 1] === 0xD8 && bytes[i + 2] === 0xFF) {
                let eoi = -1;
                const maxScan = Math.min(i + 35000000, bytes.length - 1);
                for (let j = i + 2; j < maxScan; j++) {
                    if (bytes[j] === 0xFF && bytes[j + 1] === 0xD9) {
                        eoi = j + 2;
                    }
                }
                if (eoi > i) {
                    const length = eoi - i;
                    if (length > largestLen && length > 65536) { // Minimaal 64KB voor preview
                        largestLen = length;
                        largestStart = i;
                    }
                }
            }
        }

        if (largestStart >= 0) {
            const jpegBytes = bytes.subarray(largestStart, largestStart + largestLen);
            const blob = new Blob([jpegBytes], { type: 'image/jpeg' });
            return await this.decodeViaImageElement(blob);
        }

        return null;
    }

    decodeViaImageElement(blobOrFile) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(blobOrFile);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                const c = document.createElement('canvas');
                c.width = img.naturalWidth || img.width;
                c.height = img.naturalHeight || img.height;
                const ctx = c.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(img, 0, 0);
                const imgData = ctx.getImageData(0, 0, c.width, c.height);
                resolve({
                    imageData: imgData,
                    width: c.width,
                    height: c.height
                });
            };
            img.onerror = (err) => {
                URL.revokeObjectURL(url);
                reject(err);
            };
            img.src = url;
        });
    }
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
        const totalPixels = width * height;
        const totalBytes = totalPixels * 4;
        const maskBytes = totalPixels;
        const statusBytes = totalPixels;
        const rgbBytes = totalPixels * 3;
        const neededMemory = totalBytes + maskBytes + statusBytes + rgbBytes; // 9 * totalPixels

        if (this.isReady && this.instance.exports.vroon_smart_inpaint) {
            const imgOff = 0, maskOff = totalBytes;
            this.ensureMemory(neededMemory);
            const mem = new Uint8Array(this.memory.buffer);
            mem.set(data, imgOff);
            mem.set(maskArray, maskOff);
            this.instance.exports.vroon_smart_inpaint(imgOff, maskOff, width, height, radius);
            data.set(mem.subarray(imgOff, imgOff + totalBytes));
            return;
        }

        // JS Fallback (exact dezelfde concentrische ui-schil synthese)
        const status = new Uint8Array(totalPixels);
        let unknownCount = 0;
        let minX = width, maxX = 0, minY = height, maxY = 0;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = y * width + x;
                if (maskArray[i] >= 100) {
                    status[i] = 0;
                    unknownCount++;
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                } else {
                    status[i] = 1;
                }
            }
        }
        if (unknownCount === 0) return;

        const pad = radius + 6;
        const bbMinX = Math.max(0, minX - pad);
        const bbMaxX = Math.min(width - 1, maxX + pad);
        const bbMinY = Math.max(0, minY - pad);
        const bbMaxY = Math.min(height - 1, maxY + pad);

        let r = Math.max(2, Math.min(5, radius));
        const maxIters = Math.max(width, height);
        const nextRgb = new Uint8Array(totalPixels * 3);

        for (let iter = 0; iter < maxIters && unknownCount > 0; iter++) {
            let newlyFilled = 0;
            for (let y = bbMinY; y <= bbMaxY; y++) {
                for (let x = bbMinX; x <= bbMaxX; x++) {
                    const pIdx = y * width + x;
                    if (status[pIdx] !== 0) continue;

                    let sR = 0, sG = 0, sB = 0, sW = 0;
                    for (let dy = -r; dy <= r; dy++) {
                        const py = y + dy;
                        if (py < 0 || py >= height) continue;
                        for (let dx = -r; dx <= r; dx++) {
                            const px = x + dx;
                            if (px < 0 || px >= width) continue;
                            const nIdx = py * width + px;
                            if (status[nIdx] === 1) {
                                const distSq = dx * dx + dy * dy + 0.1;
                                const w = 1.0 / distSq;
                                const nB = nIdx * 4;
                                sR += data[nB] * w;
                                sG += data[nB + 1] * w;
                                sB += data[nB + 2] * w;
                                sW += w;
                            }
                        }
                    }
                    if (sW > 0.0001) {
                        nextRgb[pIdx * 3] = Math.min(255, Math.max(0, (sR / sW) | 0));
                        nextRgb[pIdx * 3 + 1] = Math.min(255, Math.max(0, (sG / sW) | 0));
                        nextRgb[pIdx * 3 + 2] = Math.min(255, Math.max(0, (sB / sW) | 0));
                        status[pIdx] = 2;
                        newlyFilled++;
                    }
                }
            }
            if (newlyFilled === 0) {
                r++;
                if (r > 15) break;
                continue;
            }
            for (let y = bbMinY; y <= bbMaxY; y++) {
                for (let x = bbMinX; x <= bbMaxX; x++) {
                    const i = y * width + x;
                    if (status[i] === 2) {
                        data[i * 4] = nextRgb[i * 3];
                        data[i * 4 + 1] = nextRgb[i * 3 + 1];
                        data[i * 4 + 2] = nextRgb[i * 3 + 2];
                        status[i] = 1;
                        unknownCount--;
                    }
                }
            }
        }

        // Blend passes
        for (let pass = 0; pass < 2; pass++) {
            for (let y = bbMinY; y <= bbMaxY; y++) {
                if (y <= 0 || y >= height - 1) continue;
                for (let x = bbMinX; x <= bbMaxX; x++) {
                    if (x <= 0 || x >= width - 1) continue;
                    const pIdx = y * width + x;
                    if (maskArray[pIdx] < 100) continue;
                    let sr = 0, sg = 0, sb = 0, sw = 0;
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            const nIdx = (y + dy) * width + (x + dx);
                            const w = (dx === 0 && dy === 0) ? 2.0 : 1.0;
                            sr += data[nIdx * 4] * w;
                            sg += data[nIdx * 4 + 1] * w;
                            sb += data[nIdx * 4 + 2] * w;
                            sw += w;
                        }
                    }
                    nextRgb[pIdx * 3] = (sr / sw) | 0;
                    nextRgb[pIdx * 3 + 1] = (sg / sw) | 0;
                    nextRgb[pIdx * 3 + 2] = (sb / sw) | 0;
                }
            }
            for (let y = bbMinY; y <= bbMaxY; y++) {
                for (let x = bbMinX; x <= bbMaxX; x++) {
                    const i = y * width + x;
                    if (maskArray[i] >= 100) {
                        data[i * 4] = nextRgb[i * 3];
                        data[i * 4 + 1] = nextRgb[i * 3 + 1];
                        data[i * 4 + 2] = nextRgb[i * 3 + 2];
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

    applyVignette(imageData, amount = 0, midpoint = 50, feather = 50) {
        if (!imageData || Math.abs(amount) < 0.01) return;
        const { data, width, height } = imageData;
        const totalBytes = width * height * 4;

        if (this.isReady && this.instance.exports.vroon_apply_vignette) {
            this.ensureMemory(totalBytes);
            const mem = new Uint8Array(this.memory.buffer);
            mem.set(data.subarray(0, totalBytes), 0);
            this.instance.exports.vroon_apply_vignette(
                0, width, height, amount, midpoint, feather
            );
            data.set(mem.subarray(0, totalBytes));
            return;
        }

        // JS Fallback
        const cx = width * 0.5;
        const cy = height * 0.5;
        const invCx = 1.0 / (cx > 0 ? cx : 1.0);
        const invCy = 1.0 / (cy > 0 ? cy : 1.0);

        const m = Math.max(10, Math.min(90, midpoint)) / 100.0;
        const f = Math.max(10, Math.min(100, feather)) / 100.0;
        const mSq = m * m * 1.25;
        let maxSq = 1.0 + f * 1.0;
        if (maxSq <= mSq + 0.01) maxSq = mSq + 0.01;
        const invRange = 1.0 / (maxSq - mSq);

        const amt = Math.max(-100, Math.min(100, amount)) / 100.0;
        const isLight = amt > 0;
        const absAmt = isLight ? amt : -amt;

        for (let y = 0; y < height; y++) {
            const ny = (y - cy) * invCy;
            const nySq = ny * ny;
            const rowOffset = y * width * 4;

            for (let x = 0; x < width; x++) {
                const nx = (x - cx) * invCx;
                const distSq = nx * nx + nySq;
                if (distSq <= mSq) continue;

                let t = distSq >= maxSq ? 1.0 : (distSq - mSq) * invRange;
                const s = t * t * (3.0 - 2.0 * t);
                const factor = s * absAmt;

                const idx = rowOffset + x * 4;
                const r = data[idx], g = data[idx + 1], b = data[idx + 2];

                if (isLight) {
                    data[idx]     = Math.min(255, Math.max(0, (r + (255 - r) * factor) | 0));
                    data[idx + 1] = Math.min(255, Math.max(0, (g + (255 - g) * factor) | 0));
                    data[idx + 2] = Math.min(255, Math.max(0, (b + (255 - b) * factor) | 0));
                } else {
                    const darkMult = 1.0 - factor;
                    data[idx]     = Math.min(255, Math.max(0, (r * darkMult) | 0));
                    data[idx + 1] = Math.min(255, Math.max(0, (g * darkMult) | 0));
                    data[idx + 2] = Math.min(255, Math.max(0, (b * darkMult) | 0));
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════
//  3. LIGHTROOM & AI PRESET DEFINITIES & RECEPTEN
// ═══════════════════════════════════════════════════════

const PRESET_DEFINITIONS = {
    'golden_hour': {
        name: '🌅 Gouden Uur',
        params: { bwEnabled: false, exposure: 0.25, contrast: 15, temp: 24, tint: 6, vibrance: 28, saturation: 12, smartDeblur: 15 }
    },
    'blue_hour': {
        name: '🌌 Blauwe Uur',
        params: { bwEnabled: false, exposure: 0.1, contrast: 20, temp: -42, tint: 14, vibrance: 42, saturation: 12, smartDeblur: 20, denoiseLuma: 15, denoiseChroma: 20, vignetteAmount: -22 }
    },
    'matte_film': {
        name: '🌲 Matte Film',
        params: { bwEnabled: false, exposure: 0.15, contrast: -12, temp: -4, tint: 8, vibrance: 14, saturation: -8, bwGrain: 15, vignetteAmount: -15 }
    },
    'hdr_arch': {
        name: '🏛️ Architectuur & HDR',
        params: { bwEnabled: false, exposure: 0.1, contrast: 30, temp: -5, vibrance: 45, saturation: 15, smartDeblur: 40, denoiseLuma: 15 }
    },
    'soft_portrait': {
        name: '🌸 Zacht Portret',
        params: { bwEnabled: false, exposure: 0.25, contrast: -6, temp: 8, tint: 4, vibrance: 12, saturation: 5, denoiseLuma: 25, denoiseChroma: 35, skinProtection: 80, deblurSkinProtect: 90 }
    },
    'teal_orange': {
        name: '🏙️ Moody Teal & Orange',
        params: { bwEnabled: false, exposure: 0.0, contrast: 26, temp: 16, tint: -12, vibrance: 50, saturation: 14, smartDeblur: 20 }
    },
    'autumn_amber': {
        name: '🍂 Herfst Amber',
        params: { bwEnabled: false, exposure: 0.1, contrast: 22, temp: 32, tint: 14, vibrance: 38, saturation: 20 }
    },
    'winter_cool': {
        name: '❄️ Winter Koud',
        params: { bwEnabled: false, exposure: 0.2, contrast: 16, temp: -38, tint: -8, vibrance: -10, saturation: -6, smartDeblur: 25 }
    },
    'smart_focus_deblur': {
        name: '🔍 Focus & Gezichtsbehoud',
        params: { bwEnabled: false, smartDeblur: 80, deblurSkinProtect: 85, contrast: 15, vibrance: 15 }
    },
    'ansel_bw': {
        name: '⚡ Knallend Zwart-Wit',
        params: { bwEnabled: true, bwRed: 35, bwGreen: 20, bwBlue: -15, bwContrast: 35, bwClarity: 40, bwGrain: 8 }
    },
    'film_noir': {
        name: '🎬 Film Noir (B&W)',
        params: { bwEnabled: true, bwRed: 50, bwGreen: -10, bwBlue: -35, bwContrast: 65, bwClarity: 50, bwGrain: 25, vignetteAmount: -40 }
    },
    'stage_fix': {
        name: '🔴 Stage Red Light Fix',
        params: { bwEnabled: false, stageRedFix: 90, colorBleedReduction: 75, skinProtection: 65, stageBandingReduction: 80, exposure: 0.0, contrast: 10 }
    },
    'denoise_high_iso': {
        name: '🛡️ Hoge ISO Ruis Fix',
        params: { bwEnabled: false, denoiseLuma: 75, denoiseChroma: 85, denoiseDetail: 50 }
    },
    'knallend_contrast': {
        name: '⚡ Knallend Contrast',
        params: { bwEnabled: true, bwRed: 45, bwGreen: 10, bwBlue: -25, bwContrast: 50, bwClarity: 55, bwGrain: 12 }
    },
    'ansel_adams': {
        name: '🏞️ Ansel Adams',
        params: { bwEnabled: true, bwRed: 35, bwGreen: 20, bwBlue: -15, bwContrast: 35, bwClarity: 40, bwGrain: 8 }
    },
    'dramatic_street': {
        name: '📷 Straatfoto',
        params: { bwEnabled: true, bwRed: 30, bwGreen: 15, bwBlue: -10, bwContrast: 30, bwClarity: 65, bwGrain: 18 }
    }
};

// ═══════════════════════════════════════════════════════
//  4. VROONPHOTO 25-FOTO BATCH & WORKSPACE MANAGER
// ═══════════════════════════════════════════════════════

class VroonPhotoApp {
    constructor() {
        this.wasm = new WasmKernel();
        this.rawDecoder = new RawDecoder();
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

        // Actieve Preset & Proportionele Intensiteit (0% - 200%)
        this.activePresetKey = null;
        this.activePresetAmount = 100;

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

        // Sessie directory handles voor directe 1-klik submap opslag & aangepaste opslaglocatie
        this.activeSessionName = 'Fotosessie';
        this.parentDestDirHandle = null;
        this.sessionDirHandle = null;
        this.sessionTargetLocationName = '';

        // Lokaal Aanpassingspenseel (Pen, Hand & Muis)
        this.localBrushMode = 'brush'; // 'brush' of 'eraser'
        this.showLocalMaskOverlay = true;
        this.lastLocalPointerPos = null;
        this.overlayCanvas = null;

        // Aangepast Automatisch Import Profiel (bv. ruisonderdrukking, rood licht, banding reductie)
        this.customImportPreset = this.loadCustomImportPreset();

        // Performance & Hardware Acceleratie Caching (120 FPS optimalisatie voor MacBook trackpad / muis)
        this.cachedCanvasRect = null;
        this.cursorCircle = null;
        this.inpaintBrushSize = 35;
        this.localBrushSize = 35;
        this._renderRaf = null;
    }

    updateCachedCanvasRect() {
        if (this.canvas) {
            this.cachedCanvasRect = this.canvas.getBoundingClientRect();
        }
    }

    scheduleRenderActivePhoto() {
        if (this._renderRaf) return;
        this._renderRaf = requestAnimationFrame(() => {
            this._renderRaf = null;
            this.renderActivePhoto();
        });
    }

    updateFilmstripActiveOnly() {
        const container = document.getElementById('filmstrip-scroll');
        if (!container) return;
        const items = container.querySelectorAll('.filmstrip-item');
        if (items.length === 0) {
            this.updateFilmstripUI();
            return;
        }
        items.forEach((item) => {
            const idx = parseInt(item.dataset.index, 10);
            item.classList.toggle('active', idx === this.activePhotoIndex);
        });
    }

    getDefaultState() {
        return {
            exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
            temp: 0, tint: 0, vibrance: 0, saturation: 0,
            stageRedFix: 0, colorBleedReduction: 0, skinProtection: 50, gamutCompress: 50,
            stageBandingReduction: 0,
            smartDeblur: 0, deblurSkinProtect: 75,
            denoiseLuma: 0, denoiseChroma: 0, denoiseDetail: 50,
            bwEnabled: false, bwRed: 40, bwGreen: 10, bwBlue: -10,
            bwContrast: 35, bwClarity: 45, bwGrain: 10,
            vignetteAmount: 0, vignetteMidpoint: 50, vignetteFeather: 50
        };
    }

    loadCustomImportPreset() {
        try {
            const raw = localStorage.getItem('vroonphoto_import_preset');
            if (raw) {
                const parsed = JSON.parse(raw);
                return {
                    enabled: !!parsed.enabled && !!parsed.settings,
                    settings: parsed.settings || null
                };
            }
        } catch (e) {
            console.warn('Kon opgeslagen import profiel niet laden:', e);
        }
        return { enabled: false, settings: null };
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
            if (s.vignetteAmount && Math.abs(s.vignetteAmount) > 0.01) parts.push(`Vignet ${s.vignetteAmount > 0 ? '+' : ''}${s.vignetteAmount}`);
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

        this.cursorCircle = document.getElementById('brush-cursor-circle');
        this.inpaintBrushSize = parseInt(document.getElementById('inpaint-brush-size')?.value || 35, 10);
        this.localBrushSize = parseInt(document.getElementById('local-brush-size')?.value || 35, 10);
        this.updateCachedCanvasRect();
        window.addEventListener('resize', () => this.updateCachedCanvasRect(), { passive: true });
        window.addEventListener('scroll', () => this.updateCachedCanvasRect(), { passive: true });

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

        // Sliders binding met 120 FPS requestAnimationFrame scheduling
        document.querySelectorAll('.param-slider').forEach(slider => {
            const param = slider.dataset.param;
            const valSpan = document.getElementById(`${slider.id}-val`);
            slider.addEventListener('input', (e) => {
                const photo = this.getActivePhoto();
                if (!photo) return;
                const val = parseFloat(e.target.value);
                if (param) photo.state[param] = val;
                if (valSpan) valSpan.textContent = val;
                this.scheduleRenderActivePhoto();
            });
        });

        // Penseelgrootte slider binding & update
        const brushSlider = document.getElementById('inpaint-brush-size');
        const brushSpan = document.getElementById('brush-size-val');
        const brushSpanNew = document.getElementById('inpaint-brush-size-val');
        this.inpaintBrushSize = parseInt(brushSlider?.value || 35, 10);
        brushSlider?.addEventListener('input', (e) => {
            this.inpaintBrushSize = parseInt(e.target.value, 10);
            if (brushSpan) brushSpan.textContent = `${e.target.value}px`;
            if (brushSpanNew) brushSpanNew.textContent = `${e.target.value}px`;
        });

        // Reset secties (uitsluitend knoppen met data-section attribuut)
        document.querySelectorAll('.btn-reset-section[data-section]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const sec = e.currentTarget.dataset.section;
                if (sec) this.resetSection(sec);
            });
        });

        // 1-Klik Zwart-Wit Omzetten & Tools
        document.getElementById('btn-hdr-bw-toggle')?.addEventListener('click', () => this.toggleBWMode());
        document.getElementById('btn-toggle-bw-big')?.addEventListener('click', () => this.toggleBWMode());
        document.getElementById('btn-toggle-bw-pill')?.addEventListener('click', () => this.toggleBWMode());
        document.querySelectorAll('.bw-preset-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.applyBWPreset(e.currentTarget.dataset.preset));
        });
        document.querySelectorAll('.preset-card').forEach(card => {
            card.addEventListener('click', (e) => this.applyGlobalPreset(e.currentTarget.dataset.preset, 100));
        });

        // Vignette Snelle Knoppen (Donker ◄► Wit)
        document.querySelectorAll('.vignette-quick-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const photo = this.getActivePhoto();
                if (!photo) return;
                const amt = parseFloat(e.currentTarget.dataset.amount);
                photo.state.vignetteAmount = amt;
                this.syncSliderUIFromPhoto(photo);
                this.renderActivePhoto();
            });
        });

        // Lightroom & AI Preset Verhouding / Intensiteit Schuifregelaar
        const presetSlider = document.getElementById('slider-preset-amount');
        if (presetSlider) {
            presetSlider.addEventListener('input', (e) => {
                const amount = parseInt(e.target.value, 10);
                const amountVal = document.getElementById('slider-preset-amount-val');
                if (amountVal) amountVal.textContent = `${amount}%`;
                const key = this.activePresetKey || 'golden_hour';
                this.applyGlobalPreset(key, amount);
            });
        }
        const bwToggle = document.getElementById('toggle-bw-mode');
        bwToggle?.addEventListener('change', (e) => {
            this.toggleBWMode(e.target.checked);
        });

        // Topaz Super-Resolution
        document.getElementById('btn-upscale-2x')?.addEventListener('click', () => this.upscale(2));
        document.getElementById('btn-upscale-4x')?.addEventListener('click', () => this.upscale(4));

        // Lokaal Aanpassingspenseel (Pen, Hand & Muis)
        document.getElementById('tool-local-adjust')?.addEventListener('click', () => this.toggleLocalAdjustTool());
        document.getElementById('btn-hdr-local-brush')?.addEventListener('click', () => this.toggleLocalAdjustTool());
        document.getElementById('btn-local-brush-mode')?.addEventListener('click', () => this.setLocalBrushMode('brush'));
        document.getElementById('btn-local-eraser-mode')?.addEventListener('click', () => this.setLocalBrushMode('eraser'));
        document.getElementById('btn-local-toggle-overlay')?.addEventListener('click', () => this.toggleLocalMaskOverlay());
        document.getElementById('btn-local-invert')?.addEventListener('click', () => this.invertLocalMask());
        document.getElementById('btn-local-clear')?.addEventListener('click', () => this.clearLocalMask());
        document.getElementById('btn-local-bake')?.addEventListener('click', () => this.bakeLocalAdjustments());

        // Lokale Sliders
        const localSizeSlider = document.getElementById('local-brush-size');
        const localSizeVal = document.getElementById('local-brush-size-val');
        this.localBrushSize = parseInt(localSizeSlider?.value || 35, 10);
        localSizeSlider?.addEventListener('input', (e) => {
            this.localBrushSize = parseInt(e.target.value, 10);
            if (localSizeVal) localSizeVal.textContent = `${e.target.value}px`;
        });

        const localFeatherSlider = document.getElementById('local-brush-feather');
        const localFeatherVal = document.getElementById('local-brush-feather-val');
        localFeatherSlider?.addEventListener('input', (e) => {
            if (localFeatherVal) localFeatherVal.textContent = `${e.target.value}%`;
        });

        ['local-exposure', 'local-contrast', 'local-highlights', 'local-temp', 'local-saturation', 'local-clarity'].forEach(id => {
            const slider = document.getElementById(id);
            const valSpan = document.getElementById(`${id}-val`);
            const param = id.replace('local-', '');
            slider?.addEventListener('input', (e) => {
                const photo = this.getActivePhoto();
                if (!photo) return;
                this.ensurePhotoLocalMask(photo);
                const val = parseFloat(e.target.value);
                photo.localState[param] = val;
                if (valSpan) valSpan.textContent = val;
                this.scheduleRenderActivePhoto();
            });
        });

        document.getElementById('local-bw-select')?.addEventListener('change', (e) => {
            const photo = this.getActivePhoto();
            if (!photo) return;
            this.ensurePhotoLocalMask(photo);
            photo.localState.selectiveBW = e.target.value;
            this.renderActivePhoto();
        });

        // Object / Persoon Verwijderen Tool (Inpaint)
        document.getElementById('tool-inpaint')?.addEventListener('click', () => {
            if (this.activeTool === 'inpaint') {
                this.activeTool = 'adjust';
            } else {
                this.activeTool = 'inpaint';
                document.getElementById('local-adjust-controls')?.classList.add('hidden');
                document.getElementById('tool-local-adjust')?.classList.remove('active');
                document.getElementById('btn-hdr-local-brush')?.classList.remove('active');
            }
            const isActive = this.activeTool === 'inpaint';
            document.getElementById('tool-inpaint')?.classList.toggle('active', isActive);
            document.getElementById('inpaint-controls')?.classList.toggle('hidden', !isActive);
            const circle = document.getElementById('brush-cursor-circle');
            if (circle && !isActive) circle.style.display = 'none';
            this.drawActiveCanvas();
        });
        document.getElementById('btn-apply-heal')?.addEventListener('click', () => {
            this.activeTool = 'inpaint';
            document.getElementById('tool-inpaint')?.classList.add('active');
            document.getElementById('inpaint-controls')?.classList.remove('hidden');
            this.applyInpaint();
        });
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

        // Opslaan & Exporteren (Direct in Finder / Verkenner)
        document.getElementById('btn-open-export')?.addEventListener('click', () => {
            this.saveWithFinder();
        });
        document.getElementById('btn-open-export-modal')?.addEventListener('click', () => {
            document.getElementById('export-modal')?.classList.remove('hidden');
        });
        document.getElementById('btn-close-export')?.addEventListener('click', () => {
            document.getElementById('export-modal')?.classList.add('hidden');
        });
        document.getElementById('btn-choose-folder-export')?.addEventListener('click', () => this.exportWithFolderPicker());

        // Bestandsformaat wissel: update kwaliteitsopties dynamisch
        const exportFormatSel = document.getElementById('export-format');
        const exportQualitySel = document.getElementById('export-quality');
        const updateExportQualityUI = (fmt) => {
            if (fmt === 'original-raw') {
                if (exportQualitySel) {
                    exportQualitySel.innerHTML = `
                        <option value="1.0">100% — Origineel RAW Camerabestand (Onbewerkt &amp; Bit-Exact)</option>
                    `;
                }
            } else if (fmt === 'image/tiff' || fmt === 'image/x-adobe-dng' || fmt === 'image/png') {
                if (exportQualitySel) {
                    exportQualitySel.innerHTML = `
                        <option value="1.0">100% — Ongecomprimeerd / Lossless RAW (Volledige Kwaliteit)</option>
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
        };
        exportFormatSel?.addEventListener('change', (e) => updateExportQualityUI(e.target.value));
        if (exportFormatSel) updateExportQualityUI(exportFormatSel.value);

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
            if (e.target.files && e.target.files.length > 0) this.loadMultipleFiles(e.target.files);
            e.target.value = '';
        });
        document.getElementById('grid-add-file-input')?.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) this.loadMultipleFiles(e.target.files);
            e.target.value = '';
        });

        // Verwijderknoppen (Header & Filmstrip)
        document.getElementById('btn-delete-active-photo')?.addEventListener('click', () => {
            this.removeActivePhoto();
        });
        document.getElementById('btn-filmstrip-delete-current')?.addEventListener('click', () => {
            this.removeActivePhoto();
        });

        // Voorbeelden laden (Uniforme knop '📸 5 Voorbeeldfoto's')
        document.getElementById('btn-load-sample-batch')?.addEventListener('click', () => {
            this.loadSampleBatch();
        });
        document.getElementById('sample-photos-select')?.addEventListener('change', (e) => {
            if (e.target.value === 'batch_5') this.loadSampleBatch();
            else this.loadSingleSample(e.target.value);
        });

        // Help & Mogelijkheden Modal
        document.getElementById('btn-open-help')?.addEventListener('click', () => this.openHelpModal());
        document.getElementById('btn-open-help-empty')?.addEventListener('click', () => this.openHelpModal());
        document.getElementById('btn-close-help-modal')?.addEventListener('click', () => document.getElementById('help-modal')?.classList.add('hidden'));
        document.getElementById('btn-close-help-footer')?.addEventListener('click', () => document.getElementById('help-modal')?.classList.add('hidden'));

        // SD-Kaart / Externe Schijf Inlezen & Modal
        document.getElementById('btn-import-sd')?.addEventListener('click', () => this.openSDImportModal());
        document.getElementById('btn-import-sd-empty')?.addEventListener('click', () => this.openSDImportModal());
        document.getElementById('btn-close-sd-modal')?.addEventListener('click', () => document.getElementById('sd-import-modal')?.classList.add('hidden'));
        document.getElementById('btn-cancel-sd-import')?.addEventListener('click', () => document.getElementById('sd-import-modal')?.classList.add('hidden'));
        document.getElementById('btn-confirm-sd-picker')?.addEventListener('click', () => this.confirmSDImport());
        document.getElementById('btn-pick-custom-target-dir')?.addEventListener('click', () => this.pickTargetDestinationDir());
        document.getElementById('sd-session-name-input')?.addEventListener('input', () => this.updateTargetLocationDisplay());
        document.getElementById('sd-directory-fallback')?.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) this.loadMultipleFiles(e.target.files);
            e.target.value = '';
        });

        // Culling & Beoordeling (1-7, Sterren, Kleuren, Filteren)
        document.querySelectorAll('.culling-rate-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const r = parseInt(e.currentTarget.dataset.rate, 10);
                this.rateActivePhoto(r);
            });
        });
        document.querySelectorAll('.culling-color-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const c = e.currentTarget.dataset.color;
                this.setColorLabelActivePhoto(c);
            });
        });
        document.getElementById('filmstrip-filter-select')?.addEventListener('change', () => {
            this.updateFilmstripUI();
            this.updateGridUI();
        });
        document.getElementById('btn-cull-keep-selection')?.addEventListener('click', () => {
            this.cullKeepSelection();
        });
        document.getElementById('btn-cull-pick-dest')?.addEventListener('click', () => {
            this.pickCullDestinationDir();
        });
        document.getElementById('cull-subfolder-name')?.addEventListener('input', () => {
            this.updateDestinationFolderDisplay();
        });
        document.getElementById('btn-cull-direct-save')?.addEventListener('click', () => {
            this.saveSelectionDirectly();
        });
        document.getElementById('btn-cull-export-subfolder')?.addEventListener('click', () => {
            this.openExportModalWithScope('selected');
        });
        this.updateDestinationFolderDisplay();
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
        pointerType = pointerType || 'mouse';
        if (pointerType === this.activePointerType && pointerType !== 'pen') return;
        this.activePointerType = pointerType;
        const badge = document.getElementById('input-mode-badge');
        const badge2 = document.getElementById('local-input-type-badge');

        if (badge) {
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

        if (badge2) {
            if (pointerType === 'pen') {
                const pressTxt = pressure > 0 ? ` (${Math.round(pressure * 100)}% Druk)` : '';
                badge2.textContent = `✏️ Pen / Stylus${pressTxt}`;
            } else if (pointerType === 'touch') {
                badge2.textContent = `👆 Hand / Touch`;
            } else {
                badge2.textContent = `🖱️ Muis`;
            }
        }
    }

    // Vloeiende Penseelstreken met Drukgevoeligheid (Apple Pencil / Stylus)
    paintMaskStroke(clientX, clientY, pressure = 0.5, isStart = false) {
        if (!this.maskCtx || !this.canvas) return;
        const rect = this.cachedCanvasRect || this.canvas.getBoundingClientRect();
        const sx = this.canvas.width / rect.width;
        const sy = this.canvas.height / rect.height;
        const x = (clientX - rect.left) * sx;
        const y = (clientY - rect.top) * sy;

        const baseSize = this.inpaintBrushSize || parseInt(document.getElementById('inpaint-brush-size')?.value || 35, 10);
        let effectiveRadius = baseSize;
        if (this.activePointerType === 'pen' && pressure > 0) {
            effectiveRadius = Math.max(4, baseSize * (0.35 + 0.65 * pressure));
        }

        this.maskCtx.fillStyle = '#ef4444';
        this.maskCtx.strokeStyle = '#ef4444';
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

        // Direct op het actieve canvas tekenen voor 120 FPS realtime feedback ZONDER putImageData vertraging
        this.ctx.save();
        this.ctx.globalAlpha = 0.45;
        this.ctx.fillStyle = '#ef4444';
        this.ctx.strokeStyle = '#ef4444';
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.lineWidth = effectiveRadius * 2;
        if (isStart || !this.lastPointerPos) {
            this.ctx.beginPath();
            this.ctx.arc(x, y, effectiveRadius, 0, Math.PI * 2);
            this.ctx.fill();
        } else {
            this.ctx.beginPath();
            this.ctx.moveTo(this.lastPointerPos.x, this.lastPointerPos.y);
            this.ctx.lineTo(x, y);
            this.ctx.stroke();
        }
        this.ctx.restore();

        this.lastPointerPos = { x, y };
    }

    // Geünificeerde Pointer Events (Muis, Hand / Touch, Pen / Apple Pencil)
    setupTouchInteractions() {
        let cursorRafPending = false;
        let lastCursorX = 0, lastCursorY = 0, lastPressure = 0.5;

        const renderCursorCircle = () => {
            cursorRafPending = false;
            if (!this.cursorCircle) this.cursorCircle = document.getElementById('brush-cursor-circle');
            if (!this.cursorCircle) return;

            if (this.activeTool !== 'inpaint' && this.activeTool !== 'local_adjust') {
                if (this.cursorCircle.style.display !== 'none') this.cursorCircle.style.display = 'none';
                return;
            }

            const rect = this.cachedCanvasRect || (this.canvas ? this.canvas.getBoundingClientRect() : null);
            if (!rect || lastCursorX < rect.left || lastCursorX > rect.right || lastCursorY < rect.top || lastCursorY > rect.bottom) {
                if (this.cursorCircle.style.display !== 'none') this.cursorCircle.style.display = 'none';
                return;
            }

            const baseBrushSize = this.activeTool === 'inpaint'
                ? (this.inpaintBrushSize || 35)
                : (this.localBrushSize || 35);

            let brushSize = baseBrushSize;
            if (this.activePointerType === 'pen' && lastPressure > 0) {
                brushSize = Math.max(4, baseBrushSize * (0.35 + 0.65 * lastPressure));
            }
            const scale = rect.width / (this.canvas.width || 1);
            const displayDiam = Math.max(10, brushSize * 2 * scale);

            if (this.cursorCircle.style.display !== 'block') this.cursorCircle.style.display = 'block';
            this.cursorCircle.style.width = `${displayDiam}px`;
            this.cursorCircle.style.height = `${displayDiam}px`;
            this.cursorCircle.style.transform = `translate3d(${lastCursorX}px, ${lastCursorY}px, 0) translate(-50%, -50%)`;
            this.cursorCircle.style.borderColor = this.activeTool === 'local_adjust' ? '#38bdf8' : '#ef4444';
        };

        const updateCursorCircle = (clientX, clientY, pressure = 0.5) => {
            if (this.activeTool !== 'inpaint' && this.activeTool !== 'local_adjust') {
                if (this.cursorCircle && this.cursorCircle.style.display !== 'none') {
                    this.cursorCircle.style.display = 'none';
                }
                return;
            }
            lastCursorX = clientX;
            lastCursorY = clientY;
            lastPressure = pressure;
            if (!cursorRafPending) {
                cursorRafPending = true;
                requestAnimationFrame(renderCursorCircle);
            }
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
            if (this.activeTool !== 'inpaint' && this.activeTool !== 'local_adjust' && (now - this.lastTapTime < 320)) {
                if (this.zoomLevel > 1.05) this.resetZoom();
                else this.setZoom(2.0, -(e.clientX - window.innerWidth / 2) * 0.6, -(e.clientY - window.innerHeight / 2) * 0.6);
                this.lastTapTime = 0;
                return;
            }
            this.lastTapTime = now;

            if (this.activePointers.size === 1) {
                this.lastPointerPos = null;
                this.lastLocalPointerPos = null;
                if (this.activeTool === 'inpaint') {
                    this.paintMaskStroke(e.clientX, e.clientY, e.pressure, true);
                } else if (this.activeTool === 'local_adjust') {
                    this.paintLocalStroke(e.clientX, e.clientY, e.pressure, true);
                } else if (this.isBeforeAfterActive) {
                    const rect = this.cachedCanvasRect || this.canvas.getBoundingClientRect();
                    this.splitComparePos = Math.max(0.05, Math.min(0.95, (e.clientX - rect.left) / rect.width));
                    this.drawActiveCanvas();
                }
            } else if (this.activePointers.size === 2) {
                // Twee vingers (hand) pinch-to-zoom start
                this.lastPointerPos = null;
                this.lastLocalPointerPos = null;
                const pts = Array.from(this.activePointers.values());
                this.initialPinchDist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
                this.initialZoom = this.zoomLevel;
                if (this.cursorCircle) this.cursorCircle.style.display = 'none';
            }
            updateCursorCircle(e.clientX, e.clientY, e.pressure);
        });

        // Pointer Move (uitsluitend op window als er actieve touches/slepen zijn)
        window.addEventListener('pointermove', (e) => {
            if (this.activePointers.has(e.pointerId)) {
                this.activePointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY, type: e.pointerType });
                this.updateInputMode(e.pointerType, e.pressure);

                if (this.activePointers.size === 1) {
                    if (this.activeTool === 'inpaint') {
                        this.paintMaskStroke(e.clientX, e.clientY, e.pressure, false);
                    } else if (this.activeTool === 'local_adjust') {
                        this.paintLocalStroke(e.clientX, e.clientY, e.pressure, false);
                    } else if (this.isBeforeAfterActive) {
                        const rect = this.cachedCanvasRect || this.canvas.getBoundingClientRect();
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
                updateCursorCircle(e.clientX, e.clientY, e.pressure);
            }
        }, { passive: true });

        // Hover cursor op canvas (alleen actief wanneer penseeltools aan staan)
        this.canvas.addEventListener('pointermove', (e) => {
            if (this.activePointers.size === 0) {
                updateCursorCircle(e.clientX, e.clientY, e.pressure);
            }
        }, { passive: true });

        this.canvas.addEventListener('pointerenter', (e) => {
            this.updateCachedCanvasRect();
            updateCursorCircle(e.clientX, e.clientY, e.pressure);
        }, { passive: true });

        this.canvas.addEventListener('pointerleave', () => {
            if (this.cursorCircle) this.cursorCircle.style.display = 'none';
        }, { passive: true });

        // Pointer Up & Pointer Cancel
        const handlePointerUp = (e) => {
            if (this.activePointers.has(e.pointerId)) {
                try {
                    this.canvas.releasePointerCapture(e.pointerId);
                } catch (err) {}
                this.activePointers.delete(e.pointerId);
            }
            if (this.activePointers.size === 0) {
                if (this.activeTool === 'inpaint') {
                    this.drawActiveCanvas();
                } else if (this.activeTool === 'local_adjust') {
                    this.renderActivePhoto();
                }
                this.lastPointerPos = null;
                this.lastLocalPointerPos = null;
            }
        };
        window.addEventListener('pointerup', handlePointerUp);
        window.addEventListener('pointercancel', handlePointerUp);
    }

    setupShortcuts() {
        window.addEventListener('keydown', (e) => {
            if (e.key === '\\') {
                e.preventDefault();
                document.getElementById('btn-compare-toggle')?.click();
            } else if ((e.key === 'o' || e.key === 'O') && !e.target.matches('input, select, textarea')) {
                e.preventDefault();
                this.toggleLocalMaskOverlay();
            } else if (e.key === '[' && !e.target.matches('input, select, textarea')) {
                const s = document.getElementById(this.activeTool === 'local_adjust' ? 'local-brush-size' : 'inpaint-brush-size');
                if (s) {
                    s.value = Math.max(5, parseInt(s.value, 10) - 10);
                    s.dispatchEvent(new Event('input'));
                }
            } else if (e.key === ']' && !e.target.matches('input, select, textarea')) {
                const s = document.getElementById(this.activeTool === 'local_adjust' ? 'local-brush-size' : 'inpaint-brush-size');
                if (s) {
                    s.value = Math.min(180, parseInt(s.value, 10) + 10);
                    s.dispatchEvent(new Event('input'));
                }
            } else if (e.key === 'ArrowRight' && !e.target.matches('input, select')) {
                this.selectNextPhoto();
            } else if (e.key === 'ArrowLeft' && !e.target.matches('input, select')) {
                this.selectPrevPhoto();
            } else if ((e.key === 'Delete' || e.key === 'Backspace') && !e.target.matches('input, select, textarea')) {
                e.preventDefault();
                this.removeActivePhoto();
            } else if (['0', '1', '2', '3', '4', '5', '6', '7'].includes(e.key) && !e.target.matches('input, select, textarea')) {
                const r = parseInt(e.key, 10);
                this.rateActivePhoto(r);
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
    //  4. FOTO BEHEER (ONBEPERKT / ONEINDIG VEEL FOTO'S)
    // ═══════════════════════════════════════════════════════

    async loadMultipleFiles(fileList) {
        if (!fileList || fileList.length === 0) return;
        document.getElementById('loading-overlay')?.classList.remove('hidden');

        const filesToLoad = Array.from(fileList);
        const startIndex = this.photos.length;
        let successCount = 0;

        for (const file of filesToLoad) {
            try {
                // Decodeer met RawDecoder voor volledige RAW (DNG, CR2, NEF, ARW), TIFF, JPG, PNG ondersteuning
                const decoded = await this.rawDecoder.decode(file);
                if (decoded && decoded.imageData) {
                    this.addPhotoToSession(decoded.imageData, {
                        filename: file.name,
                        filesize: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
                        originalFile: file,
                        isRaw: this.rawDecoder.isRaw(file.name)
                    });
                    successCount++;
                }
            } catch (err) {
                console.warn('Fout bij inlezen van bestand via RawDecoder:', file.name, err);
                try {
                    const bitmap = await createImageBitmap(file);
                    const c = document.createElement('canvas');
                    c.width = bitmap.width; c.height = bitmap.height;
                    const ctx = c.getContext('2d');
                    ctx.drawImage(bitmap, 0, 0);
                    const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
                    this.addPhotoToSession(imgData, {
                        filename: file.name,
                        filesize: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
                        originalFile: file,
                        isRaw: this.rawDecoder.isRaw(file.name)
                    });
                    successCount++;
                } catch (e2) {
                    console.warn(`Kon bestand '${file.name}' niet inlezen:`, e2);
                }
            }
        }

        document.getElementById('loading-overlay')?.classList.add('hidden');
        this.updateFilmstripUI();
        this.updateGridUI();

        if (this.viewMode === 'grid') {
            this.toggleGridMode(false);
        }

        // SCHAKEL ONMIDDELLIJK OVER NAAR DE NIEUW GEÏMPORTEERDE FOTO ZODAT DEZE GELIJK ZICHTBAAR IS!
        if (successCount > 0 && this.photos.length > startIndex) {
            this.setActivePhoto(this.photos.length - 1);
        }
    }

    addPhotoToSession(imageData, meta = {}) {
        // Maak kleine thumbnail voor de filmstrip
        const thumbCanvas = document.createElement('canvas');
        const aspect = (imageData.width || 1) / (imageData.height || 1);
        thumbCanvas.width = 140;
        thumbCanvas.height = Math.round(140 / aspect);
        const tCtx = thumbCanvas.getContext('2d');

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = imageData.width; tempCanvas.height = imageData.height;
        tempCanvas.getContext('2d').putImageData(imageData, 0, 0);
        tCtx.drawImage(tempCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
        const thumbUrl = thumbCanvas.toDataURL('image/jpeg', 0.7);

        const isRaw = meta.isRaw !== undefined ? meta.isRaw : (this.rawDecoder ? this.rawDecoder.isRaw(meta.filename) : false);

        const photo = {
            id: 'photo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            filename: meta.filename || `Foto_${this.photos.length + 1}.jpg`,
            filesize: meta.filesize || '4.0 MB',
            originalFile: meta.originalFile || null,
            isRaw: isRaw,
            originalImageData: new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height),
            currentImageData: new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height),
            thumbUrl: thumbUrl,
            state: this.getDefaultState(),
            rating: meta.rating !== undefined ? meta.rating : 0, // 0 = unrated, 1 t/m 7
            colorLabel: meta.colorLabel || 'none', // 'none', 'red', 'yellow', 'green', 'blue', 'purple'
            hasStageRed: false,
            localMaskCanvas: null,
            localMaskCtx: null,
            hasLocalMask: false,
            localState: {
                exposure: 0,
                contrast: 0,
                highlights: 0,
                temp: 0,
                saturation: 0,
                clarity: 0,
                selectiveBW: 'none'
            }
        };

        // Geen geforceerde bewerkingen bij inlezen: foto's openen 100% neutraal/origineel.
        // De gebruiker kiest zelf via de schuifregelaars of een preset gewenst is.

        // Optioneel: alleen als de gebruiker zelf een import profiel heeft opgeslagen en aangevinkt
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
        if (index < 0 || index >= this.photos.length) {
            if (this.photos.length === 0) {
                this.showEmptyState();
            }
            return;
        }
        this.activePhotoIndex = index;
        const photo = this.photos[index];

        document.getElementById('empty-session-state')?.classList.add('hidden');
        document.getElementById('canvas-wrapper')?.classList.remove('hidden');

        this.canvas.width = photo.currentImageData.width;
        this.canvas.height = photo.currentImageData.height;
        this.initMask(photo.currentImageData.width, photo.currentImageData.height);
        this.updateCachedCanvasRect();

        // Update info badge
        const badge = document.getElementById('photo-counter-badge');
        if (badge) badge.textContent = `${index + 1} / ${this.photos.length} Foto's`;

        const info = document.getElementById('photo-info-display');
        if (info) {
            info.textContent = `${photo.filename} | ${photo.currentImageData.width}×${photo.currentImageData.height}px | ${photo.filesize}`;
        }

        // Alert permanent verborgen houden zodat foto's rustig en ongehinderd bekeken kunnen worden
        const alertBox = document.getElementById('stage-red-detected-alert');
        if (alertBox) alertBox.classList.add('hidden');

        this.syncSliderUIFromPhoto(photo);
        this.syncLocalUIFromPhoto(photo);
        if (this.activeTool === 'local_adjust') {
            this.ensurePhotoLocalMask(photo);
        }
        if (photo.activePreset) {
            this.activePresetKey = photo.activePreset.key;
            this.activePresetAmount = photo.activePreset.amount ?? 100;
        } else {
            this.activePresetKey = null;
            this.activePresetAmount = 100;
        }
        this.syncPresetUI();
        this.updateRatingUI(photo);
        this.renderActivePhoto();
        this.updateFilmstripActiveOnly();
        if (this.viewMode === 'grid') {
            this.updateGridUI();
        }
    }

    updateActiveFilmstripCard(photo) {
        const activeItem = document.querySelector(`.filmstrip-item[data-index="${this.activePhotoIndex}"]`);
        if (!activeItem) {
            this.updateFilmstripUI();
            return;
        }
        let ratingBadge = activeItem.querySelector('.filmstrip-rating-badge');
        if (photo.rating && photo.rating > 0) {
            if (!ratingBadge) {
                ratingBadge = document.createElement('span');
                ratingBadge.className = 'filmstrip-rating-badge';
                activeItem.appendChild(ratingBadge);
            }
            ratingBadge.textContent = `⭐${photo.rating}`;
        } else if (ratingBadge) {
            ratingBadge.remove();
        }
        const colorCode = this.getColorCode(photo.colorLabel);
        if (colorCode) {
            activeItem.style.borderBottom = `3.5px solid ${colorCode}`;
        } else {
            activeItem.style.borderBottom = '';
        }
    }

    rateActivePhoto(rating) {
        const photo = this.getActivePhoto();
        if (!photo) return;
        photo.rating = (rating >= 0 && rating <= 7) ? rating : 0;
        this.updateRatingUI(photo);
        this.updateActiveFilmstripCard(photo);
        if (this.viewMode === 'grid') this.updateGridUI();
    }

    setColorLabelActivePhoto(color) {
        const photo = this.getActivePhoto();
        if (!photo) return;
        photo.colorLabel = color || 'none';
        this.updateRatingUI(photo);
        this.updateActiveFilmstripCard(photo);
        if (this.viewMode === 'grid') this.updateGridUI();
    }

    updateRatingUI(photo = null) {
        const p = photo || this.getActivePhoto();
        if (!p) return;
        const curRating = p.rating || 0;
        const curColor = p.colorLabel || 'none';

        // Update rating knoppen
        document.querySelectorAll('.culling-rate-btn').forEach(btn => {
            const r = parseInt(btn.dataset.rate, 10);
            btn.classList.toggle('active', r === curRating);
        });

        // Update kleurlabel knoppen
        document.querySelectorAll('.culling-color-btn').forEach(btn => {
            const c = btn.dataset.color;
            btn.classList.toggle('active', c === curColor);
        });
    }

    getColorCode(color) {
        const map = {
            'red': '#ef4444',
            'yellow': '#eab308',
            'green': '#22c55e',
            'blue': '#3b82f6',
            'purple': '#a855f7'
        };
        return map[color] || '';
    }

    cullKeepSelection() {
        if (this.photos.length === 0) return;
        const kept = this.photos.filter(p => (p.rating && p.rating > 0) || (p.colorLabel && p.colorLabel !== 'none'));
        const discardedCount = this.photos.length - kept.length;

        if (discardedCount === 0) {
            alert("Alle foto's in uw sessie hebben al een cijfer, ster of kleurlabel. Er zijn geen overige foto's om te wissen.");
            return;
        }

        if (kept.length === 0) {
            alert("Geef eerst minimaal 1 foto een cijfer (1 t/m 7), sterretje of kleurlabel voordat u de overige foto's verwijdert.");
            return;
        }

        const confirmed = confirm(
            `🧹 CULLING BEVESTIGEN:\n\n` +
            `• Geselecteerde foto's om te bewerken: ${kept.length}\n` +
            `• Foto's die uit het werkgeheugen worden gewist: ${discardedCount}\n\n` +
            `🛡️ VEILIGHEIDSGARANTIE: Uw originele foto's op de SD-kaart, camera of harde schijf blijven 100% onaangeroerd!\n\n` +
            `Wilt u doorgaan met culling?`
        );

        if (!confirmed) return;

        this.photos = kept;
        this.activePhotoIndex = Math.min(this.activePhotoIndex, this.photos.length - 1);
        this.updateFilmstripUI();
        this.updateGridUI();
        this.setActivePhoto(this.activePhotoIndex);
        alert(`✅ Culling voltooid! ${kept.length} geselecteerde foto('s) behouden in uw werkruimte. Originelen op bron blijven veilig bewaard.`);
    }

    async openHelpModal() {
        const modal = document.getElementById('help-modal');
        if (!modal) return;
        try {
            const res = await fetch(`version.json?nocache=${Date.now()}`);
            if (res.ok) {
                const data = await res.json();
                updateHelpModalFeatures(data);
            }
        } catch (e) {}
        modal.classList.remove('hidden');
    }

    openSDImportModal() {
        const modal = document.getElementById('sd-import-modal');
        const input = document.getElementById('sd-session-name-input');
        if (modal) {
            const now = new Date();
            const pad = (n) => String(n).padStart(2, '0');
            const defaultName = `Fotosessie_${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
            if (input && !input.value) input.value = defaultName;
            this.updateTargetLocationDisplay();
            modal.classList.remove('hidden');
        }
    }

    async pickTargetDestinationDir() {
        if (!('showDirectoryPicker' in window)) {
            // Safari / browsers zonder showDirectoryPicker: open direct het Exportcentrum
            this.openExportModalWithScope('all');
            return;
        }
        try {
            const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
            if (handle) {
                this.parentDestDirHandle = handle;
                this.sessionTargetLocationName = handle.name;
                this.updateDestinationFolderDisplay();
            }
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.warn("Fout bij kiezen doelmap:", err);
            }
        }
    }

    async pickCullDestinationDir() {
        if (!('showDirectoryPicker' in window)) {
            // Safari / browsers zonder showDirectoryPicker: open direct het Exportcentrum
            this.openExportModalWithScope('selected');
            return;
        }
        try {
            const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
            if (handle) {
                this.sessionDirHandle = handle;
                this.updateDestinationFolderDisplay();
            }
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.warn("Fout bij kiezen selectie doelmap:", err);
            }
        }
    }

    updateDestinationFolderDisplay() {
        // 1. Update weergave in de SD-inlezen modal
        const txt = document.getElementById('sd-target-location-txt');
        const input = document.getElementById('sd-session-name-input');
        const sessName = (input ? input.value.trim() : '') || 'Fotosessie';
        if (txt) {
            if (this.parentDestDirHandle) {
                txt.textContent = `📁 ${this.parentDestDirHandle.name} / ${sessName}`;
                txt.style.color = '#34d399';
            } else {
                txt.textContent = `(Nog niet gekozen — klik op 'Kies Locatie')`;
                txt.style.color = '#94a3b8';
            }
        }

        // 2. Update weergave direct in de culling-werkbalk
        const cullTxt = document.getElementById('cull-dest-folder-display');
        const subInput = document.getElementById('cull-subfolder-name');
        const subName = (subInput ? subInput.value.trim() : '') || 'Selectie';

        if (cullTxt) {
            if (this.sessionDirHandle) {
                cullTxt.textContent = `📁 ${this.sessionDirHandle.name}/${subName}`;
                cullTxt.style.color = '#34d399';
                cullTxt.title = `Doelmap op schijf: ${this.sessionDirHandle.name}/${subName}`;
            } else if (this.parentDestDirHandle) {
                cullTxt.textContent = `📁 ${this.parentDestDirHandle.name}/${sessName}/${subName}`;
                cullTxt.style.color = '#34d399';
                cullTxt.title = `Doelmap op schijf: ${this.parentDestDirHandle.name}/${sessName}/${subName}`;
            } else {
                cullTxt.textContent = `📍 (Klik 'Kies Doelmap')`;
                cullTxt.style.color = '#fbbf24';
                cullTxt.title = `Nog geen doelmap gekozen. Klik op 'Kies Doelmap' om een map op uw computer of schijf aan te wijzen.`;
            }
        }
    }

    updateTargetLocationDisplay() {
        this.updateDestinationFolderDisplay();
    }

    async confirmSDImport() {
        const input = document.getElementById('sd-session-name-input');
        const sessionName = input ? (input.value.trim() || 'Sessie_SD') : 'Sessie_SD';
        this.activeSessionName = sessionName;

        // Als er een aangepaste doelmap/locatie op schijf is gekozen, maak direct de sessiemap daarin aan
        if (this.parentDestDirHandle) {
            try {
                this.sessionDirHandle = await this.parentDestDirHandle.getDirectoryHandle(sessionName, { create: true });
                console.log(`✅ Sessiemap '${sessionName}' aangemaakt in gekozen opslaglocatie.`);
                this.updateDestinationFolderDisplay();
            } catch (err) {
                console.warn("Kon sessiemap niet direct aanmaken in parent:", err);
            }
        }

        document.getElementById('sd-import-modal')?.classList.add('hidden');

        // Probeert Native showDirectoryPicker (Chrome / Edge / Opera / moderne browsers)
        if ('showDirectoryPicker' in window) {
            try {
                document.getElementById('loading-overlay')?.classList.remove('hidden');
                const loadingText = document.getElementById('loading-text');
                if (loadingText) loadingText.textContent = `Selecteer bronmap op SD-kaart / externe schijf...`;

                const dirHandle = await window.showDirectoryPicker();
                if (loadingText) loadingText.textContent = `Bezig met scannen van foto's op SD-kaart/schijf...`;

                const validExts = ['jpg', 'jpeg', 'png', 'webp', 'raw', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'rw2', 'raf', 'orf', 'pef', 'tiff', 'tif'];
                const filesFound = [];

                async function scanDirectory(dh, depth = 0) {
                    if (depth > 4) return;
                    for await (const entry of dh.values()) {
                        if (entry.kind === 'file') {
                            const ext = entry.name.toLowerCase().split('.').pop();
                            if (validExts.includes(ext)) {
                                try {
                                    const file = await entry.getFile();
                                    filesFound.push(file);
                                } catch (fe) {}
                            }
                        } else if (entry.kind === 'directory') {
                            await scanDirectory(entry, depth + 1);
                        }
                    }
                }

                await scanDirectory(dirHandle);

                if (filesFound.length === 0) {
                    document.getElementById('loading-overlay')?.classList.add('hidden');
                    alert(`Geen ondersteunde foto's (RAW, DNG, JPG, PNG) gevonden in de geselecteerde map.`);
                    return;
                }

                if (loadingText) loadingText.textContent = `${filesFound.length} foto's inlezen in sessie '${sessionName}'...`;
                await this.loadMultipleFiles(filesFound);
                return;
            } catch (err) {
                document.getElementById('loading-overlay')?.classList.add('hidden');
                if (err.name === 'AbortError') return;
                console.warn('DirectoryPicker error of niet toegestaan, gebruik fallback:', err);
            }
        }

        // Fallback voor Safari/Firefox/iPad via webkitdirectory input
        const fallback = document.getElementById('sd-directory-fallback');
        if (fallback) fallback.click();
    }

    async saveSelectionDirectly() {
        if (this.photos.length === 0) {
            alert("Er zijn geen foto's geladen in de sessie.");
            return;
        }

        const subNameInput = document.getElementById('cull-subfolder-name');
        const subfolderName = (subNameInput ? subNameInput.value.trim() : '') || 'Selectie';
        const cullFormat = document.getElementById('cull-format-select')?.value || 'raw';

        const filterVal = document.getElementById('filmstrip-filter-select')?.value || 'all';
        let photosToSave = [];

        if (filterVal !== 'all') {
            photosToSave = this.getFilteredPhotos().map(it => it.photo);
        } else {
            photosToSave = this.photos.filter(p => (p.rating && p.rating > 0) || (p.colorLabel && p.colorLabel !== 'none'));
        }

        if (photosToSave.length === 0) {
            alert(
                "Geef eerst één of meerdere foto's een score (cijfer 1 t/m 7, ster of kleur) om direct op te slaan in de submap.\n\n" +
                "Gebruik sneltoetsen 1 t/m 7 op het toetsenbord of de knoppen in de culling-balk."
            );
            return;
        }

        let targetSubDir = null;
        let parentDirName = '';

        if ('showDirectoryPicker' in window) {
            try {
                if (!this.sessionDirHandle) {
                    if (this.parentDestDirHandle) {
                        const sessName = this.activeSessionName || 'Fotosessie';
                        this.sessionDirHandle = await this.parentDestDirHandle.getDirectoryHandle(sessName, { create: true });
                    } else {
                        // Direct Finder openen ZONDER blokkerende alert (behoudt user activation)
                        const chosen = await window.showDirectoryPicker({ mode: 'readwrite' });
                        if (chosen) {
                            this.sessionDirHandle = chosen;
                        }
                    }
                    this.updateDestinationFolderDisplay();
                }

                if (this.sessionDirHandle) {
                    parentDirName = this.sessionDirHandle.name;
                    targetSubDir = await this.sessionDirHandle.getDirectoryHandle(subfolderName, { create: true });
                }
            } catch (err) {
                if (err.name === 'AbortError') return;
                console.warn("Fout bij selecteren/maken van submap via Directory Picker:", err);
            }
        }

        if (targetSubDir) {
            const loadingOverlay = document.getElementById('loading-overlay');
            const loadingText = document.getElementById('loading-text');
            loadingOverlay?.classList.remove('hidden');

            try {
                let savedCount = 0;
                for (let i = 0; i < photosToSave.length; i++) {
                    const p = photosToSave[i];
                    if (loadingText) {
                        loadingText.textContent = `Opslaan in map '${parentDirName}/${subfolderName}' (${i + 1}/${photosToSave.length}): ${p.filename}...`;
                    }

                    let blob;
                    let ext = 'jpg';
                    const origExt = (p.filename.split('.').pop() || 'jpg').toLowerCase();
                    const isRaw = p.isRaw || (this.rawDecoder && this.rawDecoder.isRaw(p.filename));

                    if (cullFormat === 'raw') {
                        if (isRaw) {
                            if (p.originalFile) {
                                blob = p.originalFile;
                                ext = origExt;
                            } else {
                                const dngBytes = this.encodeTiffOrDng(p.currentImageData, true);
                                blob = new Blob([dngBytes.buffer], { type: 'image/x-adobe-dng' });
                                ext = 'dng';
                            }
                        } else {
                            blob = await this.renderPhotoToBlob(p, 'image/jpeg', 0.95);
                            ext = origExt === 'png' ? 'png' : 'jpg';
                        }
                    } else if (cullFormat === 'dng') {
                        const dngBytes = this.encodeTiffOrDng(p.currentImageData, true);
                        blob = new Blob([dngBytes.buffer], { type: 'image/x-adobe-dng' });
                        ext = 'dng';
                    } else if (cullFormat === 'tiff') {
                        const tiffBytes = this.encodeTiffOrDng(p.currentImageData, false);
                        blob = new Blob([tiffBytes.buffer], { type: 'image/tiff' });
                        ext = 'tif';
                    } else {
                        blob = await this.renderPhotoToBlob(p, 'image/jpeg', 0.95);
                        ext = 'jpg';
                    }

                    const cleanName = p.filename.replace(/\.[^/.]+$/, "") + `_selectie.${ext}`;
                    const fileHandle = await targetSubDir.getFileHandle(cleanName, { create: true });
                    const writable = await fileHandle.createWritable();
                    await writable.write(blob);
                    await writable.close();
                    savedCount++;
                }

                loadingOverlay?.classList.add('hidden');

                const folderPathStr = parentDirName ? `'${parentDirName}/${subfolderName}'` : `'${subfolderName}'`;
                const promptClean = confirm(
                    `✅ ${savedCount} geselecteerde foto's zijn succesvol opgeslagen in map ${folderPathStr} op uw computer/schijf!\n\n` +
                    `🛡️ VEILIGHEIDSGARANTIE: Uw originele foto's op de SD-kaart/camera blijven 100% onaangeroerd bewaard.\n\n` +
                    `Wilt u nu ook direct alle onbeoordeelde foto's sluiten om uitsluitend met uw geselecteerde foto's verder te gaan?`
                );

                if (promptClean) {
                    this.photos = photosToSave;
                    this.activePhotoIndex = 0;
                    this.updateFilmstripUI();
                    this.updateGridUI();
                    if (this.photos.length > 0) {
                        this.renderActivePhoto();
                    }
                }
                return;
            } catch (err) {
                loadingOverlay?.classList.add('hidden');
                alert(`Er is een fout opgetreden bij het wegschrijven: ${err.message}`);
                return;
            }
        }

        // Indien native Directory Picker niet beschikbaar is (bijv. oude browser)
        if (!('showDirectoryPicker' in window)) {
            this.openExportModalWithScope('selected');
        }
    }

    async saveWithFinder() {
        if (!this.photos || this.photos.length === 0) {
            alert("Er is geen foto geladen om op te slaan.");
            return;
        }

        const activePhoto = this.getActivePhoto();
        if (!activePhoto) return;

        // KEUZE A: 1 foto actief -> Direct de native Finder 'Bewaar Als' (Save As) dialoog openen!
        if (this.photos.length === 1 || !('showDirectoryPicker' in window)) {
            const origExt = (activePhoto.filename.split('.').pop() || 'jpg').toLowerCase();
            const isRaw = activePhoto.isRaw || (this.rawDecoder && this.rawDecoder.isRaw(activePhoto.filename));
            const defaultExt = isRaw ? (activePhoto.originalFile ? origExt : 'dng') : (origExt === 'png' ? 'png' : 'jpg');
            const defaultName = activePhoto.filename.replace(/\.[^/.]+$/, "") + `_bewerkt.${defaultExt}`;

            if ('showSaveFilePicker' in window) {
                try {
                    const mimeType = defaultExt === 'dng' ? 'image/x-adobe-dng' : (defaultExt === 'png' ? 'image/png' : 'image/jpeg');
                    // Direct Finder openen in het actieve klik-event zonder vertraging:
                    const fileHandle = await window.showSaveFilePicker({
                        suggestedName: defaultName,
                        types: [{
                            description: `Foto (*.${defaultExt})`,
                            accept: { [mimeType]: [`.${defaultExt}`] }
                        }]
                    });

                    const loadingOverlay = document.getElementById('loading-overlay');
                    const loadingText = document.getElementById('loading-text');
                    loadingOverlay?.classList.remove('hidden');
                    if (loadingText) loadingText.textContent = `Bezig met opslaan naar Finder (${fileHandle.name})...`;

                    let blob;
                    if (defaultExt === 'dng') {
                        const dngBytes = this.encodeTiffOrDng(activePhoto.currentImageData, true);
                        blob = new Blob([dngBytes.buffer], { type: 'image/x-adobe-dng' });
                    } else if (isRaw && activePhoto.originalFile && defaultExt === origExt) {
                        blob = activePhoto.originalFile;
                    } else if (defaultExt === 'png') {
                        blob = await this.renderPhotoToBlob(activePhoto, 'image/png', 0.95);
                    } else {
                        blob = await this.renderPhotoToBlob(activePhoto, 'image/jpeg', 0.95);
                    }

                    const writable = await fileHandle.createWritable();
                    await writable.write(blob);
                    await writable.close();

                    loadingOverlay?.classList.add('hidden');
                    alert(`✅ Foto succesvol opgeslagen in Finder als '${fileHandle.name}'!`);
                    return;
                } catch (err) {
                    document.getElementById('loading-overlay')?.classList.add('hidden');
                    if (err.name === 'AbortError') return;
                    console.warn("Fout bij showSaveFilePicker:", err);
                }
            }
        } else {
            // KEUZE B: Meerdere foto's in sessie: Open DIRECT Finder om de doelmap aan te wijzen!
            if ('showDirectoryPicker' in window) {
                try {
                    const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                    if (!dirHandle) return;

                    const loadingOverlay = document.getElementById('loading-overlay');
                    const loadingText = document.getElementById('loading-text');
                    loadingOverlay?.classList.remove('hidden');

                    let savedCount = 0;
                    for (let i = 0; i < this.photos.length; i++) {
                        const p = this.photos[i];
                        if (loadingText) loadingText.textContent = `Opslaan naar Finder map '${dirHandle.name}' (${i + 1}/${this.photos.length}): ${p.filename}...`;

                        const origExt = (p.filename.split('.').pop() || 'jpg').toLowerCase();
                        const isRaw = p.isRaw || (this.rawDecoder && this.rawDecoder.isRaw(p.filename));
                        const ext = isRaw ? (p.originalFile ? origExt : 'dng') : 'jpg';

                        let blob;
                        if (isRaw && p.originalFile) {
                            blob = p.originalFile;
                        } else if (isRaw) {
                            const dngBytes = this.encodeTiffOrDng(p.currentImageData, true);
                            blob = new Blob([dngBytes.buffer], { type: 'image/x-adobe-dng' });
                        } else {
                            blob = await this.renderPhotoToBlob(p, 'image/jpeg', 0.95);
                        }

                        const cleanName = p.filename.replace(/\.[^/.]+$/, "") + `_bewerkt.${ext}`;
                        const fileHandle = await dirHandle.getFileHandle(cleanName, { create: true });
                        const writable = await fileHandle.createWritable();
                        await writable.write(blob);
                        await writable.close();
                        savedCount++;
                    }

                    loadingOverlay?.classList.add('hidden');
                    alert(`✅ ${savedCount} foto's zijn succesvol opgeslagen in Finder in map '${dirHandle.name}'!`);
                    return;
                } catch (err) {
                    document.getElementById('loading-overlay')?.classList.add('hidden');
                    if (err.name === 'AbortError') return;
                    console.warn("Fout bij showDirectoryPicker:", err);
                }
            }
        }

        // Alleen indien browser geen native file pickers ondersteunt:
        this.openExportModalWithScope('current');
    }

    openExportModalWithScope(targetScope = 'all') {
        const modal = document.getElementById('export-modal');
        const sel = document.getElementById('export-scope');
        if (sel) sel.value = targetScope;
        modal?.classList.remove('hidden');
    }

    showEmptyState() {
        this.activePhotoIndex = -1;
        const badge = document.getElementById('photo-counter-badge');
        if (badge) badge.textContent = `0 Foto's`;

        const info = document.getElementById('photo-info-display');
        if (info) info.textContent = 'Geen foto geopend';

        const alertBox = document.getElementById('stage-red-detected-alert');
        if (alertBox) alertBox.classList.add('hidden');

        if (this.ctx && this.canvas) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }

        document.getElementById('empty-session-state')?.classList.remove('hidden');
        document.getElementById('canvas-wrapper')?.classList.add('hidden');

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
        if (index < 0 || index >= this.photos.length) return;

        const removedName = this.photos[index].filename;
        this.photos.splice(index, 1);

        if (this.photos.length === 0) {
            this.showEmptyState();
            return;
        }

        if (this.activePhotoIndex >= this.photos.length) {
            this.activePhotoIndex = this.photos.length - 1;
        } else if (this.activePhotoIndex > index) {
            this.activePhotoIndex--;
        }
        this.setActivePhoto(this.activePhotoIndex);
    }

    removeActivePhoto() {
        if (this.activePhotoIndex < 0 || this.photos.length === 0) {
            alert('Er is momenteel geen actieve foto om te verwijderen.');
            return;
        }
        const photo = this.getActivePhoto();
        const name = photo ? photo.filename : 'deze foto';
        if (confirm(`Wil je '${name}' verwijderen uit de sessie?`)) {
            this.removePhoto(this.activePhotoIndex);
        }
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

    getFilteredPhotos() {
        const filter = document.getElementById('filmstrip-filter-select')?.value || 'all';
        let items = this.photos.map((p, idx) => ({ photo: p, originalIndex: idx }));

        if (filter === 'rated') {
            items = items.filter(it => (it.photo.rating > 0) || (it.photo.colorLabel && it.photo.colorLabel !== 'none'));
        } else if (filter === 'stars3') {
            items = items.filter(it => it.photo.rating >= 3);
        } else if (filter === 'stars5') {
            items = items.filter(it => it.photo.rating >= 5);
        } else if (filter.startsWith('rate_')) {
            const targetR = parseInt(filter.replace('rate_', ''), 10);
            items = items.filter(it => it.photo.rating === targetR);
        } else if (filter.startsWith('color_')) {
            const targetC = filter.replace('color_', '');
            items = items.filter(it => it.photo.colorLabel === targetC);
        }

        return items;
    }

    // Filmstrip UI rendering met culling & oneindig veel foto's
    updateFilmstripUI() {
        const container = document.getElementById('filmstrip-scroll');
        const countTxt = document.getElementById('filmstrip-count-txt');
        if (!container) return;

        const visibleItems = this.getFilteredPhotos();
        if (countTxt) {
            countTxt.textContent = visibleItems.length === this.photos.length
                ? `${this.photos.length} Foto's`
                : `${visibleItems.length} van ${this.photos.length} Foto's`;
        }

        container.innerHTML = '';

        visibleItems.forEach(({ photo, originalIndex }) => {
            const item = document.createElement('div');
            item.className = `filmstrip-item ${originalIndex === this.activePhotoIndex ? 'active' : ''}`;
            item.dataset.index = originalIndex;
            item.title = `${photo.filename} (Foto ${originalIndex + 1}) - Score: ${photo.rating || 0}`;
            item.onclick = () => this.setActivePhoto(originalIndex);

            let ratingBadge = '';
            if (photo.rating && photo.rating > 0) {
                ratingBadge = `<span class="filmstrip-rating-badge">⭐${photo.rating}</span>`;
            }

            const colorCode = this.getColorCode(photo.colorLabel);
            const colorBarStyle = colorCode ? `border-bottom: 3.5px solid ${colorCode} !important;` : '';

            item.innerHTML = `
                <img src="${photo.thumbUrl}" alt="Thumb ${originalIndex + 1}">
                <span class="filmstrip-badge">#${originalIndex + 1}</span>
                ${ratingBadge}
                <span class="filmstrip-close" title="Verwijder foto #${originalIndex + 1} (${photo.filename})" onclick="vroonApp.removePhoto(${originalIndex}, event)">✕</span>
            `;
            if (colorBarStyle) item.style.cssText += colorBarStyle;
            container.appendChild(item);
        });

        // Voeg '+' toe (oneindig / onbeperkt foto's toevoegen)
        const addCard = document.createElement('label');
        addCard.className = 'filmstrip-add-card';
        addCard.title = "Voeg foto's toe (onbeperkt)";
        addCard.innerHTML = `
            <span style="font-size: 16px;">➕</span>
            <span>Toevoegen</span>
            <input type="file" multiple accept="image/*,.raw,.dng,.cr2,.cr3,.nef,.arw,.rw2,.raf,.orf,.pef,.tiff,.tif" style="display:none;" onchange="vroonApp.loadMultipleFiles(this.files); this.value='';">
        `;
        container.appendChild(addCard);
    }

    // Raster Overzicht UI rendering (onbeperkt foto's overzichtelijk scherm)
    updateGridUI() {
        if (this.viewMode !== 'grid') return;
        const grid = document.getElementById('photos-grid');
        const countTxt = document.getElementById('grid-count-txt');
        if (!grid) return;

        const visibleItems = this.getFilteredPhotos();
        if (countTxt) {
            countTxt.textContent = visibleItems.length === this.photos.length
                ? `${this.photos.length} Foto's`
                : `${visibleItems.length} van ${this.photos.length} Foto's`;
        }

        grid.innerHTML = '';

        visibleItems.forEach(({ photo, originalIndex }) => {
            const card = document.createElement('div');
            card.className = `grid-photo-card ${originalIndex === this.activePhotoIndex ? 'active' : ''}`;
            card.onclick = () => {
                this.setActivePhoto(originalIndex);
                this.toggleGridMode(false);
            };

            let ratingHtml = '';
            if (photo.rating && photo.rating > 0) {
                ratingHtml = `<span style="color:#fbbf24; font-weight:800;">⭐ ${photo.rating}</span>`;
            }

            const colorCode = this.getColorCode(photo.colorLabel);
            if (colorCode) {
                card.style.borderBottom = `4px solid ${colorCode}`;
            }

            card.innerHTML = `
                <img class="grid-photo-thumb" src="${photo.thumbUrl}" alt="Photo ${originalIndex + 1}">
                <span class="grid-photo-delete-btn" title="Verwijder foto #${originalIndex + 1} (${photo.filename})" onclick="vroonApp.removePhoto(${originalIndex}, event)">🗑️</span>
                <div class="grid-photo-meta">
                    <span class="grid-photo-title">#${originalIndex + 1} ${photo.filename}</span>
                    <span class="grid-photo-sub">
                        <span>${photo.filesize}</span>
                        ${ratingHtml}
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
        this.syncBWUI(photo);
    }

    syncBWUI(photo) {
        if (!photo) return;
        const isBW = !!photo.state.bwEnabled;

        // Header knop
        const hdrBtn = document.getElementById('btn-hdr-bw-toggle');
        const hdrIcon = document.getElementById('btn-hdr-bw-icon');
        const hdrTxt = document.getElementById('btn-hdr-bw-txt');
        if (hdrBtn) {
            hdrBtn.classList.toggle('btn-bw-active', isBW);
            if (hdrIcon) hdrIcon.textContent = isBW ? '🌈' : '⚡';
            if (hdrTxt) hdrTxt.textContent = isBW ? 'Kleur Herstellen' : 'Zwart-Wit';
        }

        // Grote 1-klik knop in paneel
        const bigBtn = document.getElementById('btn-toggle-bw-big');
        if (bigBtn) {
            bigBtn.classList.toggle('btn-bw-active', isBW);
            bigBtn.innerHTML = isBW ? '🌈 Zwart-Wit Actief (Klik voor Kleur)' : '⚡ 1-Klik: Zet om naar Zwart-Wit';
        }

        // Pil-knop in sectiekop
        const pill = document.getElementById('btn-toggle-bw-pill');
        if (pill) {
            pill.textContent = isBW ? 'Aan ✕' : 'Omzetten';
            pill.classList.toggle('active', isBW);
        }

        const panel = document.getElementById('bw-mixer-panel');
        if (panel) {
            panel.classList.toggle('bw-active-glow', isBW);
            panel.classList.toggle('disabled', !isBW);
        }
    }

    toggleBWMode(forceState = null) {
        const photo = this.getActivePhoto();
        if (!photo) return;

        if (forceState !== null) {
            photo.state.bwEnabled = forceState;
        } else {
            photo.state.bwEnabled = !photo.state.bwEnabled;
        }

        if (photo.state.bwEnabled) {
            if (!photo.state.bwContrast && !photo.state.bwClarity) {
                photo.state.bwContrast = 35;
                photo.state.bwClarity = 45;
                photo.state.bwGrain = 10;
                photo.state.bwRed = 40;
                photo.state.bwGreen = 10;
                photo.state.bwBlue = -10;
            }
        }

        this.syncSliderUIFromPhoto(photo);
        this.renderActivePhoto();

        if (photo.state.bwEnabled) {
            document.getElementById('section-bw-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    syncPresetUI() {
        const slider = document.getElementById('slider-preset-amount');
        const valSpan = document.getElementById('slider-preset-amount-val');
        const nameSpan = document.getElementById('active-preset-name');
        if (slider) slider.value = this.activePresetAmount;
        if (valSpan) valSpan.textContent = `${this.activePresetAmount}%`;
        if (nameSpan) {
            if (this.activePresetKey && PRESET_DEFINITIONS[this.activePresetKey]) {
                nameSpan.textContent = PRESET_DEFINITIONS[this.activePresetKey].name;
            } else {
                nameSpan.textContent = 'Geen preset actief';
            }
        }
        document.querySelectorAll('.preset-card').forEach(card => {
            card.classList.toggle('active', card.dataset.preset === this.activePresetKey);
        });
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

        // 4. Lightroom Basics (Belichting, Contrast, Highlights, Shadows, Whites, Blacks, Temp, Tint, Vibrance, Saturation)
        const exp = Math.pow(2.0, photo.state.exposure / 2.0);
        const cont = (photo.state.contrast + 100.0) / 100.0;
        const temp = (photo.state.temp / 100.0) * 35.0;
        const tint = (photo.state.tint / 100.0) * 20.0;
        const sat = (photo.state.saturation + 100.0) / 100.0;
        const vib = (photo.state.vibrance / 100.0);
        const hl = (photo.state.highlights || 0) / 100.0;
        const sh = (photo.state.shadows || 0) / 100.0;
        const wh = (photo.state.whites || 0) / 100.0;
        const bl = (photo.state.blacks || 0) / 100.0;

        for (let i = 0; i < data.length; i += 4) {
            let r = data[i] * exp + temp + tint * 0.25;
            let g = data[i + 1] * exp - tint * 0.5;
            let b = data[i + 2] * exp - temp + tint * 0.25;

            // Contrast
            r = 128.0 + (r - 128.0) * cont;
            g = 128.0 + (g - 128.0) * cont;
            b = 128.0 + (b - 128.0) * cont;

            // Highlights, Shadows, Whites, Blacks
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            const normLum = Math.max(0, Math.min(1, lum / 255.0));
            const shadowWeight = (1.0 - normLum) * (1.0 - normLum);
            const highlightWeight = normLum * normLum;
            const toneDelta = (sh * shadowWeight * 50.0) + (hl * highlightWeight * 50.0) + (wh * highlightWeight * 25.0) + (bl * shadowWeight * 25.0);

            r += toneDelta;
            g += toneDelta;
            b += toneDelta;

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

        // 6. Vignettering (Donker ◄► Licht)
        if (photo.state.vignetteAmount && Math.abs(photo.state.vignetteAmount) > 0.01) {
            this.wasm.applyVignette(
                img,
                photo.state.vignetteAmount,
                photo.state.vignetteMidpoint !== undefined ? photo.state.vignetteMidpoint : 50,
                photo.state.vignetteFeather !== undefined ? photo.state.vignetteFeather : 50
            );
        }

        // 7. Lokale Aanpassingen (Pen, Hand/Touch of Muis op specifieke onderdelen van de foto)
        if (photo.localMaskCanvas && photo.hasLocalMask) {
            this.applyLocalAdjustmentsToImage(img, photo);
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

        if (this.activeTool === 'local_adjust' && this.showLocalMaskOverlay && photo.localMaskCanvas && photo.hasLocalMask) {
            this.ctx.save();
            if (!this.overlayCanvas) {
                this.overlayCanvas = document.createElement('canvas');
            }
            if (this.overlayCanvas.width !== w || this.overlayCanvas.height !== h) {
                this.overlayCanvas.width = w; this.overlayCanvas.height = h;
            }
            const oCtx = this.overlayCanvas.getContext('2d');
            oCtx.clearRect(0, 0, w, h);
            oCtx.drawImage(photo.localMaskCanvas, 0, 0);
            oCtx.globalCompositeOperation = 'source-in';
            oCtx.fillStyle = 'rgba(239, 68, 68, 0.42)'; // Robijnrode overlay zoals Lightroom masker
            oCtx.fillRect(0, 0, w, h);

            this.ctx.drawImage(this.overlayCanvas, 0, 0);
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
        this.maskCtx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
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
            if (mData[i + 3] > 30 && mData[i] > 50) {
                mask[j] = 255;
                hasMaskPixels = true;
            } else {
                mask[j] = 0;
            }
        }

        if (!hasMaskPixels) {
            alert("Schilder eerst met de muis of je vinger over het object of de persoon die je wilt verwijderen.");
            return;
        }

        const loadingOverlay = document.getElementById('loading-overlay');
        const loadingText = document.getElementById('loading-text');
        loadingOverlay?.classList.remove('hidden');
        if (loadingText) loadingText.textContent = "Bezig met naadloos verwijderen van object / persoon via contextuele synthese...";

        setTimeout(() => {
            this.wasm.smartInpaint(photo.originalImageData, mask, 4);
            this.clearMask();
            this.renderActivePhoto();
            loadingOverlay?.classList.add('hidden');
        }, 50);
    }

    // ═══════════════════════════════════════════════════════
    //  5.5 LOKAAL AANPASSINGSPENSEEL ENGINE (PEN, TOUCH & MUIS)
    // ═══════════════════════════════════════════════════════

    ensurePhotoLocalMask(photo) {
        if (!photo) return null;
        if (!photo.localMaskCanvas) {
            photo.localMaskCanvas = document.createElement('canvas');
            photo.localMaskCanvas.width = photo.originalImageData.width;
            photo.localMaskCanvas.height = photo.originalImageData.height;
            photo.localMaskCtx = photo.localMaskCanvas.getContext('2d', { willReadFrequently: true });
        }
        if (!photo.localState) {
            photo.localState = {
                exposure: 0,
                contrast: 0,
                highlights: 0,
                temp: 0,
                saturation: 0,
                clarity: 0,
                selectiveBW: 'none'
            };
        }
        return photo.localMaskCanvas;
    }

    syncLocalUIFromPhoto(photo) {
        if (!photo || !photo.localState) return;
        const ls = photo.localState;
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            const txt = document.getElementById(`${id}-val`);
            if (el) el.value = val;
            if (txt) txt.textContent = val;
        };
        setVal('local-exposure', ls.exposure || 0);
        setVal('local-contrast', ls.contrast || 0);
        setVal('local-highlights', ls.highlights || 0);
        setVal('local-temp', ls.temp || 0);
        setVal('local-saturation', ls.saturation || 0);
        setVal('local-clarity', ls.clarity || 0);
        const bwSel = document.getElementById('local-bw-select');
        if (bwSel) bwSel.value = ls.selectiveBW || 'none';
    }

    toggleLocalAdjustTool(forceState = null) {
        const nextState = forceState !== null ? forceState : (this.activeTool !== 'local_adjust');
        this.activeTool = nextState ? 'local_adjust' : 'adjust';

        const panel = document.getElementById('local-adjust-controls');
        const toolBtn = document.getElementById('tool-local-adjust');
        const hdrBtn = document.getElementById('btn-hdr-local-brush');
        const inpaintControls = document.getElementById('inpaint-controls');
        const inpaintBtn = document.getElementById('tool-inpaint');

        if (this.activeTool === 'local_adjust') {
            panel?.classList.remove('hidden');
            toolBtn?.classList.add('active');
            hdrBtn?.classList.add('active');
            inpaintControls?.classList.add('hidden');
            inpaintBtn?.classList.remove('active');

            const photo = this.getActivePhoto();
            if (photo) {
                this.ensurePhotoLocalMask(photo);
                this.syncLocalUIFromPhoto(photo);
            }
        } else {
            panel?.classList.add('hidden');
            toolBtn?.classList.remove('active');
            hdrBtn?.classList.remove('active');
        }

        const circle = document.getElementById('brush-cursor-circle');
        if (circle && this.activeTool !== 'local_adjust' && this.activeTool !== 'inpaint') {
            circle.style.display = 'none';
        }

        this.drawActiveCanvas();
    }

    setLocalBrushMode(mode) {
        this.localBrushMode = mode;
        const brushBtn = document.getElementById('btn-local-brush-mode');
        const eraserBtn = document.getElementById('btn-local-eraser-mode');
        if (mode === 'brush') {
            brushBtn?.classList.add('active');
            eraserBtn?.classList.remove('active');
        } else {
            eraserBtn?.classList.add('active');
            brushBtn?.classList.remove('active');
        }
    }

    toggleLocalMaskOverlay() {
        this.showLocalMaskOverlay = !this.showLocalMaskOverlay;
        const btn = document.getElementById('btn-local-toggle-overlay');
        if (btn) {
            btn.style.color = this.showLocalMaskOverlay ? '#ef4444' : '#64748b';
            btn.style.borderColor = this.showLocalMaskOverlay ? '#ef4444' : 'var(--border-glow)';
        }
        this.drawActiveCanvas();
    }

    paintLocalStroke(clientX, clientY, pressure = 0.5, isStart = false) {
        const photo = this.getActivePhoto();
        if (!photo) return;
        this.ensurePhotoLocalMask(photo);
        const ctx = photo.localMaskCtx;
        if (!ctx || !this.canvas) return;

        const rect = this.cachedCanvasRect || this.canvas.getBoundingClientRect();
        const sx = this.canvas.width / rect.width;
        const sy = this.canvas.height / rect.height;
        const x = (clientX - rect.left) * sx;
        const y = (clientY - rect.top) * sy;

        const baseSize = this.localBrushSize || parseInt(document.getElementById('local-brush-size')?.value || 35, 10);
        const feather = parseInt(document.getElementById('local-brush-feather')?.value || 40, 10);
        let effectiveRadius = baseSize;
        if (this.activePointerType === 'pen' && pressure > 0) {
            effectiveRadius = Math.max(3, baseSize * (0.35 + 0.65 * pressure));
        }

        const isEraser = this.localBrushMode === 'eraser';
        ctx.save();
        ctx.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';

        const drawDot = (px, py, rad) => {
            if (rad <= 1) rad = 1.5;
            if (feather <= 5) {
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(px, py, rad, 0, Math.PI * 2);
                ctx.fill();
            } else {
                const grad = ctx.createRadialGradient(px, py, Math.max(0, rad * (1.0 - feather / 100.0)), px, py, rad);
                grad.addColorStop(0, '#ffffff');
                grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(px, py, rad, 0, Math.PI * 2);
                ctx.fill();
            }
        };

        if (isStart || !this.lastLocalPointerPos) {
            drawDot(x, y, effectiveRadius);
        } else {
            const dist = Math.hypot(x - this.lastLocalPointerPos.x, y - this.lastLocalPointerPos.y);
            const step = Math.max(2, effectiveRadius * 0.25);
            const steps = Math.ceil(dist / step);
            for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                const ix = this.lastLocalPointerPos.x + (x - this.lastLocalPointerPos.x) * t;
                const iy = this.lastLocalPointerPos.y + (y - this.lastLocalPointerPos.y) * t;
                drawDot(ix, iy, effectiveRadius);
            }
        }
        ctx.restore();

        // Directe realtime visuele feedback zonder zware herberekening tijdens de streek
        if (this.showLocalMaskOverlay) {
            this.ctx.save();
            this.ctx.fillStyle = isEraser ? 'rgba(11, 17, 30, 0.45)' : 'rgba(239, 68, 68, 0.35)';
            this.ctx.beginPath();
            this.ctx.arc(x, y, effectiveRadius, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.restore();
        }

        this.lastLocalPointerPos = { x, y };
        photo.hasLocalMask = true;
    }

    applyLocalAdjustmentsToImage(img, photo) {
        if (!photo.localMaskCanvas || !photo.hasLocalMask) return;
        const maskCtx = photo.localMaskCtx;
        if (!maskCtx) return;

        const w = img.width, h = img.height;
        const maskData = maskCtx.getImageData(0, 0, w, h).data;
        const data = img.data;
        const ls = photo.localState || {};

        const exp = ls.exposure !== 0 ? Math.pow(2.0, (ls.exposure / 50.0)) : 1.0;
        const cont = ls.contrast !== 0 ? (ls.contrast + 100.0) / 100.0 : 1.0;
        const hl = (ls.highlights || 0) / 100.0;
        const temp = ((ls.temp || 0) / 100.0) * 40.0;
        const sat = ls.saturation !== 0 ? (ls.saturation + 100.0) / 100.0 : 1.0;
        const clarity = (ls.clarity || 0) / 100.0;
        const sbw = ls.selectiveBW || 'none';

        const hasAnyLocalAdjustment = (
            ls.exposure !== 0 || ls.contrast !== 0 || ls.highlights !== 0 ||
            ls.temp !== 0 || ls.saturation !== 0 || ls.clarity !== 0 || sbw !== 'none'
        );

        if (!hasAnyLocalAdjustment) return;

        for (let i = 0; i < data.length; i += 4) {
            const mVal = maskData[i + 3];
            if (mVal < 2) {
                if (sbw === 'color_splash') {
                    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                    data[i] = gray | 0;
                    data[i + 1] = gray | 0;
                    data[i + 2] = gray | 0;
                }
                continue;
            }

            const m = mVal / 255.0;
            const r0 = data[i], g0 = data[i + 1], b0 = data[i + 2];
            let r = r0, g = g0, b = b0;

            if (sbw === 'painted_bw') {
                const gray = 0.299 * r + 0.587 * g + 0.114 * b;
                r = gray; g = gray; b = gray;
            }

            if (exp !== 1.0) {
                r *= exp; g *= exp; b *= exp;
            }

            if (temp !== 0) {
                r += temp;
                b -= temp;
            }

            if (cont !== 1.0) {
                r = 128.0 + (r - 128.0) * cont;
                g = 128.0 + (g - 128.0) * cont;
                b = 128.0 + (b - 128.0) * cont;
            }

            if (hl !== 0) {
                const lum = 0.299 * r + 0.587 * g + 0.114 * b;
                const normLum = Math.max(0, Math.min(1, lum / 255.0));
                const delta = hl > 0
                    ? (normLum * normLum * hl * 45.0)
                    : ((1.0 - normLum) * (1.0 - normLum) * hl * 45.0);
                r += delta; g += delta; b += delta;
            }

            if (sat !== 1.0) {
                const gray = 0.299 * r + 0.587 * g + 0.114 * b;
                r = gray + (r - gray) * sat;
                g = gray + (g - gray) * sat;
                b = gray + (b - gray) * sat;
            }

            if (clarity !== 0) {
                const distR = (r - 128.0) / 128.0;
                const distG = (g - 128.0) / 128.0;
                const distB = (b - 128.0) / 128.0;
                r += distR * Math.abs(distR) * clarity * 35.0;
                g += distG * Math.abs(distG) * clarity * 35.0;
                b += distB * Math.abs(distB) * clarity * 35.0;
            }

            data[i]     = Math.min(255, Math.max(0, (r0 * (1.0 - m) + r * m) | 0));
            data[i + 1] = Math.min(255, Math.max(0, (g0 * (1.0 - m) + g * m) | 0));
            data[i + 2] = Math.min(255, Math.max(0, (b0 * (1.0 - m) + b * m) | 0));
        }
    }

    invertLocalMask() {
        const photo = this.getActivePhoto();
        if (!photo) return;
        this.ensurePhotoLocalMask(photo);
        const w = photo.localMaskCanvas.width, h = photo.localMaskCanvas.height;
        const ctx = photo.localMaskCtx;
        const imgD = ctx.getImageData(0, 0, w, h);
        const d = imgD.data;
        for (let i = 0; i < d.length; i += 4) {
            const currentA = d[i + 3];
            d[i] = 255;
            d[i + 1] = 255;
            d[i + 2] = 255;
            d[i + 3] = 255 - currentA;
        }
        ctx.putImageData(imgD, 0, 0);
        photo.hasLocalMask = true;
        this.renderActivePhoto();
    }

    clearLocalMask() {
        const photo = this.getActivePhoto();
        if (!photo) return;
        if (photo.localMaskCtx) {
            photo.localMaskCtx.clearRect(0, 0, photo.localMaskCanvas.width, photo.localMaskCanvas.height);
        }
        photo.hasLocalMask = false;
        if (photo.localState) {
            photo.localState = {
                exposure: 0,
                contrast: 0,
                highlights: 0,
                temp: 0,
                saturation: 0,
                clarity: 0,
                selectiveBW: 'none'
            };
        }
        this.syncLocalUIFromPhoto(photo);
        this.renderActivePhoto();
    }

    bakeLocalAdjustments() {
        const photo = this.getActivePhoto();
        if (!photo || !photo.hasLocalMask) {
            alert("Er is nog geen onderdeel geschilderd of aangepast om toe te passen.");
            return;
        }
        photo.originalImageData = new ImageData(
            new Uint8ClampedArray(photo.currentImageData.data),
            photo.currentImageData.width,
            photo.currentImageData.height
        );
        this.clearLocalMask();
        alert("✨ De lokale aanpassing is definitief toegepast op de foto! U kunt nu eventueel direct een volgend onderdeel schilderen en bewerken.");
    }

    // Presets (12 Lightroom & AI Presets + Proportionele Verhouding/Intensiteit 0% - 200%)
    applyBWPreset(preset) {
        this.applyGlobalPreset(preset, 100);
    }

    applyGlobalPreset(name, amount = 100) {
        const photo = this.getActivePhoto();
        if (!photo) return;
        const preset = PRESET_DEFINITIONS[name];
        if (!preset) return;

        this.activePresetKey = name;
        this.activePresetAmount = amount;
        photo.activePreset = { key: name, amount: amount };

        this.syncPresetUI();

        const d = this.getDefaultState();
        const factor = amount / 100.0;

        const presetKeys = [
            'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks',
            'temp', 'tint', 'vibrance', 'saturation',
            'stageRedFix', 'colorBleedReduction', 'skinProtection', 'gamutCompress',
            'smartDeblur', 'deblurSkinProtect',
            'denoiseLuma', 'denoiseChroma', 'denoiseDetail',
            'bwEnabled', 'bwRed', 'bwGreen', 'bwBlue', 'bwContrast', 'bwClarity', 'bwGrain',
            'vignetteAmount', 'vignetteMidpoint', 'vignetteFeather'
        ];

        // Reset beïnvloede parameters naar schone neutrale basis
        presetKeys.forEach(k => {
            if (d[k] !== undefined) {
                photo.state[k] = d[k];
            }
        });

        // Pas preset recept proportioneel toe geschaald met factor
        for (const [key, targetVal] of Object.entries(preset.params)) {
            if (typeof targetVal === 'boolean') {
                photo.state[key] = factor > 0.05 ? targetVal : (d[key] !== undefined ? d[key] : false);
            } else {
                const def = d[key] !== undefined ? d[key] : 0;
                const diff = targetVal - def;
                let scaled = def + diff * factor;

                if (key === 'exposure') {
                    scaled = Math.max(-5, Math.min(5, Math.round(scaled * 10) / 10));
                } else if (['contrast', 'highlights', 'shadows', 'whites', 'blacks', 'temp', 'tint', 'vibrance', 'saturation', 'bwRed', 'bwGreen', 'bwBlue', 'vignetteAmount'].includes(key)) {
                    scaled = Math.max(-100, Math.min(100, Math.round(scaled)));
                } else {
                    scaled = Math.max(0, Math.min(100, Math.round(scaled)));
                }
                photo.state[key] = scaled;
            }
        }

        this.syncSliderUIFromPhoto(photo);
        this.renderActivePhoto();
    }

    resetSection(s) {
        if (!s) return;
        const photo = this.getActivePhoto();
        if (!photo) return;
        const d = this.getDefaultState();
        if (s === 'stage_red') ['stageRedFix', 'colorBleedReduction', 'skinProtection', 'gamutCompress', 'stageBandingReduction'].forEach(k => photo.state[k] = d[k]);
        if (s === 'deblur') ['smartDeblur', 'deblurSkinProtect'].forEach(k => photo.state[k] = d[k]);
        if (s === 'denoise') ['denoiseLuma', 'denoiseChroma', 'denoiseDetail'].forEach(k => photo.state[k] = d[k]);
        if (s === 'tone') ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'temp', 'tint', 'vibrance', 'saturation'].forEach(k => photo.state[k] = d[k]);
        if (s === 'bw_filters') ['bwRed', 'bwGreen', 'bwBlue'].forEach(k => photo.state[k] = d[k]);
        if (s === 'bw') ['bwEnabled', 'bwRed', 'bwGreen', 'bwBlue', 'bwContrast', 'bwClarity', 'bwGrain'].forEach(k => photo.state[k] = d[k]);
        if (s === 'vignette') ['vignetteAmount', 'vignetteMidpoint', 'vignetteFeather'].forEach(k => photo.state[k] = d[k]);
        this.syncSliderUIFromPhoto(photo);
        this.syncLocalUIFromPhoto(photo);
        if (this.activeTool === 'local_adjust') {
            this.ensurePhotoLocalMask(photo);
        }
        if (photo.activePreset) {
            this.activePresetKey = photo.activePreset.key;
            this.activePresetAmount = photo.activePreset.amount ?? 100;
        } else {
            this.activePresetKey = null;
            this.activePresetAmount = 100;
        }
        this.syncPresetUI();
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
        if (photo.inpaintMask && photo.inpaintMask.length === s.width * s.height) {
            const newMask = new Uint8Array(s.width * s.height);
            for (let y = 0; y < s.height; y++) {
                for (let x = 0; x < s.width; x++) {
                    const dx = deg === 90 ? s.height - 1 - y : y;
                    const dy = deg === 90 ? x : s.width - 1 - x;
                    newMask[dy * dst.width + dx] = photo.inpaintMask[y * s.width + x];
                }
            }
            photo.inpaintMask = newMask;
        }
        if (photo.localMask && photo.localMask.length === s.width * s.height) {
            const newLocalMask = new Uint8Array(s.width * s.height);
            for (let y = 0; y < s.height; y++) {
                for (let x = 0; x < s.width; x++) {
                    const dx = deg === 90 ? s.height - 1 - y : y;
                    const dy = deg === 90 ? x : s.width - 1 - x;
                    newLocalMask[dy * dst.width + dx] = photo.localMask[y * s.width + x];
                }
            }
            photo.localMask = newLocalMask;
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
        if (photo.inpaintMask && photo.inpaintMask.length === s.width * s.height) {
            const newMask = new Uint8Array(s.width * s.height);
            for (let y = 0; y < s.height; y++) {
                for (let x = 0; x < s.width; x++) {
                    newMask[y * s.width + (s.width - 1 - x)] = photo.inpaintMask[y * s.width + x];
                }
            }
            photo.inpaintMask = newMask;
        }
        if (photo.localMask && photo.localMask.length === s.width * s.height) {
            const newLocalMask = new Uint8Array(s.width * s.height);
            for (let y = 0; y < s.height; y++) {
                for (let x = 0; x < s.width; x++) {
                    newLocalMask[y * s.width + (s.width - 1 - x)] = photo.localMask[y * s.width + x];
                }
            }
            photo.localMask = newLocalMask;
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
        const format = document.getElementById('export-format')?.value || 'original-raw';
        const quality = parseFloat(document.getElementById('export-quality')?.value || 0.95);
        const method = document.getElementById('export-method')?.value || 'folder';

        let photosToExport;
        if (scope === 'all') {
            photosToExport = this.photos;
        } else if (scope === 'selected') {
            photosToExport = this.photos.filter(p => (p.rating && p.rating > 0) || (p.colorLabel && p.colorLabel !== 'none'));
            if (photosToExport.length === 0) {
                alert("Er zijn geen beoordeelde of gelabelde foto's geselecteerd om te exporteren.");
                document.getElementById('loading-overlay')?.classList.add('hidden');
                return;
            }
        } else {
            photosToExport = [this.getActivePhoto()];
        }
        if (photosToExport.length === 0 || !photosToExport[0]) return;

        document.getElementById('export-modal')?.classList.add('hidden');
        document.getElementById('loading-overlay')?.classList.remove('hidden');

        const getPhotoExportData = async (p) => {
            let blob;
            let ext = 'jpg';
            const origExt = (p.filename.split('.').pop() || 'jpg').toLowerCase();
            const isRaw = p.isRaw || (this.rawDecoder && this.rawDecoder.isRaw(p.filename));

            if (format === 'original-raw') {
                if (p.originalFile) {
                    blob = p.originalFile;
                    ext = origExt;
                } else if (isRaw) {
                    const dngBytes = this.encodeTiffOrDng(p.currentImageData, true);
                    blob = new Blob([dngBytes.buffer], { type: 'image/x-adobe-dng' });
                    ext = 'dng';
                } else {
                    blob = await this.renderPhotoToBlob(p, 'image/jpeg', quality);
                    ext = 'jpg';
                }
            } else if (format === 'image/x-adobe-dng') {
                const dngBytes = this.encodeTiffOrDng(p.currentImageData, true);
                blob = new Blob([dngBytes.buffer], { type: 'image/x-adobe-dng' });
                ext = 'dng';
            } else if (format === 'image/tiff') {
                const tiffBytes = this.encodeTiffOrDng(p.currentImageData, false);
                blob = new Blob([tiffBytes.buffer], { type: 'image/tiff' });
                ext = 'tif';
            } else if (format === 'image/png') {
                blob = await this.renderPhotoToBlob(p, 'image/png', quality);
                ext = 'png';
            } else if (format === 'image/webp') {
                blob = await this.renderPhotoToBlob(p, 'image/webp', quality);
                ext = 'webp';
            } else {
                blob = await this.renderPhotoToBlob(p, 'image/jpeg', quality);
                ext = 'jpg';
            }
            return { blob, ext };
        };

        try {
            // ═══════════════════════════════════════════════════════
            // KEUZE 1: ENKELE FOTO DIRECT IN FINDER 'BEWAAR ALS' OPENEN
            // ═══════════════════════════════════════════════════════
            if ('showSaveFilePicker' in window && photosToExport.length === 1 && method !== 'zip') {
                const p = photosToExport[0];
                const origExt = (p.filename.split('.').pop() || 'jpg').toLowerCase();
                const isRaw = p.isRaw || (this.rawDecoder && this.rawDecoder.isRaw(p.filename));
                let ext = 'jpg';
                if (format === 'original-raw') {
                    ext = (isRaw && p.originalFile) ? origExt : (isRaw ? 'dng' : 'jpg');
                } else if (format === 'image/x-adobe-dng') ext = 'dng';
                else if (format === 'image/tiff') ext = 'tif';
                else if (format === 'image/png') ext = 'png';
                else if (format === 'image/webp') ext = 'webp';

                const cleanName = p.filename.replace(/\.[^/.]+$/, "") + `_bewerkt.${ext}`;
                const mimeType = (ext === 'dng') ? 'image/x-adobe-dng' : (format === 'original-raw' ? 'application/octet-stream' : format);

                const fileHandle = await window.showSaveFilePicker({
                    suggestedName: cleanName,
                    types: [{
                        description: `Bestand (.${ext})`,
                        accept: { [mimeType]: [`.${ext}`] }
                    }]
                });

                document.getElementById('loading-overlay')?.classList.remove('hidden');
                const loadingText = document.getElementById('loading-text');
                if (loadingText) loadingText.textContent = `Bezig met wegschrijven naar Finder (${fileHandle.name})...`;

                const { blob } = await getPhotoExportData(p);
                const writable = await fileHandle.createWritable();
                await writable.write(blob);
                await writable.close();

                alert(`✅ Foto succesvol opgeslagen in Finder als '${fileHandle.name}'!`);
                document.getElementById('loading-overlay')?.classList.add('hidden');
                return;
            }

            // ═══════════════════════════════════════════════════════
            // KEUZE 2: DIRECTE FINDER MAP SELECTIE (Chrome / Edge / Arc)
            // ═══════════════════════════════════════════════════════
            if (method === 'folder' && 'showDirectoryPicker' in window && photosToExport.length > 1) {
                const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                if (!dirHandle) return;

                document.getElementById('loading-overlay')?.classList.remove('hidden');
                const loadingText = document.getElementById('loading-text');

                let savedCount = 0;
                for (let i = 0; i < photosToExport.length; i++) {
                    const p = photosToExport[i];
                    if (loadingText) loadingText.textContent = `Opslaan in Finder map '${dirHandle.name}' (${i + 1}/${photosToExport.length}): ${p.filename}...`;

                    const { blob, ext } = await getPhotoExportData(p);
                    const cleanName = p.filename.replace(/\.[^/.]+$/, "") + `_bewerkt.${ext}`;
                    const fileHandle = await dirHandle.getFileHandle(cleanName, { create: true });
                    const writable = await fileHandle.createWritable();
                    await writable.write(blob);
                    await writable.close();
                    savedCount++;
                }

                alert(`✅ Succesvol ${savedCount} foto's rechtstreeks opgeslagen in Finder in map '${dirHandle.name}'! Geen zip, geen downloads.`);
                document.getElementById('loading-overlay')?.classList.add('hidden');
                return;
            }

            // ═══════════════════════════════════════════════════════
            // KEUZE 3: macOS DEELMENU ("Bewaar in Bestanden / Finder")
            // ═══════════════════════════════════════════════════════
            let canShareTest = false;
            try {
                if (navigator.canShare) {
                    const tFile = new File([''], 'test.png', { type: 'image/png' });
                    canShareTest = navigator.canShare({ files: [tFile] });
                }
            } catch (e) { canShareTest = false; }

            if (method === 'share' && canShareTest) {
                const loadingText = document.getElementById('loading-text');
                const filesArray = [];
                for (let i = 0; i < photosToExport.length; i++) {
                    const p = photosToExport[i];
                    if (loadingText) loadingText.textContent = `Voorbereiden voor delen (${i + 1}/${photosToExport.length}): ${p.filename}...`;
                    const { blob, ext } = await getPhotoExportData(p);
                    const cleanName = p.filename.replace(/\.[^/.]+$/, "") + `_bewerkt_${i + 1}.${ext}`;
                    filesArray.push(new File([blob], cleanName, { type: blob.type || 'application/octet-stream' }));
                }

                await navigator.share({
                    files: filesArray,
                    title: 'vroonphoto export',
                    text: `${filesArray.length} bewerkte foto('s) van vroonphoto`
                });
                document.getElementById('loading-overlay')?.classList.add('hidden');
                return;
            }

            // ═══════════════════════════════════════════════════════
            // KEUZE 4: LOSSE BESTANDEN OPSLAAN (GÉÉN ZIP)
            // ═══════════════════════════════════════════════════════
            let saveAsLooseFiles = (method === 'files');
            if (method === 'folder' && !('showDirectoryPicker' in window) && photosToExport.length > 1) {
                // In Safari ondersteunt Apple showDirectoryPicker niet
                const userChoice = confirm(
                    "Safari staat webpagina's niet toe om rechtstreeks een map te openen via de File System API.\n\n" +
                    "Wilt u de foto's opslaan als LOSSE BESTANDEN (geen ZIP)?\n\n" +
                    "• Klik op 'OK' voor LOSSE BESTANDEN (U kiest zelf de map in Finder als Safari staat ingesteld op 'Vraag om voor elke download').\n" +
                    "• Klik op 'Annuleren' om ze gebundeld als 1 bestand (ZIP) te downloaden.\n\n" +
                    "💡 Tip: Gebruik Google Chrome op uw Mac om met 1 klik direct een willekeurige map in Finder te kiezen."
                );
                saveAsLooseFiles = userChoice;
            }

            if (saveAsLooseFiles || photosToExport.length === 1) {
                const loadingText = document.getElementById('loading-text');
                for (let i = 0; i < photosToExport.length; i++) {
                    const p = photosToExport[i];
                    if (loadingText) loadingText.textContent = `Opslaan van bestand (${i + 1}/${photosToExport.length}): ${p.filename}...`;
                    const { blob, ext } = await getPhotoExportData(p);
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    const suffix = photosToExport.length > 1 ? `_bewerkt_${i + 1}.${ext}` : `_bewerkt.${ext}`;
                    a.download = p.filename.replace(/\.[^/.]+$/, "") + suffix;
                    a.click();
                    await new Promise(r => setTimeout(r, 280));
                    URL.revokeObjectURL(url);
                }
                alert(`✅ ${photosToExport.length} foto('s) succesvol opgeslagen als losse bestanden (geen ZIP)!`);
                document.getElementById('loading-overlay')?.classList.add('hidden');
                return;
            }

            // ═══════════════════════════════════════════════════════
            // KEUZE 5: ALLES IN 1 ZIP-BESTAND BUNDELEN
            // ═══════════════════════════════════════════════════════
            const loadingText = document.getElementById('loading-text');
            const fileItems = [];
            for (let i = 0; i < photosToExport.length; i++) {
                const p = photosToExport[i];
                if (loadingText) loadingText.textContent = `Verpakken in ZIP (${i + 1}/${photosToExport.length}): ${p.filename}...`;
                const { blob, ext } = await getPhotoExportData(p);
                const cleanName = p.filename.replace(/\.[^/.]+$/, "") + `_bewerkt_${i + 1}.${ext}`;
                const arrayBuf = await blob.arrayBuffer();
                fileItems.push({ name: cleanName, data: new Uint8Array(arrayBuf) });
            }
            const zipBlob = this.createSimpleZipBlob(fileItems);
            const url = URL.createObjectURL(zipBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `vroonphoto_selectie_${photosToExport.length}_fotos.zip`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            alert(`✅ ${photosToExport.length} foto's zijn gebundeld en opgeslagen als ZIP-bestand ('${a.download}').`);

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
            // Origineel RAW camerabestand (bv. .cr2, .nef, .arw, .dng)
            if (format === 'original-raw') {
                if (photo.originalFile) {
                    resolve(photo.originalFile);
                    return;
                }
                const tiffBytes = this.encodeTiffOrDng(photo.currentImageData, true);
                const blob = new Blob([tiffBytes.buffer], { type: 'image/x-adobe-dng' });
                resolve(blob);
                return;
            }

            // TIFF (.tif) of Adobe Digital Negative (.dng) RAW Container
            if (format === 'image/tiff' || format === 'image/x-adobe-dng' || format === 'dng') {
                const isDNG = format === 'image/x-adobe-dng' || format === 'dng';
                const tiffBytes = this.encodeTiffOrDng(photo.currentImageData, isDNG);
                const mimeType = isDNG ? 'image/x-adobe-dng' : 'image/tiff';
                const blob = new Blob([tiffBytes.buffer], { type: mimeType });
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

    // Eenvoudige, zero-dependency zip generator voor Safari en browsers zonder showDirectoryPicker
    createSimpleZipBlob(files) {
        // files: Array<{ name: string, data: Uint8Array }>
        const table = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let k = 0; k < 8; k++) {
                c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            }
            table[i] = c;
        }
        const calcCrc32 = (buf) => {
            let crc = 0xFFFFFFFF;
            for (let i = 0; i < buf.length; i++) {
                crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
            }
            return (crc ^ 0xFFFFFFFF) >>> 0;
        };

        const enc = (typeof TextEncoder !== 'undefined') ? new TextEncoder() : {
            encode: (s) => {
                const arr = new Uint8Array(s.length);
                for (let i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i) & 0xff;
                return arr;
            }
        };

        const parts = [];
        const cdEntries = [];
        let offset = 0;

        for (const f of files) {
            const nameBytes = enc.encode(f.name);
            const dataBytes = f.data;
            const fileCrc = calcCrc32(dataBytes);
            const size = dataBytes.length;

            // Local file header (30 bytes + name)
            const lh = new Uint8Array(30 + nameBytes.length);
            const dv = new DataView(lh.buffer);
            dv.setUint32(0, 0x04034b50, true);
            dv.setUint16(4, 20, true);
            dv.setUint16(6, 0x0800, true); // UTF-8
            dv.setUint16(8, 0, true); // Stored (no compression)
            dv.setUint16(10, 0, true);
            dv.setUint16(12, 0x21, true); // 1980-01-01
            dv.setUint32(14, fileCrc, true);
            dv.setUint32(18, size, true);
            dv.setUint32(22, size, true);
            dv.setUint16(26, nameBytes.length, true);
            dv.setUint16(28, 0, true);
            lh.set(nameBytes, 30);

            parts.push(lh, dataBytes);

            // Central directory entry (46 bytes + name)
            const cdh = new Uint8Array(46 + nameBytes.length);
            const cdv = new DataView(cdh.buffer);
            cdv.setUint32(0, 0x02014b50, true);
            cdv.setUint16(4, 20, true);
            cdv.setUint16(6, 20, true);
            cdv.setUint16(8, 0x0800, true);
            cdv.setUint16(10, 0, true);
            cdv.setUint16(12, 0, true);
            cdv.setUint16(14, 0x21, true);
            cdv.setUint32(16, fileCrc, true);
            cdv.setUint32(20, size, true);
            cdv.setUint32(24, size, true);
            cdv.setUint16(28, nameBytes.length, true);
            cdv.setUint16(30, 0, true);
            cdv.setUint16(32, 0, true);
            cdv.setUint16(34, 0, true);
            cdv.setUint16(36, 0, true);
            cdv.setUint32(38, 0, true);
            cdv.setUint32(42, offset, true);
            cdh.set(nameBytes, 46);

            cdEntries.push(cdh);
            offset += lh.length + dataBytes.length;
        }

        const cdOffset = offset;
        let cdSize = 0;
        for (const c of cdEntries) {
            parts.push(c);
            cdSize += c.length;
        }

        // End of central directory record (22 bytes)
        const eocd = new Uint8Array(22);
        const edv = new DataView(eocd.buffer);
        edv.setUint32(0, 0x06054b50, true);
        edv.setUint16(4, 0, true);
        edv.setUint16(6, 0, true);
        edv.setUint16(8, files.length, true);
        edv.setUint16(10, files.length, true);
        edv.setUint32(12, cdSize, true);
        edv.setUint32(16, cdOffset, true);
        edv.setUint16(20, 0, true);
        parts.push(eocd);

        return new Blob(parts, { type: 'application/zip' });
    }

    // ═══════════════════════════════════════════════════════
    //  7. VOORBEELDFOTO GENERATOREN VOOR BATCH TESTEN
    // ═══════════════════════════════════════════════════════

    loadSampleBatch() {
        const w = 1200, h = 800;

        // Als voorbeeldfoto's al geladen zijn in de sessie, schakel er naar toe zonder iets te wissen!
        const sample1Idx = this.photos.findIndex(p => p.filename === 'Concert_Stage_Red.dng');
        if (sample1Idx >= 0) {
            this.setActivePhoto(sample1Idx);
            return;
        }

        // Bewaar bestaande foto's: voorbeelden worden toegevoegd zonder iets te overschrijven!
        const startIndex = this.photos.length;

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

        this.setActivePhoto(startIndex);
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
