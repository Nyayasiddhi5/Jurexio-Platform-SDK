import { Link, useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { Sparkles, ChevronDown, Globe, Loader2 } from 'lucide-react';
import { useLanguage, languageNames, type SupportedLanguage } from '@/contexts/LanguageContext';

export default function GlobalHeader() {
  const [location, setLocation] = useLocation();
  const { language, setLanguage, t, isLoadingTranslations } = useLanguage();
  
  const currentPlatform = location.startsWith('/shakti-ai')
    ? 'shakti-ai'
    : location.startsWith('/superagent') 
    ? 'superagent' 
    : location.startsWith('/founder-dashboard') || location.startsWith('/studios')
    ? 'incubator'
    : 'home';

  const handlePlatformChange = (value: string) => {
    if (value === 'incubator') {
      setLocation('/founder-dashboard');
    } else if (value === 'superagent') {
      setLocation('/superagent');
    } else if (value === 'shakti-ai') {
      setLocation('/shakti-ai/chat');
    } else {
      setLocation('/');
    }
  };

  return (
    <header className="h-16 bg-gradient-to-r from-primary/5 to-purple-500/5 border-b border-border backdrop-blur-sm sticky top-0 z-50">
      <div className="h-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between">
        {/* Left: Logo + Platform Switcher */}
        <div className="flex items-center gap-6">
          <Link href="/">
            <a className="flex items-center gap-2 hover:opacity-80 transition-opacity" data-testid="link-home-logo">
              <div className="p-1.5 bg-gradient-to-br from-primary to-purple-600 rounded-lg">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <span className="text-xl font-bold bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent">Jurexio AI</span>
            </a>
          </Link>

          {currentPlatform !== 'home' && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-foreground-secondary hidden sm:block">{t('platform')}:</span>
              <Select value={currentPlatform} onValueChange={handlePlatformChange}>
                <SelectTrigger 
                  className="w-[200px] glass border-border/50 text-foreground"
                  data-testid="select-platform-switcher"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="shakti-ai">✨ SHAKTI AI</SelectItem>
                  <SelectItem value="incubator">🚀 {t('incubator')}</SelectItem>
                  <SelectItem value="superagent">🤖 {t('superAgent')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Center: Breadcrumbs */}
        <div className="hidden md:flex items-center gap-2 text-sm text-foreground-secondary">
          {currentPlatform === 'shakti-ai' && (
            <>
              <span>SHAKTI AI</span>
              <ChevronDown className="w-4 h-4 rotate-[-90deg]" />
              <span className="text-foreground font-medium">Universal Agent Platform</span>
            </>
          )}
          {currentPlatform === 'incubator' && (
            <>
              <span>{t('jurexioIncubator')}</span>
              <ChevronDown className="w-4 h-4 rotate-[-90deg]" />
              <span className="text-foreground font-medium">{t('dashboard')}</span>
            </>
          )}
          {currentPlatform === 'superagent' && (
            <>
              <span>{t('aiSuperAgent')}</span>
              <ChevronDown className="w-4 h-4 rotate-[-90deg]" />
              <span className="text-foreground font-medium">{t('workspace')}</span>
            </>
          )}
        </div>

        {/* Right: Agent Status + Language + Actions */}
        <div className="flex items-center gap-3">
          <div className="hidden lg:flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <span className="text-xs font-semibold text-green-700">{t('agentsActive')}</span>
          </div>

          {/* Language Selector */}
          <Select value={language} onValueChange={(val) => setLanguage(val as SupportedLanguage)}>
            <SelectTrigger 
              className="w-[140px] glass border-border/50 text-foreground"
              data-testid="select-language"
            >
              <div className="flex items-center gap-2">
                {isLoadingTranslations ? (
                  <Loader2 className="w-4 h-4 animate-spin text-primary" data-testid="loader-translations" />
                ) : (
                  <Globe className="w-4 h-4" />
                )}
                <SelectValue />
              </div>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(languageNames) as SupportedLanguage[]).map((lang) => (
                <SelectItem key={lang} value={lang}>
                  {languageNames[lang]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button 
            variant="ghost" 
            size="sm" 
            className="text-foreground-secondary hover:text-foreground hover:bg-primary/10 hidden sm:flex"
            data-testid="button-switch-platform"
            onClick={() => setLocation('/')}
          >
            {t('switchPlatform')}
          </Button>
        </div>
      </div>
    </header>
  );
}
