/**
 * The evidence as a physical model on an engineering pad: flight records with reported oxygen (x, log scale),
 * pressure (y) and gravity (z), at their exact source coordinates. Missing dimensions are omitted rather than imputed
 * as zero. The highlighted oxygen boundary belongs only to the solid-material flight-test subset. Mission markers are
 * scenarios, never test results.
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Mission } from '../../core';
import { MISSION_SHORT, OUTSIDE_PSI, fmt, type Cliff, type Row } from './data';

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

const PAD = '#eef2e2';
const GRID = '#cbd9b6';
const INK = '#10302a';
const O2GREEN = '#1e7a46';
const HIGHLIGHT = '#c8e62e';
const FADED = new THREE.Color('#c4d3b1');
const PHASE_COLOR: Record<string, string> = { solid: INK, liquid: '#2e8a7c', gas: '#8a9a2a' };

/** Camera stops for the three story steps: [position, target]. */
const VIEWS: Record<SpaceStep, [THREE.Vector3, THREE.Vector3]> = {
  0: [new THREE.Vector3(20, 12, 19), new THREE.Vector3(7, 1.6, -4)],
  1: [new THREE.Vector3(5.5, 4.8, 21), new THREE.Vector3(7.2, 2.2, -2)],
  2: [new THREE.Vector3(30, 10, 12), new THREE.Vector3(8.6, 1.6, -3.6)],
};
const START = new THREE.Vector3(30, 22, 30);

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d') as CanvasRenderingContext2D);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function line(points: THREE.Vector3[], color: string, opacity: number, dashed = false): THREE.Line {
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = dashed
    ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.14, gapSize: 0.1, depthWrite: false })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  const l = new THREE.Line(geo, mat);
  if (dashed) l.computeLineDistances();
  return l;
}

interface Label { el: HTMLDivElement; pos: THREE.Vector3; kind: 'axis' | 'mission' | 'cliff' | 'outside' }
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
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      onFail?.();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(PAD, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    wrap.prepend(renderer.domElement);
    Object.assign(renderer.domElement.style, { display: 'block', position: 'absolute', left: '0', top: '0' });
    renderer.domElement.setAttribute('aria-hidden', 'true');

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(PAD, 30, 70);
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
    camera.position.copy(reduced ? VIEWS[stepRef.current][0] : START);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.rotateSpeed = 0.6;
    // a slow orbit makes the field spatially legible; it honours reduced motion, waits for the camera tour,
    // and stops for good once the visitor takes the controls
    controls.autoRotateSpeed = 0.22;
    controls.autoRotate = !reduced;
    controls.minPolarAngle = 0.2;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.target.copy(VIEWS[stepRef.current][1]);

    const disposables: { dispose: () => void }[] = [];
    const track = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);

    // ---------------------------------------------------------------- light: a soft studio over the pad
    scene.add(new THREE.HemisphereLight('#ffffff', '#c9d6b0', 1.5));
    const sun = new THREE.DirectionalLight('#ffffff', 2.1);
    sun.position.set(4, 18, 10);
    sun.target.position.set(7, 0, -4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -6, right: 22, top: 10, bottom: -16, near: 1, far: 50 });
    sun.shadow.radius = 6;
    sun.shadow.bias = -0.0004;
    scene.add(sun, sun.target);

    const X = BOX.x, Y = BOX.y, Z = -BOX.z;
    const cx = xOf(cliff.o2Max);

    // ---------------------------------------------------------------- the pad: gridded floor that takes shadows
    const padTex = track(
      canvasTexture(1024, 1024, (g) => {
        g.fillStyle = PAD;
        g.fillRect(0, 0, 1024, 1024);
        for (let i = 0; i <= 1024; i += 32) {
          g.strokeStyle = i % 160 === 0 ? '#b9cc9d' : GRID;
          g.lineWidth = i % 160 === 0 ? 2 : 1;
          g.beginPath();
          g.moveTo(i, 0);
          g.lineTo(i, 1024);
          g.moveTo(0, i);
          g.lineTo(1024, i);
          g.stroke();
        }
      }),
    );
    padTex.wrapS = padTex.wrapT = THREE.RepeatWrapping;
    padTex.repeat.set(28, 28);
    const floor = new THREE.Mesh(track(new THREE.PlaneGeometry(400, 400)), track(new THREE.MeshLambertMaterial({ map: padTex })));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(X / 2, -0.01, Z / 2);
    floor.receiveShadow = true;
    scene.add(floor);

    // the void past the cliff: drafting hatch on the floor, where no solid flight test stands
    const hatchTex = track(
      canvasTexture(256, 256, (g) => {
        g.clearRect(0, 0, 256, 256);
        g.strokeStyle = 'rgba(16,48,42,0.32)';
        g.lineWidth = 2;
        for (let i = -256; i < 512; i += 18) {
          g.beginPath();
          g.moveTo(i, 256);
          g.lineTo(i + 256, 0);
          g.stroke();
        }
      }),
    );
    hatchTex.wrapS = hatchTex.wrapT = THREE.RepeatWrapping;
    hatchTex.repeat.set((X - cx) / 1.6, BOX.z / 1.6);
    const voidMat = track(new THREE.MeshBasicMaterial({ map: hatchTex, transparent: true, opacity: 0.9, depthWrite: false }));
    const voidFloor = new THREE.Mesh(track(new THREE.PlaneGeometry(X - cx, BOX.z)), voidMat);
    voidFloor.rotation.x = -Math.PI / 2;
    voidFloor.position.set(cx + (X - cx) / 2, 0.005, Z / 2);
    scene.add(voidFloor);

    // ---------------------------------------------------------------- frame: ink axes and faint grid on the 0 g wall
    const frame = new THREE.Group();
    scene.add(frame);
    const o2Ticks = [10, 15, 20, 30, 50, 100];
    const gTicks: [number, string][] = [[0, '0 g · orbit'], [0.166, '0.17 g · Moon'], [0.38, '0.38 g · Mars'], [1, '1 g · Earth']];
    for (const t of o2Ticks) {
      frame.add(line([new THREE.Vector3(xOf(t), 0.01, 0), new THREE.Vector3(xOf(t), 0.01, Z)], INK, 0.16));
      frame.add(line([new THREE.Vector3(xOf(t), 0, 0), new THREE.Vector3(xOf(t), Y, 0)], INK, 0.08));
    }
    for (const [g] of gTicks) frame.add(line([new THREE.Vector3(0, 0.01, zOf(g)), new THREE.Vector3(X, 0.01, zOf(g))], INK, g === 0 ? 0.5 : 0.2, g !== 0));
    for (const k of [40, 80, 120]) frame.add(line([new THREE.Vector3(0, yOf(k), 0), new THREE.Vector3(X, yOf(k), 0)], INK, 0.1));
    frame.add(line([new THREE.Vector3(0, 0, 0), new THREE.Vector3(X, 0, 0)], INK, 0.85));
    frame.add(line([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, Y, 0)], INK, 0.85));
    frame.add(line([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, Z)], INK, 0.85));
    // the 0 g wall where every test ran: a sheet of tracing paper
    const wallPaper = new THREE.Mesh(
      track(new THREE.PlaneGeometry(X, Y)),
      track(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide })),
    );
    wallPaper.position.set(X / 2, Y / 2, -0.02);
    frame.add(wallPaper);

    // ---------------------------------------------------------------- the evidence cliff: a sheet of highlighter-green acrylic
    const sheetMat = track(
      new THREE.MeshPhysicalMaterial({ color: HIGHLIGHT, transparent: true, opacity: 0.38, roughness: 0.25, metalness: 0, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false }),
    );
    const sheet = new THREE.Mesh(track(new THREE.BoxGeometry(0.06, Y, BOX.z)), sheetMat);
    sheet.position.set(cx, Y / 2, Z / 2);
    sheet.castShadow = true;
    scene.add(sheet);
    const sheetEdge = new THREE.LineSegments(track(new THREE.EdgesGeometry(sheet.geometry)), track(new THREE.LineBasicMaterial({ color: '#7f9a0c', transparent: true, opacity: 0.9 })));
    sheetEdge.position.copy(sheet.position);
    scene.add(sheetEdge);

    // ---------------------------------------------------------------- tests as shaded spheres
    const pts = rows.filter((r) => r.gravityMode === 'actual_flight' && r.g !== null && r.o2 !== null && r.kPa !== null && r.kPa <= KPA_MAX);
    const sphere = track(new THREE.SphereGeometry(1, 14, 10));
    const testMat = track(new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05, transparent: true }));
    const inst = new THREE.InstancedMesh(sphere, testMat, pts.length);
    inst.castShadow = true;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const pv = new THREE.Vector3();
    const baseColor: THREE.Color[] = [];
    const pos = new Float32Array(pts.length * 3);
    pts.forEach((r, i) => {
      // exact source coordinates: no random jitter that would invent readings
      pos.set([xOf(r.o2 as number), yOf(r.kPa as number), zOf(r.g as number)], i * 3);
      pv.fromArray(pos, i * 3);
      const s = r.o2Prov === 'assumed' || r.kPaProv === 'assumed' ? 0.045 : 0.07;
      m4.compose(pv, q, sc.setScalar(s));
      inst.setMatrixAt(i, m4);
      const col = new THREE.Color(PHASE_COLOR[r.phase ?? 'solid'] ?? INK);
      if (r.o2Prov === 'assumed' || r.kPaProv === 'assumed') col.lerp(new THREE.Color(PAD), 0.55);
      baseColor.push(col);
      inst.setColorAt(i, col);
    });
    scene.add(inst);
    const paint = (solidOnly: number) => {
      const c = new THREE.Color();
      pts.forEach((r, i) => {
        c.copy(baseColor[i]);
        if (r.phase !== 'solid') c.lerp(FADED, solidOnly);
        inst.setColorAt(i, c);
      });
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    };

    // ---------------------------------------------------------------- planned cabins: wireframe pucks with drop lines
    const groups = new Map<string, Mission[]>();
    for (const m of missions) {
      if (m.o2Pct === null || m.pressureKpa === null || m.gravityG === null) continue;
      const k = `${m.o2Pct}|${m.pressureKpa}|${m.gravityG ?? 0}`;
      groups.set(k, [...(groups.get(k) ?? []), m]);
    }
    const pucks: { mesh: THREE.Mesh; group: Mission[] }[] = [];
    const cabinLines = new THREE.Group();
    scene.add(cabinLines);
    const puckGeo = track(new THREE.CylinderGeometry(0.32, 0.32, 0.14, 40));
    const puckEdges = track(new THREE.EdgesGeometry(puckGeo, 30));
    const puckMat = track(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4, metalness: 0 }));
    const puckLineMat = track(new THREE.LineBasicMaterial({ color: O2GREEN }));
    for (const g of groups.values()) {
      const m = g[0];
      const p = new THREE.Vector3(xOf(m.o2Pct as number), yOf(m.pressureKpa as number), zOf(m.gravityG ?? 0));
      const mesh = new THREE.Mesh(puckGeo, puckMat);
      mesh.position.copy(p);
      mesh.castShadow = true;
      mesh.add(new THREE.LineSegments(puckEdges, puckLineMat));
      scene.add(mesh);
      pucks.push({ mesh, group: g });
      cabinLines.add(line([p, new THREE.Vector3(p.x, 0, p.z)], O2GREEN, 0.7, true));
      if ((m.gravityG ?? 0) > 0) cabinLines.add(line([new THREE.Vector3(p.x, 0.02, p.z), new THREE.Vector3(p.x, 0.02, 0)], O2GREEN, 0.4, true));
    }

    // ---------------------------------------------------------------- tests published outside PSI: open ink rings
    const outsideMeshes: THREE.Mesh[] = [];
    const ringGeo = track(new THREE.TorusGeometry(0.2, 0.035, 12, 40));
    const ringMat = track(new THREE.MeshStandardMaterial({ color: INK, roughness: 0.5 }));
    for (const o of OUTSIDE_PSI) {
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(xOf(o.o2), yOf(o.kPa), zOf(o.g) - 0.05);
      ring.castShadow = true;
      scene.add(ring);
      outsideMeshes.push(ring);
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
    for (const t of o2Ticks) addLabel(new THREE.Vector3(xOf(t), -0.35, 0.35), `${t}%`, 'axis', 'axis');
    addLabel(new THREE.Vector3(X / 2, -1, 0.7), 'Oxygen in cabin air, % (log scale)', 'axis-title', 'axis');
    for (const k of [0, 40, 80, 120]) addLabel(new THREE.Vector3(-0.5, yOf(k), 0), `${k}`, 'axis', 'axis');
    addLabel(new THREE.Vector3(-0.3, Y + 0.5, 0), 'Pressure, kPa', 'axis-title', 'axis');
    for (const [g, l] of gTicks) addLabel(new THREE.Vector3(X + 0.4, 0, zOf(g)), l, 'axis', 'axis');
    addLabel(new THREE.Vector3(cx, Y + 0.55, 0), `Solid-flight coverage · ${fmt(cliff.o2Max)}% O₂ <small>highest reported O₂ in the PSI solid flight subset</small>`, 'cliff', 'cliff');
    for (const o of OUTSIDE_PSI) addLabel(new THREE.Vector3(xOf(o.o2), yOf(o.kPa), zOf(o.g)), `${o.label}<small>${fmt(o.o2)}% O₂ · ${fmt(o.kPa)} kPa · outside PSI</small>`, 'outside', 'outside');
    for (const { group } of pucks) {
      const m = group[0];
      const name = group.map((x) => MISSION_SHORT[x.id] ?? x.label).join(' · ');
      const meta = `${fmt(m.o2Pct)}% O₂ · ${fmt(m.pressureKpa)} kPa · ${fmt(m.gravityG ?? 0, 3)} g`;
      addLabel(new THREE.Vector3(xOf(m.o2Pct as number), yOf(m.pressureKpa as number), zOf(m.gravityG ?? 0)), `${name}<small>${meta}</small>`, 'mission', 'mission', () => pickRef.current?.(m));
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
      camera.fov = w < 700 ? 50 : 36;
      // on wide screens push the model right, leaving the left side calm for the headline
      if (w > 900) camera.setViewOffset(w, h, -w * 0.25, h * 0.07, w, h);
      else camera.clearViewOffset();
      camera.updateProjectionMatrix();
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
      tween = { from: camera.position.clone(), to: p.clone(), tFrom: controls.target.clone(), tTo: t.clone(), t0: performance.now(), dur: 1700 };
    };
    goRef.current = go;
    if (!reduced) tween = { from: START.clone(), to: VIEWS[stepRef.current][0].clone(), tFrom: VIEWS[stepRef.current][1].clone(), tTo: VIEWS[stepRef.current][1].clone(), t0: performance.now() + 150, dur: 2600 };
    controls.addEventListener('start', () => {
      tween = null;
      controls.autoRotate = false;
    });

    // ---------------------------------------------------------------- hover and click
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let downAt: [number, number] | null = null;
    const toNdc = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const pickPuck = () => {
      const hit = ray.intersectObjects(pucks.map((p) => p.mesh), false)[0];
      return hit ? pucks.find((p) => p.mesh === hit.object) ?? null : null;
    };
    const onMove = (e: PointerEvent) => {
      if (e.buttons) return setTip(null);
      const at = toNdc(e);
      const puck = pickPuck();
      if (puck) {
        const m = puck.group[0];
        const po2 = ((m.o2Pct as number) * (m.pressureKpa as number)) / 100;
        renderer.domElement.style.cursor = 'pointer';
        return setTip({ ...at, title: puck.group.map((x) => x.label).join(' · '), lines: [`Oxygen partial pressure ${fmt(po2)} kPa (${(po2 / 21.2).toFixed(2)}× sea level)`, 'Click to check this cabin'] });
      }
      renderer.domElement.style.cursor = 'grab';
      const oh = ray.intersectObjects(outsideMeshes, false)[0];
      if (oh) {
        const o = OUTSIDE_PSI[outsideMeshes.indexOf(oh.object as THREE.Mesh)];
        return setTip({ ...at, title: o.label, lines: [`${fmt(o.o2)}% O₂ at ${fmt(o.kPa)} kPa, in orbit`, o.note] });
      }
      const hit = ray.intersectObject(inst, false)[0];
      if (hit && hit.instanceId !== undefined) {
        const r = pts[hit.instanceId];
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
      const puck = pickPuck();
      if (puck) pickRef.current?.(puck.group[0]);
    };
    const onLeave = () => setTip(null);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointerleave', onLeave);

    // ---------------------------------------------------------------- per-step emphasis, eased each frame
    const emph = { others: 0, sheet: 0.38, cabins: 0.5 };
    let painted = -1;
    const target = (s: SpaceStep) => (s === 0 ? { others: 0, sheet: 0.3, cabins: 0.45 } : s === 1 ? { others: 0.85, sheet: 0.6, cabins: 0.3 } : { others: 0.7, sheet: 0.38, cabins: 0.85 });

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
      emph.others += (tg.others - emph.others) * a;
      emph.sheet += (tg.sheet - emph.sheet) * a;
      emph.cabins += (tg.cabins - emph.cabins) * a;
      const q2 = Math.round(emph.others * 40) / 40;
      if (q2 !== painted) {
        paint(q2);
        painted = q2;
      }
      sheetMat.opacity = emph.sheet;
      cabinLines.children.forEach((l) => (((l as THREE.Line).material as THREE.LineBasicMaterial).opacity = emph.cabins));
      const bob = reduced ? 0 : Math.sin(now / 900) * 0.04;
      pucks.forEach((p, i) => (p.mesh.position.y = yOf(p.group[0].pressureKpa as number) + (p.group[0].gravityG ? bob * (i % 2 ? 1 : -1) : 0)));
      outsideMeshes.forEach((m) => m.lookAt(camera.position));

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
        if (lb.kind === 'mission' || lb.kind === 'outside') {
          const lw = lb.el.offsetWidth || 160;
          const lh = lb.el.offsetHeight || 34;
          // the tolerance and the cap stop float rounding from re-triggering the same overlap forever
          for (let i = 0, guard = 0; i < placed.length && guard < 64; i++) {
            const p = placed[i];
            if (Math.abs(p.x - x) < Math.max(p.w, lw) && Math.abs(p.y - y) < lh + 3.5) {
              y = p.y + lh + 4;
              i = -1;
              guard++;
            }
          }
          placed.push({ x, y, w: lw });
          lb.el.style.transform = `translate(${x + 18}px, ${y}px) translate(0, -50%)`;
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
        if (l.isLine && !(l as unknown as THREE.LineSegments).isLineSegments) {
          l.geometry.dispose();
          (l.material as THREE.Material).dispose();
        }
      });
      inst.dispose();
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
