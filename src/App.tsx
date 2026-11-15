import { useCallback, useEffect, useRef, useState } from 'react';
import { GameViewport3D } from './components/GameViewport3D';
import { HudOverlay } from './components/HudOverlay';
import { ReportModal } from './components/ReportModal';
import { StartModal } from './components/StartModal';
import {
  CamStatus,
  DIFFS,
  DifficultyKey,
  FloatingMessage,
  FxType,
  GameMode,
  GamePhase,
  SessionReport,
  SteerInput,
  TelemetryData,
  TrackingMode,
} from './types/game';
import { audioSynth } from './utils/audio';
import { MirroredHeadTracker } from './utils/headTracker';

const HIGH_SCORE_KEY = 'neuromove_ai_3d_high_score';

function loadHighScore(): number {
  try {
    const raw = window.localStorage.getItem(HIGH_SCORE_KEY);
    const parsed = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function saveHighScore(score: number): void {
  try {
    window.localStorage.setItem(HIGH_SCORE_KEY, String(score));
  } catch {
    // Ignore storage quota or private browsing errors.
  }
}

const INITIAL_TELEMETRY: TelemetryData = {
  score: 0,
  highScore: 0,
  combo: 1,
  hp: 100,
  maxHp: 100,
  xRom: 0,
  yRom: 0,
  symmetry: 100,
  leftReach: 0,
  rightReach: 0,
  upReach: 0,
  downReach: 0,
  elapsedSec: 0,
  orbsCollected: 0,
  ringsPassed: 0,
  hazardsDodged: 0,
  dronesDestroyed: 0,
  sector: 1,
  bossActive: false,
  bossHp: DIFFS.easy.bossHp,
  bossMaxHp: DIFFS.easy.bossHp,
  bossDefeated: false,
  bossStage: 1,
  bossesClearedInLevel: 0,
  totalBossesDefeated: 0,
  loopCount: 1,
  omegaBossActive: false,
  bossName: 'CRIMSON SENTINEL',
  bossIntroActive: false,
  bossIntroSubtitle: 'HYPER-WARP INTERCEPT',
  rapidFireTimer: 0,
  mysteryEffectKind: null,
  mysteryEffectLabel: null,
  mysteryEffectTimer: 0,
  tutorialStep: 1,
  tutorialLabel: 'Tilt or steer LEFT and RIGHT to test lateral control',
};

export default function App() {
  const [phase, setPhase] = useState<GamePhase>('menu');
  const [mode, setMode] = useState<GameMode>('standard');
  const [difficulty, setDifficulty] = useState<DifficultyKey>('easy');
  const [runId, setRunId] = useState(0);

  const [highScore, setHighScore] = useState<number>(() => loadHighScore());
  const [telemetry, setTelemetry] = useState<TelemetryData>(() => ({
    ...INITIAL_TELEMETRY,
    highScore: loadHighScore(),
  }));
  const [report, setReport] = useState<SessionReport | null>(null);

  const [isLight, setIsLight] = useState(false);
  const [themeCountdown, setThemeCountdown] = useState(30);
  const [isMuted, setIsMuted] = useState(false);

  const [camActive, setCamActive] = useState(false);
  const [camStatus, setCamStatus] = useState<CamStatus>('STANDBY');
  const [trackingMode, setTrackingMode] = useState<TrackingMode>('head');
  const [headSensitivity, setHeadSensitivity] = useState(1.5);
  const [autoFire, setAutoFire] = useState(true);

  const [activeFx, setActiveFx] = useState<FxType | null>(null);
  const [floatMsgs, setFloatMsgs] = useState<FloatingMessage[]>([]);
  const [triumphLoops, setTriumphLoops] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pipCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const startPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const trackerRef = useRef<MirroredHeadTracker | null>(null);

  const steerRef = useRef<SteerInput>({ x: 0, y: 0 });
  const manualFireRef = useRef(false);
  const keysRef = useRef<Set<string>>(new Set());
  const pointerSteerRef = useRef<SteerInput>({ x: 0, y: 0 });
  const pointerActiveRef = useRef(false);
  const floatIdRef = useRef(1);
  const fxTimerRef = useRef<number | null>(null);
  const triumphTimerRef = useRef<number | null>(null);

  // Initialize head tracker instance once
  if (!trackerRef.current && typeof document !== 'undefined') {
    trackerRef.current = new MirroredHeadTracker();
  }

  // Sync dark/light class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (isLight) {
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
    }
  }, [isLight]);

  // 30-second theme auto-cycle timer
  useEffect(() => {
    const timer = window.setInterval(() => {
      setThemeCountdown((prev) => {
        if (prev <= 1) {
          setIsLight((cur) => !cur);
          return 30;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const handleToggleTheme = useCallback(() => {
    setIsLight((cur) => !cur);
    setThemeCountdown(30);
  }, []);

  const handleToggleMute = useCallback(() => {
    setIsMuted((cur) => {
      const next = !cur;
      audioSynth.muted = next;
      return next;
    });
  }, []);

  const handleTriggerFx = useCallback((fx: FxType) => {
    setActiveFx(fx);
    if (fxTimerRef.current !== null) {
      window.clearTimeout(fxTimerRef.current);
    }
    fxTimerRef.current = window.setTimeout(() => {
      setActiveFx(null);
      fxTimerRef.current = null;
    }, 180);
  }, []);

  const handleFloatMsg = useCallback((msg: Omit<FloatingMessage, 'id'>) => {
    const id = floatIdRef.current++;
    setFloatMsgs((prev) => [...prev.slice(-8), { ...msg, id }]);
    window.setTimeout(() => {
      setFloatMsgs((prev) => prev.filter((item) => item.id !== id));
    }, 850);
  }, []);

  const handleTriLoopTriumph = useCallback((loopsCompleted: number) => {
    setTriumphLoops(loopsCompleted);
    if (triumphTimerRef.current !== null) {
      window.clearTimeout(triumphTimerRef.current);
    }
    triumphTimerRef.current = window.setTimeout(() => {
      setTriumphLoops(null);
      triumphTimerRef.current = null;
    }, 4200);
  }, []);

  const handleToggleCam = useCallback(async () => {
    const tracker = trackerRef.current;
    const video = videoRef.current;
    if (!tracker || !video) return;

    if (tracker.state.active) {
      tracker.stop(pipCanvasRef.current);
      setCamActive(false);
      setCamStatus('STANDBY');
      return;
    }

    const ok = await tracker.start(video);
    if (ok) {
      setCamActive(true);
      setCamStatus('LOCKED');
    } else {
      setCamActive(false);
      setCamStatus('DENIED');
    }
  }, []);

  const handleRecenter = useCallback(() => {
    const tracker = trackerRef.current;
    if (!tracker || !tracker.state.active) return;
    tracker.recenter();
    handleFloatMsg({ text: 'TRACKER RE-CENTERED', xPct: 50, yPct: 28, color: '#00f0ff' });
  }, [handleFloatMsg]);

  const handleChangeTrackingMode = useCallback((nextMode: TrackingMode) => {
    setTrackingMode(nextMode);
    trackerRef.current?.setTrackingMode(nextMode);
  }, []);

  const handleChangeSensitivity = useCallback((val: number) => {
    setHeadSensitivity(val);
    if (trackerRef.current) {
      trackerRef.current.sensitivity = val;
    }
  }, []);

  const handleLaunch = useCallback(
    (selectedMode: GameMode) => {
      const diff = DIFFS[difficulty];
      if (selectedMode === 'standing') {
        handleChangeTrackingMode('body');
        if (trackerRef.current && !trackerRef.current.state.active) {
          void handleToggleCam();
        }
      }
      setMode(selectedMode);
      setReport(null);
      setTriumphLoops(null);
      setTelemetry({
        ...INITIAL_TELEMETRY,
        highScore,
        bossActive: selectedMode === 'boss',
        bossHp: diff.bossHp,
        bossMaxHp: diff.bossHp,
        bossStage: 1,
        bossesClearedInLevel: 0,
        totalBossesDefeated: 0,
        loopCount: 1,
        omegaBossActive: false,
        bossName: 'CRIMSON SENTINEL',
        bossIntroActive: selectedMode === 'boss',
        bossIntroSubtitle: 'HYPER-WARP INTERCEPT',
        rapidFireTimer: 0,
      });
      setRunId((id) => id + 1);
      setPhase('playing');
      audioSynth.play('step');
    },
    [difficulty, highScore, handleChangeTrackingMode, handleToggleCam]
  );

  const handleStopRun = useCallback(() => {
    const t = telemetry;
    const stopReport: SessionReport = {
      mode,
      difficulty,
      score: t.score,
      elapsedSec: t.elapsedSec,
      xRom: t.xRom,
      yRom: t.yRom,
      symmetry: t.symmetry,
      rank:
        t.score >= 2200
          ? 'S'
          : t.score >= 1200
          ? 'A'
          : t.score >= 600
          ? 'B'
          : t.score >= 200
          ? 'C'
          : 'D',
      orbsCollected: t.orbsCollected,
      ringsPassed: t.ringsPassed,
      hazardsDodged: t.hazardsDodged,
      dronesDestroyed: t.dronesDestroyed,
      sector: t.sector,
      bossDefeated: false,
      totalBossesDefeated: t.totalBossesDefeated,
      loopCount: t.loopCount,
      outcomeSummary: 'Session ended by pilot.',
    };
    if (t.score > highScore) {
      setHighScore(t.score);
      saveHighScore(t.score);
    }
    setReport(stopReport);
    setPhase('report');
  }, [telemetry, mode, difficulty, highScore]);

  const handleGameEnd = useCallback(
    (finalReport: SessionReport) => {
      if (finalReport.score > highScore) {
        setHighScore(finalReport.score);
        saveHighScore(finalReport.score);
      }
      if (finalReport.bossDefeated) {
        setDifficulty('easy');
      }
      setReport(finalReport);
      setPhase('report');
    },
    [highScore]
  );

  const handleTelemetry = useCallback(
    (data: TelemetryData) => {
      setTelemetry(data);
      if (data.highScore > highScore) {
        setHighScore(data.highScore);
        saveHighScore(data.highScore);
      }
    },
    [highScore]
  );

  const handleTogglePause = useCallback(() => {
    setPhase((cur) => (cur === 'playing' ? 'paused' : cur === 'paused' ? 'playing' : cur));
  }, []);

  const handleToggleAutoFire = useCallback(() => {
    setAutoFire((v) => !v);
  }, []);

  const handleNoopBossTrigger = useCallback(() => {}, []);

  // Combined input polling (Keyboard + Pointer + Mirrored Webcam Head Tracker)
  const handleUpdateCamAndInput = useCallback(() => {
    const tracker = trackerRef.current;
    const video = videoRef.current;
    if (tracker && video && tracker.state.active) {
      tracker.update(video, pipCanvasRef.current, startPreviewCanvasRef.current);
      setCamStatus((prev) => (prev !== tracker.state.status ? tracker.state.status : prev));
    }

    const keys = keysRef.current;
    let kx = 0;
    let ky = 0;
    if (keys.has('ArrowLeft') || keys.has('KeyA')) kx -= 1;
    if (keys.has('ArrowRight') || keys.has('KeyD')) kx += 1;
    if (keys.has('ArrowUp') || keys.has('KeyW')) ky += 1;
    if (keys.has('ArrowDown') || keys.has('KeyS')) ky -= 1;

    if (kx !== 0 || ky !== 0) {
      steerRef.current.x = kx;
      steerRef.current.y = ky;
    } else if (tracker && tracker.state.active) {
      steerRef.current.x = tracker.state.steerX;
      steerRef.current.y = tracker.state.steerY;
    } else if (pointerActiveRef.current) {
      steerRef.current.x = pointerSteerRef.current.x;
      steerRef.current.y = pointerSteerRef.current.y;
    } else {
      steerRef.current.x = 0;
      steerRef.current.y = 0;
    }
  }, []);

  // Global keyboard & pointer listeners
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      keysRef.current.add(e.code);
      if (e.code === 'KeyC') {
        handleRecenter();
      } else if (e.code === 'Escape' && (phase === 'playing' || phase === 'paused')) {
        handleStopRun();
      } else if (e.code === 'KeyP' && (phase === 'playing' || phase === 'paused')) {
        e.preventDefault();
        handleTogglePause();
      } else if (e.code === 'Space' && phase === 'playing') {
        e.preventDefault();
        manualFireRef.current = true;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.code);
      if (e.code === 'Space') {
        manualFireRef.current = false;
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (phase === 'playing' && e.button === 0 && !(e.target as HTMLElement)?.closest('button, input')) {
        manualFireRef.current = true;
      }
    };

    const onPointerUp = () => {
      manualFireRef.current = false;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = -((e.clientY / window.innerHeight) * 2 - 1);
      pointerSteerRef.current.x = Math.max(-1, Math.min(1, nx * 1.35));
      pointerSteerRef.current.y = Math.max(-1, Math.min(1, ny * 1.35));
      pointerActiveRef.current = true;
    };

    const onPointerLeave = () => {
      pointerActiveRef.current = false;
      manualFireRef.current = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerleave', onPointerLeave);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerleave', onPointerLeave);
    };
  }, [phase, handleRecenter, handleStopRun, handleTogglePause]);

  // Clean up webcam stream on unmount
  useEffect(() => {
    return () => {
      trackerRef.current?.stop(null);
    };
  }, []);

  return (
    <main className="relative w-full h-full overflow-hidden select-none bg-[#050814]">
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="fixed top-0 left-0 w-px h-px opacity-0 pointer-events-none"
      />

      <GameViewport3D
        phase={phase}
        mode={mode}
        difficulty={difficulty}
        isLight={isLight}
        highScore={highScore}
        autoFire={autoFire}
        manualFireRef={manualFireRef}
        steerRef={steerRef}
        onTelemetry={handleTelemetry}
        onFx={handleTriggerFx}
        onFloatMsg={handleFloatMsg}
        onBossTrigger={handleNoopBossTrigger}
        onAdvanceDifficulty={setDifficulty}
        onTriLoopTriumph={handleTriLoopTriumph}
        onGameEnd={handleGameEnd}
        onUpdateCam={handleUpdateCamAndInput}
        runId={runId}
      />

      <HudOverlay
        phase={phase}
        mode={mode}
        difficulty={difficulty}
        telemetry={telemetry}
        isLight={isLight}
        themeCountdown={themeCountdown}
        isMuted={isMuted}
        camActive={camActive}
        camStatus={camStatus}
        trackingMode={trackingMode}
        headSensitivity={headSensitivity}
        autoFire={autoFire}
        activeFx={activeFx}
        floatMsgs={floatMsgs}
        triumphLoops={triumphLoops}
        pipCanvasRef={pipCanvasRef}
        onToggleTheme={handleToggleTheme}
        onToggleMute={handleToggleMute}
        onToggleAutoFire={handleToggleAutoFire}
        onTogglePause={handleTogglePause}
        onStop={handleStopRun}
        onToggleCam={handleToggleCam}
        onRecenter={handleRecenter}
        onChangeTrackingMode={handleChangeTrackingMode}
        onChangeSensitivity={handleChangeSensitivity}
      />

      {phase === 'menu' && (
        <StartModal
          difficulty={difficulty}
          camActive={camActive}
          camStatus={camStatus}
          trackingMode={trackingMode}
          highScore={highScore}
          previewCanvasRef={startPreviewCanvasRef}
          onSelectDifficulty={setDifficulty}
          onToggleCam={handleToggleCam}
          onRecenter={handleRecenter}
          onChangeTrackingMode={handleChangeTrackingMode}
          onLaunch={handleLaunch}
        />
      )}

      {phase === 'report' && report && (
        <ReportModal
          report={report}
          onMainMenu={() => {
            setDifficulty('easy');
            setPhase('menu');
          }}
          onPlayAgain={(m) => handleLaunch(m)}
        />
      )}
    </main>
  );
}
