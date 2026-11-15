export type DifficultyKey = 'easy' | 'medium' | 'hard' | 'extreme';

export interface DifficultyConfig {
  key: DifficultyKey;
  label: string;
  tagline: string;
  speed: number;
  dmg: number;
  heal: number;
  mult: number;
  mag: number;
  rad: number;
  bossHp: number;
}

export const DIFFS: Record<DifficultyKey, DifficultyConfig> = {
  easy: {
    key: 'easy',
    label: 'EASY',
    tagline: 'Gentle speed · +25% Heal',
    speed: 20,
    dmg: 10,
    heal: 25,
    mult: 0.8,
    mag: 3.2,
    rad: 2.0,
    bossHp: 100,
  },
  medium: {
    key: 'medium',
    label: 'MEDIUM',
    tagline: 'Balanced · 1.0x Score',
    speed: 27,
    dmg: 15,
    heal: 20,
    mult: 1.0,
    mag: 2.5,
    rad: 1.75,
    bossHp: 150,
  },
  hard: {
    key: 'hard',
    label: 'HARD',
    tagline: 'Fast speed · 1.5x Score',
    speed: 36,
    dmg: 22,
    heal: 15,
    mult: 1.5,
    mag: 1.8,
    rad: 1.5,
    bossHp: 220,
  },
  extreme: {
    key: 'extreme',
    label: 'EXTREME',
    tagline: 'Hyper warp · 2.0x Score',
    speed: 46,
    dmg: 30,
    heal: 12,
    mult: 2.0,
    mag: 1.3,
    rad: 1.3,
    bossHp: 300,
  },
};

export const DIFF_ORDER: DifficultyKey[] = ['easy', 'medium', 'hard', 'extreme'];

export type GameMode = 'tutorial' | 'standard' | 'boss' | 'endless' | 'standing';

export type TrackingMode = 'head' | 'body';

export type GamePhase = 'menu' | 'playing' | 'paused' | 'report';

export type CamStatus = 'STANDBY' | 'LOCKED' | 'LOW SIGNAL' | 'DENIED';

export type FxType = 'dmg' | 'heal' | 'hyper';

export interface TelemetryData {
  score: number;
  highScore: number;
  combo: number;
  hp: number;
  maxHp: number;
  xRom: number;
  yRom: number;
  symmetry: number;
  leftReach: number;
  rightReach: number;
  upReach: number;
  downReach: number;
  elapsedSec: number;
  orbsCollected: number;
  ringsPassed: number;
  hazardsDodged: number;
  dronesDestroyed: number;
  sector: number;
  bossActive: boolean;
  bossHp: number;
  bossMaxHp: number;
  bossDefeated: boolean;
  bossStage: number;
  bossesClearedInLevel: number;
  totalBossesDefeated: number;
  loopCount: number;
  omegaBossActive: boolean;
  bossName: string;
  bossIntroActive: boolean;
  bossIntroSubtitle: string;
  rapidFireTimer: number;
  mysteryEffectKind: 'good' | 'bad' | null;
  mysteryEffectLabel: string | null;
  mysteryEffectTimer: number;
  tutorialStep: number;
  tutorialLabel: string;
}

export interface SessionReport {
  mode: GameMode;
  difficulty: DifficultyKey;
  score: number;
  elapsedSec: number;
  xRom: number;
  yRom: number;
  symmetry: number;
  rank: 'S' | 'A' | 'B' | 'C' | 'D';
  orbsCollected: number;
  ringsPassed: number;
  hazardsDodged: number;
  dronesDestroyed: number;
  sector: number;
  bossDefeated: boolean;
  totalBossesDefeated: number;
  loopCount: number;
  outcomeSummary: string;
}

export interface FloatingMessage {
  id: number;
  text: string;
  xPct: number;
  yPct: number;
  color: string;
}

export interface SteerInput {
  x: number;
  y: number;
}
