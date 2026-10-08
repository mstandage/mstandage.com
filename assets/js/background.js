(() => {
  'use strict';

  const BACKGROUND_CONFIG = Object.freeze({
    colors: { violet: [0.38, 0.26, 0.65], blue: [0.2, 0.39, 0.67], teal: [0.22, 0.62, 0.56] },
    speed: 0.12,
    intensity: 0.65,
    interactionStrength: 0.035,
    maxPixelRatio: 1.5,
    maxResolution: 1600,
    mobileMaxResolution: 800,
    targetFramesPerSecond: 30
  });
  const canvas = document.getElementById('background-canvas');
  const button = document.querySelector('.motion-toggle');
  if (!canvas || !button) return;

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  const storageKey = 'mstandage-background-paused';
  let paused = false;
  try { paused = localStorage.getItem(storageKey) === 'true'; } catch {}
  let gl;
  let program;
  let buffer;
  let vertexShader;
  let fragmentShader;
  let uniforms;
  let frame = 0;
  let inView = true;
  let ready = false;
  let lost = false;
  let disposed = false;
  let elapsed = 0;
  let lastTime = 0;
  let lastDraw = 0;
  let pointer = [0, 0];
  let targetPointer = [0, 0];

  const vertexSource = `
    attribute vec2 position;
    void main() { gl_Position = vec4(position, 0.0, 1.0); }
  `;
  const fragmentSource = `
    precision mediump float;
    uniform vec2 resolution;
    uniform vec2 pointer;
    uniform float time;
    uniform float intensity;
    uniform float interactionStrength;
    uniform float detail;
    uniform vec3 violet;
    uniform vec3 blue;
    uniform vec3 teal;
    void main() {
      vec2 uv = gl_FragCoord.xy / resolution;
      vec2 point = uv + pointer * interactionStrength;
      float phase = time;
      float wave = sin(point.y * 5.0 + sin(point.x * 4.0 + phase) + phase * 0.6);
      float field = point.x + wave * 0.13;
      float ribbon = exp(-pow((field - 0.83) * 5.0, 2.0));
      float contour = 0.5 + 0.5 * sin(field * 25.0 + point.y * 6.0 - phase);
      if (detail > 0.5) {
        contour += 0.14 * sin(field * 48.0 + sin(point.y * 9.0 + phase));
      }
      vec3 color = mix(violet, blue, smoothstep(0.1, 0.8, point.y));
      color = mix(color, teal, smoothstep(0.5, 1.0, wave * 0.5 + 0.5));
      float edges = smoothstep(0.25, 0.95, uv.x);
      float luminosity = ribbon * (0.4 + contour * 0.35) * edges;
      vec3 base = vec3(0.063, 0.067, 0.075);
      gl_FragColor = vec4(base + color * luminosity * intensity, 1.0);
    }
  `;

  function updateButton() {
    button.setAttribute('aria-pressed', String(paused));
    const label = reducedMotion.matches ? 'Background animation disabled by reduced motion preference' :
      paused ? 'Resume background animation' : 'Pause background animation';
    button.querySelector('span').textContent = label;
    button.setAttribute('aria-label', label);
    button.disabled = reducedMotion.matches;
    button.setAttribute('title', label);
  }

  function compile(type, source) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Shader allocation failed');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      throw new Error('Shader compilation failed');
    }
    return shader;
  }

  function resize() {
    if (!ready || lost || disposed) return;
    const bounds = canvas.getBoundingClientRect();
    const smallDevice = bounds.width <= 700;
    const limit = smallDevice ? BACKGROUND_CONFIG.mobileMaxResolution : BACKGROUND_CONFIG.maxResolution;
    const ratio = Math.min(devicePixelRatio || 1, BACKGROUND_CONFIG.maxPixelRatio, limit / Math.max(bounds.width, bounds.height, 1));
    canvas.width = Math.max(1, Math.round(bounds.width * ratio));
    canvas.height = Math.max(1, Math.round(bounds.height * ratio));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
    gl.uniform1f(uniforms.detail, smallDevice ? 0 : 1);
    draw();
  }

  function draw() {
    if (!ready || lost || disposed) return;
    gl.uniform1f(uniforms.time, elapsed * BACKGROUND_CONFIG.speed);
    gl.uniform2f(uniforms.pointer, pointer[0], pointer[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function canAnimate() {
    return ready && !paused && !reducedMotion.matches && !document.hidden && inView && !lost && !disposed;
  }

  function tick(timestamp) {
    frame = 0;
    if (!canAnimate()) return;
    if (lastTime) elapsed += Math.min((timestamp - lastTime) / 1000, 0.1);
    lastTime = timestamp;
    if (timestamp - lastDraw >= 1000 / BACKGROUND_CONFIG.targetFramesPerSecond) {
      pointer = pointer.map((value, index) => value + (targetPointer[index] - value) * 0.06);
      draw();
      lastDraw = timestamp;
    }
    frame = requestAnimationFrame(tick);
  }

  function syncAnimation() {
    cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
    if (reducedMotion.matches) {
      elapsed = 0;
      pointer = targetPointer = [0, 0];
      draw();
    }
    if (canAnimate()) frame = requestAnimationFrame(tick);
    updateButton();
  }

  function releaseResources() {
    if (!gl || lost) return;
    if (program) gl.deleteProgram(program);
    if (buffer) gl.deleteBuffer(buffer);
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
    program = buffer = vertexShader = fragmentShader = null;
  }

  function initialize() {
    try {
      gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
      if (!gl) throw new Error('WebGL unavailable');
      vertexShader = compile(gl.VERTEX_SHADER, vertexSource);
      fragmentShader = compile(gl.FRAGMENT_SHADER, fragmentSource);
      program = gl.createProgram();
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Shader linking failed');
      gl.useProgram(program);
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'position');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      uniforms = Object.fromEntries(['resolution', 'pointer', 'time', 'intensity', 'interactionStrength', 'detail', 'violet', 'blue', 'teal'].map(name => [name, gl.getUniformLocation(program, name)]));
      for (const [name, color] of Object.entries(BACKGROUND_CONFIG.colors)) gl.uniform3fv(uniforms[name], color);
      gl.uniform1f(uniforms.intensity, BACKGROUND_CONFIG.intensity);
      gl.uniform1f(uniforms.interactionStrength, BACKGROUND_CONFIG.interactionStrength);
      ready = true;
      resize();
      canvas.classList.add('ready');
      button.hidden = false;
      syncAnimation();
    } catch {
      ready = false;
      cancelAnimationFrame(frame);
      releaseResources();
      canvas.classList.remove('ready');
      button.hidden = true;
    }
  }

  function onPointer(event) {
    if (!finePointer.matches || !canAnimate()) return;
    const bounds = canvas.getBoundingClientRect();
    targetPointer = [(event.clientX - bounds.left) / bounds.width - 0.5, 0.5 - (event.clientY - bounds.top) / bounds.height];
  }
  function onPointerLeave() { targetPointer = [0, 0]; }
  function onToggle() {
    paused = !paused;
    try { localStorage.setItem(storageKey, String(paused)); } catch {}
    syncAnimation();
  }
  function onContextLost(event) {
    event.preventDefault();
    ready = false;
    lost = true;
    cancelAnimationFrame(frame);
    canvas.classList.remove('ready');
    button.hidden = true;
  }
  function onContextRestored() {
    lost = false;
    initialize();
  }

  const opening = canvas.closest('.opening');
  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    inView = entries[0].isIntersecting;
    syncAnimation();
  }) : null;
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(opening);
  resizeObserver?.observe(canvas);
  window.addEventListener('resize', resize);
  opening.addEventListener('pointermove', onPointer, { passive: true });
  opening.addEventListener('pointerleave', onPointerLeave);
  button.addEventListener('click', onToggle);
  document.addEventListener('visibilitychange', syncAnimation);
  reducedMotion.addEventListener('change', syncAnimation);
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);
  window.addEventListener('pagehide', event => {
    if (event.persisted) { cancelAnimationFrame(frame); lastTime = 0; return; }
    disposed = true;
    cancelAnimationFrame(frame);
    observer?.disconnect();
    resizeObserver?.disconnect();
    window.removeEventListener('resize', resize);
    opening.removeEventListener('pointermove', onPointer);
    opening.removeEventListener('pointerleave', onPointerLeave);
    button.removeEventListener('click', onToggle);
    document.removeEventListener('visibilitychange', syncAnimation);
    reducedMotion.removeEventListener('change', syncAnimation);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    canvas.removeEventListener('webglcontextrestored', onContextRestored);
    releaseResources();
  });
  window.addEventListener('pageshow', event => { if (event.persisted) syncAnimation(); });
  initialize();
})();