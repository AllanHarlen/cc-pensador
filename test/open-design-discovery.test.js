import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildArtifactList,
  planArtifacts,
  openDesignFetchPlan,
  openDesignDeliveryFor,
} from '../scripts/pensador-engine.mjs';
import {
  auditDesignPackage,
  renderComponentsHtml,
  renderDesignPackage,
} from '../scripts/design-package.mjs';

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

describe('Open Design Discovery & Prototyping — Engine Integration', () => {
  it('planArtifacts plans brandAssets when frontend is present with openDesign', () => {
    const stateWithOD = {
      currentStage: 'FINAL',
      consolidated: [
        { id: 'f1', text: 'A responsive React UI with Tailwind and CSS layout frontend' },
        { id: 'b1', text: 'We need a REST API with a database backend' },
      ],
      designSystems: ['agentic'],
    };
    const plan = planArtifacts(stateWithOD);
    expect(plan.brandAssets).toBe(true);
    expect(plan.designSystem).toBe(false);
  });

  it('planArtifacts excludes brandAssets when frontend is absent', () => {
    const backendOnlyState = {
      currentStage: 'FINAL',
      consolidated: [{ id: 'b1', text: 'Worker de fila em Go com banco PostgreSQL backend' }],
      designSystems: ['agentic'],
    };
    const plan = planArtifacts(backendOnlyState);
    expect(plan.brandAssets).toBe(false);
  });

  it('buildArtifactList includes brand-assets in FINAL stage', () => {
    const state = {
      currentStage: 'FINAL',
      featurePath: '.pensador/vitrine-produtos-v1',
      consolidated: [{ id: 'f1', text: 'A responsive React UI frontend layout' }],
      designSystems: ['agentic'],
      artifactMode: 'prd',
    };
    const artifacts = buildArtifactList(state);

    const brandAssets = artifacts.find((a) => a.kind === 'brand-assets');
    expect(brandAssets).toBeDefined();
    expect(brandAssets.role).toBe('brand-assets');
    expect(brandAssets.path).toBe('.pensador/vitrine-produtos-v1/assets/');
    expect(brandAssets.manifest).toBe('.pensador/vitrine-produtos-v1/assets/manifest.json');

    const dsFiles = artifacts.find((a) => a.kind === 'design-system-files');
    expect(dsFiles).toBeDefined();
    expect(dsFiles.path).toBe('.pensador/vitrine-produtos-v1/design-systems/agentic/resolved');
    expect(dsFiles.variant).toBe('resolved');
    expect(dsFiles.authoritative).toBe(true);
  });

  it('openDesignDeliveryFor and openDesignFetchPlan mark components.html and preview/ as required', () => {
    const delivery = openDesignDeliveryFor('prd');
    expect(delivery.brandAssetsDir).toBe('assets/');
    expect(delivery.componentsDoc).toBe('design-systems/<id>/resolved/components.html');

    const plan = openDesignFetchPlan(['agentic'], '.pensador/teste-v1');
    expect(plan).toHaveLength(1);
    const files = plan[0].files;
    
    const componentsFile = files.find((f) => f.source === 'components.html');
    expect(componentsFile).toBeDefined();
    expect(componentsFile.required).toBe(true);

    const previewDir = files.find((f) => f.source === 'preview/');
    expect(previewDir).toBeDefined();
    expect(previewDir.required).toBe(true);
  });
});

describe('Design Package Auditor', () => {
  const tmpDirs = [];
  function makeDir() {
    const d = mkdtempSync(join(tmpdir(), 'od-audit-test-'));
    tmpDirs.push(d);
    return d;
  }
  afterEach(() => {
    for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('renderComponentsHtml generates semantic fixtures with 4 states for each component', () => {
    const contract = {
      systemId: 'test-system',
      components: [
        { name: 'Button', states: ['default', 'hover', 'focus', 'disabled'] },
        { name: 'Card', states: ['default', 'hover', 'focus', 'disabled'] },
      ],
    };
    const html = renderComponentsHtml(contract);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('tokens.css');
    expect(html).toContain('Button');
    expect(html).toContain('state-hover');
    expect(html).toContain('state-focus');
    expect(html).toContain('state-disabled');
    expect(html).toContain('Card');
  });

  it('auditDesignPackage validates assets manifest against real files and hashes', () => {
    const dir = makeDir();
    const assetsDir = join(dir, 'assets');
    mkdirSync(assetsDir, { recursive: true });

    const logoContent = '<svg>Logo</svg>';
    const logoFile = join(assetsDir, 'generated', 'logo.svg');
    mkdirSync(join(assetsDir, 'generated'), { recursive: true });
    writeFileSync(logoFile, logoContent);

    const manifest = {
      schemaVersion: 1,
      decision: 'full-package',
      assets: [
        {
          id: 'brand-logo',
          classification: 'required',
          requirementRefs: ['RF-01'],
          routes: ['/'],
          componentSlot: 'Header.Logo',
          file: 'generated/logo.svg',
          aspectRatio: '1:1',
          alt: 'Logo da Marca',
          materializeInto: 'public/brand/logo.svg',
          seedBindings: ['brand'],
          approval: 'approved',
          sha256: sha256(logoContent),
          generator: { agent: 'agy', model: 'gemini-3.1-pro-high', conversationId: 'c-1' },
        },
      ],
    };
    writeFileSync(join(assetsDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    const contract = {
      systemId: 'test-sys',
      tokens: {
        colors: { primary: '#2563eb', background: '#ffffff', text: '#000000' },
        typography: { fontFamily: 'Inter' },
        spacing: { md: '16px' },
        breakpoints: { sm: '640px' },
        radius: { md: '4px' },
        borders: { default: '1px solid #ccc' },
        elevation: { sm: '0 1px 2px rgba(0,0,0,0.05)' },
        motion: { fast: '150ms' },
      },
      contrastPairs: [{ foreground: '#000000', background: '#ffffff', minimum: 4.5 }],
      components: [{ name: 'Button', states: ['default', 'hover', 'focus', 'disabled'] }],
      iconography: { format: 'vector', package: 'lucide-react', version: '1.0.0' },
    };

    writeFileSync(join(dir, 'tokens.css'), ':root { --colors-primary: #2563eb; }');
    writeFileSync(join(dir, 'design-tokens.json'), '{}');
    writeFileSync(join(dir, 'DESIGN.md'), '# Test');
    writeFileSync(join(dir, 'components.html'), '<html>components</html>');
    mkdirSync(join(dir, 'preview'), { recursive: true });
    writeFileSync(join(dir, 'preview', 'index.html'), '<html>preview</html>');

    const result = auditDesignPackage({ resolvedDir: dir, contract });
    expect(result.findings.filter((f) => f.severity === 'critical')).toEqual([]);
    expect(result.status).toBe('PASS');
  });
});
