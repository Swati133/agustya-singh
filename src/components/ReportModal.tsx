import React from 'react';
import { Home, RotateCcw } from 'lucide-react';
import { DIFFS, GameMode, SessionReport } from '../types/game';

interface ReportModalProps {
  report: SessionReport;
  onMainMenu: () => void;
  onPlayAgain: (mode: GameMode) => void;
}

function formatTime(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const ReportModal: React.FC<ReportModalProps> = ({
  report,
  onMainMenu,
  onPlayAgain,
}) => {
  const diffLabel = DIFFS[report.difficulty].label;

  return (
    <div className="fixed inset-0 z-50 bg-slate-100/35 backdrop-blur-[3px] flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-[740px] max-h-[92vh] overflow-y-auto rounded-2xl bg-[#f3f7fc] border border-slate-300/90 shadow-[0_20px_60px_rgba(15,23,42,0.18)] p-6 sm:p-7 flex flex-col gap-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-mono-telemetry text-xs font-semibold text-cyan-700">
              {report.mode === 'endless'
                ? 'ENDLESS (NO BOSSES)'
                : report.mode === 'standing'
                ? 'STANDING BODY'
                : report.mode.toUpperCase()}{' '}
              · {diffLabel}
            </div>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 mt-0.5">
              {report.bossDefeated
                ? 'Campaign Victory · Apex Overlord Defeated!'
                : 'Clinical Rehabilitation Report'}
            </h2>
            <p className="text-sm text-slate-600 mt-1">{report.outcomeSummary}</p>
          </div>

          <div className="text-center px-5 py-2.5 bg-[#f3f7fc] border-2 border-cyan-500 rounded-xl shrink-0">
            <div className="text-[11px] font-bold tracking-wider uppercase text-slate-500">
              Rank
            </div>
            <div className="font-display text-3xl font-bold text-amber-600 leading-none mt-1">
              {report.rank}
            </div>
          </div>
        </div>

        {/* Primary 5 Clinical Telemetry Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
          <div className="p-3 rounded-xl bg-[#f3f7fc] border border-slate-300/80">
            <div className="text-[11px] font-bold tracking-wider uppercase text-slate-500">
              Score
            </div>
            <div className="font-display font-bold text-xl text-slate-900 mt-1 tabular-nums">
              {report.score.toLocaleString()}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[#f3f7fc] border border-slate-300/80">
            <div className="text-[11px] font-bold tracking-wider uppercase text-slate-500">
              Time
            </div>
            <div className="font-mono-telemetry font-bold text-xl text-slate-900 mt-1">
              {formatTime(report.elapsedSec)}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[#f3f7fc] border border-slate-300/80">
            <div className="text-[11px] font-bold tracking-wider uppercase text-slate-500">
              X-ROM
            </div>
            <div className="font-mono-telemetry font-bold text-xl text-cyan-700 mt-1">
              {report.xRom}%
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[#f3f7fc] border border-slate-300/80">
            <div className="text-[11px] font-bold tracking-wider uppercase text-slate-500">
              Y-ROM
            </div>
            <div className="font-mono-telemetry font-bold text-xl text-cyan-700 mt-1">
              {report.yRom}%
            </div>
          </div>

          <div className="col-span-2 sm:col-span-1 p-3 rounded-xl bg-[#f3f7fc] border border-slate-300/80">
            <div className="text-[11px] font-bold tracking-wider uppercase text-slate-500">
              Symmetry
            </div>
            <div className="font-mono-telemetry font-bold text-xl text-emerald-700 mt-1">
              {report.symmetry}%
            </div>
          </div>
        </div>

        {/* Session Breakdown */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600 border-t border-b border-slate-300/80 py-3 font-mono-telemetry">
          <span>Sector: {report.sector}</span>
          <span>Drones Blasted: {report.dronesDestroyed}</span>
          <span>Orbs: {report.orbsCollected}</span>
          <span>Rings: {report.ringsPassed}</span>
          <span>Dodged: {report.hazardsDodged}</span>
          <span>Loop: {report.loopCount}</span>
          <span>Bosses Cleared: {report.totalBossesDefeated}</span>
        </div>

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onMainMenu}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-slate-300 bg-[#f3f7fc] hover:bg-slate-200/70 text-slate-800 transition-colors whitespace-nowrap cursor-pointer"
          >
            <Home className="w-4 h-4" />
            <span>Main Menu</span>
          </button>

          <button
            type="button"
            onClick={() => onPlayAgain(report.mode)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-display font-bold text-sm bg-gradient-to-br from-cyan-400 to-sky-500 text-slate-950 shadow-lg hover:brightness-105 transition-all whitespace-nowrap cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Play Again</span>
          </button>
        </div>
      </div>
    </div>
  );
};
