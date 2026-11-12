/**
 * inpaint.js
 * Adobe Firefly Style Smart Retouch & Generative Inpainting
 * Erases blemishes, unwanted objects, power lines, and photobombers with contextual texture synthesis.
 */

class SmartInpainter {
    constructor(wasmEngine) {
        this.wasm = wasmEngine;
        this.maskCanvas = null;
        this.maskCtx = null;
        this.isPainting = false;
        this.brushSize = 25;
    }

    initMask(width, height) {
        if (!this.maskCanvas) {
            this.maskCanvas = document.createElement('canvas');
        }
        this.maskCanvas.width = width;
        this.maskCanvas.height = height;
        this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true });
        this.clearMask();
    }

    clearMask() {
        if (!this.maskCtx) return;
        this.maskCtx.fillStyle = '#000000';
        this.maskCtx.fillRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
    }

    drawBrush(x, y, radius) {
        if (!this.maskCtx) return;
        this.maskCtx.fillStyle = '#ffffff';
        this.maskCtx.beginPath();
        this.maskCtx.arc(x, y, radius, 0, Math.PI * 2);
        this.maskCtx.fill();
    }

    hasActiveMask() {
        if (!this.maskCtx) return false;
        const imgData = this.maskCtx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 16) {
            if (data[i] > 100) return true;
        }
        return false;
    }

    getMaskArray() {
        const imgData = this.maskCtx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height);
        const data = imgData.data;
        const mask = new Uint8Array(this.maskCanvas.width * this.maskCanvas.height);
        for (let i = 0, j = 0; i < data.length; i += 4, j++) {
            mask[j] = data[i]; // White (255) means masked area to heal
        }
        return mask;
    }

    /**
     * Apply contextual inpainting over the masked area
     */
    heal(targetImageData, radius = 6) {
        if (!this.hasActiveMask()) return targetImageData;
        const mask = this.getMaskArray();
        this.wasm.smartInpaint(targetImageData, mask, radius);
        this.clearMask();
        return targetImageData;
    }
}

window.SmartInpainter = SmartInpainter;

