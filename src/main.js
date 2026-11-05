import * as THREE from '../vendor/three.module.js';

/* ============================================================
   HOOKWING — a 2D flappy sky run, staged in 3D.
   Flap with the left side. Hold the right side to grapple.
   ============================================================ */

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const wrap = (v, n) => ((v % n) + n) % n;

const CFG = {
  gravity: -22.5,
  flap: 7.35,
  baseSpeed: 5.25,
  maxSpeed: 8.65,
  birdRadius: 0.37,
  bound: 5.4,
  gapStart: 5.95,
  gapMin: 4.55,
  maxParticles: 300,
};

const store = {
  get(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
  },
};

/* ---------------- audio ---------------- */

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.muted = Boolean(store.get('hookwing-muted', false));
    this.musicStarted = false;
    this.nextNote = 0;
    this.noteStep = 0;
  }

  ensure() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.62;
      this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.22;
      this.musicBus.connect(this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return true;
  }

  setMuted(muted) {
    this.muted = muted;
    store.set('hookwing-muted', muted);
    if (this.master && this.ctx) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(muted ? 0 : 0.62, now, 0.035);
    }
  }

  tone(freq, duration, { type = 'sine', volume = 0.12, slide = null, delay = 0, attack = 0.006 } = {}) {
    if (!this.ensure() || this.muted) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), t0);
    if (slide !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.025);
  }

  noise(duration = 0.16, volume = 0.1, frequency = 1200, delay = 0) {
    if (!this.ensure() || this.muted) return;
    const ctx = this.ctx;
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = frequency;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(filter).connect(gain).connect(this.master);
    source.start(ctx.currentTime + delay);
  }

  flap() {
    this.tone(310, 0.085, { type: 'triangle', volume: 0.09, slide: 540 });
    this.noise(0.06, 0.028, 2100);
  }

  start() {
    [392, 523.25, 659.25, 783.99].forEach((f, i) => {
      this.tone(f, 0.22, { type: 'triangle', volume: 0.08, delay: i * 0.075 });
    });
  }

  latch() {
    this.tone(620, 0.14, { type: 'sine', volume: 0.14, slide: 1180 });
    this.tone(1560, 0.12, { type: 'triangle', volume: 0.045, delay: 0.025 });
    this.noise(0.08, 0.035, 3200);
  }

  release() {
    this.tone(190, 0.18, { type: 'sawtooth', volume: 0.055, slide: 760 });
    this.noise(0.18, 0.045, 1000);
  }

  spark() {
    this.tone(880, 0.11, { type: 'sine', volume: 0.08, slide: 1320 });
    this.tone(1760, 0.09, { type: 'triangle', volume: 0.035, delay: 0.035 });
  }

  gate() {
    this.tone(523.25, 0.1, { type: 'triangle', volume: 0.055, slide: 659.25 });
  }

  hit() {
    this.noise(0.46, 0.22, 480);
    this.tone(132, 0.5, { type: 'sawtooth', volume: 0.15, slide: 38 });
    this.tone(74, 0.6, { type: 'sine', volume: 0.14, slide: 32 });
  }

  best() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      this.tone(f, 0.28, { type: 'triangle', volume: 0.075, delay: i * 0.1 });
    });
  }

  click() {
    this.tone(290, 0.06, { type: 'square', volume: 0.035, slide: 340 });
  }

  startMusic() {
    if (!this.ensure() || this.musicStarted) return;
    this.musicStarted = true;
    const ctx = this.ctx;
    const pad = ctx.createGain();
    pad.gain.value = 0.07;
    pad.connect(this.musicBus);
    [110, 164.81, 220].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = i === 1 ? 'triangle' : 'sine';
      osc.frequency.value = freq;
      osc.detune.value = i === 0 ? -7 : i === 2 ? 5 : 0;
      g.gain.value = i === 2 ? 0.23 : 0.36;
      osc.connect(g).connect(pad);
      osc.start();
    });
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.075;
    lfoGain.gain.value = 0.035;
    lfo.connect(lfoGain).connect(pad.gain);
    lfo.start();
    this.nextNote = ctx.currentTime + 0.25;
  }

  updateMusic(mode) {
    if (!this.ctx || !this.musicStarted || this.muted) return;
    if (mode === 'paused') return;
    const ctx = this.ctx;
    const notes = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 783.99, 659.25];
    const now = ctx.currentTime;
    while (this.nextNote < now + 0.18) {
      const step = this.noteStep++;
      if (step % 2 === 0 || Math.random() > 0.35) {
        const note = notes[(step * 3 + (mode === 'playing' ? 2 : 0)) % notes.length];
        this.tone(note, 0.22, {
          type: 'sine',
          volume: mode === 'playing' ? 0.018 : 0.012,
          delay: Math.max(0, this.nextNote - now),
        });
      }
      this.nextNote += 0.24;
    }
  }
}

const audio = new AudioEngine();

/* ---------------- renderer / scene ---------------- */

const canvas = $('#game-canvas');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x633b73, 24, 72);

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 160);
camera.position.set(2.8, 0.65, 18.6);

scene.add(new THREE.HemisphereLight(0xffc5b6, 0x2a1652, 1.25));
scene.add(new THREE.AmbientLight(0x6a5599, 0.38));

const sunLight = new THREE.DirectionalLight(0xffd3a6, 2.5);
sunLight.position.set(-7, 11, 13);
scene.add(sunLight);

const skyFill = new THREE.DirectionalLight(0x49dfff, 1.05);
skyFill.position.set(9, -4, 7);
scene.add(skyFill);

const rimLight = new THREE.DirectionalLight(0xff7d9c, 0.9);
rimLight.position.set(0, 6, -9);
scene.add(rimLight);

const view = { width: 20, height: 12.8, fraction: 0.36 };

function updateViewport() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(w, h, false);
  const aspect = w / h;
  const height = Math.max(12.8, 10.8 / Math.max(0.25, aspect));
  const width = height * aspect;
  view.height = height;
  view.width = width;
  view.fraction = width < 14 ? 0.32 : 0.36;
  camera.aspect = aspect;
  camera.fov = 38;
  const distance = (height / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.z = distance;
  camera.updateProjectionMatrix();
}

/* ---------------- procedural textures ---------------- */

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.16, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.42, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const glowTexture = makeGlowTexture();

function makeSkyTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 1024;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 1024);
  g.addColorStop(0, '#17103b');
  g.addColorStop(0.28, '#34205e');
  g.addColorStop(0.5, '#70417f');
  g.addColorStop(0.66, '#c85e83');
  g.addColorStop(0.79, '#ff8c72');
  g.addColorStop(0.92, '#ffbd7d');
  g.addColorStop(1, '#ffdda0');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 1024);
  const glow = ctx.createRadialGradient(350, 690, 0, 350, 690, 330);
  glow.addColorStop(0, 'rgba(255,230,170,0.5)');
  glow.addColorStop(0.32, 'rgba(255,166,126,0.2)');
  glow.addColorStop(1, 'rgba(255,120,100,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 512, 1024);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

scene.background = makeSkyTexture();

const sun = new THREE.Sprite(new THREE.SpriteMaterial({
  map: glowTexture,
  color: 0xff925c,
  transparent: true,
  opacity: 0.4,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  fog: false,
}));
sun.scale.set(13, 13, 1);
sun.position.set(7, 3.3, -31);
scene.add(sun);

const sunCore = new THREE.Sprite(new THREE.SpriteMaterial({
  map: glowTexture,
  color: 0xffd18a,
  transparent: true,
  opacity: 0.94,
  blending: THREE.NormalBlending,
  depthWrite: false,
  fog: false,
}));
sunCore.scale.set(3.35, 3.35, 1);
sunCore.position.set(7, 3.3, -30.8);
scene.add(sunCore);

/* ---------------- toon ramp + shared materials ---------------- */

const ramp = new Uint8Array([72, 156, 255]);
const gradientMap = new THREE.DataTexture(ramp, 3, 1, THREE.RedFormat);
gradientMap.minFilter = THREE.NearestFilter;
gradientMap.magFilter = THREE.NearestFilter;
gradientMap.generateMipmaps = false;
gradientMap.needsUpdate = true;

const birdMat = new THREE.MeshToonMaterial({ color: 0xff725c, gradientMap });
const birdLightMat = new THREE.MeshToonMaterial({ color: 0xffe7b8, gradientMap });
const wingMat = new THREE.MeshToonMaterial({ color: 0x27cbb8, gradientMap });
const wingDarkMat = new THREE.MeshToonMaterial({ color: 0x14988f, gradientMap });
const beakMat = new THREE.MeshToonMaterial({ color: 0xffc94d, gradientMap });
const eyeMat = new THREE.MeshBasicMaterial({ color: 0xfff9e9 });
const pupilMat = new THREE.MeshBasicMaterial({ color: 0x201334 });
const capMat = new THREE.MeshToonMaterial({ color: 0x2c2055, gradientMap });
const scarfMat = new THREE.MeshBasicMaterial({ color: 0xff6b57, side: THREE.DoubleSide });
const goldMat = new THREE.MeshStandardMaterial({
  color: 0xffca5c,
  emissive: 0xff872f,
  emissiveIntensity: 1.3,
  roughness: 0.26,
  metalness: 0.82,
});
const pipeMat = new THREE.MeshStandardMaterial({
  color: 0x168f8c,
  emissive: 0x06343d,
  emissiveIntensity: 0.9,
  roughness: 0.34,
  metalness: 0.5,
  flatShading: true,
});
const pipeEdgeMat = new THREE.LineBasicMaterial({
  color: 0x8bffe9,
  transparent: true,
  opacity: 0.22,
  depthWrite: false,
});
const crystalMat = new THREE.MeshStandardMaterial({
  color: 0x61ffe3,
  emissive: 0x1ecbb8,
  emissiveIntensity: 1.1,
  roughness: 0.3,
  metalness: 0.35,
});

/* ---------------- particles ---------------- */

const particlePositions = new Float32Array(CFG.maxParticles * 3);
const particleColors = new Float32Array(CFG.maxParticles * 3);
const particleSizes = new Float32Array(CFG.maxParticles);
const particleAlphas = new Float32Array(CFG.maxParticles);
const particles = [];

for (let i = 0; i < CFG.maxParticles; i++) {
  particles.push({
    active: false,
    x: 0, y: 0, z: 0,
    vx: 0, vy: 0, vz: 0,
    life: 0, maxLife: 1,
    size: 0.2,
    gravity: 0,
    drag: 1,
    color: new THREE.Color(0xffffff),
  });
}

const particleGeo = new THREE.BufferGeometry();
particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3).setUsage(THREE.DynamicDrawUsage));
particleGeo.setAttribute('aColor', new THREE.BufferAttribute(particleColors, 3).setUsage(THREE.DynamicDrawUsage));
particleGeo.setAttribute('aSize', new THREE.BufferAttribute(particleSizes, 1).setUsage(THREE.DynamicDrawUsage));
particleGeo.setAttribute('aAlpha', new THREE.BufferAttribute(particleAlphas, 1).setUsage(THREE.DynamicDrawUsage));

const particleMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
  vertexShader: `
    attribute float aSize;
    attribute float aAlpha;
    attribute vec3 aColor;
    varying float vAlpha;
    varying vec3 vColor;
    void main() {
      vAlpha = aAlpha;
      vColor = aColor;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = aSize * (300.0 / max(1.0, -mv.z));
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: `
    varying float vAlpha;
    varying vec3 vColor;
    void main() {
      float d = length(gl_PointCoord - vec2(0.5));
      float a = smoothstep(0.5, 0.05, d) * vAlpha;
      if (a < 0.008) discard;
      gl_FragColor = vec4(vColor, a);
    }
  `,
});

const particlePoints = new THREE.Points(particleGeo, particleMat);
particlePoints.frustumCulled = false;
scene.add(particlePoints);

let particleCursor = 0;

function emitParticles(x, y, z, count, options = {}) {
  const {
    color = 0xffd36a,
    color2 = null,
    speed = 2.6,
    spread = Math.PI * 2,
    angle = 0,
    size = 0.26,
    life = 0.55,
    gravity = 2.5,
    drag = 1.8,
    vz = 0.4,
  } = options;
  const c1 = new THREE.Color(color);
  const c2 = color2 === null ? c1 : new THREE.Color(color2);
  for (let i = 0; i < count; i++) {
    const p = particles[particleCursor++ % CFG.maxParticles];
    const a = angle + rand(-spread / 2, spread / 2);
    const s = rand(speed * 0.35, speed);
    p.active = true;
    p.x = x + rand(-0.08, 0.08);
    p.y = y + rand(-0.08, 0.08);
    p.z = z + rand(-0.08, 0.08);
    p.vx = Math.cos(a) * s;
    p.vy = Math.sin(a) * s;
    p.vz = rand(-vz, vz);
    p.life = p.maxLife = life * rand(0.72, 1.25);
    p.size = size * rand(0.6, 1.35);
    p.gravity = gravity;
    p.drag = drag;
    p.color.copy(Math.random() > 0.5 ? c1 : c2);
  }
}

function updateParticles(dt) {
  for (let i = 0; i < CFG.maxParticles; i++) {
    const p = particles[i];
    const i3 = i * 3;
    if (!p.active) {
      particleAlphas[i] = 0;
      continue;
    }
    p.life -= dt;
    if (p.life <= 0) {
      p.active = false;
      particleAlphas[i] = 0;
      continue;
    }
    const drag = Math.exp(-p.drag * dt);
    p.vx *= drag;
    p.vy *= drag;
    p.vz *= drag;
    p.vy -= p.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    const t = p.life / p.maxLife;
    particlePositions[i3] = p.x;
    particlePositions[i3 + 1] = p.y;
    particlePositions[i3 + 2] = p.z;
    particleColors[i3] = p.color.r;
    particleColors[i3 + 1] = p.color.g;
    particleColors[i3 + 2] = p.color.b;
    particleSizes[i] = p.size * (0.7 + (1 - t) * 0.9);
    particleAlphas[i] = Math.sin(Math.min(1, t * 2.2) * Math.PI * 0.5) * t;
  }
  particleGeo.attributes.position.needsUpdate = true;
  particleGeo.attributes.aColor.needsUpdate = true;
  particleGeo.attributes.aSize.needsUpdate = true;
  particleGeo.attributes.aAlpha.needsUpdate = true;
}

/* ---------------- bird ---------------- */

const bird = {
  group: new THREE.Group(),
  tilt: new THREE.Group(),
  x: 0,
  y: 0.35,
  vy: 0,
  wingPhase: 0,
  flapKick: 0,
  scarf: null,
  scarfPositions: null,
  nearWing: null,
  farWing: null,
  trailTimer: 0,
};

bird.group.position.set(0, 0.35, 0.42);
bird.group.add(bird.tilt);
scene.add(bird.group);

{
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.54, 18, 14), birdMat);
  body.scale.set(1.08, 0.98, 0.9);
  bird.tilt.add(body);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 10), birdLightMat);
  belly.scale.set(0.98, 0.8, 0.35);
  belly.position.set(0.18, -0.19, 0.4);
  bird.tilt.add(belly);

  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.43, 5), beakMat);
  beak.rotation.z = -Math.PI / 2;
  beak.position.set(0.67, -0.01, 0.02);
  bird.tilt.add(beak);

  const lowerBeak = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.27, 5), beakMat);
  lowerBeak.rotation.z = -Math.PI / 2;
  lowerBeak.position.set(0.63, -0.12, 0.02);
  lowerBeak.rotation.x = 0.15;
  bird.tilt.add(lowerBeak);

  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 10), eyeMat);
    eye.position.set(0.31, 0.16, side * 0.44);
    eye.scale.set(0.9, 1.08, 0.62);
    bird.tilt.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.077, 10, 8), pupilMat);
    pupil.position.set(0.365, 0.165, side * 0.535);
    bird.tilt.add(pupil);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6), eyeMat);
    glint.position.set(0.393, 0.205, side * 0.565);
    bird.tilt.add(glint);
    const goggle = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.026, 6, 18), goldMat);
    goggle.position.set(0.31, 0.16, side * 0.51);
    bird.tilt.add(goggle);
  }

  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.52),
    capMat,
  );
  cap.scale.set(1.03, 0.72, 0.95);
  cap.position.set(-0.02, 0.24, 0);
  cap.rotation.z = -0.16;
  bird.tilt.add(cap);

  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.055, 0.46), capMat);
  brim.position.set(0.24, 0.31, 0);
  brim.rotation.z = -0.1;
  bird.tilt.add(brim);

  const nearWingPivot = new THREE.Group();
  nearWingPivot.position.set(-0.02, 0.08, 0.4);
  const nearWing = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), wingMat);
  nearWing.scale.set(0.9, 0.24, 0.13);
  nearWing.position.set(-0.25, 0.02, 0);
  nearWingPivot.add(nearWing);
  bird.tilt.add(nearWingPivot);
  bird.nearWing = nearWingPivot;

  const farWingPivot = new THREE.Group();
  farWingPivot.position.set(-0.02, 0.08, -0.4);
  const farWing = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), wingDarkMat);
  farWing.scale.set(0.9, 0.24, 0.13);
  farWing.position.set(-0.25, 0.02, 0);
  farWingPivot.add(farWing);
  bird.tilt.add(farWingPivot);
  bird.farWing = farWingPivot;

  for (let i = 0; i < 3; i++) {
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.34, 4), i === 1 ? wingDarkMat : wingMat);
    tail.rotation.z = Math.PI / 2 + (i - 1) * 0.26;
    tail.position.set(-0.54, (i - 1) * 0.1, (i - 1) * 0.11);
    bird.tilt.add(tail);
  }

  const launcher = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.1, 0.34, 8), goldMat);
  launcher.rotation.z = Math.PI / 2 - 0.32;
  launcher.position.set(-0.2, 0.4, 0.14);
  bird.tilt.add(launcher);
  const launcherRing = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.026, 6, 12), goldMat);
  launcherRing.rotation.y = Math.PI / 2;
  launcherRing.position.set(-0.36, 0.46, 0.14);
  bird.tilt.add(launcherRing);

  const scarfSegments = 13;
  const scarfPositions = new Float32Array(scarfSegments * 2 * 3);
  const indices = [];
  for (let i = 0; i < scarfSegments - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const scarfGeo = new THREE.BufferGeometry();
  scarfGeo.setAttribute('position', new THREE.BufferAttribute(scarfPositions, 3).setUsage(THREE.DynamicDrawUsage));
  scarfGeo.setIndex(indices);
  const scarf = new THREE.Mesh(scarfGeo, scarfMat);
  scarf.frustumCulled = false;
  bird.tilt.add(scarf);
  bird.scarf = scarf;
  bird.scarfPositions = scarfPositions;
  bird.scarfSegments = scarfSegments;
}

function animateScarf(time, boost) {
  const positions = bird.scarfPositions;
  const n = bird.scarfSegments;
  const phase = time * (boost ? 12 : 6.5);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const width = 0.105 * (1 - t * 0.62);
    const x = -0.42 - t * (1.12 + boost * 0.32);
    const y = 0.03 + Math.sin(phase - i * 0.58) * (0.05 + t * 0.08) + t * 0.02;
    const z = 0.29 + Math.sin(phase * 0.6 - i * 0.3) * 0.05;
    const a = i * 6;
    positions[a] = x;
    positions[a + 1] = y + width;
    positions[a + 2] = z;
    positions[a + 3] = x;
    positions[a + 4] = y - width;
    positions[a + 5] = z;
  }
  bird.scarf.geometry.attributes.position.needsUpdate = true;
}

/* ---------------- backdrop ---------------- */

const cloudGeo = new THREE.SphereGeometry(1, 8, 6);
const cloudMaterials = [
  new THREE.MeshStandardMaterial({ color: 0xffc2bb, roughness: 1, metalness: 0, transparent: true, opacity: 0.78, depthWrite: false, flatShading: true }),
  new THREE.MeshStandardMaterial({ color: 0xd8b8ff, roughness: 1, metalness: 0, transparent: true, opacity: 0.7, depthWrite: false, flatShading: true }),
  new THREE.MeshStandardMaterial({ color: 0xffe2cf, roughness: 1, metalness: 0, transparent: true, opacity: 0.8, depthWrite: false, flatShading: true }),
];

const clouds = [];
for (let i = 0; i < 24; i++) {
  const group = new THREE.Group();
  const material = cloudMaterials[Math.floor(Math.random() * cloudMaterials.length)];
  const puffs = 3 + Math.floor(Math.random() * 4);
  for (let j = 0; j < puffs; j++) {
    const puff = new THREE.Mesh(cloudGeo, material);
    const s = rand(0.55, 1.35);
    puff.scale.set(s * rand(1, 1.6), s * rand(0.5, 0.8), s);
    puff.position.set(j * rand(0.45, 0.8) - puffs * 0.22, rand(-0.18, 0.18), rand(-0.35, 0.35));
    group.add(puff);
  }
  group.position.set(0, 0, -12);
  scene.add(group);
  clouds.push({
    group,
    baseX: rand(-100, 100),
    factor: rand(0.06, 0.34),
    span: 150,
    y: rand(-4.8, 6.8),
    z: rand(-9, -25),
    scale: rand(0.65, 1.55),
  });
}

const seaPuffs = [];
for (let i = 0; i < 20; i++) {
  const puff = new THREE.Mesh(cloudGeo, new THREE.MeshStandardMaterial({
    color: 0xffad9c,
    emissive: 0x7a315e,
    emissiveIntensity: 0.22,
    roughness: 1,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    flatShading: true,
  }));
  const s = rand(1.8, 4.4);
  puff.scale.set(s * rand(1.3, 2), s * rand(0.32, 0.52), s);
  scene.add(puff);
  seaPuffs.push({
    mesh: puff,
    baseX: rand(-90, 90),
    factor: rand(0.75, 1.15),
    span: 130,
    y: rand(-6.8, -5.7),
    z: rand(-5, 1.5),
  });
}

const ceilingPuffs = [];
for (let i = 0; i < 14; i++) {
  const puff = new THREE.Mesh(cloudGeo, new THREE.MeshStandardMaterial({
    color: 0x6e4b9c,
    emissive: 0x2a164e,
    emissiveIntensity: 0.3,
    roughness: 1,
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
    flatShading: true,
  }));
  const s = rand(1.5, 3.5);
  puff.scale.set(s * rand(1.2, 2.2), s * rand(0.24, 0.4), s);
  scene.add(puff);
  ceilingPuffs.push({
    mesh: puff,
    baseX: rand(-80, 80),
    factor: rand(0.8, 1.2),
    span: 120,
    y: rand(5.9, 7.2),
    z: rand(-6, 1),
  });
}

function updateBackdrop() {
  const cx = camera.position.x;
  sun.position.x = cx + view.width * 0.23;
  sunCore.position.x = sun.position.x;
  sun.position.y = 3.2;
  sunCore.position.y = 3.2;

  for (const c of clouds) {
    c.group.position.x = cx + wrap(c.baseX - cx * c.factor, c.span) - c.span / 2;
    c.group.position.y = c.y;
    c.group.position.z = c.z;
    c.group.scale.setScalar(c.scale);
  }
  for (const puff of seaPuffs) {
    puff.mesh.position.x = cx + wrap(puff.baseX - cx * puff.factor, puff.span) - puff.span / 2;
    puff.mesh.position.y = puff.y;
    puff.mesh.position.z = puff.z;
  }
  for (const puff of ceilingPuffs) {
    puff.mesh.position.x = cx + wrap(puff.baseX - cx * puff.factor, puff.span) - puff.span / 2;
    puff.mesh.position.y = puff.y;
    puff.mesh.position.z = puff.z;
  }
}

/* ---------------- world / gates ---------------- */

const pipeGeo = new THREE.CylinderGeometry(1.15, 1.15, 1, 8, 1, false);
const pipeEdgeGeo = new THREE.EdgesGeometry(pipeGeo);
const capGeo = new THREE.CylinderGeometry(1.39, 1.39, 0.34, 8);
const capEdgeGeo = new THREE.EdgesGeometry(capGeo);
const rimGeo = new THREE.TorusGeometry(1.28, 0.055, 6, 28);
const anchorRingGeo = new THREE.TorusGeometry(0.46, 0.07, 8, 26);
const anchorOuterGeo = new THREE.TorusGeometry(0.66, 0.018, 5, 30);
const anchorCoreGeo = new THREE.OctahedronGeometry(0.13, 0);
const jewelGeo = new THREE.OctahedronGeometry(0.13, 0);
const sparkGeo = new THREE.OctahedronGeometry(0.15, 0);
const sparkMat = new THREE.MeshStandardMaterial({
  color: 0xfff2b8,
  emissive: 0xffb63f,
  emissiveIntensity: 2.3,
  roughness: 0.2,
  metalness: 0.3,
  flatShading: true,
});
const sparkGlowMat = new THREE.SpriteMaterial({
  map: glowTexture,
  color: 0xffc75a,
  transparent: true,
  opacity: 0.7,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});

const gates = [];
const state = {
  mode: 'menu',
  score: 0,
  gatesPassed: 0,
  sparks: 0,
  swings: 0,
  speed: CFG.baseSpeed,
  lastGapY: 0.15,
  nextGateX: 9.5,
  time: 0,
  hintTimer: 0,
  deathTimer: 0,
  newBest: false,
  best: Number(store.get('hookwing-best', 0)) || 0,
  bestStats: store.get('hookwing-best-stats', null),
  scorePulseTimer: 0,
  startDelay: 0,
};

const grapple = {
  held: false,
  pointerId: null,
  anchor: null,
  length: 0,
  time: 0,
  cooldown: 0,
  nearest: null,
  ropeVisible: false,
};

function makeAnchor(localX, localY) {
  const group = new THREE.Group();
  group.position.set(localX, localY, 0.12);
  const material = goldMat.clone();
  material.emissiveIntensity = 1.9;
  const ring = new THREE.Mesh(anchorRingGeo, material);
  ring.rotation.z = rand(0, Math.PI);
  group.add(ring);
  const outer = new THREE.Mesh(anchorOuterGeo, material);
  outer.rotation.z = rand(0, Math.PI);
  group.add(outer);
  const core = new THREE.Mesh(anchorCoreGeo, sparkMat);
  group.add(core);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture,
    color: 0xffc65e,
    transparent: true,
    opacity: 0.46,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  glow.scale.set(2.25, 2.25, 1);
  group.add(glow);
  return {
    group,
    ring,
    outer,
    core,
    glow,
    material,
    used: false,
    baseLocalY: localY,
    phase: rand(0, Math.PI * 2),
    pulse: 0,
  };
}

function makeGate(x, gapY, gapSize) {
  const group = new THREE.Group();
  group.position.x = x;
  const gapTop = gapY + gapSize / 2;
  const gapBottom = gapY - gapSize / 2;
  const pillarHeight = 8.6;

  const top = new THREE.Mesh(pipeGeo, pipeMat);
  top.scale.set(1, pillarHeight, 0.66);
  top.position.y = gapTop + pillarHeight / 2;
  group.add(top);
  const topEdges = new THREE.LineSegments(pipeEdgeGeo, pipeEdgeMat);
  topEdges.scale.copy(top.scale);
  topEdges.position.copy(top.position);
  group.add(topEdges);

  const bottom = new THREE.Mesh(pipeGeo, pipeMat);
  bottom.scale.set(1, pillarHeight, 0.66);
  bottom.position.y = gapBottom - pillarHeight / 2;
  group.add(bottom);
  const bottomEdges = new THREE.LineSegments(pipeEdgeGeo, pipeEdgeMat);
  bottomEdges.scale.copy(bottom.scale);
  bottomEdges.position.copy(bottom.position);
  group.add(bottomEdges);

  for (const [edge, dir] of [[gapTop, 1], [gapBottom, -1]]) {
    const cap = new THREE.Mesh(capGeo, goldMat);
    cap.scale.z = 0.72;
    cap.position.y = edge + dir * 0.16;
    group.add(cap);
    const capEdges = new THREE.LineSegments(capEdgeGeo, pipeEdgeMat);
    capEdges.scale.copy(cap.scale);
    capEdges.position.copy(cap.position);
    group.add(capEdges);

    const rim = new THREE.Mesh(rimGeo, goldMat);
    rim.rotation.x = Math.PI / 2;
    rim.scale.z = 0.66;
    rim.position.y = edge - dir * 0.01;
    group.add(rim);

    const jewel = new THREE.Mesh(jewelGeo, crystalMat);
    jewel.position.set(0, edge + dir * 0.48, 0.82);
    jewel.rotation.z = Math.PI / 4;
    group.add(jewel);
  }

  const anchor = makeAnchor(-2.05, gapY + gapSize * 0.28);
  group.add(anchor.group);

  const sparks = [];
  const sparkOffsets = [-4.1, -2.85, -1.55];
  for (let i = 0; i < sparkOffsets.length; i++) {
    const localX = sparkOffsets[i];
    const localY = gapY + 0.12 + i * 0.52;
    const mesh = new THREE.Mesh(sparkGeo, sparkMat);
    mesh.position.set(localX, localY, 0.28);
    const glow = new THREE.Sprite(sparkGlowMat);
    glow.scale.set(1.05, 1.05, 1);
    glow.position.copy(mesh.position);
    group.add(mesh);
    group.add(glow);
    sparks.push({
      mesh,
      glow,
      localX,
      localY,
      baseY: localY,
      phase: rand(0, Math.PI * 2),
      collected: false,
      worldX: x + localX,
    });
  }

  scene.add(group);
  return {
    group,
    x,
    gapY,
    gapSize,
    gapTop,
    gapBottom,
    anchor,
    sparks,
    scored: false,
    passPulse: 0,
    index: gates.length,
  };
}

function gateSpacing() {
  return clamp(view.width * 0.52, 8.2, 10.6);
}

function spawnNextGate() {
  const gapSize = Math.max(CFG.gapMin, CFG.gapStart - state.gatesPassed * 0.023);
  const jitter = rand(-2.15, 2.15);
  const nextGap = clamp(state.lastGapY + jitter, -2.35, 2.35);
  state.lastGapY = nextGap;
  const gate = makeGate(state.nextGateX, nextGap, gapSize);
  gates.push(gate);
  state.nextGateX += gateSpacing() + rand(-0.5, 0.9);
  return gate;
}

function clearGates() {
  for (const gate of gates) {
    scene.remove(gate.group);
    gate.anchor.material.dispose();
    gate.anchor.glow.material.dispose();
  }
  gates.length = 0;
}

function populateGates() {
  let safety = 0;
  while (state.nextGateX < bird.x + Math.max(view.width * 0.9, 17) && safety++ < 20) {
    spawnNextGate();
  }
}

function resetWorld(forMenu = false) {
  releaseGrapple(false);
  clearGates();
  if (!forMenu) bird.group.scale.setScalar(1);
  bird.x = 0;
  bird.y = 0.35;
  bird.vy = 0;
  bird.tilt.rotation.set(0, 0, 0);
  bird.group.position.set(bird.x, bird.y, 0.42);
  state.score = 0;
  state.gatesPassed = 0;
  state.sparks = 0;
  state.swings = 0;
  state.speed = CFG.baseSpeed;
  state.lastGapY = forMenu ? 0.15 : rand(-0.7, 0.7);
  state.nextGateX = view.width < 14 ? 7.4 : 9.0;
  state.deathTimer = 0;
  state.hintTimer = 8;
  state.startDelay = 0;
  grapple.anchor = null;
  grapple.held = false;
  grapple.cooldown = 0;
  grapple.nearest = null;
  grapple.ropeVisible = false;
  rope.visible = false;
  hookMarker.classList.remove('visible', 'locked');
  clearParticles();
  populateGates();
  updateHUD();
  if (forMenu) {
    const menuFraction = view.width < 14 ? 0.73 : 0.58;
    camera.position.x = bird.x + (0.5 - menuFraction) * view.width;
  }
}

function clearParticles() {
  for (const p of particles) p.active = false;
  for (let i = 0; i < CFG.maxParticles; i++) particleAlphas[i] = 0;
  particleGeo.attributes.aAlpha.needsUpdate = true;
}

/* ---------------- rope / hook visuals ---------------- */

const ropePoints = 18;
const ropePositions = new Float32Array(ropePoints * 3);
const ropeGeo = new THREE.BufferGeometry();
ropeGeo.setAttribute('position', new THREE.BufferAttribute(ropePositions, 3).setUsage(THREE.DynamicDrawUsage));
const ropeMat = new THREE.LineBasicMaterial({
  color: 0xffdc80,
  transparent: true,
  opacity: 0.9,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const rope = new THREE.Line(ropeGeo, ropeMat);
rope.frustumCulled = false;
rope.visible = false;
scene.add(rope);

const ropeBeadsGeo = new THREE.BufferGeometry();
ropeBeadsGeo.setAttribute('position', new THREE.BufferAttribute(ropePositions, 3).setUsage(THREE.DynamicDrawUsage));
const ropeBeads = new THREE.Points(ropeBeadsGeo, new THREE.PointsMaterial({
  map: glowTexture,
  color: 0xffd469,
  size: 0.22,
  transparent: true,
  opacity: 0.78,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  sizeAttenuation: true,
}));
ropeBeads.frustumCulled = false;
ropeBeads.visible = false;
scene.add(ropeBeads);

function anchorWorld(anchor) {
  return {
    x: anchor.group.parent.position.x + anchor.group.position.x,
    y: anchor.group.position.y,
    z: anchor.group.position.z,
  };
}

function updateRope() {
  if (!grapple.anchor) {
    rope.visible = false;
    ropeBeads.visible = false;
    return;
  }
  const a = anchorWorld(grapple.anchor);
  const sx = bird.x + 0.05;
  const sy = bird.y + 0.3;
  const sz = 0.52;
  const dx = a.x - sx;
  const dy = a.y - sy;
  const dz = a.z - sz;
  const dist = Math.hypot(dx, dy, dz);
  const slack = Math.max(0, grapple.length - dist);
  for (let i = 0; i < ropePoints; i++) {
    const t = i / (ropePoints - 1);
    const sag = Math.sin(t * Math.PI) * slack * 0.45;
    const i3 = i * 3;
    ropePositions[i3] = sx + dx * t;
    ropePositions[i3 + 1] = sy + dy * t - sag;
    ropePositions[i3 + 2] = sz + dz * t;
  }
  ropeGeo.attributes.position.needsUpdate = true;
  ropeBeadsGeo.attributes.position.needsUpdate = true;
  rope.visible = true;
  ropeBeads.visible = true;
  ropeMat.opacity = 0.6 + Math.sin(state.time * 30) * 0.1;
}

/* ---------------- UI ---------------- */

const ui = {
  loading: $('#loading'),
  menu: $('#menu'),
  hud: $('#hud'),
  gameover: $('#gameover'),
  pause: $('#pause'),
  startBtn: $('#start-btn'),
  retryBtn: $('#retry-btn'),
  homeBtn: $('#home-btn'),
  resumeBtn: $('#resume-btn'),
  quitBtn: $('#quit-btn'),
  pauseBtn: $('#pause-btn'),
  soundBtn: $('#sound-btn'),
  menuSound: $('#menu-sound'),
  score: $('#score-value'),
  scoreBonus: $('#score-bonus'),
  runGates: $('#run-gates'),
  runSparks: $('#run-sparks'),
  menuBest: $('#menu-best'),
  menuGates: $('#menu-gates'),
  menuSparks: $('#menu-sparks'),
  menuSwings: $('#menu-swings'),
  finalScore: $('#final-score'),
  finalGates: $('#final-gates'),
  finalSparks: $('#final-sparks'),
  finalSwings: $('#final-swings'),
  finalBest: $('#final-best'),
  newBest: $('#new-best'),
  hookMarker: $('#hook-marker'),
  floatLayer: $('#float-layer'),
  hint: $('#hint'),
  flapBtn: $('#flap-btn'),
  hookBtn: $('#hook-btn'),
  hitFlash: $('#hit-flash'),
  toast: $('#toast'),
  grappleReadout: $('#grapple-readout'),
};

const hookMarker = ui.hookMarker;

function updateSoundButtons() {
  for (const button of [ui.soundBtn, ui.menuSound]) {
    button.classList.toggle('muted', audio.muted);
    button.setAttribute('aria-pressed', String(audio.muted));
    button.setAttribute('aria-label', audio.muted ? 'Unmute sound' : 'Mute sound');
  }
}

function updateHUD() {
  ui.score.textContent = String(state.score);
  ui.runGates.textContent = String(state.gatesPassed);
  ui.runSparks.textContent = String(state.sparks);
  ui.menuBest.textContent = String(state.best);
  if (state.bestStats) {
    ui.menuGates.textContent = String(state.bestStats.gates ?? 0);
    ui.menuSparks.textContent = String(state.bestStats.sparks ?? 0);
    ui.menuSwings.textContent = String(state.bestStats.swings ?? 0);
  }
}

function pulseScore(amount) {
  ui.score.classList.remove('pop');
  void ui.score.offsetWidth;
  ui.score.classList.add('pop');
  if (amount > 1) {
    ui.scoreBonus.textContent = `+${amount}`;
    ui.scoreBonus.classList.remove('show');
    void ui.scoreBonus.offsetWidth;
    ui.scoreBonus.classList.add('show');
  }
}

function addScore(amount, label = '', worldPos = null) {
  state.score += amount;
  updateHUD();
  pulseScore(amount);
  if (label) floatText(worldPos || { x: bird.x + 0.7, y: bird.y + 0.7, z: 0.5 }, label, amount >= 3 ? '' : 'teal');
}

function floatText(position, text, className = '') {
  const v = new THREE.Vector3(position.x, position.y, position.z ?? 0.5).project(camera);
  let x = (v.x * 0.5 + 0.5) * window.innerWidth;
  let y = (-v.y * 0.5 + 0.5) * window.innerHeight;
  if (!Number.isFinite(x) || !Number.isFinite(y) || v.z > 1) {
    x = window.innerWidth * 0.5;
    y = window.innerHeight * 0.46;
  }
  const el = document.createElement('div');
  el.className = `float-text ${className}`.trim();
  el.textContent = text;
  el.style.left = `${clamp(x, 20, window.innerWidth - 20)}px`;
  el.style.top = `${clamp(y, 60, window.innerHeight - 80)}px`;
  ui.floatLayer.appendChild(el);
  window.setTimeout(() => el.remove(), 950);
}

let toastTimer = 0;
function showToast(text, duration = 1500) {
  ui.toast.textContent = text;
  ui.toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => ui.toast.classList.remove('show'), duration);
}

function flashHit() {
  ui.hitFlash.classList.remove('flash');
  void ui.hitFlash.offsetWidth;
  ui.hitFlash.classList.add('flash');
}

function showScreen(el) {
  el.classList.remove('is-hidden');
}

function hideScreen(el) {
  el.classList.add('is-hidden');
}

/* ---------------- game flow ---------------- */

function startGame() {
  audio.ensure();
  audio.startMusic();
  audio.start();
  bird.group.scale.setScalar(1);
  resetWorld(false);
  state.mode = 'playing';
  state.startDelay = 0.22;
  hideScreen(ui.menu);
  hideScreen(ui.gameover);
  hideScreen(ui.pause);
  showScreen(ui.hud);
  ui.hint.classList.remove('fade');
  updateSoundButtons();
  updateHUD();
  audio.click();
}

function showMenu() {
  state.mode = 'menu';
  resetWorld(true);
  showScreen(ui.menu);
  hideScreen(ui.hud);
  hideScreen(ui.gameover);
  hideScreen(ui.pause);
  ui.hint.classList.add('fade');
  hookMarker.classList.remove('visible', 'locked');
  updateHUD();
}

function pauseGame() {
  if (state.mode !== 'playing') return;
  state.mode = 'paused';
  grapple.held = false;
  releaseGrapple(false);
  showScreen(ui.pause);
  hookMarker.classList.remove('visible', 'locked');
  audio.click();
}

function resumeGame() {
  if (state.mode !== 'paused') return;
  state.mode = 'playing';
  hideScreen(ui.pause);
  audio.click();
}

function quitToMenu() {
  audio.click();
  showMenu();
}

function die(reason = 'hit') {
  if (state.mode !== 'playing') return;
  state.mode = 'dying';
  state.deathTimer = 0;
  grapple.held = false;
  releaseGrapple(false);
  bird.vy = reason === 'bound' ? -1 : 3.4;
  state.speed *= 0.55;
  flashHit();
  shake = 1.25;
  audio.hit();
  emitParticles(bird.x, bird.y, 0.5, 28, {
    color: 0xff725c,
    color2: 0xffe0a2,
    speed: 5.5,
    size: 0.36,
    life: 0.8,
    gravity: 5,
  });
  hookMarker.classList.remove('visible', 'locked');
  ui.hint.classList.add('fade');
  ui.grappleReadout.classList.remove('show');
}

function finishGameOver() {
  state.mode = 'gameover';
  const isBest = state.score > state.best;
  if (isBest) {
    state.best = state.score;
    state.bestStats = {
      gates: state.gatesPassed,
      sparks: state.sparks,
      swings: state.swings,
    };
    store.set('hookwing-best', state.best);
    store.set('hookwing-best-stats', state.bestStats);
    audio.best();
  } else {
    audio.click();
  }
  state.newBest = isBest;
  ui.finalScore.textContent = String(state.score);
  ui.finalGates.textContent = String(state.gatesPassed);
  ui.finalSparks.textContent = String(state.sparks);
  ui.finalSwings.textContent = String(state.swings);
  ui.finalBest.textContent = String(state.best);
  ui.newBest.classList.toggle('is-hidden', !isBest);
  showScreen(ui.gameover);
  hideScreen(ui.hud);
  updateHUD();
}

function togglePause() {
  if (state.mode === 'playing') pauseGame();
  else if (state.mode === 'paused') resumeGame();
}

/* ---------------- gameplay helpers ---------------- */

function doFlap() {
  if (state.mode !== 'playing') return;
  if (grapple.anchor) return;
  // The first tap should always feel responsive, even on a slow device.
  state.startDelay = 0;
  bird.vy = CFG.flap;
  bird.flapKick = 1;
  bird.wingPhase = 0;
  emitParticles(bird.x - 0.15, bird.y - 0.28, 0.5, 7, {
    color: 0xffe6b1,
    color2: 0x36f0cd,
    speed: 2.4,
    angle: -Math.PI * 0.5,
    spread: Math.PI * 1.2,
    size: 0.2,
    life: 0.45,
    gravity: 2.8,
  });
  audio.flap();
}

function nearestAnchor() {
  let best = null;
  let bestScore = Infinity;
  for (const gate of gates) {
    const anchor = gate.anchor;
    if (anchor.used) continue;
    const wx = gate.x + anchor.group.position.x;
    const wy = anchor.group.position.y;
    const dx = wx - bird.x;
    const dy = wy - bird.y;
    if (dx < 0.75 || dx > 8.2) continue;
    const dist = Math.hypot(dx, dy);
    if (dist > 8.2) continue;
    const score = dist + Math.max(0, -dy) * 0.35;
    if (score < bestScore) {
      bestScore = score;
      best = anchor;
    }
  }
  return best;
}

function attachGrapple(anchor) {
  if (!anchor || anchor.used) return;
  const a = anchorWorld(anchor);
  const dist = Math.hypot(a.x - bird.x, a.y - bird.y);
  grapple.anchor = anchor;
  grapple.length = clamp(dist, 2.5, 5.2);
  grapple.time = 0;
  grapple.ropeVisible = true;
  grapple.cooldown = 0;
  anchor.used = true;
  anchor.pulse = 1;
  state.swings += 1;
  addScore(3, 'SWING +3', { x: a.x, y: a.y + 0.35, z: 0.5 });
  emitParticles(a.x, a.y, 0.4, 18, {
    color: 0xffd05b,
    color2: 0xfff4c6,
    speed: 3.8,
    size: 0.26,
    life: 0.55,
    gravity: 1.8,
  });
  emitParticles(bird.x, bird.y, 0.5, 10, {
    color: 0x36f0cd,
    color2: 0xffd05b,
    speed: 2.8,
    size: 0.22,
    life: 0.4,
    gravity: 1.2,
  });
  shake = Math.max(shake, 0.32);
  audio.latch();
}

function releaseGrapple(boost = true) {
  if (!grapple.anchor) {
    grapple.ropeVisible = false;
    return;
  }
  const anchor = grapple.anchor;
  const a = anchorWorld(anchor);
  grapple.anchor = null;
  grapple.ropeVisible = false;
  grapple.cooldown = 0.22;
  anchor.pulse = 0.6;
  if (boost && state.mode === 'playing') {
    const angle = Math.atan2(bird.y - a.y, bird.x - a.x);
    bird.vy += 2.5 + Math.max(0, Math.sin(angle)) * 1.4;
    state.speed = Math.min(CFG.maxSpeed, state.speed + 0.1);
    emitParticles(bird.x, bird.y, 0.55, 13, {
      color: 0x36f0cd,
      color2: 0xffe2a2,
      speed: 4.2,
      size: 0.24,
      life: 0.5,
      gravity: 2.2,
    });
    shake = Math.max(shake, 0.22);
    audio.release();
  }
  rope.visible = false;
  ropeBeads.visible = false;
}

function setGrappleHeld(held) {
  if (state.mode !== 'playing') {
    grapple.held = false;
    return;
  }
  if (held) {
    audio.ensure();
    grapple.held = true;
    if (!grapple.anchor && grapple.cooldown <= 0) {
      const anchor = nearestAnchor();
      if (anchor) attachGrapple(anchor);
    }
  } else {
    grapple.held = false;
    if (grapple.anchor) releaseGrapple(true);
  }
}

/* ---------------- camera ---------------- */

let shake = 0;

function updateCamera(dt) {
  let fraction = view.fraction;
  if (state.mode === 'menu') fraction = view.width < 14 ? 0.73 : 0.58;
  let targetX = bird.x + (0.5 - fraction) * view.width;
  if (state.mode === 'menu') targetX += Math.sin(state.time * 0.19) * 0.5;
  if (state.mode === 'gameover') targetX += 0.3;
  camera.position.x = damp(camera.position.x, targetX, state.mode === 'menu' ? 2.2 : 10, dt);
  const shakeAmount = shake * shake;
  const jitterX = (Math.random() - 0.5) * shakeAmount * 0.85;
  const jitterY = (Math.random() - 0.5) * shakeAmount * 0.85;
  camera.position.y = 0.62 + jitterY;
  camera.position.x += jitterX;
  camera.lookAt(camera.position.x, 0.15, 0);
  camera.rotateZ((Math.random() - 0.5) * shakeAmount * 0.018);
  shake = Math.max(0, shake - dt * 2.8);
}

/* ---------------- input ---------------- */

function bindHoldButton(button, down, up) {
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    audio.ensure();
    button.classList.add('pressed');
    try { button.setPointerCapture(event.pointerId); } catch { /* noop */ }
    down(event);
  });
  const release = (event) => {
    event.preventDefault();
    event.stopPropagation();
    button.classList.remove('pressed');
    up(event);
  };
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', () => {
    button.classList.remove('pressed');
    up(null);
  });
}

ui.startBtn.addEventListener('click', startGame);
ui.retryBtn.addEventListener('click', startGame);
ui.homeBtn.addEventListener('click', () => { audio.click(); showMenu(); });
ui.resumeBtn.addEventListener('click', resumeGame);
ui.quitBtn.addEventListener('click', quitToMenu);
ui.pauseBtn.addEventListener('click', togglePause);
for (const button of [ui.soundBtn, ui.menuSound]) {
  button.addEventListener('click', () => {
    audio.ensure();
    audio.setMuted(!audio.muted);
    updateSoundButtons();
    if (!audio.muted) audio.click();
  });
}

bindHoldButton(ui.flapBtn, () => doFlap(), () => {});
bindHoldButton(ui.hookBtn, (event) => {
  grapple.pointerId = event?.pointerId ?? null;
  setGrappleHeld(true);
}, (event) => {
  if (event && grapple.pointerId !== null && event.pointerId !== grapple.pointerId) return;
  grapple.pointerId = null;
  setGrappleHeld(false);
});

canvas.addEventListener('contextmenu', (event) => event.preventDefault());
canvas.addEventListener('pointerdown', (event) => {
  if (state.mode !== 'playing') return;
  event.preventDefault();
  audio.ensure();
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  if (x < rect.width * 0.54) {
    doFlap();
  } else {
    grapple.pointerId = event.pointerId;
    try { canvas.setPointerCapture(event.pointerId); } catch { /* noop */ }
    setGrappleHeld(true);
  }
});

window.addEventListener('pointerup', (event) => {
  if (grapple.pointerId !== null && event.pointerId === grapple.pointerId) {
    grapple.pointerId = null;
    setGrappleHeld(false);
  }
});
window.addEventListener('pointercancel', (event) => {
  if (grapple.pointerId !== null && event.pointerId === grapple.pointerId) {
    grapple.pointerId = null;
    setGrappleHeld(false);
  }
});

const keyDown = new Set();
window.addEventListener('keydown', (event) => {
  const key = event.code;
  if (['Space', 'ArrowUp', 'KeyW', 'ShiftLeft', 'ShiftRight', 'KeyK', 'KeyP', 'Escape', 'Enter', 'KeyM'].includes(key)) {
    event.preventDefault();
  }
  if (event.repeat) return;
  if (key === 'KeyM') {
    audio.ensure();
    audio.setMuted(!audio.muted);
    updateSoundButtons();
    return;
  }
  if (key === 'KeyP' || key === 'Escape') {
    if (state.mode === 'playing' || state.mode === 'paused') togglePause();
    return;
  }
  if (key === 'Enter') {
    if (state.mode === 'menu' || state.mode === 'gameover') startGame();
    return;
  }
  if (key === 'Space' || key === 'ArrowUp' || key === 'KeyW') {
    if (state.mode === 'menu' || state.mode === 'gameover') {
      startGame();
    } else if (state.mode === 'playing') {
      doFlap();
    }
    return;
  }
  if (key === 'ShiftLeft' || key === 'ShiftRight' || key === 'KeyK') {
    if (state.mode === 'playing') {
      keyDown.add(key);
      setGrappleHeld(true);
    }
  }
});

window.addEventListener('keyup', (event) => {
  const key = event.code;
  if (key === 'ShiftLeft' || key === 'ShiftRight' || key === 'KeyK') {
    keyDown.delete(key);
    if (keyDown.size === 0) setGrappleHeld(false);
  }
});

window.addEventListener('blur', () => {
  grapple.held = false;
  grapple.pointerId = null;
  releaseGrapple(false);
  if (state.mode === 'playing') pauseGame();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.mode === 'playing') pauseGame();
});

/* ---------------- simulation ---------------- */

function updateBirdVisual(dt) {
  const targetTilt = clamp(bird.vy * 0.043, -0.5, 0.5) + (grapple.anchor ? Math.sin(state.time * 8) * 0.02 : 0);
  bird.tilt.rotation.z = damp(bird.tilt.rotation.z, targetTilt, 9, dt);
  bird.tilt.rotation.x = damp(bird.tilt.rotation.x, clamp(-bird.vy * 0.012, -0.12, 0.12), 7, dt);
  bird.wingPhase += dt * (grapple.anchor ? 5 : 11 + Math.abs(bird.vy) * 0.5);
  const flap = Math.sin(bird.wingPhase) * (0.44 + bird.flapKick * 0.55);
  bird.nearWing.rotation.z = flap;
  bird.farWing.rotation.z = -flap * 0.85;
  bird.nearWing.rotation.x = Math.sin(bird.wingPhase * 0.5) * 0.12;
  bird.farWing.rotation.x = -bird.nearWing.rotation.x;
  bird.flapKick = Math.max(0, bird.flapKick - dt * 4.5);
  animateScarf(state.time, grapple.anchor ? 1 : 0);
  bird.group.position.set(bird.x, bird.y, 0.42);
}

function updatePlaying(dt) {
  if (state.startDelay > 0) {
    state.startDelay -= dt;
    bird.y = damp(bird.y, 0.35, 8, dt);
    bird.vy = 0;
    return;
  }

  state.speed = Math.min(CFG.maxSpeed, CFG.baseSpeed + state.gatesPassed * 0.045);
  bird.x += state.speed * dt;
  bird.vy += CFG.gravity * dt;
  bird.y += bird.vy * dt;

  if (grapple.anchor) {
    const a = anchorWorld(grapple.anchor);
    grapple.time += dt;
    grapple.length = Math.max(1.85, grapple.length - dt * 2.15);
    let dx = bird.x - a.x;
    let dy = bird.y - a.y;
    let dist = Math.hypot(dx, dy);
    if (dist < 0.001) dist = 0.001;
    if (dist > grapple.length) {
      const nx = dx / dist;
      const ny = dy / dist;
      bird.x = a.x + nx * grapple.length;
      bird.y = a.y + ny * grapple.length;
      const radial = state.speed * nx + bird.vy * ny;
      if (radial > 0) bird.vy -= radial * ny * 0.88;
      // a little tangential lift so the swing stays lively
      if (grapple.time < 0.8) bird.vy += 1.1 * dt;
    }
    if (grapple.time > 2.35) releaseGrapple(true);
  }

  // difficulty / gate upkeep
  populateGates();
  while (gates.length && gates[0].x < bird.x - 13) {
    const gate = gates.shift();
    if (grapple.anchor === gate.anchor) releaseGrapple(false);
    scene.remove(gate.group);
    gate.anchor.material.dispose();
    gate.anchor.glow.material.dispose();
  }

  for (const gate of gates) {
    if (!gate.scored && bird.x > gate.x + 0.9) {
      gate.scored = true;
      gate.passPulse = 1;
      state.gatesPassed += 1;
      addScore(1);
      audio.gate();
      emitParticles(gate.x + 0.8, gate.gapY, 0.5, 5, {
        color: 0x36f0cd,
        color2: 0xffd05b,
        speed: 1.9,
        size: 0.18,
        life: 0.4,
        gravity: 1.2,
      });
    }
    if (Math.abs(bird.x - gate.x) < 1.02 + CFG.birdRadius) {
      if (bird.y + CFG.birdRadius * 0.7 > gate.gapTop || bird.y - CFG.birdRadius * 0.7 < gate.gapBottom) {
        die('pipe');
        return;
      }
    }
  }

  // collect sparks
  for (const gate of gates) {
    for (const spark of gate.sparks) {
      if (spark.collected) continue;
      const wx = gate.x + spark.localX;
      const wy = spark.mesh.position.y;
      if (Math.hypot(bird.x - wx, bird.y - wy) < 0.66) {
        spark.collected = true;
        spark.mesh.visible = false;
        spark.glow.visible = false;
        state.sparks += 1;
        addScore(2, '+2', { x: wx, y: wy + 0.3, z: 0.5 });
        emitParticles(wx, wy, 0.55, 14, {
          color: 0xffd05b,
          color2: 0xfff4c6,
          speed: 3.1,
          size: 0.25,
          life: 0.55,
          gravity: 1.5,
        });
        audio.spark();
      }
    }
  }

  // world bounds
  if (bird.y > CFG.bound || bird.y < -CFG.bound) {
    die('bound');
    return;
  }

  // speed trail
  bird.trailTimer -= dt;
  if (bird.trailTimer <= 0) {
    bird.trailTimer = 0.055;
    emitParticles(bird.x - 0.45, bird.y - 0.02, 0.45, 1, {
      color: 0x36f0cd,
      color2: 0xff8b73,
      speed: 0.7,
      angle: Math.PI,
      spread: 0.7,
      size: 0.14,
      life: 0.34,
      gravity: 0,
      drag: 2.4,
    });
  }
}

function updateDying(dt) {
  state.deathTimer += dt;
  bird.vy += CFG.gravity * 0.95 * dt;
  bird.y += bird.vy * dt;
  bird.x += state.speed * dt * 0.16;
  bird.tilt.rotation.z += dt * 5.8;
  bird.tilt.rotation.x += dt * 2.1;
  if (state.deathTimer > 1.15) finishGameOver();
}

function updateMenu(dt) {
  bird.group.scale.setScalar(damp(bird.group.scale.x, 1.24, 5, dt));
  bird.y = 0.35 + Math.sin(state.time * 1.65) * 0.14;
  bird.vy = Math.cos(state.time * 1.65) * 0.22;
  bird.x = 0;
}

function updateWorldVisuals(dt) {
  for (const gate of gates) {
    const a = gate.anchor;
    a.group.position.y = a.baseLocalY + Math.sin(state.time * 2.1 + a.phase) * 0.075;
    a.ring.rotation.z += dt * (a.used ? 0.5 : 1.35);
    a.outer.rotation.z -= dt * (a.used ? 0.2 : 0.75);
    a.core.rotation.y += dt * 2.4;
    a.core.rotation.x += dt * 1.5;
    a.pulse = Math.max(0, a.pulse - dt * 1.8);
    const targetIntensity = a.used ? 0.45 : 1.9;
    a.material.emissiveIntensity = damp(a.material.emissiveIntensity, targetIntensity, 5, dt) + a.pulse * 2;
    const s = 1 + Math.sin(state.time * 4.2 + a.phase) * 0.035 + a.pulse * 0.2;
    a.group.scale.setScalar(s);
    a.glow.material.opacity = a.used ? 0.12 : 0.42 + Math.sin(state.time * 3 + a.phase) * 0.09;
    if (gate.passPulse > 0) gate.passPulse = Math.max(0, gate.passPulse - dt * 2.6);

    for (const spark of gate.sparks) {
      if (spark.collected) continue;
      spark.mesh.rotation.y += dt * 2.2;
      spark.mesh.rotation.z += dt * 1.1;
      spark.mesh.position.y = spark.baseY + Math.sin(state.time * 2.6 + spark.phase) * 0.11;
      spark.glow.position.y = spark.mesh.position.y;
      spark.glow.material.opacity = 0.5 + Math.sin(state.time * 3.1 + spark.phase) * 0.12;
    }
  }
}

function updateHookUI() {
  if (state.mode !== 'playing') {
    hookMarker.classList.remove('visible', 'locked');
    ui.grappleReadout.classList.remove('show');
    return;
  }
  const target = grapple.anchor || nearestAnchor();
  grapple.nearest = target;
  if (!target) {
    hookMarker.classList.remove('visible', 'locked');
    ui.grappleReadout.classList.remove('show');
    return;
  }
  const a = anchorWorld(target);
  const v = new THREE.Vector3(a.x, a.y, a.z).project(camera);
  const x = (v.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
  const onScreen = x > -40 && x < window.innerWidth + 40 && y > -40 && y < window.innerHeight + 40 && v.z < 1;
  hookMarker.classList.toggle('visible', onScreen);
  hookMarker.classList.toggle('locked', Boolean(grapple.anchor) || grapple.held);
  hookMarker.style.left = `${x}px`;
  hookMarker.style.top = `${y}px`;
  ui.grappleReadout.classList.toggle('show', !grapple.anchor);
  if (!ui.grappleReadout.firstChild) ui.grappleReadout.innerHTML = '<span></span> HOOK READY';
}

/* ---------------- main loop ---------------- */

let lastTime = performance.now();
let frameCount = 0;

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.034, Math.max(0.001, (now - lastTime) / 1000));
  lastTime = now;
  state.time += dt;

  audio.updateMusic(state.mode);
  updateBackdrop();

  if (state.mode === 'menu') {
    updateMenu(dt);
    bird.tilt.rotation.z = damp(bird.tilt.rotation.z, Math.sin(state.time * 1.3) * 0.04, 4, dt);
    updateBirdVisual(dt);
  } else if (state.mode === 'playing') {
    updatePlaying(dt);
    if (state.mode === 'playing') {
      if (grapple.held && !grapple.anchor && grapple.cooldown <= 0) {
        const anchor = nearestAnchor();
        if (anchor) attachGrapple(anchor);
      }
      grapple.cooldown = Math.max(0, grapple.cooldown - dt);
    }
    updateBirdVisual(dt);
  } else if (state.mode === 'dying') {
    updateDying(dt);
    updateBirdVisual(dt);
  } else if (state.mode === 'gameover') {
    bird.vy = 0;
    bird.tilt.rotation.z = damp(bird.tilt.rotation.z, 0.2, 2, dt);
    updateBirdVisual(dt);
  } else if (state.mode === 'paused') {
    updateBirdVisual(0);
  }

  updateWorldVisuals(dt);
  updateParticles(dt);
  updateRope();
  updateCamera(dt);
  updateHookUI();

  // hint fade
  if (state.mode === 'playing') {
    state.hintTimer -= dt;
    if (state.hintTimer < 1.5) ui.hint.classList.add('fade');
    if (state.hintTimer <= 0) ui.hint.classList.add('fade');
  }

  // hook button active state
  ui.hookBtn.classList.toggle('pressed', Boolean(grapple.anchor));

  if (frameCount === 0) {
    ui.loading.classList.add('done');
    window.setTimeout(() => ui.loading.remove(), 800);
  }
  frameCount++;

  renderer.render(scene, camera);
}

/* ---------------- boot ---------------- */

updateViewport();
updateSoundButtons();
resetWorld(true);
showMenu();
updateHUD();
window.addEventListener('resize', () => {
  updateViewport();
  populateGates();
});
document.addEventListener('gesturestart', (event) => event.preventDefault());

window.__HOOKWING__ = {
  state,
  bird,
  gates,
  grapple,
  camera,
  scene,
  renderer,
  startGame,
  showMenu,
  die,
  jumpTo(x = 0, y = 0.35) {
    if (state.mode === 'menu' || state.mode === 'gameover') startGame();
    state.startDelay = 0;
    bird.x = x;
    bird.y = y;
    bird.vy = 0;
    camera.position.x = x + (0.5 - view.fraction) * view.width;
  },
  setGrappleHeld,
  get best() { return state.best; },
};

requestAnimationFrame(animate);
