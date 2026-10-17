import { useState } from 'react';
import { HelpCircle, X, ExternalLink, Book, MessageCircle, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';

import { nv } from '@/lib/jrx-api-paths';
import { JRX_PLATFORM_LABEL, JRX_PLATFORM_SDK_LABEL } from '@/lib/jrx-registry-stats';
export default function HelpButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-110"
        style={{ background: '#C7B15B', color: '#152448' }}
        title="Help & Support"
      >
        {open ? <X className="h-5 w-5" /> : <HelpCircle className="h-5 w-5" />}
      </button>

      {open && (
        <div
          className="fixed bottom-20 right-6 z-50 w-72 rounded-xl shadow-2xl p-4"
          style={{ background: '#152448', border: '1px solid #2B384C' }}
        >
          <h3 className="text-white font-semibold mb-3" style={{ fontFamily: 'Merriweather, serif' }}>
            Help & Support
          </h3>
          <div className="space-y-2">
            <a
              href={nv('docs')}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 p-3 rounded-lg text-sm transition-colors hover:bg-white/10"
              style={{ color: '#94A3B8' }}
            >
              <Book className="h-4 w-4 text-yellow-400" />
              <span className="text-white">API Documentation</span>
              <ExternalLink className="h-3 w-3 ml-auto" />
            </a>
            <a
              href="mailto:support@nyayavigya.in"
              className="flex items-center gap-3 p-3 rounded-lg text-sm transition-colors hover:bg-white/10"
            >
              <Mail className="h-4 w-4 text-yellow-400" />
              <span className="text-white">Email Support</span>
            </a>
            <div className="flex items-center gap-3 p-3 rounded-lg text-sm" style={{ color: '#64748B' }}>
              <MessageCircle className="h-4 w-4" />
              <span>Chat support coming soon</span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t" style={{ borderColor: '#2B384C' }}>
            <p className="text-xs" style={{ color: '#475569' }}>
              {JRX_PLATFORM_SDK_LABEL} · {JRX_PLATFORM_LABEL}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
