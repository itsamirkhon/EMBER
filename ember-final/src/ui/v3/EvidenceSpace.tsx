/**
 * The evidence in 3D: every PSI microgravity test placed by oxygen (x, log scale), pressure (y) and gravity (z).
 * All tests sit on the 0 g plane, left of the evidence cliff; the cabins NASA plans for the Moon and Mars float
 * past the cliff at 1/6 g and 3/8 g. Same data as the 2D evidence map, drawn with three.js.
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Mission } from '../../core';
import { MISSION_SHORT, fmt, type Cliff, type Row } from './data';

export type SpaceStep = 0 | 1 | 2;

interface Props {
  rows: Row[];
  missions: Mission[];
  cliff: Cliff;
  step: SpaceStep;
  onPickMission?: (m: Mission) => void;
  onFail?: () => void;
}

const BOX = { x: 14, y: 6, z: 8 };
const KPA_MAX = 120;
const xOf = (o2: number) => (Math.log10(Math.min(100, Math.max(10, o2))) - 1) * BOX.x;
const yOf = (kPa: number) => (kPa / KPA_MAX) * BOX.y;
const zOf = (g: number) => -g * BOX.z;

const PHASE_COLOR: Record<string, string> = { solid: '#ecebe2', liquid: '#9fa99c', gas: '#908278' };
const CLIFF = '#a74c58';
const LINE = new THREE.Color('#777e70');

/** Camera stops for the three story steps: [position, target]. */
const VIEWS: Record<SpaceStep, [THREE.Vector3, THREE.Vector3]> = {
  0: [new THREE.Vector3(17, 11, 15), new THREE.Vector3(7, 2.4, -4)],
  1: [new THREE.Vector3(4.5, 4.8, 21), new THREE.Vector3(6.8, 2.8, -2)],
  2: [new THREE.Vector3(29, 9.5, 9), new THREE.Vector3(8.4, 2.4, -3.6)],
};
const START: THREE.Vector3 = new THREE.Vector3(26, 17, 30);

const VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aAlpha;
attribute float aSolid;
uniform float uOthers;
uniform float uScale;
uniform float uSize;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
  vColor = aColor;
  vAlpha = aAlpha * mix(uOthers, 1.0, aSolid);
}`;
const FRAG = /* glsl */ `
uniform float uOpacity;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.36, d);
  gl_FragColor = vec4(vColor, a * vAlpha * uOpacity);
}`;

function ringTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.strokeStyle = '#f1f0e8';
  g.lineWidth = 10;
  g.beginPath();
  g.arc(64, 64, 50, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#f1f0e8';
  g.beginPath();
  g.arc(64, 64, 14, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function line(points: THREE.Vector3[], color: THREE.Color | string, opacity: number, dashed = false): THREE.Line {
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = dashed
    ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.12, gapSize: 0.1, depthWrite: false })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  const l = new THREE.Line(geo, mat);
  if (dashed) l.computeLineDistances();
  return l;
}

interface Label { el: HTMLDivElement; pos: THREE.Vector3; kind: 'axis' | 'mission' | 'cliff'; }
interface Tip { x: number; y: number; title: string; lines: string[] }

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export default function EvidenceSpace({ rows, missions, cliff, step, onPickMission, onFail }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const stepRef = useRef<SpaceStep>(step);
  const goRef = useRef<((s: SpaceStep, instant?: boolean) => void) | null>(null);
  const pickRef = useRef(onPickMission);
  const [tip, setTip] = useState<Tip | null>(null);
  pickRef.current = onPickMission;

  useEffect(() => {
    stepRef.current = step;
    goRef.current?.(step);
  }, [step]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const labelLayer = labelsRef.current;
    if (!wrap || !labelLayer) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch {
      onFail?.();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor('#121411');
    wrap.prepend(renderer.domElement);
    // absolutely placed so the canvas never sizes its own container
    Object.assign(renderer.domElement.style, { display: 'block', position: 'absolute', left: '0', top: '0' });
    renderer.domElement.setAttribute('aria-hidden', 'true');

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog('#121411', 34, 70);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    camera.position.copy(reduced ? VIEWS[stepRef.current][0] : START);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.rotateSpeed = 0.6;
    // Continuous slow motion makes the source-derived evidence field spatially
    // legible. Honor reduced-motion, and stop orbiting when the visitor interacts.
    controls.autoRotate = !reduced;
    controls.autoRotateSpeed = 0.22;
    controls.addEventListener('start', () => { controls.autoRotate = false; });
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.target.copy(VIEWS[stepRef.current][1]);

    const disposables: { dispose: () => void }[] = [];
    const track = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);

    // ---------------------------------------------------------------- stars, far and faint
    {
      const n = 1400;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const u = Math.random() * 2 - 1;
        const t = Math.random() * Math.PI * 2;
        const r = 70 + Math.random() * 30;
        const s = Math.sqrt(1 - u * u);
        pos.set([r * s * Math.cos(t), r * u, r * s * Math.sin(t)], i * 3);
      }
      const geo = track(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = track(new THREE.PointsMaterial({ color: '#b4b7a7', size: 1.3, sizeAttenuation: false, transparent: true, opacity: 0.45, fog: false }));
      scene.add(new THREE.Points(geo, mat));
    }

    // ---------------------------------------------------------------- frame and grid
    const frame = new THREE.Group();
    scene.add(frame);
    const X = BOX.x, Y = BOX.y, Z = -BOX.z;
    const o2Ticks = [10, 15, 20, 30, 50, 100];
    const gTicks: [number, string][] = [[0, '0 g · orbit'], [0.166, '0.17 g · Moon'], [0.38, '0.38 g · Mars'], [1, '1 g · Earth']];
    for (const t of o2Ticks) frame.add(line([new THREE.Vector3(xOf(t), 0, 0), new THREE.Vector3(xOf(t), 0, Z)], LINE, 0.09));
    for (const [g] of gTicks) frame.add(line([new THREE.Vector3(0, 0, zOf(g)), new THREE.Vector3(X, 0, zOf(g))], LINE, g === 0 ? 0.3 : 0.12));
    for (const k of [40, 80, 120]) {
      frame.add(line([new THREE.Vector3(0, yOf(k), 0), new THREE.Vector3(0, yOf(k), Z)], LINE, 0.08));
      frame.add(line([new THREE.Vector3(0, yOf(k), 0), new THREE.Vector3(X, yOf(k), 0)], LINE, 0.1));
    }
    // box edges that read as axes
    frame.add(line([new THREE.Vector3(0, 0, 0), new THREE.Vector3(X, 0, 0)], LINE, 0.4));
    frame.add(line([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, Y, 0)], LINE, 0.4));
    frame.add(line([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, Z)], LINE, 0.4));
    frame.add(line([new THREE.Vector3(X, 0, 0), new THREE.Vector3(X, 0, Z)], LINE, 0.18));
    frame.add(line([new THREE.Vector3(0, Y, 0), new THREE.Vector3(0, Y, Z)], LINE, 0.12));
    frame.add(line([new THREE.Vector3(0, 0, Z), new THREE.Vector3(X, 0, Z)], LINE, 0.12));
    frame.add(line([new THREE.Vector3(0, 0, Z), new THREE.Vector3(0, Y, Z)], LINE, 0.12));
    // the 0 g plane where every test ran
    const orbitPlane = new THREE.Mesh(
      track(new THREE.PlaneGeometry(X, Y)),
      track(new THREE.MeshBasicMaterial({ color: '#6b7668', transparent: true, opacity: 0.035, depthWrite: false, side: THREE.DoubleSide })),
    );
    orbitPlane.position.set(X / 2, Y / 2, 0);
    frame.add(orbitPlane);

    // ---------------------------------------------------------------- the evidence cliff wall
    const cx = xOf(cliff.o2Max);
    const wallMat = track(new THREE.MeshBasicMaterial({ color: CLIFF, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide }));
    const wall = new THREE.Mesh(track(new THREE.PlaneGeometry(BOX.z, Y)), wallMat);
    wall.rotation.y = Math.PI / 2;
    wall.position.set(cx, Y / 2, Z / 2);
    scene.add(wall);
    const wallEdge = new THREE.Group();
    for (const [a, b] of [
      [[cx, 0, 0], [cx, Y, 0]],
      [[cx, Y, 0], [cx, Y, Z]],
      [[cx, 0, 0], [cx, 0, Z]],
      [[cx, 0, Z], [cx, Y, Z]],
    ] as [number[], number[]][]) wallEdge.add(line([new THREE.Vector3(...a), new THREE.Vector3(...b)], CLIFF, 0.85));
    scene.add(wallEdge);

    // ---------------------------------------------------------------- tests as points
    const pts = rows.filter((r) => r.o2 !== null && r.kPa !== null && r.kPa <= KPA_MAX);
    const pos = new Float32Array(pts.length * 3);
    const col = new Float32Array(pts.length * 3);
    const alpha = new Float32Array(pts.length);
    const solid = new Float32Array(pts.length);
    const c = new THREE.Color();
    pts.forEach((r, i) => {
      const jx = (Math.random() - 0.5) * 0.16;
      const jy = (Math.random() - 0.5) * 0.12;
      const jz = -Math.random() * 0.16;
      pos.set([xOf(r.o2 as number) + jx, yOf(r.kPa as number) + jy, zOf(r.g ?? 0) + jz], i * 3);
      c.set(PHASE_COLOR[r.phase ?? 'solid'] ?? '#ecebe2');
      col.set([c.r, c.g, c.b], i * 3);
      alpha[i] = r.o2Prov === 'assumed' ? 0.3 : 0.9;
      solid[i] = r.phase === 'solid' ? 1 : 0;
    });
    const pGeo = track(new THREE.BufferGeometry());
    pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    pGeo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    pGeo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    pGeo.setAttribute('aSolid', new THREE.BufferAttribute(solid, 1));
    const pMat = track(
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { uScale: { value: 400 }, uSize: { value: 0.12 }, uOpacity: { value: 1 }, uOthers: { value: 1 } },
        transparent: true,
        depthWrite: false,
      }),
    );
    const points = new THREE.Points(pGeo, pMat);
    scene.add(points);

    // ---------------------------------------------------------------- planned cabins
    const ring = track(ringTexture());
    const groups = new Map<string, Mission[]>();
    for (const m of missions) {
      if (m.o2Pct === null || m.pressureKpa === null) continue;
      const k = `${m.o2Pct}|${m.pressureKpa}|${m.gravityG ?? 0}`;
      groups.set(k, [...(groups.get(k) ?? []), m]);
    }
    const sprites: { sprite: THREE.Sprite; group: Mission[] }[] = [];
    const cabinLines = new THREE.Group();
    scene.add(cabinLines);
    for (const g of groups.values()) {
      const m = g[0];
      const p = new THREE.Vector3(xOf(m.o2Pct as number), yOf(m.pressureKpa as number), zOf(m.gravityG ?? 0));
      const sMat = track(new THREE.SpriteMaterial({ map: ring, transparent: true, depthWrite: false, depthTest: false }));
      const s = new THREE.Sprite(sMat);
      s.position.copy(p);
      s.scale.setScalar(0.42);
      s.renderOrder = 10;
      scene.add(s);
      sprites.push({ sprite: s, group: g });
      if ((m.gravityG ?? 0) > 0) {
        // drop to the floor, and a trace back to the 0 g plane where the evidence is
        cabinLines.add(line([p, new THREE.Vector3(p.x, 0, p.z)], '#f1f0e8', 0.35, true));
        cabinLines.add(line([new THREE.Vector3(p.x, 0, p.z), new THREE.Vector3(p.x, 0, 0)], '#f1f0e8', 0.18, true));
      }
    }

    // ---------------------------------------------------------------- HTML labels
    const labels: Label[] = [];
    const addLabel = (pos: THREE.Vector3, html: string, cls: string, kind: Label['kind'], onClick?: () => void) => {
      const el = document.createElement('div');
      el.className = `v3-label3d ${cls}`;
      el.innerHTML = html;
      if (onClick) {
        el.setAttribute('role', 'button');
        el.tabIndex = 0;
        el.addEventListener('click', onClick);
        el.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick()));
      }
      labelLayer.appendChild(el);
      labels.push({ el, pos, kind });
    };
    for (const t of o2Ticks) addLabel(new THREE.Vector3(xOf(t), -0.35, 0.3), `${t}%`, 'axis', 'axis');
    addLabel(new THREE.Vector3(X / 2, -0.95, 0.6), 'Oxygen in cabin air, % (log scale)', 'axis-title', 'axis');
    for (const k of [0, 40, 80, 120]) addLabel(new THREE.Vector3(-0.45, yOf(k), 0), `${k}`, 'axis', 'axis');
    addLabel(new THREE.Vector3(-0.3, Y + 0.45, 0), 'Pressure, kPa', 'axis-title', 'axis');
    for (const [g, l] of gTicks) addLabel(new THREE.Vector3(X + 0.35, 0, zOf(g)), l, 'axis', 'axis');
    addLabel(new THREE.Vector3(cx, Y + 0.45, 0), `Evidence cliff · ${fmt(cliff.o2Max)}% O₂`, 'cliff', 'cliff');
    for (const { group } of sprites) {
      const m = group[0];
      const name = group.map((x) => MISSION_SHORT[x.id] ?? x.label).join(' · ');
      const meta = `${fmt(m.o2Pct)}% O₂ · ${fmt(m.pressureKpa)} kPa · ${fmt(m.gravityG ?? 0, 3)} g`;
      addLabel(
        new THREE.Vector3(xOf(m.o2Pct as number), yOf(m.pressureKpa as number), zOf(m.gravityG ?? 0)),
        `${name}<small>${meta}</small>`,
        'mission',
        'mission',
        () => pickRef.current?.(m),
      );
    }

    // ---------------------------------------------------------------- sizing
    let w = 1, h = 1;
    const resize = () => {
      w = wrap.clientWidth || 1;
      h = wrap.clientHeight || 1;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = `${w}px`;
      renderer.domElement.style.height = `${h}px`;
      camera.aspect = w / h;
      // pull the camera back on narrow screens so the box fits
      camera.fov = w < 700 ? 52 : 38;
      // on wide screens push the scene right, leaving the left side calm for the headline
      if (w > 900) camera.setViewOffset(w, h, -w * 0.22, h * 0.03, w, h);
      else camera.clearViewOffset();
      camera.updateProjectionMatrix();
      pMat.uniforms.uScale.value = h / (2 * Math.tan((camera.fov * Math.PI) / 360));
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    // ---------------------------------------------------------------- camera moves between steps
    let tween: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t0: number; dur: number } | null = null;
    const go = (s: SpaceStep, instant = false) => {
      const [p, t] = VIEWS[s];
      if (instant || reduced) {
        camera.position.copy(p);
        controls.target.copy(t);
        tween = null;
        return;
      }
      tween = { from: camera.position.clone(), to: p.clone(), tFrom: controls.target.clone(), tTo: t.clone(), t0: performance.now(), dur: 1600 };
    };
    goRef.current = go;
    if (!reduced) tween = { from: START.clone(), to: VIEWS[stepRef.current][0].clone(), tFrom: VIEWS[stepRef.current][1].clone(), tTo: VIEWS[stepRef.current][1].clone(), t0: performance.now() + 150, dur: 2400 };
    controls.addEventListener('start', () => (tween = null));

    // ---------------------------------------------------------------- hover and click
    const ray = new THREE.Raycaster();
    ray.params.Points = { threshold: 0.12 };
    const ndc = new THREE.Vector2();
    let downAt: [number, number] | null = null;
    const toNdc = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onMove = (e: PointerEvent) => {
      if (e.buttons) return setTip(null);
      const at = toNdc(e);
      const hitS = ray.intersectObjects(sprites.map((s) => s.sprite))[0];
      if (hitS) {
        const g = sprites.find((s) => s.sprite === hitS.object)!.group;
        const m = g[0];
        const po2 = ((m.o2Pct as number) * (m.pressureKpa as number)) / 100;
        renderer.domElement.style.cursor = 'pointer';
        return setTip({ ...at, title: g.map((x) => x.label).join(' · '), lines: [`Oxygen partial pressure ${fmt(po2)} kPa (${(po2 / 21.2).toFixed(2)}× sea level)`, 'Click to check this cabin'] });
      }
      renderer.domElement.style.cursor = 'grab';
      const hit = ray.intersectObject(points)[0];
      if (hit && hit.index !== undefined) {
        const r = pts[hit.index];
        return setTip({
          ...at,
          title: `${r.inv} · ${r.fuel ?? r.phase ?? 'test'}`,
          lines: [`${fmt(r.o2)}% O₂ at ${fmt(r.kPa)} kPa, in orbit`, r.o2Prov === 'assumed' ? 'Atmosphere assumed (ISS cabin air), not measured' : `Test ${r.testId}`],
        });
      }
      setTip(null);
    };
    const onDown = (e: PointerEvent) => (downAt = [e.clientX, e.clientY]);
    const onUp = (e: PointerEvent) => {
      if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
      toNdc(e);
      const hitS = ray.intersectObjects(sprites.map((s) => s.sprite))[0];
      if (hitS) pickRef.current?.(sprites.find((s) => s.sprite === hitS.object)!.group[0]);
    };
    const onLeave = () => setTip(null);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointerleave', onLeave);

    // ---------------------------------------------------------------- per-step emphasis, eased each frame
    const emph = { points: 1, others: 1, wall: 0.08, edge: 0.85, cabins: 0.35 };
    const target = (s: SpaceStep) =>
      s === 0 ? { points: 1, others: 1, wall: 0.06, edge: 0.6, cabins: 0.3 } : s === 1 ? { points: 1, others: 0.12, wall: 0.2, edge: 1, cabins: 0.25 } : { points: 0.55, others: 0.1, wall: 0.1, edge: 0.7, cabins: 0.6 };

    // ---------------------------------------------------------------- loop, paused when off screen
    let visible = true;
    const io = new IntersectionObserver(([en]) => (visible = en.isIntersecting));
    io.observe(wrap);
    const v = new THREE.Vector3();
    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (!visible || document.hidden) return;
      if (tween) {
        const t = Math.min(1, Math.max(0, (now - tween.t0) / tween.dur));
        const k = ease(t);
        camera.position.lerpVectors(tween.from, tween.to, k);
        controls.target.lerpVectors(tween.tFrom, tween.tTo, k);
        if (t >= 1) tween = null;
      }
      controls.update();

      const tg = target(stepRef.current);
      const a = reduced ? 1 : 0.07;
      emph.points += (tg.points - emph.points) * a;
      emph.wall += (tg.wall - emph.wall) * a;
      emph.others += (tg.others - emph.others) * a;
      pMat.uniforms.uOthers.value = emph.others;
      emph.edge += (tg.edge - emph.edge) * a;
      emph.cabins += (tg.cabins - emph.cabins) * a;
      pMat.uniforms.uOpacity.value = emph.points;
      wallMat.opacity = emph.wall;
      wallEdge.children.forEach((l) => (((l as THREE.Line).material as THREE.LineBasicMaterial).opacity = emph.edge));
      cabinLines.children.forEach((l, i) => (((l as THREE.Line).material as THREE.LineBasicMaterial).opacity = emph.cabins * (i % 2 ? 0.5 : 1)));

      const placed: { x: number; y: number; w: number }[] = [];
      for (const lb of labels) {
        v.copy(lb.pos).project(camera);
        if (v.z > 1 || v.z < -1) {
          lb.el.style.visibility = 'hidden';
          continue;
        }
        lb.el.style.visibility = 'visible';
        const x = (v.x * 0.5 + 0.5) * w;
        let y = (-v.y * 0.5 + 0.5) * h;
        if (lb.kind === 'mission') {
          // keep cabin labels from sitting on top of each other
          const lw = lb.el.offsetWidth || 160;
          const lh = lb.el.offsetHeight || 34;
          for (let i = 0; i < placed.length; i++) {
            const p = placed[i];
            if (Math.abs(p.x - x) < Math.max(p.w, lw) && Math.abs(p.y - y) < lh + 4) {
              y = p.y + lh + 4;
              i = -1;
            }
          }
          placed.push({ x, y, w: lw });
          lb.el.style.transform = `translate(${x + 14}px, ${y}px) translate(0, -50%)`;
        } else lb.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      }
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      controls.dispose();
      goRef.current = null;
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointerleave', onLeave);
      scene.traverse((o) => {
        const l = o as THREE.Line;
        if (l.isLine) {
          l.geometry.dispose();
          (l.material as THREE.Material).dispose();
        }
      });
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      renderer.domElement.remove();
      labels.forEach((l) => l.el.remove());
    };
    // the scene is built once per data set; steps and callbacks flow through refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, missions, cliff]);

  return (
    <div className="v3-hero3d-canvas" ref={wrapRef}>
      <div ref={labelsRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }} />
      {tip && (
        <div className="v3-hero3d-tip" style={{ left: tip.x, top: tip.y }} role="status">
          <b>{tip.title}</b>
          {tip.lines.map((l) => (
            <div key={l}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}
