#!/usr/bin/env bash
# =============================================================================
# rollback-replit-direct.sh — convenience wrapper around
# `deploy-replit-direct.sh --rollback`.  All env overrides apply (see the
# main script's --help).
# =============================================================================
exec bash "$(dirname "$0")/deploy-replit-direct.sh" --rollback "$@"
