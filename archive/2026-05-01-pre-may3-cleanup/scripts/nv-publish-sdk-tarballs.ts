#!/usr/bin/env -S npx tsx
/**
 * Build and upload SDK tarballs to S3 for the /downloads/sdk/<pkg>/<ver>.tgz
 * gateway endpoint.
 *
 * Usage:
 *   npx tsx scripts/nv-publish-sdk-tarballs.ts                      # all packages, latest version
 *   npx tsx scripts/nv-publish-sdk-tarballs.ts --package client-sdk
 *   npx tsx scripts/nv-publish-sdk-tarballs.ts --package nyayamitra-sdk --version 1.0.0
 *   npx tsx scripts/nv-publish-sdk-tarballs.ts --dry-run
 *
 * Env:
 *   NYV_SDK_BUCKET           default: nyv-sdk-distribution
 *   NYV_SDK_BUCKET_PREFIX    default: sdk/
 *   NYV_S3_REGION            default: ap-south-1
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY  (or instance role)
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const PACKAGES = ['client-sdk', 'client-sdk-react-native', 'nyayamitra-sdk'] as const;
type Pkg = typeof PACKAGES[number];

interface Args {
  package?: Pkg;
  version?: string;
  dryRun: boolean;
  rebuild: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { dryRun: false, rebuild: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--package') out.package = argv[++i] as Pkg;
    else if (a === '--version') out.version = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--rebuild') out.rebuild = true;
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: npx tsx scripts/nv-publish-sdk-tarballs.ts [--package <name>] [--version <semver>] [--rebuild] [--dry-run]`);
      process.exit(0);
    }
  }
  if (out.package && !PACKAGES.includes(out.package)) {
    console.error(`Unknown package "${out.package}". Allowed: ${PACKAGES.join(', ')}`);
    process.exit(2);
  }
  return out;
}

function pkgDir(pkg: Pkg): string {
  return path.resolve(process.cwd(), 'packages', pkg);
}

function pkgJsonVersion(pkg: Pkg): string {
  const p = path.join(pkgDir(pkg), 'package.json');
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  return String(raw.version);
}

function findExistingTarball(pkg: Pkg, version: string): string | null {
  const dir = pkgDir(pkg);
  if (!fs.existsSync(dir)) return null;
  const candidates = fs.readdirSync(dir).filter((f) => f.endsWith('.tgz'));
  for (const f of candidates) {
    const m = f.match(/-(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\.tgz$/);
    if (m && m[1] === version) return path.join(dir, f);
  }
  return null;
}

function buildTarball(pkg: Pkg): string {
  const dir = pkgDir(pkg);
  console.log(`  > npm pack in ${dir}`);
  const out = execSync('npm pack --silent', { cwd: dir, encoding: 'utf8' }).trim();
  const lines = out.split('\n').filter(Boolean);
  const filename = lines[lines.length - 1].trim();
  return path.join(dir, filename);
}

async function uploadOne(pkg: Pkg, version: string, tarballPath: string, dryRun: boolean): Promise<void> {
  const bucket = process.env.NYV_SDK_BUCKET || 'nyv-sdk-distribution';
  const prefix = (process.env.NYV_SDK_BUCKET_PREFIX || 'sdk/').replace(/^\/+/, '').replace(/\/*$/, '/');
  const key = `${prefix}${pkg}/${version}.tgz`;
  const stat = fs.statSync(tarballPath);
  console.log(`  ${pkg}@${version}`);
  console.log(`    src:    ${tarballPath} (${stat.size} bytes)`);
  console.log(`    dst:    s3://${bucket}/${key}`);
  if (dryRun) {
    console.log(`    [dry-run] skipped upload`);
    return;
  }
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({
    region: process.env.NYV_S3_REGION || 'ap-south-1',
    credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY }
      : undefined,
  });
  const body = fs.readFileSync(tarballPath);
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: 'application/gzip',
    ContentDisposition: `attachment; filename="nyayavigya-${pkg}-${version}.tgz"`,
    Metadata: {
      'nyv-package': pkg,
      'nyv-version': version,
      'nyv-published-at': new Date().toISOString(),
    },
    ServerSideEncryption: 'AES256',
  }));
  console.log(`    ✓ uploaded`);
}

async function updateManifest(dryRun: boolean): Promise<void> {
  const bucket = process.env.NYV_SDK_BUCKET || 'nyv-sdk-distribution';
  const prefix = (process.env.NYV_SDK_BUCKET_PREFIX || 'sdk/').replace(/^\/+/, '').replace(/\/*$/, '/');
  const { S3Client, ListObjectsV2Command, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({
    region: process.env.NYV_S3_REGION || 'ap-south-1',
    credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY }
      : undefined,
  });
  const out: Array<{ package: string; versions: string[]; latest: string }> = [];
  for (const pkg of PACKAGES) {
    const versions: string[] = [];
    let token: string | undefined;
    do {
      const resp: any = await s3.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `${prefix}${pkg}/`,
        ContinuationToken: token,
        MaxKeys: 1000,
      }));
      for (const o of (resp.Contents || [])) {
        const m = (o.Key || '').match(/\/([^/]+)\.tgz$/);
        if (m) versions.push(m[1]);
      }
      token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
    } while (token);
    versions.sort((a, b) => {
      const av = a.split(/[-+]/)[0].split('.').map(Number);
      const bv = b.split(/[-+]/)[0].split('.').map(Number);
      for (let i = 0; i < 3; i++) if ((av[i] || 0) !== (bv[i] || 0)) return (bv[i] || 0) - (av[i] || 0);
      return b.localeCompare(a);
    });
    out.push({ package: pkg, versions, latest: versions[0] || '' });
  }
  const manifest = { bucket, prefix, generated_at: new Date().toISOString(), packages: out };
  console.log(`\nManifest:\n${JSON.stringify(manifest, null, 2)}`);
  if (dryRun) {
    console.log(`  [dry-run] manifest not uploaded`);
    return;
  }
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: `${prefix}manifest.json`,
    Body: JSON.stringify(manifest, null, 2),
    ContentType: 'application/json',
    CacheControl: 'public, max-age=60',
    ServerSideEncryption: 'AES256',
  }));
  console.log(`  ✓ uploaded s3://${bucket}/${prefix}manifest.json`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targets: Pkg[] = args.package ? [args.package] : [...PACKAGES];

  console.log(`Publishing SDK tarballs to s3://${process.env.NYV_SDK_BUCKET || 'nyv-sdk-distribution'}/${process.env.NYV_SDK_BUCKET_PREFIX || 'sdk/'}`);
  console.log(`Packages: ${targets.join(', ')}`);
  console.log(`Mode:     ${args.dryRun ? 'dry-run' : 'live'}\n`);

  for (const pkg of targets) {
    const version = args.version || pkgJsonVersion(pkg);
    let tarball = args.rebuild ? null : findExistingTarball(pkg, version);
    if (!tarball) tarball = buildTarball(pkg);
    await uploadOne(pkg, version, tarball, args.dryRun);
  }

  await updateManifest(args.dryRun);
  console.log('\n✓ Done.');
}

main().catch((err) => {
  console.error('FAILED:', err?.message || err);
  process.exit(1);
});
