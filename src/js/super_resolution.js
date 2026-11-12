/**
 * super_resolution.js
 * Topaz Labs Style AI Super-Resolution & Photo Upscaler
 * Supports 2x and 4x edge-directed super-resolution upscaling in WebAssembly.
 */

class SuperResolution {
    constructor(wasmEngine) {
        this.wasm = wasmEngine;
    }

    /**
     * Upscale an ImageData object by 2x or 4x
     * @param {ImageData} srcImageData
     * @param {number} scale - 2 or 4
     * @param {number} sharpness - 0 to 100
     */
    upscale(srcImageData, scale = 2, sharpness = 50) {
        console.log(`🚀 Starting Super-Resolution Upscale (${scale}x, Sharpness: ${sharpness})...`);
        const startTime = performance.now();

        // 2x pass
        let result = this.wasm.superResUpscale2x(srcImageData, sharpness);

        // If 4x, run a second 2x pass
        if (scale === 4) {
            result = this.wasm.superResUpscale2x(result, sharpness * 0.75);
        }

        const elapsed = (performance.now() - startTime).toFixed(1);
        console.log(`✨ Upscale complete: ${result.width} × ${result.height} in ${elapsed}ms`);
        return result;
    }
}

window.SuperResolution = SuperResolution;

