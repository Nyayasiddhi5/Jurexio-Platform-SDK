import { useAuth } from '@/contexts/AuthContext';
import { hasAccess, type RoleLevel } from '@/lib/rbac-registry';
import { Shield, LogIn, Building } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ProtectedRouteProps {
  children: React.ReactNode;
  minRole?: RoleLevel;
  requiresAuth?: boolean;
  requiresOrg?: boolean;
  requiresApp?: boolean;
}

export function ProtectedRoute({ children, minRole = 'user', requiresAuth = true, requiresOrg = false, requiresApp = false }: ProtectedRouteProps) {
  const { user } = useAuth();

  if (requiresAuth && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0E1830 0%, #152448 40%, #152448 100%)' }}>
        <div className="rounded-xl shadow-lg p-8 max-w-md w-full text-center" style={{ background: '#152448', border: '1px solid #2B384C' }}>
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: '#2B384C' }}>
            <LogIn className="h-8 w-8" style={{ color: '#C7B15B' }} />
          </div>
          <h2 className="text-xl font-bold text-white mb-2" style={{ fontFamily: 'Merriweather, serif' }}>Authentication Required</h2>
          <p className="text-sm mb-6" style={{ color: '#C7B15B' }}>Please sign in to access this feature.</p>
          <Button
            onClick={() => window.location.href = '/console/login'}
            className="text-white font-semibold"
            style={{ background: '#C7B15B', color: '#152448' }}
          >
            <LogIn className="h-4 w-4 mr-2" />
            Sign In
          </Button>
        </div>
      </div>
    );
  }

  if (user && !hasAccess(user.role, minRole)) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0E1830 0%, #152448 40%, #152448 100%)' }}>
        <div className="rounded-xl shadow-lg p-8 max-w-md w-full text-center" style={{ background: '#152448', border: '1px solid #2B384C' }}>
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: '#2B384C' }}>
            <Shield className="h-8 w-8" style={{ color: '#C7B15B' }} />
          </div>
          <h2 className="text-xl font-bold text-white mb-2" style={{ fontFamily: 'Merriweather, serif' }}>Access Restricted</h2>
          <p className="text-sm mb-2" style={{ color: '#C7B15B' }}>
            You don't have permission to access this feature.
          </p>
          <p className="text-xs mb-6" style={{ color: '#8B9DC3' }}>
            Required role: <span className="font-semibold text-white">{minRole.replace('_', ' ')}</span>
            {' '} | Your role: <span className="font-semibold text-white">{user?.role || 'unknown'}</span>
          </p>
          <Button
            onClick={() => window.location.href = '/console/dashboard'}
            variant="outline"
            className="text-white"
            style={{ borderColor: '#C7B15B', color: '#C7B15B' }}
          >
            Return to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  const isSuperAdmin = user?.role === 'super_admin';

  if (user && requiresOrg && !isSuperAdmin && !(user as any).organizationId) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0E1830 0%, #152448 40%, #152448 100%)' }}>
        <div className="rounded-xl shadow-lg p-8 max-w-md w-full text-center" style={{ background: '#152448', border: '1px solid #2B384C' }}>
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: '#2B384C' }}>
            <Building className="h-8 w-8" style={{ color: '#C7B15B' }} />
          </div>
          <h2 className="text-xl font-bold text-white mb-2" style={{ fontFamily: 'Merriweather, serif' }}>Organization Required</h2>
          <p className="text-sm mb-2" style={{ color: '#C7B15B' }}>
            This feature requires an active organization membership.
          </p>
          <p className="text-xs mb-6" style={{ color: '#8B9DC3' }}>
            Contact your administrator to be added to an organization.
          </p>
          <Button
            onClick={() => window.location.href = '/console/dashboard'}
            variant="outline"
            className="text-white"
            style={{ borderColor: '#C7B15B', color: '#C7B15B' }}
          >
            Return to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  if (user && requiresApp && !isSuperAdmin && !(user as any).applicationId) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0E1830 0%, #152448 40%, #152448 100%)' }}>
        <div className="rounded-xl shadow-lg p-8 max-w-md w-full text-center" style={{ background: '#152448', border: '1px solid #2B384C' }}>
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: '#2B384C' }}>
            <Shield className="h-8 w-8" style={{ color: '#C7B15B' }} />
          </div>
          <h2 className="text-xl font-bold text-white mb-2" style={{ fontFamily: 'Merriweather, serif' }}>Application Required</h2>
          <p className="text-sm mb-2" style={{ color: '#C7B15B' }}>
            This feature requires an active SDK application.
          </p>
          <p className="text-xs mb-6" style={{ color: '#8B9DC3' }}>
            Create an application in the SDK Developer Console to access this feature.
          </p>
          <Button
            onClick={() => window.location.href = '/console/sdk-console'}
            variant="outline"
            className="text-white"
            style={{ borderColor: '#C7B15B', color: '#C7B15B' }}
          >
            Go to Developer Console
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
