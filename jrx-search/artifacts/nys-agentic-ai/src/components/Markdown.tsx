import { useMemo } from "react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

function inline(s: string): string {
  return s
    .replace(
      /\[([^\]]+)\]\((\/[^)\s"]*)\)/g,
      '<a href="$2" data-internal-link="true" class="text-primary font-medium underline underline-offset-2 hover:opacity-80">$1</a>',
    )
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

/**
 * Minimal, dependency-free Markdown → HTML converter.
 * Input is HTML-escaped first, so the output is safe to inject. Supports the
 * subset the agent emits: headings, bold/italic/inline-code, unordered lists,
 * and blockquotes. Shared by streaming views and completed outputs so live and
 * final rendering match.
 */
export function markdownToHtml(md: string): string {
  const esc = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const lines = esc.split("\n");
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  for (const line of lines) {
    if (/^\s*[-*] +/.test(line)) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(line.replace(/^\s*[-*] +/, ""))}</li>`);
      continue;
    }
    closeList();
    if (/^### /.test(line)) out.push(`<h3>${inline(line.slice(4))}</h3>`);
    else if (/^## /.test(line)) out.push(`<h2>${inline(line.slice(3))}</h2>`);
    else if (/^# /.test(line)) out.push(`<h1>${inline(line.slice(2))}</h1>`);
    else if (/^&gt; /.test(line))
      out.push(`<blockquote>${inline(line.slice(5))}</blockquote>`);
    else if (line.trim() === "") out.push("");
    else out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join("\n");
}

/**
 * Render markdown as formatted HTML inside a Tailwind `prose` container.
 * Internal links — [label](/path) — become client-side router navigations
 * (e.g. the statute comparator's reverse view); clicks are intercepted and
 * routed via wouter instead of a full page reload.
 */
export function Markdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const html = useMemo(() => markdownToHtml(content), [content]);
  const [, navigate] = useLocation();
  return (
    <div
      className={cn(
        "prose prose-slate prose-sm max-w-none prose-headings:font-serif",
        className,
      )}
      onClick={(e) => {
        const anchor = (e.target as HTMLElement).closest?.(
          "a[data-internal-link]",
        );
        if (anchor) {
          e.preventDefault();
          const href = anchor.getAttribute("href");
          if (href) navigate(href);
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
