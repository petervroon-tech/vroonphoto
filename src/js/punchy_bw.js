/**
 * punchy_bw.js
 * "Knallend Zwart-Wit" (Ultra Punch Black & White Engine)
 * Features 6-channel mixer, Ansel Adams Zone curve, micro-contrast punch, and film grain.
 */

class PunchyBW {
    constructor(wasmEngine) {
        this.wasm = wasmEngine;

        this.presets = {
            'knallend_contrast': {
                name: '⚡ Knallend Contrast (High-Impact)',
                red: 0.45, orange: 0.35, yellow: 0.20, green: -0.10, aqua: -0.20, blue: -0.30,
                contrast: 45, clarity: 55, grain: 15
            },
            'ansel_adams': {
                name: '🏞️ Ansel Adams Zone System',
                red: 0.35, orange: 0.30, yellow: 0.25, green: 0.15, aqua: -0.05, blue: -0.25,
                contrast: 35, clarity: 40, grain: 8
            },
            'film_noir': {
                name: '🎬 Film Noir (Diepe Schaduwen)',
                red: 0.50, orange: 0.25, yellow: 0.10, green: -0.15, aqua: -0.30, blue: -0.40,
                contrast: 60, clarity: 50, grain: 30
            },
            'dramatic_street': {
                name: '📷 Straatfotografie (Puntig & Scherp)',
                red: 0.30, orange: 0.30, yellow: 0.20, green: 0.10, aqua: 0.0, blue: -0.10,
                contrast: 28, clarity: 65, grain: 20
            },
            'vintage_silver': {
                name: '🎞️ Vintage Silver Gelatin',
                red: 0.33, orange: 0.33, yellow: 0.25, green: 0.10, aqua: 0.05, blue: 0.05,
                contrast: 20, clarity: 25, grain: 40
            }
        };
    }

    apply(imageData, options = {}) {
        if (!options.enabled) return imageData;

        // Channel mixer weights
        const rw = options.red !== undefined ? options.red : 0.40;
        const gw = options.green !== undefined ? options.green : 0.40;
        const bw = options.blue !== undefined ? options.blue : 0.20;
        const contrast = options.contrast !== undefined ? options.contrast : 35;
        const clarity = options.clarity !== undefined ? options.clarity : 40;
        const grain = options.grain !== undefined ? options.grain : 12;

        this.wasm.punchyBW(
            imageData,
            rw,
            gw,
            bw,
            contrast,
            clarity,
            grain
        );

        return imageData;
    }
}

window.PunchyBW = PunchyBW;

