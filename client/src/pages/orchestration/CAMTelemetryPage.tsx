import { CAMMonitoringDashboard } from '@/components/CAMMonitoringDashboard';

/** Orchestration Hub tab `cam-telemetry` — CAM 2.0 (`GET /api/nyayavigya/cam/dashboard`). */
export default function CAMTelemetryPage() {
  return (
    <div className="p-4" data-testid="cam-telemetry-page">
      <CAMMonitoringDashboard startupId={0} />
    </div>
  );
}
