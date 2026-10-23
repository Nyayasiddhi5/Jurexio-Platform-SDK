/**
 * Optional cloud OCR when local Tesseract/Paddle cannot rasterise or fails a page.
 * NSP/JRX inject implementation — core stays deterministic-first.
 */
export interface CloudOcrPageRequest {
  documentId: string;
  pageNo: number;
  bytes: Uint8Array;
  fileName: string;
  mime?: string;
}

export interface CloudOcrPageResult {
  text: string;
  provider: string;
  meanConf: number;
}

export interface CloudOcrProvider {
  readonly id: string;
  available(): Promise<boolean>;
  recognizePage(req: CloudOcrPageRequest): Promise<CloudOcrPageResult | null>;
}
