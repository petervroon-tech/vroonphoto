/**
 * denoise.js
 * Dual-stage Noise Reduction Controller for vroonphoto
 * Powered by WebAssembly Bilateral Spatial + Guided Chroma filters
 */

class DenoiseProcessor {
    constructor(wasmEngine) {
        this.wasm = wasmEngine;
    }

    apply(imageData, options = {}) {
        const lumaDenoise = options.luminance !== undefined ? options.luminance : 0; // 0 to 100
        const chromaDenoise = options.chroma !== undefined ? options.chroma : 0;       // 0 to 100
        const detailPreserve = options.detail !== undefined ? options.detail : 50;     // 0 to 100

        if (lumaDenoise <= 0.5 && chromaDenoise <= 0.5) {
            return imageData;
        }

        // Map sliders to bilateral filter parameters
        const radius = lumaDenoise > 60 ? 2 : 1;
        const spatialSigma = 1.0 + (lumaDenoise / 100.0) * 2.5;
        // Range sigma: higher means more smoothing, lower preserves sharper contrast boundaries
        const rangeSigma = 15.0 + (lumaDenoise / 100.0) * 35.0 - (detailPreserve / 100.0) * 10.0;
        const chromaStrength = (chromaDenoise / 100.0);

        this.wasm.denoise(
            imageData,
            radius,
            spatialSigma,
            Math.max(10.0, rangeSigma),
            chromaStrength
        );

        return imageData;
    }
}

window.DenoiseProcessor = DenoiseProcessor;

