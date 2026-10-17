/**
 * OCR routing.
 *
 * Decides, per page and per script, which engine and which models to run, then
 * arbitrates the results. Routing is explicit rather than "throw it all at one
 * multilingual model" because the evidence does not support a single model:
 *
 *  - PP-OCRv6 (Paddle's current generation) covers 50 languages — CJK and
 *    Latin-script. It has NO Indic coverage. Claims otherwise in package
 *    READMEs are not supported by upstream documentation.
 *  - PP-OCRv5 ships exactly three Indic script models: Devanagari, Tamil, Telugu.
 *    Bengali has none, in any Paddle generation.
 *  - Google Document AI covers nine Indic scripts for PRINT, but its Form Parser
 *    narrows to Hindi and Marathi, and Indic HANDWRITING is Experimental at best.
 *  - Azure Document Intelligence has no Telugu, Bengali, Kannada, Gujarati,
 *    Malayalam, Odia or Assamese print support, and no Indic handwriting at all.
 *
 * So Tesseract is the only engine with broad Indic coverage that runs locally,
 * and local is a hard requirement here — court documents do not leave the tenant
 * boundary for a third-party OCR API.
 */

import type { DocparseConfig, ScriptCode, Word } from "../types.js";
import type { OcrEngine, OcrRequest, OcrResult } from "./engines/types.js";
import { TesseractNativeEngine } from "./engines/tesseract-native.js";
import { arbitrate, arbitrationPasses, type ArbitrationNote, type Pass } from "./arbitrate.js";

export interface RoutedOcrResult {
  words: Word[];
  meanConf: number;
  /** Every pass that ran, for the audit record. */
  passes: Array<{ id: string; words: number; meanConf: number; ms: number }>;
  arbitration: ArbitrationNote[];
  numericConflicts: number;
  ms: number;
  notes: string[];
  /** True when nothing legible came back and a human must look at the page. */
  humanReviewRequired: boolean;
}

export class OcrRouter {
  private engines: OcrEngine[];

  constructor(private readonly config: DocparseConfig, engines?: OcrEngine[]) {
    this.engines = engines ?? [
      new TesseractNativeEngine({
        tessdataPrefix: config.ocr.tessdataPrefix,
        binary: config.ocr.tesseractBinary,
      }),
    ];
  }

  async pickEngine(script: ScriptCode): Promise<OcrEngine | null> {
    const preference = this.config.ocr.enginePreference[script] ?? ["tesseract-native"];
    for (const id of preference) {
      const e = this.engines.find((x) => x.id === id);
      if (!e) continue;
      if (!e.scripts.includes(script)) continue;
      if (await e.available()) return e;
    }
    // Last resort: any available engine that claims the script.
    for (const e of this.engines) {
      if (e.scripts.includes(script) && (await e.available())) return e;
    }
    return null;
  }

  /**
   * Recognise a page. For Indic scripts this runs a primary pass plus the
   * arbitration passes from arbitrate.ts, which is what catches the
   * dropped-leading-digit defect that the language models produce.
   */
  async recognise(req: OcrRequest): Promise<RoutedOcrResult> {
    const t0 = performance.now();
    const notes: string[] = [];
    const engine = await this.pickEngine(req.script);
    if (!engine) {
      return {
        words: [], meanConf: 0, passes: [], arbitration: [], numericConflicts: 0,
        ms: performance.now() - t0,
        notes: [`no OCR engine available for script ${req.script}`],
        humanReviewRequired: true,
      };
    }

    const primary = await engine.recognise(req);
    notes.push(...primary.notes);

    const extraModels = arbitrationPasses(req.script);
    const secondaries: Pass[] = [];

    if (extraModels.length > 0 && engine instanceof TesseractNativeEngine) {
      const installed = await engine.installedLangs();
      for (const model of extraModels) {
        if (!installed.has(model)) {
          notes.push(`arbitration model ${model} not installed; skipped`);
          continue;
        }
        // A dedicated engine instance pinned to this one model.
        const pinned = new TesseractNativeEngine({
          tessdataPrefix: this.config.ocr.tessdataPrefix,
          binary: this.config.ocr.tesseractBinary,
        });
        // langsFor() is overridden by pinning through a subclass-free shim:
        // we call the binary directly with the single model.
        const r = await runPinned(pinned, model, req);
        if (r.words.length === 0) {
          notes.push(`arbitration pass ${model} returned nothing`);
          continue;
        }
        secondaries.push({ id: `tesseract-native:${model}`, words: r.words, meanConf: r.meanConf });
      }
    }

    const primaryPass: Pass = {
      id: primary.engine,
      words: primary.words,
      meanConf: primary.meanConf,
    };

    const arb = secondaries.length > 0
      ? arbitrate(primaryPass, secondaries)
      : { words: primary.words, notes: [] as ArbitrationNote[], numericConflicts: 0 };

    const meanConf = arb.words.length === 0
      ? 0
      : arb.words.reduce((a, w) => a + w.conf, 0) / arb.words.length;

    return {
      words: arb.words,
      meanConf,
      passes: [
        { id: primaryPass.id, words: primary.words.length, meanConf: primary.meanConf, ms: primary.ms },
        ...secondaries.map((s) => ({ id: s.id, words: s.words.length, meanConf: s.meanConf, ms: 0 })),
      ],
      arbitration: arb.notes,
      numericConflicts: arb.numericConflicts,
      ms: performance.now() - t0,
      notes,
      // An unreadable page, or one where every numeric token conflicted, cannot
      // be autofilled from. Say so rather than filling the form with guesses.
      humanReviewRequired: arb.words.length === 0 || meanConf < 0.4,
    };
  }
}

/**
 * Run Tesseract with exactly one model. Kept as a free function rather than an
 * engine option so the primary engine's language-union logic stays untouched —
 * arbitration passes are a different thing from the main recognition pass and
 * should not be able to change it.
 */
async function runPinned(
  engine: TesseractNativeEngine,
  model: string,
  req: OcrRequest,
): Promise<OcrResult> {
  // Reach the same code path by temporarily narrowing langsFor. This is the one
  // place a private override is cleaner than threading an option through every
  // layer of the engine interface.
  const original = engine.langsFor.bind(engine);
  (engine as unknown as { langsFor: (s: ScriptCode) => Promise<string> }).langsFor =
    async () => model;
  try {
    return await engine.recognise(req);
  } finally {
    (engine as unknown as { langsFor: (s: ScriptCode) => Promise<string> }).langsFor = original;
  }
}
