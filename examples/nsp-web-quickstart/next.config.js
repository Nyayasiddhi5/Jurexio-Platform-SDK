/**
 * Quickstart Next.js config.
 *
 * SECURITY NOTE: in this demo we leave `serverActions.allowedOrigins` empty so
 * Next.js falls back to its default same-origin policy. If you deploy this app
 * behind a different domain (or alongside a separate console origin), add the
 * EXPLICIT trusted origins here — never use `['*']` in production, that
 * disables Server Action CSRF protection.
 *
 *   experimental: { serverActions: { allowedOrigins: ['app.example.com'] } }
 */
const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin the workspace root so Next 16/Turbopack stops walking up to the repo
  // root and getting confused by sibling lockfiles.
  turbopack: {
    root: __dirname,
  },
  outputFileTracingRoot: path.join(__dirname),
};

module.exports = nextConfig;
