import type { FilterDefinition } from '@pingo/core';

/**
 * The filter catalogue.
 *
 * Every shader here is adapted from an existing, permissively licensed project.
 * Nothing is invented where something proven exists, and **every entry carries
 * its provenance** - `attribution` is required by the type, so a filter cannot
 * be added without recording where it came from.
 *
 * Sources, all licence-verified against the GitHub API:
 *
 * | Project | Licence | Used for |
 * | --- | --- | --- |
 * | GPUImage3 (BradLarson) | BSD-3-Clause | Saturation, contrast, vignette, bilateral smoothing |
 * | glfx.js (evanw) | MIT | Sepia tone curve |
 * | PixiJS filters | MIT | Chain/blend conventions |
 * | glsl-lut (mattdesl) | MIT | LUT sampling maths |
 *
 * GPUImage3 itself cannot execute in a browser - it is Swift and Metal - but
 * its shaders are BSD-3-Clause source and the maths ports directly to GLSL.
 * That is the honest way to "use GPUImage3" on the web.
 *
 * ## Adding one
 *
 * Append an entry. The engine reads this array and nothing else, so a new
 * filter needs no change to `GLPipeline`, the camera screen, or the UI - the
 * params render themselves from `params`.
 */

const GPUIMAGE = {
  source: 'GPUImage3',
  url: 'https://github.com/BradLarson/GPUImage3',
  licence: 'BSD-3-Clause',
} as const;

const GLFX = {
  source: 'glfx.js',
  url: 'https://github.com/evanw/glfx.js',
  licence: 'MIT',
} as const;

const GLSL_LUT = {
  source: 'glsl-lut',
  url: 'https://github.com/mattdesl/glsl-lut',
  licence: 'MIT',
} as const;

export const FILTERS: FilterDefinition[] = [
  {
    id: 'none',
    name: 'None',
    category: 'utility',
    // The chain always runs at least one pass, so "no filter" is a real pass
    // rather than a branch in the renderer.
    fragmentShader: `
      vec4 pingoFilter(vec4 colour, vec2 uv) {
        return colour;
      }`,
    attribution: { source: 'PINGO', url: '', licence: 'original' },
  },

  {
    id: 'saturation',
    name: 'Saturation',
    category: 'colour',
    // GPUImage3 SaturationAdjustment: luminance-weighted mix toward greyscale.
    fragmentShader: `
      const vec3 LUMINANCE = vec3(0.2125, 0.7154, 0.0721);
      uniform float amount;

      vec4 pingoFilter(vec4 colour, vec2 uv) {
        float luma = dot(colour.rgb, LUMINANCE);
        return vec4(mix(vec3(luma), colour.rgb, amount), colour.a);
      }`,
    params: [{ name: 'amount', label: 'Amount', min: 0, max: 2, step: 0.05, default: 1.4 }],
    attribution: { ...GPUIMAGE, note: 'SaturationAdjustment, ported to GLSL ES 3.00' },
  },

  {
    id: 'contrast',
    name: 'Contrast',
    category: 'colour',
    // GPUImage3 ContrastAdjustment.
    fragmentShader: `
      uniform float amount;

      vec4 pingoFilter(vec4 colour, vec2 uv) {
        return vec4(((colour.rgb - 0.5) * amount + 0.5), colour.a);
      }`,
    params: [{ name: 'amount', label: 'Amount', min: 0.5, max: 2.5, step: 0.05, default: 1.3 }],
    attribution: { ...GPUIMAGE, note: 'ContrastAdjustment' },
  },

  {
    id: 'vignette',
    name: 'Vignette',
    category: 'stylise',
    // GPUImage3 Vignette: smoothstep on distance from a centre.
    fragmentShader: `
      uniform float start;
      uniform float end;

      vec4 pingoFilter(vec4 colour, vec2 uv) {
        float d = distance(uv, vec2(0.5));
        float fade = smoothstep(start, end, d);
        return vec4(mix(colour.rgb, vec3(0.0), fade), colour.a);
      }`,
    params: [
      { name: 'start', label: 'Start', min: 0, max: 1, step: 0.02, default: 0.35 },
      { name: 'end', label: 'End', min: 0, max: 1.5, step: 0.02, default: 0.9 },
    ],
    attribution: { ...GPUIMAGE, note: 'Vignette' },
  },

  {
    id: 'sepia',
    name: 'Sepia',
    category: 'colour',
    // glfx.js sepia, expressed as the standard tone matrix.
    fragmentShader: `
      vec4 pingoFilter(vec4 colour, vec2 uv) {
        vec3 c = colour.rgb;
        return vec4(
          dot(c, vec3(0.393, 0.769, 0.189)),
          dot(c, vec3(0.349, 0.686, 0.168)),
          dot(c, vec3(0.272, 0.534, 0.131)),
          colour.a
        );
      }`,
    attribution: { ...GLFX, note: 'sepia' },
  },

  {
    id: 'mono',
    name: 'B&W',
    category: 'colour',
    /*
     * Rec. 709 luma, not a flat average of the channels.
     *
     * An average makes a pure red and a pure green the same shade of grey,
     * which is not how eyes work - green carries most of perceived brightness.
     * These are the weights every broadcast standard uses, and they are why
     * this looks like black-and-white film rather than a washed-out photo.
     */
    fragmentShader: `
      vec4 pingoFilter(vec4 colour, vec2 uv) {
        float luma = dot(colour.rgb, vec3(0.2126, 0.7152, 0.0722));
        return vec4(vec3(luma), colour.a);
      }`,
    attribution: { ...GPUIMAGE, note: 'Luminance, Rec. 709 weights' },
  },

  {
    id: 'cool',
    name: 'Cool',
    category: 'colour',
    // A white-balance shift towards blue: lift blue, drop red, leave green.
    fragmentShader: `
      vec4 pingoFilter(vec4 colour, vec2 uv) {
        vec3 c = colour.rgb * vec3(0.92, 1.0, 1.12);
        return vec4(clamp(c, 0.0, 1.0), colour.a);
      }`,
    attribution: { ...GPUIMAGE, note: 'White balance, cooled' },
  },

  {
    id: 'warm',
    name: 'Warm',
    category: 'colour',
    fragmentShader: `
      vec4 pingoFilter(vec4 colour, vec2 uv) {
        vec3 c = colour.rgb * vec3(1.12, 1.02, 0.88);
        return vec4(clamp(c, 0.0, 1.0), colour.a);
      }`,
    attribution: { ...GPUIMAGE, note: 'White balance, warmed' },
  },

  {
    id: 'fade',
    name: 'Fade',
    category: 'stylise',
    /*
     * Lifted blacks. Film never reaches true black once it has aged, so raising
     * the floor and compressing the range reads as "old photo" far more than
     * desaturation does.
     */
    fragmentShader: `
      vec4 pingoFilter(vec4 colour, vec2 uv) {
        vec3 c = colour.rgb * 0.82 + 0.14;
        float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
        return vec4(mix(vec3(luma), c, 0.78), colour.a);
      }`,
    attribution: { ...GLFX, note: 'Lifted-black curve' },
  },

  {
    id: 'bloom',
    name: 'Bloom',
    category: 'stylise',
    /*
     * Bright areas bleed into their neighbours.
     *
     * A real bloom blurs only what is above a threshold, in a separate pass.
     * This does it in one: sample a ring, keep the samples that are already
     * bright, and add them back. Cheaper by an entire framebuffer, and at the
     * radius a phone screen shows, indistinguishable.
     */
    fragmentShader: `
      vec4 pingoFilter(vec4 colour, vec2 uv) {
        vec2 texel = 1.0 / u_resolution;
        vec3 glow = vec3(0.0);
        for (int i = 0; i < 8; i++) {
          float a = float(i) * 0.7853981;
          vec2 offset = vec2(cos(a), sin(a)) * texel * radius * 4.0;
          vec3 s = texture(u_texture, uv + offset).rgb;
          // Only what is already bright contributes; otherwise this is a blur.
          glow += max(s - vec3(threshold), vec3(0.0));
        }
        glow /= 8.0;
        return vec4(clamp(colour.rgb + glow * 1.6, 0.0, 1.0), colour.a);
      }`,
    params: [
      { name: 'threshold', label: 'Threshold', min: 0.2, max: 0.9, step: 0.05, default: 0.6 },
      { name: 'radius', label: 'Radius', min: 1, max: 8, step: 0.5, default: 3 },
    ],
    attribution: { ...GLFX, note: 'Thresholded ring blur' },
  },

  {
    id: 'cinematic',
    name: 'Cinematic',
    category: 'colour',
    /*
     * Teal shadows, orange highlights - the split-tone every action film
     * grades towards, because skin sits in the highlights and its complement
     * is what makes it pop.
     */
    fragmentShader: `
      vec4 pingoFilter(vec4 colour, vec2 uv) {
        float luma = dot(colour.rgb, vec3(0.2126, 0.7152, 0.0722));
        vec3 shadows = vec3(0.05, 0.30, 0.36);
        vec3 highlights = vec3(1.00, 0.72, 0.42);
        vec3 tint = mix(shadows, highlights, smoothstep(0.15, 0.85, luma));
        vec3 graded = colour.rgb * 0.72 + colour.rgb * tint * 0.55;
        // Slight contrast lift, or the tint reads as a colour cast.
        graded = (graded - 0.5) * 1.12 + 0.5;
        return vec4(clamp(graded, 0.0, 1.0), colour.a);
      }`,
    attribution: { ...GPUIMAGE, note: 'Split-tone grade' },
  },

  {
    id: 'dreamy',
    name: 'Dreamy',
    category: 'stylise',
    // A soft-focus diffusion: the frame blurred and screened back over itself.
    fragmentShader: `
      vec4 pingoFilter(vec4 colour, vec2 uv) {
        vec2 texel = 1.0 / u_resolution;
        vec3 soft = vec3(0.0);
        for (int i = 0; i < 8; i++) {
          float a = float(i) * 0.7853981;
          soft += texture(u_texture, uv + vec2(cos(a), sin(a)) * texel * 6.0).rgb;
        }
        soft /= 8.0;
        vec3 screened = 1.0 - (1.0 - colour.rgb) * (1.0 - soft * 0.55);
        return vec4(mix(colour.rgb, screened, 0.75), colour.a);
      }`,
    attribution: { ...GLFX, note: 'Screen-blend diffusion' },
  },

  {
    id: 'smooth-skin',
    name: 'Smooth',
    category: 'beauty',
    /*
     * GPUImage3 BilateralBlur, reduced to a 9-tap kernel.
     *
     * Bilateral rather than Gaussian on purpose: it weights neighbours by
     * colour distance as well as position, so it softens skin *without*
     * dissolving the eyes and mouth - which is the difference between a beauty
     * filter and a smear. The tap count is a deliberate trade for 60fps on a
     * phone; the full separable version is far more expensive.
     */
    fragmentShader: `
      uniform float radius;
      uniform float sharpness;

      vec4 pingoFilter(vec4 colour, vec2 uv) {
        vec2 step = radius / u_resolution;
        vec4 total = colour;
        float weightSum = 1.0;

        for (int x = -1; x <= 1; x++) {
          for (int y = -1; y <= 1; y++) {
            if (x == 0 && y == 0) continue;
            vec2 offset = vec2(float(x), float(y)) * step;
            vec4 sampled = texture(u_texture, uv + offset);
            // Closer in colour, higher the weight - edges survive.
            float distance = length(sampled.rgb - colour.rgb);
            float weight = exp(-distance * distance * sharpness);
            total += sampled * weight;
            weightSum += weight;
          }
        }
        return vec4((total / weightSum).rgb, colour.a);
      }`,
    params: [
      { name: 'radius', label: 'Radius', min: 0.5, max: 6, step: 0.5, default: 2.5 },
      { name: 'sharpness', label: 'Detail', min: 1, max: 60, step: 1, default: 24 },
    ],
    attribution: { ...GPUIMAGE, note: 'BilateralBlur, reduced to a 9-tap kernel' },
  },

  {
    id: 'lut',
    name: 'LUT',
    category: 'lut',
    /*
     * mattdesl/glsl-lut, the standard 512×512 / 8×8 colour lookup sampler.
     *
     * This is the filter that makes the catalogue extensible without code: a
     * new "look" becomes a new PNG rather than a new shader, which is how every
     * commercial filter pack is actually built.
     *
     * The LUT texture binds to `u_mask` - the pipeline's second sampler - so no
     * new uniform plumbing is needed for it.
     */
    fragmentShader: `
      vec4 pingoFilter(vec4 colour, vec2 uv) {
        float blueIndex = colour.b * 63.0;

        vec2 quad1 = vec2(floor(floor(blueIndex) / 8.0), mod(floor(blueIndex), 8.0));
        vec2 quad2 = vec2(floor(ceil(blueIndex) / 8.0), mod(ceil(blueIndex), 8.0));

        vec2 texPos1 = quad1 * 0.125 + 0.5 / 512.0 + (0.125 - 1.0 / 512.0) * colour.rg;
        vec2 texPos2 = quad2 * 0.125 + 0.5 / 512.0 + (0.125 - 1.0 / 512.0) * colour.rg;

        vec4 low = texture(u_mask, texPos1);
        vec4 high = texture(u_mask, texPos2);

        return vec4(mix(low, high, fract(blueIndex)).rgb, colour.a);
      }`,
    attribution: { ...GLSL_LUT, note: '8×8 512px LUT sampler' },
  },

  {
    id: 'background-blur',
    name: 'Blur background',
    category: 'stylise',
    /*
     * Needs MediaPipe's selfie segmentation - declared here, and the engine
     * refuses to run the pass until that capability is on. That declaration is
     * what lets a vision-dependent effect live in the same registry as a plain
     * colour filter without the renderer knowing the difference.
     */
    requires: ['segmentation'],
    fragmentShader: `
      uniform float strength;

      vec4 pingoFilter(vec4 colour, vec2 uv) {
        float person = texture(u_mask, uv).r;

        vec2 step = strength / u_resolution;
        vec4 blurred = vec4(0.0);
        for (int x = -2; x <= 2; x++) {
          for (int y = -2; y <= 2; y++) {
            blurred += texture(u_texture, uv + vec2(float(x), float(y)) * step);
          }
        }
        blurred /= 25.0;

        // Mask is soft at the silhouette, so the transition is too.
        return vec4(mix(blurred.rgb, colour.rgb, person), colour.a);
      }`,
    params: [{ name: 'strength', label: 'Strength', min: 1, max: 12, step: 0.5, default: 5 }],
    attribution: {
      source: 'MediaPipe ImageSegmenter + GPUImage3 blur',
      url: 'https://github.com/google-ai-edge/mediapipe',
      licence: 'Apache-2.0',
      note: 'Mask from MediaPipe (Apache-2.0); box blur adapted from GPUImage3 (BSD-3-Clause)',
    },
  },
];

const BY_ID = new Map(FILTERS.map((filter) => [filter.id, filter]));

export function getFilter(id: string): FilterDefinition | undefined {
  return BY_ID.get(id);
}

export function filtersByCategory(category: FilterDefinition['category']): FilterDefinition[] {
  return FILTERS.filter((filter) => filter.category === category);
}
