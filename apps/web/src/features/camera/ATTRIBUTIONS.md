# Camera system — third-party sources

Nothing in the camera is written from scratch where a proven implementation
exists. This file records what came from where, and under what licence.

Every licence below was verified against the GitHub API rather than assumed.

---

## In use

| Project | Licence | Used for |
| --- | --- | --- |
| [MediaPipe](https://github.com/google-ai-edge/mediapipe) | Apache-2.0 | Face mesh, blendshapes, hand tracking, gesture recognition, selfie segmentation |
| [GPUImage3](https://github.com/BradLarson/GPUImage3) | BSD-3-Clause | Saturation, contrast, vignette, bilateral smoothing — **shaders ported**, see below |
| [glfx.js](https://github.com/evanw/glfx.js) | MIT | Sepia tone matrix |
| [glsl-lut](https://github.com/mattdesl/glsl-lut) | MIT | 8×8 512px LUT sampling |
| [PixiJS filters](https://github.com/pixijs/filters) | MIT | Chain and blending conventions |

`@mediapipe/tasks-vision` is Google's own WebAssembly build and is used as-is —
the trackers are not reimplemented.

---

## GPUImage3 cannot run on the web

It is **Swift and Metal, iOS and macOS only**. There is no web build, no npm
package, and no WebAssembly port. Searching npm for it returns only abandoned
React Native wrappers of the older Objective-C GPUImage, last published in 2017.

Two things *are* portable, and both are used:

1. **Its architecture** — a directed chain of single-pass shaders, each reading
   the previous output. `engine/GLPipeline.ts` is that model in WebGL2.
2. **Its shaders** — BSD-3-Clause source, so the maths may be adapted with
   attribution. Each ported filter names the original in its `attribution`.

If PINGO ships a native iOS client, GPUImage3 can be used directly there, behind
the same `CameraEngine` interface in `@pingo/core`.

---

## FFmpeg: a licensing problem, flagged not solved

`@ffmpeg/ffmpeg` (the wrapper) is MIT. **`@ffmpeg/core` — the actual WASM build
— is GPL-2.0-or-later**, because the published build enables `--enable-gpl` and
libx264.

GPL is copyleft. Shipping it in PINGO would oblige PINGO to be GPL too, which
directly contradicts the requirement to prefer permissive licences.

So the packages are installed but **no GPL core is wired in**. Three ways
forward, in order of preference:

1. **`MediaRecorder`** — built into every browser, no licence at all, and
   sufficient for recording and basic compression. This is what the recorder
   should use.
2. **Build an LGPL core** — `ffmpeg.wasm` can be compiled without `--enable-gpl`.
   LGPL permits use in a proprietary app when dynamically linked.
3. **Server-side FFmpeg** — the GPL obligation does not extend to a client that
   merely calls a service.

---

## Not used, and why

| Project | Reason |
| --- | --- |
| [OpenCV](https://github.com/opencv/opencv) (Apache-2.0) | ~9 MB WASM, and MediaPipe already covers every tracking need here. The seam exists; add it when something genuinely needs classical CV |
| [LYGIA](https://github.com/patriciogonzalezvivo/lygia) | Licence is **not** permissive — free for personal and open-source use, commercial use requires a licence |
| [gl-transitions](https://github.com/gl-transitions/gl-transitions) | Repo licence resolves to `NOASSERTION`; individual transitions carry mixed per-file terms. Too ambiguous to ship without a file-by-file audit |

---

## Adding a filter

`filters/registry.ts` is the only file to touch. `attribution` is a required
field on `FilterDefinition`, so a shader cannot enter the catalogue without its
provenance — that is the mechanism keeping this document true, rather than good
intentions.
