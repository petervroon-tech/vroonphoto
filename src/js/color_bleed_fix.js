/**
 * color_bleed_fix.js
 * Stage Red Light & Extreme Color Bleed Recovery Module
 * Solves blown concert stage lighting, red LED clipping, and chromatic color bleeding.
 */

class ColorBleedFix {
    constructor(wasmEngine) {
        this.wasm = wasmEngine;
    }

    /**
     * Analyze image to detect red blowout and stage lighting bleed percentage
     */
    analyzeRedBlowout(imageData) {
        const data = imageData.data;
        const total = imageData.width * imageData.height;
        let blownRedCount = 0;
        let avgRedBlowout = 0;

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const maxGb = Math.max(g, b);
            if (r > 190 && r > maxGb * 1.3) {
                blownRedCount++;
                avgRedBlowout += (r - maxGb);
            }
        }

        const percentage = (blownRedCount / total) * 100;
        return {
            blownPercentage: percentage.toFixed(1),
            hasSevereStageRed: percentage > 3.0,
            recommendedThreshold: percentage > 10 ? 0.65 : 0.75
        };
    }

    /**
     * Apply stage red light and extreme color bleed recovery
     */
    apply(imageData, options = {}) {
        const threshold = options.threshold !== undefined ? options.threshold : 0.70;
        const recoveryStrength = options.strength !== undefined ? options.strength : 0.85;
        const skinProtect = options.skinProtect !== undefined ? options.skinProtect : 0.50;
        const gamutCompress = options.gamutCompress !== undefined ? options.gamutCompress : 0.60;

        if (recoveryStrength <= 0.001) return imageData;

        this.wasm.recoverRedLight(
            imageData,
            threshold,
            recoveryStrength,
            skinProtect,
            gamutCompress
        );

        return imageData;
    }
}

window.ColorBleedFix = ColorBleedFix;

