#!/usr/bin/env bash
head -80 /home/ubuntu/scripts/data_rds/rds_daily_refresh.sh
grep -n 'from-export\|full\|cases_csv\|export_cases' /home/ubuntu/scripts/data_rds/apply_delta_to_rds.sh | head -30
