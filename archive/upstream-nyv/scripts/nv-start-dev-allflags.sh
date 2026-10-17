#!/bin/bash
# NV-PRE-DEPLOY-SMOKE-001 — start the gateway with ALL Batches A–J feature
# flags ON. Used ONLY by the pre-deploy smoke script to exercise flag-ON
# routes in-process. NOT for production: every flag default OFF is the
# canonical posture.
set -e
export NYV_F_AI_ORCH_KB=1
export NYV_F_AI_ORCH_CONTEXT=1
export NYV_F_AI_ORCH_MULTIMODAL_RAG=1
export NYV_F_AI_ORCH_PLUGINS=1
export NYV_F_AI_ORCH_ROMA=1
export NYV_F_AI_ORCH_AGENT_SELECT=1
export NYV_F_AI_ORCH_PROTOCOLS=1
export NYV_F_MULTIMODAL_AVATAR_UNITY=1
export NYV_F_MULTIMODAL_AVATAR_CHATDOLL=1
export NYV_F_MULTIMODAL_RAG_ADV=1
export NYV_F_MULTIMODAL_3D_IMMERSIVE=1
export NYV_F_MULTIMODAL_AVATAR_3D=1
export NYV_F_VOICE_STREAM_RT=1
export NYV_F_VOICE_SYNTH=1
export NYV_F_VOICE_ENHANCED=1
export NYV_F_WORKFLOW_AUTONOMOUS=1
export NYV_F_WORKFLOW_CONTINUOUS=1
export NYV_F_DOC_AI_CONVERT=1
export NYV_F_GOV_MAKER_CHECKER=1
export NYV_F_GOV_SECURITY_MON=1
export NYV_F_GOV_COST_OPT=1
export NYV_F_GOV_CONCURRENCY=1
export NYV_F_GOV_ORG_RATELIMIT=1
export NYV_F_LEGAL_PIPELINE_CHUNKER=1
export NYV_F_LEGAL_PIPELINE_EMBEDDING=1
export NYV_F_LEGAL_PIPELINE_RERANKER=1
export NYV_F_LEGAL_PIPELINE_SUMMARIZER=1
export NYV_F_LEGAL_PIPELINE_READABILITY=1
export NYV_F_COMPLIANCE_EU_AI_ACT=1
export NYV_F_COMPLIANCE_PQC=1
export NYV_F_COMPLIANCE_FEDERATED_PRIVACY=1
export NYV_F_INTERNAL_SURFACE=1
# Run on a non-canonical port so the workflow's port-5000 gateway is undisturbed.
export NYV_PORT_GATEWAY=5099
exec bash "$(dirname "$0")/jrx-start-dev.sh"
