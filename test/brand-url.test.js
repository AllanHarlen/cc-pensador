/** Optional brand-URL path: input validation, the container runner contract and the CLI proposal flow. */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

const okRun = (seed) => (command, args) => {
  if (args[0] === 'ps') return { status: 0, stdout: 'open-design\n', stderr: '' };
  return { status: 0, stdout: JSON.stringify({ seed, engine: { version: '0.22.1' } }), stderr: '' };
};

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
    const result = deriveSeedFromUrl({ url: 'https://stripe.com', run: okRun({ colorPrimary: '#533afd', fontFamily: 'sohne-var, sans-serif', borderRadius: 6, colorInfo: '#533afd' }), env: {} });
    expect(result).toMatchObject({ status: 'ok', proposals: { colorPrimary: '#533AFD', fontFamily: 'sohne-var, sans-serif' }, engine: { version: '0.22.1' } });
    expect(Object.keys(result.proposals)).toEqual(['colorPrimary', 'fontFamily']);
  });

  it('is UNAVAILABLE (never throws) without a container, on a bad URL, on runner failure and on garbage output', () => {
    expect(deriveSeedFromUrl({ url: 'nope' })).toMatchObject({ status: 'UNAVAILABLE', reasonCode: 'INVALID_URL' });
    const noDocker = () => ({ status: null, stdout: '', stderr: '', error: Object.assign(new Error('x'), { code: 'ENOENT' }) });
    expect(deriveSeedFromUrl({ url: 'https://a.com', run: noDocker, env: {} })).toMatchObject({ status: 'UNAVAILABLE', reasonCode: 'DOCKER_MISSING' });
    const failing = (command, args) => (args[0] === 'ps' ? { status: 0, stdout: 'open-design\n', stderr: '' } : { status: 1, stdout: '', stderr: 'Could not fetch https://a.com' });
    expect(deriveSeedFromUrl({ url: 'https://a.com', run: failing, env: {} })).toMatchObject({ status: 'UNAVAILABLE', reasonCode: 'OD_BRAND_URL_UNAVAILABLE' });
    const garbage = (command, args) => (args[0] === 'ps' ? { status: 0, stdout: 'open-design\n', stderr: '' } : { status: 0, stdout: 'not json', stderr: '' });
    expect(deriveSeedFromUrl({ url: 'https://a.com', run: garbage, env: {} })).toMatchObject({ status: 'UNAVAILABLE', reasonCode: 'INVALID_OUTPUT' });
  });

  it('never runs a shell: the URL travels on stdin, not in the command line', () => {
    let seen;
    deriveSeedFromUrl({ url: 'https://a.com/?x=$(id)', container: 'od', run: (command, args, options) => { seen = { command, args, options }; return { status: 1, stdout: '', stderr: '' }; }, env: {} });
    expect(seen.command).toBe('docker');
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
    const down = brandUrlCommand({ feature, dir: join(feature, 'd'), url: 'https://stripe.com', derive: () => ({ status: 'UNAVAILABLE', reasonCode: 'DOCKER_MISSING', message: 'no docker' }) });
    expect(down).toMatchObject({ status: 'UNAVAILABLE', reasonCode: 'DOCKER_MISSING' });
    expect(down.note).toContain('optional');
  });
});
