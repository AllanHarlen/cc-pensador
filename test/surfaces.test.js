/**
 * Unit tests for the "product surfaces" and "ui-data-map + seed plan"
 * sections of pensador-engine.mjs — the root-cause fix for a real run
 * (OficinaAI, 2026-09-16) where a single top-1 archetype match ("erp"/"saas")
 * swallowed a public conversion surface entirely, so its PRD requirements,
 * design direction and imagery policy never got a public-page baseline.
 */
import { describe, it, expect } from 'vitest';
import {
  SURFACE_TYPES,
  ARCHETYPE_SURFACE_TYPE,
  surfaceTypeForArchetype,
  detectProductSurfaces,
  surfaceBenchmarkRequired,
  buildSurfaceBenchmarkPlan,
  withSurfaces,
  PUBLIC_SURFACE_FALLBACK_SECTIONS,
  buildUiDataMapScaffold,
  buildSeedPlanScaffold,
  initState,
} from '../scripts/pensador-engine.mjs';

describe('surfaceTypeForArchetype', () => {
  it('maps landing-page/institutional-site to conversion', () => {
    expect(surfaceTypeForArchetype('landing-page')).toBe('conversion');
    expect(surfaceTypeForArchetype('institutional-site')).toBe('conversion');
  });

  it('maps ecommerce/marketplace to catalog', () => {
    expect(surfaceTypeForArchetype('ecommerce')).toBe('catalog');
    expect(surfaceTypeForArchetype('marketplace')).toBe('catalog');
  });

  it('defaults every other/unknown archetype to operational', () => {
    expect(surfaceTypeForArchetype('erp')).toBe('operational');
    expect(surfaceTypeForArchetype('saas')).toBe('operational');
    expect(surfaceTypeForArchetype('unknown')).toBe('operational');
    expect(surfaceTypeForArchetype(null)).toBe('operational');
    expect(surfaceTypeForArchetype('not-a-real-archetype')).toBe('operational');
  });

  it('SURFACE_TYPES/ARCHETYPE_SURFACE_TYPE are frozen and total', () => {
    expect(Object.isFrozen(ARCHETYPE_SURFACE_TYPE)).toBe(true);
    expect(SURFACE_TYPES).toEqual(['conversion', 'catalog', 'operational', 'transactional']);
  });
});

describe('detectProductSurfaces', () => {
  it('reproduces the real OficinaAI gap: an ERP/SaaS primary demand STILL surfaces its public/transactional secondaries', () => {
    const demanda = 'SaaS multi-tenant de gestao de ordens de servico para oficina mecanica, ' +
      'com site publico por tenant para captacao de leads e area do cliente para aprovacao de orcamento';
    const surfaces = detectProductSurfaces(demanda);
    const types = surfaces.map((s) => s.type).sort();
    expect(types).toEqual(['conversion', 'operational', 'transactional']);
    const operational = surfaces.find((s) => s.type === 'operational');
    expect(operational.primary).toBe(true);
    expect(['saas', 'erp']).toContain(operational.archetype);
    const conversion = surfaces.find((s) => s.type === 'conversion');
    expect(conversion.primary).toBe(false);
    expect(conversion.archetype).toBeNull();
    expect(conversion.matchedKeywords.length).toBeGreaterThan(0);
  });

  it('detects an English-only demand (fixes the old regex bilingual gap)', () => {
    const surfaces = detectProductSurfaces('Build a public storefront with a product gallery');
    expect(surfaces.some((s) => s.type === 'catalog')).toBe(true);
  });

  it('detects a "catalogo/vitrine de X" phrasing beyond the fixed keyword list', () => {
    const surfaces = detectProductSurfaces('Criar area publica com catalogo de pecas e equipamentos');
    const types = surfaces.map((s) => s.type);
    expect(types).toContain('catalog');
    expect(types).toContain('conversion'); // "area publica"
  });

  it('a pure landing-page demand is a single primary conversion surface', () => {
    const surfaces = detectProductSurfaces('Criar uma landing page de captura para um servico de consultoria');
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0]).toMatchObject({ type: 'conversion', archetype: 'landing-page', primary: true });
  });

  it('a backend-only demand with no product surface detects nothing', () => {
    expect(detectProductSurfaces('Corrigir indice composto na tabela de pedidos')).toEqual([]);
  });

  it('is total: empty/null/undefined input never throws and returns []', () => {
    expect(detectProductSurfaces('')).toEqual([]);
    expect(detectProductSurfaces(null)).toEqual([]);
    expect(detectProductSurfaces(undefined)).toEqual([]);
  });
});

describe('surfaceBenchmarkRequired / buildSurfaceBenchmarkPlan', () => {
  it('requires a benchmark for conversion and catalog, not operational/transactional', () => {
    expect(surfaceBenchmarkRequired({ type: 'conversion' })).toBe(true);
    expect(surfaceBenchmarkRequired({ type: 'catalog' })).toBe(true);
    expect(surfaceBenchmarkRequired({ type: 'operational' })).toBe(false);
    expect(surfaceBenchmarkRequired({ type: 'transactional' })).toBe(false);
  });

  it('builds one plan entry per conversion/catalog surface, using the archetype baselineFeatures when the surface WAS the primary match', () => {
    const state = withSurfaces(initState('x'), detectProductSurfaces('Criar uma landing page institucional'));
    const plan = buildSurfaceBenchmarkPlan(state);
    expect(plan).toHaveLength(1);
    expect(plan[0].surfaceType).toBe('conversion');
    expect(plan[0].minReferences).toBe(3);
    expect(plan[0].askForUserReferencesFirst).toBe(true);
    expect(plan[0].baselineSections.length).toBeGreaterThan(0);
  });

  it('falls back to PUBLIC_SURFACE_FALLBACK_SECTIONS when the surface has no winning archetype (secondary-only match)', () => {
    const surfaces = detectProductSurfaces('ERP de gestao com site publico institucional');
    const conversionSurface = surfaces.find((s) => s.type === 'conversion');
    expect(conversionSurface.archetype).toBeNull(); // caught only via SECONDARY_SURFACE_SIGNALS
    const plan = buildSurfaceBenchmarkPlan(withSurfaces(initState('x'), surfaces));
    const entry = plan.find((p) => p.surfaceType === 'conversion');
    expect(entry.baselineSections).toEqual(PUBLIC_SURFACE_FALLBACK_SECTIONS.conversion);
  });

  it('is empty when no surface needs a benchmark', () => {
    expect(buildSurfaceBenchmarkPlan(withSurfaces(initState('x'), [{ type: 'operational', archetype: 'saas', primary: true, score: 1, matchedKeywords: ['saas'] }]))).toEqual([]);
  });
});

describe('buildUiDataMapScaffold', () => {
  it('returns an empty screens list for a backend-only project', () => {
    const state = { ...initState('x'), consolidated: [{ id: 'RF-01', text: 'API REST com banco de dados' }] };
    expect(buildUiDataMapScaffold(state)).toEqual({ schemaVersion: 1, screens: [] });
  });

  it('scaffolds one screen entry per requirement that mentions a screen noun, with dataSource fixed to api-contract', () => {
    const state = {
      ...initState('x'),
      consolidated: [
        { id: 'RF-09', text: 'Painel interno com Kanban de Ordens de Servico' },
        { id: 'RF-17', text: 'Regra de calculo de comissao, processada em background sem interface de usuario' },
        { id: 'RF-11', text: 'Area de Clientes para aprovacao de orcamento' },
      ],
    };
    const scaffold = buildUiDataMapScaffold(state);
    expect(scaffold.schemaVersion).toBe(1);
    expect(scaffold.screens).toHaveLength(2);
    expect(scaffold.screens.map((s) => s.requirementRefs[0])).toEqual(['RF-09', 'RF-11']);
    for (const screen of scaffold.screens) {
      expect(screen.dataSource).toBe('api-contract');
      expect(screen.reads[0].operation).toBe('TBD');
    }
  });

  it('is total: no consolidated requirements never throws', () => {
    expect(() => buildUiDataMapScaffold({ ...initState('x'), consolidated: [] })).not.toThrow();
    expect(() => buildUiDataMapScaffold({})).not.toThrow();
  });
});

describe('buildSeedPlanScaffold', () => {
  it('raises minimumCount to 3 for an entity read as a list, keeps 1 for detail-only', () => {
    const uiDataMap = {
      screens: [
        { id: 's1', entities: ['OrdemServico'], reads: [{ operation: 'GET /os', scope: 'list' }], requirementRefs: ['RF-09'] },
        { id: 's2', entities: ['Cliente'], reads: [{ operation: 'GET /clientes/{id}', scope: 'detail' }], requirementRefs: ['RF-11'] },
      ],
    };
    const plan = buildSeedPlanScaffold(uiDataMap);
    expect(plan.persistenceLayer).toBe('database-seed');
    const os = plan.entities.find((e) => e.entity === 'OrdemServico');
    const cliente = plan.entities.find((e) => e.entity === 'Cliente');
    expect(os.minimumCount).toBe(3);
    expect(cliente.minimumCount).toBe(1);
    expect(os.requirementRefs).toEqual(['RF-09']);
  });

  it('merges requirementRefs across screens sharing the same entity, ignores TBD entities', () => {
    const uiDataMap = {
      screens: [
        { id: 's1', entities: ['TBD'], reads: [], requirementRefs: [] },
        { id: 's2', entities: ['Veiculo'], reads: [{ operation: 'GET /veiculos', scope: 'list' }], requirementRefs: ['RF-20'] },
        { id: 's3', entities: ['Veiculo'], reads: [], writes: [{ operation: 'POST /veiculos' }], requirementRefs: ['RF-21'] },
      ],
    };
    const plan = buildSeedPlanScaffold(uiDataMap);
    expect(plan.entities).toHaveLength(1);
    expect(plan.entities[0].entity).toBe('Veiculo');
    expect(plan.entities[0].requirementRefs.sort()).toEqual(['RF-20', 'RF-21']);
  });

  it('is total: empty/malformed ui-data-map never throws', () => {
    expect(buildSeedPlanScaffold({ screens: [] })).toEqual({ schemaVersion: 1, persistenceLayer: 'database-seed', entities: [] });
    expect(() => buildSeedPlanScaffold({})).not.toThrow();
    expect(() => buildSeedPlanScaffold(null)).not.toThrow();
  });
});
