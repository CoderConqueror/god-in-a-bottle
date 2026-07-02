import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, ThreeEvent } from '@react-three/fiber';
import { Html, Trail } from '@react-three/drei';
import * as THREE from 'three';
import { game, useGame } from '../state/store';
import { SimState } from '../sim/types';
import { interventionById } from '../sim/interventions';
import { paintWorld, paintBump, paintSpec, paintClouds, TEX_W, TEX_H } from '../render/worldTexture';

const R = 1; // planet radius

export function tileToVec3(st: SimState, x: number, y: number, r: number): THREE.Vector3 {
  const u = (x + 0.5) / st.W;
  const theta = ((y + 0.5) / st.H) * Math.PI; // from north pole
  const phi = u * Math.PI * 2;
  return new THREE.Vector3(
    -r * Math.cos(phi) * Math.sin(theta),
    r * Math.cos(theta),
    r * Math.sin(phi) * Math.sin(theta),
  );
}

function uvToTile(st: SimState, u: number, v: number): { x: number; y: number } {
  const x = ((Math.floor(u * st.W) % st.W) + st.W) % st.W;
  const y = Math.max(0, Math.min(st.H - 1, Math.floor((1 - v) * st.H)));
  return { x, y };
}

// soft radial glow sprite texture
function makeGlowTexture(inner: string, outer: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, outer);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

const FRESNEL_VERT = `
varying vec3 vNormal;
void main() {
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const ATMO_FRAG = `
uniform vec3 uColor;
uniform float uPower;
varying vec3 vNormal;
void main() {
  float intensity = pow(max(0.0, 0.72 - dot(vNormal, vec3(0.0, 0.0, 1.0))), uPower);
  gl_FragColor = vec4(uColor, 1.0) * intensity;
}`;
const GLASS_FRAG = `
uniform vec3 uColor;
uniform float uOpacity;
varying vec3 vNormal;
void main() {
  float rim = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.6);
  gl_FragColor = vec4(uColor, rim * uOpacity);
}`;

// ---------------------------------------------------------------- planet

function Planet({ groupRef }: { groupRef: React.RefObject<THREE.Group> }): JSX.Element {
  useGame();
  const st = game.st;
  const meshRef = useRef<THREE.Mesh>(null!);
  const hoverRef = useRef<{ x: number; y: number } | null>(null);
  const ringRef = useRef<THREE.Mesh>(null!);

  const { mapTex, bumpTex, specTex } = useMemo(() => {
    const mc = document.createElement('canvas'); mc.width = TEX_W; mc.height = TEX_H;
    const bc = document.createElement('canvas'); bc.width = 512; bc.height = 256;
    const sc = document.createElement('canvas'); sc.width = 512; sc.height = 256;
    const mapTex = new THREE.CanvasTexture(mc);
    mapTex.colorSpace = THREE.SRGBColorSpace;
    mapTex.anisotropy = 8;
    const bumpTex = new THREE.CanvasTexture(bc);
    const specTex = new THREE.CanvasTexture(sc);
    return { mapTex, bumpTex, specTex };
  }, []);

  // repaint the surface when history changes, throttled
  const painted = useRef({ key: '', at: 0 });
  useFrame(() => {
    const s = game.st;
    const key = `${s.seed}:${s.terrainV}:${s.devV}:${Math.round(s.weather.drought * 4)}`;
    const now = performance.now();
    if (painted.current.key !== key && now - painted.current.at > 400) {
      paintWorld(s, mapTex.image as HTMLCanvasElement);
      mapTex.needsUpdate = true;
      if (!painted.current.key.startsWith(s.seed) || painted.current.key.split(':')[1] !== String(s.terrainV)) {
        paintBump(s, bumpTex.image as HTMLCanvasElement);
        paintSpec(s, specTex.image as HTMLCanvasElement);
        bumpTex.needsUpdate = true;
        specTex.needsUpdate = true;
      }
      painted.current = { key, at: now };
    }
    // hover / targeting reticle
    if (ringRef.current) {
      const h = hoverRef.current;
      const show = !!game.targeting && !!h;
      ringRef.current.visible = show;
      if (show && h) {
        const p = tileToVec3(game.st, h.x, h.y, R * 1.012);
        ringRef.current.position.copy(p);
        ringRef.current.lookAt(p.clone().multiplyScalar(2));
        const s2 = 1 + 0.12 * Math.sin(now / 130);
        ringRef.current.scale.setScalar(s2);
      }
    }
  });

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (e.uv) hoverRef.current = uvToTile(game.st, e.uv.x, e.uv.y);
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6 || !e.uv) return; // it was a drag, not a click
    const { x, y } = uvToTile(game.st, e.uv.x, e.uv.y);
    game.clickWorld(x, y);
  };

  return (
    <group ref={groupRef}>
      <mesh ref={meshRef} onPointerMove={onMove} onPointerOut={() => { hoverRef.current = null; }} onClick={onClick}>
        <sphereGeometry args={[R, 128, 96]} />
        <meshPhongMaterial
          map={mapTex}
          bumpMap={bumpTex}
          bumpScale={0.9}
          specularMap={specTex}
          specular={new THREE.Color('#4a687d')}
          shininess={22}
          emissiveMap={mapTex}
          emissive={new THREE.Color('#8f9bb8')}
          emissiveIntensity={0.42}
        />
      </mesh>
      {/* targeting reticle */}
      <mesh ref={ringRef} visible={false}>
        <ringGeometry args={[0.028, 0.036, 40]} />
        <meshBasicMaterial color="#ffe9b0" transparent opacity={0.95} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <Markers />
      <CastBurst />
    </group>
  );
}

// ---------------------------------------------------------------- markers

const warmGlow = makeGlowTexture('rgba(255,214,140,0.95)', 'rgba(255,168,70,0.5)');
const holyGlow = makeGlowTexture('rgba(190,245,255,0.95)', 'rgba(120,220,245,0.45)');
const warGlow = makeGlowTexture('rgba(255,120,80,0.95)', 'rgba(230,70,40,0.5)');
const goldGlow = makeGlowTexture('rgba(255,240,200,1)', 'rgba(230,190,110,0.55)');

function SettlementMarker({ sid }: { sid: number }): JSX.Element | null {
  const st = game.st;
  const s = st.settlements.find(z => z.id === sid);
  const spriteRef = useRef<THREE.Sprite>(null!);
  const warRef = useRef<THREE.Sprite>(null!);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const s2 = game.st.settlements.find(z => z.id === sid);
    if (!s2 || !spriteRef.current) return;
    const base = 0.05 + Math.sqrt(Math.max(1, s2.pop)) * 0.012;
    const flick = 1 + 0.1 * Math.sin(t * 3 + sid);
    spriteRef.current.scale.setScalar(base * flick);
    (spriteRef.current.material as THREE.SpriteMaterial).opacity = s2.razed ? 0 : 0.9;
    if (warRef.current) {
      warRef.current.visible = s2.warWith !== null;
      (warRef.current.material as THREE.SpriteMaterial).opacity = 0.4 + 0.5 * Math.abs(Math.sin(t * 5));
    }
  });
  if (!s || s.razed) return null;
  const pos = tileToVec3(st, s.x, s.y, R * 1.008);
  const selected = game.selection.kind === 'settlement' && game.selection.sid === s.id;
  return (
    <group position={pos}>
      <sprite ref={spriteRef}>
        <spriteMaterial map={s.plague > 0 ? holyGlow : warmGlow} color={s.plague > 0 ? '#b8e890' : s.cursed > 0 ? '#b490e8' : '#ffcf8f'} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <sprite ref={warRef} position={[0.03, 0.04, 0]} visible={false}>
        <spriteMaterial map={warGlow} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      {s.buildings.wonder ? (
        <sprite scale={0.09} position={[0, 0.025, 0]}>
          <spriteMaterial map={goldGlow} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
        </sprite>
      ) : null}
      <Html center distanceFactor={1.7} zIndexRange={[20, 0]} className={`s-label ${selected ? 'sel' : ''}`} style={{ pointerEvents: 'none' }}>
        <div className="s-label-inner">
          {s.name}
          <span className="s-label-pop">{s.pop}</span>
        </div>
      </Html>
      {selected && <SelectionRing />}
    </group>
  );
}

function SelectionRing(): JSX.Element {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime;
    ref.current.scale.setScalar(1 + 0.08 * Math.sin(t * 2.6));
    ref.current.lookAt(ref.current.getWorldPosition(new THREE.Vector3()).multiplyScalar(2));
  });
  return (
    <mesh ref={ref}>
      <ringGeometry args={[0.052, 0.06, 48]} />
      <meshBasicMaterial color="#ffe9b0" transparent opacity={0.85} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

function Markers(): JSX.Element {
  useGame();
  const st = game.st;
  return (
    <group>
      {st.settlements.filter(s => !s.razed).map(s => <SettlementMarker key={s.id} sid={s.id} />)}
      {st.sacred.map(site => {
        const pos = tileToVec3(st, site.x, site.y, R * 1.006);
        return (
          <sprite key={site.id} position={pos} scale={0.06}>
            <spriteMaterial map={holyGlow} transparent opacity={0.8} depthWrite={false} blending={THREE.AdditiveBlending} />
          </sprite>
        );
      })}
    </group>
  );
}

// divine act: an expanding ring of light on the world's skin
function CastBurst(): JSX.Element {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame(() => {
    const cast = game.lastCast;
    if (!ref.current) return;
    if (!cast || cast.x === null || cast.y === null) { ref.current.visible = false; return; }
    const age = (performance.now() - cast.at) / 1000;
    if (age > 2.2) { ref.current.visible = false; return; }
    ref.current.visible = true;
    const p = tileToVec3(game.st, cast.x, cast.y, R * 1.014);
    ref.current.position.copy(p);
    ref.current.lookAt(p.clone().multiplyScalar(2));
    const s = 0.5 + age * 3.2;
    ref.current.scale.setScalar(s);
    (ref.current.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 - age * 0.42);
  });
  return (
    <mesh ref={ref} visible={false}>
      <ringGeometry args={[0.05, 0.062, 48]} />
      <meshBasicMaterial color="#fff3cf" transparent side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
    </mesh>
  );
}

// ---------------------------------------------------------------- sky & effects

function Comet(): JSX.Element {
  const ref = useRef<THREE.Group>(null!);
  const sprite = useRef<THREE.Sprite>(null!);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const active = game.st.weather.comet > 0;
    ref.current.visible = active;
    if (active) {
      const t = clock.elapsedTime * 0.45;
      ref.current.position.set(Math.cos(t) * 2.4, 0.9 + Math.sin(t * 0.7) * 0.5, Math.sin(t) * 2.4);
    }
  });
  return (
    <group ref={ref} visible={false}>
      <Trail width={0.5} length={7} color="#bfe2ff" attenuation={(w) => w * w}>
        <sprite ref={sprite} scale={0.09}>
          <spriteMaterial map={holyGlow} color="#eaf6ff" transparent depthWrite={false} blending={THREE.AdditiveBlending} />
        </sprite>
      </Trail>
    </group>
  );
}

function Sky(): JSX.Element {
  const starGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const n = 1600;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(28 + Math.random() * 22);
      pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  const ref = useRef<THREE.Points>(null!);
  useFrame((_, dt) => { if (ref.current) ref.current.rotation.y += dt * 0.004; });
  return (
    <points ref={ref} geometry={starGeo}>
      <pointsMaterial color="#cdd8ee" size={0.045} sizeAttenuation transparent opacity={0.8} depthWrite={false} />
    </points>
  );
}

function Atmosphere(): JSX.Element {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color('#6fb8de') }, uPower: { value: 3.4 } },
    vertexShader: FRESNEL_VERT,
    fragmentShader: ATMO_FRAG,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
  }), []);
  return (
    <mesh scale={1.12} material={mat}>
      <sphereGeometry args={[R, 48, 48]} />
    </mesh>
  );
}

function Clouds(): JSX.Element {
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 512;
    paintClouds(c);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  const ref = useRef<THREE.Mesh>(null!);
  useFrame((_, dt) => {
    if (!ref.current) return;
    ref.current.rotation.y += dt * 0.008;
    const m = ref.current.material as THREE.MeshLambertMaterial;
    const target = 0.55 + Math.min(0.4, game.st.weather.rain * 0.2);
    m.opacity += (target - m.opacity) * 0.05;
  });
  return (
    <mesh ref={ref} scale={1.028}>
      <sphereGeometry args={[R, 48, 48]} />
      <meshLambertMaterial map={tex} transparent opacity={0.55} depthWrite={false} />
    </mesh>
  );
}

// The bottle itself: a fixed artifact the world turns inside.
function Bottle({ camDist }: { camDist: React.MutableRefObject<number> }): JSX.Element {
  const glassMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color('#bcd8ee') }, uOpacity: { value: 0.75 } },
    vertexShader: FRESNEL_VERT,
    fragmentShader: GLASS_FRAG,
    transparent: true,
    depthWrite: false,
  }), []);
  const ref = useRef<THREE.Group>(null!);
  useFrame(() => {
    // the glass politely gets out of the way when you lean in
    const fade = Math.max(0, Math.min(1, (camDist.current - 1.9) / 1.1));
    glassMat.uniforms.uOpacity.value = 0.75 * fade;
    if (ref.current) ref.current.visible = fade > 0.02;
  });
  return (
    <group>
      <group ref={ref}>
        <mesh material={glassMat}>
          <sphereGeometry args={[1.34, 64, 64]} />
        </mesh>
        {/* neck & cork */}
        <mesh position={[0, 1.46, 0]}>
          <cylinderGeometry args={[0.17, 0.24, 0.34, 32, 1, true]} />
          <meshPhongMaterial color="#b8d4ea" transparent opacity={0.22} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        <mesh position={[0, 1.64, 0]}>
          <torusGeometry args={[0.175, 0.028, 12, 32]} />
          <meshPhongMaterial color="#cfe4f2" transparent opacity={0.5} />
        </mesh>
        <mesh position={[0, 1.73, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.15, 0.16, 0.2, 24]} />
          <meshStandardMaterial color="#a97b48" roughness={0.95} />
        </mesh>
      </group>
      {/* wooden base — always visible, the museum stand */}
      <mesh position={[0, -1.44, 0]}>
        <cylinderGeometry args={[0.88, 1.0, 0.14, 48]} />
        <meshStandardMaterial color="#3c2c1c" roughness={0.85} metalness={0.05} />
      </mesh>
      <mesh position={[0, -1.36, 0]}>
        <torusGeometry args={[0.9, 0.035, 12, 48]} />
        <meshStandardMaterial color="#5d4326" roughness={0.7} metalness={0.15} />
      </mesh>
    </group>
  );
}

// lights that respond to the weather and to eclipses
function DivineLights(): JSX.Element {
  const sun = useRef<THREE.DirectionalLight>(null!);
  const amb = useRef<THREE.AmbientLight>(null!);
  const lantern = useRef<THREE.PointLight>(null!);
  const { camera } = useThree();
  useFrame(() => {
    if (!sun.current || !amb.current) return;
    const w = game.st.weather;
    let intensity = 1.7, color = new THREE.Color('#fff2dd'), ambI = 0.45;
    if (w.eclipse > 0) { intensity = 0.2; ambI = 0.2; color = new THREE.Color('#9fb0d8'); }
    else if (w.drought > 0.5) { color = new THREE.Color('#ffd9a8'); }
    else if (w.rain > 0.5) { intensity = 1.5; color = new THREE.Color('#dfe8f2'); }
    sun.current.intensity += (intensity - sun.current.intensity) * 0.04;
    sun.current.color.lerp(color, 0.04);
    amb.current.intensity += (ambI - amb.current.intensity) * 0.04;
    // the observer's lantern: whatever face you study is never pure black
    if (lantern.current) {
      lantern.current.position.copy(camera.position);
      lantern.current.intensity = 0.3;
    }
  });
  return (
    <>
      <directionalLight ref={sun} position={[4, 2.5, 5]} intensity={2.1} color="#fff2dd" />
      <ambientLight ref={amb} intensity={0.85} color="#46506e" />
      <pointLight ref={lantern} intensity={0.3} color="#b8c8e8" decay={0.6} />
      <pointLight position={[-4, -2, -4]} intensity={0.35} color="#3a5a88" />
    </>
  );
}

// custom tactile controls: drag spins the world, wheel leans in
function WorldControls({ groupRef, camDist }: { groupRef: React.RefObject<THREE.Group>; camDist: React.MutableRefObject<number> }): null {
  const { gl, camera } = useThree();
  const state = useRef({ down: false, lx: 0, ly: 0, vyaw: 0, vpitch: 0, yaw: 0.6, pitch: 0.22, lastTouch: 0 });
  useEffect(() => {
    const el = gl.domElement;
    const down = (e: PointerEvent) => { state.current.down = true; state.current.lx = e.clientX; state.current.ly = e.clientY; state.current.lastTouch = performance.now(); };
    const up = () => { state.current.down = false; };
    const move = (e: PointerEvent) => {
      const s = state.current;
      if (!s.down) return;
      const dx = e.clientX - s.lx, dy = e.clientY - s.ly;
      s.lx = e.clientX; s.ly = e.clientY;
      const k = 0.0042 * Math.max(0.35, (camDist.current - 1.1) / 2.4);
      s.vyaw = dx * k;
      s.vpitch = dy * k * 0.8;
      s.yaw += s.vyaw;
      s.pitch = Math.max(-1.15, Math.min(1.15, s.pitch + s.vpitch));
      s.lastTouch = performance.now();
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      camDist.current = Math.max(1.35, Math.min(5.4, camDist.current * (1 + e.deltaY * 0.0011)));
      state.current.lastTouch = performance.now();
    };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointermove', move);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointermove', move);
      el.removeEventListener('wheel', wheel);
    };
  }, [gl]);

  useFrame((_, dt) => {
    const s = state.current;
    if (!s.down) {
      // inertia, decaying
      s.yaw += s.vyaw;
      s.pitch = Math.max(-1.15, Math.min(1.15, s.pitch + s.vpitch));
      s.vyaw *= 0.94;
      s.vpitch *= 0.9;
      // idle: the world turns gently on its own
      if (performance.now() - s.lastTouch > 5000) s.yaw += dt * 0.028;
    }
    if (groupRef.current) {
      groupRef.current.rotation.set(s.pitch, s.yaw, 0, 'XYZ');
    }
    // smooth dolly
    const targetZ = camDist.current;
    camera.position.z += (targetZ - camera.position.z) * 0.08;
    camera.position.y += (targetZ * 0.1 - camera.position.y) * 0.08;
    camera.lookAt(0, 0, 0);
  });
  return null;
}

// ---------------------------------------------------------------- root view

export function GlobeView(): JSX.Element {
  useGame();
  const groupRef = useRef<THREE.Group>(null);
  const camDist = useRef(3.1);
  const [flashKey, setFlashKey] = useState(0);

  // global interventions flash the whole vessel
  useEffect(() => {
    return game.subscribe(() => {
      const c = game.lastCast;
      if (c && c.x === null && performance.now() - c.at < 300) setFlashKey(c.at);
    });
  }, []);

  return (
    <div className={`globe-stage ${game.targeting ? 'targeting' : ''}`}>
      <Canvas
        dpr={[1, 2]}
        camera={{ fov: 38, position: [0, 0.32, 3.1], near: 0.05, far: 80 }}
        gl={{ antialias: true, alpha: true }}
      >
        <DivineLights />
        <Sky />
        <Planet groupRef={groupRef} />
        <Clouds />
        <Atmosphere />
        <Comet />
        <Bottle camDist={camDist} />
        <EclipseShroud />
        <WorldControls groupRef={groupRef} camDist={camDist} />
      </Canvas>
      {flashKey > 0 && <div key={flashKey} className="divine-flash" />}
      {game.targeting && (
        <div className="targeting-hint">
          {interventionById(game.targeting)?.target === 'tile' ? 'Choose ground to hallow' : 'Choose a settlement'} — <button className="linkish" onClick={() => game.cancelTargeting()}>or withhold your hand</button>
        </div>
      )}
      <div className="globe-hint">drag to turn the world · scroll to lean closer</div>
    </div>
  );
}

// during an eclipse, the whole vessel falls into blue shadow
function EclipseShroud(): JSX.Element {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame(() => {
    if (!ref.current) return;
    const m = ref.current.material as THREE.MeshBasicMaterial;
    const target = game.st.weather.eclipse > 0 ? 0.4 : 0;
    m.opacity += (target - m.opacity) * 0.05;
    ref.current.visible = m.opacity > 0.01;
  });
  return (
    <mesh ref={ref} visible={false} scale={1.36}>
      <sphereGeometry args={[R, 32, 32]} />
      <meshBasicMaterial color="#040616" transparent opacity={0} side={THREE.BackSide} depthWrite={false} />
    </mesh>
  );
}
