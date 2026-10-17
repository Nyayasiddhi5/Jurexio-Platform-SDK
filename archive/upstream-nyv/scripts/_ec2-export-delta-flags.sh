#!/usr/bin/env bash
grep -nE 'full.scan|allow.shrink|argparse|add_argument' /home/ubuntu/scripts/data_rds/export_delta_for_rds.py | head -40
grep -n 'from-export\|--from-export' /home/ubuntu/scripts/data_rds/apply_delta_to_rds.sh | head -20
