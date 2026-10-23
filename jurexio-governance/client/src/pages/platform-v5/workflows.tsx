import { Workflow } from 'lucide-react';
import { Nv5NamespacePage, type NamespaceConfig } from './_shared';

const cfg: NamespaceConfig = {
  slug: 'workflows',
  title: 'Platform v5 — Workflows',
  blurb:
    'Session-10 Batch C workflow surface — wires 2 previously-orphan execution engines (autonomous-continuous, continuous). Engines do NOT auto-start at boot; an SDK caller must POST /api/nv5/workflows/start. The legacy boot-time auto-start was removed entirely per architect review.',
  apiPrefix: '/api/nv5/workflows',
  flagKeys: ['workflowAutonomous', 'workflowContinuous'],
  subServices: [
    { label: 'Autonomous engine', path: 'autonomous', probe: '/status', flag: 'workflowAutonomous' },
    { label: 'Continuous engine', path: 'continuous', probe: '/status', flag: 'workflowContinuous' },
  ],
  tryIt: {
    method: 'GET',
    url: '/api/nv5/workflows/continuous/status',
    label: 'Fetch continuous engine status',
    description: 'Read-only status snapshot of the continuous execution engine. Returns "not running" when the engine has not been started by an SDK POST /start.',
  },
  batch: 'C',
  icon: Workflow,
};

export default function PlatformV5Workflows() { return <Nv5NamespacePage cfg={cfg} />; }
