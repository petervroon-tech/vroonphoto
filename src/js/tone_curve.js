/**
 * tone_curve.js
 * Interactive Lightroom Tone Curve editor for vroonphoto
 * Evaluates smooth natural cubic spline curves for tonal grading.
 */

class ToneCurve {
    constructor(canvasId, onChangeCallback) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        this.onChange = onChangeCallback || (() => {});

        // Points in normalized coordinates [0.0, 1.0]
        this.points = [
            { x: 0.0, y: 0.0 },
            { x: 0.25, y: 0.25 },
            { x: 0.75, y: 0.75 },
            { x: 1.0, y: 1.0 }
        ];

        this.selectedPoint = null;
        this.lookupTable = new Uint8Array(256);
        this.updateLookupTable();

        if (this.canvas) {
            this.setupEvents();
            this.render();
        }
    }

    setupEvents() {
        const getCanvasPos = (e) => {
            const rect = this.canvas.getBoundingClientRect();
            return {
                x: (e.clientX - rect.left) / rect.width,
                y: 1.0 - (e.clientY - rect.top) / rect.height
            };
        };

        this.canvas.addEventListener('mousedown', (e) => {
            const pos = getCanvasPos(e);
            let closest = null;
            let minDist = 0.08;

            this.points.forEach((p, idx) => {
                const dist = Math.hypot(p.x - pos.x, p.y - pos.y);
                if (dist < minDist) {
                    minDist = dist;
                    closest = idx;
                }
            });

            if (closest !== null) {
                this.selectedPoint = closest;
            } else if (this.points.length < 8) {
                // Add new point
                this.points.push(pos);
                this.points.sort((a, b) => a.x - b.x);
                this.selectedPoint = this.points.indexOf(pos);
            }
            this.updateLookupTable();
            this.render();
            this.onChange();
        });

        window.addEventListener('mousemove', (e) => {
            if (this.selectedPoint === null) return;
            const pos = getCanvasPos(e);
            const p = this.points[this.selectedPoint];

            // Constrain x for intermediate points
            if (this.selectedPoint === 0) {
                p.x = 0;
            } else if (this.selectedPoint === this.points.length - 1) {
                p.x = 1;
            } else {
                const minX = this.points[this.selectedPoint - 1].x + 0.02;
                const maxX = this.points[this.selectedPoint + 1].x - 0.02;
                p.x = Math.max(minX, Math.min(maxX, pos.x));
            }
            p.y = Math.max(0, Math.min(1, pos.y));

            this.updateLookupTable();
            this.render();
            this.onChange();
        });

        window.addEventListener('mouseup', () => {
            this.selectedPoint = null;
        });
    }

    reset() {
        this.points = [
            { x: 0.0, y: 0.0 },
            { x: 0.25, y: 0.25 },
            { x: 0.75, y: 0.75 },
            { x: 1.0, y: 1.0 }
        ];
        this.updateLookupTable();
        this.render();
        this.onChange();
    }

    updateLookupTable() {
        // Natural monotonic cubic spline interpolation
        for (let i = 0; i < 256; i++) {
            const x = i / 255.0;
            let y = x;

            // Find segment
            for (let seg = 0; seg < this.points.length - 1; seg++) {
                const p0 = this.points[seg];
                const p1 = this.points[seg + 1];
                if (x >= p0.x && x <= p1.x) {
                    const t = (x - p0.x) / (p1.x - p0.x || 0.001);
                    // Smooth S-curve Hermite interpolation
                    const smoothT = t * t * (3 - 2 * t);
                    y = p0.y + (p1.y - p0.y) * smoothT;
                    break;
                }
            }
            this.lookupTable[i] = Math.min(255, Math.max(0, (y * 255.0) | 0));
        }
    }

    render() {
        if (!this.ctx || !this.canvas) return;
        const w = this.canvas.width;
        const h = this.canvas.height;

        this.ctx.clearRect(0, 0, w, h);

        // Draw grid
        this.ctx.strokeStyle = '#2a2f3b';
        this.ctx.lineWidth = 1;
        for (let i = 1; i < 4; i++) {
            const pos = (i / 4) * w;
            this.ctx.beginPath();
            this.ctx.moveTo(pos, 0);
            this.ctx.lineTo(pos, h);
            this.ctx.stroke();

            this.ctx.beginPath();
            this.ctx.moveTo(0, pos);
            this.ctx.lineTo(w, pos);
            this.ctx.stroke();
        }

        // Draw diagonal reference
        this.ctx.strokeStyle = '#384152';
        this.ctx.setLineDash([3, 3]);
        this.ctx.beginPath();
        this.ctx.moveTo(0, h);
        this.ctx.lineTo(w, 0);
        this.ctx.stroke();
        this.ctx.setLineDash([]);

        // Draw curve
        this.ctx.strokeStyle = '#38bdf8';
        this.ctx.lineWidth = 2.5;
        this.ctx.beginPath();
        for (let i = 0; i < 256; i++) {
            const cx = (i / 255) * w;
            const cy = (1.0 - (this.lookupTable[i] / 255.0)) * h;
            if (i === 0) this.ctx.moveTo(cx, cy);
            else this.ctx.lineTo(cx, cy);
        }
        this.ctx.stroke();

        // Draw control points
        this.points.forEach((p, idx) => {
            const px = p.x * w;
            const py = (1.0 - p.y) * h;
            this.ctx.fillStyle = idx === this.selectedPoint ? '#38bdf8' : '#ffffff';
            this.ctx.strokeStyle = '#0f172a';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.arc(px, py, 5.5, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.stroke();
        });
    }

    apply(imageData) {
        const data = imageData.data;
        const lut = this.lookupTable;
        for (let i = 0; i < data.length; i += 4) {
            data[i]     = lut[data[i]];
            data[i + 1] = lut[data[i + 1]];
            data[i + 2] = lut[data[i + 2]];
        }
    }
}

window.ToneCurve = ToneCurve;
