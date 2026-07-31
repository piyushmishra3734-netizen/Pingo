import type { FilterDefinition, FilterInstance, FilterParam } from '@pingo/core';

/**
 * The filter chain, in WebGL2.
 *
 * ## Why this is written rather than imported
 *
 * GPUImage3 is the reference for this design and it **cannot run here**: it is
 * Swift and Metal, iOS and macOS only, with no web distribution of any kind.
 * What is portable is its *architecture* - a directed chain of single-pass
 * shaders, each reading the previous output - and its shaders, which are
 * BSD-3-Clause and so may be adapted with attribution.
 *
 * So this file is the chain runner, and `filters/` holds shaders adapted from
 * GPUImage3 (BSD-3-Clause), glfx.js (MIT) and PixiJS filters (MIT), each
 * recorded in `ATTRIBUTIONS.md`. Nothing here is invented where something
 * proven exists.
 *
 * ## Ping-pong
 *
 * Two framebuffers, swapped every pass. A chain of any length needs exactly two
 * textures - allocating one per filter is the usual first mistake and it runs
 * a device out of memory at about eight passes.
 *
 * The last pass renders to the canvas instead of a framebuffer, so there is no
 * final blit.
 */

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  // A full-screen triangle pair from clip space; UVs follow directly.
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

/**
 * The contract every filter shader is compiled into.
 *
 * A filter supplies only the body of `pingoFilter`, so it cannot get the
 * boilerplate wrong and every filter automatically gains intensity blending.
 */
function buildFragmentShader(body: string, params: FilterParam[] = []): string {
  /*
   * The filter's own parameters - declared here only if the body has not
   * already declared them itself.
   *
   * Both styles exist in `filters/`. Most shaders declare their own uniforms;
   * Bloom did not, so `radius` and `threshold` compiled against no such
   * identifiers, the program failed to link, and `filterStill` caught it and
   * handed back the unfiltered original. That is why Bloom appeared to be the
   * one filter that did not corrupt the picture: it was the one filter doing
   * nothing at all, and being untouched was the symptom.
   *
   * Declaring them unconditionally fixed Bloom and broke everything else with
   * `'amount' : redefinition`. So the body is asked first. One declaration
   * either way, and a filter can be written in either style without having to
   * know which this file prefers.
   */
  const alreadyDeclared = new Set(
    [...body.matchAll(/uniform\s+\w+\s+(\w+)\s*;/g)].map((match) => match[1]),
  );

  const declarations = params
    .filter((param) => !alreadyDeclared.has(param.name))
    .map((param) => `uniform float ${param.name};`)
    .join('\n');

  return `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform sampler2D u_mask;
uniform vec2 u_resolution;
uniform float u_intensity;
uniform float u_time;
${declarations}

${body}

void main() {
  vec4 original = texture(u_texture, v_uv);
  vec4 filtered = pingoFilter(original, v_uv);
  // Uniform fade for every filter, so intensity never has to be hand-wired.
  fragColor = mix(original, filtered, clamp(u_intensity, 0.0, 1.0));
}`;
}

interface CompiledFilter {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

interface Target {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
}

export class GLPipeline {
  readonly #gl: WebGL2RenderingContext;
  readonly #canvas: HTMLCanvasElement;

  #vao: WebGLVertexArrayObject | null = null;
  #sourceTexture: WebGLTexture | null = null;
  #maskTexture: WebGLTexture | null = null;
  #targets: [Target, Target] | undefined;
  #size = { width: 0, height: 0 };

  /** Compiled lazily and kept - recompiling a shader per frame is the slow path. */
  readonly #programs = new Map<string, CompiledFilter>();

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      // The capture path reads pixels after drawing, which needs the buffer to
      // still hold them.
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
      alpha: false,
    });
    if (!gl) throw new Error('WebGL2 is not available.');

    this.#gl = gl;
    this.#canvas = canvas;
    this.#setupGeometry();
  }

  #setupGeometry(): void {
    const gl = this.#gl;

    // Two triangles covering clip space. The only geometry this renderer has.
    const positions = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

    this.#vao = gl.createVertexArray();
    gl.bindVertexArray(this.#vao);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);
  }

  #compile(filter: FilterDefinition): CompiledFilter {
    const existing = this.#programs.get(filter.id);
    if (existing) return existing;

    const gl = this.#gl;
    const program = gl.createProgram();

    const vertex = this.#shader(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = this.#shader(gl.FRAGMENT_SHADER, buildFragmentShader(filter.fragmentShader, filter.params));

    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    // Bound before linking so every program agrees on attribute 0.
    gl.bindAttribLocation(program, 0, 'a_position');
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Filter "${filter.id}" failed to link: ${log}`);
    }

    // The shaders are linked in; the objects themselves are no longer needed.
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);

    const uniforms: Record<string, WebGLUniformLocation | null> = {
      u_texture: gl.getUniformLocation(program, 'u_texture'),
      u_mask: gl.getUniformLocation(program, 'u_mask'),
      u_resolution: gl.getUniformLocation(program, 'u_resolution'),
      u_intensity: gl.getUniformLocation(program, 'u_intensity'),
      u_time: gl.getUniformLocation(program, 'u_time'),
    };

    for (const param of filter.params ?? []) {
      uniforms[param.name] = gl.getUniformLocation(program, param.name);
    }

    const compiled = { program, uniforms };
    this.#programs.set(filter.id, compiled);
    return compiled;
  }

  #shader(type: number, source: string): WebGLShader {
    const gl = this.#gl;
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Could not create shader.');

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      // The line numbers in `log` are into the *assembled* shader, so the
      // source is included to make them meaningful.
      throw new Error(`Shader compile failed: ${log}\n\n${source}`);
    }
    return shader;
  }

  #texture(): WebGLTexture {
    const gl = this.#gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // CLAMP + LINEAR: video frames are not power-of-two and must not wrap, or
    // any filter that samples a neighbour smears the opposite edge inward.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return texture;
  }

  #resize(width: number, height: number): void {
    if (this.#size.width === width && this.#size.height === height && this.#targets) return;

    const gl = this.#gl;
    this.#size = { width, height };
    this.#canvas.width = width;
    this.#canvas.height = height;

    for (const target of this.#targets ?? []) {
      gl.deleteFramebuffer(target.framebuffer);
      gl.deleteTexture(target.texture);
    }

    const make = (): Target => {
      const texture = this.#texture();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        texture,
        0,
      );
      return { framebuffer, texture };
    };

    this.#targets = [make(), make()];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Uploads the current frame. Accepts anything the browser can texture from. */
  setSource(source: TexImageSource, width: number, height: number): void {
    const gl = this.#gl;
    this.#resize(width, height);

    this.#sourceTexture ??= this.#texture();
    gl.bindTexture(gl.TEXTURE_2D, this.#sourceTexture);
    // Video arrives top-down; GL samples bottom-up.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  /** The segmentation mask, for filters and effects that need person/background. */
  setMask(mask: TexImageSource | undefined): void {
    if (!mask) return;
    const gl = this.#gl;
    this.#maskTexture ??= this.#texture();
    gl.bindTexture(gl.TEXTURE_2D, this.#maskTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask);
  }

  /**
   * Runs the chain and leaves the result on the canvas.
   *
   * An empty chain still draws - through the passthrough filter - so the
   * preview never goes black just because no effect is selected.
   */
  render(chain: FilterInstance[], resolve: (id: string) => FilterDefinition | undefined): void {
    const gl = this.#gl;
    if (!this.#sourceTexture || !this.#targets) return;

    const passes = chain
      .map((instance) => ({ instance, filter: resolve(instance.filterId) }))
      .filter((pass): pass is { instance: FilterInstance; filter: FilterDefinition } =>
        Boolean(pass.filter),
      );

    gl.bindVertexArray(this.#vao);
    gl.viewport(0, 0, this.#size.width, this.#size.height);

    let input = this.#sourceTexture;

    passes.forEach((pass, index) => {
      const last = index === passes.length - 1;
      const target = this.#targets![index % 2]!;

      gl.bindFramebuffer(gl.FRAMEBUFFER, last ? null : target.framebuffer);

      const compiled = this.#compile(pass.filter);
      gl.useProgram(compiled.program);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, input);
      gl.uniform1i(compiled.uniforms['u_texture'] ?? null, 0);

      if (this.#maskTexture) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.#maskTexture);
        gl.uniform1i(compiled.uniforms['u_mask'] ?? null, 1);
      }

      gl.uniform2f(compiled.uniforms['u_resolution'] ?? null, this.#size.width, this.#size.height);
      gl.uniform1f(compiled.uniforms['u_intensity'] ?? null, pass.instance.intensity);
      gl.uniform1f(compiled.uniforms['u_time'] ?? null, performance.now() / 1000);

      for (const param of pass.filter.params ?? []) {
        const value = pass.instance.params?.[param.name] ?? param.default;
        gl.uniform1f(compiled.uniforms[param.name] ?? null, value);
      }

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      if (!last) input = target.texture;
    });

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.#gl;
    for (const { program } of this.#programs.values()) gl.deleteProgram(program);
    this.#programs.clear();

    for (const target of this.#targets ?? []) {
      gl.deleteFramebuffer(target.framebuffer);
      gl.deleteTexture(target.texture);
    }
    this.#targets = undefined;

    if (this.#sourceTexture) gl.deleteTexture(this.#sourceTexture);
    if (this.#maskTexture) gl.deleteTexture(this.#maskTexture);
    if (this.#vao) gl.deleteVertexArray(this.#vao);
  }
}
