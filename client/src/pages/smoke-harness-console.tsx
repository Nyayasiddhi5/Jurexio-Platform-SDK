import { TestTube } from 'lucide-react';
import { PhaseCScaffold } from '@/components/PhaseCScaffold';

import { NV_BASE, nv } from '@/lib/jrx-api-paths';
export default function SmokeHarnessConsole() {
  return (
    <PhaseCScaffold
      title="Smoke Harness Console"
      description="Run nv-smoke-bash.sh from UI with per-platform pass/fail matrix"
      endpoint={nv('phase-c/smoke-harness-console')}
      icon={TestTube}
      minRole="developer"
      pageDataTestId="page-smoke-harness-console"
      capabilities={[
        // Hydrated from backend manifest at /api/jrx/phase-c/_manifest
        // when implemented; static for now to keep the page useful pre-backend.
        `See planned capabilities at ${NV_BASE}phase-c/_manifest`,
      ]}
    />
  );
}
