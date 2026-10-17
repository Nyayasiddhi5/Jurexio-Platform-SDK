#!/usr/bin/env bash
head -60 /home/ubuntu/scripts/data_rds/export_cases_for_rds.py
grep -nE 'outdir|_export|argparse|def main' /home/ubuntu/scripts/data_rds/export_cases_for_rds.py | head -30
