/**
 * app.js
 * Main UI Controller & Pipeline Orchestrator for vroonphoto
 * High-performance Lightroom-grade photo enhancement with WASM acceleration
 */

class VroonPhotoApp {
    constructor() {
        this.originalImageData = null;
        this.currentImageData = null;
        this.previewImageData = null;

        this.canvas = document.getElementById('main-canvas');
        this.ctx = this.canvas ? this.canvas.getContext('2d', { willReadFrequently: true }) : null;

        // Subsystems
        this.wasm = window.vroonWasm;
        this.colorBleedFix = new ColorBleedFix(this.wasm);
        this.denoiser = new DenoiseProcessor(this.wasm);
        this.punchyBW = new PunchyBW(this.wasm);
        this.superRes = new SuperResolution(this.wasm);
        this.inpainter = new SmartInpainter(this.wasm);

        this.history = [];
        this.historyIndex = -1;

        this.isBeforeAfterActive = false;
        this.splitComparePos = 0.5;
        this.activeTool = 'adjust'; // 'adjust', 'inpaint', 'crop'

        this.state = this.getDefaultState();

        this.isRendering = false;
        this.renderPending = false;
    }

    getDefaultState() {
        return {
            // Basic Light & Tone
            exposure: 0,
            contrast: 0,
            highlights: 0,
            shadows: 0,
            whites: 0,
            blacks: 0,

            // White balance & Color
            temp: 0,
            tint: 0,
            vibrance: 0,
            saturation: 0,

            // Texture & Details
            clarity: 0,
            texture: 0,
            dehaze: 0,
            vignette: 0,

            // Stage Red Light & Bleed Recovery
            stageRedFix: 0,        // 0 to 100
            colorBleedReduction: 0,// 0 to 100
            skinProtection: 50,    // 0 to 100
            gamutCompress: 50,     // 0 to 100

            // Noise Reduction
            denoiseLuma: 0,        // 0 to 100
            denoiseChroma: 0,      // 0 to 100
            denoiseDetail: 50,     // 0 to 100

            // Punchy Black & White
            bwEnabled: false,
            bwRed: 40,
            bwOrange: 30,
            bwYellow: 20,
            bwGreen: 10,
            bwAqua: 0,
            bwBlue: -10,
            bwContrast: 35,
            bwClarity: 45,
            bwGrain: 10,

            // Transforms
            rotation: 0,
            flipH: false,
            flipV: false
        };
    }

    async init() {
        await this.wasm.init();
        window.versionChecker.init();

        this.toneCurve = new ToneCurve('curve-canvas', () => this.queueRender());
        this.histogram = new Histogram('histogram-canvas');

        this.setupEventListeners();
        this.setupDropZone();
        this.setupKeyboardShortcuts();

        // Load default concert stage sample photo so the user can immediately test!
        this.loadSamplePhoto('concert_red');
    }

    setupEventListeners() {
        // Sliders binding
        const sliders = document.querySelectorAll('.param-slider');
        sliders.forEach(slider => {
            const id = slider.id;
            const param = slider.dataset.param;
            const numInput = document.getElementById(`${id}-val`);

            slider.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                this.state[param] = val;
                if (numInput) numInput.value = val;
                this.queueRender();
            });

            if (numInput) {
                numInput.addEventListener('change', (e) => {
                    let val = parseFloat(e.target.value);
                    val = Math.max(parseFloat(slider.min), Math.min(parseFloat(slider.max), val));
                    slider.value = val;
                    this.state[param] = val;
                    this.queueRender();
                });
            }
        });

        // Reset section buttons
        document.querySelectorAll('.btn-reset-section').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const section = e.target.dataset.section;
                this.resetSection(section);
            });
        });

        // B&W Toggle
        const bwToggle = document.getElementById('toggle-bw-mode');
        if (bwToggle) {
            bwToggle.addEventListener('change', (e) => {
                this.state.bwEnabled = e.target.checked;
                const panel = document.getElementById('bw-mixer-panel');
                if (panel) panel.classList.toggle('disabled', !this.state.bwEnabled);
                this.queueRender();
            });
        }

        // B&W Presets
        document.querySelectorAll('.bw-preset-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const presetKey = e.currentTarget.dataset.preset;
                this.applyBWPreset(presetKey);
            });
        });

        // Global Presets
        document.querySelectorAll('.preset-card').forEach(card => {
            card.addEventListener('click', (e) => {
                const preset = e.currentTarget.dataset.preset;
                this.applyGlobalPreset(preset);
            });
        });

        // Topaz Super-Resolution Upscaling buttons
        document.getElementById('btn-upscale-2x')?.addEventListener('click', () => {
            this.executeUpscale(2);
        });
        document.getElementById('btn-upscale-4x')?.addEventListener('click', () => {
            this.executeUpscale(4);
        });

        // Firefly Inpaint Tool activation
        document.getElementById('tool-inpaint')?.addEventListener('click', () => {
            this.setActiveTool('inpaint');
        });
        document.getElementById('btn-apply-heal')?.addEventListener('click', () => {
            this.applyHealBrush();
        });
        document.getElementById('btn-clear-heal')?.addEventListener('click', () => {
            this.inpainter.clearMask();
            this.renderMainCanvas();
        });

        // Comparison Before/After
        const compareBtn = document.getElementById('btn-compare-toggle');
        if (compareBtn) {
            compareBtn.addEventListener('click', () => {
                this.isBeforeAfterActive = !this.isBeforeAfterActive;
                compareBtn.classList.toggle('active', this.isBeforeAfterActive);
                this.renderMainCanvas();
            });
        }

        // Export Modal
        document.getElementById('btn-open-export')?.addEventListener('click', () => {
            document.getElementById('export-modal')?.classList.remove('hidden');
        });
        document.getElementById('btn-close-export')?.addEventListener('click', () => {
            document.getElementById('export-modal')?.classList.add('hidden');
        });
        document.getElementById('btn-confirm-export')?.addEventListener('click', () => {
            this.exportImage();
        });

        // Rotate & Flip
        document.getElementById('btn-rotate-left')?.addEventListener('click', () => {
            this.rotateImage(-90);
        });
        document.getElementById('btn-rotate-right')?.addEventListener('click', () => {
            this.rotateImage(90);
        });
        document.getElementById('btn-flip-h')?.addEventListener('click', () => {
            this.state.flipH = !this.state.flipH;
            this.queueRender();
        });

        // Sample photos dropdown
        document.getElementById('sample-photos-select')?.addEventListener('change', (e) => {
            this.loadSamplePhoto(e.target.value);
        });

        // File input
        const fileInput = document.getElementById('file-upload-input');
        fileInput?.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                this.loadFile(e.target.files[0]);
            }
        });

        // Canvas interactions for Inpaint Brush & Split Slider
        this.setupCanvasInteractions();
    }

    setupCanvasInteractions() {
        let isDrawing = false;

        this.canvas.addEventListener('mousedown', (e) => {
            if (this.activeTool === 'inpaint') {
                isDrawing = true;
                const pt = this.getCanvasCoordinates(e);
                const brushSize = parseInt(document.getElementById('inpaint-brush-size')?.value || 25);
                this.inpainter.drawBrush(pt.x, pt.y, brushSize);
                this.renderInpaintOverlay();
            } else if (this.isBeforeAfterActive) {
                const rect = this.canvas.getBoundingClientRect();
                this.splitComparePos = (e.clientX - rect.left) / rect.width;
                this.renderMainCanvas();
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (this.activeTool === 'inpaint' && isDrawing) {
                const pt = this.getCanvasCoordinates(e);
                const brushSize = parseInt(document.getElementById('inpaint-brush-size')?.value || 25);
                this.inpainter.drawBrush(pt.x, pt.y, brushSize);
                this.renderInpaintOverlay();
            } else if (this.isBeforeAfterActive && e.buttons === 1) {
                const rect = this.canvas.getBoundingClientRect();
                this.splitComparePos = Math.max(0.05, Math.min(0.95, (e.clientX - rect.left) / rect.width));
                this.renderMainCanvas();
            }
        });

        window.addEventListener('mouseup', () => {
            isDrawing = false;
        });
    }

    getCanvasCoordinates(e) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    renderInpaintOverlay() {
        this.renderMainCanvas();
        if (this.activeTool === 'inpaint' && this.inpainter.maskCanvas) {
            this.ctx.save();
            this.ctx.globalAlpha = 0.45;
            this.ctx.drawImage(this.inpainter.maskCanvas, 0, 0);
            this.ctx.restore();
        }
    }

    applyHealBrush() {
        if (!this.currentImageData) return;
        this.saveHistory('Smart Inpaint / Vlekken herstel');
        this.inpainter.heal(this.originalImageData, 6);
        this.renderInpaintOverlay();
        this.queueRender();
    }

    setupKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            // '\' key for Before/After compare (standard Lightroom shortcut)
            if (e.key === '\\') {
                e.preventDefault();
                const btn = document.getElementById('btn-compare-toggle');
                btn?.click();
            }
            // Ctrl+Z / Cmd+Z for Undo
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                if (e.shiftKey) this.redo();
                else this.undo();
            }
        });
    }

    setupDropZone() {
        const dropZone = document.getElementById('viewport-dropzone');
        if (!dropZone) return;

        ['dragenter', 'dragover'].forEach(name => {
            dropZone.addEventListener(name, (e) => {
                e.preventDefault();
                dropZone.classList.add('drag-active');
            });
        });

        ['dragleave', 'drop'].forEach(name => {
            dropZone.addEventListener(name, (e) => {
                e.preventDefault();
                dropZone.classList.remove('drag-active');
            });
        });

        dropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files && files.length > 0) {
                this.loadFile(files[0]);
            }
        });
    }

    async loadFile(file) {
        document.getElementById('loading-overlay')?.classList.remove('hidden');
        try {
            console.log(`📂 Opening file: ${file.name} (${file.type || 'RAW/TIFF'})`);
            const decoded = await window.rawDecoder.decode(file);
            this.setImage(decoded.imageData, decoded.metadata);
        } catch (err) {
            console.error('Error loading image:', err);
            alert(`Fout bij het laden van foto: ${err.message}`);
        } finally {
            document.getElementById('loading-overlay')?.classList.add('hidden');
        }
    }

    setImage(imageData, metadata = {}) {
        this.originalImageData = new ImageData(
            new Uint8ClampedArray(imageData.data),
            imageData.width,
            imageData.height
        );
        this.currentImageData = new ImageData(
            new Uint8ClampedArray(imageData.data),
            imageData.width,
            imageData.height
        );

        this.canvas.width = imageData.width;
        this.canvas.height = imageData.height;

        this.inpainter.initMask(imageData.width, imageData.height);

        // Update photo info badge
        const infoEl = document.getElementById('photo-info-display');
        if (infoEl) {
            infoEl.textContent = `${metadata.filename || 'Foto'} | ${imageData.width}×${imageData.height}px | ${metadata.filesize || ''}`;
        }

        // Automatic analysis of stage red light blowout
        const analysis = this.colorBleedFix.analyzeRedBlowout(this.originalImageData);
        const warningEl = document.getElementById('stage-red-detected-alert');
        if (warningEl) {
            if (analysis.hasSevereStageRed) {
                warningEl.classList.remove('hidden');
                warningEl.innerHTML = `⚠️ <strong>Rood podiumlicht gedetecteerd (${analysis.blownPercentage}% clipping)!</strong> 'Rood Licht Herstel' geactiveerd.`;
                this.state.stageRedFix = 85;
                this.state.colorBleedReduction = 65;
                this.syncSliderUI();
            } else {
                warningEl.classList.add('hidden');
            }
        }

        this.saveHistory('Origineel geladen');
        this.queueRender();
    }

    syncSliderUI() {
        document.querySelectorAll('.param-slider').forEach(slider => {
            const param = slider.dataset.param;
            if (this.state[param] !== undefined) {
                slider.value = this.state[param];
                const valInput = document.getElementById(`${slider.id}-val`);
                if (valInput) valInput.value = this.state[param];
            }
        });
    }

    queueRender() {
        if (this.isRendering) {
            this.renderPending = true;
            return;
        }
        this.isRendering = true;

        requestAnimationFrame(() => {
            this.processAndRender();
            this.isRendering = false;
            if (this.renderPending) {
                this.renderPending = false;
                this.queueRender();
            }
        });
    }

    processAndRender() {
        if (!this.originalImageData) return;

        // Clone fresh copy from original image
        const img = new ImageData(
            new Uint8ClampedArray(this.originalImageData.data),
            this.originalImageData.width,
            this.originalImageData.height
        );

        const data = img.data;
        const total = data.length;

        // 1. Stage Red Light & Bleed Recovery (Run first to reconstruct texture before tone adjustments)
        if (this.state.stageRedFix > 0) {
            this.colorBleedFix.apply(img, {
                threshold: 0.68,
                strength: this.state.stageRedFix / 100.0,
                skinProtect: this.state.skinProtection / 100.0,
                gamutCompress: (this.state.colorBleedReduction / 100.0)
            });
        }

        // 2. Dual-Engine Denoise (Bilateral Luminance + Guided Chroma)
        if (this.state.denoiseLuma > 0 || this.state.denoiseChroma > 0) {
            this.denoiser.apply(img, {
                luminance: this.state.denoiseLuma,
                chroma: this.state.denoiseChroma,
                detail: this.state.denoiseDetail
            });
        }

        // 3. Lightroom Tone & Color Adjustments
        const expFactor = Math.pow(2.0, this.state.exposure / 2.0);
        const contFactor = (this.state.contrast + 100.0) / 100.0;
        const hiFactor = (this.state.highlights / 100.0);
        const shFactor = (this.state.shadows / 100.0);
        const tempOffset = (this.state.temp / 100.0) * 35.0; // Warm amber vs cold blue
        const tintOffset = (this.state.tint / 100.0) * 25.0; // Magenta vs green
        const satFactor = (this.state.saturation + 100.0) / 100.0;
        const vibFactor = (this.state.vibrance / 100.0);

        for (let i = 0; i < total; i += 4) {
            let r = data[i];
            let g = data[i + 1];
            let b = data[i + 2];

            // Exposure
            r *= expFactor;
            g *= expFactor;
            b *= expFactor;

            // White Balance
            r += tempOffset;
            b -= tempOffset;
            g -= tintOffset * 0.5;
            r += tintOffset * 0.25;
            b += tintOffset * 0.25;

            // Highlights & Shadows
            const luma = 0.299 * r + 0.587 * g + 0.114 * b;
            if (luma > 128 && hiFactor !== 0) {
                const normHi = (luma - 128) / 128.0;
                const hiDelta = normHi * hiFactor * 45.0;
                r += hiDelta; g += hiDelta; b += hiDelta;
            } else if (luma < 128 && shFactor !== 0) {
                const normSh = (128 - luma) / 128.0;
                const shDelta = normSh * shFactor * 45.0;
                r += shDelta; g += shDelta; b += shDelta;
            }

            // Contrast
            r = 128.0 + (r - 128.0) * contFactor;
            g = 128.0 + (g - 128.0) * contFactor;
            b = 128.0 + (b - 128.0) * contFactor;

            // Vibrance & Saturation
            const maxC = Math.max(r, g, b);
            const minC = Math.min(r, g, b);
            const sat = maxC === 0 ? 0 : (maxC - minC) / maxC;
            const effectiveSat = satFactor * (1.0 + (1.0 - sat) * vibFactor);

            const gray = 0.299 * r + 0.587 * g + 0.114 * b;
            r = gray + (r - gray) * effectiveSat;
            g = gray + (g - gray) * effectiveSat;
            b = gray + (b - gray) * effectiveSat;

            data[i]     = Math.min(255, Math.max(0, r | 0));
            data[i + 1] = Math.min(255, Math.max(0, g | 0));
            data[i + 2] = Math.min(255, Math.max(0, b | 0));
        }

        // 4. Tone Curve
        if (this.toneCurve) {
            this.toneCurve.apply(img);
        }

        // 5. Punchy Black & White Engine ("Knallend Zwart-Wit")
        if (this.state.bwEnabled) {
            this.punchyBW.apply(img, {
                enabled: true,
                red: (this.state.bwRed + 100) / 100.0,
                green: (this.state.bwGreen + 100) / 100.0,
                blue: (this.state.bwBlue + 100) / 100.0,
                contrast: this.state.bwContrast,
                clarity: this.state.bwClarity,
                grain: this.state.bwGrain
            });
        }

        this.currentImageData = img;
        this.renderMainCanvas();
        this.histogram.update(img);
    }

    renderMainCanvas() {
        if (!this.currentImageData || !this.ctx) return;

        const w = this.currentImageData.width;
        const h = this.currentImageData.height;

        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w;
            this.canvas.height = h;
        }

        if (this.isBeforeAfterActive) {
            // Split screen comparison
            this.ctx.putImageData(this.currentImageData, 0, 0);

            // Draw original on the left side
            const splitX = Math.floor(w * this.splitComparePos);
            this.ctx.save();
            this.ctx.beginPath();
            this.ctx.rect(0, 0, splitX, h);
            this.ctx.clip();
            this.ctx.putImageData(this.originalImageData, 0, 0);
            this.ctx.restore();

            // Draw vertical divider line
            this.ctx.strokeStyle = '#ffffff';
            this.ctx.lineWidth = 2.5;
            this.ctx.beginPath();
            this.ctx.moveTo(splitX, 0);
            this.ctx.lineTo(splitX, h);
            this.ctx.stroke();

            // Labels
            this.ctx.fillStyle = '#ffffff';
            this.ctx.font = 'bold 14px system-ui, -apple-system, sans-serif';
            this.ctx.fillText('VOOR', Math.max(10, splitX - 60), 30);
            this.ctx.fillText('NA', splitX + 15, 30);
        } else {
            this.ctx.putImageData(this.currentImageData, 0, 0);
        }
    }

    executeUpscale(scale = 2) {
        if (!this.currentImageData) return;
        const sharpness = parseFloat(document.getElementById('upscale-sharpness')?.value || 50);
        document.getElementById('loading-overlay')?.classList.remove('hidden');

        setTimeout(() => {
            try {
                this.saveHistory(`Topaz Upscale ${scale}x`);
                const upscaled = this.superRes.upscale(this.currentImageData, scale, sharpness);
                this.setImage(upscaled, {
                    filename: `upscaled_${scale}x.jpg`,
                    filesize: `${(upscaled.width * upscaled.height * 4 / 1024 / 1024).toFixed(1)} MB (Ongecomprimeerd)`
                });
                alert(`✨ Succesvol vergroot naar ${upscaled.width} × ${upscaled.height} pixels met Topaz AI Super-Resolution!`);
            } catch (e) {
                alert('Upscale fout: ' + e.message);
            } finally {
                document.getElementById('loading-overlay')?.classList.add('hidden');
            }
        }, 50);
    }

    applyBWPreset(key) {
        const p = this.punchyBW.presets[key];
        if (!p) return;
        this.state.bwEnabled = true;
        document.getElementById('toggle-bw-mode').checked = true;
        document.getElementById('bw-mixer-panel')?.classList.remove('disabled');

        this.state.bwRed = Math.round(p.red * 100);
        this.state.bwGreen = Math.round(p.green * 100);
        this.state.bwBlue = Math.round(p.blue * 100);
        this.state.bwContrast = p.contrast;
        this.state.bwClarity = p.clarity;
        this.state.bwGrain = p.grain;

        this.syncSliderUI();
        this.queueRender();
    }

    applyGlobalPreset(name) {
        switch (name) {
            case 'stage_fix':
                this.state.stageRedFix = 90;
                this.state.colorBleedReduction = 75;
                this.state.skinProtection = 65;
                this.state.highlights = -30;
                this.state.shadows = 20;
                break;
            case 'punchy_bw':
                this.applyBWPreset('knallend_contrast');
                break;
            case 'crisp_landscape':
                this.state.exposure = 0.2;
                this.state.contrast = 20;
                this.state.highlights = -25;
                this.state.shadows = 30;
                this.state.vibrance = 35;
                this.state.clarity = 25;
                break;
            case 'portrait_clean':
                this.state.exposure = 0.3;
                this.state.contrast = 10;
                this.state.denoiseLuma = 30;
                this.state.denoiseChroma = 45;
                this.state.temp = 8;
                break;
        }
        this.syncSliderUI();
        this.queueRender();
    }

    resetSection(section) {
        const def = this.getDefaultState();
        if (section === 'tone') {
            ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'].forEach(k => this.state[k] = def[k]);
        } else if (section === 'color') {
            ['temp', 'tint', 'vibrance', 'saturation'].forEach(k => this.state[k] = def[k]);
        } else if (section === 'stage_red') {
            ['stageRedFix', 'colorBleedReduction', 'skinProtection', 'gamutCompress'].forEach(k => this.state[k] = def[k]);
        } else if (section === 'denoise') {
            ['denoiseLuma', 'denoiseChroma', 'denoiseDetail'].forEach(k => this.state[k] = def[k]);
        }
        this.syncSliderUI();
        this.queueRender();
    }

    rotateImage(deg) {
        if (!this.originalImageData) return;
        const src = this.originalImageData;
        const dst = new ImageData(src.height, src.width);
        const sw = src.width, sh = src.height;

        for (let y = 0; y < sh; y++) {
            for (let x = 0; x < sw; x++) {
                const sIdx = (y * sw + x) * 4;
                let dx = deg === 90 ? sh - 1 - y : y;
                let dy = deg === 90 ? x : sw - 1 - x;
                const dIdx = (dy * sh + dx) * 4;
                dst.data[dIdx] = src.data[sIdx];
                dst.data[dIdx + 1] = src.data[sIdx + 1];
                dst.data[dIdx + 2] = src.data[sIdx + 2];
                dst.data[dIdx + 3] = src.data[sIdx + 3];
            }
        }
        this.setImage(dst);
    }

    saveHistory(actionName) {
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }
        this.history.push({
            name: actionName,
            state: JSON.parse(JSON.stringify(this.state))
        });
        this.historyIndex = this.history.length - 1;
    }

    undo() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            this.state = JSON.parse(JSON.stringify(this.history[this.historyIndex].state));
            this.syncSliderUI();
            this.queueRender();
        }
    }

    redo() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            this.state = JSON.parse(JSON.stringify(this.history[this.historyIndex].state));
            this.syncSliderUI();
            this.queueRender();
        }
    }

    loadSamplePhoto(sampleId) {
        // Generate high-fidelity procedural sample photos for immediate testing!
        const w = 1200, h = 800;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');

        if (sampleId === 'concert_red') {
            // Stage concert lighting simulation: extreme red/magenta blowout with bleeding halos
            // Background dark concert hall
            const grad = ctx.createLinearGradient(0, 0, w, h);
            grad.addColorStop(0, '#0a0305');
            grad.addColorStop(1, '#1a050b');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, w, h);

            // Performer silhouette / face contours
            ctx.fillStyle = '#8b5a45'; // skin tone
            ctx.beginPath();
            ctx.arc(600, 380, 110, 0, Math.PI * 2);
            ctx.fill();

            // Intense Blown Red Stage Floodlights
            const redSpot = ctx.createRadialGradient(600, 360, 20, 600, 360, 420);
            redSpot.addColorStop(0, 'rgba(255, 30, 20, 1.0)');
            redSpot.addColorStop(0.35, 'rgba(255, 10, 30, 0.95)');
            redSpot.addColorStop(0.7, 'rgba(230, 0, 50, 0.7)');
            redSpot.addColorStop(1, 'rgba(100, 0, 20, 0.0)');
            ctx.fillStyle = redSpot;
            ctx.fillRect(0, 0, w, h);

            // Microphone and guitar details
            ctx.strokeStyle = '#c0c0c0';
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.moveTo(560, 480);
            ctx.lineTo(600, 400);
            ctx.stroke();

            // Microphone grille
            ctx.fillStyle = '#e2e8f0';
            ctx.beginPath();
            ctx.arc(600, 395, 18, 0, Math.PI * 2);
            ctx.fill();

            // Draw text tag
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 20px system-ui';
            ctx.fillText('Voorbeeld: Podiumconcert met Overbelicht Rood Licht & Kleurdoorloop', 40, 60);

        } else if (sampleId === 'noisy_night') {
            // High ISO noisy night photo
            ctx.fillStyle = '#0f172a';
            ctx.fillRect(0, 0, w, h);
            // Buildings & lights
            ctx.fillStyle = '#334155';
            ctx.fillRect(150, 300, 220, 500);
            ctx.fillRect(450, 200, 300, 600);
            ctx.fillRect(820, 350, 250, 450);

            // Add heavy color noise speckles
            const imgData = ctx.getImageData(0, 0, w, h);
            const d = imgData.data;
            for (let i = 0; i < d.length; i += 4) {
                const noise = (Math.random() - 0.5) * 80;
                const chromaR = (Math.random() - 0.5) * 60;
                const chromaB = (Math.random() - 0.5) * 60;
                d[i] = Math.min(255, Math.max(0, d[i] + noise + chromaR));
                d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + noise));
                d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + noise + chromaB));
            }
            ctx.putImageData(imgData, 0, 0);

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 20px system-ui';
            ctx.fillText('Voorbeeld: Hoge ISO Nachtopname (Veel Luminantie- & Kleurruis)', 40, 60);

        } else {
            // Dramatic Landscape for Punchy B&W test
            const grad = ctx.createLinearGradient(0, 0, 0, h);
            grad.addColorStop(0, '#38bdf8');
            grad.addColorStop(0.5, '#bae6fd');
            grad.addColorStop(0.51, '#15803d');
            grad.addColorStop(1, '#14532d');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, w, h);

            // Dramatic mountain peaks
            ctx.fillStyle = '#475569';
            ctx.beginPath();
            ctx.moveTo(100, 400); ctx.lineTo(350, 150); ctx.lineTo(600, 400);
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(500, 400); ctx.lineTo(750, 120); ctx.lineTo(1050, 400);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 20px system-ui';
            ctx.fillText('Voorbeeld: Berglandschap (Perfect voor Knallend Zwart-Wit & Tone Curve)', 40, 60);
        }

        const sampleImageData = ctx.getImageData(0, 0, w, h);
        this.setImage(sampleImageData, {
            filename: `${sampleId}.dng`,
            filesize: '3.6 MB'
        });
    }

    exportImage() {
        if (!this.currentImageData) return;

        const format = document.getElementById('export-format')?.value || 'image/jpeg';
        const quality = parseFloat(document.getElementById('export-quality')?.value || 0.95);

        const expCanvas = document.createElement('canvas');
        expCanvas.width = this.currentImageData.width;
        expCanvas.height = this.currentImageData.height;
        const expCtx = expCanvas.getContext('2d');
        expCtx.putImageData(this.currentImageData, 0, 0);

        const dataUrl = expCanvas.toDataURL(format, quality);
        const ext = format === 'image/png' ? 'png' : (format === 'image/webp' ? 'webp' : 'jpg');

        const link = document.createElement('a');
        link.download = `vroonphoto_edit_${Date.now()}.${ext}`;
        link.href = dataUrl;
        link.click();

        document.getElementById('export-modal')?.classList.add('hidden');
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.vroonApp = new VroonPhotoApp();
    window.vroonApp.init();
});
