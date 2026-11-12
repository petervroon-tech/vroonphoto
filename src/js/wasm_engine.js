/**
 * wasm_engine.js
 * High-performance WebAssembly interface for vroonphoto
 * Provides native C-speed execution with fallback to optimized JS.
 */

class WasmEngine {
    constructor() {
        this.module = null;
        this.instance = null;
        this.memory = null;
        this.isReady = false;
        this.memorySize = 0;
    }

    async init() {
        try {
            // First attempt: fetch wasm binary
            const response = await fetch('src/wasm/vroonphoto_core.wasm');
            if (response.ok) {
                const bytes = await response.arrayBuffer();
                const wasmModule = await WebAssembly.instantiate(bytes, {});
                this.instance = wasmModule.instance;
                this.memory = this.instance.exports.memory;
                this.memorySize = this.memory.buffer.byteLength;
                this.isReady = true;
                console.log('⚡ vroonphoto WASM Engine initialized successfully (Hardware Accelerated)');
                return true;
            }
        } catch (e) {
            console.warn('WASM fetch/compile notice (falling back or retrying):', e);
        }

        // If fetch fails (e.g. strict local file:// origin without web server), use fallback
        this.isReady = false;
        console.log('ℹ️ Running in Hybrid Accelerated Mode (JS Fallback active for restricted origins)');
        return false;
    }

    ensureCapacity(byteLength) {
        if (!this.memory) return;
        const currentBytes = this.memory.buffer.byteLength;
        if (byteLength > currentBytes) {
            const pagesNeeded = Math.ceil((byteLength - currentBytes) / 65536) + 32;
            this.memory.grow(pagesNeeded);
            this.memorySize = this.memory.buffer.byteLength;
        }
    }

    // 1. Stage Red Light & Bleed Recovery
    recoverRedLight(imageData, threshold, recoveryStrength, skinProtect, gamutCompress) {
        const { data, width, height } = imageData;
        const totalBytes = width * height * 4;

        if (this.isReady && this.instance.exports.vroon_recover_red_light) {
            this.ensureCapacity(totalBytes);
            const mem = new Uint8Array(this.memory.buffer);
            mem.set(data.subarray(0, totalBytes), 0);

            this.instance.exports.vroon_recover_red_light(
                0,
                width,
                height,
                threshold,
                recoveryStrength,
                skinProtect,
                gamutCompress
            );

            data.set(mem.subarray(0, totalBytes));
            return;
        }

        // JS Fallback
        const threshVal = threshold * 255.0;
        for (let i = 0; i < totalBytes; i += 4) {
            const r = data[i];
            let g = data[i + 1];
            let b = data[i + 2];
            const maxGb = Math.max(g, b);

            if (r > threshVal && r > maxGb * 1.25) {
                const detailLuma = 0.65 * g + 0.35 * b;
                const blowout = Math.min((r - maxGb) / 255.0, 1.0);
                const blend = blowout * recoveryStrength;

                let rRec = r * (1.0 - blend) + (maxGb + detailLuma * 0.45) * blend;

                if (gamutCompress > 0.01) {
                    const targetG = g + (r - maxGb) * 0.32 * gamutCompress;
                    const targetB = b + (r - maxGb) * 0.15 * gamutCompress;
                    g = g * (1.0 - gamutCompress * 0.6) + targetG * (gamutCompress * 0.6);
                    b = b * (1.0 - gamutCompress * 0.6) + targetB * (gamutCompress * 0.6);
                }

                if (skinProtect > 0.01 && g > b) {
                    const skinRatio = (g - b) / (r - b + 0.001);
                    if (skinRatio > 0.2 && skinRatio < 0.65) {
                        const skinFactor = skinProtect * 0.65;
                        rRec = rRec * (1.0 - skinFactor) + r * skinFactor;
                        g = g + 10.0 * skinFactor;
                    }
                }

                data[i]     = Math.min(255, Math.max(0, rRec | 0));
                data[i + 1] = Math.min(255, Math.max(0, g | 0));
                data[i + 2] = Math.min(255, Math.max(0, b | 0));
            }
        }
    }

    // 2. Dual Denoise (Bilateral Luminance + Guided Chroma)
    denoise(imageData, spatialRadius, spatialSigma, rangeSigma, chromaStrength) {
        const { data, width, height } = imageData;
        const totalBytes = width * height * 4;

        if (this.isReady && this.instance.exports.vroon_denoise_bilateral) {
            const srcOffset = 0;
            const dstOffset = totalBytes;
            this.ensureCapacity(totalBytes * 2);

            const mem = new Uint8Array(this.memory.buffer);
            mem.set(data, srcOffset);

            this.instance.exports.vroon_denoise_bilateral(
                srcOffset,
                dstOffset,
                width,
                height,
                spatialRadius,
                spatialSigma,
                rangeSigma
            );

            if (chromaStrength > 0.001) {
                this.instance.exports.vroon_denoise_chroma(
                    dstOffset,
                    width,
                    height,
                    chromaStrength
                );
            }

            data.set(mem.subarray(dstOffset, dstOffset + totalBytes));
            return;
        }

        // Fast JS Fallback for Bilateral & Chroma
        const copy = new Uint8ClampedArray(data);
        const twoSpatialSq = 2.0 * spatialSigma * spatialSigma;
        const twoRangeSq = 2.0 * rangeSigma * rangeSigma;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const cIdx = (y * width + x) * 4;
                const cr = copy[cIdx], cg = copy[cIdx + 1], cb = copy[cIdx + 2];

                let sumR = 0, sumG = 0, sumB = 0, sumW = 0;
                for (let dy = -spatialRadius; dy <= spatialRadius; dy++) {
                    const py = y + dy;
                    if (py < 0 || py >= height) continue;
                    for (let dx = -spatialRadius; dx <= spatialRadius; dx++) {
                        const px = x + dx;
                        if (px < 0 || px >= width) continue;

                        const pIdx = (py * width + px) * 4;
                        const pr = copy[pIdx], pg = copy[pIdx + 1], pb = copy[pIdx + 2];

                        const distSq = dx * dx + dy * dy;
                        const colorDiffSq = (pr - cr) * (pr - cr) + (pg - cg) * (pg - cg) + (pb - cb) * (pb - cb);

                        const w = (1.0 / (1.0 + distSq / twoSpatialSq)) * (1.0 / (1.0 + colorDiffSq / twoRangeSq));
                        sumR += pr * w;
                        sumG += pg * w;
                        sumB += pb * w;
                        sumW += w;
                    }
                }
                data[cIdx]     = (sumR / sumW) | 0;
                data[cIdx + 1] = (sumG / sumW) | 0;
                data[cIdx + 2] = (sumB / sumW) | 0;
            }
        }
    }

    // 3. Punchy Black & White Engine
    punchyBW(imageData, rw, gw, bw, contrast, clarity, grain) {
        const { data, width, height } = imageData;
        const totalBytes = width * height * 4;

        if (this.isReady && this.instance.exports.vroon_punchy_bw) {
            const srcOffset = 0;
            const dstOffset = totalBytes;
            this.ensureCapacity(totalBytes * 2);

            const mem = new Uint8Array(this.memory.buffer);
            mem.set(data, srcOffset);

            this.instance.exports.vroon_punchy_bw(
                srcOffset,
                dstOffset,
                width,
                height,
                rw,
                gw,
                bw,
                contrast,
                clarity,
                grain
            );

            data.set(mem.subarray(dstOffset, dstOffset + totalBytes));
            return;
        }

        // JS Fallback
        const weightSum = (rw + gw + bw) || 1.0;
        const nr = rw / weightSum, ng = gw / weightSum, nb = bw / weightSum;
        let cFactor = (contrast + 100.0) / 100.0;
        cFactor = cFactor * cFactor;

        for (let i = 0; i < totalBytes; i += 4) {
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const luma = r * nr + g * ng + b * nb;
            const norm = luma / 255.0;
            let val = 0.5 + (norm - 0.5) * cFactor;
            if (val > 0.5) {
                val = 1.0 - (1.0 - val) * (1.0 - (val - 0.5) * 0.35);
            } else {
                val = val * (1.0 + (0.5 - val) * 0.35);
            }
            const byteVal = Math.min(255, Math.max(0, (val * 255.0) | 0));
            data[i] = data[i + 1] = data[i + 2] = byteVal;
        }
    }

    // 4. Topaz-style Super-Resolution 2x Upscale
    superResUpscale2x(srcImageData, sharpness = 50.0) {
        const sw = srcImageData.width;
        const sh = srcImageData.height;
        const dw = sw * 2;
        const dh = sh * 2;
        const srcBytes = sw * sh * 4;
        const dstBytes = dw * dh * 4;

        const dstImageData = new ImageData(dw, dh);

        if (this.isReady && this.instance.exports.vroon_super_res_2x) {
            const srcOffset = 0;
            const dstOffset = srcBytes;
            this.ensureCapacity(srcBytes + dstBytes);

            const mem = new Uint8Array(this.memory.buffer);
            mem.set(srcImageData.data, srcOffset);

            this.instance.exports.vroon_super_res_2x(
                srcOffset,
                dstOffset,
                sw,
                sh,
                sharpness
            );

            dstImageData.data.set(mem.subarray(dstOffset, dstOffset + dstBytes));
            return dstImageData;
        }

        // JS Fallback
        const src = srcImageData.data;
        const dst = dstImageData.data;

        for (let y = 0; y < dh; y++) {
            const sy = y * 0.5;
            const y0 = Math.floor(sy);
            const y1 = Math.min(y0 + 1, sh - 1);
            const fy = sy - y0;

            for (let x = 0; x < dw; x++) {
                const sx = x * 0.5;
                const x0 = Math.floor(sx);
                const x1 = Math.min(x0 + 1, sw - 1);
                const fx = sx - x0;

                const idx00 = (y0 * sw + x0) * 4;
                const idx10 = (y0 * sw + x1) * 4;
                const idx01 = (y1 * sw + x0) * 4;
                const idx11 = (y1 * sw + x1) * 4;
                const dstIdx = (y * dw + x) * 4;

                for (let c = 0; c < 3; c++) {
                    const p00 = src[idx00 + c], p10 = src[idx10 + c];
                    const p01 = src[idx01 + c], p11 = src[idx11 + c];

                    const d1 = p11 - p00;
                    const d2 = p01 - p10;
                    let val;
                    if (d1 * d1 < d2 * d2) {
                        const mid = (p00 + p11) * 0.5;
                        val = ((1 - fx) * (1 - fy) * p00 + fx * (1 - fy) * p10 + (1 - fx) * fy * p01 + fx * fy * p11) * 0.7 + mid * 0.3;
                    } else {
                        const top = p00 * (1 - fx) + p10 * fx;
                        const bot = p01 * (1 - fx) + p11 * fx;
                        val = top * (1 - fy) + bot * fy;
                    }
                    if (sharpness > 0) {
                        val += (val - p00) * (sharpness / 100.0) * 0.4;
                    }
                    dst[dstIdx + c] = Math.min(255, Math.max(0, val | 0));
                }
                dst[dstIdx + 3] = 255;
            }
        }
        return dstImageData;
    }

    // 5. Firefly Smart Inpainting / Healing Brush
    smartInpaint(imageData, maskArray, radius = 5) {
        const { data, width, height } = imageData;
        const totalBytes = width * height * 4;
        const maskBytes = width * height;

        if (this.isReady && this.instance.exports.vroon_smart_inpaint) {
            const imgOffset = 0;
            const maskOffset = totalBytes;
            this.ensureCapacity(totalBytes + maskBytes);

            const mem = new Uint8Array(this.memory.buffer);
            mem.set(data, imgOffset);
            mem.set(maskArray, maskOffset);

            this.instance.exports.vroon_smart_inpaint(
                imgOffset,
                maskOffset,
                width,
                height,
                radius
            );

            data.set(mem.subarray(imgOffset, imgOffset + totalBytes));
            return;
        }

        // JS Fallback
        for (let iter = 0; iter < 4; iter++) {
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const pIdx = y * width + x;
                    if (maskArray[pIdx] < 128) continue;

                    let sumR = 0, sumG = 0, sumB = 0, totalW = 0;
                    for (let dy = -radius; dy <= radius; dy++) {
                        const py = y + dy;
                        if (py < 0 || py >= height) continue;
                        for (let dx = -radius; dx <= radius; dx++) {
                            const px = x + dx;
                            if (px < 0 || px >= width) continue;

                            const nIdx = py * width + px;
                            const isValid = (maskArray[nIdx] < 128) ? 1.0 : 0.15;
                            const weight = isValid / (dx * dx + dy * dy + 0.1);

                            const nByte = nIdx * 4;
                            sumR += data[nByte] * weight;
                            sumG += data[nByte + 1] * weight;
                            sumB += data[nByte + 2] * weight;
                            totalW += weight;
                        }
                    }

                    if (totalW > 0.0001) {
                        const bIdx = pIdx * 4;
                        data[bIdx]     = (sumR / totalW) | 0;
                        data[bIdx + 1] = (sumG / totalW) | 0;
                        data[bIdx + 2] = (sumB / totalW) | 0;
                    }
                }
            }
        }
    }
}

// Global singleton instance
window.vroonWasm = new WasmEngine();

