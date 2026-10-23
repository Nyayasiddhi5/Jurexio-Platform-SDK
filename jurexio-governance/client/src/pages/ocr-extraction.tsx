import { ScanText } from 'lucide-react';
import {
  DocPipelineActionPage,
  DOCS_PARSE_PATH,
} from '@/components/DocPipelineActionPage';

export default function OcrExtraction() {
  return (
    <DocPipelineActionPage
      title="OCR & Extraction"
      description="Parse and extract structured text from legal documents via the SDK docs pipeline."
      icon={ScanText}
      pageDataTestId="page-ocr-extraction"
      apiPath={DOCS_PARSE_PATH}
      actionLabel="Parse document"
      buildBody={(content, jurisdiction) => ({
        content,
        format: 'text',
        jurisdiction,
        language: 'en',
      })}
    />
  );
}
