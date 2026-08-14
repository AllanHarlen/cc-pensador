/**
 * RESEARCH stage — web/market research engine rules.
 *
 * The stage looks OUTWARD (the market) the way EXPLORE looks INWARD (the codebase).
 * These tests pin the deterministic parts the prose layer relies on:
 *   - the stage sits between EXPLORE and PRD_BASE and produces requirements;
 *   - archetype detection is total, accent-insensitive and priority-ordered;
 *   - the query plan is deterministic and BOUNDED (never an unbounded crawl);
 *   - feature tiering puts explicit user decisions above the market signal;
 *   - the Prompt System is always structurally complete (TBD, never missing).
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  STAGE_ORDER,
  REQUIREMENT_STAGES,
  GAP_ORIGINS,
  WEB_RESEARCH,
  PROMPT_SYSTEM_SECTIONS,
  PRODUCT_ARCHETYPES,
  DEFAULT_PRODUCT_ARCHETYPE,
  FEATURE_TIERS,
  TABLE_STAKES_COVERAGE_THRESHOLD,
  detectProductArchetype,
  resolveProductArchetype,
  researchRelevance,
  marketResearchQueryPlan,
  marketResearchSnapshotPath,
  classifyFeatureTier,
  buildResearchPromptSystem,
  withMarketResearch,
  initState,
  addQuestions,
  recordAnswer,
  consolidate,
  buildArtifactList,
} from '../scripts/pensador-engine.mjs';

describe('RESEARCH stage position in the flow', () => {
  it('sits between EXPLORE (inward) and PRD_BASE (deliverable)', () => {
    expect(STAGE_ORDER.indexOf('RESEARCH')).toBe(STAGE_ORDER.indexOf('EXPLORE') + 1);
    expect(STAGE_ORDER.indexOf('RESEARCH')).toBe(STAGE_ORDER.indexOf('PRD_BASE') - 1);
  });

  it('produces requirements (scope decisions the user answers)', () => {
    expect(REQUIREMENT_STAGES).toContain('RESEARCH');
    expect(REQUIREMENT_STAGES[0]).toBe('RESEARCH');
  });

  it('web-research is a gap-resolving origin', () => {
    expect(GAP_ORIGINS).toContain('web-research');
  });

  it('answered RESEARCH questions consolidate as gap-resolving requirements', () => {
    let state = initState('Crie um CRM para a equipe comercial');
    state = { ...state, currentStage: 'RESEARCH' };
    state = addQuestions(state, 'RESEARCH', [
      { id: 'r1', origin: 'web-research', text: 'Incluir timeline unificada de interacoes?' },
    ]);
    state = recordAnswer(state, 'r1', 'Sim, timeline unificada por contato');

    const [req] = consolidate(state);
    expect(req.source).toBe('research');
    expect(req.origin).toBe('web-research');
    expect(req.resolvesGap).toBe(true);
  });
});

describe('WEB_RESEARCH descriptor', () => {
  it('is mandatory, gated on a product surface, and uses the built-in web tools', () => {
    expect(WEB_RESEARCH.mandatory).toBe(true);
    expect(WEB_RESEARCH.relevantWhen).toBe('hasProductSurface');
    expect(WEB_RESEARCH.tools).toEqual({ search: 'WebSearch', fetch: 'WebFetch' });
    expect(WEB_RESEARCH.stage).toBe('RESEARCH');
  });

  it('bounds the research so it can never become an unbounded crawl', () => {
    const b = WEB_RESEARCH.budget;
    expect(b.liteQueries).toBeGreaterThan(0);
    expect(b.completoQueries).toBeGreaterThan(b.liteQueries);
    expect(b.maxFetchPerQuery).toBeGreaterThan(0);
    expect(b.maxCompetitors).toBeGreaterThanOrEqual(b.minCompetitors);
  });

  it('requires corroboration and ranks sources official > comparison > community', () => {
    expect(WEB_RESEARCH.sourceTiers).toEqual(['official', 'comparison', 'community']);
    expect(WEB_RESEARCH.minSourcesPerClaim).toBeGreaterThanOrEqual(2);
  });

  it('carries the non-negotiable content-compliance rules', () => {
    expect(WEB_RESEARCH.compliance).toEqual(
      expect.arrayContaining([
        'cite-source-url',
        'max-30-consecutive-words',
        'paraphrase-not-quote',
        'no-proprietary-assets',
      ]),
    );
  });

  it('names every downstream consumer of the Prompt System', () => {
    expect(WEB_RESEARCH.promptSystemConsumers).toEqual(
      expect.arrayContaining(['prd-base', 'expand', 'context-pack', 'delegation', 'open-design', 'handoff']),
    );
  });
});

describe('PRODUCT_ARCHETYPES registry', () => {
  it('every entry is self-describing and keyed by its own id', () => {
    for (const [key, entry] of Object.entries(PRODUCT_ARCHETYPES)) {
      expect(entry.id).toBe(key);
      expect(typeof entry.label).toBe('string');
      expect(entry.label.length).toBeGreaterThan(0);
      expect(Array.isArray(entry.keywords)).toBe(true);
      expect(Array.isArray(entry.baselineFeatures)).toBe(true);
      expect(entry.researchAngles.length).toBeGreaterThan(0);
    }
  });

  it('covers the categories the Pensador is asked for most', () => {
    expect(Object.keys(PRODUCT_ARCHETYPES)).toEqual(
      expect.arrayContaining([
        'landing-page',
        'institutional-site',
        'ecommerce',
        'marketplace',
        'crm',
        'saas',
        'erp',
        'booking',
        'dashboard',
        'mobile-app',
        'api-service',
        'unknown',
      ]),
    );
  });

  it('every known archetype ships a non-empty table-stakes baseline', () => {
    for (const entry of Object.values(PRODUCT_ARCHETYPES)) {
      if (entry.id === DEFAULT_PRODUCT_ARCHETYPE) continue;
      expect(entry.baselineFeatures.length).toBeGreaterThanOrEqual(6);
    }
  });

  it('the unknown fallback has no keywords (it is never scored)', () => {
    expect(PRODUCT_ARCHETYPES[DEFAULT_PRODUCT_ARCHETYPE].keywords).toEqual([]);
  });
});

describe('detectProductArchetype', () => {
  it.each([
    ['Quero um CRM com pipeline de vendas para o time comercial', 'crm'],
    ['Preciso de uma landing page para captar leads da minha oficina', 'landing-page'],
    ['Montar o site institucional da empresa com paginas de servico', 'institutional-site'],
    ['Uma plataforma SaaS multi-tenant com assinatura mensal', 'saas'],
    ['Loja virtual com carrinho de compras e checkout', 'ecommerce'],
    ['Sistema de agendamento online para a clinica', 'booking'],
    ['Sistema de gestao com controle de estoque e ordem de servico', 'erp'],
    ['Uma api publica rest com webhook para parceiros', 'api-service'],
  ])('classifies %j as %s', (demanda, expected) => {
    expect(detectProductArchetype(demanda).archetype).toBe(expected);
  });

  it('is accent-insensitive and case-insensitive', () => {
    const withAccents = detectProductArchetype('Precisamos de um SITE INSTITUCIONAL da empresa');
    const plain = detectProductArchetype('precisamos de um site institucional da empresa');
    expect(withAccents.archetype).toBe('institutional-site');
    expect(withAccents.archetype).toBe(plain.archetype);
  });

  it('falls back to unknown with score 0 for an unrecognizable demand', () => {
    expect(detectProductArchetype('ajuste o espacamento do rodape')).toEqual({
      archetype: DEFAULT_PRODUCT_ARCHETYPE,
      score: 0,
      matches: [],
    });
  });

  it('returns the matched keywords as evidence for the AskUserQuestion', () => {
    const result = detectProductArchetype('landing page de captura para o meu servico');
    expect(result.matches).toContain('landing page');
    expect(result.score).toBeGreaterThan(0);
  });

  it('is total: never throws for any string input', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const r = detectProductArchetype(text);
        expect(Object.keys(PRODUCT_ARCHETYPES)).toContain(r.archetype);
        expect(r.score).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 200 },
    );
  });

  it('handles nullish input', () => {
    expect(detectProductArchetype(null).archetype).toBe(DEFAULT_PRODUCT_ARCHETYPE);
    expect(detectProductArchetype(undefined).archetype).toBe(DEFAULT_PRODUCT_ARCHETYPE);
  });
});

describe('resolveProductArchetype', () => {
  it('resolves a known key to its entry', () => {
    expect(resolveProductArchetype('saas').id).toBe('saas');
  });

  it('falls back to unknown for an unrecognized/nullish key', () => {
    expect(resolveProductArchetype('turbo').id).toBe(DEFAULT_PRODUCT_ARCHETYPE);
    expect(resolveProductArchetype(null).id).toBe(DEFAULT_PRODUCT_ARCHETYPE);
  });
});

describe('researchRelevance', () => {
  it('skips only when the demand has no product surface', () => {
    const r = researchRelevance({ isInternalOnly: true, archetype: 'saas' });
    expect(r.relevant).toBe(false);
    expect(r.reason.length).toBeGreaterThan(0);
  });

  it('is relevant by default, even for an unrecognized archetype', () => {
    expect(researchRelevance({}).relevant).toBe(true);
    expect(researchRelevance({ archetype: DEFAULT_PRODUCT_ARCHETYPE }).relevant).toBe(true);
  });

  it('goes deep for inherently broad categories', () => {
    expect(researchRelevance({ archetype: 'saas' }).depth).toBe('completo');
    expect(researchRelevance({ archetype: 'crm' }).depth).toBe('completo');
  });

  it('stays lean for contained categories', () => {
    expect(researchRelevance({ archetype: 'landing-page' }).depth).toBe('lite');
  });

  it('broad scope keywords or greenfield escalate a contained category', () => {
    expect(researchRelevance({ archetype: 'landing-page', hasBroadScopeKeywords: true }).depth).toBe('completo');
    expect(researchRelevance({ archetype: 'landing-page', isGreenfield: true }).depth).toBe('completo');
  });
});

describe('marketResearchQueryPlan', () => {
  const base = { demanda: 'CRM para o time comercial', archetype: 'crm', sectorContext: 'oficina automotiva' };

  it('is deterministic: same input → same output', () => {
    expect(marketResearchQueryPlan(base)).toEqual(marketResearchQueryPlan(base));
  });

  it('respects the budget for each depth', () => {
    expect(marketResearchQueryPlan({ ...base, depth: 'lite' }).length).toBeLessThanOrEqual(
      WEB_RESEARCH.budget.liteQueries,
    );
    expect(marketResearchQueryPlan({ ...base, depth: 'completo' }).length).toBeLessThanOrEqual(
      WEB_RESEARCH.budget.completoQueries,
    );
  });

  it('starts with competitor discovery', () => {
    expect(marketResearchQueryPlan(base)[0].kind).toBe('competitor-discovery');
  });

  it('expands the sector into the queries', () => {
    const queries = marketResearchQueryPlan(base).map((q) => q.query).join(' ');
    expect(queries).toContain('oficina automotiva');
  });

  it('covers the cross-cutting angles at completo depth', () => {
    const kinds = marketResearchQueryPlan({ ...base, depth: 'completo' }).map((q) => q.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(['feature-inventory', 'sector-vocabulary', 'pricing-packaging', 'ux-patterns', 'compliance']),
    );
  });

  it('emits unique ids and non-empty queries with a stated purpose', () => {
    const plan = marketResearchQueryPlan({ ...base, depth: 'completo' });
    expect(new Set(plan.map((q) => q.id)).size).toBe(plan.length);
    for (const item of plan) {
      expect(item.query.trim()).not.toBe('');
      expect(item.purpose.length).toBeGreaterThan(0);
    }
  });

  it('still produces a usable plan for the unknown archetype', () => {
    const plan = marketResearchQueryPlan({ demanda: 'algo bem especifico', archetype: 'inexistente' });
    expect(plan.length).toBeGreaterThan(0);
    expect(plan[0].query).toContain('algo bem especifico');
  });

  it('is total: never throws for arbitrary inputs', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (demanda, sectorContext) => {
        const plan = marketResearchQueryPlan({ demanda, sectorContext });
        expect(Array.isArray(plan)).toBe(true);
        expect(plan.length).toBeLessThanOrEqual(WEB_RESEARCH.budget.completoQueries);
      }),
      { numRuns: 150 },
    );
  });
});

describe('marketResearchSnapshotPath', () => {
  it('writes inside the concrete feature dir', () => {
    expect(marketResearchSnapshotPath('.pensador/crm-comercial-v2')).toBe(
      '.pensador/crm-comercial-v2/market-research.md',
    );
  });

  it('falls back like the other working files when featurePath is unset', () => {
    expect(marketResearchSnapshotPath(null)).toBe('.pensador/atualizacao-v1/market-research.md');
  });

  it('is a WORKING file — never a planned artifact', () => {
    const state = {
      ...initState('Crie uma landing page para a oficina'),
      currentStage: 'FINAL',
      consolidated: [{ id: 'r1', source: 'research', text: 'pagina com formulario e layout responsivo' }],
    };
    const filenames = buildArtifactList(state).map((a) => a.filename);
    expect(filenames).not.toContain('market-research.md');
  });
});

describe('classifyFeatureTier', () => {
  it('only exposes the four known tiers', () => {
    expect(FEATURE_TIERS).toEqual(['table-stakes', 'differentiator', 'anti-feature', 'out-of-scope']);
  });

  it('majority competitor coverage makes a feature table-stakes', () => {
    expect(classifyFeatureTier({ competitorCoverage: TABLE_STAKES_COVERAGE_THRESHOLD })).toBe('table-stakes');
    expect(classifyFeatureTier({ competitorCoverage: 1 })).toBe('table-stakes');
  });

  it('low coverage or an explicit user request makes it a differentiator', () => {
    expect(classifyFeatureTier({ competitorCoverage: 0.2 })).toBe('differentiator');
    expect(classifyFeatureTier({ userRequested: true })).toBe('differentiator');
  });

  it('an explicit user decision always beats the market signal', () => {
    expect(classifyFeatureTier({ competitorCoverage: 1, userRejected: true })).toBe('anti-feature');
    expect(classifyFeatureTier({ competitorCoverage: 1, deferred: true })).toBe('out-of-scope');
  });

  it('rejection outranks deferral', () => {
    expect(classifyFeatureTier({ userRejected: true, deferred: true })).toBe('anti-feature');
  });

  it('nothing known → out-of-scope', () => {
    expect(classifyFeatureTier()).toBe('out-of-scope');
    expect(classifyFeatureTier({ competitorCoverage: 0 })).toBe('out-of-scope');
  });

  it('clamps out-of-range and non-numeric coverage', () => {
    expect(classifyFeatureTier({ competitorCoverage: 42 })).toBe('table-stakes');
    expect(classifyFeatureTier({ competitorCoverage: -5 })).toBe('out-of-scope');
    expect(classifyFeatureTier({ competitorCoverage: Number.NaN })).toBe('out-of-scope');
    expect(classifyFeatureTier({ competitorCoverage: 'muito' })).toBe('out-of-scope');
  });

  it('is total: always returns a known tier', () => {
    fc.assert(
      fc.property(
        fc.record({
          competitorCoverage: fc.double({ min: -2, max: 3, noNaN: false }),
          userRejected: fc.boolean(),
          deferred: fc.boolean(),
          userRequested: fc.boolean(),
        }),
        (signals) => {
          expect(FEATURE_TIERS).toContain(classifyFeatureTier(signals));
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('buildResearchPromptSystem', () => {
  it('guarantees structural completeness across all sections', () => {
    const ps = buildResearchPromptSystem();
    expect(Object.keys(ps.sections)).toEqual(PROMPT_SYSTEM_SECTIONS);
    for (const section of PROMPT_SYSTEM_SECTIONS) {
      expect(typeof ps.sections[section]).toBe('string');
      expect(ps.sections[section].length).toBeGreaterThan(0);
    }
  });

  it('marks unresearched sections exactly "TBD"', () => {
    const ps = buildResearchPromptSystem({ archetype: 'crm' });
    expect(ps.sections.competitorFeatures).toBe('TBD');
    expect(ps.sections.openQuestions).toBe('TBD');
  });

  it('never leaves archetype/baseline/business context as TBD when derivable', () => {
    const ps = buildResearchPromptSystem({ demanda: 'CRM para o time comercial', archetype: 'crm' });
    expect(ps.sections.productArchetype).toContain('crm');
    expect(ps.sections.marketBaseline).not.toBe('TBD');
    expect(ps.sections.businessContext).toBe('CRM para o time comercial');
  });

  it('keeps provided prose and ignores blank values', () => {
    const ps = buildResearchPromptSystem({
      archetype: 'saas',
      sections: { competitorFeatures: 'Concorrente A: SSO, auditoria', differentiators: '   ' },
    });
    expect(ps.sections.competitorFeatures).toBe('Concorrente A: SSO, auditoria');
    expect(ps.sections.differentiators).toBe('TBD');
  });

  it('normalizes an unknown archetype', () => {
    expect(buildResearchPromptSystem({ archetype: 'turbo' }).archetype).toBe(DEFAULT_PRODUCT_ARCHETYPE);
  });
});

describe('withMarketResearch', () => {
  const state = initState('Crie um CRM para a equipe comercial');

  it('records archetype, sector and a normalized research payload', () => {
    const next = withMarketResearch(state, {
      status: 'DONE',
      archetype: 'crm',
      sectorContext: 'oficina automotiva',
      competitors: [{ name: 'Pipedrive', url: 'https://www.pipedrive.com' }],
      features: [{ name: 'pipeline kanban', tier: 'table-stakes', competitorCoverage: 1 }],
      sources: ['https://www.pipedrive.com'],
    });

    expect(next.productArchetype).toBe('crm');
    expect(next.sectorContext).toBe('oficina automotiva');
    expect(next.marketResearch.status).toBe('DONE');
    expect(next.marketResearch.competitors).toHaveLength(1);
    expect(next.marketResearch.promptSystem.sections.marketBaseline).not.toBe('TBD');
  });

  it('defaults to PARTIAL for an unknown status and coerces non-arrays', () => {
    const next = withMarketResearch(state, { status: 'MAYBE', competitors: 'nope' });
    expect(next.marketResearch.status).toBe('PARTIAL');
    expect(next.marketResearch.competitors).toEqual([]);
  });

  it('supports SKIPPED for demands with no product surface', () => {
    const next = withMarketResearch(state, { status: 'SKIPPED', notes: 'refactor interno' });
    expect(next.marketResearch.status).toBe('SKIPPED');
    expect(next.marketResearch.notes).toBe('refactor interno');
  });

  it('does not mutate the input state', () => {
    withMarketResearch(state, { status: 'DONE', archetype: 'crm' });
    expect(state.marketResearch).toBeNull();
    expect(state.productArchetype).toBe(DEFAULT_PRODUCT_ARCHETYPE);
  });
});

describe('initState research fields', () => {
  it('starts with no research and the unknown archetype', () => {
    const state = initState('demanda');
    expect(state.productArchetype).toBe(DEFAULT_PRODUCT_ARCHETYPE);
    expect(state.sectorContext).toBeNull();
    expect(state.marketResearch).toBeNull();
  });
});
