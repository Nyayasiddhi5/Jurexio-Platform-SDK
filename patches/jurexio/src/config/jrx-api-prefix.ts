/**
 * Jurexio public API mount vs legacy Nyayavigya internal mount.
 * Gateway routes stay registered on `/api/nv/*`; `/api/jrx/*` is rewritten early (alias middleware).
 */
export const NYV_INTERNAL_API_PREFIX = '/api/nv';
export const JRX_PUBLIC_API_PREFIX = '/api/jrx';
