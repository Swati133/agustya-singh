import React from 'react';
import {
  Camera,
  CameraOff,
  Compass,
  Crosshair,
  Infinity as InfinityIcon,
  PersonStanding,
  Play,
  Swords,
} from 'lucide-react';
import { CamStatus, DIFF_ORDER, DIFFS, DifficultyKey, GameMode, TrackingMode } from '../types/game';

interface StartModalProps {
  difficulty: DifficultyKey;
  camActive: boolean;
  camStatus: CamStatus;
  trackingMode: TrackingMode;
  highScore: number;
  previewCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  onSelectDifficulty: (diff: DifficultyKey) => void;
  onToggleCam: () => void;
  onRecenter: () => void;
  onChangeTrackingMode: (mode: TrackingMode) => void;
  onLaunch: (mode: GameMode) => void;
}

const DIFF_ACCENT: Record<DifficultyKey, string> = {
  easy: 'text-emerald-700',
  medium: 'text-cyan-700',
  hard: 'text-amber-700',
  extreme: 'text-rose-700',
};

export const StartModal: React.FC<StartModalProps> = ({
  difficulty,
  camActive,
  camStatus,
  trackingMode,
  highScore,
  previewCanvasRef,
  onSelectDifficulty,
  onToggleCam,
  onRecenter,
  onChangeTrackingMode,
  onLaunch,
}) => {
  return (
    <div className="fixed inset-0 z-50 bg-slate-100/35 backdrop-blur-[3px] flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-[820px] max-h-[92vh] overflow-y-auto rounded-2xl bg-[#f3f7fc] border border-slate-300/90 shadow-[0_20px_60px_rgba(15,23,42,0.18)] p-6 sm:p-7 flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="max-w-lg">
            <div className="font-mono-telemetry text-xs font-semibold text-cyan-700 tracking-wide">
              Standalone Offline Simulation · Best Score {highScore.toLocaleString()}
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-bold text-slate-900 mt-1 text-balance">
              NeuroMove AI 3D
            </h1>
            <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
              Carve through linked difficulty levels (
              <strong className="text-slate-900">Easy → Medium → Hard → Extreme</strong>) with{' '}
              <strong className="text-slate-900">2 Boss Fights</strong> per level, or pilot
              hands-free in <strong className="text-slate-900">Standing Body Mode</strong>!
            </p>
          </div>

          <div className="flex flex-col items-end gap-2 shrink-0">
            <button
              type="button"
              onClick={onToggleCam}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                camActive
                  ? 'border-emerald-500 bg-[#f3f7fc] text-emerald-700 hover:bg-slate-200/70'
                  : 'border-cyan-500/70 bg-[#f3f7fc] text-cyan-800 hover:bg-cyan-500 hover:text-slate-950'
              }`}
            >
              {camActive ? <Camera className="w-4 h-4" /> : <CameraOff className="w-4 h-4" />}
              <span>{camActive ? 'Webcam Tracking Active' : 'Enable Webcam Tracking'}</span>
            </button>

            <div className="inline-flex items-center rounded-xl border border-slate-300/80 bg-[#f3f7fc] p-0.5 gap-0.5">
              <button
                type="button"
                onClick={() => onChangeTrackingMode('head')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                  trackingMode === 'head'
                    ? 'bg-cyan-500 text-slate-950'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Head Tilt
              </button>
              <button
                type="button"
                onClick={() => onChangeTrackingMode('body')}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                  trackingMode === 'body'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <PersonStanding className="w-3 h-3" />
                <span>Standing Body</span>
              </button>
            </div>
          </div>
        </div>

        {/* Live Calibration Preview when Cam is active or denied */}
        {camStatus === 'DENIED' && (
          <div className="px-4 py-3 rounded-xl bg-[#f3f7fc] border border-rose-400/70 text-xs text-rose-700">
            Camera access was blocked or no webcam was found. Allow camera permissions in your browser
            bar and click Enable Webcam Tracking again, or steer using WASD / Mouse.
          </div>
        )}

        {camActive && (
          <div className="flex flex-col sm:flex-row items-center gap-4 p-3.5 rounded-xl bg-[#f3f7fc] border border-slate-300/80">
            <div className="w-44 aspect-[4/3] rounded-lg overflow-hidden bg-slate-950 border border-cyan-500/50 shrink-0">
              <canvas ref={previewCanvasRef} width={220} height={165} className="w-full h-full block" />
            </div>
            <div className="flex-1 flex flex-col gap-2 text-xs text-slate-600">
              <div className="flex items-center justify-between gap-2">
                <span className="font-display font-bold text-sm text-slate-900">
                  {trackingMode === 'body'
                    ? 'Live Standing Body Lock Preview'
                    : 'Live Head & Neck Lock Preview'}
                </span>
                <span
                  className={`font-mono-telemetry font-bold ${
                    camStatus === 'LOCKED' ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  {camStatus}
                </span>
              </div>
              <p className="leading-relaxed">
                {trackingMode === 'body'
                  ? 'Stand back so your shoulders and upper torso sit inside the blue body frame. Sidestep or lean left/right to bank, and stand tall, jump, or crouch/squat to climb and dive.'
                  : 'Tilt or lean your head and neck left, right, up, or down to verify the green reticle tracks smoothly. Sit comfortably centered and click Re-Center anytime.'}
              </p>
              <div>
                <button
                  type="button"
                  onClick={onRecenter}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-cyan-500/60 bg-[#f3f7fc] hover:bg-cyan-500 text-cyan-800 hover:text-slate-950 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Crosshair className="w-3.5 h-3.5" />
                  <span>{trackingMode === 'body' ? 'Re-Center Standing Pose (C)' : 'Re-Center Posture (C)'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Difficulty Selector */}
        <div>
          <div className="text-xs font-bold tracking-wider uppercase text-slate-500 mb-2">
            Starting Level · Linked Campaign (Easy → Medium → Hard → Extreme)
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {DIFF_ORDER.map((key, idx) => {
              const item = DIFFS[key];
              const active = difficulty === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSelectDifficulty(key)}
                  className={`rounded-xl px-3 py-3 border text-center transition-all cursor-pointer bg-[#f3f7fc] ${
                    active
                      ? 'border-cyan-600 ring-2 ring-cyan-500/35 shadow-[0_0_14px_rgba(6,182,212,0.18)]'
                      : 'border-slate-300/80 hover:border-cyan-500/60'
                  }`}
                >
                  <span className="block font-mono-telemetry text-[10px] font-semibold text-slate-500">
                    LVL {idx + 1} · 2 BOSSES
                  </span>
                  <span className={`block font-display font-bold text-sm mt-0.5 ${DIFF_ACCENT[key]}`}>
                    {item.label}
                  </span>
                  <span className="block text-[11px] text-slate-600 mt-0.5">{item.tagline}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Mode Launch Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 pt-1">
          <button
            type="button"
            onClick={() => onLaunch('tutorial')}
            className="inline-flex items-center justify-center gap-2 px-3 py-3.5 rounded-xl font-display font-bold text-sm bg-gradient-to-br from-emerald-400 to-teal-500 text-slate-950 shadow-lg hover:brightness-105 active:translate-y-px transition-all whitespace-nowrap cursor-pointer"
          >
            <Compass className="w-4 h-4 shrink-0" />
            <span>1. Tutorial</span>
          </button>

          <button
            type="button"
            onClick={() => onLaunch('standard')}
            className="inline-flex items-center justify-center gap-2 px-3 py-3.5 rounded-xl font-display font-bold text-sm bg-gradient-to-br from-cyan-400 to-sky-500 text-slate-950 shadow-lg hover:brightness-105 active:translate-y-px transition-all whitespace-nowrap cursor-pointer"
          >
            <Play className="w-4 h-4 shrink-0" />
            <span>2. Campaign</span>
          </button>

          <button
            type="button"
            onClick={() => onLaunch('boss')}
            className="inline-flex items-center justify-center gap-2 px-3 py-3.5 rounded-xl font-display font-bold text-sm bg-gradient-to-br from-rose-500 to-orange-500 text-white shadow-lg hover:brightness-105 active:translate-y-px transition-all whitespace-nowrap cursor-pointer"
          >
            <Swords className="w-4 h-4 shrink-0" />
            <span>3. Boss Rush</span>
          </button>

          <button
            type="button"
            onClick={() => onLaunch('endless')}
            className="inline-flex items-center justify-center gap-2 px-3 py-3.5 rounded-xl font-display font-bold text-sm bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-lg hover:brightness-105 active:translate-y-px transition-all whitespace-nowrap cursor-pointer"
          >
            <InfinityIcon className="w-4 h-4 shrink-0" />
            <span>4. Endless</span>
          </button>

          <button
            type="button"
            onClick={() => onLaunch('standing')}
            className="inline-flex items-center justify-center gap-2 px-3 py-3.5 rounded-xl font-display font-bold text-sm bg-gradient-to-br from-sky-500 to-indigo-600 text-white shadow-lg hover:brightness-105 active:translate-y-px transition-all whitespace-nowrap cursor-pointer"
          >
            <PersonStanding className="w-4 h-4 shrink-0" />
            <span>5. Standing Body</span>
          </button>
        </div>

        <div className="text-xs text-slate-500 border-t border-slate-300/80 pt-3 flex flex-wrap items-center justify-between gap-2">
          <span>Controls: Head / Standing Body / WASD / Mouse · Fire: Space / Click</span>
          <span>100% Client-Side · Zero External Data Transmission</span>
        </div>
      </div>
    </div>
  );
};
