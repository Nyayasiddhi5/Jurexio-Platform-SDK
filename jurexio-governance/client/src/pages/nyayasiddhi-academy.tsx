import { GraduationCap } from 'lucide-react';
import { PhaseCScaffold } from '@/components/PhaseCScaffold';
import { nv } from '@/lib/jrx-api-paths';

export default function JurexioAcademy() {
  return (
    <PhaseCScaffold
      title="Jurexio Academy"
      description="Legal intelligence training and education"
      endpoint={nv('phase-c/academy')}
      icon={GraduationCap}
      minRole="user"
      pageDataTestId="page-nyayasiddhi-academy"
      capabilities={[
        'Learning pathways',
        'Training sessions',
        'Assessment and completion tracking',
      ]}
    />
  );
}
