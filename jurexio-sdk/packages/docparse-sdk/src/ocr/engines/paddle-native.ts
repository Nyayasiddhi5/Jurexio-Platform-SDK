/**
 * Paddle PP-OCRv5 script models (optional dependency ppu-paddle-ocr).
 */
import type { ScriptCode } from "../../types.js";
import type { OcrEngine, OcrRequest, OcrResult } from "./types.js";
import { pixelsToPoints } from "./types.js";
import type { DocparseConfig } from "../../types.js";
import { PADDLE_V5_MODELS } from "../../grammar/script.js";

export class PaddleNativeEngine implements OcrEngine {
  readonly id = "paddle-native";
  readonly scripts: ScriptCode[] = ["Deva", "Taml", "Telu"];

  constructor(private readonly _config: DocparseConfig) {}

  async available(): Promise<boolean> {
    try {
      await import("ppu-paddle-ocr");
      return true;
    } catch {
      return false;
    }
  }

  async recognise(req: OcrRequest): Promise<OcrResult> {
    const t0 = performance.now();
    const notes: string[] = [];
    const modelId = PADDLE_V5_MODELS[req.script];
    if (!modelId) {
      return {
        words: [],
        meanConf: 0,
        engine: this.id,
        deskewDeg: 0,
        ms: performance.now() - t0,
        notes: [`no paddle v5 model for script ${req.script}`],
      };
    }

    type PaddleMod = {
      recognize?: (path: string, opts?: Record<string, unknown>) => Promise<{
        data?: Array<{ text: string; confidence: number; box?: number[][] }>;
      }>;
    };

    let mod: PaddleMod;
    try {
      mod = (await import("ppu-paddle-ocr")) as PaddleMod;
    } catch {
      return {
        words: [],
        meanConf: 0,
        engine: `${this.id}:unavailable`,
        deskewDeg: 0,
        ms: performance.now() - t0,
        notes: ["ppu-paddle-ocr not installed"],
      };
    }

    if (typeof mod.recognize !== "function") {
      return {
        words: [],
        meanConf: 0,
        engine: this.id,
        deskewDeg: 0,
        ms: performance.now() - t0,
        notes: ["ppu-paddle-ocr API missing recognize()"],
      };
    }

    const raw = await mod.recognize(req.imagePath, { model: modelId });
    const items = raw?.data ?? [];
    const words = items.map((item) => {
      const quad = item.box?.[0];
      const x0 = quad?.[0] ?? 0;
      const y0 = quad?.[1] ?? 0;
      const px = pixelsToPoints({ x: x0, y: y0, w: 1, h: 1 }, req.dpi);
      return {
        text: item.text,
        bbox: px,
        conf: item.confidence,
        script: req.script,
        source: "OCR" as const,
        engine: `${this.id}:${modelId}`,
      };
    });

    const meanConf =
      words.length === 0 ? 0 : words.reduce((s, w) => s + w.conf, 0) / words.length;

    return {
      words,
      meanConf,
      engine: `${this.id}:${modelId}`,
      deskewDeg: 0,
      ms: performance.now() - t0,
      notes,
    };
  }
}
