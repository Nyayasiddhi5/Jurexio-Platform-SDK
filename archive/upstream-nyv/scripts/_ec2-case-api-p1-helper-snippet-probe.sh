#!/usr/bin/env bash
grep -A2 'acts_json = CASE' /opt/nyv/api/.p1_rds_helper.mjs || echo "no helper"
