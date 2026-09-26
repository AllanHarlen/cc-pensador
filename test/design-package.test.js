import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { auditDesignPackage, renderDesignPackage, renderPackageFiles } from '../scripts/design-package.mjs';
import { finalizeContract } from '../scripts/lib/token-mapper.mjs';
import { EXTRAS, fixtureContract } from './helpers/design-fixture.js';

const roots = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function setup(contract = fixtureContract()) {
  const root = mkdtempSync(join(tmpdir(), 'design-package-'));
  roots.push(root);
  const contractFile = join(root, 'contract.json');
  writeFileSync(contractFile, JSON.stringify(contract));
  const resolvedDir = join(root, 'resolved');
  return { root, contractFile, resolvedDir };
}

function tree(dir, prefix = '') {
  return readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? tree(join(dir, name), `${prefix}${name}/`) : [`${prefix}${name}`])).sort();
}

const read = (dir, file) => readFileSync(join(dir, file), 'utf8');

describe('resolved design package (contract v2)', () => {
  it('renders the complete package from the contract and passes the audit', () => {
    const data = setup();
    const audit = renderDesignPackage(data);
    expect(audit.findings).toEqual([]);
    expect(audit.status).toBe('PASS');
    expect(tree(data.resolvedDir)).toEqual(expect.arrayContaining([
      'design-contract.json', 'tokens.css', 'components.css', 'design-tokens.json', 'tailwind-v4.css', 'DESIGN.md', 'components.html', 'components.manifest.json',
      'USAGE.md', 'manifest.json', 'provenance.json', 'design-audit.json', 'assets/manifest.json',
      'preview/index.html', 'preview/colors.html', 'preview/typography.html', 'preview/spacing.html', 'preview/components.html', 'preview/app.html', 'preview/preview.css',
    ]));
    expect(auditDesignPackage({ resolvedDir: data.resolvedDir }).status).toBe('PASS');
  });

  it('is byte-for-byte deterministic', () => {
    const a = setup();
    const b = setup();
    renderDesignPackage(a);
    renderDesignPackage(b);
    const skip = new Set(['design-audit.json']); // carries generatedAt
    for (const file of tree(a.resolvedDir).filter((name) => !skip.has(name))) expect(read(a.resolvedDir, file), file).toBe(read(b.resolvedDir, file));
  });

  it('never copies components or previews from another directory (P5) and ignores a legacy original option', () => {
    const data = setup();
    const original = join(data.root, 'original');
    mkdirSync(join(original, 'preview'), { recursive: true });
    writeFileSync(join(original, 'components.html'), '<button>UPSTREAM</button>');
    writeFileSync(join(original, 'preview', 'index.html'), '<main>UPSTREAM</main>');
    renderDesignPackage({ ...data, originalDir: original });
    expect(read(data.resolvedDir, 'components.html')).not.toContain('UPSTREAM');
    expect(read(data.resolvedDir, 'preview/index.html')).not.toContain('UPSTREAM');
  });

  it('emits tokens.css with the light default, [data-theme="dark"] and prefers-color-scheme (no fallback values)', () => {
    const data = setup();
    renderDesignPackage(data);
    const css = read(data.resolvedDir, 'tokens.css');
    expect(css).toContain(':root,\n[data-theme="light"] {');
    expect(css).toContain('[data-theme="dark"] {');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain(':root:not([data-theme="light"])');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('[data-density="compact"]');
    expect(css).toMatch(/--accent: #0f766e;/);
    expect(css).toMatch(/--accent-on: #ffffff;/);
    expect(css).not.toMatch(/var\([^)]*,/); // no var(--x, fallback)
  });

  it('uses only var(--token) in components and previews (no hex/rgb literal, no var() fallback)', () => {
    const data = setup();
    renderDesignPackage(data);
    for (const file of ['components.css', 'components.html', 'preview/index.html', 'preview/typography.html', 'preview/spacing.html', 'preview/components.html', 'preview/app.html', 'preview/preview.css']) {
      const text = read(data.resolvedDir, file);
      expect(text, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(text, file).not.toMatch(/rgba?\(/);
      expect(text, file).not.toMatch(/var\([^)]*,/);
    }
    expect(read(data.resolvedDir, 'components.html')).toContain('data-theme="dark"');
    expect(read(data.resolvedDir, 'components.html')).toContain('state-focus-visible');
    expect(read(data.resolvedDir, 'preview/app.html')).toContain('Novo cliente');
  });

  it('publishes components.css with product component rules only, never preview scaffolding', () => {
    const data = setup();
    renderDesignPackage(data);
    const css = read(data.resolvedDir, 'components.css');
    for (const selector of ['.btn {', '.btn:focus-visible', '.input {', '.input.state-error', '.field-error', '.card {', '.badge {', '.alert {', '.modal {']) {
      expect(css, selector).toContain(selector);
    }
    // .grid do preview e flex e quebraria o utilitario grid do Tailwind no produto.
    for (const scaffold of ['.grid {', '.page {', '.scope {', '.state {', '.swatch', '.component {', 'body {', '.app {']) {
      expect(css, scaffold).not.toContain(scaffold);
    }
    expect(read(data.resolvedDir, 'preview/preview.css')).toContain(css.slice(css.indexOf('.btn {')));
    const manifest = JSON.parse(read(data.resolvedDir, 'manifest.json'));
    expect(manifest.files.componentsCss).toBe('components.css');
    expect(read(data.resolvedDir, 'USAGE.md')).toContain('@import "./components.css";');
  });

  it('writes design-tokens.json as W3C DTCG with light and dark colors', () => {
    const data = setup();
    renderDesignPackage(data);
    const dtcg = JSON.parse(read(data.resolvedDir, 'design-tokens.json'));
    expect(dtcg.color.light.accent).toEqual({ $value: '#0f766e', $type: 'color' });
    expect(dtcg.color.dark.accent.$type).toBe('color');
    expect(dtcg.color.dark.accent.$value).not.toBe(dtcg.color.light.accent.$value);
    expect(dtcg.fontSize.base).toEqual({ $value: '14px', $type: 'dimension' });
    expect(dtcg.duration.fast.$type).toBe('duration');
    expect(dtcg.easing.standard.$value).toEqual([0.645, 0.045, 0.355, 1]);
    expect(dtcg.font.body.$value[0]).toBe('Inter');
  });

  it('writes tailwind-v4.css with @theme and DESIGN.md with front matter plus the 9 sections', () => {
    const data = setup();
    renderDesignPackage(data);
    const tailwind = read(data.resolvedDir, 'tailwind-v4.css');
    expect(tailwind).toContain('@import "tailwindcss";');
    expect(tailwind).toContain('@theme inline {');
    expect(tailwind).toContain('--color-accent: var(--accent);');
    expect(tailwind).toContain('--spacing: 4px;');
    const design = read(data.resolvedDir, 'DESIGN.md');
    expect(design.startsWith('---\nname: "gestuor"')).toBe(true);
    expect(design).toMatch(/^colors:\n {2}light:\n/m);
    expect(design).toMatch(/^ {4}accent: "#0f766e"$/m);
    for (const [index, title] of ['Visual Theme & Atmosphere', 'Color Palette & Roles', 'Typography Rules', 'Component Stylings', 'Layout Principles', 'Depth & Elevation', "Do's and Don'ts", 'Responsive Behavior', 'Agent Prompt Guide'].entries()) {
      expect(design).toContain(`## ${index + 1}. ${title}`);
    }
    expect(design).toContain('Contrast matrix');
  });

  it('records the contract hash and per-file hashes in provenance.json', () => {
    const data = setup();
    renderDesignPackage(data);
    const contract = JSON.parse(read(data.resolvedDir, 'design-contract.json'));
    const provenance = JSON.parse(read(data.resolvedDir, 'provenance.json'));
    expect(provenance.contractSha256).toBe(contract.sha256);
    expect(provenance.files['tokens.css']).toBe(createHash('sha256').update(read(data.resolvedDir, 'tokens.css')).digest('hex'));
    expect(provenance.briefRef).toBe('design-brief.json');
  });

  it('renderPackageFiles returns exactly what render writes', () => {
    const data = setup();
    renderDesignPackage(data);
    const contract = JSON.parse(read(data.resolvedDir, 'design-contract.json'));
    for (const [name, text] of Object.entries(renderPackageFiles(contract))) expect(read(data.resolvedDir, name), name).toBe(text);
  });

  it('blocks a contract edited after render (hash mismatch)', () => {
    const data = setup();
    renderDesignPackage(data);
    const contract = JSON.parse(read(data.resolvedDir, 'design-contract.json'));
    contract.themes.light['--accent'] = '#ff0000';
    writeFileSync(join(data.resolvedDir, 'design-contract.json'), JSON.stringify(contract));
    const result = auditDesignPackage({ resolvedDir: data.resolvedDir });
    expect(result.status).toBe('BLOCKED');
    expect(result.findings.map((finding) => finding.code)).toContain('CONTRACT_HASH_MISMATCH');
  });

  it('blocks a missing dark theme, an undefined var() reference and a failing contrast pair', () => {
    const noDark = fixtureContract();
    delete noDark.themes.dark;
    expect(() => renderDesignPackage(setup(finalizeContract(noDark)))).toThrow(/themes\.dark/);

    const data = setup();
    renderDesignPackage(data);
    const contract = JSON.parse(read(data.resolvedDir, 'design-contract.json'));
    contract.tokens['--elev-ring'] = '0 0 0 1px var(--nope)';
    contract.themes.light['--muted'] = contract.themes.light['--bg'];
    const result = auditDesignPackage({ resolvedDir: data.resolvedDir, contract: finalizeContract(contract) });
    expect(result.status).toBe('BLOCKED');
    expect(result.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining(['TOKEN_ALIAS_UNDEFINED', 'WCAG_CONTRAST']));
  });

  it('blocks an empty contrast matrix, missing component states and a v1 contract', () => {
    const data = setup();
    renderDesignPackage(data);
    const contract = JSON.parse(read(data.resolvedDir, 'design-contract.json'));
    contract.contrastPairs = [];
    contract.components[0].states = ['default'];
    const result = auditDesignPackage({ resolvedDir: data.resolvedDir, contract: finalizeContract(contract) });
    expect(result.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining(['CONTRAST_MATRIX_MISSING', 'COMPONENT_STATE_MISSING']));

    const legacy = auditDesignPackage({ resolvedDir: data.resolvedDir, contract: { schemaVersion: 1, systemId: 'old' } });
    expect(legacy.status).toBe('BLOCKED');
    expect(legacy.findings[0].code).toBe('CONTRACT_VERSION_UNSUPPORTED');
  });

  it('blocks missing required assets and a seed/demo asset without seed binding', () => {
    const image = Buffer.from('valid-image-fixture');
    const asset = { id: 'hero', purpose: 'content', classification: 'required', requirementRefs: ['RF-001'], routes: ['/'], componentSlot: 'hero.image', file: 'generated/hero.webp', aspectRatio: '16:9', alt: 'Equipe', materializeInto: 'apps/web/public/assets/hero.webp', seedBindings: [], approval: 'approved', sha256: createHash('sha256').update(image).digest('hex'), generator: { agent: 'agy', model: 'pro-high', conversationId: 'c1' } };
    const data = setup(fixtureContract({ extras: { ...EXTRAS, imagery: { decision: 'required-only', assets: [asset] } } }));
    mkdirSync(join(data.resolvedDir, 'assets', 'generated'), { recursive: true });
    writeFileSync(join(data.resolvedDir, 'assets', 'generated', 'hero.webp'), image);
    expect(renderDesignPackage(data).status).toBe('PASS');

    const manifestPath = join(data.resolvedDir, 'assets', 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.assets[0].purpose = 'seed-demo';
    writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(auditDesignPackage({ resolvedDir: data.resolvedDir }).findings.map((finding) => finding.code)).toContain('ASSET_BINDING_INCOMPLETE');

    manifest.assets[0].file = 'generated/missing.webp';
    writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(auditDesignPackage({ resolvedDir: data.resolvedDir }).findings.map((finding) => finding.code)).toContain('REQUIRED_ASSET_MISSING');
    expect(existsSync(join(data.resolvedDir, 'design-audit.json'))).toBe(true);
  });
});
