/**
 * Jurexio public API mount vs legacy Jurexio internal mount.
 * Gateway routes stay registered on `/api/jrx/*`; `/api/jrx/*` is rewritten early (alias middleware).
 */
export const NYV_INTERNAL_API_PREFIX = '/api/jrx';
export const JRX_PUBLIC_API_PREFIX = '/api/jrx';
