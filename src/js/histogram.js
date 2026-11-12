/**
 * histogram.js
 * Real-time 4-Channel Histogram for vroonphoto
 * Displays Red, Green, Blue, and Luminance channels with clipping warnings.
 */

class Histogram {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        this.histR = new Uint32Array(256);
        this.histG = new Uint32Array(256);
        this.histB = new Uint32Array(256);
        this.histLuma = new Uint32Array(256);
    }

    update(imageData) {
        if (!this.ctx || !this.canvas || !imageData) return;

        this.histR.fill(0);
        this.histG.fill(0);
        this.histB.fill(0);
        this.histLuma.fill(0);

        const data = imageData.data;
        const step = Math.max(1, Math.floor(data.length / (4 * 100000))); // Sample for 60fps performance

        for (let i = 0; i < data.length; i += 4 * step) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const luma = (0.299 * r + 0.587 * g + 0.114 * b) | 0;

            this.histR[r]++;
            this.histG[g]++;
            this.histB[b]++;
            this.histLuma[luma]++;
        }

        this.render();
    }

    render() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        this.ctx.clearRect(0, 0, w, h);

        // Background
        this.ctx.fillStyle = '#0f172a';
        this.ctx.fillRect(0, 0, w, h);

        // Find peak (excluding spikes at 0 and 255 for better scaling)
        let maxVal = 1;
        for (let i = 2; i < 254; i++) {
            if (this.histR[i] > maxVal) maxVal = this.histR[i];
            if (this.histG[i] > maxVal) maxVal = this.histG[i];
            if (this.histB[i] > maxVal) maxVal = this.histB[i];
            if (this.histLuma[i] > maxVal) maxVal = this.histLuma[i];
        }

        const drawChannel = (hist, color, alpha) => {
            this.ctx.fillStyle = color;
            this.ctx.globalAlpha = alpha;
            this.ctx.beginPath();
            this.ctx.moveTo(0, h);

            for (let i = 0; i < 256; i++) {
                const x = (i / 255) * w;
                const barH = Math.min(h, (hist[i] / maxVal) * (h * 0.9));
                this.ctx.lineTo(x, h - barH);
            }
            this.ctx.lineTo(w, h);
            this.ctx.closePath();
            this.ctx.fill();
        };

        this.ctx.globalCompositeOperation = 'screen';
        drawChannel(this.histR, '#ef4444', 0.45);
        drawChannel(this.histG, '#22c55e', 0.45);
        drawChannel(this.histB, '#3b82f6', 0.45);
        this.ctx.globalCompositeOperation = 'source-over';
        drawChannel(this.histLuma, '#ffffff', 0.25);

        // Check highlight/shadow clipping
        const shadowClipped = this.histLuma[0] > maxVal * 0.4;
        const highlightClipped = this.histLuma[255] > maxVal * 0.4;

        // Shadow clipping indicator (blue triangle on bottom left)
        if (shadowClipped) {
            this.ctx.fillStyle = '#38bdf8';
            this.ctx.beginPath();
            this.ctx.moveTo(2, h - 2);
            this.ctx.lineTo(12, h - 2);
            this.ctx.lineTo(2, h - 12);
            this.ctx.fill();
        }

        // Highlight clipping indicator (red triangle on top right)
        if (highlightClipped) {
            this.ctx.fillStyle = '#ef4444';
            this.ctx.beginPath();
            this.ctx.moveTo(w - 2, 2);
            this.ctx.lineTo(w - 12, 2);
            this.ctx.lineTo(w - 2, 12);
            this.ctx.fill();
        }
    }
}

window.Histogram = Histogram;
