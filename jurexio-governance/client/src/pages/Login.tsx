import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Eye, EyeOff, Mail, Lock, Github, Chrome } from 'lucide-react';
import { ErrorFallback } from '@/components/ErrorFallback';
import { handleError, logError } from '@/lib/errorHandler';
import { setAuthSession } from '@/lib/auth-session';
import { resolveApiError } from '@/lib/jrx-messages';

interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role: string;
  subscriptionTier: string;
  subscriptionStatus: string;
}

interface LoginProps {
  onLoginSuccess: (user: User) => void;
}

interface OAuthProviders {
  google: boolean;
  github: boolean;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isSignup, setIsSignup] = useState(false);
  const [oauthProviders, setOAuthProviders] = useState<OAuthProviders>({ google: false, github: false });
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    name: ''
  });
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const checkAuthAndProviders = async () => {
      try {
        const providersRes = await fetch('/api/auth/providers');
        if (providersRes.ok) {
          const data = await providersRes.json();
          setOAuthProviders({
            google: data.google || false,
            github: data.github || false
          });
        }

        const storedToken = localStorage.getItem('token');
        const meHeaders: Record<string, string> = {};
        if (storedToken) {
          meHeaders['Authorization'] = `Bearer ${storedToken}`;
        }
        let meRes = await fetch('/api/auth/me', { credentials: 'include', headers: meHeaders });
        if (meRes.status === 404) {
          meRes = await fetch('/api/jrx/auth/me', { credentials: 'include', headers: meHeaders });
        }
        if (meRes.ok) {
          const data = await meRes.json();
          if (data.user) {
            onLoginSuccess({
              id: String(data.user.id),
              name: data.user.name || data.user.email,
              email: data.user.email,
              avatar: data.user.avatarUrl,
              role: data.user.role,
              subscriptionTier: data.user.subscriptionTier || 'alpha',
              subscriptionStatus: data.user.subscriptionStatus || 'active'
            });
          }
        }
      } catch (error) {
        console.error('Auth check failed:', error);
      }
    };

    checkAuthAndProviders();
  }, [onLoginSuccess]);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const endpoint = isSignup ? '/api/auth/signup' : '/api/auth/login';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          ...(isSignup && { name: formData.name })
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(resolveApiError(data).message || `${isSignup ? 'Signup' : 'Login'} failed`);
      }

      if (data.token) {
        setAuthSession(data.token, data.user);
      }

      toast({
        title: isSignup ? "Account created!" : "Welcome back!",
        description: isSignup ? "You've successfully signed up." : "You've successfully logged in.",
      });

      onLoginSuccess({
        id: String(data.user.id),
        name: data.user.name || data.user.email,
        email: data.user.email,
        avatar: data.user.avatarUrl,
        role: data.user.role,
        subscriptionTier: data.user.subscriptionTier || 'alpha',
        subscriptionStatus: data.user.subscriptionStatus || 'active'
      });
    } catch (error: any) {
      const errorInfo = handleError(error);
      setError(errorInfo.message || `${isSignup ? 'Signup' : 'Login'} failed. Please try again.`);
      logError(error, `Email ${isSignup ? 'Signup' : 'Login'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOAuthLogin = (provider: 'google' | 'github') => {
    window.location.href = `/api/auth/${provider}`;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
    if (error) setError(null);
  };

  if (error && error.includes('critical')) {
    return <ErrorFallback error={new Error(error)} context="Login Page" />;
  }

  const hasOAuthProviders = oauthProviders.google || oauthProviders.github;

  return (
    <main
      id="main-content"
      className="min-h-screen flex items-center justify-center p-6 bg-[#F9FAFB]"
      aria-label="Jurexio login page"
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <Card className="border border-[#E4E7EC] bg-white shadow-none" data-testid="card-login">
          <CardHeader className="text-center pb-4">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: "spring" }}
              className="mx-auto w-24 h-24 mb-4 flex items-center justify-center"
            >
              <img
                src="/nyayasiddhi-icon.png"
                alt="Jurexio"
                className="w-24 h-24 object-contain"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.src = '/nyayasiddhi-logo.png';
                }}
              />
            </motion.div>
            <CardTitle className="text-2xl font-bold text-[#152448] font-heading">
              {isSignup ? 'Create Your Account' : 'Welcome to Jurexio'}
            </CardTitle>
            <CardDescription className="text-[#C7B15B] font-body">
              {isSignup ? 'Join the Global Legal Operating System' : 'Justice. Powered by Precision.'}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {error && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="p-4 rounded-lg border border-[#CC2C2C]/30 bg-[#CC2C2C]/10"
                data-testid="alert-error"
              >
                <p className="text-sm text-[#CC2C2C]">{error}</p>
              </motion.div>
            )}

            {hasOAuthProviders && (
              <>
                <div className="space-y-3">
                  {oauthProviders.google && (
                    <Button
                      onClick={() => handleOAuthLogin('google')}
                      disabled={isLoading}
                      variant="outline"
                      className="w-full gap-3 h-11 text-[#152448] border-[#E4E7EC] hover:bg-[#F7F3EA]"
                      data-testid="button-oauth-google"
                      aria-label="Continue with Google — sign in using your Google account"
                    >
                      <Chrome className="h-5 w-5 text-[#C7B15B]" aria-hidden="true" />
                      Continue with Google
                    </Button>
                  )}

                  {oauthProviders.github && (
                    <Button
                      onClick={() => handleOAuthLogin('github')}
                      disabled={isLoading}
                      variant="outline"
                      className="w-full gap-3 h-11 text-[#152448] border-[#E4E7EC] hover:bg-[#F7F3EA]"
                      data-testid="button-oauth-github"
                      aria-label="Continue with GitHub — sign in using your GitHub account"
                    >
                      <Github className="h-5 w-5" aria-hidden="true" />
                      Continue with GitHub
                    </Button>
                  )}
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <Separator className="w-full bg-[#E4E7EC]" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="px-2 text-[#61697D] bg-white">Or continue with email</span>
                  </div>
                </div>
              </>
            )}

            <form onSubmit={handleEmailAuth} className="space-y-4">
              {isSignup && (
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-[#152448]">Full Name</Label>
                  <Input
                    id="name"
                    name="name"
                    type="text"
                    placeholder="Enter your name"
                    value={formData.name}
                    onChange={handleInputChange}
                    className="h-11 text-[#152448] placeholder:text-[#61697D] bg-white border-[#E4E7EC] focus-visible:ring-[#152448]"
                    data-testid="input-name"
                    required={isSignup}
                   aria-label="Enter your name"/>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="email" className="text-[#152448]">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 h-4 w-4 text-[#C7B15B]" />
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="you@example.com"
                    value={formData.email}
                    onChange={handleInputChange}
                    className="pl-10 h-11 text-[#152448] placeholder:text-[#61697D] bg-white border-[#E4E7EC] focus-visible:ring-[#152448]"
                    data-testid="input-email"
                    autoComplete="email"
                    required
                   aria-label="you@example.com"/>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-[#152448]">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-[#C7B15B]" />
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={formData.password}
                    onChange={handleInputChange}
                    className="pl-10 pr-10 h-11 text-[#152448] placeholder:text-[#61697D] bg-white border-[#E4E7EC] focus-visible:ring-[#152448]"
                    data-testid="input-password"
                    autoComplete="current-password"
                    required
                   aria-label="Enter your password"/>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent text-[#C7B15B]"
                    onClick={() => setShowPassword(!showPassword)}
                    data-testid="button-toggle-password"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                  </Button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={isLoading}
                className="w-full h-11 font-semibold hover:opacity-90 transition-opacity bg-[#152448] text-white"
                data-testid="button-submit"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {isSignup ? 'Creating Account...' : 'Signing in...'}
                  </>
                ) : (
                  isSignup ? 'Create Account' : 'Sign In'
                )}
              </Button>
            </form>

            <div className="text-center text-sm">
              <span className="text-[#61697D]">
                {isSignup ? 'Already have an account? ' : "Don't have an account? "}
              </span>
              <Button 
                variant="link" 
                className="p-0 h-auto font-semibold text-[#C7B15B]"
                onClick={() => {
                  setIsSignup(!isSignup);
                  setError(null);
                }}
                data-testid="button-toggle-mode"
              >
                {isSignup ? 'Sign in' : 'Sign up for free'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-[#61697D]">
          Subject Matter Expert (LegalChat UAT)? Use{' '}
          <a href="/legalchat/login" className="hover:underline text-[#C7B15B]">
            LegalChat sign-in
          </a>{' '}
          — not this platform console login.
        </p>

        <div className="mt-6 text-center text-xs text-[#61697D]">
          By {isSignup ? 'signing up' : 'signing in'}, you agree to our{' '}
          <a href="/terms" className="hover:underline text-[#C7B15B]" aria-label="Read our Terms of Service">Terms of Service</a>
          {' '}and{' '}
          <a href="/privacy" className="hover:underline text-[#C7B15B]" aria-label="Read our Privacy Policy">Privacy Policy</a>
        </div>
      </motion.div>
    </main>
  );
}
