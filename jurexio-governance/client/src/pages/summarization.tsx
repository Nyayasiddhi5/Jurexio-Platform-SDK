import { FileSearch } from 'lucide-react';
import {
  DocPipelineActionPage,
  DOCS_SUMMARIZE_PATH,
} from '@/components/DocPipelineActionPage';

export default function Summarization() {
  return (
    <DocPipelineActionPage
      title="Summarization"
      description="Executive, detailed, and bullet summaries via the SDK docs pipeline."
      icon={FileSearch}
      pageDataTestId="page-summarization"
      apiPath={DOCS_SUMMARIZE_PATH}
      actionLabel="Summarize"
      showStyleSelect
      buildBody={(content, jurisdiction, style) => ({
        documentText: content,
        jurisdiction,
        length: style === 'brief' ? 'short' : style === 'bullets' ? 'short' : 'medium',
      })}
    />
  );
}
