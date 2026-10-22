import type { CliValues } from "./options.js";
export declare function runRecognize(images: string[], values: CliValues): Promise<void>;
export declare function runDetect(images: string[], values: CliValues): Promise<void>;
export declare function runBatch(patterns: string[], values: CliValues): Promise<void>;
export declare function runStream(patterns: string[], values: CliValues): Promise<void>;
export declare function runDownloadModels(values: CliValues): Promise<void>;
export declare function runClearCache(values: CliValues): void;
export declare function runModels(values: CliValues): void;
