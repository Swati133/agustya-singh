import React from 'react';
import {
  Camera,
  CameraOff,
  Crosshair,
  Moon,
  Pause,
  PersonStanding,
  Play,
  Square,
  Sun,
  Trophy,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import {
  CamStatus,
  DIFF_ORDER,
  DIFFS,
  DifficultyKey,
  FloatingMessage,
  FxType,
  GameMode,
  GamePhase,
  TelemetryData,
  TrackingMode,
} from '../types/game';

interface HudOverlayProps {
  phase: GamePhase;
  mode: GameMode;
  difficulty: DifficultyKey;
  telemetry: TelemetryData;
  isLight: boolean;
  themeCountdown: number;
  isMuted: boolean;
  camActive: boolean;
  camStatus: CamStatus;
  trackingMode: TrackingMode;
  headSensitivity: number;
  autoFire: boolean;
  activeFx: FxType | null;
  floatMsgs: FloatingMessage[];
  triumphLoops: number | null;
  pipCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  onToggleTheme: () => void;
  onToggleMute: () => void;
  onToggleAutoFire: () => void;
  onTogglePause: () => void;
  onStop: () => void;
  onToggleCam: () => void;
  onRecenter: () => void;
  onChangeTrackingMode: (mode: TrackingMode) => void;
  onChangeSensitivity: (val: number) => void;
}

export const HudOverlay: React.FC<HudOverlayProps> = React.memo(({
  phase,
  mode,
  difficulty,
  telemetry,
  isLight,
  themeCountdown,
  isMuted,
  camActive,
  camStatus,
  trackingMode,
  headSensitivity,
  autoFire,
  activeFx,
  floatMsgs,
  triumphLoops,
  pipCanvasRef,
  onToggleTheme,
  onToggleMute,
  onToggleAutoFire,
  onTogglePause,
  onStop,
  onToggleCam,
  onRecenter,
  onChangeTrackingMode,
  onChangeSensitivity,
}) => {
  const diff = DIFFS[difficulty];
  const levelNum = Math.max(1, DIFF_ORDER.indexOf(difficulty) + 1);
  const isPlayingOrPaused = phase === 'playing' || phase === 'paused';
  const hpPct =
    telemetry.maxHp > 0
      ? Math.max(0, Math.min(100, Math.round((telemetry.hp / telemetry.maxHp) * 100)))
      : 0;
  const bossHpPct =
    telemetry.bossMaxHp > 0
      ? Math.max(0, Math.min(100, Math.round((telemetry.bossHp / telemetry.bossMaxHp) * 100)))
      : 0;

  return (
    <>
      {/* Ambient Side Wall Nebulae */}
      <div
        className="fixed top-0 bottom-0 left-0 w-[34vw] pointer-events-none z-[2] transition-opacity duration-500"
        style={{
          opacity: isLight ? 0.58 : 0.92,
          background: [
            'radial-gradient(ellipse 95% 60% at 0% 45%, rgba(192, 38, 211, 0.44) 0%, rgba(124, 58, 237, 0.22) 42%, transparent 78%)',
            'radial-gradient(ellipse 75% 45% at 6% 18%, rgba(255, 42, 133, 0.30) 0%, rgba(168, 85, 247, 0.14) 48%, transparent 78%)',
            'radial-gradient(ellipse 80% 45% at 8% 82%, rgba(56, 189, 248, 0.24) 0%, transparent 72%)',
          ].join(', '),
        }}
      />
      <div
        className="fixed top-0 bottom-0 right-0 w-[34vw] pointer-events-none z-[2] transition-opacity duration-500"
        style={{
          opacity: isLight ? 0.58 : 0.92,
          background: [
            'radial-gradient(ellipse 95% 60% at 100% 48%, rgba(0, 240, 255, 0.42) 0%, rgba(59, 130, 246, 0.22) 44%, transparent 78%)',
            'radial-gradient(ellipse 75% 45% at 94% 20%, rgba(168, 85, 247, 0.28) 0%, rgba(236, 72, 153, 0.12) 48%, transparent 78%)',
            'radial-gradient(ellipse 80% 45% at 92% 82%, rgba(16, 185, 129, 0.22) 0%, transparent 72%)',
          ].join(', '),
        }}
      />

      {/* Screen Edge Feedback Flashes */}
      <div
        className="fixed inset-0 pointer-events-none z-[3] transition-opacity duration-150"
        style={{
          opacity: activeFx === 'dmg' ? 1 : 0,
          background: 'radial-gradient(circle, transparent 35%, rgba(255, 35, 65, 0.52) 100%)',
        }}
      />
      <div
        className="fixed inset-0 pointer-events-none z-[3] transition-opacity duration-150"
        style={{
          opacity: activeFx === 'heal' ? 1 : 0,
          background: 'radial-gradient(circle, transparent 45%, rgba(255, 209, 59, 0.38) 100%)',
        }}
      />
      <div
        className="fixed inset-0 pointer-events-none z-[3] transition-opacity duration-150"
        style={{
          opacity: activeFx === 'hyper' ? 1 : 0,
          background: 'radial-gradient(circle, transparent 50%, rgba(0, 240, 255, 0.26) 100%)',
        }}
      />

      {/* 3-Loop Ascension Celebration Overlay */}
      {isPlayingOrPaused && triumphLoops !== null && (
        <div
          key={`triumph-${triumphLoops}`}
          className="fixed inset-0 pointer-events-none z-[16] overflow-hidden"
        >
          {/* Prismatic Radial Edge Aura */}
          <div
            className="absolute inset-0 animate-triumph-aura"
            style={{
              background:
                'radial-gradient(circle at 50% 45%, transparent 30%, rgba(255, 209, 59, 0.24) 68%, rgba(217, 70, 239, 0.34) 86%, rgba(0, 240, 255, 0.42) 100%)',
            }}
          />

          {/* Sweeping Light Beams */}
          <div className="absolute top-[22%] left-0 w-72 h-1.5 bg-gradient-to-r from-transparent via-amber-300/80 to-transparent blur-[1px] animate-triumph-streak" />
          <div
            className="absolute top-[74%] left-0 w-80 h-1.5 bg-gradient-to-r from-transparent via-cyan-300/80 to-transparent blur-[1px] animate-triumph-streak"
            style={{ animationDelay: '0.45s' }}
          />

          {/* Spinning Orbital Crest + Celebration Banner */}
          <div className="fixed top-[148px] left-1/2 animate-triumph-banner flex flex-col items-center text-center px-6 py-4 rounded-2xl bg-[#070c1f]/95 border-2 border-amber-400/90 shadow-[0_0_45px_rgba(255,209,59,0.5)]">
            <div className="relative w-16 h-16 flex items-center justify-center mb-2">
              <div className="absolute inset-0 rounded-full border-2 border-dashed border-cyan-400/90 animate-spin-orbit" />
              <div className="absolute inset-1.5 rounded-full border-2 border-dotted border-fuchsia-400/90 animate-spin-orbit-rev" />
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-300 to-orange-500 flex items-center justify-center shadow-[0_0_20px_rgba(255,209,59,0.7)]">
                <Trophy className="w-5 h-5 text-slate-950" />
              </div>
            </div>

            <div className="font-mono-telemetry text-[11px] font-bold tracking-[0.22em] text-cyan-300 uppercase">
              Tri-Loop Ascension Unlocked
            </div>
            <div className="font-display font-bold text-2xl sm:text-3xl tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-cyan-300 to-fuchsia-300 mt-0.5">
              {triumphLoops} LOOPS CONQUERED!
            </div>
            <div className="font-mono-telemetry text-xs font-semibold text-amber-200 mt-1">
              +5,000 BONUS PTS · 100% SHIELD RESTORED · LOOP {triumphLoops + 1} ENGAGED
            </div>
          </div>
        </div>
      )}

      {/* Floating Score / Feedback Popups */}
      <div className="fixed inset-0 pointer-events-none z-[15] overflow-hidden">
        {floatMsgs.map((msg) => (
          <div
            key={msg.id}
            className="absolute font-display font-bold text-lg [text-shadow:0_2px_6px_rgba(0,0,0,0.65)] whitespace-nowrap animate-float-up"
            style={{
              left: `${msg.xPct}%`,
              top: `${msg.yPct}%`,
              color: msg.color,
            }}
          >
            {msg.text}
          </div>
        ))}
      </div>

      {/* Tutorial Step Banner */}
      {isPlayingOrPaused && mode === 'tutorial' && (
        <div className="fixed top-[140px] left-1/2 -translate-x-1/2 z-[14] pointer-events-none w-[min(540px,92vw)] px-5 py-3 rounded-xl bg-white/95 dark:bg-[#080d1e]/95 border border-emerald-500/70 dark:border-emerald-400/70 shadow-xl text-center">
          <div className="font-mono-telemetry text-[11px] font-bold tracking-wider text-emerald-700 dark:text-emerald-400">
            TUTORIAL · STEP {telemetry.tutorialStep} OF 5
          </div>
          <div className="font-semibold text-sm sm:text-base text-slate-900 dark:text-slate-100 mt-0.5">
            {telemetry.tutorialLabel}
          </div>
        </div>
      )}

      {/* Boss Health / Pre-Battle Entrance Banner */}
      {isPlayingOrPaused && telemetry.bossActive && !telemetry.bossDefeated && (
        telemetry.bossIntroActive ? (
          <div
            key={`boss-intro-${telemetry.bossName}-${telemetry.totalBossesDefeated}`}
            className={`fixed top-[142px] left-1/2 z-[15] pointer-events-none w-[min(560px,92vw)] px-6 py-4 rounded-2xl border-2 text-center animate-boss-intro ${
              telemetry.omegaBossActive
                ? 'bg-[#1a0612]/95 border-amber-400 shadow-[0_0_40px_rgba(255,51,85,0.6)]'
                : 'bg-[#090d1f]/95 border-rose-500 shadow-[0_0_32px_rgba(255,42,109,0.45)]'
            }`}
          >
            <div className="font-mono-telemetry text-[11px] font-bold tracking-[0.22em] text-amber-300 uppercase">
              {telemetry.omegaBossActive
                ? '⚠ APEX OVERLORD WARPING IN'
                : `⚠ INCOMING BOSS ${telemetry.bossStage}/2 · MK-${telemetry.totalBossesDefeated + 1}`}
            </div>
            <div className="font-display font-bold text-2xl sm:text-3xl tracking-wider text-white mt-0.5">
              {telemetry.bossName}
            </div>
            <div className="font-mono-telemetry text-xs font-semibold text-cyan-300 mt-1">
              {telemetry.bossIntroSubtitle} · {telemetry.bossMaxHp.toLocaleString()} HP
            </div>
          </div>
        ) : (
          <div
            className={`fixed top-[140px] left-1/2 -translate-x-1/2 z-[14] pointer-events-none w-[min(560px,92vw)] px-5 py-3 rounded-xl bg-white/95 dark:bg-[#080d1e]/95 border text-center ${
              telemetry.omegaBossActive
                ? 'border-amber-400 shadow-[0_0_32px_rgba(255,51,85,0.48)]'
                : 'border-rose-500 shadow-[0_0_25px_rgba(255,51,85,0.3)]'
            }`}
          >
            <div className="flex items-center justify-between gap-4">
              <span className="font-display font-bold text-sm tracking-wider text-rose-600 dark:text-rose-400">
                {telemetry.omegaBossActive
                  ? `APEX BOSS LEVEL · ${telemetry.bossName}`
                  : `${telemetry.bossName} · BOSS ${telemetry.bossStage}/2 · MK-${telemetry.totalBossesDefeated + 1} (${diff.label})`}
              </span>
              <span className="font-mono-telemetry text-xs font-bold text-amber-600 dark:text-amber-300">
                {telemetry.bossHp.toLocaleString()}/{telemetry.bossMaxHp.toLocaleString()} ({bossHpPct}%)
              </span>
            </div>
            <div className="w-full h-2.5 bg-slate-200 dark:bg-white/15 rounded-full overflow-hidden mt-1.5">
              <div
                className={`h-full transition-[width] duration-200 ${
                  telemetry.omegaBossActive
                    ? 'bg-gradient-to-r from-amber-400 via-rose-500 to-fuchsia-500'
                    : 'bg-gradient-to-r from-pink-500 to-rose-500'
                }`}
                style={{ width: `${bossHpPct}%` }}
              />
            </div>
            <div className="text-xs text-slate-600 dark:text-[#8ea8cc] mt-1">
              {telemetry.omegaBossActive
                ? '2,000 HP · 20% DMG Hits · Defeat to Win the Campaign! Collect Cyan Orbs for 50-DMG Super Beams'
                : 'Collect Cyan Energy Orbs to fire counter-beams and dodge Red Plasma'}
            </div>
          </div>
        )
      )}

      {/* Active Timed Buff / Debuff Badges (Mystery Box & Purple Ring Rapid Fire) */}
      {isPlayingOrPaused &&
        ((telemetry.mysteryEffectLabel && telemetry.mysteryEffectTimer > 0) ||
          telemetry.rapidFireTimer > 0) && (
          <div className="fixed bottom-[64px] left-1/2 -translate-x-1/2 z-[14] pointer-events-none flex items-center justify-center gap-2 flex-wrap">
            {telemetry.rapidFireTimer > 0 && (
              <div className="px-4 py-1.5 rounded-xl border border-purple-400/90 bg-[#1a0a2e]/95 text-purple-200 font-mono-telemetry text-xs font-bold tracking-wider shadow-lg whitespace-nowrap">
                PURPLE RING · HYPER FIRE RATE · {telemetry.rapidFireTimer.toFixed(1)}s
              </div>
            )}
            {telemetry.mysteryEffectLabel && telemetry.mysteryEffectTimer > 0 && (
              <div
                className={`px-4 py-1.5 rounded-xl border font-mono-telemetry text-xs font-bold tracking-wider shadow-lg whitespace-nowrap ${
                  telemetry.mysteryEffectKind === 'bad'
                    ? 'bg-[#220914]/95 border-rose-500/80 text-rose-200'
                    : 'bg-[#08172c]/95 border-amber-400/85 text-amber-200'
                }`}
              >
                ? {telemetry.mysteryEffectLabel} · {telemetry.mysteryEffectTimer.toFixed(1)}s
              </div>
            )}
          </div>
        )}

      {/* Pause Notice Banner */}
      {phase === 'paused' && (
        <div className="fixed inset-0 z-[18] pointer-events-none flex items-center justify-center">
          <div className="pointer-events-auto px-8 py-5 rounded-2xl bg-white/95 dark:bg-[#0a1024]/95 border border-cyan-500/50 shadow-2xl text-center">
            <div className="font-display text-2xl font-bold text-slate-900 dark:text-cyan-300">
              Simulation Paused
            </div>
            <p className="text-sm text-slate-600 dark:text-[#8ea8cc] mt-1 mb-4">
              Press P or click Resume to continue flight
            </p>
            <button
              type="button"
              onClick={onTogglePause}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-sm bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors whitespace-nowrap cursor-pointer"
            >
              <Play className="w-4 h-4" />
              Resume Flight
            </button>
          </div>
        </div>
      )}

      {/* Main Floating HUD */}
      <div className="fixed inset-0 z-10 pointer-events-none p-3 sm:p-4 flex flex-col justify-between">
        {/* Top Row: Score | Shield & Actions | Head Tracker */}
        <div className="grid grid-cols-1 lg:grid-cols-[270px_1fr_255px] gap-3 items-start">
          {/* Score Card */}
          <div className="pointer-events-auto px-4 py-3 rounded-xl bg-white/95 dark:bg-[#0a1024]/94 border border-slate-300/80 dark:border-cyan-400/35 shadow-lg flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-semibold tracking-wider text-slate-500 dark:text-[#8ea8cc]">
                {mode === 'endless'
                  ? `ENDLESS · SEC ${telemetry.sector}`
                  : mode === 'standing'
                  ? `STANDING BODY · L${telemetry.loopCount} · LVL ${levelNum}/4`
                  : `LOOP ${telemetry.loopCount} · LVL ${levelNum}/4 · SEC ${telemetry.sector}`}
              </span>
              <span className="font-mono-telemetry text-[11px] font-semibold text-cyan-700 dark:text-cyan-300">
                {diff.label} ({diff.mult.toFixed(1)}x)
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <div className="font-display font-bold text-2xl leading-tight text-slate-900 dark:text-slate-50 tabular-nums">
                {telemetry.score.toLocaleString()}
              </div>
              <span
                className={`font-mono-telemetry text-[11px] font-bold ${
                  mode === 'endless'
                    ? 'text-fuchsia-600 dark:text-fuchsia-300'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {mode === 'endless' ? 'No Bosses' : `Bosses ${telemetry.bossesClearedInLevel}/2`}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-600 dark:text-[#8ea8cc] pt-0.5 border-t border-slate-200/80 dark:border-white/10">
              <span>
                Combo:{' '}
                <strong className="font-mono-telemetry text-cyan-700 dark:text-cyan-300">
                  {telemetry.combo}x
                </strong>
              </span>
              <span>
                Blasted:{' '}
                <strong className="font-mono-telemetry text-fuchsia-600 dark:text-fuchsia-300">
                  {telemetry.dronesDestroyed}
                </strong>
              </span>
              <span>
                Best:{' '}
                <strong className="font-mono-telemetry text-amber-600 dark:text-amber-300">
                  {telemetry.highScore.toLocaleString()}
                </strong>
              </span>
            </div>
          </div>

          {/* Center Shield & Quick Controls */}
          <div className="pointer-events-auto px-4 py-3 rounded-xl bg-white/95 dark:bg-[#0a1024]/94 border border-slate-300/80 dark:border-cyan-400/35 shadow-lg flex flex-col items-center gap-2.5">
                <div className="w-full flex items-center justify-between text-xs">
                  <span className="font-semibold tracking-wider text-slate-600 dark:text-[#8ea8cc]">
                    Neural Shield Integrity · Offline
                  </span>
                  <span
                    className={`font-mono-telemetry font-bold ${
                      hpPct <= 30
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    {telemetry.hp}/{telemetry.maxHp} HP ({hpPct}%)
                  </span>
                </div>
                <div className="w-full h-3 bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full transition-[width] duration-200 rounded-full"
                    style={{
                      width: `${hpPct}%`,
                      background:
                        hpPct <= 30
                          ? 'linear-gradient(90deg, #ff3355, #ff7a00)'
                          : 'linear-gradient(90deg, #00c4ff, #00f59b)',
                    }}
                  />
                </div>
                <div className="flex items-center justify-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={onToggleTheme}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 dark:border-cyan-400/50 bg-slate-100 hover:bg-slate-200 dark:bg-cyan-400/15 dark:hover:bg-cyan-400 text-slate-800 dark:text-slate-100 dark:hover:text-slate-950 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isLight ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                <span>
                  {isLight ? 'Light' : 'Dark'} ({themeCountdown}s)
                </span>
              </button>

              <button
                type="button"
                onClick={onToggleMute}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 dark:border-cyan-400/50 bg-slate-100 hover:bg-slate-200 dark:bg-cyan-400/15 dark:hover:bg-cyan-400 text-slate-800 dark:text-slate-100 dark:hover:text-slate-950 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                <span>{isMuted ? 'Muted' : 'Audio'}</span>
              </button>

              <button
                type="button"
                onClick={onToggleAutoFire}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  autoFire
                    ? 'border-fuchsia-500/70 bg-fuchsia-500/20 text-fuchsia-800 dark:text-fuchsia-200 hover:bg-fuchsia-500 hover:text-white'
                    : 'border-slate-300 dark:border-cyan-400/50 bg-slate-100 dark:bg-cyan-400/10 text-slate-700 dark:text-slate-300'
                }`}
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Blasters: {autoFire ? 'Auto' : 'Manual'}</span>
              </button>

              <button
                type="button"
                disabled={!isPlayingOrPaused}
                onClick={onTogglePause}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 dark:border-cyan-400/50 bg-slate-100 hover:bg-slate-200 dark:bg-cyan-400/15 dark:hover:bg-cyan-400 text-slate-800 dark:text-slate-100 dark:hover:text-slate-950 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {phase === 'paused' ? (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    <span>Resume</span>
                  </>
                ) : (
                  <>
                    <Pause className="w-3.5 h-3.5" />
                    <span>Pause</span>
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={!isPlayingOrPaused}
                onClick={onStop}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-rose-500/60 bg-rose-500/15 hover:bg-rose-500 text-rose-700 dark:text-rose-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Square className="w-3.5 h-3.5" />
                <span>Stop</span>
              </button>
            </div>
          </div>

          {/* Head / Standing Body Tracker PiP */}
          <div className="hidden sm:flex pointer-events-auto px-3.5 py-3 rounded-xl bg-white/95 dark:bg-[#0a1024]/94 border border-slate-300/80 dark:border-cyan-400/35 shadow-lg flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold tracking-wider text-slate-600 dark:text-[#8ea8cc]">
                {trackingMode === 'body' ? 'Body Tracker' : 'Head Tracker'}
              </span>
              <span
                className={`font-mono-telemetry text-[11px] font-bold ${
                  camStatus === 'LOCKED'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : camStatus === 'LOW SIGNAL'
                    ? 'text-amber-600 dark:text-amber-300'
                    : camStatus === 'DENIED'
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-cyan-700 dark:text-cyan-300'
                }`}
              >
                {camStatus}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-white/10">
              <button
                type="button"
                onClick={() => onChangeTrackingMode('head')}
                className={`py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                  trackingMode === 'head'
                    ? 'bg-cyan-500 text-slate-950'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Head Tilt
              </button>
              <button
                type="button"
                onClick={() => onChangeTrackingMode('body')}
                className={`inline-flex items-center justify-center gap-1 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                  trackingMode === 'body'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <PersonStanding className="w-3 h-3" />
                <span>Standing Body</span>
              </button>
            </div>

            <div className="relative w-full aspect-[4/3] rounded-lg overflow-hidden bg-slate-950 border border-slate-300 dark:border-cyan-400/30">
              <canvas ref={pipCanvasRef} width={240} height={180} className="w-full h-full block" />
              {!camActive && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-2 gap-1 text-xs text-slate-300">
                  <CameraOff className="w-4 h-4 text-slate-400" />
                  <span className="font-medium">Camera Off</span>
                  <span className="text-[11px] text-slate-400">
                    {trackingMode === 'body'
                      ? 'Enable for standing body steering'
                      : 'Enable for mirrored head steering'}
                  </span>
                </div>
              )}
            </div>

            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={onToggleCam}
                className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 dark:border-cyan-400/50 bg-slate-100 hover:bg-slate-200 dark:bg-cyan-400/15 dark:hover:bg-cyan-400 text-slate-800 dark:text-slate-100 dark:hover:text-slate-950 transition-colors whitespace-nowrap cursor-pointer"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>{camActive ? 'Disable' : 'Enable Cam'}</span>
              </button>
              <button
                type="button"
                disabled={!camActive}
                onClick={onRecenter}
                className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 dark:border-cyan-400/50 bg-slate-100 hover:bg-slate-200 dark:bg-cyan-400/15 dark:hover:bg-cyan-400 text-slate-800 dark:text-slate-100 dark:hover:text-slate-950 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap cursor-pointer"
              >
                <Crosshair className="w-3.5 h-3.5" />
                <span>Re-Center</span>
              </button>
            </div>

            <div className="flex flex-col gap-1.5 pt-1.5 border-t border-slate-200/80 dark:border-white/10">
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-[11px] font-semibold text-slate-500 dark:text-[#8ea8cc] whitespace-nowrap">
                  Gain ({headSensitivity.toFixed(1)}x)
                </span>
                <div className="flex items-center gap-1 justify-end">
                  {[1.0, 1.5, 2.2, 2.8].map((val) => {
                    const active = Math.abs(headSensitivity - val) < 0.05;
                    return (
                      <button
                        key={val}
                        type="button"
                        onClick={() => onChangeSensitivity(val)}
                        className={`px-1.5 py-0.5 rounded text-[11px] font-mono-telemetry font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                          active
                            ? 'bg-cyan-500 text-slate-950'
                            : 'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/20'
                        }`}
                      >
                        {val === 2.8 ? '2.8x' : `${val.toFixed(1)}x`}
                      </button>
                    );
                  })}
                </div>
              </div>
              <input
                type="range"
                min={0.8}
                max={3.2}
                step={0.1}
                value={headSensitivity}
                aria-label="Head tracking gain sensitivity"
                onChange={(e) => onChangeSensitivity(parseFloat(e.target.value))}
                className="w-full h-1.5 accent-cyan-500 cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Bottom Telemetry & Controls Strip */}
        <div className="pointer-events-auto px-4 py-2 rounded-xl bg-white/95 dark:bg-[#0a1024]/94 border border-slate-300/80 dark:border-cyan-400/35 shadow-lg font-mono-telemetry text-xs flex flex-wrap items-center justify-between gap-2 text-slate-700 dark:text-slate-200">
          <div className="flex items-center gap-3 flex-wrap">
            <span>
              X-ROM:{' '}
              <strong className="text-cyan-700 dark:text-cyan-300">{telemetry.xRom}%</strong>
            </span>
            <span aria-hidden="true" className="text-slate-400">
              ·
            </span>
            <span>
              Y-ROM:{' '}
              <strong className="text-cyan-700 dark:text-cyan-300">{telemetry.yRom}%</strong>
            </span>
            <span aria-hidden="true" className="text-slate-400">
              ·
            </span>
            <span>
              SYM:{' '}
              <strong className="text-emerald-700 dark:text-emerald-400">
                {telemetry.symmetry}%
              </strong>
            </span>
          </div>
          <div className="text-slate-600 dark:text-[#8ea8cc]">
            Steer: <strong className="text-slate-900 dark:text-slate-100">Head / Body / WASD / Mouse</strong>
            <span className="mx-2" aria-hidden="true">
              ·
            </span>
            Fire: <strong className="text-slate-900 dark:text-slate-100">Space / Click</strong>
            <span className="mx-2" aria-hidden="true">
              ·
            </span>
            Re-Center: <strong className="text-slate-900 dark:text-slate-100">C</strong>
            <span className="mx-2" aria-hidden="true">
              ·
            </span>
            Pause: <strong className="text-slate-900 dark:text-slate-100">P</strong>
            <span className="mx-2" aria-hidden="true">
              ·
            </span>
            Stop: <strong className="text-slate-900 dark:text-slate-100">Esc</strong>
          </div>
        </div>
      </div>
    </>
  );
});
HudOverlay.displayName = 'HudOverlay';
