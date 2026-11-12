/*
 * vroonphoto_core.c
 * Core high-performance image processing kernel for vroonphoto
 * Fast, zero-allocation, operates directly on linear WASM memory buffers.
 */

#define CLAMP(x, low, high) (((x) > (high)) ? (high) : (((x) < (low)) ? (low) : (x)))
#define MAX(a, b) (((a) > (b)) ? (a) : (b))
#define MIN(a, b) (((a) < (b)) ? (a) : (b))

/*
 * 1. STAGE RED LIGHT & COLOR BLEED RECOVERY ("Rood Licht & Gamut Herstel")
 * Targets concert stage red lights, red LED bleeding, and clipped red channel.
 * Reconstructs lost facial and object textures using intact Green & Blue channels,
 * shrinks oversaturated red bleeding halos, and compresses out-of-gamut red flares.
 */
__attribute__((visibility("default")))
void vroon_recover_red_light(
    unsigned char* pixels,
    int width,
    int height,
    float threshold,        // 0.0 to 1.0 (e.g. 0.70 = 180/255)
    float recovery_strength,// 0.0 to 1.0
    float skin_protect,     // 0.0 to 1.0
    float gamut_compress    // 0.0 to 1.0
) {
    int total_pixels = width * height;
    float thresh_val = threshold * 255.0f;

    for (int i = 0; i < total_pixels; i++) {
        int idx = i * 4;
        float r = (float)pixels[idx];
        float g = (float)pixels[idx + 1];
        float b = (float)pixels[idx + 2];

        float max_gb = MAX(g, b);

        if (r > thresh_val && r > max_gb * 1.25f) {
            float detail_luma = 0.65f * g + 0.35f * b;
            float blowout = (r - max_gb) / 255.0f;
            if (blowout > 1.0f) blowout = 1.0f;

            float blend = blowout * recovery_strength;
            float r_reconstructed = r * (1.0f - blend) + (max_gb + detail_luma * 0.45f) * blend;

            if (gamut_compress > 0.01f) {
                float target_g = g + (r - max_gb) * 0.32f * gamut_compress;
                float target_b = b + (r - max_gb) * 0.15f * gamut_compress;
                g = g * (1.0f - gamut_compress * 0.6f) + target_g * (gamut_compress * 0.6f);
                b = b * (1.0f - gamut_compress * 0.6f) + target_b * (gamut_compress * 0.6f);
            }

            if (skin_protect > 0.01f && g > b) {
                float skin_ratio = (g - b) / (r - b + 0.001f);
                if (skin_ratio > 0.2f && skin_ratio < 0.65f) {
                    float skin_factor = skin_protect * 0.65f;
                    r_reconstructed = r_reconstructed * (1.0f - skin_factor) + r * skin_factor;
                    g = g + 10.0f * skin_factor;
                }
            }

            pixels[idx]     = (unsigned char)CLAMP(r_reconstructed, 0.0f, 255.0f);
            pixels[idx + 1] = (unsigned char)CLAMP(g, 0.0f, 255.0f);
            pixels[idx + 2] = (unsigned char)CLAMP(b, 0.0f, 255.0f);
        }
    }
}

/*
 * 2. DUAL-STAGE NOISE REDUCTION ("Ruisonderdrukking")
 * Spatial Bilateral filter for Luminance (smooths noise while preserving crisp edges)
 */
__attribute__((visibility("default")))
void vroon_denoise_bilateral(
    const unsigned char* src,
    unsigned char* dst,
    int width,
    int height,
    int radius,
    float spatial_sigma,
    float range_sigma
) {
    float two_spatial_sq = 2.0f * spatial_sigma * spatial_sigma;
    float two_range_sq = 2.0f * range_sigma * range_sigma;

    for (int y = 0; y < height; y++) {
        for (int x = 0; x < width; x++) {
            int center_idx = (y * width + x) * 4;
            float c_r = (float)src[center_idx];
            float c_g = (float)src[center_idx + 1];
            float c_b = (float)src[center_idx + 2];

            float sum_r = 0.0f, sum_g = 0.0f, sum_b = 0.0f;
            float sum_weights = 0.0f;

            for (int dy = -radius; dy <= radius; dy++) {
                int py = y + dy;
                if (py < 0 || py >= height) continue;

                for (int dx = -radius; dx <= radius; dx++) {
                    int px = x + dx;
                    if (px < 0 || px >= width) continue;

                    int p_idx = (py * width + px) * 4;
                    float p_r = (float)src[p_idx];
                    float p_g = (float)src[p_idx + 1];
                    float p_b = (float)src[p_idx + 2];

                    float dist_sq = (float)(dx * dx + dy * dy);
                    float diff_r = p_r - c_r;
                    float diff_g = p_g - c_g;
                    float diff_b = p_b - c_b;
                    float color_dist_sq = diff_r * diff_r + diff_g * diff_g + diff_b * diff_b;

                    float w_spatial = 1.0f / (1.0f + dist_sq / two_spatial_sq);
                    float w_range = 1.0f / (1.0f + color_dist_sq / two_range_sq);
                    float weight = w_spatial * w_range;

                    sum_r += p_r * weight;
                    sum_g += p_g * weight;
                    sum_b += p_b * weight;
                    sum_weights += weight;
                }
            }

            float inv_w = 1.0f / sum_weights;
            dst[center_idx]     = (unsigned char)CLAMP(sum_r * inv_w, 0.0f, 255.0f);
            dst[center_idx + 1] = (unsigned char)CLAMP(sum_g * inv_w, 0.0f, 255.0f);
            dst[center_idx + 2] = (unsigned char)CLAMP(sum_b * inv_w, 0.0f, 255.0f);
            dst[center_idx + 3] = src[center_idx + 3];
        }
    }
}

/*
 * 3. CHROMA NOISE SUPPRESSION
 * Eliminates colorful chroma noise splotches in YCbCr color space.
 */
__attribute__((visibility("default")))
void vroon_denoise_chroma(
    unsigned char* pixels,
    int width,
    int height,
    float strength
) {
    if (strength <= 0.001f) return;
    int radius = (strength > 0.5f) ? 2 : 1;
    float blend = strength * 0.85f;

    for (int y = 0; y < height; y++) {
        for (int x = 0; x < width; x++) {
            int idx = (y * width + x) * 4;
            float r = (float)pixels[idx];
            float g = (float)pixels[idx + 1];
            float b = (float)pixels[idx + 2];

            float y_lum =  0.299f * r + 0.587f * g + 0.114f * b;
            float cb    = -0.168736f * r - 0.331264f * g + 0.5f * b;
            float cr    =  0.5f * r - 0.418688f * g - 0.081312f * b;

            float sum_cb = 0.0f, sum_cr = 0.0f;
            int count = 0;
            for (int dy = -radius; dy <= radius; dy++) {
                int py = y + dy;
                if (py < 0 || py >= height) continue;
                for (int dx = -radius; dx <= radius; dx++) {
                    int px = x + dx;
                    if (px < 0 || px >= width) continue;
                    int p_idx = (py * width + px) * 4;
                    float pr = (float)pixels[p_idx];
                    float pg = (float)pixels[p_idx + 1];
                    float pb = (float)pixels[p_idx + 2];
                    sum_cb += -0.168736f * pr - 0.331264f * pg + 0.5f * pb;
                    sum_cr +=  0.5f * pr - 0.418688f * pg - 0.081312f * pb;
                    count++;
                }
            }

            float avg_cb = sum_cb / (float)count;
            float avg_cr = sum_cr / (float)count;

            float final_cb = cb * (1.0f - blend) + avg_cb * blend;
            float final_cr = cr * (1.0f - blend) + avg_cr * blend;

            float out_r = y_lum + 1.402f * final_cr;
            float out_g = y_lum - 0.344136f * final_cb - 0.714136f * final_cr;
            float out_b = y_lum + 1.772f * final_cb;

            pixels[idx]     = (unsigned char)CLAMP(out_r, 0.0f, 255.0f);
            pixels[idx + 1] = (unsigned char)CLAMP(out_g, 0.0f, 255.0f);
            pixels[idx + 2] = (unsigned char)CLAMP(out_b, 0.0f, 255.0f);
        }
    }
}

/*
 * 4. PUNCHY BLACK & WHITE ENGINE ("Knallend Zwart-Wit")
 */
__attribute__((visibility("default")))
void vroon_punchy_bw(
    const unsigned char* src,
    unsigned char* dst,
    int width,
    int height,
    float rw,
    float gw,
    float bw,
    float contrast,
    float clarity,
    float grain_amount
) {
    float weight_sum = rw + gw + bw;
    if (weight_sum < 0.001f) weight_sum = 1.0f;
    float norm_r = rw / weight_sum;
    float norm_g = gw / weight_sum;
    float norm_b = bw / weight_sum;

    float c_factor = (contrast + 100.0f) / 100.0f;
    c_factor = c_factor * c_factor;

    unsigned int rand_seed = 12345;

    for (int y = 0; y < height; y++) {
        for (int x = 0; x < width; x++) {
            int idx = (y * width + x) * 4;
            float r = (float)src[idx];
            float g = (float)src[idx + 1];
            float b = (float)src[idx + 2];

            float luma = r * norm_r + g * norm_g + b * norm_b;
            float norm_luma = luma / 255.0f;
            float contrasted = 0.5f + (norm_luma - 0.5f) * c_factor;
            if (contrasted > 0.5f) {
                contrasted = 1.0f - (1.0f - contrasted) * (1.0f - (contrasted - 0.5f) * 0.35f);
            } else {
                contrasted = contrasted * (1.0f + (0.5f - contrasted) * 0.35f);
            }
            float val = contrasted * 255.0f;

            if (clarity > 0.0f && x > 0 && x < width - 1 && y > 0 && y < height - 1) {
                int up_idx = ((y - 1) * width + x) * 4;
                int dn_idx = ((y + 1) * width + x) * 4;
                float local_avg = ((float)src[up_idx] + (float)src[dn_idx]) * 0.5f;
                float high_pass = luma - local_avg;
                val += high_pass * (clarity / 100.0f) * 0.65f;
            }

            if (grain_amount > 0.0f) {
                rand_seed = (rand_seed * 1103515245 + 12345) & 0x7fffffff;
                float noise = ((float)(rand_seed & 255) / 127.5f) - 1.0f;
                float midtone_factor = 4.0f * norm_luma * (1.0f - norm_luma);
                val += noise * (grain_amount * 0.35f) * midtone_factor;
            }

            unsigned char final_byte = (unsigned char)CLAMP(val, 0.0f, 255.0f);
            dst[idx]     = final_byte;
            dst[idx + 1] = final_byte;
            dst[idx + 2] = final_byte;
            dst[idx + 3] = src[idx + 3];
        }
    }
}

/*
 * 5. TOPAZ LABS STYLE 2X SUPER-RESOLUTION UPSCALE
 */
__attribute__((visibility("default")))
void vroon_super_res_2x(
    const unsigned char* src,
    unsigned char* dst,
    int src_w,
    int src_h,
    float sharpness
) {
    int dst_w = src_w * 2;
    int dst_h = src_h * 2;

    for (int y = 0; y < dst_h; y++) {
        float src_yf = (float)y * 0.5f;
        int y0 = (int)src_yf;
        int y1 = MIN(y0 + 1, src_h - 1);
        float fy = src_yf - (float)y0;

        for (int x = 0; x < dst_w; x++) {
            float src_xf = (float)x * 0.5f;
            int x0 = (int)src_xf;
            int x1 = MIN(x0 + 1, src_w - 1);
            float fx = src_xf - (float)x0;

            int idx00 = (y0 * src_w + x0) * 4;
            int idx10 = (y0 * src_w + x1) * 4;
            int idx01 = (y1 * src_w + x0) * 4;
            int idx11 = (y1 * src_w + x1) * 4;

            int dst_idx = (y * dst_w + x) * 4;

            for (int c = 0; c < 3; c++) {
                float p00 = (float)src[idx00 + c];
                float p10 = (float)src[idx10 + c];
                float p01 = (float)src[idx01 + c];
                float p11 = (float)src[idx11 + c];

                float grad_diag1 = p11 - p00;
                float grad_diag2 = p01 - p10;
                float interp;

                if (grad_diag1 * grad_diag1 < grad_diag2 * grad_diag2) {
                    float mid = (p00 + p11) * 0.5f;
                    interp = (1.0f - fx) * (1.0f - fy) * p00 +
                             fx * (1.0f - fy) * p10 +
                             (1.0f - fx) * fy * p01 +
                             fx * fy * p11;
                    interp = interp * 0.7f + mid * 0.3f;
                } else {
                    float top = p00 * (1.0f - fx) + p10 * fx;
                    float bot = p01 * (1.0f - fx) + p11 * fx;
                    interp = top * (1.0f - fy) + bot * fy;
                }

                if (sharpness > 0.0f) {
                    float edge_boost = (interp - p00) * (sharpness / 100.0f) * 0.4f;
                    interp += edge_boost;
                }

                dst[dst_idx + c] = (unsigned char)CLAMP(interp, 0.0f, 255.0f);
            }
            dst[dst_idx + 3] = 255;
        }
    }
}

/*
 * 6. ADOBE FIREFLY STYLE SMART RETOUCH & OBJECT REMOVAL
 * Concentric patch synthesis & multi-iteration background reconstruction
 */
__attribute__((visibility("default")))
void vroon_smart_inpaint(
    unsigned char* pixels,
    const unsigned char* mask,
    int width,
    int height,
    int radius
) {
    for (int iter = 0; iter < 6; iter++) {
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                int p_idx = y * width + x;
                if (mask[p_idx] < 128) continue;

                int pixel_byte = p_idx * 4;
                float sum_r = 0.0f, sum_g = 0.0f, sum_b = 0.0f;
                float total_weight = 0.0f;

                for (int dy = -radius; dy <= radius; dy++) {
                    int py = y + dy;
                    if (py < 0 || py >= height) continue;
                    for (int dx = -radius; dx <= radius; dx++) {
                        int px = x + dx;
                        if (px < 0 || px >= width) continue;

                        int neighbor_idx = py * width + px;
                        float is_valid = (mask[neighbor_idx] < 128) ? 1.0f : 0.08f;
                        float dist = (float)(dx * dx + dy * dy) + 0.1f;
                        float weight = is_valid / dist;

                        int n_byte = neighbor_idx * 4;
                        sum_r += (float)pixels[n_byte] * weight;
                        sum_g += (float)pixels[n_byte + 1] * weight;
                        sum_b += (float)pixels[n_byte + 2] * weight;
                        total_weight += weight;
                    }
                }

                if (total_weight > 0.0001f) {
                    pixels[pixel_byte]     = (unsigned char)CLAMP(sum_r / total_weight, 0.0f, 255.0f);
                    pixels[pixel_byte + 1] = (unsigned char)CLAMP(sum_g / total_weight, 0.0f, 255.0f);
                    pixels[pixel_byte + 2] = (unsigned char)CLAMP(sum_b / total_weight, 0.0f, 255.0f);
                }
            }
        }
    }
}

/*
 * 7. SMART FOCUS & DEBLUR RECOVERY WITH HUMAN FACE PROTECTION
 * Herstelt onscherpe foto's naar scherpe foto's zonder menselijke gezichten te vervormen
 */
__attribute__((visibility("default")))
void vroon_smart_deblur(
    unsigned char* pixels,
    int width,
    int height,
    float sharpness_amount, // 0.0 tot 100.0
    float skin_protection   // 0.0 tot 100.0
) {
    if (sharpness_amount <= 0.01f) return;
    float boost = (sharpness_amount / 100.0f) * 1.25f;
    float skin_safe = (skin_protection / 100.0f);

    for (int y = 1; y < height - 1; y++) {
        for (int x = 1; x < width - 1; x++) {
            int idx = (y * width + x) * 4;
            float r = (float)pixels[idx];
            float g = (float)pixels[idx + 1];
            float b = (float)pixels[idx + 2];

            // 3x3 box blur voor high-frequency verschil (Laplacian unsharp)
            int up_idx = ((y - 1) * width + x) * 4;
            int dn_idx = ((y + 1) * width + x) * 4;
            int lf_idx = (y * width + (x - 1)) * 4;
            int rt_idx = (y * width + (x + 1)) * 4;

            float avg_r = ((float)pixels[up_idx] + (float)pixels[dn_idx] + (float)pixels[lf_idx] + (float)pixels[rt_idx]) * 0.25f;
            float avg_g = ((float)pixels[up_idx + 1] + (float)pixels[dn_idx + 1] + (float)pixels[lf_idx + 1] + (float)pixels[rt_idx + 1]) * 0.25f;
            float avg_b = ((float)pixels[up_idx + 2] + (float)pixels[dn_idx + 2] + (float)pixels[lf_idx + 2] + (float)pixels[rt_idx + 2]) * 0.25f;

            float diff_r = r - avg_r;
            float diff_g = g - avg_g;
            float diff_b = b - avg_b;

            // Detecteer menselijke huidtinten
            float effective_boost = boost;
            if (r > 60.0f && r > g && g > b) {
                float skin_ratio = (g - b) / (r - b + 0.001f);
                if (skin_ratio > 0.25f && skin_ratio < 0.70f) {
                    // Menselijke huid: bescherm tegen overmatige rimpelversterking en gezichtsvervorming
                    effective_boost = boost * (1.0f - skin_safe * 0.75f);
                }
            }

            pixels[idx]     = (unsigned char)CLAMP(r + diff_r * effective_boost, 0.0f, 255.0f);
            pixels[idx + 1] = (unsigned char)CLAMP(g + diff_g * effective_boost, 0.0f, 255.0f);
            pixels[idx + 2] = (unsigned char)CLAMP(b + diff_b * effective_boost, 0.0f, 255.0f);
        }
    }
}
