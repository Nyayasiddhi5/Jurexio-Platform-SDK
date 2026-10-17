/**
 * Voice → text dictation for legal drafting fields (SME request #4).
 * Uses Web Speech API when available; fails soft with a tooltip otherwise.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type SpeechRec = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getSpeechRecognitionCtor(): (new () => SpeechRec) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export interface VoiceDictationTextareaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  rows?: number;
  'data-testid'?: string;
  lang?: string;
}

export function VoiceDictationTextarea({
  value,
  onChange,
  placeholder,
  className,
  rows = 8,
  'data-testid': testId,
  lang = 'en-IN',
}: VoiceDictationTextareaProps) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const recRef = useRef<SpeechRec | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    setSupported(!!getSpeechRecognitionCtor());
    return () => {
      try {
        recRef.current?.stop();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const stop = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setSupported(false);
      setHint('Voice dictation needs Chrome / Edge with microphone permission.');
      return;
    }
    setHint(null);
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;
    rec.onresult = (ev) => {
      let finalChunk = '';
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r?.isFinal && r[0]?.transcript) finalChunk += r[0].transcript;
      }
      if (finalChunk.trim()) {
        const base = valueRef.current.trim();
        onChange(base ? `${base} ${finalChunk.trim()}` : finalChunk.trim());
      }
    };
    rec.onerror = (ev) => {
      setHint(ev.error === 'not-allowed' ? 'Microphone permission denied.' : `Dictation error: ${ev.error || 'unknown'}`);
      setListening(false);
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setHint('Could not start microphone.');
      setListening(false);
    }
  }, [lang, onChange]);

  return (
    <div className="relative space-y-1">
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant={listening ? 'default' : 'outline'}
          className={cn('h-8 px-2', listening && 'bg-[#152448] text-white')}
          onClick={() => (listening ? stop() : start())}
          disabled={!supported && !listening}
          title={supported ? (listening ? 'Stop dictation' : 'Dictate with microphone') : 'Speech recognition not available in this browser'}
          data-testid={testId ? `${testId}-mic` : 'voice-dictation-mic'}
          aria-pressed={listening}
        >
          {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          <span className="ml-1 text-xs">{listening ? 'Stop' : 'Mic'}</span>
        </Button>
      </div>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={cn('pr-24', className)}
        data-testid={testId}
      />
      {hint && <p className="text-xs text-amber-700">{hint}</p>}
      {!supported && !hint && (
        <p className="text-xs text-muted-foreground">Mic dictation requires a Chromium browser with microphone access.</p>
      )}
    </div>
  );
}
