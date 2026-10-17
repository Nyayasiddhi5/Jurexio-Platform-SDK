#!/usr/bin/env bash
python3 -c "import json; print(json.load(open('/home/ubuntu/scripts/data_rds/_export/cases_csv/MANIFEST.json')))" 2>/dev/null | head -c 2000
