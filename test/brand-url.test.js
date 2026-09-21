/** Optional brand-URL path: input validation, the host-clone runner contract and the CLI proposal flow. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { deriveSeedFromUrl, isBrandUrl } from '../scripts/lib/brand-url.mjs';
import { brandUrlCommand, buildCommand, seedCommand } from '../scripts/design-brief.mjs';
import { DESIGN_BRIEF_FIELDS, buildDesignBrief } from '../scripts/pensador-engine.mjs';

const roots = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const tmp = () => {
  const root = mkdtempSync(join(tmpdir(), 'brand-url-'));
  roots.push(root);
  return root;
};

/** A clone whose daemon was built (the compiled engine entry point exists), as the host installer leaves it. */
const builtClone = () => {
  const clone = tmp();
  const engineDir = join(clone, 'apps', 'daemon', 'dist', 'brands', 'engine');
  mkdirSync(engineDir, { recursive: true });
  writeFileSync(join(engineDir, 'build.js'), '');
  return clone;
};

const okRun = (seed) => () => ({ status: 0, stdout: JSON.stringify({ seed, engine: { version: '0.22.1' } }), stderr: '' });

describe('brandUrl', () => {
  it('is a brief field, validated as an http(s) URL', () => {
    expect(DESIGN_BRIEF_FIELDS).toContain('brandUrl');
    const good = buildDesignBrief({ answers: { brandUrl: 'https://stripe.com' } });
    expect(good.fields.brandUrl.value).toBe('https://stripe.com');
    for (const bad of ['stripe.com', 'ftp://stripe.com', 'javascript:alert(1)', 'https://', 'https://a b.com', 42]) {
      expect(buildDesignBrief({ answers: { brandUrl: bad } }).issues, String(bad)).toEqual([{ field: 'brandUrl', reason: 'invalid-value' }]);
    }
  });

  it('isBrandUrl refuses credentials, non-http schemes, single-label hosts and whitespace', () => {
    expect(isBrandUrl('https://www.example.com/path?q=1')).toBe(true);
    for (const bad of ['https://user:pw@example.com', 'file:///etc/passwd', 'http://localhost', 'https://exa mple.com', '', null]) expect(isBrandUrl(bad)).toBe(false);
  });
});

describe('deriveSeedFromUrl', () => {
  it('turns the engine seed into proposals for the primary colour and the font only', () => {
    const clone = builtClone();
    const result = deriveSeedFromUrl({ url: 'https://stripe.com', clone, run: okRun({ colorPrimary: '#533afd', fontFamily: 'sohne-var, sans-serif', borderRadius: 6, colorInfo: '#533afd' }), env: {} });
    expect(result).toMatchObject({ status: 'ok', target: clone, proposals: { colorPrimary: '#533AFD', fontFamily: 'sohne-var, sans-serif' }, engine: { version: '0.22.1' } });
    expect(Object.keys(result.proposals)).toEqual(['colorPrimary', 'fontFamily']);
  });

  it('is UNAVAILABLE (never throws) on a bad URL, an unbuilt clone, runner failure and garbage output', () => {
    expect(deriveSeedFromUrl({ url: 'nope' })).toMatchObject({ status: 'UNAVAILABLE', reasonCode: 'INVALID_URL' });
    const unbuilt = deriveSeedFromUrl({ url: 'https://a.com', clone: join(tmp(), 'none'), run: () => { throw new Error('must not run'); }, env: {} });
    expect(unbuilt).toMatchObject({ status: 'UNAVAILABLE', reasonCode: 'CLONE_NOT_BUILT' });
    expect(unbuilt.message).not.toMatch(/docker/i);
    const failing = () => ({ status: 1, stdout: '', stderr: 'Could not fetch https://a.com' });
    expect(deriveSeedFromUrl({ url: 'https://a.com', clone: builtClone(), run: failing, env: {} })).toMatchObject({ status: 'UNAVAILABLE', reasonCode: 'OD_BRAND_URL_UNAVAILABLE' });
    const garbage = () => ({ status: 0, stdout: 'not json', stderr: '' });
    expect(deriveSeedFromUrl({ url: 'https://a.com', clone: builtClone(), run: garbage, env: {} })).toMatchObject({ status: 'UNAVAILABLE', reasonCode: 'INVALID_OUTPUT' });
  });

  it('honours OD_CLONE_DIR', () => {
    const clone = builtClone();
    const result = deriveSeedFromUrl({ url: 'https://a.com', run: okRun({ colorPrimary: '#533afd' }), env: { OD_CLONE_DIR: clone } });
    expect(result).toMatchObject({ status: 'ok', target: clone });
  });

  it('never runs a shell: the URL travels on stdin, not in the command line', () => {
    let seen;
    deriveSeedFromUrl({ url: 'https://a.com/?x=$(id)', clone: builtClone(), run: (command, args, options) => { seen = { command, args, options }; return { status: 1, stdout: '', stderr: '' }; }, env: {} });
    expect(seen.command).toBe(process.execPath);
    expect(seen.args.join(' ')).not.toContain('a.com');
    expect(JSON.parse(seen.options.input)).toEqual({ url: 'https://a.com/?x=$(id)' });
  });
});

describe('brand-url CLI flow', () => {
  const derive = () => ({ status: 'ok', url: 'https://stripe.com', proposals: { colorPrimary: '#533AFD', fontFamily: 'sohne-var, sans-serif' }, engine: { version: '0.22.1' } });

  it('proposes for unlocked fields; a locked field wins when the seed is built', () => {
    const feature = tmp();
    const dir = join(feature, 'design-systems', 'probe');
    buildCommand({ feature, name: 'Probe', slug: 'probe', answers: { brandUrl: 'https://stripe.com', colorPrimary: '#0F766E', fontFamily: { value: 'Inter, sans-serif', locked: false } } });
    const proposed = brandUrlCommand({ feature, dir, derive });
    expect(proposed).toMatchObject({ status: 'ok', ignoredLocked: ['colorPrimary'] });
    const seeded = seedCommand({ feature, dir, proposals: JSON.parse(readFileSync(join(dir, 'source', 'brand-url.json'), 'utf8')).proposals });
    expect(seeded.seed.colorPrimary).toBe('#0F766E');
    expect(seeded.provenance.colorPrimary).toBe('brief');
    expect(seeded.seed.fontFamily).toBe('sohne-var, sans-serif');
    expect(seeded.provenance.fontFamily).toBe('proposed');
  });

  it('is optional: no URL is REFUSED, an unavailable engine says to continue without it', () => {
    const feature = tmp();
    buildCommand({ feature, name: 'Probe', slug: 'probe', answers: { fontFamily: 'Inter, sans-serif' } });
    expect(brandUrlCommand({ feature, dir: join(feature, 'd'), derive })).toMatchObject({ status: 'REFUSED', issue: 'brand-url-missing' });
    const down = brandUrlCommand({ feature, dir: join(feature, 'd'), url: 'https://stripe.com', derive: () => ({ status: 'UNAVAILABLE', reasonCode: 'CLONE_NOT_BUILT', message: 'engine not built' }) });
    expect(down).toMatchObject({ status: 'UNAVAILABLE', reasonCode: 'CLONE_NOT_BUILT' });
    expect(down.note).toContain('optional');
  });
});
