#!/usr/bin/env bash
set -uo pipefail
/home/ubuntu/scripts/case_api/.venv/bin/pip list 2>/dev/null | grep -i ecourt || echo no_ecourts_pip
ls /home/ubuntu/scripts/data_rds 2>/dev/null | head -10
find /home/ubuntu/scripts/data_rds -maxdepth 2 -name 'ecourt*.py' 2>/dev/null | head -5
python3 -c "import sys; print(sys.path[:3])" 2>/dev/null
echo DONE
