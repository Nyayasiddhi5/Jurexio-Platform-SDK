/**
 * JrxSkipLink — WCAG 2.1 AA Skip Navigation Component
 * Renders a visually hidden "Skip to main content" link that becomes visible on focus.
 * Must be the first focusable element in the DOM — placed at the top of App.tsx.
 *
 * @file client/src/components/JrxSkipLink.tsx
 */
export function JrxSkipLink() {
  return (
    <a
      href="#main-content"
      className="
        sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2
        focus:z-[9999] focus:px-4 focus:py-2 focus:bg-indigo-700 focus:text-white
        focus:rounded-md focus:text-sm focus:font-semibold focus:shadow-lg
        focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2
      "
      aria-label="Skip to main content"
    >
      Skip to main content
    </a>
  );
}
