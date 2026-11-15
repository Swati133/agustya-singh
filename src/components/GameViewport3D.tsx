import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import {
  DIFF_ORDER,
  DIFFS,
  DifficultyKey,
  FloatingMessage,
  FxType,
  GameMode,
  GamePhase,
  SessionReport,
  SteerInput,
  TelemetryData,
} from '../types/game';
import { audioSynth } from '../utils/audio';

interface GameViewport3DProps {
  phase: GamePhase;
  mode: GameMode;
  difficulty: DifficultyKey;
  isLight: boolean;
  highScore: number;
  autoFire: boolean;
  manualFireRef: React.MutableRefObject<boolean>;
  steerRef: React.MutableRefObject<SteerInput>;
  onTelemetry: (data: TelemetryData) => void;
  onFx: (fx: FxType) => void;
  onFloatMsg: (msg: Omit<FloatingMessage, 'id'>) => void;
  onBossTrigger: () => void;
  onAdvanceDifficulty: (nextDifficulty: DifficultyKey) => void;
  onTriLoopTriumph?: (loopsCompleted: number) => void;
  onGameEnd: (report: SessionReport) => void;
  onUpdateCam: () => void;
  runId: number;
}

type EntityKind =
  | 'orb'
  | 'heal'
  | 'ring'
  | 'purple_ring'
  | 'hazard'
  | 'spike'
  | 'drone'
  | 'boss_shot'
  | 'mystery';

interface WorldEntity {
  id: number;
  kind: EntityKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  hp: number;
  radius: number;
  passed: boolean;
  hitFlash: number;
  spikeSide?: 'bottom' | 'left' | 'right';
  swirlAmpX?: number;
  swirlAmpY?: number;
  swirlFreq?: number;
  swirlPhase?: number;
  age?: number;
  mesh?: THREE.Object3D;
}

interface PlayerBolt {
  x: number;
  y: number;
  z: number;
}

interface LaserBeam {
  x: number;
  y: number;
  z: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  life: number;
}

interface SparkParticle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  color: number;
}

const TUTORIAL_STEPS = [
  'Tilt or steer LEFT and RIGHT to test lateral control',
  'Pitch UP and DOWN to test vertical range of motion',
  'Fly into 2 Cyan Energy Orbs to charge your glider',
  'Blast Alien Drones or dodge 2 Red Laser hazards',
  'Fly through 2 Warp Rings to complete calibration',
];

// Continuous tunnel curve centered at ship plane (z = 2.2)
function tunnelCurveX(z: number, t: number): number {
  const dz = Math.max(0, 2.2 - z);
  return Math.sin(z * 0.032 - t * 1.15) * (dz * dz * 0.00145);
}

function tunnelCurveY(z: number, t: number): number {
  const dz = Math.max(0, 2.2 - z);
  return Math.cos(z * 0.024 - t * 0.85) * (dz * dz * 0.00105);
}

function computeRank(
  score: number,
  xRom: number,
  yRom: number,
  symmetry: number,
  bossDefeated: boolean
): 'S' | 'A' | 'B' | 'C' | 'D' {
  const romAvg = (xRom + yRom) / 2;
  const composite = score * 0.03 + romAvg * 0.6 + symmetry * 0.4 + (bossDefeated ? 35 : 0);
  if (composite >= 145) return 'S';
  if (composite >= 105) return 'A';
  if (composite >= 72) return 'B';
  if (composite >= 45) return 'C';
  return 'D';
}

export const GameViewport3D: React.FC<GameViewport3DProps> = React.memo(({
  phase,
  mode,
  difficulty,
  isLight,
  highScore,
  autoFire,
  manualFireRef,
  steerRef,
  onTelemetry,
  onFx,
  onFloatMsg,
  onBossTrigger,
  onAdvanceDifficulty,
  onTriLoopTriumph,
  onGameEnd,
  onUpdateCam,
  runId,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef({
    phase,
    mode,
    difficulty,
    isLight,
    highScore,
    autoFire,
    onTelemetry,
    onFx,
    onFloatMsg,
    onBossTrigger,
    onAdvanceDifficulty,
    onTriLoopTriumph,
    onGameEnd,
    onUpdateCam,
  });

  propsRef.current = {
    phase,
    mode,
    difficulty,
    isLight,
    highScore,
    autoFire,
    onTelemetry,
    onFx,
    onFloatMsg,
    onBossTrigger,
    onAdvanceDifficulty,
    onTriLoopTriumph,
    onGameEnd,
    onUpdateCam,
  };

  const simRef = useRef({
    shipX: 0,
    shipY: 0,
    shipRoll: 0,
    shipPitch: 0,
    score: 0,
    combo: 1,
    hp: 100,
    maxHp: 100,
    elapsedSec: 0,
    curveTime: 0,
    leftReach: 0,
    rightReach: 0,
    upReach: 0,
    downReach: 0,
    orbsCollected: 0,
    ringsPassed: 0,
    hazardsDodged: 0,
    dronesDestroyed: 0,
    sector: 1,
    bossActive: false,
    bossHp: 100,
    bossMaxHp: 100,
    bossDefeated: false,
    levelDiffKey: 'easy' as DifficultyKey,
    levelScoreStart: 0,
    nextBossScoreTarget: 800,
    bossStage: 1,
    bossesClearedInLevel: 0,
    totalBossesDefeated: 0,
    loopCount: 1,
    omegaPending: false,
    omegaCountdown: 0,
    omegaBossActive: false,
    omegaEnraged: false,
    bossVariant: 0,
    bossVariantApplied: -1,
    bossName: 'CRIMSON SENTINEL',
    bossIntroTimer: 0,
    bossIntroDuration: 2.1,
    bossIntroZ: -44,
    bossIntroScale: 1,
    bossIntroImpactDone: false,
    bossIntroSparkTimer: 0,
    bossIntroBlinkStep: 0,
    bossIntroSubtitle: 'HYPER-WARP TUNNEL SPIRAL',
    bossCooldownTimer: 0,
    bossX: 0,
    bossY: 0,
    bossFireTimer: 1.4,
    bossBurstRemaining: 0,
    bossBurstGapTimer: 0,
    bossBurstCount: 2,
    bossBurstIndex: 0,
    bossBurstPattern: 0,
    bossBurstFlip: 1,
    bossBurstTargets: [] as Array<{ x: number; y: number }>,
    bossHitFlash: 0,
    tutorialStep: 1,
    spawnTimer: 0.4,
    ringTimer: 2.0,
    purpleRingTimer: 15.0,
    rapidFireTimer: 0,
    mysteryTimer: 6.5,
    mysteryEffectType: null as 'overdrive' | 'inverted' | null,
    mysteryEffectKind: null as 'good' | 'bad' | null,
    mysteryEffectLabel: null as string | null,
    mysteryEffectTimer: 0,
    fireTimer: 0,
    shakeTimer: 0,
    triumphTimer: 0,
    triumphSparkTimer: 0,
    hudSyncTimer: 0,
    endlessEscalationTier: 0,
    nextEntityId: 1,
    finished: false,
    entities: [] as WorldEntity[],
    bolts: [] as PlayerBolt[],
    beams: [] as LaserBeam[],
    sparks: [] as SparkParticle[],
  });

  const sceneRefs = useRef<{
    resetPools: (() => void) | null;
  }>({
    resetPools: null,
  });

  useEffect(() => {
    const startDiffKey = propsRef.current.difficulty;
    const startMode = propsRef.current.mode;
    const diff = DIFFS[startDiffKey];
    const s = simRef.current;

    sceneRefs.current.resetPools?.();

    s.shipX = 0;
    s.shipY = 0;
    s.shipRoll = 0;
    s.shipPitch = 0;
    s.score = 0;
    s.combo = 1;
    s.hp = 100;
    s.maxHp = 100;
    s.elapsedSec = 0;
    s.curveTime = 0;
    s.leftReach = 0;
    s.rightReach = 0;
    s.upReach = 0;
    s.downReach = 0;
    s.orbsCollected = 0;
    s.ringsPassed = 0;
    s.hazardsDodged = 0;
    s.dronesDestroyed = 0;
    s.sector = 1;
    s.levelDiffKey = startDiffKey;
    s.levelScoreStart = 0;
    s.nextBossScoreTarget = 800;
    s.bossStage = 1;
    s.bossesClearedInLevel = 0;
    s.totalBossesDefeated = 0;
    s.loopCount = 1;
    s.omegaPending = false;
    s.omegaCountdown = 0;
    s.omegaBossActive = false;
    s.omegaEnraged = false;
    s.bossVariant = 0;
    s.bossVariantApplied = -1;
    s.bossName = 'CRIMSON SENTINEL';
    s.bossIntroDuration = 2.1;
    s.bossIntroTimer = startMode === 'boss' ? 2.1 : 0;
    s.bossIntroZ = startMode === 'boss' ? -125 : -44;
    s.bossIntroScale = startMode === 'boss' ? 0.45 : 1;
    s.bossIntroImpactDone = false;
    s.bossIntroSparkTimer = 0;
    s.bossIntroBlinkStep = 0;
    s.bossIntroSubtitle = 'HYPER-WARP TUNNEL SPIRAL';
    s.bossCooldownTimer = 0;
    s.bossActive = startMode === 'boss';
    s.bossHp = diff.bossHp;
    s.bossMaxHp = diff.bossHp;
    s.bossDefeated = false;
    s.bossX = 0;
    s.bossY = 0.5;
    s.bossFireTimer = 1.4;
    s.bossBurstRemaining = 0;
    s.bossBurstGapTimer = 0;
    s.bossBurstCount = 2;
    s.bossBurstIndex = 0;
    s.bossBurstPattern = 0;
    s.bossBurstFlip = 1;
    s.bossBurstTargets = [];
    s.bossHitFlash = 0;
    s.tutorialStep = 1;
    s.spawnTimer = 0.45;
    s.ringTimer = 1.8;
    s.purpleRingTimer = 15.0;
    s.rapidFireTimer = 0;
    s.mysteryTimer = 6.5;
    s.mysteryEffectType = null;
    s.mysteryEffectKind = null;
    s.mysteryEffectLabel = null;
    s.mysteryEffectTimer = 0;
    s.fireTimer = 0;
    s.shakeTimer = 0;
    s.triumphTimer = 0;
    s.triumphSparkTimer = 0;
    s.hudSyncTimer = 0;
    s.endlessEscalationTier = 0;
    s.finished = false;
    s.entities = [];
    s.bolts = [];
    s.beams = [];
    s.sparks = [];
  }, [runId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const canvas = document.createElement('canvas');
    canvas.className = 'block w-full h-full';
    container.appendChild(canvas);

    const isSoftwareGl = (() => {
      try {
        const probe = document.createElement('canvas');
        const gl = probe.getContext('webgl2') || probe.getContext('webgl');
        if (!gl) return true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const gpu = String(gl.getParameter(param));
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return false;
      }
    })();

    let renderer: THREE.WebGLRenderer | null = null;
    let use2DFallback = false;
    let fallbackCtx: CanvasRenderingContext2D | null = null;

    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: !isSoftwareGl,
        alpha: false,
        powerPreference: 'high-performance',
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(
        container.clientWidth || window.innerWidth,
        container.clientHeight || window.innerHeight
      );
    } catch {
      use2DFallback = true;
      fallbackCtx = canvas.getContext('2d');
    }

    const handleContextLost = (e: Event) => {
      e.preventDefault();
    };
    canvas.addEventListener('webglcontextlost', handleContextLost);

    const scene = new THREE.Scene();
    const darkBg = new THREE.Color(0x050412);
    const lightBg = new THREE.Color(0xe6eff9);
    scene.background = darkBg.clone();
    scene.fog = new THREE.FogExp2(0x050412, 0.013);

    const camera = new THREE.PerspectiveCamera(
      64,
      (container.clientWidth || window.innerWidth) /
        (container.clientHeight || window.innerHeight),
      0.1,
      210
    );
    camera.position.set(0, 0.85, 8.2);

    // Three-point + synthwave rim lighting
    const ambient = new THREE.AmbientLight(0xc2d8ff, 0.9);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
    keyLight.position.set(8, 14, 10);
    scene.add(keyLight);

    const rimLight = new THREE.PointLight(0xff2a85, 2.4, 55);
    rimLight.position.set(-4, 4, -8);
    scene.add(rimLight);

    const cyanLight = new THREE.PointLight(0x00f0ff, 2.2, 55);
    cyanLight.position.set(4, -3, 2);
    scene.add(cyanLight);

    // Operius-style Polygonal Octagonal Wireframe Tunnel
    const RIB_COUNT = 24;
    const RIB_SPACING = 5.5;
    const TUNNEL_RADIUS = 9.8;
    const tunnelRibs: THREE.Mesh[] = [];
    const ribGeo = new THREE.TorusGeometry(TUNNEL_RADIUS, 0.085, 4, 8);
    const ribMatPrimary = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.42,
    });
    const ribMatSecondary = new THREE.MeshBasicMaterial({
      color: 0xd946ef,
      transparent: true,
      opacity: 0.34,
    });

    for (let i = 0; i < RIB_COUNT; i += 1) {
      const m = new THREE.Mesh(ribGeo, i % 2 === 0 ? ribMatPrimary : ribMatSecondary);
      m.rotation.z = Math.PI / 8;
      m.position.z = 8 - i * RIB_SPACING;
      scene.add(m);
      tunnelRibs.push(m);
    }

    // 8 Longitudinal Synthwave Corridor Rails
    const RAIL_VERTS = 8;
    const RAIL_STEPS = 26;
    const railLines: THREE.Line[] = [];
    const railMat = new THREE.LineBasicMaterial({
      color: 0x7c3aed,
      transparent: true,
      opacity: 0.45,
    });
    for (let r = 0; r < RAIL_VERTS; r += 1) {
      const positions = new Float32Array(RAIL_STEPS * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const line = new THREE.Line(geo, railMat);
      scene.add(line);
      railLines.push(line);
    }

    // Cosmic Nebula Wall Clouds along the 8 octagonal tunnel walls
    const createNebulaWallTex = (
      stops: Array<[string, string, string]>,
      seedOffset: number
    ): THREE.CanvasTexture => {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 256;
      const g = c.getContext('2d');
      if (g) {
        g.clearRect(0, 0, 256, 256);
        for (let i = 0; i < stops.length; i += 1) {
          const [inner, mid, outer] = stops[i];
          const px = 128 + Math.sin(seedOffset + i * 2.1) * 44;
          const py = 128 + Math.cos(seedOffset + i * 1.7) * 42;
          const rad = 74 + (i % 3) * 24;
          const grad = g.createRadialGradient(px, py, 6, px, py, rad);
          grad.addColorStop(0, inner);
          grad.addColorStop(0.45, mid);
          grad.addColorStop(1, outer);
          g.fillStyle = grad;
          g.fillRect(0, 0, 256, 256);
        }

        // Tiny cosmic starlight dust specks inside nebula cloud
        for (let s = 0; s < 36; s += 1) {
          const sx = 34 + ((Math.sin(s * 17.3 + seedOffset) * 0.5 + 0.5) * 188);
          const sy = 34 + ((Math.cos(s * 23.7 + seedOffset) * 0.5 + 0.5) * 188);
          const sr = 0.8 + (s % 3) * 0.65;
          g.fillStyle = s % 2 === 0 ? 'rgba(255, 255, 255, 0.72)' : 'rgba(186, 230, 253, 0.65)';
          g.beginPath();
          g.arc(sx, sy, sr, 0, Math.PI * 2);
          g.fill();
        }

        // Smooth edge feathering mask so wall clouds blend seamlessly
        g.globalCompositeOperation = 'destination-in';
        const mask = g.createRadialGradient(128, 128, 22, 128, 128, 124);
        mask.addColorStop(0, 'rgba(255,255,255,1)');
        mask.addColorStop(0.62, 'rgba(255,255,255,0.72)');
        mask.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = mask;
        g.fillRect(0, 0, 256, 256);
        g.globalCompositeOperation = 'source-over';
      }
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    };

    const nebulaTextures = [
      createNebulaWallTex(
        [
          ['rgba(217, 70, 239, 0.78)', 'rgba(124, 58, 237, 0.36)', 'rgba(124, 58, 237, 0)'],
          ['rgba(255, 42, 133, 0.65)', 'rgba(168, 85, 247, 0.25)', 'rgba(168, 85, 247, 0)'],
          ['rgba(56, 189, 248, 0.42)', 'rgba(59, 130, 246, 0.16)', 'rgba(59, 130, 246, 0)'],
        ],
        0.4
      ),
      createNebulaWallTex(
        [
          ['rgba(0, 240, 255, 0.74)', 'rgba(14, 165, 233, 0.34)', 'rgba(14, 165, 233, 0)'],
          ['rgba(99, 102, 241, 0.60)', 'rgba(139, 92, 246, 0.24)', 'rgba(139, 92, 246, 0)'],
          ['rgba(16, 185, 129, 0.38)', 'rgba(6, 182, 212, 0.14)', 'rgba(6, 182, 212, 0)'],
        ],
        2.1
      ),
      createNebulaWallTex(
        [
          ['rgba(168, 85, 247, 0.76)', 'rgba(192, 38, 211, 0.32)', 'rgba(192, 38, 211, 0)'],
          ['rgba(244, 114, 182, 0.56)', 'rgba(236, 72, 153, 0.22)', 'rgba(236, 72, 153, 0)'],
          ['rgba(0, 240, 255, 0.48)', 'rgba(56, 189, 248, 0.18)', 'rgba(56, 189, 248, 0)'],
        ],
        4.3
      ),
    ];

    const nebulaMats = nebulaTextures.map(
      (tex) =>
        new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          opacity: 0.48,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
    );

    const nebulaWallGeo = new THREE.PlaneGeometry(28, 10.6);
    nebulaWallGeo.rotateY(Math.PI / 2);

    const NEBULA_DEPTH_BANDS = 4;
    const NEBULA_WALL_SPAN = 136;
    const NEBULA_WALL_RADIUS = TUNNEL_RADIUS * 0.92;
    const nebulaPanels: Array<{ mesh: THREE.Mesh; angle: number; baseZ: number }> = [];

    for (let band = 0; band < NEBULA_DEPTH_BANDS; band += 1) {
      for (let f = 0; f < RAIL_VERTS; f += 1) {
        const faceAngle = (f / RAIL_VERTS) * Math.PI * 2;
        const mat = nebulaMats[(band + f) % nebulaMats.length];
        const panel = new THREE.Mesh(nebulaWallGeo, mat);
        const z = 12 - band * (NEBULA_WALL_SPAN / NEBULA_DEPTH_BANDS) - (f % 2) * 14;
        panel.position.set(
          Math.cos(faceAngle) * NEBULA_WALL_RADIUS,
          Math.sin(faceAngle) * NEBULA_WALL_RADIUS,
          z
        );
        panel.rotation.z = faceAngle;
        scene.add(panel);
        nebulaPanels.push({ mesh: panel, angle: faceAngle, baseZ: z });
      }
    }

    // High-speed Warp Starfield
    const starCount = 560;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 10.5 + Math.random() * 24;
      starPositions[i * 3] = Math.cos(angle) * radius;
      starPositions[i * 3 + 1] = Math.sin(angle) * radius;
      starPositions[i * 3 + 2] = -Math.random() * 140;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xc4b5fd,
      size: 0.25,
      transparent: true,
      opacity: 0.85,
    });
    const starField = new THREE.Points(starGeo, starMat);
    scene.add(starField);

    // Player 3D Interceptor Glider with Twin Wing Cannons
    const shipGroup = new THREE.Group();
    const hullMat = new THREE.MeshStandardMaterial({
      color: 0xeaf6ff,
      metalness: 0.7,
      roughness: 0.22,
      emissive: 0x0a2848,
      emissiveIntensity: 0.45,
    });
    const wingAccentMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00d0ff,
      emissiveIntensity: 0.9,
      metalness: 0.4,
      roughness: 0.2,
    });

    const fuselage = new THREE.Mesh(new THREE.ConeGeometry(0.4, 2.25, 6), hullMat);
    fuselage.rotation.x = -Math.PI / 2;
    shipGroup.add(fuselage);

    const wings = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.08, 0.78), hullMat);
    wings.position.z = 0.25;
    shipGroup.add(wings);

    const leftCannon = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 1.05), wingAccentMat);
    leftCannon.position.set(-1.1, 0.04, 0.08);
    shipGroup.add(leftCannon);

    const rightCannon = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 1.05), wingAccentMat);
    rightCannon.position.set(1.1, 0.04, 0.08);
    shipGroup.add(rightCannon);

    const cockpit = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 16, 12),
      new THREE.MeshStandardMaterial({
        color: 0xff2a85,
        emissive: 0xff2a85,
        emissiveIntensity: 0.7,
        roughness: 0.12,
      })
    );
    cockpit.scale.set(0.85, 0.65, 1.5);
    cockpit.position.set(0, 0.22, -0.15);
    shipGroup.add(cockpit);

    const thruster = new THREE.Mesh(
      new THREE.TorusGeometry(0.24, 0.07, 10, 20),
      wingAccentMat
    );
    thruster.position.z = 1.12;
    shipGroup.add(thruster);

    shipGroup.position.set(0, 0, 2.2);
    scene.add(shipGroup);

    // Boss: Dynamic Multi-Variant Overlord Arsenal (every boss has unique silhouette, palette & entrance animation)
    const BOSS_ARCHETYPES = [
      { name: 'CRIMSON SENTINEL', coreColor: 0xff2a6d, ringColor: 0xff7a00, accentColor: 0xffd13b, introSubtitle: 'HYPER-WARP TUNNEL SPIRAL' },
      { name: 'SOLAR OVERLORD', coreColor: 0xff6b00, ringColor: 0xffd13b, accentColor: 0xff2a6d, introSubtitle: 'SOLAR FLARE GYRO DESCENT' },
      { name: 'VIOLET LEVIATHAN', coreColor: 0x9333ea, ringColor: 0x00f0ff, accentColor: 0xf472b6, introSubtitle: 'SERPENTINE PHASE WEAVE' },
      { name: 'EMERALD HIVE-MIND', coreColor: 0x10b981, ringColor: 0xfacc15, accentColor: 0x00f59b, introSubtitle: 'BIO-SWARM VORTEX MATERIALIZE' },
      { name: 'COBALT DREADNOUGHT', coreColor: 0x2563eb, ringColor: 0xf43f5e, accentColor: 0x38bdf8, introSubtitle: 'ORBITAL MONOLITH DROP-LOCK' },
      { name: 'MAGENTA PHANTOM', coreColor: 0xec4899, ringColor: 0xc026d3, accentColor: 0xfef08a, introSubtitle: 'TRI-BLINK MIRAGE ASSAULT' },
      { name: 'MAGMA COLOSSUS', coreColor: 0xea580c, ringColor: 0xfde047, accentColor: 0xff1133, introSubtitle: 'VOLCANIC CORE SPIRE BREACH' },
      { name: 'HYPERION SINGULARITY', coreColor: 0x06b6d4, ringColor: 0xf472b6, accentColor: 0xffffff, introSubtitle: 'GRAVITY COLLAPSE IMPLOSION' },
    ];

    const bossGroup = new THREE.Group();
    const bossCoreMat = new THREE.MeshStandardMaterial({
      color: 0xff2a6d,
      emissive: 0xff1144,
      emissiveIntensity: 0.9,
      roughness: 0.2,
      metalness: 0.55,
    });
    const bossRingMat = new THREE.MeshStandardMaterial({
      color: 0xff7a00,
      emissive: 0xff5500,
      emissiveIntensity: 0.8,
      roughness: 0.25,
      metalness: 0.45,
    });
    const bossAccentMat = new THREE.MeshStandardMaterial({
      color: 0xffd13b,
      emissive: 0xffb800,
      emissiveIntensity: 0.85,
      roughness: 0.2,
      metalness: 0.65,
    });
    const bossWireMat = new THREE.LineBasicMaterial({ color: 0xffffff });

    // Pre-allocated shared boss part geometries (reused cleanly across variants)
    const bossPartGeos = {
      octa: new THREE.OctahedronGeometry(2.75, 0),
      dodeca: new THREE.DodecahedronGeometry(2.65, 0),
      icosa: new THREE.IcosahedronGeometry(2.65, 1),
      tetra: new THREE.TetrahedronGeometry(3.0, 0),
      boxCore: new THREE.BoxGeometry(3.4, 3.0, 3.2),
      prism: new THREE.CylinderGeometry(1.75, 2.35, 4.8, 6),
      knot: new THREE.TorusKnotGeometry(1.95, 0.55, 64, 10, 2, 3),
      ringInner: new THREE.TorusGeometry(3.85, 0.18, 8, 12),
      ringOuter: new THREE.TorusGeometry(4.85, 0.14, 8, 16),
      ringHex: new THREE.TorusGeometry(4.35, 0.16, 6, 6),
      spike: new THREE.ConeGeometry(0.55, 2.1, 5),
      wing: new THREE.BoxGeometry(3.2, 0.24, 1.5),
      pod: new THREE.CylinderGeometry(0.42, 0.42, 2.4, 8),
      satellite: new THREE.OctahedronGeometry(0.72, 0),
      cageIcosa: new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(4.1, 0)),
      cageBox: new THREE.EdgesGeometry(new THREE.BoxGeometry(4.6, 4.1, 4.4)),
    };
    bossPartGeos.pod.rotateX(Math.PI / 2);

    const _cCore = new THREE.Color();
    const _cRing = new THREE.Color();
    const _cAccent = new THREE.Color();

    const applyBossAppearance = (tier: number, isOmega: boolean) => {
      while (bossGroup.children.length > 0) {
        bossGroup.remove(bossGroup.children[0]);
      }

      const arch = isOmega
        ? { name: 'OMEGA OVERLORD', coreColor: 0xff0044, ringColor: 0xffd13b, accentColor: 0x00f0ff }
        : BOSS_ARCHETYPES[tier % BOSS_ARCHETYPES.length];

      // Subtle loop hue shift on Loop 2+ so every boss encounter looks distinct
      const loopCycle = isOmega ? 0 : Math.floor(tier / BOSS_ARCHETYPES.length);
      _cCore.setHex(arch.coreColor);
      _cRing.setHex(arch.ringColor);
      _cAccent.setHex(arch.accentColor);
      if (loopCycle > 0) {
        _cCore.offsetHSL((loopCycle * 0.17) % 1, 0, 0);
        _cRing.offsetHSL((loopCycle * 0.23) % 1, 0, 0);
        _cAccent.offsetHSL((loopCycle * 0.31) % 1, 0, 0);
      }

      bossCoreMat.color.copy(_cCore);
      bossCoreMat.emissive.copy(_cCore);
      bossRingMat.color.copy(_cRing);
      bossRingMat.emissive.copy(_cRing);
      bossAccentMat.color.copy(_cAccent);
      bossAccentMat.emissive.copy(_cAccent);
      bossWireMat.color.copy(_cAccent);

      const variant = isOmega ? 8 : tier % 8;
      const addSpinPart = (obj: THREE.Object3D, ax: 'x' | 'y' | 'z', speed: number) => {
        obj.userData.spinAxis = ax;
        obj.userData.spinSpeed = speed;
        bossGroup.add(obj);
      };

      if (variant === 0) {
        // Crimson Sentinel: Octahedron core + dual tilted rings + 4 cardinal pylons
        addSpinPart(new THREE.Mesh(bossPartGeos.octa, bossCoreMat), 'y', 1.5);
        addSpinPart(new THREE.Mesh(bossPartGeos.ringInner, bossRingMat), 'z', 1.8);
        const r2 = new THREE.Mesh(bossPartGeos.ringOuter, bossAccentMat);
        r2.rotation.x = Math.PI / 3;
        addSpinPart(r2, 'y', -2.0);
        for (let k = 0; k < 4; k += 1) {
          const a = (k / 4) * Math.PI * 2;
          const sp = new THREE.Mesh(bossPartGeos.spike, bossAccentMat);
          sp.position.set(Math.cos(a) * 3.3, Math.sin(a) * 3.3, 0);
          sp.rotation.z = a - Math.PI / 2;
          addSpinPart(sp, 'z', 0);
        }
      } else if (variant === 1) {
        // Solar Overlord: Dodecahedron reactor + 3 gyro rings + 6 sun-horns
        addSpinPart(new THREE.Mesh(bossPartGeos.dodeca, bossCoreMat), 'y', 1.4);
        for (let r = 0; r < 3; r += 1) {
          const ring = new THREE.Mesh(bossPartGeos.ringInner, r === 1 ? bossAccentMat : bossRingMat);
          ring.rotation.set(r * 0.75, r * 0.9, 0);
          addSpinPart(ring, r % 2 === 0 ? 'z' : 'x', (r % 2 === 0 ? 1 : -1) * 2.1);
        }
        for (let k = 0; k < 6; k += 1) {
          const a = (k / 6) * Math.PI * 2;
          const sp = new THREE.Mesh(bossPartGeos.spike, bossRingMat);
          sp.position.set(Math.cos(a) * 3.5, Math.sin(a) * 3.5, 0);
          sp.rotation.z = a - Math.PI / 2;
          bossGroup.add(sp);
        }
      } else if (variant === 2) {
        // Violet Leviathan: Tall hex crystal prism + swept cyber wings + vertical halo
        addSpinPart(new THREE.Mesh(bossPartGeos.prism, bossCoreMat), 'y', 1.7);
        const lw = new THREE.Mesh(bossPartGeos.wing, bossRingMat);
        lw.position.set(-3.2, 0.2, 0);
        lw.rotation.z = 0.35;
        bossGroup.add(lw);
        const rw = new THREE.Mesh(bossPartGeos.wing, bossRingMat);
        rw.position.set(3.2, 0.2, 0);
        rw.rotation.z = -0.35;
        bossGroup.add(rw);
        const halo = new THREE.Mesh(bossPartGeos.ringHex, bossAccentMat);
        halo.rotation.y = Math.PI / 2;
        addSpinPart(halo, 'x', 2.3);
      } else if (variant === 3) {
        // Emerald Hive-Mind: TorusKnot bio-core + 4 orbiting satellites + twin rings
        addSpinPart(new THREE.Mesh(bossPartGeos.knot, bossCoreMat), 'z', 1.6);
        addSpinPart(new THREE.Mesh(bossPartGeos.ringOuter, bossRingMat), 'z', -1.8);
        const satGroup = new THREE.Group();
        for (let k = 0; k < 4; k += 1) {
          const a = (k / 4) * Math.PI * 2;
          const sat = new THREE.Mesh(bossPartGeos.satellite, bossAccentMat);
          sat.position.set(Math.cos(a) * 4.2, Math.sin(a) * 4.2, 0);
          satGroup.add(sat);
        }
        addSpinPart(satGroup, 'z', 2.4);
      } else if (variant === 4) {
        // Cobalt Dreadnought: Armored monolith + wireframe cage + twin side cannon pods + X-blades
        addSpinPart(new THREE.Mesh(bossPartGeos.boxCore, bossCoreMat), 'y', 0.9);
        addSpinPart(new THREE.LineSegments(bossPartGeos.cageBox, bossWireMat), 'y', -0.9);
        for (const sx of [-3.1, 3.1]) {
          const pod = new THREE.Mesh(bossPartGeos.pod, bossRingMat);
          pod.position.set(sx, 0, 0.5);
          bossGroup.add(pod);
        }
        const bladeGroup = new THREE.Group();
        for (const ang of [Math.PI / 4, -Math.PI / 4]) {
          const bl = new THREE.Mesh(bossPartGeos.wing, bossAccentMat);
          bl.scale.set(1.5, 1, 0.6);
          bl.rotation.z = ang;
          bladeGroup.add(bl);
        }
        addSpinPart(bladeGroup, 'z', 2.2);
      } else if (variant === 5) {
        // Magenta Phantom: Sharp Tetrahedron core + 3 slanted plasma rings + 6 fins
        addSpinPart(new THREE.Mesh(bossPartGeos.tetra, bossCoreMat), 'y', 2.2);
        for (let r = 0; r < 3; r += 1) {
          const ring = new THREE.Mesh(bossPartGeos.ringHex, r === 0 ? bossRingMat : bossAccentMat);
          ring.rotation.set(0.6 + r * 0.65, r * 0.7, 0);
          addSpinPart(ring, 'y', (r % 2 === 0 ? 1 : -1) * 2.4);
        }
      } else if (variant === 6) {
        // Magma Colossus: Triple-stacked Octa-Spire + icosahedron wire cage + heavy rings
        const spireGroup = new THREE.Group();
        const centerOct = new THREE.Mesh(bossPartGeos.octa, bossCoreMat);
        const topOct = new THREE.Mesh(bossPartGeos.satellite, bossAccentMat);
        topOct.scale.setScalar(1.65);
        topOct.position.y = 3.1;
        const botOct = new THREE.Mesh(bossPartGeos.satellite, bossAccentMat);
        botOct.scale.setScalar(1.65);
        botOct.position.y = -3.1;
        spireGroup.add(centerOct, topOct, botOct);
        addSpinPart(spireGroup, 'y', 1.8);
        addSpinPart(new THREE.LineSegments(bossPartGeos.cageIcosa, bossWireMat), 'x', 1.1);
        const rMag = new THREE.Mesh(bossPartGeos.ringOuter, bossRingMat);
        rMag.rotation.x = Math.PI / 2.3;
        addSpinPart(rMag, 'z', -2.0);
      } else if (variant === 7) {
        // Hyperion Singularity: Geodesic Icosahedron + 4 orbital discs + 8 outer prism nodes
        addSpinPart(new THREE.Mesh(bossPartGeos.icosa, bossCoreMat), 'y', 1.6);
        const nodeGroup = new THREE.Group();
        for (let k = 0; k < 8; k += 1) {
          const a = (k / 8) * Math.PI * 2;
          const node = new THREE.Mesh(bossPartGeos.satellite, bossAccentMat);
          node.position.set(Math.cos(a) * 4.5, Math.sin(a) * 4.5, 0);
          nodeGroup.add(node);
        }
        addSpinPart(nodeGroup, 'z', -2.2);
        const rA = new THREE.Mesh(bossPartGeos.ringInner, bossRingMat);
        rA.rotation.x = Math.PI / 4;
        addSpinPart(rA, 'y', 2.4);
        const rB = new THREE.Mesh(bossPartGeos.ringOuter, bossAccentMat);
        rB.rotation.y = Math.PI / 4;
        addSpinPart(rB, 'x', -2.4);
      } else {
        // Variant 8 — APEX OMEGA OVERLORD (2,000 HP Final Boss)
        addSpinPart(new THREE.Mesh(bossPartGeos.icosa, bossCoreMat), 'y', 2.0);
        addSpinPart(new THREE.Mesh(bossPartGeos.knot, bossAccentMat), 'z', -2.2);
        addSpinPart(new THREE.LineSegments(bossPartGeos.cageIcosa, bossWireMat), 'y', 1.2);
        const r1 = new THREE.Mesh(bossPartGeos.ringInner, bossRingMat);
        addSpinPart(r1, 'z', 2.6);
        const r2 = new THREE.Mesh(bossPartGeos.ringOuter, bossAccentMat);
        r2.rotation.x = Math.PI / 3;
        addSpinPart(r2, 'y', -2.8);
        const crownGroup = new THREE.Group();
        for (let k = 0; k < 6; k += 1) {
          const a = (k / 6) * Math.PI * 2;
          const sp = new THREE.Mesh(bossPartGeos.spike, bossRingMat);
          sp.scale.setScalar(1.3);
          sp.position.set(Math.cos(a) * 4.3, Math.sin(a) * 4.3, 0);
          sp.rotation.z = a - Math.PI / 2;
          const pod = new THREE.Mesh(bossPartGeos.pod, bossAccentMat);
          pod.position.set(Math.cos(a) * 3.2, Math.sin(a) * 3.2, 0.7);
          crownGroup.add(sp, pod);
        }
        addSpinPart(crownGroup, 'z', 1.35);
      }
    };

    applyBossAppearance(0, false);
    bossGroup.position.set(0, 0.5, -46);
    bossGroup.visible = false;
    scene.add(bossGroup);

    const entityGroup = new THREE.Group();
    scene.add(entityGroup);

    const fxGroup = new THREE.Group();
    scene.add(fxGroup);

    // Entity Geometries & Materials
    const orbGeo = new THREE.OctahedronGeometry(0.62, 1);
    const orbMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00d4ff,
      emissiveIntensity: 0.95,
      roughness: 0.15,
    });
    const healGeo = new THREE.OctahedronGeometry(0.68, 0);
    const healMat = new THREE.MeshStandardMaterial({
      color: 0xffd13b,
      emissive: 0xffb800,
      emissiveIntensity: 0.95,
      roughness: 0.15,
    });
    const gateGeo = new THREE.TorusGeometry(2.5, 0.14, 6, 8);
    const gateMat = new THREE.MeshStandardMaterial({
      color: 0x00f59b,
      emissive: 0x00f59b,
      emissiveIntensity: 0.85,
    });
    const purpleGateOuterGeo = new THREE.TorusGeometry(2.45, 0.16, 8, 12);
    const purpleGateOuterMat = new THREE.MeshStandardMaterial({
      color: 0xa855f7,
      emissive: 0xc026d3,
      emissiveIntensity: 1.05,
      roughness: 0.18,
    });
    const purpleGateInnerGeo = new THREE.TorusGeometry(1.98, 0.08, 6, 16);
    const purpleGateInnerMat = new THREE.MeshStandardMaterial({
      color: 0xf0abfc,
      emissive: 0xe879f9,
      emissiveIntensity: 0.95,
      roughness: 0.18,
    });
    const hazardGeo = new THREE.BoxGeometry(1.45, 2.35, 1.05);
    const hazardMat = new THREE.MeshStandardMaterial({
      color: 0xff2244,
      emissive: 0xff1133,
      emissiveIntensity: 0.9,
      roughness: 0.25,
    });
    const droneGeo = new THREE.OctahedronGeometry(1.05, 0);
    const droneMat = new THREE.MeshStandardMaterial({
      color: 0xd946ef,
      emissive: 0xa21caf,
      emissiveIntensity: 0.95,
      roughness: 0.2,
    });
    const droneFlashMat = new THREE.MeshStandardMaterial({
      color: 0xd946ef,
      emissive: 0xffffff,
      emissiveIntensity: 1.0,
      roughness: 0.2,
    });
    const droneWireGeo = new THREE.EdgesGeometry(droneGeo);
    const droneWireMat = new THREE.LineBasicMaterial({ color: 0xf5d0fe });
    const shotGeo = new THREE.SphereGeometry(0.55, 10, 10);
    const shotMat = new THREE.MeshBasicMaterial({ color: 0xff3355 });
    const spikeConeGeo = new THREE.ConeGeometry(0.88, 3.8, 5);
    const spikeSubGeo = new THREE.ConeGeometry(0.46, 2.35, 5);
    const spikeBaseGeo = new THREE.BoxGeometry(2.5, 0.44, 1.8);
    const spikeMat = new THREE.MeshStandardMaterial({
      color: 0xff3b1f,
      emissive: 0xff1e38,
      emissiveIntensity: 0.95,
      metalness: 0.55,
      roughness: 0.2,
    });
    const spikeBaseMat = new THREE.MeshStandardMaterial({
      color: 0x3b0a18,
      emissive: 0xff2244,
      emissiveIntensity: 0.65,
      metalness: 0.7,
      roughness: 0.25,
    });
    const spikeWireGeo = new THREE.EdgesGeometry(spikeConeGeo);
    const spikeWireMat = new THREE.LineBasicMaterial({ color: 0xffd13b });

    // Procedural '?' CanvasTexture + composite 3-part Mystery Box assets
    const mysteryCanvas = document.createElement('canvas');
    mysteryCanvas.width = 256;
    mysteryCanvas.height = 256;
    const mCtx = mysteryCanvas.getContext('2d');
    if (mCtx) {
      const grad = mCtx.createLinearGradient(0, 0, 256, 256);
      grad.addColorStop(0, '#311068');
      grad.addColorStop(0.5, '#5b21b6');
      grad.addColorStop(1, '#1e1b4b');
      mCtx.fillStyle = grad;
      mCtx.fillRect(0, 0, 256, 256);

      // Subtle diagonal tech lines
      mCtx.strokeStyle = 'rgba(0, 240, 255, 0.2)';
      mCtx.lineWidth = 4;
      for (let d = -256; d < 512; d += 32) {
        mCtx.beginPath();
        mCtx.moveTo(d, 0);
        mCtx.lineTo(d + 256, 256);
        mCtx.stroke();
      }

      // Golden metallic border bevel
      mCtx.strokeStyle = '#ffd13b';
      mCtx.lineWidth = 14;
      mCtx.strokeRect(12, 12, 232, 232);
      mCtx.strokeStyle = 'rgba(0, 240, 255, 0.75)';
      mCtx.lineWidth = 4;
      mCtx.strokeRect(26, 26, 204, 204);

      // Glowing '?' emblem
      mCtx.textAlign = 'center';
      mCtx.textBaseline = 'middle';
      mCtx.font = 'bold 156px system-ui, -apple-system, sans-serif';
      mCtx.fillStyle = 'rgba(255, 209, 59, 0.35)';
      mCtx.fillText('?', 132, 138);
      mCtx.fillStyle = '#fef08a';
      mCtx.fillText('?', 128, 134);
    }
    const mysteryTex = new THREE.CanvasTexture(mysteryCanvas);
    mysteryTex.colorSpace = THREE.SRGBColorSpace;
    if (renderer) {
      mysteryTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    }
    const mysteryCubeGeo = new THREE.BoxGeometry(1.42, 1.42, 1.42);
    const mysteryMat = new THREE.MeshStandardMaterial({
      map: mysteryTex,
      emissive: 0x6d28d9,
      emissiveIntensity: 0.45,
      roughness: 0.25,
      metalness: 0.35,
    });
    const mysteryWireGeo = new THREE.EdgesGeometry(mysteryCubeGeo);
    const mysteryWireMat = new THREE.LineBasicMaterial({ color: 0xffd13b });
    const mysteryRingGeo = new THREE.TorusGeometry(1.18, 0.055, 8, 24);
    const mysteryRingMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00d4ff,
      emissiveIntensity: 0.85,
      roughness: 0.2,
      metalness: 0.6,
    });

    const boltGeo = new THREE.BoxGeometry(0.14, 0.14, 2.4);
    const boltMat = new THREE.MeshBasicMaterial({ color: 0x00f5ff });

    const beamGeo = new THREE.CylinderGeometry(0.14, 0.14, 7, 8);
    beamGeo.rotateX(Math.PI / 2);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    const sparkGeo = new THREE.BoxGeometry(0.24, 0.24, 0.24);
    const sparkPoolMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    // GPU InstancedMesh Pools (1 draw call each, zero runtime mesh/material allocations)
    const MAX_BOLTS = 128;
    const boltInstanced = new THREE.InstancedMesh(boltGeo, boltMat, MAX_BOLTS);
    boltInstanced.frustumCulled = false;
    boltInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    boltInstanced.count = 0;
    fxGroup.add(boltInstanced);

    const MAX_BEAMS = 32;
    const beamInstanced = new THREE.InstancedMesh(beamGeo, beamMat, MAX_BEAMS);
    beamInstanced.frustumCulled = false;
    beamInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    beamInstanced.count = 0;
    fxGroup.add(beamInstanced);

    const MAX_SPARKS = 360;
    const sparkInstanced = new THREE.InstancedMesh(sparkGeo, sparkPoolMat, MAX_SPARKS);
    sparkInstanced.frustumCulled = false;
    sparkInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const sparkColorArr = new Float32Array(MAX_SPARKS * 3);
    sparkColorArr.fill(1);
    sparkInstanced.instanceColor = new THREE.InstancedBufferAttribute(sparkColorArr, 3);
    sparkInstanced.instanceColor.setUsage(THREE.DynamicDrawUsage);
    sparkInstanced.count = 0;
    fxGroup.add(sparkInstanced);

    // Reusable Entity Mesh Pools by EntityKind (zero runtime mesh creation/disposal GC)
    const entityMeshPools: Record<EntityKind, THREE.Object3D[]> = {
      orb: [],
      heal: [],
      ring: [],
      purple_ring: [],
      mystery: [],
      drone: [],
      boss_shot: [],
      spike: [],
      hazard: [],
    };

    const createEntityMesh = (kind: EntityKind): THREE.Object3D => {
      if (kind === 'orb') {
        return new THREE.Mesh(orbGeo, orbMat);
      }
      if (kind === 'heal') {
        return new THREE.Mesh(healGeo, healMat);
      }
      if (kind === 'ring') {
        const m = new THREE.Mesh(gateGeo, gateMat);
        m.rotation.z = Math.PI / 8;
        return m;
      }
      if (kind === 'purple_ring') {
        const g = new THREE.Group();
        const outer = new THREE.Mesh(purpleGateOuterGeo, purpleGateOuterMat);
        const inner = new THREE.Mesh(purpleGateInnerGeo, purpleGateInnerMat);
        outer.rotation.z = Math.PI / 12;
        g.add(outer, inner);
        return g;
      }
      if (kind === 'mystery') {
        const g = new THREE.Group();
        const boxMesh = new THREE.Mesh(mysteryCubeGeo, mysteryMat);
        const wireMesh = new THREE.LineSegments(mysteryWireGeo, mysteryWireMat);
        wireMesh.scale.setScalar(1.07);
        const haloRing = new THREE.Mesh(mysteryRingGeo, mysteryRingMat);
        haloRing.rotation.x = Math.PI / 3;
        g.add(boxMesh, wireMesh, haloRing);
        return g;
      }
      if (kind === 'drone') {
        const g = new THREE.Group();
        const body = new THREE.Mesh(droneGeo, droneMat);
        const wire = new THREE.LineSegments(droneWireGeo, droneWireMat);
        wire.scale.setScalar(1.08);
        g.add(body, wire);
        return g;
      }
      if (kind === 'boss_shot') {
        return new THREE.Mesh(shotGeo, shotMat);
      }
      if (kind === 'spike') {
        const g = new THREE.Group();
        const mainSpike = new THREE.Mesh(spikeConeGeo, spikeMat);
        const wire = new THREE.LineSegments(spikeWireGeo, spikeWireMat);
        wire.scale.setScalar(1.03);
        const leftSpur = new THREE.Mesh(spikeSubGeo, spikeMat);
        leftSpur.position.set(-0.78, -0.55, 0);
        leftSpur.rotation.z = 0.26;
        const rightSpur = new THREE.Mesh(spikeSubGeo, spikeMat);
        rightSpur.position.set(0.78, -0.55, 0);
        rightSpur.rotation.z = -0.26;
        const basePlate = new THREE.Mesh(spikeBaseGeo, spikeBaseMat);
        basePlate.position.set(0, -1.78, 0);
        g.add(mainSpike, wire, leftSpur, rightSpur, basePlate);
        return g;
      }
      return new THREE.Mesh(hazardGeo, hazardMat);
    };

    const acquireEntityMesh = (
      kind: EntityKind,
      spikeSide?: 'bottom' | 'left' | 'right'
    ): THREE.Object3D => {
      const pool = entityMeshPools[kind];
      let mesh = pool.pop();
      if (!mesh) {
        mesh = createEntityMesh(kind);
        entityGroup.add(mesh);
      }
      mesh.rotation.set(0, 0, kind === 'ring' ? Math.PI / 8 : 0);
      if (kind === 'spike') {
        mesh.rotation.z =
          spikeSide === 'left' ? -Math.PI / 2 : spikeSide === 'right' ? Math.PI / 2 : 0;
      } else if (kind === 'drone') {
        const firstChild = mesh.children[0] as THREE.Mesh | undefined;
        if (firstChild) firstChild.material = droneMat;
      }
      mesh.visible = true;
      return mesh;
    };

    const releaseEntityMesh = (ent: WorldEntity) => {
      if (!ent.mesh) return;
      ent.mesh.visible = false;
      entityMeshPools[ent.kind].push(ent.mesh);
      ent.mesh = undefined;
    };

    sceneRefs.current.resetPools = () => {
      const s = simRef.current;
      for (let i = 0; i < s.entities.length; i += 1) {
        releaseEntityMesh(s.entities[i]);
      }
      boltInstanced.count = 0;
      beamInstanced.count = 0;
      sparkInstanced.count = 0;
    };

    // Pre-warm entity pools & compile shaders upfront so first spawns never hitch
    if (!use2DFallback) {
      const warmCounts: Array<[EntityKind, number]> = [
        ['orb', 8],
        ['heal', 4],
        ['ring', 4],
        ['purple_ring', 2],
        ['mystery', 3],
        ['drone', 10],
        ['boss_shot', 24],
        ['spike', 6],
        ['hazard', 10],
      ];
      for (const [kind, cnt] of warmCounts) {
        for (let k = 0; k < cnt; k += 1) {
          const m = createEntityMesh(kind);
          m.position.set(0, 0, -180);
          m.visible = k === 0;
          entityGroup.add(m);
          entityMeshPools[kind].push(m);
        }
      }
      if (renderer && !isSoftwareGl) {
        renderer.compile(scene, camera);
      }
      for (const kind of Object.keys(entityMeshPools) as EntityKind[]) {
        for (const m of entityMeshPools[kind]) {
          m.visible = false;
        }
      }
    }

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (renderer) {
        renderer.setSize(w, h);
      } else {
        canvas.width = w;
        canvas.height = h;
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();

    // Pre-allocated math helpers (zero allocations in per-frame loop)
    const _projVec = new THREE.Vector3();
    const _dummyObj = new THREE.Object3D();
    const _tmpColor = new THREE.Color();

    const projectToScreenPct = (wx: number, wy: number, wz: number) => {
      _projVec.set(wx, wy, wz).project(camera);
      return {
        xPct: Math.max(12, Math.min(88, (_projVec.x * 0.5 + 0.5) * 100)),
        yPct: Math.max(18, Math.min(82, (-_projVec.y * 0.5 + 0.5) * 100)),
      };
    };

    const spawnBurst = (wx: number, wy: number, wz: number, color: number, count = 12) => {
      const s = simRef.current;
      for (let i = 0; i < count; i += 1) {
        if (s.sparks.length >= MAX_SPARKS) {
          // Recycle oldest spark slot cleanly instead of allocating unboundedly
          const oldest = s.sparks.shift();
          if (!oldest) break;
        }
        s.sparks.push({
          x: wx,
          y: wy,
          z: wz,
          vx: (Math.random() - 0.5) * 14,
          vy: (Math.random() - 0.5) * 14,
          vz: (Math.random() - 0.5) * 12,
          life: 0.48,
          maxLife: 0.48,
          color,
        });
      }
    };

    const spawnEntity = (
      kind: EntityKind,
      x?: number,
      y?: number,
      z = -96,
      spikeSide?: 'bottom' | 'left' | 'right'
    ) => {
      const s = simRef.current;
      const resolvedSide: 'bottom' | 'left' | 'right' | undefined =
        kind === 'spike'
          ? spikeSide ?? (Math.random() < 0.4 ? 'bottom' : Math.random() < 0.5 ? 'left' : 'right')
          : undefined;
      const px =
        x ??
        (kind === 'spike'
          ? resolvedSide === 'left'
            ? -4.55
            : resolvedSide === 'right'
            ? 4.55
            : (Math.random() - 0.5) * 8.4
          : (Math.random() - 0.5) * 9.6);
      const py =
        y ??
        (kind === 'spike'
          ? resolvedSide === 'bottom'
            ? -2.75
            : (Math.random() - 0.5) * 4.4
          : (Math.random() - 0.5) * 6.0);
      const endlessLevel =
        propsRef.current.mode === 'endless'
          ? s.elapsedSec / 90 + Math.max(0, s.sector - 1) * 0.25
          : 0;
      const droneSpeedScale =
        propsRef.current.mode === 'endless' ? 1 + Math.min(1.0, endlessLevel * 0.07) : 1;
      const droneBonusHp =
        propsRef.current.mode === 'endless'
          ? (endlessLevel >= 5.5 ? 1 : 0) + (endlessLevel >= 10.5 ? 1 : 0)
          : 0;
      const entity: WorldEntity = {
        id: s.nextEntityId++,
        kind,
        x: px,
        y: py,
        z,
        vx: kind === 'drone' ? (Math.random() < 0.5 ? -1.8 : 1.8) * droneSpeedScale : 0,
        vy: 0,
        vz: 0,
        hp: kind === 'drone' ? 2 + droneBonusHp : 999,
        radius:
          kind === 'ring' || kind === 'purple_ring'
            ? 2.5
            : kind === 'drone'
            ? 1.15
            : kind === 'hazard' || kind === 'spike'
            ? 1.15
            : kind === 'mystery'
            ? 1.05
            : 0.85,
        passed: false,
        hitFlash: 0,
        spikeSide: resolvedSide,
      };

      if (!use2DFallback) {
        const mesh = acquireEntityMesh(kind, resolvedSide);
        mesh.position.set(
          px + tunnelCurveX(z, s.curveTime),
          py + tunnelCurveY(z, s.curveTime),
          z
        );
        entity.mesh = mesh;
      }

      s.entities.push(entity);
    };

    const fireTwinLasers = (overdrive = false) => {
      const s = simRef.current;
      const offsets = overdrive ? [-1.05, 0, 1.05] : [-0.95, 0.95];
      for (const ox of offsets) {
        if (s.bolts.length >= MAX_BOLTS) break;
        s.bolts.push({
          x: s.shipX + ox,
          y: s.shipY,
          z: 1.0,
        });
      }
      audioSynth.play('fire');
    };

    const updateTunnelGeometry = (scrollDelta: number, curveTime: number) => {
      for (const r of tunnelRibs) {
        r.position.z += scrollDelta;
        if (r.position.z > 10) {
          r.position.z -= RIB_COUNT * RIB_SPACING;
        }
        r.position.x = tunnelCurveX(r.position.z, curveTime);
        r.position.y = tunnelCurveY(r.position.z, curveTime);
      }

      // Update longitudinal rails along the curved octagonal tube
      for (let r = 0; r < RAIL_VERTS; r += 1) {
        const angle = (r / RAIL_VERTS) * Math.PI * 2 + Math.PI / 8;
        const rx = Math.cos(angle) * TUNNEL_RADIUS;
        const ry = Math.sin(angle) * TUNNEL_RADIUS;
        const attr = railLines[r].geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let k = 0; k < RAIL_STEPS; k += 1) {
          const z = 8 - k * 5.0;
          attr.setXYZ(k, rx + tunnelCurveX(z, curveTime), ry + tunnelCurveY(z, curveTime), z);
        }
        attr.needsUpdate = true;
      }

      // Scroll cosmic nebula wall clouds along the curved octagonal walls
      for (let i = 0; i < nebulaPanels.length; i += 1) {
        const p = nebulaPanels[i];
        p.mesh.position.z += scrollDelta * 0.88;
        if (p.mesh.position.z > 18) {
          p.mesh.position.z -= NEBULA_WALL_SPAN;
        }
        const pz = p.mesh.position.z;
        p.mesh.position.x =
          Math.cos(p.angle) * NEBULA_WALL_RADIUS + tunnelCurveX(pz, curveTime);
        p.mesh.position.y =
          Math.sin(p.angle) * NEBULA_WALL_RADIUS + tunnelCurveY(pz, curveTime);
      }
    };

    const finishSession = (bossWin: boolean, reason: string) => {
      const s = simRef.current;
      if (s.finished) return;
      s.finished = true;

      const xRom = Math.min(100, Math.round(((s.leftReach + s.rightReach) / 2) * 100));
      const yRom = Math.min(100, Math.round(((s.upReach + s.downReach) / 2) * 100));
      const diffLR = Math.abs(s.leftReach - s.rightReach);
      const symmetry = Math.max(0, Math.min(100, Math.round(100 - diffLR * 55)));
      const finalScore = Math.round(s.score);

      const report: SessionReport = {
        mode: propsRef.current.mode,
        difficulty: s.levelDiffKey,
        score: finalScore,
        elapsedSec: Math.round(s.elapsedSec),
        xRom,
        yRom,
        symmetry,
        rank: computeRank(finalScore, xRom, yRom, symmetry, bossWin),
        orbsCollected: s.orbsCollected,
        ringsPassed: s.ringsPassed,
        hazardsDodged: s.hazardsDodged,
        dronesDestroyed: s.dronesDestroyed,
        sector: s.sector,
        bossDefeated: bossWin,
        totalBossesDefeated: s.totalBossesDefeated,
        loopCount: s.loopCount,
        outcomeSummary: reason,
      };
      propsRef.current.onGameEnd(report);
    };

    const activateBoss = (stage: number) => {
      const s = simRef.current;
      const curDiff = DIFFS[s.levelDiffKey];
      const tier = s.totalBossesDefeated;
      const hpScale = (1 + tier * 0.16) * (stage === 2 ? 1.15 : 1.0);
      const maxHp = Math.round(curDiff.bossHp * hpScale);
      const arch = BOSS_ARCHETYPES[tier % BOSS_ARCHETYPES.length];
      s.bossStage = stage;
      s.bossActive = true;
      s.bossHp = maxHp;
      s.bossMaxHp = maxHp;
      s.bossVariant = tier;
      s.bossVariantApplied = -1;
      s.bossName = arch.name;
      s.bossIntroDuration = 2.1;
      s.bossIntroTimer = 2.1;
      s.bossIntroZ = -115;
      s.bossIntroScale = 0.45;
      s.bossIntroImpactDone = false;
      s.bossIntroSparkTimer = 0;
      s.bossIntroBlinkStep = 0;
      s.bossIntroSubtitle = arch.introSubtitle;
      s.bossFireTimer = Math.max(0.65, 1.4 - tier * 0.08) / (1.05 * 1.1 * 0.95 * 1.05 * 1.05);
      s.bossBurstRemaining = 0;
      s.bossBurstGapTimer = 0;
      s.bossBurstTargets = [];
      audioSynth.play('sector');
      propsRef.current.onFx('hyper');
      propsRef.current.onBossTrigger();
      propsRef.current.onFloatMsg({
        text: `${curDiff.label} BOSS ${stage}/2 · MK-${tier + 1}: ${arch.name} (${maxHp} HP)!`,
        xPct: 50,
        yPct: 32,
        color: '#ff4d6a',
      });
    };

    const activateOmegaBoss = () => {
      const s = simRef.current;
      s.omegaPending = false;
      s.omegaCountdown = 0;
      s.omegaBossActive = true;
      s.omegaEnraged = false;
      s.bossActive = true;
      s.bossHp = 2000;
      s.bossMaxHp = 2000;
      s.bossVariant = 8;
      s.bossVariantApplied = -1;
      s.bossName = 'OMEGA OVERLORD';
      s.bossIntroDuration = 2.6;
      s.bossIntroTimer = 2.6;
      s.bossIntroZ = -135;
      s.bossIntroScale = 0.3;
      s.bossIntroImpactDone = false;
      s.bossIntroSparkTimer = 0;
      s.bossIntroBlinkStep = 0;
      s.bossIntroSubtitle = 'APEX TRI-PHASE ASCENSION';
      s.bossFireTimer = 0.42 / (1.05 * 1.1 * 0.95 * 1.05 * 1.05 * 0.7);
      s.bossBurstRemaining = 0;
      s.bossBurstGapTimer = 0;
      s.bossBurstTargets = [];
      audioSynth.play('triumph');
      propsRef.current.onFx('hyper');
      propsRef.current.onBossTrigger();
      propsRef.current.onFloatMsg({
        text: 'FINAL BOSS: OMEGA OVERLORD (2,000 HP · 20% DMG)!',
        xPct: 50,
        yPct: 32,
        color: '#ff3355',
      });
    };

    // Returns true if the entire linked campaign finished
    const handleBossDefeated = (): boolean => {
      const s = simRef.current;
      const curDiff = DIFFS[s.levelDiffKey];

      // Clear active red plasma shots cleanly on boss kill
      for (let ei = s.entities.length - 1; ei >= 0; ei -= 1) {
        const ent = s.entities[ei];
        if (ent.kind === 'boss_shot') {
          spawnBurst(ent.x, ent.y, ent.z, 0xffd13b, 4);
          releaseEntityMesh(ent);
          s.entities.splice(ei, 1);
        }
      }

      s.bossActive = false;
      s.bossBurstRemaining = 0;
      s.bossBurstGapTimer = 0;
      s.bossBurstTargets = [];
      s.totalBossesDefeated += 1;

      spawnBurst(s.bossX, s.bossY, -44, 0xffd13b, 32);

      if (s.omegaBossActive) {
        s.omegaBossActive = false;
        s.omegaEnraged = false;
        const omegaBonus = 10000;
        s.score += omegaBonus;
        s.hp = s.maxHp;
        s.bossDefeated = true;
        audioSynth.play('triumph');
        propsRef.current.onFx('hyper');
        finishSession(true, 'Apex Omega Overlord defeated! Campaign victory achieved!');
        return true;
      }

      const bossBonus = Math.round((s.bossStage === 2 ? 1000 : 600) * curDiff.mult);
      s.score += bossBonus;

      if (s.bossStage === 1) {
        s.bossesClearedInLevel = 1;
        s.bossStage = 2;
        s.hp = Math.min(s.maxHp, s.hp + 25);
        s.nextBossScoreTarget = s.score - s.levelScoreStart + 850;
        s.bossCooldownTimer = 2.4;
        audioSynth.play('win');
        propsRef.current.onFx('hyper');
        propsRef.current.onFloatMsg({
          text: `BOSS 1/2 CLEARED! +${bossBonus} · +25 HP`,
          xPct: 50,
          yPct: 32,
          color: '#ffd13b',
        });
        return false;
      }

      // Boss 2/2 cleared — advance to the next linked difficulty or loop back to Easy
      s.bossesClearedInLevel = 2;
      const nextIdx = DIFF_ORDER.indexOf(s.levelDiffKey) + 1;
      if (nextIdx < DIFF_ORDER.length) {
        const nextDiffKey = DIFF_ORDER[nextIdx];
        const nextDiff = DIFFS[nextDiffKey];
        s.levelDiffKey = nextDiffKey;
        s.levelScoreStart = s.score;
        s.nextBossScoreTarget = 800;
        s.bossesClearedInLevel = 0;
        s.bossStage = 1;
        const levelHpGain = s.loopCount >= 3 ? 15 : 5;
        s.maxHp += levelHpGain;
        s.hp = Math.min(s.maxHp, s.hp + levelHpGain);
        s.bossCooldownTimer = 2.6;
        propsRef.current.onAdvanceDifficulty(nextDiffKey);
        audioSynth.play('sector');
        propsRef.current.onFx('hyper');
        propsRef.current.onFloatMsg({
          text: `${curDiff.label} CLEARED! → ${nextDiff.label} (+${levelHpGain} MAX HP · +${levelHpGain} HP)`,
          xPct: 50,
          yPct: 30,
          color: '#00f59b',
        });
        return false;
      }

      // All bosses through Extreme defeated — loop seamlessly back to Easy (New Loop+)!
      const completedLoops = s.loopCount;
      const loopClearBonus = Math.round(1500 * curDiff.mult);
      const levelHpGain = completedLoops === 2 ? 50 : completedLoops >= 3 ? 15 : 5;
      s.score += loopClearBonus;
      s.loopCount += 1;
      s.maxHp += levelHpGain;
      s.levelDiffKey = DIFF_ORDER[0];
      s.levelScoreStart = s.score;
      s.nextBossScoreTarget = 800;
      s.bossesClearedInLevel = 0;
      s.bossStage = 1;
      s.bossDefeated = false;
      s.bossCooldownTimer = completedLoops % 3 === 0 ? 0 : 2.8;
      propsRef.current.onAdvanceDifficulty(DIFF_ORDER[0]);

      if (completedLoops % 3 === 0) {
        // Special 3-Loop Ascension Celebration -> followed immediately by 2,000 HP Omega Boss Level!
        s.score += 5000;
        s.hp = s.maxHp;
        s.triumphTimer = 4.2;
        s.triumphSparkTimer = 0;
        s.omegaPending = true;
        s.omegaCountdown = 4.2;
        audioSynth.play('triumph');
        propsRef.current.onFx('hyper');
        propsRef.current.onTriLoopTriumph?.(completedLoops);

        // Multi-ring 3D firework bursts & forward celebratory beams
        const fireworkColors = [0xffd13b, 0x00f0ff, 0xd946ef, 0x00f59b];
        for (let k = 0; k < 4; k += 1) {
          const fz = -18 - k * 10;
          const fx = Math.cos(k * 1.6) * 3.4;
          const fy = Math.sin(k * 1.6) * 2.2;
          spawnBurst(fx, fy, fz, fireworkColors[k % fireworkColors.length], 22);
        }
        const beamTargets = [
          { tx: -4.2, ty: 2.4 },
          { tx: 0, ty: 0 },
          { tx: 4.2, ty: 2.4 },
        ];
        for (const bt of beamTargets) {
          if (s.beams.length >= MAX_BEAMS) break;
          s.beams.push({
            x: s.shipX,
            y: s.shipY,
            z: 1.4,
            targetX: bt.tx,
            targetY: bt.ty,
            targetZ: -64,
            life: 0.34,
          });
        }
      } else if (completedLoops === 2) {
        s.hp = s.maxHp;
        audioSynth.play('win');
        audioSynth.play('heal');
        propsRef.current.onFx('heal');
        spawnBurst(s.shipX, s.shipY, 1.0, 0x00f59b, 20);
        propsRef.current.onFloatMsg({
          text: `LOOP 2 COMPLETE! +50 MAX HP · FULL HP RESTORED → LOOP ${s.loopCount}`,
          xPct: 50,
          yPct: 30,
          color: '#00f59b',
        });
      } else {
        s.hp = Math.min(s.maxHp, s.hp + levelHpGain);
        audioSynth.play('win');
        propsRef.current.onFx('hyper');
        propsRef.current.onFloatMsg({
          text: `ALL BOSSES CLEARED! LOOP ${s.loopCount}: EASY (+${levelHpGain} MAX HP · +${levelHpGain} HP)`,
          xPct: 50,
          yPct: 30,
          color: '#ffd13b',
        });
      }
      return false;
    };

    let lastTime = performance.now();
    let smoothedDt = 1 / 60;
    let rafId = 0;
    let disposed = false;

    // Smart discrete telemetry change tracker so HUD updates stay instant without idle churn
    let lastHudScore = -1;
    let lastHudHp = -1;
    let lastHudBossHp = -1;
    let lastHudBossActive = false;
    let lastHudBossIntro = false;
    let lastHudSector = -1;
    let lastHudCombo = -1;
    let lastHudTutStep = -1;

    const afterDraw = (cb: () => void) => {
      if (!renderer || use2DFallback) {
        rafId = window.setTimeout(cb, 80);
        return;
      }
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = typeof gl.fenceSync === 'function' ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (sync && state === gl.UNSIGNALED) {
          rafId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          rafId = window.setTimeout(cb, 80);
        }
      };
      rafId = window.setTimeout(poll, 5);
    };

    let runLoop: (now?: number) => void = () => {};

    const scheduleNextFrame = () => {
      if (disposed) return;
      if (isSoftwareGl) {
        afterDraw(() => runLoop(performance.now()));
      } else {
        rafId = requestAnimationFrame(runLoop);
      }
    };

    const renderFrame = (
      curLight: boolean,
      shipX: number,
      shipY: number,
      simState: typeof simRef.current,
      now: number
    ) => {
      if (!use2DFallback && renderer) {
        renderer.render(scene, camera);
      } else if (fallbackCtx) {
        renderFallback2D(fallbackCtx, canvas.width, canvas.height, curLight, shipX, shipY, simState, now);
      }
    };

    const tick = (now: number) => {
      const rawDt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;
      // Smooth minor rAF interval jitter while snapping cleanly after tab switches
      smoothedDt = rawDt > 0.035 ? rawDt : smoothedDt * 0.72 + rawDt * 0.28;
      const dt = smoothedDt;

      const {
        phase: curPhase,
        mode: curMode,
        isLight: curLight,
        highScore: curHigh,
        autoFire: curAutoFire,
        onTelemetry: emitTelemetry,
        onFx: emitFx,
        onFloatMsg: emitFloat,
        onUpdateCam: tickCam,
      } = propsRef.current;

      tickCam();

      const targetBg = curLight ? lightBg : darkBg;
      (scene.background as THREE.Color).lerp(targetBg, 1 - Math.exp(-6 * dt));
      if (scene.fog instanceof THREE.FogExp2) {
        scene.fog.color.copy(scene.background as THREE.Color);
      }
      ribMatPrimary.color.setHex(curLight ? 0x0284c7 : 0x00e5ff);
      ribMatSecondary.color.setHex(curLight ? 0x7c3aed : 0xd946ef);
      railMat.color.setHex(curLight ? 0x0369a1 : 0x7c3aed);
      starMat.color.setHex(curLight ? 0x64748b : 0xc4b5fd);
      const targetNebulaOpacity = curLight ? 0.34 : 0.52;
      for (let ni = 0; ni < nebulaMats.length; ni += 1) {
        nebulaMats[ni].opacity = targetNebulaOpacity;
      }

      const s = simRef.current;
      const curDiffKey = s.levelDiffKey;
      const diff = DIFFS[curDiffKey];

      const showGameplayGroups = curPhase === 'playing' || curPhase === 'paused';
      entityGroup.visible = showGameplayGroups;
      fxGroup.visible = showGameplayGroups;

      // Ambient idle Operius tunnel flight in menu or report
      if (curPhase === 'menu' || curPhase === 'report') {
        const idleSpeed = 18;
        s.curveTime += dt * 0.75;
        updateTunnelGeometry(idleSpeed * dt, s.curveTime);

        const posAttr = starGeo.getAttribute('position') as THREE.BufferAttribute;
        const starArr = posAttr.array as Float32Array;
        const starDz = idleSpeed * 1.5 * dt;
        for (let i = 2; i < starCount * 3; i += 3) {
          let z = starArr[i] + starDz;
          if (z > 10) z = -130;
          starArr[i] = z;
        }
        posAttr.needsUpdate = true;

        shipGroup.position.x = Math.sin(now * 0.0014) * 2.2;
        shipGroup.position.y = Math.cos(now * 0.0017) * 1.0;
        shipGroup.rotation.z = -shipGroup.position.x * 0.18;
        shipGroup.rotation.x = shipGroup.position.y * 0.09;
        camera.position.x = THREE.MathUtils.damp(camera.position.x, shipGroup.position.x * 0.55, 8, dt);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, 0.95 + shipGroup.position.y * 0.5, 8, dt);
        camera.lookAt(
          shipGroup.position.x * 0.45 + tunnelCurveX(-28, s.curveTime) * 0.75,
          shipGroup.position.y * 0.45 + tunnelCurveY(-28, s.curveTime) * 0.75,
          -28
        );
        camera.rotateZ(-shipGroup.position.x * 0.012);
        bossGroup.visible = false;

        renderFrame(curLight, shipGroup.position.x, shipGroup.position.y, s, now);
        return;
      }

      if (curPhase === 'paused') {
        renderFrame(curLight, s.shipX, s.shipY, s, now);
        return;
      }

      // Active Operius-style gameplay simulation
      s.elapsedSec += dt;
      s.curveTime += dt;

      let celebrationBarrelRoll = 0;
      let celebrationStarBoost = 1;
      if (s.triumphTimer > 0) {
        s.triumphTimer = Math.max(0, s.triumphTimer - dt);
        const rollElapsed = 4.2 - s.triumphTimer;
        if (rollElapsed < 1.35) {
          const p = rollElapsed / 1.35;
          // Smooth ease-in-out 360 degree victory barrel roll
          const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
          celebrationBarrelRoll = eased * Math.PI * 2;
        }
        celebrationStarBoost = 1.75;

        // Prismatic golden-cyan-violet tunnel shimmer
        const hue = (now * 0.00055) % 1;
        ribMatPrimary.color.setHSL(hue, 0.95, curLight ? 0.45 : 0.62);
        ribMatSecondary.color.setHSL((hue + 0.18) % 1, 0.95, curLight ? 0.45 : 0.62);
        railMat.color.setHSL((hue + 0.5) % 1, 0.9, curLight ? 0.42 : 0.6);
        starMat.color.setHex(0xffe57f);

        s.triumphSparkTimer -= dt;
        if (s.triumphSparkTimer <= 0 && s.triumphTimer > 0.45) {
          s.triumphSparkTimer = 0.16;
          const colors = [0xffd13b, 0x00f0ff, 0xd946ef, 0x00f59b];
          const c = colors[Math.floor(Math.random() * colors.length)];
          const fz = -20 - Math.random() * 26;
          const angle = Math.random() * Math.PI * 2;
          spawnBurst(Math.cos(angle) * 4.2, Math.sin(angle) * 2.8, fz, c, 10);
        }
      }

      // Sector progression & speed ramp (enabled for both Standard and Endless modes)
      const newSector =
        curMode === 'standard' || curMode === 'standing' || curMode === 'endless'
          ? 1 + Math.floor(s.score / 700)
          : s.sector;
      if (newSector > s.sector) {
        s.sector = newSector;
        audioSynth.play('sector');
        emitFx('hyper');
        emitFloat({ text: `SECTOR ${s.sector}!`, xPct: 50, yPct: 30, color: '#00f59b' });
      }

      const endlessLevel =
        curMode === 'endless' ? s.elapsedSec / 90 + Math.max(0, s.sector - 1) * 0.25 : 0;
      if (curMode === 'endless') {
        const nextTier = Math.floor(s.elapsedSec / 75);
        if (nextTier > s.endlessEscalationTier) {
          s.endlessEscalationTier = nextTier;
          audioSynth.play('sector');
          emitFx('hyper');
          emitFloat({
            text: `ENDLESS THREAT LVL ${nextTier + 1}! SPEED & HAZARDS UP!`,
            xPct: 50,
            yPct: 24,
            color: '#f43f5e',
          });
        }
      }

      const sectorBoost = 1 + Math.min(0.85, (s.sector - 1) * 0.08);
      const loopBoost = 1 + Math.min(0.4, (s.loopCount - 1) * 0.1);
      const endlessSpeedBoost =
        curMode === 'endless' ? 1 + Math.min(1.6, endlessLevel * 0.08) : sectorBoost * loopBoost;
      const tunnelSpeed =
        diff.speed * endlessSpeedBoost * (curMode === 'tutorial' ? 0.78 : 1);

      // Tick active Purple Ring extra fire-rate timer & Mystery Box buff/debuff timer
      if (s.rapidFireTimer > 0) {
        s.rapidFireTimer = Math.max(0, s.rapidFireTimer - dt);
      }
      if (s.mysteryEffectTimer > 0) {
        s.mysteryEffectTimer = Math.max(0, s.mysteryEffectTimer - dt);
        if (s.mysteryEffectTimer <= 0) {
          s.mysteryEffectType = null;
          s.mysteryEffectKind = null;
          s.mysteryEffectLabel = null;
        }
      }

      // Ultra-responsive steering (respects Mystery Box inverted controls debuff)
      const invertSign = s.mysteryEffectType === 'inverted' ? -1 : 1;
      const steerX = Math.max(-1, Math.min(1, steerRef.current.x)) * invertSign;
      const steerY = Math.max(-1, Math.min(1, steerRef.current.y)) * invertSign;
      const targetX = steerX * 5.4;
      const targetY = steerY * 3.4;

      s.shipX = THREE.MathUtils.damp(s.shipX, targetX, 36, dt);
      s.shipY = THREE.MathUtils.damp(s.shipY, targetY, 36, dt);
      s.shipRoll = THREE.MathUtils.damp(s.shipRoll, -steerX * 0.62, 28, dt);
      s.shipPitch = THREE.MathUtils.damp(s.shipPitch, steerY * 0.36, 28, dt);

      // Clinical ROM tracking
      const normX = s.shipX / 5.4;
      const normY = s.shipY / 3.4;
      if (normX < 0) s.leftReach = Math.max(s.leftReach, Math.min(1, Math.abs(normX)));
      if (normX > 0) s.rightReach = Math.max(s.rightReach, Math.min(1, Math.abs(normX)));
      if (normY > 0) s.upReach = Math.max(s.upReach, Math.min(1, Math.abs(normY)));
      if (normY < 0) s.downReach = Math.max(s.downReach, Math.min(1, Math.abs(normY)));

      shipGroup.position.set(s.shipX, s.shipY, 2.2);
      shipGroup.rotation.set(s.shipPitch, 0, s.shipRoll + celebrationBarrelRoll);

      // High-response chase camera locked tightly to ship lane and tunnel sightline
      let shakeX = 0;
      let shakeY = 0;
      if (s.shakeTimer > 0) {
        s.shakeTimer = Math.max(0, s.shakeTimer - dt);
        shakeX = (Math.random() - 0.5) * 0.32;
        shakeY = (Math.random() - 0.5) * 0.32;
      }
      camera.position.x = THREE.MathUtils.damp(camera.position.x, s.shipX * 0.78 + shakeX, 38, dt);
      camera.position.y = THREE.MathUtils.damp(camera.position.y, 0.78 + s.shipY * 0.74 + shakeY, 38, dt);
      camera.lookAt(
        s.shipX * 0.72 + tunnelCurveX(-28, s.curveTime) * 0.72,
        s.shipY * 0.7 + tunnelCurveY(-28, s.curveTime) * 0.72,
        -28
      );
      camera.rotateZ(-s.shipX * 0.008);

      // Scroll twisting tunnel ribs, rails & stars
      updateTunnelGeometry(tunnelSpeed * dt, s.curveTime);

      const posAttr = starGeo.getAttribute('position') as THREE.BufferAttribute;
      const starArr = posAttr.array as Float32Array;
      const starDz = tunnelSpeed * 1.55 * celebrationStarBoost * dt;
      for (let i = 2; i < starCount * 3; i += 3) {
        let z = starArr[i] + starDz;
        if (z > 10) z = -130;
        starArr[i] = z;
      }
      posAttr.needsUpdate = true;

      // Operius Rapid-Fire Twin Blasters (boosted by Purple Ring rapid fire & Mystery Overdrive)
      s.fireTimer -= dt;
      const shouldFire = curAutoFire || manualFireRef.current;
      const isOverdrive = s.mysteryEffectType === 'overdrive';
      const hasRapidRing = s.rapidFireTimer > 0;
      if (shouldFire && s.fireTimer <= 0) {
        s.fireTimer =
          (isOverdrive && hasRapidRing
            ? 0.05
            : hasRapidRing
            ? 0.068
            : isOverdrive
            ? 0.078
            : 0.145) / (0.8 * 1.1);
        fireTwinLasers(isOverdrive);
      }

      // Tutorial Progression
      if (curMode === 'tutorial') {
        if (s.tutorialStep === 1 && s.leftReach > 0.35 && s.rightReach > 0.35) {
          s.tutorialStep = 2;
          audioSynth.play('step');
          emitFloat({ text: 'STEP 1 COMPLETE!', xPct: 50, yPct: 36, color: '#00f59b' });
        } else if (s.tutorialStep === 2 && s.upReach > 0.3 && s.downReach > 0.3) {
          s.tutorialStep = 3;
          audioSynth.play('step');
          emitFloat({ text: 'STEP 2 COMPLETE!', xPct: 50, yPct: 36, color: '#00f59b' });
        } else if (s.tutorialStep === 3 && s.orbsCollected >= 2) {
          s.tutorialStep = 4;
          audioSynth.play('step');
          emitFloat({ text: 'STEP 3 COMPLETE!', xPct: 50, yPct: 36, color: '#00f59b' });
        } else if (
          s.tutorialStep === 4 &&
          s.hazardsDodged + s.dronesDestroyed >= 2
        ) {
          s.tutorialStep = 5;
          audioSynth.play('step');
          emitFloat({ text: 'STEP 4 COMPLETE!', xPct: 50, yPct: 36, color: '#00f59b' });
        } else if (s.tutorialStep === 5 && s.ringsPassed >= 2) {
          audioSynth.play('win');
          emitFloat({ text: 'CALIBRATION COMPLETE!', xPct: 50, yPct: 35, color: '#00f59b' });
          finishSession(false, 'Tutorial calibration completed cleanly.');
          return;
        }
      }

      // Trigger Post-3-Loop 2,000 HP Omega Boss Level OR normal Boss 1/2 & 2/2 (never in Endless Mode)
      if (curMode !== 'endless') {
        if (s.omegaPending && !s.bossActive) {
          s.omegaCountdown -= dt;
          if (s.omegaCountdown <= 0) {
            activateOmegaBoss();
          }
        } else if (!s.bossActive && !s.bossDefeated && !s.omegaBossActive) {
          if (curMode === 'standard' || curMode === 'standing') {
            const levelScore = s.score - s.levelScoreStart;
            if (s.bossStage === 1 && s.bossesClearedInLevel === 0 && levelScore >= 800) {
              activateBoss(1);
            } else if (
              s.bossStage === 2 &&
              s.bossesClearedInLevel === 1 &&
              levelScore >= s.nextBossScoreTarget
            ) {
              activateBoss(2);
            }
          } else if (curMode === 'boss' && s.bossCooldownTimer > 0) {
            s.bossCooldownTimer -= dt;
            if (s.bossCooldownTimer <= 0) {
              activateBoss(s.bossStage);
            }
          }
        }
      }

      // Boss AI, Pre-Battle Entrance Animations & Visuals (anchored inside twisting tunnel at z = -44)
      if (curMode !== 'endless' && s.bossActive && !s.bossDefeated) {
        const tier = s.totalBossesDefeated;
        const desiredVariantKey = s.omegaBossActive ? 1000 : tier;
        const arch = s.omegaBossActive
          ? { name: 'OMEGA OVERLORD', coreColor: 0xff0044, introSubtitle: 'APEX TRI-PHASE ASCENSION' }
          : BOSS_ARCHETYPES[tier % BOSS_ARCHETYPES.length];
        if (s.bossVariantApplied !== desiredVariantKey) {
          applyBossAppearance(tier, s.omegaBossActive);
          s.bossVariantApplied = desiredVariantKey;
          s.bossVariant = s.omegaBossActive ? 8 : tier;
          s.bossName = arch.name;
          s.bossIntroSubtitle = arch.introSubtitle;
        }

        const baseBossScale = s.omegaBossActive ? 1.62 : 1 + Math.min(0.45, tier * 0.055);
        const variantIdx = s.omegaBossActive ? 8 : tier % 8;
        bossGroup.visible = true;

        if (s.bossIntroTimer > 0) {
          // Pre-battle archetype entrance animation
          s.bossIntroTimer = Math.max(0, s.bossIntroTimer - dt);
          const u = Math.min(1, Math.max(0, 1 - s.bossIntroTimer / Math.max(0.1, s.bossIntroDuration)));
          const easeOut = 1 - Math.pow(1 - u, 3);
          const easeInOut = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;

          let introX = 0;
          let introY = 0.5;
          let introZ = -44;
          let introScale = baseBossScale;
          let rotX = 0;
          let rotY = 0;
          let rotZ = 0;
          let childSpinBoost = 2.8;

          if (variantIdx === 0) {
            // Crimson Sentinel: Deep-tunnel hyper-warp spiral forward
            introZ = -125 + 81 * easeOut;
            introScale = baseBossScale * (0.4 + 0.6 * easeOut);
            rotZ = (1 - easeOut) * Math.PI * 3.5;
            childSpinBoost = 3.2;
          } else if (variantIdx === 1) {
            // Solar Overlord: Blazing golden arc descent from upper crown
            introY = 13.5 * Math.pow(1 - easeOut, 1.8) + 0.5 * easeOut;
            introX = Math.sin(u * Math.PI * 2) * (1 - u) * 3.4;
            introZ = -72 + 28 * easeOut;
            introScale = baseBossScale * (0.28 + 0.72 * easeOut);
            rotX = (1 - easeOut) * 0.65;
            childSpinBoost = 4.6;
          } else if (variantIdx === 2) {
            // Violet Leviathan: Twin-side serpentine S-wave glide
            introX = Math.sin(u * Math.PI * 3.2) * (1 - u) * 6.8;
            introY = Math.cos(u * Math.PI * 2.2) * (1 - u) * 2.4 + 0.5;
            introZ = -108 + 64 * easeOut;
            rotZ = -Math.cos(u * Math.PI * 3.2) * (1 - u) * 0.7;
            introScale = baseBossScale * (0.45 + 0.55 * easeOut);
            childSpinBoost = 3.6;
          } else if (variantIdx === 3) {
            // Emerald Hive-Mind: Bio-swarm pulse expansion at tunnel focal point
            const pulse = u < 0.78 ? easeOut * 0.85 : 0.85 + Math.sin(((u - 0.78) / 0.22) * Math.PI) * 0.3 + ((u - 0.78) / 0.22) * 0.15;
            introScale = baseBossScale * Math.max(0.08, pulse);
            introZ = -58 + 14 * easeOut;
            rotZ = (1 - easeOut) * Math.PI * 4;
            childSpinBoost = 4.8;
          } else if (variantIdx === 4) {
            // Cobalt Dreadnought: Two-stage heavy armored monolith drop + shockwave slam
            if (u < 0.62) {
              const d = u / 0.62;
              introY = 12 - 13.4 * (d * d);
              rotX = -0.35 * (1 - d);
            } else {
              const sBounce = (u - 0.62) / 0.38;
              introY = -1.4 + 1.9 * (1 - Math.pow(1 - sBounce, 2));
              if (!s.bossIntroImpactDone) {
                s.bossIntroImpactDone = true;
                s.shakeTimer = 0.28;
                audioSynth.play('hit');
                spawnBurst(0, -1.2, -43, 0x38bdf8, 22);
              }
            }
            introZ = -44;
            introScale = baseBossScale * (0.85 + 0.15 * easeOut);
            childSpinBoost = 2.0;
          } else if (variantIdx === 5) {
            // Magenta Phantom: Tri-blink mirage warp across flanking lanes
            const blinkStep = Math.min(3, Math.floor(u * 3.6));
            const blinkPositions = [
              { x: -4.4, y: 2.1, z: -76 },
              { x: 4.4, y: -1.8, z: -60 },
              { x: -3.2, y: -1.4, z: -50 },
              { x: 0, y: 0.5, z: -44 },
            ];
            const bp = blinkPositions[blinkStep];
            introX = bp.x;
            introY = bp.y;
            introZ = bp.z;
            if (blinkStep !== s.bossIntroBlinkStep) {
              s.bossIntroBlinkStep = blinkStep;
              audioSynth.play('orb');
              spawnBurst(bp.x, bp.y, bp.z + 2, 0xf472b6, 16);
            }
            introScale = baseBossScale * (blinkStep === 3 ? 1 : 0.72 + blinkStep * 0.1);
            rotY = (1 - u) * Math.PI * 3;
            childSpinBoost = 5.0;
          } else if (variantIdx === 6) {
            // Magma Colossus: Volcanic core spire drill eruption from floor trench
            introY = -11.5 * Math.pow(1 - easeOut, 1.7) + 0.5 * easeOut;
            introZ = -56 + 12 * easeOut;
            rotY = (1 - easeOut) * Math.PI * 5;
            introScale = baseBossScale * (0.55 + 0.45 * easeOut);
            childSpinBoost = 3.8;
          } else if (variantIdx === 7) {
            // Hyperion Singularity: Over-expanded dimensional implosion lock-in
            const implosion = 2.65 - 1.65 * easeInOut;
            introScale = baseBossScale * implosion;
            introZ = -88 + 44 * easeOut;
            rotX = (1 - easeOut) * 1.1;
            rotZ = (1 - easeOut) * -Math.PI * 3;
            childSpinBoost = 6.2;
          } else {
            // Variant 8 — OMEGA OVERLORD: Apex Tri-Phase Vortex Ascension
            introZ = -135 + 91 * easeOut;
            introX = Math.sin(u * Math.PI * 4) * (1 - u) * 4.5;
            introY = Math.cos(u * Math.PI * 3) * (1 - u) * 2.6 + 0.5;
            introScale = baseBossScale * (0.28 + 0.72 * easeOut);
            rotZ = (1 - easeOut) * Math.PI * 2.5;
            childSpinBoost = 5.2;
            if (!s.bossIntroImpactDone && u > 0.52) {
              s.bossIntroImpactDone = true;
              s.shakeTimer = 0.22;
              audioSynth.play('laser');
              spawnBurst(introX, introY, introZ + 3, 0xffd13b, 24);
            }
          }

          s.bossX = introX;
          s.bossY = introY;
          s.bossIntroZ = introZ;
          s.bossIntroScale = introScale;
          bossGroup.scale.setScalar(introScale);
          bossGroup.position.set(
            s.bossX + tunnelCurveX(introZ, s.curveTime),
            s.bossY + tunnelCurveY(introZ, s.curveTime),
            introZ
          );
          bossGroup.rotation.set(rotX, rotY, rotZ);

          for (const child of bossGroup.children) {
            const ax = child.userData.spinAxis as 'x' | 'y' | 'z' | undefined;
            const sp = (child.userData.spinSpeed as number | undefined) ?? 0;
            if (ax && sp !== 0) {
              child.rotation[ax] += dt * sp * childSpinBoost;
            }
          }

          s.bossIntroSparkTimer -= dt;
          if (s.bossIntroSparkTimer <= 0) {
            s.bossIntroSparkTimer = 0.14;
            spawnBurst(s.bossX, s.bossY, Math.min(-18, introZ + 3), arch.coreColor, 7);
          }

          bossCoreMat.emissive.copy(bossCoreMat.color);
          bossCoreMat.emissiveIntensity = 1.05 + Math.sin(u * Math.PI * 10) * 0.35;

          if (s.bossIntroTimer <= 0) {
            // Final lock-in shockwave and engage battle
            s.bossIntroZ = -44;
            s.bossIntroScale = baseBossScale;
            bossGroup.rotation.set(0, 0, 0);
            bossCoreMat.emissiveIntensity = 0.9;
            s.shakeTimer = 0.24;
            audioSynth.play('laser');
            emitFx('hyper');
            spawnBurst(s.bossX, s.bossY, -42, arch.coreColor, 22);
            emitFloat({
              text: `${s.bossName} ENGAGED!`,
              xPct: 50,
              yPct: 34,
              color: '#ff4d6a',
            });
          }
        } else {
          // Active Boss Combat Loop
          s.bossIntroZ = -44;
          s.bossIntroScale = baseBossScale;
          bossGroup.rotation.set(0, 0, 0);
          bossCoreMat.emissiveIntensity = 0.9;
          bossGroup.scale.setScalar(baseBossScale);
          const speedScale = s.omegaBossActive
            ? s.omegaEnraged
              ? 1.85
              : 1.55
            : 1 + Math.min(1.4, tier * 0.08) + (s.bossStage === 2 ? 0.1 : 0);
          const omegaWaveX = s.omegaBossActive ? Math.cos(s.elapsedSec * 1.35) * 0.45 : 0;
          const omegaWaveY = s.omegaBossActive ? Math.sin(s.elapsedSec * 1.55) * 0.32 : 0;
          s.bossX = Math.max(-4.7, Math.min(4.7, Math.sin(s.elapsedSec * 0.95 * speedScale) * 4.4 + omegaWaveX));
          s.bossY = Math.max(-2.75, Math.min(2.75, Math.cos(s.elapsedSec * 1.2 * speedScale) * 2.3 + omegaWaveY));
          const bossZ = -44;
          bossGroup.position.set(
            s.bossX + tunnelCurveX(bossZ, s.curveTime),
            s.bossY + tunnelCurveY(bossZ, s.curveTime),
            bossZ
          );
          for (const child of bossGroup.children) {
            const ax = child.userData.spinAxis as 'x' | 'y' | 'z' | undefined;
            const sp = (child.userData.spinSpeed as number | undefined) ?? 0;
            if (ax && sp !== 0) {
              child.rotation[ax] += dt * sp * speedScale;
            }
          }

          if (s.bossHitFlash > 0) {
            s.bossHitFlash = Math.max(0, s.bossHitFlash - dt);
            bossCoreMat.emissive.setHex(0xffffff);
          } else {
            bossCoreMat.emissive.copy(bossCoreMat.color);
          }

          if (s.omegaBossActive && !s.omegaEnraged && s.bossHp <= s.bossMaxHp * 0.5) {
            s.omegaEnraged = true;
            s.bossFireTimer = Math.min(s.bossFireTimer, 0.35);
            audioSynth.play('laser');
            emitFx('dmg');
            spawnBurst(s.bossX, s.bossY, -42, 0xff3355, 26);
            emitFloat({
              text: 'OMEGA OVERLORD ENRAGED! 7-BALL BARRAGE!',
              xPct: 50,
              yPct: 28,
              color: '#ff3355',
            });
          }

          s.bossFireTimer -= dt;
          if (s.bossFireTimer <= 0) {
            const burstCount = s.omegaBossActive
              ? s.omegaEnraged
                ? 7
                : 6
              : s.loopCount >= 3
              ? 8
              : s.loopCount === 2
              ? 5
              : 4;
            s.bossBurstCount = burstCount;
            s.bossBurstRemaining = 0;
            s.bossBurstIndex = 0;
            s.bossBurstGapTimer = 0;
            s.bossBurstPattern = (s.bossBurstPattern + 1) % 4;
            s.bossBurstFlip = Math.random() < 0.5 ? 1 : -1;

            // Pre-compute widely scattered multi-sector tunnel targets so shots never march in a straight line
            const sectorSpan = (Math.PI * 2) / burstCount;
            const baseAngle = Math.random() * Math.PI * 2;
            const scattered: Array<{ x: number; y: number }> = [];
            for (let k = 0; k < burstCount; k += 1) {
              const jitter = (Math.random() - 0.5) * sectorSpan * 0.72;
              const angle = baseAngle + k * sectorSpan + jitter;
              const radialScale = 0.52 + Math.random() * 0.46;
              let tx = Math.cos(angle) * 4.9 * radialScale + (Math.random() - 0.5) * 1.1;
              let ty = Math.sin(angle) * 3.0 * radialScale + (Math.random() - 0.5) * 0.85;
              tx = Math.max(-4.95, Math.min(4.95, tx));
              ty = Math.max(-3.05, Math.min(3.05, ty));
              scattered.push({ x: tx, y: ty });
            }
            // Shuffle order across quadrants
            for (let k = scattered.length - 1; k > 0; k -= 1) {
              const j = Math.floor(Math.random() * (k + 1));
              const tmp = scattered[k];
              scattered[k] = scattered[j];
              scattered[j] = tmp;
            }
            s.bossBurstTargets = scattered;

            // Launch all scattered plasma balls simultaneously at once
            const shotSpeed = s.omegaBossActive
              ? tunnelSpeed * (s.omegaEnraged ? 1.55 : 1.38)
              : tunnelSpeed * (1.18 + Math.min(0.35, tier * 0.04));
            for (let idx = 0; idx < burstCount; idx += 1) {
              const isStraightShot = idx === burstCount - 1;
              let spawnX = s.bossX;
              let spawnY = s.bossY;
              let vx = 0;
              let vy = 0;
              let vz = shotSpeed;
              let swirlAmpX = 0;
              let swirlAmpY = 0;

              if (!isStraightShot) {
                const chosen = scattered[idx];
                let laneX = chosen ? chosen.x : (Math.random() * 2 - 1) * 4.8;
                let laneY = chosen ? chosen.y : (Math.random() * 2 - 1) * 2.9;

                if (s.omegaBossActive && idx === 0) {
                  // Aimed hunter ball tracks toward player's lane with dodgeable spread
                  laneX = Math.max(-5.0, Math.min(5.0, s.shipX + (Math.random() - 0.5) * 2.2));
                  laneY = Math.max(-3.1, Math.min(3.1, s.shipY + (Math.random() - 0.5) * 1.6));
                } else {
                  const minBuffer = s.omegaBossActive ? 1.85 : 2.25;
                  const offX = laneX - s.shipX;
                  const offY = laneY - s.shipY;
                  const distToShip = Math.hypot(offX, offY);
                  if (distToShip < minBuffer) {
                    const randAngle = Math.random() * Math.PI * 2;
                    const pushDirX = distToShip > 0.08 ? offX / distToShip : Math.cos(randAngle);
                    const pushDirY = distToShip > 0.08 ? offY / distToShip : Math.sin(randAngle);
                    const pushDist = s.omegaBossActive ? 2.15 : 2.8;
                    laneX = Math.max(-5.0, Math.min(5.0, s.shipX + pushDirX * pushDist));
                    laneY = Math.max(-3.1, Math.min(3.1, s.shipY + pushDirY * (pushDist * 0.8)));
                  }
                }

                // Offset spawn point radially around boss halo toward scattered vector
                const rawDx = laneX - s.bossX;
                const rawDy = laneY - s.bossY;
                const radialLen = Math.hypot(rawDx, rawDy) || 1;
                spawnX = Math.max(-5.1, Math.min(5.1, s.bossX + (rawDx / radialLen) * 1.6));
                spawnY = Math.max(-3.1, Math.min(3.1, s.bossY + (rawDy / radialLen) * 1.15));

                const dx = laneX - spawnX;
                const dy = laneY - spawnY;
                const dz = 2.2 - -42;
                const dist = Math.hypot(dx, dy, dz) || 1;
                vx = (dx / dist) * shotSpeed;
                vy = (dy / dist) * shotSpeed;
                vz = (dz / dist) * shotSpeed;
                swirlAmpX = (Math.random() < 0.5 ? 1 : -1) * (1.8 + Math.random() * 1.6);
                swirlAmpY = (Math.random() < 0.5 ? 1 : -1) * (1.2 + Math.random() * 1.25);
              }

              const shot: WorldEntity = {
                id: s.nextEntityId++,
                kind: 'boss_shot',
                x: spawnX,
                y: spawnY,
                z: -42,
                vx,
                vy,
                vz,
                swirlAmpX,
                swirlAmpY,
                swirlFreq: isStraightShot ? 0 : 3.1 + Math.random() * 2.4,
                swirlPhase: Math.random() * Math.PI * 2,
                age: 0,
                hp: 999,
                radius: 0.9,
                passed: false,
                hitFlash: 0,
              };
              if (!use2DFallback) {
                const m = acquireEntityMesh('boss_shot');
                m.position.set(
                  shot.x + tunnelCurveX(shot.z, s.curveTime),
                  shot.y + tunnelCurveY(shot.z, s.curveTime),
                  shot.z
                );
                shot.mesh = m;
              }
              s.entities.push(shot);
            }

            if (s.omegaBossActive) {
              s.bossFireTimer =
                (s.omegaEnraged ? 0.54 : 0.66) / (1.05 * 1.1 * 0.95 * 1.05 * 1.05 * 0.7);
            } else {
              const baseCooldown =
                curDiffKey === 'extreme'
                  ? 1.0
                  : curDiffKey === 'hard'
                  ? 1.2
                  : curDiffKey === 'medium'
                  ? 1.38
                  : 1.55;
              s.bossFireTimer =
                Math.max(0.75, baseCooldown + 0.25 - tier * 0.08) /
                (1.05 * 1.1 * 0.95 * 1.05 * 1.05);
            }
          }
        }
      } else {
        bossGroup.visible = false;
      }

      // Operius Wave Spawner
      const spawnDroneWave = () => {
        if (curMode === 'endless') {
          const endlessSquads =
            endlessLevel >= 9.0
              ? [-4.0, -2.0, 0, 2.0, 4.0]
              : endlessLevel >= 6.5
              ? [-3.8, -1.3, 1.3, 3.8]
              : endlessLevel >= 4.2
              ? [-3.3, 0, 3.3]
              : endlessLevel >= 2.2
              ? [-2.4, 2.4]
              : null;
          if (!endlessSquads) {
            spawnEntity('drone');
            return;
          }
          for (let k = 0; k < endlessSquads.length; k += 1) {
            const dx = Math.max(
              -4.7,
              Math.min(4.7, endlessSquads[k] + (Math.random() - 0.5) * 0.85)
            );
            const dy = (Math.random() - 0.5) * 4.8;
            const dz = -98 - k * 1.4;
            spawnEntity('drone', dx, dy, dz);
          }
          return;
        }
        if (s.loopCount < 2) {
          spawnEntity('drone');
          return;
        }
        const laneCenters =
          s.loopCount >= 3 ? [-4.0, -2.0, 0, 2.0, 4.0] : [-3.3, 0, 3.3];
        for (let k = 0; k < laneCenters.length; k += 1) {
          const jitter = s.loopCount >= 3 ? 0.65 : 1.1;
          const dx = Math.max(-4.7, Math.min(4.7, laneCenters[k] + (Math.random() - 0.5) * jitter));
          const dy = (Math.random() - 0.5) * 4.8;
          const dz = -98 - k * 1.4;
          spawnEntity('drone', dx, dy, dz);
        }
      };

      const spawnSpikeObstacle = () => {
        const sideRoll = Math.random();
        const side: 'bottom' | 'left' | 'right' =
          sideRoll < 0.4 ? 'bottom' : sideRoll < 0.7 ? 'left' : 'right';
        spawnEntity('spike', undefined, undefined, -96, side);
        const pairChance =
          curMode === 'endless' ? Math.min(0.65, 0.24 + endlessLevel * 0.035) : 0.3;
        // Pair opposite side spikes or a bottom + side spike to shape a tighter flight path
        if (Math.random() < pairChance) {
          const pairSide: 'bottom' | 'left' | 'right' =
            side === 'left' ? 'right' : side === 'right' ? 'left' : Math.random() < 0.5 ? 'left' : 'right';
          spawnEntity('spike', undefined, undefined, -96, pairSide);
        }
      };

      s.spawnTimer -= dt;
      if (s.spawnTimer <= 0) {
        if (curMode === 'tutorial') {
          s.spawnTimer = 1.2;
          if (s.tutorialStep === 3) spawnEntity('orb');
          else if (s.tutorialStep === 4) spawnEntity(Math.random() < 0.5 ? 'drone' : 'hazard');
          else if (s.tutorialStep === 5) spawnEntity('ring');
        } else if (s.triumphTimer > 0 || (s.bossActive && s.bossIntroTimer > 0)) {
          s.spawnTimer = 0.55;
          spawnEntity('orb');
        } else if (s.omegaBossActive) {
          s.spawnTimer = s.omegaEnraged ? 0.7 : 0.78;
          const roll = Math.random();
          if (roll < 0.5) spawnEntity('orb');
          else if (roll < 0.66) spawnEntity('heal');
          else if (roll < 0.84) {
            spawnDroneWave();
            s.spawnTimer += 0.45;
          } else if (roll < 0.94) {
            spawnSpikeObstacle();
          } else {
            spawnEntity('hazard');
          }
        } else if (s.bossActive) {
          s.spawnTimer = 0.8;
          const roll = Math.random();
          if (roll < 0.5) spawnEntity('orb');
          else if (roll < 0.64) spawnEntity('heal');
          else if (roll < 0.82) {
            spawnDroneWave();
            if (s.loopCount >= 3) s.spawnTimer += 0.35;
            else if (s.loopCount >= 2) s.spawnTimer += 0.2;
          } else if (roll < 0.92) {
            spawnSpikeObstacle();
          } else {
            spawnEntity('hazard');
          }
        } else {
          const baseInterval =
            curDiffKey === 'extreme' ? 0.36 : curDiffKey === 'hard' ? 0.48 : 0.64;
          if (curMode === 'endless') {
            s.spawnTimer = Math.max(0.2, baseInterval / (1 + endlessLevel * 0.1));
            const orbCut = Math.max(0.22, 0.31 - endlessLevel * 0.008);
            const healCut = orbCut + Math.max(0.055, 0.08 - endlessLevel * 0.0025);
            const droneCut = healCut + 0.3;
            const spikeCut = droneCut + 0.18;
            const roll = Math.random();
            if (roll < orbCut) spawnEntity('orb');
            else if (roll < healCut) spawnEntity('heal');
            else if (roll < droneCut) {
              spawnDroneWave();
              s.spawnTimer += Math.max(0.14, 0.26 - endlessLevel * 0.01);
            } else if (roll < spikeCut) {
              spawnSpikeObstacle();
            } else {
              spawnEntity('hazard');
              if (endlessLevel >= 4.0 && Math.random() < Math.min(0.45, (endlessLevel - 3.0) * 0.05)) {
                spawnEntity('hazard', (Math.random() - 0.5) * 9.0, (Math.random() - 0.5) * 5.6, -102);
              }
            }
          } else {
            s.spawnTimer = Math.max(0.28, baseInterval / Math.sqrt(sectorBoost));
            const roll = Math.random();
            if (roll < 0.31) spawnEntity('orb');
            else if (roll < 0.39) spawnEntity('heal');
            else if (roll < 0.69) {
              spawnDroneWave();
              if (s.loopCount >= 3) s.spawnTimer += 0.42;
              else if (s.loopCount >= 2) s.spawnTimer += 0.25;
            } else if (roll < 0.86) {
              spawnSpikeObstacle();
            } else {
              spawnEntity('hazard');
            }
          }
        }
      }

      if ((curMode === 'standard' || curMode === 'standing' || curMode === 'endless') && !s.bossActive) {
        s.ringTimer -= dt;
        if (s.ringTimer <= 0) {
          s.ringTimer = 3.0;
          spawnEntity('ring');
        }
      }

      // Rare Purple Warp Ring Spawner (grants temporary extra fire rate)
      if (curMode !== 'tutorial' && s.triumphTimer <= 0) {
        s.purpleRingTimer -= dt;
        if (s.purpleRingTimer <= 0) {
          s.purpleRingTimer = 18 + Math.random() * 9;
          spawnEntity(
            'purple_ring',
            (Math.random() - 0.5) * 6.4,
            (Math.random() - 0.5) * 3.8,
            -98
          );
        }
      }

      // Periodic Mystery Box Spawner (unknown good or bad outcome until collected)
      if (curMode !== 'tutorial' && s.triumphTimer <= 0) {
        s.mysteryTimer -= dt;
        if (s.mysteryTimer <= 0) {
          s.mysteryTimer = 9 + Math.random() * 4.5;
          spawnEntity(
            'mystery',
            (Math.random() - 0.5) * 8.4,
            (Math.random() - 0.5) * 5.0,
            -98
          );
        }
      }

      // Update Player Laser Bolts (GPU InstancedMesh) & Check Hits vs Drones / Boss
      for (let bi = s.bolts.length - 1; bi >= 0; bi -= 1) {
        const bolt = s.bolts[bi];
        bolt.z -= 118 * dt;

        let consumed = false;

        // Check Boss Hit (warp-shielded during pre-battle intro animation)
        if (s.bossActive && !s.bossDefeated && Math.abs(bolt.z - s.bossIntroZ) < 3.6) {
          const dBoss = Math.hypot(bolt.x - s.bossX, bolt.y - s.bossY);
          const bossHitRadius = s.omegaBossActive ? 4.4 : 4.2;
          if (dBoss < bossHitRadius) {
            consumed = true;
            if (s.bossIntroTimer > 0) {
              spawnBurst(bolt.x, bolt.y, s.bossIntroZ + 2, 0xffd13b, 3);
            } else {
              const boltDmg = 3;
              s.bossHp = Math.max(0, s.bossHp - boltDmg);
              s.bossHitFlash = 0.08;
              s.score += Math.round(15 * diff.mult);
              spawnBurst(bolt.x, bolt.y, -42, 0x00f0ff, 4);

              if (s.bossHp <= 0) {
                s.bolts.splice(bi, 1);
                if (handleBossDefeated()) {
                  return;
                }
                break;
              }
            }
          }
        }

        // Check Drone / Barrier / Spike Hits
        if (!consumed) {
          for (let ei = s.entities.length - 1; ei >= 0; ei -= 1) {
            const ent = s.entities[ei];
            if (ent.kind !== 'drone' && ent.kind !== 'hazard' && ent.kind !== 'spike') continue;
            if (Math.abs(bolt.z - ent.z) < 2.6 && Math.hypot(bolt.x - ent.x, bolt.y - ent.y) < ent.radius + 0.5) {
              consumed = true;
              if (ent.kind === 'drone') {
                ent.hp -= 1;
                ent.hitFlash = 0.08;
                spawnBurst(ent.x, ent.y, ent.z, 0xf472b6, 5);
                if (ent.hp <= 0) {
                  s.dronesDestroyed += 1;
                  s.combo = Math.min(8, s.combo + 1);
                  const pts = Math.round(120 * s.combo * diff.mult);
                  s.score += pts;
                  audioSynth.play('explode');
                  spawnBurst(ent.x, ent.y, ent.z, 0xd946ef, 14);
                  const scr = projectToScreenPct(
                    ent.x + tunnelCurveX(ent.z, s.curveTime),
                    ent.y + tunnelCurveY(ent.z, s.curveTime),
                    ent.z
                  );
                  emitFloat({ text: `BLASTED +${pts}`, xPct: scr.xPct, yPct: scr.yPct, color: '#e879f9' });
                  releaseEntityMesh(ent);
                  s.entities.splice(ei, 1);
                }
              } else {
                // Indestructible red barrier deflects shot
                spawnBurst(bolt.x, bolt.y, ent.z + 0.6, 0xff3355, 3);
              }
              break;
            }
          }
        }

        if (consumed || bolt.z < -112) {
          s.bolts.splice(bi, 1);
        }
      }

      if (!use2DFallback) {
        const boltCount = Math.min(s.bolts.length, MAX_BOLTS);
        _dummyObj.rotation.set(0, 0, 0);
        _dummyObj.scale.set(1, 1, 1);
        for (let bi = 0; bi < boltCount; bi += 1) {
          const bolt = s.bolts[bi];
          _dummyObj.position.set(
            bolt.x + tunnelCurveX(bolt.z, s.curveTime),
            bolt.y + tunnelCurveY(bolt.z, s.curveTime),
            bolt.z
          );
          _dummyObj.updateMatrix();
          boltInstanced.setMatrixAt(bi, _dummyObj.matrix);
        }
        boltInstanced.count = boltCount;
        if (boltCount > 0) boltInstanced.instanceMatrix.needsUpdate = true;
      }

      // Update Entities & Player Collisions
      for (let i = s.entities.length - 1; i >= 0; i -= 1) {
        const ent = s.entities[i];
        if (ent.kind === 'boss_shot') {
          ent.age = (ent.age ?? 0) + dt;
          const phase = (ent.swirlPhase ?? 0) + ent.age * (ent.swirlFreq ?? 3.8);
          const swayX = Math.cos(phase) * (ent.swirlAmpX ?? 0);
          const swayY = Math.sin(phase * 0.85) * (ent.swirlAmpY ?? 0);
          ent.x += (ent.vx + swayX) * dt;
          ent.y += (ent.vy + swayY) * dt;
          ent.z += ent.vz * dt;
          if (ent.x > 5.3) {
            ent.x = 5.3;
            ent.vx = -Math.abs(ent.vx) * 0.8;
          } else if (ent.x < -5.3) {
            ent.x = -5.3;
            ent.vx = Math.abs(ent.vx) * 0.8;
          }
          if (ent.y > 3.3) {
            ent.y = 3.3;
            ent.vy = -Math.abs(ent.vy) * 0.8;
          } else if (ent.y < -3.3) {
            ent.y = -3.3;
            ent.vy = Math.abs(ent.vy) * 0.8;
          }
        } else {
          ent.z += tunnelSpeed * dt;
          if (ent.kind === 'drone') {
            ent.x += ent.vx * dt;
            if (ent.x > 5.0 || ent.x < -5.0) ent.vx *= -1;
          }
        }

        // Magnet pull on positive orbs
        if (ent.kind === 'orb' || ent.kind === 'heal') {
          const distXY = Math.hypot(s.shipX - ent.x, s.shipY - ent.y);
          if (ent.z > -18 && ent.z < 3 && distXY < diff.mag + 1.2) {
            ent.x += (s.shipX - ent.x) * dt * 6.5;
            ent.y += (s.shipY - ent.y) * dt * 6.5;
          }
        }

        if (ent.mesh) {
          ent.mesh.position.set(
            ent.x + tunnelCurveX(ent.z, s.curveTime),
            ent.y + tunnelCurveY(ent.z, s.curveTime),
            ent.z
          );
          if (
            ent.kind !== 'ring' &&
            ent.kind !== 'purple_ring' &&
            ent.kind !== 'hazard' &&
            ent.kind !== 'spike'
          ) {
            ent.mesh.rotation.y += dt * (ent.kind === 'mystery' ? 2.2 : 2.8);
            ent.mesh.rotation.x += dt * (ent.kind === 'mystery' ? 1.5 : 1.9);
            if (ent.kind === 'mystery' && ent.mesh.children[2]) {
              ent.mesh.children[2].rotation.z += dt * 3.4;
            }
          } else if (ent.kind === 'purple_ring') {
            ent.mesh.rotation.z += dt * 1.9;
          }
          if (ent.kind === 'drone') {
            const firstChild = ent.mesh.children[0] as THREE.Mesh | undefined;
            if (ent.hitFlash > 0) {
              ent.hitFlash = Math.max(0, ent.hitFlash - dt);
              if (firstChild && firstChild.material !== droneFlashMat) {
                firstChild.material = droneFlashMat;
              }
            } else if (firstChild && firstChild.material !== droneMat) {
              firstChild.material = droneMat;
            }
          }
        }

        const dz = Math.abs(ent.z - 2.2);
        const dXY = Math.hypot(ent.x - s.shipX, ent.y - s.shipY);

        if (!ent.passed && dz < 1.35) {
          if (ent.kind === 'ring') {
            if (dXY < ent.radius + 0.55) {
              ent.passed = true;
              s.ringsPassed += 1;
              s.combo = Math.min(8, s.combo + 1);
              const pts = Math.round(150 * s.combo * diff.mult);
              s.score += pts;
              audioSynth.play('core');
              emitFx('hyper');
              const scr = projectToScreenPct(ent.x, ent.y, ent.z);
              emitFloat({ text: `WARP +${pts}`, xPct: scr.xPct, yPct: scr.yPct, color: '#00f59b' });
            }
          } else if (ent.kind === 'purple_ring') {
            if (dXY < ent.radius + 0.55) {
              ent.passed = true;
              s.ringsPassed += 1;
              s.combo = Math.min(8, s.combo + 1);
              s.rapidFireTimer = 8.0;
              const pts = Math.round(220 * s.combo * diff.mult);
              s.score += pts;
              audioSynth.play('mystery_good');
              emitFx('hyper');
              const scr = projectToScreenPct(ent.x, ent.y, ent.z);
              emitFloat({
                text: `PURPLE RING: HYPER FIRE RATE (8s)! +${pts}`,
                xPct: scr.xPct,
                yPct: scr.yPct,
                color: '#d946ef',
              });
              spawnBurst(ent.x, ent.y, ent.z, 0xc026d3, 18);
            }
          } else if (ent.kind === 'orb' || ent.kind === 'heal') {
            if (dXY < diff.rad + 0.35) {
              ent.passed = true;
              s.orbsCollected += 1;
              const scr = projectToScreenPct(ent.x, ent.y, ent.z);

              if (ent.kind === 'heal') {
                s.hp = Math.min(s.maxHp, s.hp + diff.heal);
                const pts = Math.round(120 * diff.mult);
                s.score += pts;
                audioSynth.play('heal');
                emitFx('heal');
                emitFloat({ text: `SHIELD +${diff.heal} HP`, xPct: scr.xPct, yPct: scr.yPct, color: '#ffd13b' });
                spawnBurst(ent.x, ent.y, ent.z, 0xffd13b, 10);
              } else {
                const pts = Math.round(100 * s.combo * diff.mult);
                s.score += pts;
                s.combo = Math.min(8, s.combo + 1);
                spawnBurst(ent.x, ent.y, ent.z, 0x00f0ff, 10);

                if (s.bossActive && !s.bossDefeated && s.bossIntroTimer <= 0) {
                  audioSynth.play('laser');
                  if (s.beams.length < MAX_BEAMS) {
                    s.beams.push({
                      x: s.shipX,
                      y: s.shipY,
                      z: 1.4,
                      targetX: s.bossX,
                      targetY: s.bossY,
                      targetZ: -44,
                      life: 0.34,
                    });
                  }

                  const beamDmg = s.omegaBossActive ? 55 : 25;
                  s.bossHp = Math.max(0, s.bossHp - beamDmg);
                  s.bossHitFlash = 0.16;
                  emitFx('hyper');
                  emitFloat({
                    text: `SUPER BEAM! -${beamDmg}`,
                    xPct: scr.xPct,
                    yPct: scr.yPct,
                    color: '#00f0ff',
                  });
                  spawnBurst(s.bossX, s.bossY, -42, 0x00f0ff, 14);

                  if (s.bossHp <= 0) {
                    releaseEntityMesh(ent);
                    s.entities.splice(i, 1);
                    if (handleBossDefeated()) {
                      return;
                    }
                    continue;
                  }
                } else {
                  audioSynth.play('orb');
                  emitFloat({ text: `+${pts}`, xPct: scr.xPct, yPct: scr.yPct, color: '#00f0ff' });
                }
              }

              releaseEntityMesh(ent);
              s.entities.splice(i, 1);
              continue;
            }
          } else if (
            ent.kind === 'hazard' ||
            ent.kind === 'spike' ||
            ent.kind === 'drone' ||
            ent.kind === 'boss_shot'
          ) {
            const hitTriggered =
              ent.kind === 'spike'
                ? ent.spikeSide === 'left'
                  ? Math.abs(s.shipY - ent.y) < 1.25 && s.shipX < -2.55
                  : ent.spikeSide === 'right'
                  ? Math.abs(s.shipY - ent.y) < 1.25 && s.shipX > 2.55
                  : Math.abs(s.shipX - ent.x) < 1.35 && s.shipY < -0.85
                : dXY < 1.15;
            if (hitTriggered) {
              ent.passed = true;
              s.combo = 1;
              const endlessBonusDmg =
                curMode === 'endless' ? Math.min(16, Math.floor(endlessLevel * 1.25)) : 0;
              const hitDmg = ent.kind === 'boss_shot' ? 20 : diff.dmg + endlessBonusDmg;
              s.hp = Math.max(0, s.hp - hitDmg);
              s.shakeTimer = 0.28;
              audioSynth.play('hit');
              emitFx('dmg');
              const scr = projectToScreenPct(ent.x, ent.y, ent.z);
              emitFloat({ text: `-${hitDmg} HP SHIELD`, xPct: scr.xPct, yPct: scr.yPct, color: '#ff3355' });
              spawnBurst(ent.x, ent.y, ent.z, 0xff3355, 14);

              releaseEntityMesh(ent);
              s.entities.splice(i, 1);

              if (s.hp <= 0) {
                finishSession(false, 'Neural shield integrity depleted.');
                return;
              }
              continue;
            }
          } else if (ent.kind === 'mystery') {
            if (dXY < Math.max(1.5, diff.rad + 0.4)) {
              ent.passed = true;
              const mx = ent.x;
              const my = ent.y;
              const mz = ent.z;
              const scr = projectToScreenPct(mx, my, mz);

              releaseEntityMesh(ent);
              s.entities.splice(i, 1);

              // Roll good vs bad ONLY when collected — never revealed ahead of time
              const isGood = Math.random() < 0.52;
              if (isGood) {
                audioSynth.play('mystery_good');
                const goodRoll = Math.floor(Math.random() * 4);
                if (goodRoll === 0) {
                  // Jackpot Score + Max Combo
                  const pts = Math.round(900 * diff.mult);
                  s.score += pts;
                  s.combo = 8;
                  emitFx('hyper');
                  emitFloat({
                    text: `MYSTERY: JACKPOT +${pts} (8X)!`,
                    xPct: scr.xPct,
                    yPct: scr.yPct,
                    color: '#ffd13b',
                  });
                  spawnBurst(mx, my, mz, 0xffd13b, 18);
                } else if (goodRoll === 1) {
                  // 7.5s Triple-Bolt Overdrive Blasters
                  s.mysteryEffectType = 'overdrive';
                  s.mysteryEffectKind = 'good';
                  s.mysteryEffectLabel = 'OVERDRIVE 3X BLASTERS';
                  s.mysteryEffectTimer = 7.5;
                  emitFx('hyper');
                  emitFloat({
                    text: 'MYSTERY: OVERDRIVE BLASTERS (7.5s)!',
                    xPct: scr.xPct,
                    yPct: scr.yPct,
                    color: '#00f0ff',
                  });
                  spawnBurst(mx, my, mz, 0x00f0ff, 18);
                } else if (goodRoll === 2) {
                  // Nano-Shield Restore + Shockwave Clear
                  s.hp = Math.min(s.maxHp, s.hp + 35);
                  let cleared = 0;
                  for (let k = s.entities.length - 1; k >= 0; k -= 1) {
                    const other = s.entities[k];
                    if (other.kind === 'boss_shot' || other.kind === 'hazard' || other.kind === 'spike') {
                      spawnBurst(other.x, other.y, other.z, 0x00f59b, 6);
                      releaseEntityMesh(other);
                      s.entities.splice(k, 1);
                      if (k < i) i -= 1;
                      cleared += 1;
                    }
                  }
                  emitFx('heal');
                  emitFloat({
                    text:
                      cleared > 0
                        ? `MYSTERY: +35 HP SHIELD & ${cleared} CLEARED!`
                        : 'MYSTERY: +35 HP SHIELD RESTORED!',
                    xPct: scr.xPct,
                    yPct: scr.yPct,
                    color: '#00f59b',
                  });
                  spawnBurst(mx, my, mz, 0x00f59b, 18);
                } else {
                  // Hyper Strike against Boss or Tunnel Drones
                  if (s.bossActive && !s.bossDefeated && s.bossIntroTimer <= 0) {
                    const strikeDmg = s.omegaBossActive ? 260 : 150;
                    s.bossHp = Math.max(0, s.bossHp - strikeDmg);
                    s.bossHitFlash = 0.24;
                    for (const ox of [-1.2, 0, 1.2]) {
                      if (s.beams.length >= MAX_BEAMS) break;
                      s.beams.push({
                        x: s.shipX + ox,
                        y: s.shipY,
                        z: 1.4,
                        targetX: s.bossX,
                        targetY: s.bossY,
                        targetZ: -44,
                        life: 0.36,
                      });
                    }
                    emitFx('hyper');
                    emitFloat({
                      text: `MYSTERY: HYPER STRIKE -${strikeDmg} HP!`,
                      xPct: scr.xPct,
                      yPct: scr.yPct,
                      color: '#00f0ff',
                    });
                    spawnBurst(s.bossX, s.bossY, -42, 0x00f0ff, 22);
                    if (s.bossHp <= 0) {
                      if (handleBossDefeated()) {
                        return;
                      }
                      continue;
                    }
                  } else {
                    let blasted = 0;
                    for (let k = s.entities.length - 1; k >= 0; k -= 1) {
                      const other = s.entities[k];
                      if (other.kind === 'drone') {
                        spawnBurst(other.x, other.y, other.z, 0xd946ef, 12);
                        releaseEntityMesh(other);
                        s.entities.splice(k, 1);
                        if (k < i) i -= 1;
                        blasted += 1;
                        s.dronesDestroyed += 1;
                      }
                    }
                    const pts = Math.round((blasted > 0 ? blasted * 200 : 500) * diff.mult);
                    s.score += pts;
                    emitFx('hyper');
                    emitFloat({
                      text:
                        blasted > 0
                          ? `MYSTERY: NOVA BLAST ${blasted} DRONES (+${pts})!`
                          : `MYSTERY: BONUS +${pts} PTS!`,
                      xPct: scr.xPct,
                      yPct: scr.yPct,
                      color: '#00f0ff',
                    });
                    spawnBurst(mx, my, mz, 0x00f0ff, 18);
                  }
                }
              } else {
                audioSynth.play('mystery_bad');
                const badRoll = Math.floor(Math.random() * 4);
                if (badRoll === 0) {
                  // Shield Malfunction Shock
                  s.hp = Math.max(0, s.hp - 20);
                  s.shakeTimer = 0.36;
                  emitFx('dmg');
                  emitFloat({
                    text: 'MYSTERY: SYSTEM SHOCK -20% SHIELD!',
                    xPct: scr.xPct,
                    yPct: scr.yPct,
                    color: '#ff3355',
                  });
                  spawnBurst(mx, my, mz, 0xff3355, 18);
                  if (s.hp <= 0) {
                    finishSession(false, 'Mystery box overload depleted neural shield.');
                    return;
                  }
                } else if (badRoll === 1) {
                  // Combo Wipe + Point Drain
                  s.combo = 1;
                  s.score = Math.max(0, s.score - 350);
                  s.shakeTimer = 0.25;
                  emitFx('dmg');
                  emitFloat({
                    text: 'MYSTERY: COMBO WIPED (-350 PTS)!',
                    xPct: scr.xPct,
                    yPct: scr.yPct,
                    color: '#ff3355',
                  });
                  spawnBurst(mx, my, mz, 0xff3355, 16);
                } else if (badRoll === 2) {
                  // Inverted Steering for 6 seconds
                  s.mysteryEffectType = 'inverted';
                  s.mysteryEffectKind = 'bad';
                  s.mysteryEffectLabel = 'CONTROLS INVERTED';
                  s.mysteryEffectTimer = 6.0;
                  s.shakeTimer = 0.22;
                  emitFx('dmg');
                  emitFloat({
                    text: 'MYSTERY: CONTROLS INVERTED (6s)!',
                    xPct: scr.xPct,
                    yPct: scr.yPct,
                    color: '#fb7185',
                  });
                  spawnBurst(mx, my, mz, 0xf43f5e, 18);
                } else {
                  // Drone Ambush Ahead
                  s.shakeTimer = 0.22;
                  for (const dzOff of [-52, -66, -80]) {
                    spawnEntity(
                      'drone',
                      (Math.random() - 0.5) * 7.6,
                      (Math.random() - 0.5) * 4.4,
                      dzOff
                    );
                  }
                  emitFx('dmg');
                  emitFloat({
                    text: 'MYSTERY: DRONE AMBUSH!',
                    xPct: scr.xPct,
                    yPct: scr.yPct,
                    color: '#e879f9',
                  });
                  spawnBurst(mx, my, mz, 0xd946ef, 18);
                }
              }
              continue;
            }
          }
        }

        if (ent.z > 9.5) {
          if (
            !ent.passed &&
            (ent.kind === 'hazard' ||
              ent.kind === 'spike' ||
              ent.kind === 'drone' ||
              ent.kind === 'boss_shot')
          ) {
            s.hazardsDodged += 1;
          }
          releaseEntityMesh(ent);
          s.entities.splice(i, 1);
        }
      }

      // Update Super Counter-Beams (GPU InstancedMesh)
      for (let i = s.beams.length - 1; i >= 0; i -= 1) {
        const b = s.beams[i];
        b.life -= dt;
        if (b.life <= 0) {
          s.beams.splice(i, 1);
        }
      }
      if (!use2DFallback) {
        const beamCount = Math.min(s.beams.length, MAX_BEAMS);
        _dummyObj.scale.set(1, 1, 1);
        for (let i = 0; i < beamCount; i += 1) {
          const b = s.beams[i];
          const t = 1 - Math.max(0, b.life) / 0.34;
          const cz = b.z + (b.targetZ - b.z) * t;
          const cx = b.x + (b.targetX - b.x) * t + tunnelCurveX(cz, s.curveTime);
          const cy = b.y + (b.targetY - b.y) * t + tunnelCurveY(cz, s.curveTime);
          _dummyObj.position.set(cx, cy, cz);
          _dummyObj.lookAt(
            b.targetX + tunnelCurveX(b.targetZ, s.curveTime),
            b.targetY + tunnelCurveY(b.targetZ, s.curveTime),
            b.targetZ
          );
          _dummyObj.updateMatrix();
          beamInstanced.setMatrixAt(i, _dummyObj.matrix);
        }
        beamInstanced.count = beamCount;
        if (beamCount > 0) beamInstanced.instanceMatrix.needsUpdate = true;
      }

      // Update Explosion Sparks (GPU InstancedMesh)
      for (let i = s.sparks.length - 1; i >= 0; i -= 1) {
        const p = s.sparks[i];
        p.life -= dt;
        if (p.life <= 0) {
          s.sparks.splice(i, 1);
        } else {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
        }
      }
      if (!use2DFallback) {
        const sparkCount = Math.min(s.sparks.length, MAX_SPARKS);
        _dummyObj.rotation.set(0, 0, 0);
        for (let i = 0; i < sparkCount; i += 1) {
          const p = s.sparks[i];
          const sc = Math.max(0.01, p.life / p.maxLife);
          _dummyObj.position.set(
            p.x + tunnelCurveX(p.z, s.curveTime),
            p.y + tunnelCurveY(p.z, s.curveTime),
            p.z
          );
          _dummyObj.scale.setScalar(sc);
          _dummyObj.updateMatrix();
          sparkInstanced.setMatrixAt(i, _dummyObj.matrix);
          _tmpColor.setHex(p.color);
          sparkInstanced.setColorAt(i, _tmpColor);
        }
        sparkInstanced.count = sparkCount;
        if (sparkCount > 0) {
          sparkInstanced.instanceMatrix.needsUpdate = true;
          if (sparkInstanced.instanceColor) sparkInstanced.instanceColor.needsUpdate = true;
        }
      }

      if (curMode === 'standard' || curMode === 'standing' || curMode === 'endless') {
        s.score += dt * 15 * diff.mult;
      }

      s.hudSyncTimer += dt;
      const roundedScore = Math.round(s.score);
      const roundedHp = Math.round(s.hp);
      const bossIntroNow = s.bossActive && s.bossIntroTimer > 0;
      const milestoneChanged =
        roundedHp !== lastHudHp ||
        s.bossHp !== lastHudBossHp ||
        s.bossActive !== lastHudBossActive ||
        bossIntroNow !== lastHudBossIntro ||
        s.sector !== lastHudSector ||
        s.combo !== lastHudCombo ||
        s.tutorialStep !== lastHudTutStep;

      if (milestoneChanged || (s.hudSyncTimer >= 0.085 && roundedScore !== lastHudScore)) {
        s.hudSyncTimer = 0;
        lastHudScore = roundedScore;
        lastHudHp = roundedHp;
        lastHudBossHp = s.bossHp;
        lastHudBossActive = s.bossActive;
        lastHudBossIntro = bossIntroNow;
        lastHudSector = s.sector;
        lastHudCombo = s.combo;
        lastHudTutStep = s.tutorialStep;

        const xRom = Math.min(100, Math.round(((s.leftReach + s.rightReach) / 2) * 100));
        const yRom = Math.min(100, Math.round(((s.upReach + s.downReach) / 2) * 100));
        const sym = Math.max(0, Math.min(100, Math.round(100 - Math.abs(s.leftReach - s.rightReach) * 55)));

        emitTelemetry({
          score: roundedScore,
          highScore: Math.max(curHigh, roundedScore),
          combo: s.combo,
          hp: roundedHp,
          maxHp: Math.round(s.maxHp),
          xRom,
          yRom,
          symmetry: sym,
          leftReach: Math.round(s.leftReach * 100),
          rightReach: Math.round(s.rightReach * 100),
          upReach: Math.round(s.upReach * 100),
          downReach: Math.round(s.downReach * 100),
          elapsedSec: Math.round(s.elapsedSec),
          orbsCollected: s.orbsCollected,
          ringsPassed: s.ringsPassed,
          hazardsDodged: s.hazardsDodged,
          dronesDestroyed: s.dronesDestroyed,
          sector: s.sector,
          bossActive: s.bossActive,
          bossHp: s.bossHp,
          bossMaxHp: s.bossMaxHp,
          bossDefeated: s.bossDefeated,
          bossStage: s.bossStage,
          bossesClearedInLevel: s.bossesClearedInLevel,
          totalBossesDefeated: s.totalBossesDefeated,
          loopCount: s.loopCount,
          omegaBossActive: s.omegaBossActive,
          bossName: s.bossName,
          bossIntroActive: bossIntroNow,
          bossIntroSubtitle: s.bossIntroSubtitle,
          rapidFireTimer: s.rapidFireTimer,
          mysteryEffectKind: s.mysteryEffectKind,
          mysteryEffectLabel: s.mysteryEffectLabel,
          mysteryEffectTimer: s.mysteryEffectTimer,
          tutorialStep: s.tutorialStep,
          tutorialLabel: TUTORIAL_STEPS[s.tutorialStep - 1] ?? TUTORIAL_STEPS[0],
        });
      }

      renderFrame(curLight, s.shipX, s.shipY, s, now);
    };

    runLoop = (now = performance.now()) => {
      if (disposed) return;
      tick(now);
      scheduleNextFrame();
    };

    if (isSoftwareGl) {
      rafId = window.setTimeout(() => runLoop(performance.now()), 0);
    } else {
      rafId = requestAnimationFrame(runLoop);
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      clearTimeout(rafId);
      window.removeEventListener('resize', handleResize);
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      sceneRefs.current.resetPools = null;
      nebulaWallGeo.dispose();
      for (const tex of nebulaTextures) tex.dispose();
      for (const mat of nebulaMats) mat.dispose();
      mysteryTex.dispose();
      mysteryCubeGeo.dispose();
      mysteryMat.dispose();
      mysteryWireGeo.dispose();
      mysteryWireMat.dispose();
      mysteryRingGeo.dispose();
      mysteryRingMat.dispose();
      purpleGateOuterGeo.dispose();
      purpleGateOuterMat.dispose();
      purpleGateInnerGeo.dispose();
      purpleGateInnerMat.dispose();
      ribGeo.dispose();
      ribMatPrimary.dispose();
      ribMatSecondary.dispose();
      railMat.dispose();
      for (const rl of railLines) rl.geometry.dispose();
      starGeo.dispose();
      starMat.dispose();
      orbGeo.dispose();
      orbMat.dispose();
      healGeo.dispose();
      healMat.dispose();
      gateGeo.dispose();
      gateMat.dispose();
      hazardGeo.dispose();
      hazardMat.dispose();
      droneGeo.dispose();
      droneMat.dispose();
      droneFlashMat.dispose();
      droneWireGeo.dispose();
      droneWireMat.dispose();
      shotGeo.dispose();
      shotMat.dispose();
      spikeConeGeo.dispose();
      spikeSubGeo.dispose();
      spikeBaseGeo.dispose();
      spikeMat.dispose();
      spikeBaseMat.dispose();
      spikeWireGeo.dispose();
      spikeWireMat.dispose();
      boltGeo.dispose();
      boltMat.dispose();
      beamGeo.dispose();
      beamMat.dispose();
      sparkGeo.dispose();
      sparkPoolMat.dispose();
      boltInstanced.dispose();
      beamInstanced.dispose();
      sparkInstanced.dispose();
      Object.values(bossPartGeos).forEach((g) => g.dispose());
      bossCoreMat.dispose();
      bossRingMat.dispose();
      bossAccentMat.dispose();
      bossWireMat.dispose();
      if (renderer) {
        renderer.dispose();
      }
      if (canvas.parentElement === container) {
        container.removeChild(canvas);
      }
    };
  }, [steerRef, manualFireRef]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 w-full h-full z-[1]"
      aria-label="3D Operius-Style NeuroMove Flight Viewport"
    />
  );
});
GameViewport3D.displayName = 'GameViewport3D';

// Lightweight 2D perspective fallback if WebGL is unavailable
function renderFallback2D(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  isLight: boolean,
  shipX: number,
  shipY: number,
  sim: {
    entities: WorldEntity[];
    bolts: PlayerBolt[];
    curveTime: number;
    bossActive: boolean;
    bossX: number;
    bossY: number;
    bossVariant: number;
    omegaBossActive: boolean;
    bossIntroZ: number;
    bossIntroScale: number;
  },
  now: number
) {
  ctx.fillStyle = isLight ? '#e6eff9' : '#050412';
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2 - shipX * 18;
  const cy = h / 2 + shipY * 14;
  const fov = Math.min(w, h) * 0.72;

  // Octagonal twisting tunnel ribs
  ctx.lineWidth = 2;
  const phase = (now * 0.018) % 5.5;
  for (let i = 1; i <= 18; i += 1) {
    const zWorld = 2.2 - (i * 5.5 - phase);
    const z = 8.2 - zWorld;
    if (z <= 1) continue;
    const rx = cx + (tunnelCurveX(zWorld, sim.curveTime) * fov) / z;
    const ry = cy - (tunnelCurveY(zWorld, sim.curveTime) * fov) / z;
    const r = (9.8 * fov) / z;
    ctx.strokeStyle = i % 2 === 0 ? 'rgba(0, 229, 255, 0.32)' : 'rgba(217, 70, 239, 0.28)';
    ctx.beginPath();
    for (let v = 0; v <= 8; v += 1) {
      const a = (v / 8) * Math.PI * 2 + Math.PI / 8;
      const vx = rx + Math.cos(a) * r;
      const vy = ry + Math.sin(a) * r;
      if (v === 0) ctx.moveTo(vx, vy);
      else ctx.lineTo(vx, vy);
    }
    ctx.stroke();
  }

  // Boss (distinct colors & polygon sides per variant)
  if (sim.bossActive) {
    const z = Math.max(12, 8.2 - sim.bossIntroZ);
    const bx = cx + ((sim.bossX + tunnelCurveX(sim.bossIntroZ, sim.curveTime)) * fov) / z;
    const by = cy - ((sim.bossY + tunnelCurveY(sim.bossIntroZ, sim.curveTime)) * fov) / z;
    const br = ((3.4 * sim.bossIntroScale) * fov) / z;
    const bossColors = [
      '#ff2a6d',
      '#ff6b00',
      '#9333ea',
      '#10b981',
      '#2563eb',
      '#ec4899',
      '#ea580c',
      '#06b6d4',
    ];
    ctx.fillStyle = sim.omegaBossActive
      ? '#ff0044'
      : bossColors[sim.bossVariant % bossColors.length];
    const sides = sim.omegaBossActive ? 8 : 3 + (sim.bossVariant % 6);
    ctx.beginPath();
    for (let v = 0; v <= sides; v += 1) {
      const a = (v / sides) * Math.PI * 2 + now * 0.002;
      const vx = bx + Math.cos(a) * br;
      const vy = by + Math.sin(a) * br;
      if (v === 0) ctx.moveTo(vx, vy);
      else ctx.lineTo(vx, vy);
    }
    ctx.closePath();
    ctx.fill();
  }

  // Bolts
  ctx.fillStyle = '#00f5ff';
  for (const b of sim.bolts) {
    const z = 8.2 - b.z;
    if (z <= 0.5) continue;
    const sx = cx + ((b.x + tunnelCurveX(b.z, sim.curveTime)) * fov) / z;
    const sy = cy - ((b.y + tunnelCurveY(b.z, sim.curveTime)) * fov) / z;
    ctx.fillRect(sx - 2, sy - 6, 4, 12);
  }

  // Entities
  for (const e of sim.entities) {
    const z = 8.2 - e.z;
    if (z <= 0.5) continue;
    const sx = cx + ((e.x + tunnelCurveX(e.z, sim.curveTime)) * fov) / z;
    const sy = cy - ((e.y + tunnelCurveY(e.z, sim.curveTime)) * fov) / z;
    const sr = Math.max(4, (e.radius * fov) / z);
    if (e.kind === 'mystery') {
      const boxSize = Math.max(12, sr * 1.65);
      ctx.fillStyle = '#5b21b6';
      ctx.strokeStyle = '#ffd13b';
      ctx.lineWidth = 2.5;
      ctx.fillRect(sx - boxSize / 2, sy - boxSize / 2, boxSize, boxSize);
      ctx.strokeRect(sx - boxSize / 2, sy - boxSize / 2, boxSize, boxSize);
      ctx.fillStyle = '#fef08a';
      ctx.font = `bold ${Math.max(10, Math.round(boxSize * 0.65))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', sx, sy + 1);
      continue;
    }
    if (e.kind === 'spike') {
      const tipX = e.spikeSide === 'left' ? sx + sr * 1.45 : e.spikeSide === 'right' ? sx - sr * 1.45 : sx;
      const tipY = e.spikeSide === 'bottom' ? sy - sr * 1.45 : sy;
      ctx.fillStyle = '#ff3b1f';
      ctx.strokeStyle = '#ffd13b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      if (e.spikeSide === 'left' || e.spikeSide === 'right') {
        const baseX = e.spikeSide === 'left' ? sx - sr * 1.15 : sx + sr * 1.15;
        ctx.lineTo(baseX, sy - sr * 0.9);
        ctx.lineTo(baseX, sy + sr * 0.9);
      } else {
        ctx.lineTo(sx - sr * 0.95, sy + sr * 1.15);
        ctx.lineTo(sx + sr * 0.95, sy + sr * 1.15);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      continue;
    }
    if (e.kind === 'purple_ring') {
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#f0abfc';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sx, sy, sr * 0.78, 0, Math.PI * 2);
      ctx.stroke();
      continue;
    }
    ctx.strokeStyle =
      e.kind === 'orb'
        ? '#00f0ff'
        : e.kind === 'heal'
        ? '#ffd13b'
        : e.kind === 'ring'
        ? '#00f59b'
        : e.kind === 'drone'
        ? '#d946ef'
        : '#ff3355';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    if (e.kind === 'ring') {
      ctx.lineWidth = 3;
      ctx.stroke();
    } else {
      ctx.fill();
    }
  }

  // Player glider
  const px = w / 2 + shipX * 36;
  const py = h * 0.72 - shipY * 28;
  ctx.fillStyle = '#00f0ff';
  ctx.beginPath();
  ctx.moveTo(px, py - 20);
  ctx.lineTo(px + 28, py + 16);
  ctx.lineTo(px - 28, py + 16);
  ctx.closePath();
  ctx.fill();
}
