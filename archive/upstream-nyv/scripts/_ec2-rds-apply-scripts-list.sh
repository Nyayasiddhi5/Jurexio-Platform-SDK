#!/usr/bin/env bash
ls -la /home/ubuntu/scripts/data_rds/*.sh
grep -l 'cases_csv\|from-export\|bulk' /home/ubuntu/scripts/data_rds/*.sh 2>/dev/null || true
head -5 /home/ubuntu/scripts/data_rds/_export/cases_csv/_manifest.json 2>/dev/null || ls /home/ubuntu/scripts/data_rds/_export/cases_csv/ | head
