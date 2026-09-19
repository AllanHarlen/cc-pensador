#!/usr/bin/env node
/**
 * Derives a design system from a brief-derived brand.json with the Open Design brand engine and
 * writes design-systems/<id>/source/* plus resolved/design-contract.json (v2). No LLM writes token
 * values here; extras (components, layouts, iconography, imagery, microcopy, antiPatterns,
 * rationale) are merged as data. Exit 0 = ok, 1 = BLOCKED (OD_BRAND_ENGINE_UNAVAILABLE), 2 = usage.
 *
 *   node od-brand-build.mjs --brand brand.json --dir <featurePath>/design-systems/<id>
 *        [--extras extras.json] [--system-id id] [--brief-ref design-brief.json]
 *        [--seed-origin origins.json] [--engine auto|container|clone] [--container name] [--clone dir]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deriveWithEngine } from './lib/brand-engine.mjs';
import { canonicalJson, mapEngineToContract } from './lib/token-mapper.mjs';

function writeFile(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, 'utf8');
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Seed fields the brief sent explicitly are "brief"; the rest fall back to the engine default. */
export function defaultSeedOrigin(brand, seedOrigin = {}) {
  return { ...Object.fromEntries(Object.keys(brand.seed ?? {}).map((key) => [key, 'brief'])), ...seedOrigin };
}

export function buildBrandSystem({ brand, dir, extras = {}, systemId, briefRef = null, seedOrigin, engine, container, clone, run, env, home, nodeVersion, now = () => new Date().toISOString() }) {
  const systemDir = resolve(dir);
  const id = systemId || brand.slug || basename(systemDir);
  const result = deriveWithEngine({ brand, engine, container, clone, run, env, home, nodeVersion });
  const generatedAt = now();
  const resume = `node od-brand-build.mjs --brand <brand.json> --dir ${systemDir}`;

  if (result.status !== 'ok') {
    const blocked = { schemaVersion: 1, status: 'BLOCKED', reasonCode: result.reasonCode, attempts: result.attempts, remediation: result.remediation, resume, generatedAt };
    writeFile(join(systemDir, 'source', 'engine-run.json'), canonicalJson(blocked));
    return blocked;
  }

  writeFile(join(systemDir, 'source', 'brand.json'), canonicalJson(brand));
  for (const [name, text] of Object.entries(result.files)) writeFile(join(systemDir, 'source', 'engine', name), text.endsWith('\n') ? text : `${text}\n`);

  const contract = mapEngineToContract({
    systemId: id,
    seed: result.seed,
    tokens: result.tokens,
    engine: { version: result.engineInfo.version },
    seedOrigin: defaultSeedOrigin(brand, seedOrigin),
    briefRef,
    fontDisplay: extras.fontDisplay ?? brand.fontDisplay,
    defaultTheme: extras.defaultTheme ?? brand.defaultTheme,
    extras,
  });
  writeFile(join(systemDir, 'resolved', 'design-contract.json'), canonicalJson(contract));

  const run_ = {
    schemaVersion: 1,
    status: 'ok',
    engine: result.engine,
    version: result.engineInfo.version ?? null,
    commit: result.engineInfo.commit ?? null,
    deriveSha256: result.engineInfo.deriveSha256 ?? null,
    attempts: result.attempts,
    contractSha256: contract.sha256,
    generatedAt,
  };
  writeFile(join(systemDir, 'source', 'engine-run.json'), canonicalJson(run_));
  return { status: 'ok', engine: result.engine, version: run_.version, attempts: result.attempts, contractSha256: contract.sha256, contract: join(systemDir, 'resolved', 'design-contract.json') };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    out[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.brand || !args.dir || args.brand === true || args.dir === true) {
    console.error('usage: od-brand-build.mjs --brand <brand.json> --dir <design-systems/<id>> [--extras f] [--system-id id] [--brief-ref f] [--seed-origin f] [--engine auto|container|clone] [--container n] [--clone dir]');
    process.exit(2);
  }
  const result = buildBrandSystem({
    brand: readJson(resolve(args.brand)),
    dir: args.dir,
    extras: args.extras ? readJson(resolve(args.extras)) : {},
    systemId: typeof args['system-id'] === 'string' ? args['system-id'] : undefined,
    briefRef: typeof args['brief-ref'] === 'string' ? args['brief-ref'] : null,
    seedOrigin: args['seed-origin'] ? readJson(resolve(args['seed-origin'])) : undefined,
    engine: typeof args.engine === 'string' ? args.engine : 'auto',
    container: typeof args.container === 'string' ? args.container : undefined,
    clone: typeof args.clone === 'string' ? args.clone : undefined,
  });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === 'ok' ? 0 : 1;
}
