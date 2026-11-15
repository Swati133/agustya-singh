import { CamStatus, TrackingMode } from '../types/game';

export interface HeadTrackerState {
  active: boolean;
  sx: number;
  sy: number;
  cx: number;
  cy: number;
  steerX: number;
  steerY: number;
  confidence: number;
  status: CamStatus;
  warmup: number;
  lastVideoTime: number;
}

interface NativeFaceDetection {
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

interface NativeFaceDetector {
  detect: (source: CanvasImageSource) => Promise<NativeFaceDetection[]>;
}

class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev: number | null = null;

  constructor(minCutoff = 1.85, beta = 85.0, dCutoff = 1.8) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  public reset(val?: number, nowSec?: number): void {
    this.xPrev = val ?? null;
    this.dxPrev = 0;
    this.tPrev = nowSec ?? null;
  }

  private alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  public filter(x: number, nowSec: number): number {
    if (this.xPrev === null || this.tPrev === null) {
      this.xPrev = x;
      this.dxPrev = 0;
      this.tPrev = nowSec;
      return x;
    }
    const dt = Math.max(0.004, Math.min(0.1, nowSec - this.tPrev));
    this.tPrev = nowSec;

    const dx = (x - this.xPrev) / dt;
    const edx = this.dxPrev + this.alpha(this.dCutoff, dt) * (dx - this.dxPrev);
    this.dxPrev = edx;

    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const a = this.alpha(cutoff, dt);
    const out = this.xPrev + a * (x - this.xPrev);
    this.xPrev = out;
    return out;
  }
}

const PROC_W = 240;
const PROC_H = 180;
const FLOW_R = 16; // 33x33 patch
const FLOW_DIM = FLOW_R * 2 + 1;
const FLOW_LEN = FLOW_DIM * FLOW_DIM;
const INT_W = PROC_W + 1;
const INT_H = PROC_H + 1;
const DEADZONE_HEAD = 0.016;
const DEADZONE_BODY = 0.022;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export class MirroredHeadTracker {
  private stream: MediaStream | null = null;
  private procCanvas: HTMLCanvasElement;
  private procCtx: CanvasRenderingContext2D | null;

  private grayCurr = new Float32Array(PROC_W * PROC_H);
  private smoothCurr = new Float32Array(PROC_W * PROC_H);
  private smoothPrev = new Float32Array(PROC_W * PROC_H);
  private keyframeGray = new Float32Array(PROC_W * PROC_H);
  private neutralKeyframeGray = new Float32Array(PROC_W * PROC_H);
  private integralGray = new Float32Array(INT_W * INT_H);
  private cbBuf = new Float32Array(PROC_W * PROC_H);
  private crBuf = new Float32Array(PROC_W * PROC_H);

  private prevPatch = new Float32Array(FLOW_LEN);
  private gradX = new Float32Array(FLOW_LEN);
  private gradY = new Float32Array(FLOW_LEN);

  private hasPrevGray = false;
  private hasKeyframe = false;
  private hasNeutralKeyframe = false;
  private keyframeX = 0.5;
  private keyframeY = 0.44;
  private keyframeSetMs = 0;

  private rawX = 0.5;
  private rawY = 0.44;
  private warmupExposureWaits = 0;

  private baseCb = 112;
  private baseCr = 148;
  private hasSkinBaseline = false;
  private lastHaarHw = 27;

  // Standing full-body color & per-row background edge reference
  private bodyLum = 110;
  private bodyCb = 126;
  private bodyCr = 132;
  private bgRowLum = new Float32Array(PROC_H);
  private bgRowCb = new Float32Array(PROC_H);
  private bgRowCr = new Float32Array(PROC_H);
  private hasBodyBaseline = false;

  private faceDetector: NativeFaceDetector | null = null;
  private faceDetectPending = false;
  private lastFaceDetectMs = 0;
  private faceDetectSeq = 0;
  private lastConsumedFaceSeq = -1;
  private detectedFace: {
    seq: number;
    cx: number;
    cy: number;
    w: number;
    h: number;
    startRawX: number;
    startRawY: number;
    timeMs: number;
  } | null = null;

  private filterX = new OneEuroFilter(1.85, 85.0, 1.8);
  private filterY = new OneEuroFilter(1.85, 85.0, 1.8);
  private lastProcessMs = 0;
  private pipCtxCache = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();

  public sensitivity = 1.5;
  public trackingMode: TrackingMode = 'head';

  public state: HeadTrackerState = {
    active: false,
    sx: 0.5,
    sy: 0.44,
    cx: 0.5,
    cy: 0.44,
    steerX: 0,
    steerY: 0,
    confidence: 0,
    status: 'STANDBY',
    warmup: 0,
    lastVideoTime: -1,
  };

  constructor() {
    this.procCanvas = document.createElement('canvas');
    this.procCanvas.width = PROC_W;
    this.procCanvas.height = PROC_H;
    this.procCtx = this.procCanvas.getContext('2d', { willReadFrequently: true });

    if (typeof window !== 'undefined') {
      const WinWithFace = window as unknown as {
        FaceDetector?: new (opts?: { fastMode?: boolean; maxDetectedFaces?: number }) => NativeFaceDetector;
      };
      if (typeof WinWithFace.FaceDetector === 'function') {
        try {
          this.faceDetector = new WinWithFace.FaceDetector({
            fastMode: true,
            maxDetectedFaces: 1,
          });
        } catch {
          this.faceDetector = null;
        }
      }
    }
  }

  public setTrackingMode(mode: TrackingMode): void {
    if (this.trackingMode === mode) return;
    this.trackingMode = mode;
    this.hasKeyframe = false;
    this.hasNeutralKeyframe = false;
    this.hasBodyBaseline = false;
    this.detectedFace = null;
    this.lastConsumedFaceSeq = -1;
    this.lastHaarHw = mode === 'body' ? 14 : 27;
    if (this.state.active) {
      this.state.warmup = 5;
      this.state.steerX = 0;
      this.state.steerY = 0;
      this.filterX.reset();
      this.filterY.reset();
    }
  }

  public async start(videoEl: HTMLVideoElement): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.state.status = 'DENIED';
      return false;
    }
    try {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280, min: 640 },
            height: { ideal: 720, min: 480 },
            frameRate: { ideal: 60, min: 24 },
            facingMode: 'user',
          },
          audio: false,
        });
      } catch {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: false,
        });
      }
      videoEl.srcObject = this.stream;
      await videoEl.play();

      this.state.active = true;
      this.state.warmup = 6;
      this.state.lastVideoTime = -1;
      this.state.confidence = 85;
      this.state.status = 'LOCKED';
      this.rawX = 0.5;
      this.rawY = this.trackingMode === 'body' ? 0.46 : 0.44;
      this.warmupExposureWaits = 0;
      this.hasPrevGray = false;
      this.hasKeyframe = false;
      this.hasNeutralKeyframe = false;
      this.hasSkinBaseline = false;
      this.hasBodyBaseline = false;
      this.lastHaarHw = this.trackingMode === 'body' ? 14 : 27;
      this.detectedFace = null;
      this.faceDetectPending = false;
      this.lastFaceDetectMs = 0;
      this.faceDetectSeq = 0;
      this.lastConsumedFaceSeq = -1;
      this.lastProcessMs = 0;
      this.filterX.reset();
      this.filterY.reset();
      return true;
    } catch {
      this.stop(null);
      this.state.status = 'DENIED';
      return false;
    }
  }

  public stop(pipCanvas: HTMLCanvasElement | null): void {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    this.state.active = false;
    this.state.steerX = 0;
    this.state.steerY = 0;
    this.state.confidence = 0;
    this.state.status = 'STANDBY';
    this.hasPrevGray = false;
    this.hasKeyframe = false;
    this.hasNeutralKeyframe = false;
    this.hasSkinBaseline = false;
    this.hasBodyBaseline = false;
    this.detectedFace = null;
    this.lastConsumedFaceSeq = -1;

    if (pipCanvas) {
      const ctx = pipCanvas.getContext('2d');
      ctx?.clearRect(0, 0, pipCanvas.width, pipCanvas.height);
    }
  }

  public recenter(): void {
    if (!this.state.active) return;
    this.state.cx = this.state.sx;
    this.state.cy = this.state.sy;
    this.state.steerX = 0;
    this.state.steerY = 0;
    if (this.hasPrevGray) {
      this.keyframeGray.set(this.smoothCurr);
      this.neutralKeyframeGray.set(this.smoothCurr);
      this.keyframeX = this.rawX;
      this.keyframeY = this.rawY;
      this.keyframeSetMs = performance.now();
      this.hasKeyframe = true;
      this.hasNeutralKeyframe = true;
      if (this.trackingMode === 'body') {
        this.sampleBodyBaseline(this.rawX, this.rawY);
      }
    }
  }

  private sampleBodyBaseline(normX: number, normY: number): void {
    // Sample per-row outer room edges so vertical wall/floor/ceiling lighting differences don't create false foreground
    const edgeW = Math.max(8, Math.floor(PROC_W * 0.075));
    for (let y = 0; y < PROC_H; y += 1) {
      const row = y * PROC_W;
      let rL = 0;
      let rCb = 0;
      let rCr = 0;
      let rN = 0;
      for (let x = 2; x < edgeW; x += 2) {
        const pL = row + x;
        const pR = row + (PROC_W - 1 - x);
        rL += this.smoothCurr[pL] + this.smoothCurr[pR];
        rCb += this.cbBuf[pL] + this.cbBuf[pR];
        rCr += this.crBuf[pL] + this.crBuf[pR];
        rN += 2;
      }
      if (rN > 0) {
        this.bgRowLum[y] = rL / rN;
        this.bgRowCb[y] = rCb / rN;
        this.bgRowCr[y] = rCr / rN;
      }
    }

    // Sample torso/chest signature around anchor (normX, normY)
    const cx = clamp(Math.round(normX * PROC_W), 20, PROC_W - 21);
    const cy = clamp(Math.round(normY * PROC_H), 20, PROC_H - 21);
    let bL = 0;
    let bCb = 0;
    let bCr = 0;
    let bN = 0;
    for (let dy = -16; dy <= 16; dy += 2) {
      const row = (cy + dy) * PROC_W;
      for (let dx = -14; dx <= 14; dx += 2) {
        const p = row + cx + dx;
        bL += this.smoothCurr[p];
        bCb += this.cbBuf[p];
        bCr += this.crBuf[p];
        bN += 1;
      }
    }
    if (bN > 0) {
      this.bodyLum = bL / bN;
      this.bodyCb = bCb / bN;
      this.bodyCr = bCr / bN;
      this.hasBodyBaseline = true;
    }
  }

  private smoothGray3x3(): void {
    const src = this.grayCurr;
    const dst = this.smoothCurr;
    // Copy top/bottom borders
    for (let x = 0; x < PROC_W; x += 1) {
      dst[x] = src[x];
      dst[(PROC_H - 1) * PROC_W + x] = src[(PROC_H - 1) * PROC_W + x];
    }
    for (let y = 1; y < PROC_H - 1; y += 1) {
      const r0 = (y - 1) * PROC_W;
      const r1 = y * PROC_W;
      const r2 = (y + 1) * PROC_W;
      dst[r1] = src[r1];
      dst[r1 + PROC_W - 1] = src[r1 + PROC_W - 1];
      for (let x = 1; x < PROC_W - 1; x += 1) {
        dst[r1 + x] =
          (src[r0 + x - 1] +
            src[r0 + x] * 2 +
            src[r0 + x + 1] +
            src[r1 + x - 1] * 2 +
            src[r1 + x] * 4 +
            src[r1 + x + 1] * 2 +
            src[r2 + x - 1] +
            src[r2 + x] * 2 +
            src[r2 + x + 1]) *
          0.0625;
      }
    }
  }

  private sampleBilinear(buf: Float32Array, x: number, y: number): number {
    const cx = clamp(x, 0, PROC_W - 1.001);
    const cy = clamp(y, 0, PROC_H - 1.001);
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const fx = cx - x0;
    const fy = cy - y0;
    const idx = y0 * PROC_W + x0;
    const top = buf[idx] * (1 - fx) + buf[idx + 1] * fx;
    const bot = buf[idx + PROC_W] * (1 - fx) + buf[idx + PROC_W + 1] * fx;
    return top * (1 - fy) + bot * fy;
  }

  private buildIntegralGray(): void {
    this.integralGray.fill(0, 0, INT_W);
    for (let y = 0; y < PROC_H; y += 1) {
      let rowSum = 0;
      const srcRow = y * PROC_W;
      const dstRow = (y + 1) * INT_W;
      const prevDstRow = y * INT_W;
      this.integralGray[dstRow] = 0;
      for (let x = 0; x < PROC_W; x += 1) {
        rowSum += this.smoothCurr[srcRow + x];
        this.integralGray[dstRow + x + 1] = this.integralGray[prevDstRow + x + 1] + rowSum;
      }
    }
  }

  private boxMean(x0: number, y0: number, x1: number, y1: number): number {
    const cx0 = clamp(Math.round(x0), 0, PROC_W - 1);
    const cy0 = clamp(Math.round(y0), 0, PROC_H - 1);
    const cx1 = clamp(Math.round(x1), cx0 + 1, PROC_W);
    const cy1 = clamp(Math.round(y1), cy0 + 1, PROC_H);
    const area = (cx1 - cx0) * (cy1 - cy0);
    if (area <= 0) return 0;

    const a = this.integralGray[cy0 * INT_W + cx0];
    const b = this.integralGray[cy0 * INT_W + cx1];
    const c = this.integralGray[cy1 * INT_W + cx0];
    const d = this.integralGray[cy1 * INT_W + cx1];
    return (d - b - c + a) / area;
  }

  private patchSsdAt(x: number, y: number): number {
    let curSum = 0;
    for (let py = -FLOW_R; py <= FLOW_R; py += 1) {
      const row = (y + py) * PROC_W;
      for (let px = -FLOW_R; px <= FLOW_R; px += 1) {
        curSum += this.smoothCurr[row + x + px];
      }
    }
    const curMean = curSum / FLOW_LEN;
    let ssd = 0;
    for (let py = -FLOW_R; py <= FLOW_R; py += 1) {
      const row = (y + py) * PROC_W;
      const pRow = (py + FLOW_R) * FLOW_DIM;
      for (let px = -FLOW_R; px <= FLOW_R; px += 1) {
        const diff = this.smoothCurr[row + x + px] - curMean - this.prevPatch[pRow + px + FLOW_R];
        ssd += diff * diff;
      }
    }
    return ssd;
  }

  // ZNCC-validated Bilinear Inverse-Compositional Lucas-Kanade alignment
  private refineLucasKanade(
    refBuf: Float32Array,
    anchorNormX: number,
    anchorNormY: number,
    initX: number,
    initY: number,
    doCoarseSearch: boolean,
    searchR = 20
  ): { x: number; y: number; rms: number; zncc: number; valid: boolean } {
    const minX = FLOW_R + 2;
    const maxX = PROC_W - FLOW_R - 3;
    const minY = FLOW_R + 2;
    const maxY = PROC_H - FLOW_R - 3;

    const ax = clamp(anchorNormX * PROC_W, minX, maxX);
    const ay = clamp(anchorNormY * PROC_H, minY, maxY);

    let sum = 0;
    let sumSq = 0;
    let idx = 0;
    for (let dy = -FLOW_R; dy <= FLOW_R; dy += 1) {
      for (let dx = -FLOW_R; dx <= FLOW_R; dx += 1) {
        const v = this.sampleBilinear(refBuf, ax + dx, ay + dy);
        this.prevPatch[idx++] = v;
        sum += v;
        sumSq += v * v;
      }
    }
    const mean = sum / FLOW_LEN;
    const variance = sumSq / FLOW_LEN - mean * mean;
    if (variance < 10) {
      return { x: anchorNormX, y: anchorNormY, rms: 999, zncc: 0, valid: false };
    }
    for (let i = 0; i < FLOW_LEN; i += 1) {
      this.prevPatch[i] -= mean;
    }

    let bestX = clamp(Math.round(initX), minX, maxX);
    let bestY = clamp(Math.round(initY), minY, maxY);

    if (doCoarseSearch) {
      const startX = Math.max(minX, bestX - searchR);
      const endX = Math.min(maxX, bestX + searchR);
      const startY = Math.max(minY, bestY - searchR);
      const endY = Math.min(maxY, bestY + searchR);

      let bestSad = Infinity;
      const smoothCurr = this.smoothCurr;
      const prevPatch = this.prevPatch;
      for (let y = startY; y <= endY; y += 2) {
        for (let x = startX; x <= endX; x += 2) {
          // O(1) integral-image patch mean + early-abort row SAD (~10x faster with identical lock)
          const curMean = this.boxMean(
            x - FLOW_R,
            y - FLOW_R,
            x + FLOW_R + 1,
            y + FLOW_R + 1
          );
          let sad = 0;
          for (let py = -FLOW_R; py <= FLOW_R; py += 2) {
            const row = (y + py) * PROC_W + x;
            const pRow = (py + FLOW_R) * FLOW_DIM + FLOW_R;
            for (let px = -FLOW_R; px <= FLOW_R; px += 2) {
              const diff = smoothCurr[row + px] - curMean - prevPatch[pRow + px];
              sad += diff < 0 ? -diff : diff;
            }
            if (sad >= bestSad) break;
          }
          if (sad < bestSad) {
            bestSad = sad;
            bestX = x;
            bestY = y;
          }
        }
      }

      // Fine 1px Zero-Mean SSD local search
      const rStartX = Math.max(minX, bestX - 2);
      const rEndX = Math.min(maxX, bestX + 2);
      const rStartY = Math.max(minY, bestY - 2);
      const rEndY = Math.min(maxY, bestY + 2);
      let fineBestSsd = Infinity;

      for (let y = rStartY; y <= rEndY; y += 1) {
        for (let x = rStartX; x <= rEndX; x += 1) {
          const ssd = this.patchSsdAt(x, y);
          if (ssd < fineBestSsd) {
            fineBestSsd = ssd;
            bestX = x;
            bestY = y;
          }
        }
      }

      const rms = Math.sqrt(fineBestSsd / FLOW_LEN);
      if (rms > 36) {
        return { x: anchorNormX, y: anchorNormY, rms, zncc: 0, valid: false };
      }
    }

    // Compute template spatial gradients & 2x2 Hessian once (interior of smoothed patch)
    let hxx = 0;
    let hxy = 0;
    let hyy = 0;
    let prevInnerEnergy = 0;
    for (let r = 1; r < FLOW_DIM - 1; r += 1) {
      const row = r * FLOW_DIM;
      for (let c = 1; c < FLOW_DIM - 1; c += 1) {
        const i = row + c;
        const pVal = this.prevPatch[i];
        prevInnerEnergy += pVal * pVal;
        const gx = 0.5 * (this.prevPatch[i + 1] - this.prevPatch[i - 1]);
        const gy = 0.5 * (this.prevPatch[i + FLOW_DIM] - this.prevPatch[i - FLOW_DIM]);
        this.gradX[i] = gx;
        this.gradY[i] = gy;
        hxx += gx * gx;
        hxy += gx * gy;
        hyy += gy * gy;
      }
    }

    const det = hxx * hyy - hxy * hxy;
    if (det < 1e-2 || prevInnerEnergy < 1e-2) {
      return { x: bestX / PROC_W, y: bestY / PROC_H, rms: 999, zncc: 0, valid: false };
    }

    let fx = doCoarseSearch ? bestX : clamp(initX, minX, maxX);
    let fy = doCoarseSearch ? bestY : clamp(initY, minY, maxY);
    const innerCount = (FLOW_DIM - 2) * (FLOW_DIM - 2);
    let lastRms = 999;
    let lastZncc = 0;

    // 5-iteration bilinear Gauss-Newton sub-pixel Lucas-Kanade alignment
    for (let iter = 0; iter < 5; iter += 1) {
      let curSum = 0;
      for (let dy = -(FLOW_R - 1); dy <= FLOW_R - 1; dy += 1) {
        for (let dx = -(FLOW_R - 1); dx <= FLOW_R - 1; dx += 1) {
          curSum += this.sampleBilinear(this.smoothCurr, fx + dx, fy + dy);
        }
      }
      const curMean = curSum / innerCount;

      let bx = 0;
      let by = 0;
      let ssd = 0;
      let dot = 0;
      let curEnergy = 0;
      for (let dy = -(FLOW_R - 1), r = 1; dy <= FLOW_R - 1; dy += 1, r += 1) {
        const pRow = r * FLOW_DIM;
        for (let dx = -(FLOW_R - 1), c = 1; dx <= FLOW_R - 1; dx += 1, c += 1) {
          const i = pRow + c;
          const curVal = this.sampleBilinear(this.smoothCurr, fx + dx, fy + dy) - curMean;
          const pVal = this.prevPatch[i];
          const diff = pVal - curVal;
          ssd += diff * diff;
          dot += pVal * curVal;
          curEnergy += curVal * curVal;
          bx += this.gradX[i] * diff;
          by += this.gradY[i] * diff;
        }
      }

      lastRms = Math.sqrt(ssd / innerCount);
      lastZncc = curEnergy > 1e-2 ? dot / Math.sqrt(prevInnerEnergy * curEnergy) : 0;

      const du = clamp((hyy * bx - hxy * by) / det, -0.75, 0.75);
      const dv = clamp((hxx * by - hxy * bx) / det, -0.75, 0.75);
      fx = clamp(fx + du, minX, maxX);
      fy = clamp(fy + dv, minY, maxY);

      if (du * du + dv * dv < 0.000015) break;
    }

    if (lastRms > 36 || lastZncc < 0.68) {
      return { x: anchorNormX, y: anchorNormY, rms: lastRms, zncc: lastZncc, valid: false };
    }

    return {
      x: fx / PROC_W,
      y: fy / PROC_H,
      rms: lastRms,
      zncc: lastZncc,
      valid: true,
    };
  }

  // Cross-browser Integral-Image Haar Facial Symmetry Anchor with scale hysteresis
  private findFacialSymmetryAnchor(
    hintNormX: number,
    hintNormY: number,
    searchRadiusX: number,
    searchRadiusY: number,
    scales = [21, 27, 33]
  ): { x: number; y: number; hw: number; score: number; valid: boolean } {
    const cxHint = hintNormX * PROC_W;
    const cyHint = hintNormY * PROC_H;

    const minX = Math.max(22, Math.floor(cxHint - searchRadiusX));
    const maxX = Math.min(PROC_W - 23, Math.ceil(cxHint + searchRadiusX));
    const minY = Math.max(20, Math.floor(cyHint - searchRadiusY));
    const maxY = Math.min(PROC_H - 22, Math.ceil(cyHint + searchRadiusY));

    let bestCost = Infinity;
    let bestX = cxHint;
    let bestY = cyHint;
    let bestHw = this.lastHaarHw;
    let bestStructure = 0;

    const evalCost = (x: number, y: number, hw: number): { cost: number; structure: number } => {
      const hh = hw * 1.15;
      const leftEye = this.boxMean(x - hw * 0.62, y - hh * 0.28, x - hw * 0.14, y - hh * 0.02);
      const rightEye = this.boxMean(x + hw * 0.14, y - hh * 0.28, x + hw * 0.62, y - hh * 0.02);
      const forehead = this.boxMean(x - hw * 0.45, y - hh * 0.68, x + hw * 0.45, y - hh * 0.34);
      const noseBridge = this.boxMean(x - hw * 0.18, y - hh * 0.12, x + hw * 0.18, y + hh * 0.22);
      const leftCheek = this.boxMean(x - hw * 0.64, y + hh * 0.04, x - hw * 0.2, y + hh * 0.36);
      const rightCheek = this.boxMean(x + hw * 0.2, y + hh * 0.04, x + hw * 0.64, y + hh * 0.36);

      const eyeMean = (leftEye + rightEye) * 0.5;
      const cheekMean = (leftCheek + rightCheek) * 0.5;
      const structure =
        (forehead - eyeMean) * 0.75 +
        (noseBridge - eyeMean) * 0.85 +
        (cheekMean - eyeMean) * 0.55;

      const asym =
        Math.abs(leftEye - rightEye) * 0.9 + Math.abs(leftCheek - rightCheek) * 0.7;

      const distPenalty = ((x - cxHint) ** 2 + (y - cyHint) ** 2) * 0.0085;
      const scaleHysteresis = Math.abs(hw - this.lastHaarHw) * 0.45;

      const cost = asym + distPenalty + scaleHysteresis - structure * 1.35;
      return { cost, structure };
    };

    for (let sIdx = 0; sIdx < scales.length; sIdx += 1) {
      const hw = scales[sIdx];
      for (let y = minY; y <= maxY; y += 2) {
        for (let x = minX; x <= maxX; x += 2) {
          const { cost, structure } = evalCost(x, y, hw);
          if (structure > 4 && cost < bestCost) {
            bestCost = cost;
            bestX = x;
            bestY = y;
            bestHw = hw;
            bestStructure = structure;
          }
        }
      }
    }

    if (bestStructure <= 5) {
      return { x: hintNormX, y: hintNormY, hw: this.lastHaarHw, score: 0, valid: false };
    }

    this.lastHaarHw = bestHw;

    let fineBestCost = Infinity;
    let fineX = Math.round(bestX);
    let fineY = Math.round(bestY);
    for (let y = Math.max(minY, fineY - 2); y <= Math.min(maxY, fineY + 2); y += 1) {
      for (let x = Math.max(minX, fineX - 2); x <= Math.min(maxX, fineX + 2); x += 1) {
        const { cost, structure } = evalCost(x, y, bestHw);
        if (structure > 4 && cost < fineBestCost) {
          fineBestCost = cost;
          fineX = x;
          fineY = y;
          bestStructure = structure;
        }
      }
    }

    const cL = evalCost(fineX - 1, fineY, bestHw).cost;
    const cR = evalCost(fineX + 1, fineY, bestHw).cost;
    const cU = evalCost(fineX, fineY - 1, bestHw).cost;
    const cD = evalCost(fineX, fineY + 1, bestHw).cost;

    const denomX = cL - 2 * fineBestCost + cR;
    const denomY = cU - 2 * fineBestCost + cD;
    const subX = denomX > 1e-3 ? clamp((0.5 * (cL - cR)) / denomX, -0.5, 0.5) : 0;
    const subY = denomY > 1e-3 ? clamp((0.5 * (cU - cD)) / denomY, -0.5, 0.5) : 0;

    const bridgeOffset = (bestHw * 0.22) / PROC_H;
    return {
      x: (fineX + subX) / PROC_W,
      y: (fineY + subY) / PROC_H + bridgeOffset,
      hw: bestHw,
      score: bestStructure,
      valid: true,
    };
  }

  // Full-frame standing silhouette + upper-body crest (tracks jump height, crouch drop, and full left/right movement)
  private findStandingBodySilhouette(
    hintNormX: number,
    hintNormY: number,
    wideSearch = false
  ): {
    x: number;
    y: number;
    upperY: number;
    mass: number;
    valid: boolean;
  } {
    const xStart = wideSearch ? 10 : Math.max(10, Math.floor((hintNormX - 0.38) * PROC_W));
    const xEnd = wideSearch ? PROC_W - 11 : Math.min(PROC_W - 11, Math.ceil((hintNormX + 0.38) * PROC_W));
    const yStart = Math.floor(PROC_H * 0.03);
    const yEnd = Math.floor(PROC_H * 0.94);

    let wSum = 0;
    let xSum = 0;
    let ySum = 0;
    let topWSum = 0;
    let topYSum = 0;
    let minFgY = 1;

    for (let y = yStart; y <= yEnd; y += 2) {
      const row = y * PROC_W;
      const rowBgL = this.bgRowLum[y];
      const rowBgCb = this.bgRowCb[y];
      const rowBgCr = this.bgRowCr[y];
      const ny = y / PROC_H;
      for (let x = xStart; x <= xEnd; x += 2) {
        const p = row + x;
        const lum = this.smoothCurr[p];
        const cb = this.cbBuf[p];
        const cr = this.crBuf[p];

        let fgWeight = 0;
        if (this.hasBodyBaseline) {
          const bgDiff =
            Math.abs(lum - rowBgL) * 0.5 +
            Math.abs(cb - rowBgCb) * 1.2 +
            Math.abs(cr - rowBgCr) * 1.2;
          const bodyDistSq =
            (lum - this.bodyLum) ** 2 * 0.16 +
            (cb - this.bodyCb) ** 2 +
            (cr - this.bodyCr) ** 2;
          const bodyMatch = Math.exp(-bodyDistSq / 1150);
          if (bgDiff > 15) {
            fgWeight += Math.min(2.4, (bgDiff - 14) / 24) * (0.45 + bodyMatch * 1.45);
          } else {
            fgWeight += bodyMatch * 0.65;
          }
        }

        // Skin / face / head highlight
        const isSkin = lum > 18 && cb >= 66 && cb <= 144 && cr >= 125 && cr <= 188;
        if (isSkin) {
          fgWeight += 1.35;
        }

        // Live movement energy boosts jump/crouch/sidestep visibility
        if (this.hasPrevGray) {
          const mDiff = Math.abs(lum - this.smoothPrev[p]);
          if (mDiff > 7) {
            fgWeight += Math.min(3.4, (mDiff - 7) / 7.5);
          }
        }

        if (fgWeight > 0.35) {
          const nx = x / PROC_W;
          const spatial = wideSearch
            ? ((nx - hintNormX) / 0.52) ** 2
            : ((nx - hintNormX) / 0.34) ** 2 + ((ny - hintNormY) / 0.55) ** 2;
          const w = fgWeight * Math.exp(-spatial * (wideSearch ? 0.35 : 0.45));
          if (w > 0.12) {
            wSum += w;
            xSum += nx * w;
            ySum += ny * w;
            if (ny < minFgY && w > 0.65) {
              minFgY = ny;
            }
            if (isSkin || ny <= minFgY + 0.24) {
              const upperW = isSkin ? w * 1.6 : w;
              topWSum += upperW;
              topYSum += ny * upperW;
            }
          }
        }
      }
    }

    if (wSum < 22) {
      return { x: hintNormX, y: hintNormY, upperY: hintNormY, mass: wSum, valid: false };
    }

    const avgY = ySum / wSum;
    const upperY = topWSum > 4 ? topYSum / topWSum : avgY;
    return {
      x: xSum / wSum,
      y: avgY,
      upperY: upperY * 0.72 + avgY * 0.28,
      mass: wSum,
      valid: true,
    };
  }

  public update(
    videoEl: HTMLVideoElement,
    pipCanvas: HTMLCanvasElement | null,
    secondaryCanvas?: HTMLCanvasElement | null
  ): void {
    if (!this.state.active || !this.procCtx) return;
    if (videoEl.readyState < 2 || videoEl.videoWidth === 0) return;

    const nowMs = performance.now();
    // Gate duplicate frames cleanly so 30fps webcams don't inject zero-motion steps into OneEuroFilter
    if (videoEl.currentTime === this.state.lastVideoTime && nowMs - this.lastProcessMs < 65) {
      return;
    }
    this.state.lastVideoTime = videoEl.currentTime;
    this.lastProcessMs = nowMs;

    this.procCtx.save();
    this.procCtx.translate(PROC_W, 0);
    this.procCtx.scale(-1, 1);
    this.procCtx.drawImage(videoEl, 0, 0, PROC_W, PROC_H);
    this.procCtx.restore();

    // Progressive native FaceDetector ground-truth anchor (~20Hz) with start-anchor lag compensation
    if (this.faceDetector && !this.faceDetectPending && nowMs - this.lastFaceDetectMs > 48) {
      this.faceDetectPending = true;
      this.lastFaceDetectMs = nowMs;
      const startRawX = this.rawX;
      const startRawY = this.rawY;
      this.faceDetector
        .detect(this.procCanvas)
        .then((faces) => {
          if (faces && faces.length > 0) {
            const b = faces[0].boundingBox;
            this.faceDetectSeq += 1;
            this.detectedFace = {
              seq: this.faceDetectSeq,
              cx: (b.x + b.width * 0.5) / PROC_W,
              cy: (b.y + b.height * 0.52) / PROC_H,
              w: b.width / PROC_W,
              h: b.height / PROC_H,
              startRawX,
              startRawY,
              timeMs: performance.now(),
            };
          }
        })
        .catch(() => {
          // Ignore transient detector errors
        })
        .finally(() => {
          this.faceDetectPending = false;
        });
    }

    const rgba = this.procCtx.getImageData(0, 0, PROC_W, PROC_H).data;
    if (this.hasPrevGray) {
      this.smoothPrev.set(this.smoothCurr);
    }

    let centerLumSum = 0;
    let centerLumCount = 0;
    const cYMin = Math.floor(PROC_H * 0.2);
    const cYMax = Math.ceil(PROC_H * 0.8);
    const cXMin = Math.floor(PROC_W * 0.2);
    const cXMax = Math.ceil(PROC_W * 0.8);
    for (let y = 0, p = 0, i = 0; y < PROC_H; y += 1) {
      const inCenterY = y >= cYMin && y <= cYMax;
      for (let x = 0; x < PROC_W; x += 1, p += 1, i += 4) {
        const r = rgba[i];
        const g = rgba[i + 1];
        const b = rgba[i + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        this.grayCurr[p] = lum;
        this.cbBuf[p] = 128 - 0.1687 * r - 0.3313 * g + 0.5 * b;
        this.crBuf[p] = 128 + 0.5 * r - 0.4187 * g - 0.0813 * b;
        if (inCenterY && x >= cXMin && x <= cXMax) {
          centerLumSum += lum;
          centerLumCount += 1;
        }
      }
    }

    this.smoothGray3x3();
    this.buildIntegralGray();
    const meanCenterLum = centerLumCount > 0 ? centerLumSum / centerLumCount : 0;

    const nowSec = nowMs / 1000;
    let targetX = this.rawX;
    let targetY = this.rawY;
    let confidence = this.state.confidence;

    const freshFace =
      this.detectedFace && nowMs - this.detectedFace.timeMs < 260 ? this.detectedFace : null;
    const isNewFaceDet = freshFace !== null && freshFace.seq !== this.lastConsumedFaceSeq;

    const isBodyMode = this.trackingMode === 'body';

    if (this.state.warmup > 0) {
      if (meanCenterLum < 12 && this.warmupExposureWaits < 24) {
        this.warmupExposureWaits += 1;
        this.hasPrevGray = true;
        if (pipCanvas) this.renderPipOverlay(videoEl, pipCanvas);
        if (secondaryCanvas) this.renderPipOverlay(videoEl, secondaryCanvas);
        return;
      }

      if (isBodyMode) {
        this.sampleBodyBaseline(0.5, 0.42);
        if (freshFace) {
          targetX = freshFace.cx;
          targetY = clamp(freshFace.cy + 0.05, 0.16, 0.72);
          this.lastConsumedFaceSeq = freshFace.seq;
        } else {
          const haarStanding = this.findFacialSymmetryAnchor(0.5, 0.34, 68, 42, [10, 14, 19, 24]);
          const silInit = this.findStandingBodySilhouette(0.5, 0.42, true);
          if (haarStanding.valid && silInit.valid) {
            targetX = haarStanding.x * 0.58 + silInit.x * 0.42;
            targetY = clamp((haarStanding.y + 0.05) * 0.58 + silInit.upperY * 0.42, 0.16, 0.74);
          } else if (haarStanding.valid) {
            targetX = haarStanding.x;
            targetY = clamp(haarStanding.y + 0.05, 0.16, 0.74);
          } else if (silInit.valid) {
            targetX = silInit.x;
            targetY = silInit.upperY;
          } else {
            targetX = 0.5;
            targetY = 0.42;
          }
        }
        this.sampleBodyBaseline(targetX, targetY);
      } else if (freshFace) {
        targetX = freshFace.cx;
        targetY = freshFace.cy;
        this.lastConsumedFaceSeq = freshFace.seq;
      } else {
        const haarInit = this.findFacialSymmetryAnchor(0.5, 0.43, 54, 38);

        let wSum = 0;
        let xSum = 0;
        let ySum = 0;
        let cbSum = 0;
        let crSum = 0;

        const xMin = Math.floor(PROC_W * 0.2);
        const xMax = Math.ceil(PROC_W * 0.8);
        const yMin = Math.floor(PROC_H * 0.1);
        const yMax = Math.ceil(PROC_H * 0.78);

        for (let y = yMin; y < yMax; y += 1) {
          const row = y * PROC_W;
          for (let x = xMin; x < xMax; x += 1) {
            const p = row + x;
            const lum = this.smoothCurr[p];
            const cb = this.cbBuf[p];
            const cr = this.crBuf[p];
            if (lum > 18 && cb >= 66 && cb <= 144 && cr >= 125 && cr <= 188) {
              const nx = x / PROC_W;
              const ny = y / PROC_H;
              const bias = Math.exp(-((nx - 0.5) ** 2 + (ny - 0.44) ** 2) * 5.0);
              wSum += bias;
              xSum += nx * bias;
              ySum += ny * bias;
              cbSum += cb * bias;
              crSum += cr * bias;
            }
          }
        }

        if (wSum > 15) {
          const skinInitX = xSum / wSum;
          const skinInitY = ySum / wSum;
          this.baseCb = cbSum / wSum;
          this.baseCr = crSum / wSum;
          this.hasSkinBaseline = true;
          if (haarInit.valid) {
            targetX = haarInit.x * 0.68 + skinInitX * 0.32;
            targetY = haarInit.y * 0.68 + skinInitY * 0.32;
          } else {
            targetX = skinInitX;
            targetY = skinInitY;
          }
        } else if (haarInit.valid) {
          targetX = haarInit.x;
          targetY = haarInit.y;
        } else {
          targetX = 0.5;
          targetY = 0.44;
        }
      }

      this.state.warmup -= 1;
      this.rawX = targetX;
      this.rawY = targetY;
      this.state.sx = targetX;
      this.state.cx = targetX;
      this.state.sy = targetY;
      this.state.cy = targetY;
      this.filterX.reset(targetX, nowSec);
      this.filterY.reset(targetY, nowSec);
      this.keyframeGray.set(this.smoothCurr);
      this.neutralKeyframeGray.set(this.smoothCurr);
      this.keyframeX = targetX;
      this.keyframeY = targetY;
      this.keyframeSetMs = nowMs;
      this.hasKeyframe = true;
      this.hasNeutralKeyframe = true;
      confidence = 95;
    } else if (isBodyMode) {
      // STANDING BODY MODE: Full-frame Jump(Up)/Crouch(Down)/Left/Right tracking with wall-lock rejection
      let motionMass = 0;
      let motionXSum = 0;
      let motionYSum = 0;
      let patchMotionSum = 0;
      let patchMotionCnt = 0;

      if (this.hasPrevGray) {
        // Scan full body movement corridor (x: 6%..94%, y: 3%..95%) so jumps, crouches & wide sidesteps are caught immediately
        const y0 = Math.floor(PROC_H * 0.03);
        const y1 = Math.floor(PROC_H * 0.95);
        const x0 = Math.floor(PROC_W * 0.06);
        const x1 = Math.ceil(PROC_W * 0.94);
        for (let y = y0; y <= y1; y += 2) {
          const row = y * PROC_W;
          for (let x = x0; x <= x1; x += 2) {
            const p = row + x;
            const diff = Math.abs(this.smoothCurr[p] - this.smoothPrev[p]);
            if (diff > 6.5) {
              const mw = Math.min(4.0, (diff - 6.5) / 7.5);
              motionMass += mw;
              motionXSum += (x / PROC_W) * mw;
              motionYSum += (y / PROC_H) * mw;
            }
          }
        }

        // Measure motion right at previous patch center to detect if patch slipped off body onto static wall
        const pcx = clamp(Math.round(this.rawX * PROC_W), 16, PROC_W - 17);
        const pcy = clamp(Math.round(this.rawY * PROC_H), 16, PROC_H - 17);
        for (let dy = -12; dy <= 12; dy += 3) {
          const row = (pcy + dy) * PROC_W;
          for (let dx = -12; dx <= 12; dx += 3) {
            patchMotionSum += Math.abs(this.smoothCurr[row + pcx + dx] - this.smoothPrev[row + pcx + dx]);
            patchMotionCnt += 1;
          }
        }
      }

      const patchAvgMotion = patchMotionCnt > 0 ? patchMotionSum / patchMotionCnt : 0;
      const hasBodyMotion = motionMass > 16;
      const motCenterX = hasBodyMotion ? motionXSum / motionMass : this.rawX;
      const motCenterY = hasBodyMotion ? motionYSum / motionMass : this.rawY;
      const motJumpDist = Math.hypot(motCenterX - this.rawX, motCenterY - this.rawY);

      // Seed LK toward moving silhouette if rapid jump/crouch/sidestep outpaced previous center
      const lkInitX =
        hasBodyMotion && motJumpDist > 0.08
          ? (this.rawX * 0.55 + motCenterX * 0.45) * PROC_W
          : this.rawX * PROC_W;
      const lkInitY =
        hasBodyMotion && motJumpDist > 0.08
          ? (this.rawY * 0.55 + motCenterY * 0.45) * PROC_H
          : this.rawY * PROC_H;

      const rawFlow = this.hasPrevGray
        ? this.refineLucasKanade(
            this.smoothPrev,
            this.rawX,
            this.rawY,
            lkInitX,
            lkInitY,
            true,
            40
          )
        : { x: this.rawX, y: this.rawY, rms: 999, zncc: 0, valid: false };

      // Prevent Lucas-Kanade from locking onto stationary background wall when user stepped/jumped/crouched away
      const lkStuckOnWall =
        rawFlow.valid &&
        motionMass > 26 &&
        motJumpDist > 0.09 &&
        Math.hypot(rawFlow.x - this.rawX, rawFlow.y - this.rawY) < 0.008 &&
        patchAvgMotion < 2.2;
      const flow = lkStuckOnWall ? { ...rawFlow, valid: false } : rawFlow;

      const flowHintX = flow.valid ? flow.x : hasBodyMotion ? motCenterX : this.rawX;
      const flowHintY = flow.valid ? flow.y : hasBodyMotion ? motCenterY : this.rawY;
      const flowSpeed = Math.hypot(flowHintX - this.rawX, flowHintY - this.rawY);

      let anchoredX = flowHintX;
      let anchoredY = flowHintY;
      let keyframeLocked = false;

      // Zero-drift neutral lock ONLY when calm near standing origin
      if (this.hasNeutralKeyframe && flow.valid && flowSpeed < 0.008 && !hasBodyMotion) {
        const neutralDist = Math.hypot(flowHintX - this.state.cx, flowHintY - this.state.cy);
        if (neutralDist < 0.025) {
          const nkf = this.refineLucasKanade(
            this.neutralKeyframeGray,
            this.state.cx,
            this.state.cy,
            flowHintX * PROC_W,
            flowHintY * PROC_H,
            false
          );
          if (nkf.valid && nkf.zncc > 0.82) {
            anchoredX = flowHintX * 0.68 + nkf.x * 0.32;
            anchoredY = flowHintY * 0.68 + nkf.y * 0.32;
            keyframeLocked = true;
          }
        }
      }

      if (!keyframeLocked && this.hasKeyframe && flow.valid) {
        const keyDist = Math.hypot(flowHintX - this.keyframeX, flowHintY - this.keyframeY);
        if (keyDist < 0.05) {
          const kf = this.refineLucasKanade(
            this.keyframeGray,
            this.keyframeX,
            this.keyframeY,
            flowHintX * PROC_W,
            flowHintY * PROC_H,
            false
          );
          if (kf.valid && kf.zncc > 0.78) {
            anchoredX = flowHintX * 0.56 + kf.x * 0.44;
            anchoredY = flowHintY * 0.56 + kf.y * 0.44;
            keyframeLocked = true;
          }
        } else if (nowMs - this.keyframeSetMs > 150) {
          this.keyframeGray.set(this.smoothCurr);
          this.keyframeX = flowHintX;
          this.keyframeY = flowHintY;
          this.keyframeSetMs = nowMs;
        }
      }

      // Wide search for standing head (catches full jumps to top edge & squats/crouches near bottom)
      const haarHead = this.findFacialSymmetryAnchor(
        anchoredX,
        clamp(anchoredY - 0.05, 0.06, 0.84),
        hasBodyMotion ? 52 : 34,
        hasBodyMotion ? 44 : 28,
        [9, 13, 17, 22]
      );
      const sil = this.findStandingBodySilhouette(
        anchoredX,
        anchoredY,
        hasBodyMotion || !flow.valid
      );

      const haarBodyY = haarHead.valid ? clamp(haarHead.y + 0.05, 0.08, 0.88) : anchoredY;

      if (haarHead.valid && sil.valid && flow.valid) {
        if (hasBodyMotion) {
          targetX = haarHead.x * 0.42 + sil.x * 0.32 + anchoredX * 0.26;
          targetY = haarBodyY * 0.44 + sil.upperY * 0.34 + anchoredY * 0.22;
        } else {
          targetX = anchoredX * 0.46 + haarHead.x * 0.32 + sil.x * 0.22;
          targetY = anchoredY * 0.44 + haarBodyY * 0.34 + sil.upperY * 0.22;
        }
        confidence = keyframeLocked ? 98 : 95;
      } else if (haarHead.valid && sil.valid) {
        targetX = haarHead.x * 0.56 + sil.x * 0.44;
        targetY = haarBodyY * 0.56 + sil.upperY * 0.44;
        confidence = 92;
      } else if (flow.valid && sil.valid) {
        const silWeight = hasBodyMotion ? 0.52 : keyframeLocked ? 0.28 : 0.38;
        targetX = anchoredX * (1 - silWeight) + sil.x * silWeight;
        targetY = anchoredY * (1 - silWeight) + sil.upperY * silWeight;
        confidence = keyframeLocked ? 95 : 90;
      } else if (haarHead.valid) {
        targetX = haarHead.x;
        targetY = haarBodyY;
        confidence = 89;
      } else if (sil.valid) {
        targetX = sil.x;
        targetY = sil.upperY;
        confidence = 85;
      } else if (flow.valid) {
        targetX = anchoredX;
        targetY = anchoredY;
        confidence = 82;
      } else if (motionMass > 14) {
        targetX = this.rawX + (motCenterX - this.rawX) * 0.65;
        targetY = this.rawY + (motCenterY - this.rawY) * 0.65;
        confidence = 75;
      } else {
        confidence = Math.max(30, Math.round(confidence * 0.92));
      }

      // Fast Jump / Crouch / Sidestep motion assist (only boosts active displacement vector)
      if (motionMass > 24 && motJumpDist > 0.06) {
        const assist = motJumpDist > 0.14 ? 0.32 : 0.16;
        targetX = targetX * (1 - assist) + motCenterX * assist;
        targetY = targetY * (1 - assist) + motCenterY * assist;
      }

      // One-shot lag-compensated FaceDetector standing upper-body anchor (direct vertical & horizontal lock)
      if (isNewFaceDet && freshFace) {
        this.lastConsumedFaceSeq = freshFace.seq;
        const torsoRefX = freshFace.cx + (this.rawX - freshFace.startRawX);
        const torsoRefY =
          clamp(freshFace.cy + 0.05, 0.06, 0.88) + (this.rawY - freshFace.startRawY);
        targetX += (torsoRefX - targetX) * 0.45;
        targetY += (torsoRefY - targetY) * 0.45;
        confidence = Math.max(confidence, 98);
      }

      targetX = clamp(targetX, 0.06, 0.94);
      targetY = clamp(targetY, 0.05, 0.92);
      this.rawX = targetX;
      this.rawY = targetY;

      if (!this.hasKeyframe || lkStuckOnWall) {
        this.keyframeGray.set(this.smoothCurr);
        this.keyframeX = targetX;
        this.keyframeY = targetY;
        this.keyframeSetMs = nowMs;
        this.hasKeyframe = true;
      }

      this.state.sx = this.filterX.filter(targetX, nowSec);
      this.state.sy = this.filterY.filter(targetY, nowSec);
    } else {
      // SEATED HEAD / NECK HIGH-RESPONSE MODE
      const flow = this.hasPrevGray
        ? this.refineLucasKanade(
            this.smoothPrev,
            this.rawX,
            this.rawY,
            this.rawX * PROC_W,
            this.rawY * PROC_H,
            true,
            28
          )
        : { x: this.rawX, y: this.rawY, rms: 999, zncc: 0, valid: false };

      const flowHintX = flow.valid ? flow.x : this.rawX;
      const flowHintY = flow.valid ? flow.y : this.rawY;
      const flowSpeed = Math.hypot(flowHintX - this.rawX, flowHintY - this.rawY);

      let anchoredX = flowHintX;
      let anchoredY = flowHintY;
      let keyframeLocked = false;

      // Zero-drift neutral lock ONLY when calm near resting center (instant breakaway on tilt)
      if (this.hasNeutralKeyframe && flow.valid && flowSpeed < 0.008) {
        const neutralDist = Math.hypot(flowHintX - this.state.cx, flowHintY - this.state.cy);
        if (neutralDist < 0.03) {
          const nkf = this.refineLucasKanade(
            this.neutralKeyframeGray,
            this.state.cx,
            this.state.cy,
            flowHintX * PROC_W,
            flowHintY * PROC_H,
            false
          );
          if (nkf.valid && nkf.zncc > 0.82) {
            anchoredX = flowHintX * 0.65 + nkf.x * 0.35;
            anchoredY = flowHintY * 0.65 + nkf.y * 0.35;
            keyframeLocked = true;
          }
        }
      }

      if (!keyframeLocked && this.hasKeyframe && flow.valid) {
        const keyDist = Math.hypot(flowHintX - this.keyframeX, flowHintY - this.keyframeY);
        if (keyDist < 0.045) {
          const kf = this.refineLucasKanade(
            this.keyframeGray,
            this.keyframeX,
            this.keyframeY,
            flowHintX * PROC_W,
            flowHintY * PROC_H,
            false
          );
          if (kf.valid && kf.zncc > 0.78) {
            anchoredX = flowHintX * 0.48 + kf.x * 0.52;
            anchoredY = flowHintY * 0.48 + kf.y * 0.52;
            keyframeLocked = true;
          }
        } else if (nowMs - this.keyframeSetMs > 165) {
          this.keyframeGray.set(this.smoothCurr);
          this.keyframeX = flowHintX;
          this.keyframeY = flowHintY;
          this.keyframeSetMs = nowMs;
        }
      }

      const bridgeOffset = (this.lastHaarHw * 0.22) / PROC_H;
      const haar = this.findFacialSymmetryAnchor(anchoredX, anchoredY - bridgeOffset, 22, 18);

      // ROI-masked motion centroid around face/head
      let motionMass = 0;
      let motionXSum = 0;
      let motionYSum = 0;
      if (this.hasPrevGray) {
        const my0 = Math.max(6, Math.floor((anchoredY - 0.28) * PROC_H));
        const my1 = Math.min(PROC_H - 7, Math.ceil((anchoredY + 0.28) * PROC_H));
        const mx0 = Math.max(8, Math.floor((anchoredX - 0.24) * PROC_W));
        const mx1 = Math.min(PROC_W - 9, Math.ceil((anchoredX + 0.24) * PROC_W));
        for (let y = my0; y <= my1; y += 2) {
          const row = y * PROC_W;
          for (let x = mx0; x <= mx1; x += 2) {
            const p = row + x;
            const diff = Math.abs(this.smoothCurr[p] - this.smoothPrev[p]);
            if (diff > 8.5) {
              const mw = Math.min(3, (diff - 8.5) / 10);
              motionMass += mw;
              motionXSum += (x / PROC_W) * mw;
              motionYSum += (y / PROC_H) * mw;
            }
          }
        }
      }

      const roiCx = Math.round(anchoredX * PROC_W);
      const roiCy = Math.round(anchoredY * PROC_H);
      const roiRx = 48;
      const roiRy = 56;
      const rx0 = Math.max(2, roiCx - roiRx);
      const rx1 = Math.min(PROC_W - 3, roiCx + roiRx);
      const ry0 = Math.max(2, roiCy - roiRy);
      const ry1 = Math.min(PROC_H - 3, roiCy + roiRy);

      let sSum = 0;
      let sxSum = 0;
      let sySum = 0;

      for (let y = ry0; y <= ry1; y += 2) {
        const row = y * PROC_W;
        for (let x = rx0; x <= rx1; x += 2) {
          const p = row + x;
          const lum = this.smoothCurr[p];
          const cb = this.cbBuf[p];
          const cr = this.crBuf[p];

          if (lum > 18 && cb >= 66 && cb <= 144 && cr >= 125 && cr <= 188) {
            const colorDist = this.hasSkinBaseline
              ? (cb - this.baseCb) ** 2 + (cr - this.baseCr) ** 2
              : 0;
            const colorWeight = this.hasSkinBaseline ? Math.exp(-colorDist / 520) : 1;
            const motionBoost =
              this.hasPrevGray && Math.abs(lum - this.smoothPrev[p]) > 8 ? 2.0 : 1.0;
            const spatialDist = ((x - roiCx) / roiRx) ** 2 + ((y - roiCy) / roiRy) ** 2;
            const w = colorWeight * motionBoost * Math.exp(-spatialDist * 1.2);
            if (w > 0.05) {
              sSum += w;
              sxSum += (x / PROC_W) * w;
              sySum += (y / PROC_H) * w;
            }
          }
        }
      }

      const skinAvailable = sSum > 10;
      const skinX = skinAvailable ? sxSum / sSum : anchoredX;
      const skinY = skinAvailable ? sySum / sSum : anchoredY;

      if (flow.valid && haar.valid) {
        const flowTrust = clamp((flow.zncc - 0.68) / 0.28, 0.35, 1.0);
        const haarWeight = keyframeLocked ? 0.12 : 0.2 + (1 - flowTrust) * 0.18;
        const skinWeight = skinAvailable ? 0.06 : 0;
        const flowWeight = 1 - haarWeight - skinWeight;
        targetX = anchoredX * flowWeight + haar.x * haarWeight + skinX * skinWeight;
        targetY = anchoredY * flowWeight + haar.y * haarWeight + skinY * skinWeight;
        confidence = keyframeLocked ? 98 : 96;
      } else if (flow.valid && skinAvailable) {
        targetX = anchoredX * 0.84 + skinX * 0.16;
        targetY = anchoredY * 0.84 + skinY * 0.16;
        confidence = 91;
      } else if (haar.valid) {
        targetX = haar.x * 0.82 + (skinAvailable ? skinX * 0.18 : haar.x * 0.18);
        targetY = haar.y * 0.82 + (skinAvailable ? skinY * 0.18 : haar.y * 0.18);
        confidence = 86;
      } else if (flow.valid) {
        targetX = anchoredX;
        targetY = anchoredY;
        confidence = 82;
      } else if (skinAvailable) {
        targetX = skinX;
        targetY = skinY;
        confidence = 72;
      } else if (motionMass > 14) {
        const motX = motionXSum / motionMass;
        const motY = motionYSum / motionMass;
        targetX = this.rawX + (motX - this.rawX) * 0.55;
        targetY = this.rawY + (motY - this.rawY) * 0.55;
        confidence = 62;
      } else {
        confidence = Math.max(25, Math.round(confidence * 0.9));
      }

      // One-shot consumed lag-compensated FaceDetector correction
      if (isNewFaceDet && freshFace) {
        this.lastConsumedFaceSeq = freshFace.seq;
        const expectedX = freshFace.cx + (this.rawX - freshFace.startRawX);
        const expectedY = freshFace.cy + (this.rawY - freshFace.startRawY);
        const speed = Math.hypot(targetX - this.rawX, targetY - this.rawY);
        const pull = speed > 0.015 ? 0.24 : 0.38;
        targetX += (expectedX - targetX) * pull;
        targetY += (expectedY - targetY) * pull;
        confidence = Math.max(confidence, 98);

        const fx = clamp(Math.round(freshFace.cx * PROC_W), 2, PROC_W - 3);
        const fy = clamp(Math.round(freshFace.cy * PROC_H), 2, PROC_H - 3);
        const fp = fy * PROC_W + fx;
        this.baseCb = this.baseCb * 0.85 + this.cbBuf[fp] * 0.15;
        this.baseCr = this.baseCr * 0.85 + this.crBuf[fp] * 0.15;
        this.hasSkinBaseline = true;
      } else if (motionMass > 32) {
        const motX = motionXSum / motionMass;
        const motY = motionYSum / motionMass;
        const distToMotion = Math.hypot(motX - targetX, motY - targetY);
        if (distToMotion > 0.09) {
          targetX = targetX * 0.78 + motX * 0.22;
          targetY = targetY * 0.78 + motY * 0.22;
        }
      }

      targetX = clamp(targetX, 0.08, 0.92);
      targetY = clamp(targetY, 0.08, 0.92);

      this.rawX = targetX;
      this.rawY = targetY;

      if (!this.hasKeyframe) {
        this.keyframeGray.set(this.smoothCurr);
        this.keyframeX = targetX;
        this.keyframeY = targetY;
        this.keyframeSetMs = nowMs;
        this.hasKeyframe = true;
      }

      this.state.sx = this.filterX.filter(targetX, nowSec);
      this.state.sy = this.filterY.filter(targetY, nowSec);
    }

    this.hasPrevGray = true;
    this.state.confidence = confidence;
    this.state.status = confidence >= 38 ? 'LOCKED' : 'LOW SIGNAL';

    const gainX = isBodyMode ? 7.2 : 10.8;
    const rawUpDelta = this.state.cy - this.state.sy;
    const gainY = isBodyMode ? (rawUpDelta >= 0 ? 10.2 : 8.4) : 12.2;
    const dead = isBodyMode ? DEADZONE_BODY : DEADZONE_HEAD;

    const rawDx = (this.state.sx - this.state.cx) * gainX * this.sensitivity;
    const rawDy = rawUpDelta * gainY * this.sensitivity;

    const mapPrecision = (val: number): number => {
      const abs = Math.abs(val);
      if (abs <= dead) return 0;
      const norm = Math.min(1, (abs - dead) / (1 - dead));
      const curved = 0.78 * norm + 0.22 * Math.pow(norm, 1.25);
      return Math.sign(val) * Math.min(1, curved);
    };

    this.state.steerX = mapPrecision(rawDx);
    this.state.steerY = mapPrecision(rawDy);

    if (pipCanvas) {
      this.renderPipOverlay(videoEl, pipCanvas);
    }
    if (secondaryCanvas) {
      this.renderPipOverlay(videoEl, secondaryCanvas);
    }
  }

  private renderPipOverlay(videoEl: HTMLVideoElement, pipCanvas: HTMLCanvasElement): void {
    let pipCtx = this.pipCtxCache.get(pipCanvas);
    if (!pipCtx) {
      const ctx = pipCanvas.getContext('2d');
      if (!ctx) return;
      this.pipCtxCache.set(pipCanvas, ctx);
      pipCtx = ctx;
    }

    const w = pipCanvas.width;
    const h = pipCanvas.height;

    pipCtx.save();
    pipCtx.translate(w, 0);
    pipCtx.scale(-1, 1);
    pipCtx.drawImage(videoEl, 0, 0, w, h);
    pipCtx.restore();

    const cxPx = this.state.cx * w;
    const cyPx = this.state.cy * h;
    const sxPx = this.state.sx * w;
    const syPx = this.state.sy * h;
    const isBodyMode = this.trackingMode === 'body';

    // Neutral origin ring & standing posture guide
    pipCtx.strokeStyle = 'rgba(0, 240, 255, 0.78)';
    pipCtx.lineWidth = 1.4;
    pipCtx.beginPath();
    pipCtx.arc(cxPx, cyPx, isBodyMode ? 13 : 10, 0, Math.PI * 2);
    if (isBodyMode) {
      pipCtx.moveTo(cxPx, Math.max(8, cyPx - 28));
      pipCtx.lineTo(cxPx, Math.min(h - 8, cyPx + 28));
    }
    pipCtx.stroke();

    pipCtx.fillStyle = 'rgba(0, 240, 255, 0.9)';
    pipCtx.beginPath();
    pipCtx.arc(cxPx, cyPx, 1.8, 0, Math.PI * 2);
    pipCtx.fill();

    const locked = this.state.status === 'LOCKED';
    if (Math.hypot(sxPx - cxPx, syPx - cyPx) > 1.5) {
      pipCtx.strokeStyle = locked ? 'rgba(0, 245, 155, 0.78)' : 'rgba(255, 209, 59, 0.78)';
      pipCtx.lineWidth = 1.6;
      pipCtx.beginPath();
      pipCtx.moveTo(cxPx, cyPx);
      pipCtx.lineTo(sxPx, syPx);
      pipCtx.stroke();
    }

    const boxW = isBodyMode
      ? w * 0.44
      : this.detectedFace
      ? this.detectedFace.w * w * 1.15
      : w * 0.36;
    const boxH = isBodyMode
      ? h * 0.74
      : this.detectedFace
      ? this.detectedFace.h * h * 1.3
      : h * 0.54;
    const bx = sxPx - boxW / 2;
    const by = syPx - boxH / 2;
    const corner = isBodyMode ? 15 : 12;
    pipCtx.strokeStyle = locked ? '#00f59b' : '#ffd13b';
    pipCtx.lineWidth = 2;

    pipCtx.beginPath();
    pipCtx.moveTo(bx, by + corner);
    pipCtx.lineTo(bx, by);
    pipCtx.lineTo(bx + corner, by);

    pipCtx.moveTo(bx + boxW - corner, by);
    pipCtx.lineTo(bx + boxW, by);
    pipCtx.lineTo(bx + boxW, by + corner);

    pipCtx.moveTo(bx + boxW, by + boxH - corner);
    pipCtx.lineTo(bx + boxW, by + boxH);
    pipCtx.lineTo(bx + boxW - corner, by + boxH);

    pipCtx.moveTo(bx + corner, by + boxH);
    pipCtx.lineTo(bx, by + boxH);
    pipCtx.lineTo(bx, by + boxH - corner);
    pipCtx.stroke();

    // Crisp sub-pixel live lock crosshair
    pipCtx.strokeStyle = locked ? '#00f59b' : '#ffd13b';
    pipCtx.lineWidth = 1.6;
    pipCtx.beginPath();
    pipCtx.arc(sxPx, syPx, isBodyMode ? 7 : 5.5, 0, Math.PI * 2);
    pipCtx.moveTo(sxPx - 10, syPx);
    pipCtx.lineTo(sxPx - 2.5, syPx);
    pipCtx.moveTo(sxPx + 2.5, syPx);
    pipCtx.lineTo(sxPx + 10, syPx);
    pipCtx.moveTo(sxPx, syPx - 10);
    pipCtx.lineTo(sxPx, syPx - 2.5);
    pipCtx.moveTo(sxPx, syPx + 2.5);
    pipCtx.lineTo(sxPx, syPx + 10);
    pipCtx.stroke();

    pipCtx.fillStyle = 'rgba(5, 8, 20, 0.78)';
    pipCtx.fillRect(6, h - 22, 104, 16);
    pipCtx.fillStyle = locked ? '#00f59b' : '#ffd13b';
    pipCtx.font = 'bold 10px monospace';
    pipCtx.fillText(`${isBodyMode ? 'BODY' : 'LOCK'} ${this.state.confidence}%`, 11, h - 10);
  }
}
