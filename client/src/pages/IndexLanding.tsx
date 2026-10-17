import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { JRX_PLATFORM_SDK_LABEL } from '@/lib/jrx-registry-stats';
import { roleHomeRelative } from '@/lib/jrx-role-home';

export default function IndexLanding() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      setLocation(roleHomeRelative(user.role));
    } else {
      setLocation('/login');
    }
  }, [user, setLocation]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F9FAFB]">
      <div className="text-center">
        <img src="/nyayasiddhi-icon.png" alt="Jurexio" className="h-24 w-24 object-contain mx-auto mb-6" />
        <h1 className="text-3xl font-bold text-[#152448] mb-2 font-heading tracking-wide">
          NYAYASIDDHI
        </h1>
        <p className="text-sm mb-6 text-[#C7B15B]">Justice. Powered by Precision.</p>
        <div className="flex items-center justify-center gap-2 text-[#61697D]">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[#C7B15B]" role="status" aria-label="Loading"></div>
          <span className="text-sm">Loading {JRX_PLATFORM_SDK_LABEL}...</span>
        </div>
      </div>
    </div>
  );
}
