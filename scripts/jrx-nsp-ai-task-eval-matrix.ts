#!/usr/bin/env tsx
/**
 * NV-NSP-AI-TASK-EVAL-MATRIX-001 — run offline probes listed in fixtures/jrx-nsp-ai-task-eval-matrix.v1.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const FIXTURE = path.resolve(process.cwd(), 'scripts/fixtures/jrx-nsp-ai-task-eval-matrix.v1.json');
const offline = process.argv.includes('--offline');

type Row = { id: string; offlineProbe?: string; liveProbe?: string };
type File = { taskClasses: Row[] };

const data = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as File;
let failed = 0;

for (const row of data.taskClasses) {
  let cmd = offline ? row.offlineProbe : row.liveProbe;
  if (!cmd) {
    console.log(`SKIP ${row.id} (no ${offline ? 'offline' : 'live'} probe)`);
    continue;
  }
  if (offline && (/:ec2\b|partner:smoke:ec2|demo:probe:ec2/.test(cmd))) {
    console.log(`SKIP ${row.id} (offline — EC2 probe deferred to release GO)`);
    continue;
  }
  console.log(`\n--- ${row.id} ---`);
  try {
    execSync(cmd, { stdio: 'inherit', cwd: process.cwd(), env: process.env });
    console.log(`OK ${row.id}`);
  } catch {
    console.error(`FAIL ${row.id}`);
    failed += 1;
  }
}

if (failed) process.exit(1);
console.log(`\nMatrix ${offline ? 'offline' : 'live'}: ${data.taskClasses.length - failed}/${data.taskClasses.length} task classes OK`);
