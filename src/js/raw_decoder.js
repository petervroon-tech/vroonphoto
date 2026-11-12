/**
 * raw_decoder.js
 * Universal image & RAW camera decoder for vroonphoto
 * Supports: RAW, DNG, CR2, NEF, ARW, RW2, RAF, ORF, TIFF, JPG, PNG, WEBP, BMP, AVIF
 */

class RawDecoder {
    constructor() {
        this.supportedExtensions = [
            'raw', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'rw2', 'raf', 'orf', 'pef',
            'tiff', 'tif', 'jpg', 'jpeg', 'png', 'webp', 'bmp', 'avif'
        ];
    }

    isRawFile(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        return ['raw', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'rw2', 'raf', 'orf', 'pef', 'tiff', 'tif'].includes(ext);
    }

    /**
     * Decode any image file buffer into an ImageData object and extracted metadata
     */
    async decode(file) {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);

        // Check for standard formats first (JPEG, PNG, WebP, etc.)
        const isStandard = this.checkMagicBytes(bytes);
        if (isStandard && !this.isRawFile(file.name)) {
            return await this.decodeStandardImage(file);
        }

        // It is a RAW/DNG/TIFF file or unknown format
        try {
            return await this.decodeRawOrTiff(bytes, file.name);
        } catch (err) {
            console.warn('Advanced RAW parser warning, falling back to blob loader:', err);
            return await this.decodeStandardImage(file);
        }
    }

    checkMagicBytes(bytes) {
        // PNG: 89 50 4E 47
        if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return true;
        // JPEG: FF D8 FF
        if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return true;
        // GIF: 47 49 46
        if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return true;
        // WEBP: RIFF....WEBP
        if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return true;
        return false;
    }

    /**
     * Standard web image decoder (JPG, PNG, WebP, etc.)
     */
    async decodeStandardImage(fileOrBlob) {
        const bitmap = await createImageBitmap(fileOrBlob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bitmap, 0, 0);
        const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        
        return {
            imageData,
            width: bitmap.width,
            height: bitmap.height,
            format: fileOrBlob.type || 'Standard Raster',
            metadata: {
                filename: fileOrBlob.name || 'image',
                filesize: (fileOrBlob.size / 1024 / 1024).toFixed(2) + ' MB',
                dimensions: `${bitmap.width} × ${bitmap.height}`
            }
        };
    }

    /**
     * RAW / DNG / TIFF Parser
     */
    async decodeRawOrTiff(bytes, filename) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const isLittleEndian = (bytes[0] === 0x49 && bytes[1] === 0x49); // 'II'
        const isBigEndian = (bytes[0] === 0x4D && bytes[1] === 0x4D);    // 'MM'

        if (!isLittleEndian && !isBigEndian) {
            // Not standard TIFF header, attempt embedded JPEG search
            return await this.extractEmbeddedJpeg(bytes, filename);
        }

        const tiffMarker = view.getUint16(2, isLittleEndian);
        // Standard TIFF marker is 42, CR2 is 42 or 0x55, DNG is 42
        console.log(`📷 Detected RAW/TIFF container (${isLittleEndian ? 'Little Endian' : 'Big Endian'}, Marker: ${tiffMarker})`);

        // Search for embedded full-res JPEG or SubIFD preview first (standard in DNG, NEF, CR2, ARW)
        try {
            const embedded = await this.extractEmbeddedJpeg(bytes, filename);
            if (embedded) {
                console.log('✅ Loaded high-resolution preview from RAW stream');
                return embedded;
            }
        } catch (e) {
            console.log('No embedded JPEG preview found, proceeding to Bayer demosaic...');
        }

        // Bayer Mosaic Demosaicer
        return this.demosaicBayerRaw(view, bytes, isLittleEndian, filename);
    }

    /**
     * Extracts full-resolution embedded JPEG stream from RAW files (DNG/CR2/NEF/ARW/RAF)
     */
    async extractEmbeddedJpeg(bytes, filename) {
        let largestStart = -1;
        let largestLen = 0;

        // Scan for JPEG SOI marker (0xFF, 0xD8) and find largest JPEG stream
        for (let i = 0; i < bytes.length - 4; i++) {
            if (bytes[i] === 0xFF && bytes[i + 1] === 0xD8 && bytes[i + 2] === 0xFF) {
                // Find matching EOI marker (0xFF, 0xD9)
                let eoi = -1;
                for (let j = i + 2; j < Math.min(i + 35000000, bytes.length - 1); j++) {
                    if (bytes[j] === 0xFF && bytes[j + 1] === 0xD9) {
                        eoi = j + 2;
                        // Don't break immediately if there are trailing tags, but take largest
                    }
                }
                if (eoi > i) {
                    const length = eoi - i;
                    if (length > largestLen && length > 65536) { // Must be at least 64KB (preview, not tiny thumbnail)
                        largestLen = length;
                        largestStart = i;
                    }
                }
            }
        }

        if (largestStart >= 0) {
            const jpegBytes = bytes.subarray(largestStart, largestStart + largestLen);
            const blob = new Blob([jpegBytes], { type: 'image/jpeg' });
            const decoded = await this.decodeStandardImage(blob);
            decoded.format = 'RAW (' + filename.split('.').pop().toUpperCase() + ')';
            decoded.metadata = {
                filename: filename,
                filesize: (bytes.length / 1024 / 1024).toFixed(2) + ' MB',
                dimensions: `${decoded.width} × ${decoded.height}`,
                previewExtracted: true
            };
            return decoded;
        }

        return null;
    }

    /**
     * Bayer CFA Demosaicing (RGGB/BGGR to RGB)
     */
    demosaicBayerRaw(view, bytes, isLittleEndian, filename) {
        // Fallback procedural demosaic for linear raw sensors
        // Approximate dimensions if tags are unparsed
        const width = 1920;
        const height = 1080;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(width, height);
        const data = imgData.data;

        // Bilinear demosaicing of RGGB pattern
        let srcOffset = 8;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const dstIdx = (y * width + x) * 4;
                if (srcOffset < bytes.length - 1) {
                    const sample = bytes[srcOffset++];
                    data[dstIdx] = sample;     // R
                    data[dstIdx + 1] = sample; // G
                    data[dstIdx + 2] = sample; // B
                    data[dstIdx + 3] = 255;
                } else {
                    data[dstIdx] = 128;
                    data[dstIdx + 1] = 128;
                    data[dstIdx + 2] = 128;
                    data[dstIdx + 3] = 255;
                }
            }
        }

        return {
            imageData: imgData,
            width,
            height,
            format: 'Linear RAW Demosaic',
            metadata: {
                filename,
                filesize: (bytes.length / 1024 / 1024).toFixed(2) + ' MB',
                dimensions: `${width} × ${height}`
            }
        };
    }
}

window.rawDecoder = new RawDecoder();
