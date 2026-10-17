import { createRoot } from "react-dom/client";
import { lazy, Suspense } from "react";
import App from "./App";
import "./index.css";
import { ensureConsoleRedirect } from "./lib/jrx-console-routes";

// Task #156 — Stand-alone /sme shell. Branch at the React root so the SME
// workspace gets its OWN Wouter Router (base="/sme") + lean providers and
// is never embedded inside the main /console feature surface.
const SmeApp = lazy(() => import("./sme/SmeApp"));
const isSmeShell = typeof window !== "undefined" &&
  (window.location.pathname.startsWith("/sme") || window.location.pathname.startsWith("/legalchat"));

// Bare console paths (e.g. /document-ai-hub) → /console/document-ai-hub
if (typeof window !== "undefined" && !isSmeShell) {
  const redirect = ensureConsoleRedirect(
    window.location.pathname,
    window.location.search,
  );
  if (redirect) {
    window.location.replace(redirect);
  }
}

import { logError } from "./lib/errorHandler";
import { initializeSentry } from "./lib/sentry";

// Initialize Sentry BEFORE rendering the app
initializeSentry();

// Unregister any existing service workers to clear cache
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
        console.log('✅ Service Worker unregistered successfully');
      }
      // Force page reload to clear all caches
      if (registrations.length > 0) {
        window.location.reload();
      }
    } catch (error) {
      console.error('❌ Service Worker unregistration failed:', error);
    }
  });
}

// Global error handlers to prevent unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  logError(event.reason, 'Unhandled Promise Rejection');
  event.preventDefault(); // Prevents the default browser behavior
});

window.addEventListener('error', (event) => {
  logError(event.error, 'Global JavaScript Error');
});

// Handle WebSocket connection errors gracefully
window.addEventListener('online', () => {
  console.log('🟢 Connection restored');
});

window.addEventListener('offline', () => {
  console.log('🔴 Connection lost');
});

createRoot(document.getElementById("root")!).render(
  isSmeShell
    ? <Suspense fallback={<div style={{
        minHeight: "100vh", display: "flex", alignItems: "center",
        justifyContent: "center", color: "#152448",
        background: "#F9FAFB", fontFamily: "Merriweather, Georgia, serif",
      }}>Loading Jurexio SME workspace…</div>}>
        <SmeApp />
      </Suspense>
    : <App />
);
