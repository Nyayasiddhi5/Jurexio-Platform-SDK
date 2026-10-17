#!/usr/bin/env bash
echo "PC1_ECHO=5150"
echo "=== Q2_FIELD_POPULATION + Q3 head ==="
awk '/### Q2_FIELD_POPULATION/,/### Q3_PDFLINK_SHAPES/' /tmp/nys_caselaw_inv.log
echo "=== Q3 (india tiers only) ==="
awk '/### Q3_PDFLINK_SHAPES/,/### Q4_CACHE/' /tmp/nys_caselaw_inv.log | head -60
