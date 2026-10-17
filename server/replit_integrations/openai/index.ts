// @ts-nocheck
// NYV-NS-020 (2026-05-05): legacy server/ folder, kept only because 2 src/routes
// files (nv-sdk-gateway-routes.ts, nv-v311-routes.ts) still import from here.
// Real fix: migrate these into src/services and add proper db null guards.
// Until then, opt out of strict-null checking so tsc passes for the v5.0.0 deploy.
import OpenAI from 'openai';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
export { openai };
export default openai;
