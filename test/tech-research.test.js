/**
 * RESEARCH stage — technical track.
 *
 * This track exists to defeat a specific, silent failure: an LLM's knowledge of a
 * fast-moving ecosystem is frozen at its training cutoff, so a PRD drafted from
 * memory can specify patterns the official docs have already replaced. These tests
 * pin the mechanics that make the anti-staleness guarantee real:
 *   - stack detection works for the identifiers that break naive matching (C#, .NET, Go);
 *   - the registry never carries a version number (that would recreate the bug);
 *   - under-specified stacks become questions instead of guesses;
 *   - version-currency and the front/back cross-cutting angles are BUDGET-PROTECTED;
 *   - pattern adoption gates stale practice out of the PRD.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  TECH_RESEARCH,
  TECH_RESEARCH_DIMENSIONS,
  TECH_STACK_REGISTRY,
  TECH_CATEGORY_ANGLES,
  TECH_CROSS_CUTTING_ANGLES,
  TECH_VERSION_ANGLE,
  SERVER_LANGUAGE_FRAMEWORKS,
  PATTERN_ADOPTION,
  PATTERN_STALENESS_MONTHS,
  PROMPT_SYSTEM_SECTIONS,
  PROMPT_SYSTEM_SECTION_GROUPS,
  WEB_RESEARCH,
  resolveTechEntry,
  detectTechStack,
  inferStackGaps,
  techResearchRelevance,
  techResearchQueryPlan,
  techResearchSnapshotPath,
  classifyPatternAdoption,
  withTechResearch,
  buildResearchPromptSystem,
  initState,
  buildArtifactList,
} from '../scripts/pensador-engine.mjs';

/** The demand from the feature request that motivated this track. */
const LOGIN_DEMAND =
  'Desenvolva uma tela de login com autenticacao e um cadastro de usuario com front-end React e TypeScript e back-end com C#';

describe('two-track RESEARCH stage', () => {
  it('declares both tracks on the business descriptor', () => {
    expect(WEB_RESEARCH.tracks).toEqual(['business', 'technical']);
    expect(WEB_RESEARCH.track).toBe('business');
    expect(TECH_RESEARCH.track).toBe('technical');
    expect(TECH_RESEARCH.stage).toBe('RESEARCH');
  });

  it('each track writes its own working snapshot', () => {
    expect(WEB_RESEARCH.snapshotFile).toBe('market-research.md');
    expect(TECH_RESEARCH.snapshotFile).toBe('tech-research.md');
  });

  it('the technical track is mandatory and names its consumers', () => {
    expect(TECH_RESEARCH.mandatory).toBe(true);
    expect(TECH_RESEARCH.consumers).toEqual(
      expect.arrayContaining(['prd-base', 'arch', 'brainstorm-backend', 'codex', 'handoff']),
    );
  });

  it('inverts the source tiers relative to the business track (vendor IS the authority for a framework)', () => {
    expect(TECH_RESEARCH.sourceTiers[0]).toBe('official-docs');
    expect(TECH_RESEARCH.sourceTiers).toEqual([
      'official-docs',
      'release-notes',
      'reputable-guide',
      'community',
    ]);
    expect(TECH_RESEARCH.requiresOfficialSource).toBe(true);
    // The business track leads with the vendor page too, but under a different name
    // and WITHOUT the official-source requirement — the two are not interchangeable.
    expect(WEB_RESEARCH.sourceTiers).not.toEqual(TECH_RESEARCH.sourceTiers);
  });

  it('covers the ten technical dimensions, including the anti-staleness payload', () => {
    expect(TECH_RESEARCH_DIMENSIONS).toHaveLength(10);
    expect(TECH_RESEARCH_DIMENSIONS).toEqual(
      expect.arrayContaining([
        'stackVersions',
        'projectStructure',
        'architecturePatterns',
        'designPatterns',
        'conventions',
        'securityPatterns',
        'testingStrategy',
        'antiPatterns',
        'officialReferences',
      ]),
    );
  });
});

describe('TECH_STACK_REGISTRY', () => {
  it('every entry is keyed by its own id and fully formed', () => {
    for (const [key, entry] of Object.entries(TECH_STACK_REGISTRY)) {
      expect(entry.id).toBe(key);
      expect(typeof entry.label).toBe('string');
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.keywords.length).toBeGreaterThan(0);
      expect(typeof entry.versionSensitive).toBe('boolean');
    }
  });

  it('NEVER stores a version number — that would recreate the staleness it fights', () => {
    for (const entry of Object.values(TECH_STACK_REGISTRY)) {
      expect(entry).not.toHaveProperty('version');
      expect(entry).not.toHaveProperty('currentVersion');
      expect(entry).not.toHaveProperty('latestVersion');
      // No entry may hardcode a version-looking token in its label either.
      expect(entry.label).not.toMatch(/\b\d+\.\d+/);
    }
  });

  it('every category used by the registry has research angles', () => {
    for (const entry of Object.values(TECH_STACK_REGISTRY)) {
      expect(TECH_CATEGORY_ANGLES[entry.category], `missing angles for ${entry.category}`).toBeDefined();
    }
  });

  it('covers the stack of the motivating request', () => {
    for (const id of ['react', 'typescript', 'csharp', 'dotnet', 'aspnet-identity', 'sqlserver']) {
      expect(TECH_STACK_REGISTRY[id], `${id} missing from registry`).toBeDefined();
    }
  });

  it('declares a specific entry before the broader one that contains it', () => {
    const keys = Object.keys(TECH_STACK_REGISTRY);
    expect(keys.indexOf('nextjs')).toBeLessThan(keys.indexOf('react'));
    expect(keys.indexOf('react-native')).toBeLessThan(keys.indexOf('react'));
  });
});

describe('resolveTechEntry', () => {
  it('resolves a known id', () => {
    expect(resolveTechEntry('dotnet').label).toBe('ASP.NET Core (.NET)');
    expect(resolveTechEntry('dotnet').known).toBe(true);
  });

  it('does not drop an unknown technology — it yields a generic researchable entry', () => {
    const entry = resolveTechEntry('fancy-new-framework');
    expect(entry.known).toBe(false);
    expect(entry.category).toBe('unknown');
    // Assuming a stale version for an unknown framework is the costlier mistake.
    expect(entry.versionSensitive).toBe(true);
  });

  it('is total for nullish input', () => {
    expect(() => resolveTechEntry(null)).not.toThrow();
    expect(resolveTechEntry(null).known).toBe(false);
  });
});

describe('detectTechStack', () => {
  it('detects the full stack of the motivating request', () => {
    const stack = detectTechStack(LOGIN_DEMAND);
    expect(stack.ids).toEqual(expect.arrayContaining(['react', 'typescript', 'csharp']));
    expect(stack.detected).toBe(true);
  });

  it('detects identifiers that break naive matching', () => {
    expect(detectTechStack('back-end com C#').ids).toContain('csharp');
    expect(detectTechStack('API em ASP.NET Core').ids).toContain('dotnet');
    expect(detectTechStack('servico escrito em Go').ids).toContain('go');
  });

  it('avoids the false positives a substring search would produce', () => {
    expect(detectTechStack('vou fazer algo diferente').ids).not.toContain('go');
    expect(detectTechStack('pesquisar no google').ids).not.toContain('go');
    expect(detectTechStack('o valor abc# nao e linguagem').ids).not.toContain('csharp');
    expect(detectTechStack('algo no google com abc# aqui').ids).toEqual([]);
  });

  it('groups by category and by boundary side', () => {
    const stack = detectTechStack('front-end React com back-end ASP.NET Core e PostgreSQL');
    expect(stack.frontend).toContain('react');
    expect(stack.backend).toEqual(expect.arrayContaining(['dotnet', 'postgres']));
    expect(stack.byCategory['frontend-framework']).toContain('react');
  });

  it('counts a server LANGUAGE as the back-end side, so the front/back angles still fire', () => {
    const stack = detectTechStack(LOGIN_DEMAND);
    expect(stack.backend).toContain('csharp');
  });

  it('flags the version-sensitive members of the stack', () => {
    const stack = detectTechStack('React com TypeScript e SQLite');
    expect(stack.versionSensitive).toEqual(expect.arrayContaining(['react', 'typescript']));
    expect(stack.versionSensitive).not.toContain('sqlite');
  });

  it('respects the technology cap', () => {
    const stack = detectTechStack('react vue angular svelte nuxt astro remix typescript python java go', {
      maxTechnologies: 3,
    });
    expect(stack.ids).toHaveLength(3);
  });

  it('returns an empty, non-detected result for a stack-free demand', () => {
    const stack = detectTechStack('ajuste o texto do rodape');
    expect(stack.detected).toBe(false);
    expect(stack.ids).toEqual([]);
  });

  it('is total: never throws for arbitrary input', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const stack = detectTechStack(text);
        expect(Array.isArray(stack.ids)).toBe(true);
        expect(stack.ids.length).toBeLessThanOrEqual(TECH_RESEARCH.budget.maxTechnologies);
      }),
      { numRuns: 200 },
    );
  });
});

describe('inferStackGaps', () => {
  const detected = detectTechStack(LOGIN_DEMAND);
  const gaps = inferStackGaps(detected, LOGIN_DEMAND);
  const kinds = gaps.map((g) => g.kind);

  it('notices that "back end with C#" never named the framework', () => {
    expect(kinds).toContain('backend-framework-missing');
    const gap = gaps.find((g) => g.kind === 'backend-framework-missing');
    expect(gap.candidates).toContain('dotnet');
    expect(gap.question).toContain('C#');
  });

  it('notices that a login demand never chose an auth approach', () => {
    expect(kinds).toContain('auth-approach-missing');
    const gap = gaps.find((g) => g.kind === 'auth-approach-missing');
    // Candidates follow the detected back end rather than a generic list.
    expect(gap.candidates).toContain('aspnet-identity');
  });

  it('notices a back end with no persistence chosen', () => {
    expect(kinds).toContain('database-missing');
  });

  it('every gap carries a ready question with concrete candidates', () => {
    for (const gap of gaps) {
      expect(gap.candidates.length).toBeGreaterThan(0);
      expect(gap.question.length).toBeGreaterThan(20);
      expect(typeof gap.missing).toBe('string');
    }
  });

  it('offers ecosystem-appropriate auth candidates for a Next.js stack', () => {
    const nextStack = detectTechStack('app Next.js com login de usuario');
    const gap = inferStackGaps(nextStack, 'app Next.js com login de usuario').find(
      (g) => g.kind === 'auth-approach-missing',
    );
    expect(gap.candidates).toContain('next-auth');
  });

  it('does not invent an auth gap when the demand has no auth intent', () => {
    const stack = detectTechStack('dashboard em React com ASP.NET Core');
    const found = inferStackGaps(stack, 'dashboard em React com ASP.NET Core').map((g) => g.kind);
    expect(found).not.toContain('auth-approach-missing');
  });

  it('does not report a framework gap when the framework is already named', () => {
    const stack = detectTechStack('back-end em C# com ASP.NET Core');
    const found = inferStackGaps(stack, 'back-end em C# com ASP.NET Core').map((g) => g.kind);
    expect(found).not.toContain('backend-framework-missing');
  });

  it('is total for empty input', () => {
    expect(inferStackGaps()).toEqual([]);
    expect(inferStackGaps({}, '')).toEqual([]);
  });

  it('every server language maps to at least one framework candidate', () => {
    for (const [lang, candidates] of Object.entries(SERVER_LANGUAGE_FRAMEWORKS)) {
      expect(TECH_STACK_REGISTRY[lang], `${lang} not in registry`).toBeDefined();
      expect(candidates.length).toBeGreaterThan(0);
    }
  });
});

describe('techResearchRelevance', () => {
  it('defers to ARCH when no stack can be detected yet', () => {
    const r = techResearchRelevance({ stackDetected: false });
    expect(r.relevant).toBe(true);
    expect(r.deferToArch).toBe(true);
    expect(r.reason).toContain('ARCH');
  });

  it('runs now when the stack is known', () => {
    const r = techResearchRelevance({ stackDetected: true, techCount: 2 });
    expect(r.deferToArch).toBe(false);
    expect(r.depth).toBe('lite');
  });

  it('goes deep for a greenfield or a multi-technology stack', () => {
    expect(techResearchRelevance({ stackDetected: true, techCount: 3 }).depth).toBe('completo');
    expect(techResearchRelevance({ stackDetected: true, techCount: 1, isGreenfield: true }).depth).toBe('completo');
  });

  it('skips only when there is no architectural or implementation impact', () => {
    const r = techResearchRelevance({ isInternalOnly: true });
    expect(r.relevant).toBe(false);
  });

  it('still runs for an internal demand that touches architecture', () => {
    const r = techResearchRelevance({ isInternalOnly: true, touchesArchitecture: true, stackDetected: true });
    expect(r.relevant).toBe(true);
  });
});

describe('techResearchQueryPlan', () => {
  const fullStack = ['react', 'typescript', 'csharp', 'dotnet', 'aspnet-identity', 'sqlserver'];

  it('is deterministic', () => {
    expect(techResearchQueryPlan({ stack: fullStack })).toEqual(techResearchQueryPlan({ stack: fullStack }));
  });

  it('puts a MANDATORY version-currency query first for every version-sensitive technology', () => {
    const plan = techResearchQueryPlan({ stack: ['react', 'dotnet'], depth: 'completo' });
    expect(plan[0].kind).toBe('version-currency');
    expect(plan[1].kind).toBe('version-currency');
    const versionTechs = plan.filter((q) => q.kind === 'version-currency').map((q) => q.tech);
    expect(versionTechs).toEqual(['react', 'dotnet']);
  });

  it('omits the version query for a technology that is not version-sensitive', () => {
    const plan = techResearchQueryPlan({ stack: ['sqlite'], depth: 'completo' });
    expect(plan.some((q) => q.kind === 'version-currency')).toBe(false);
  });

  it('keeps the total within the budget for a realistic stack', () => {
    // 3 technologies is the threshold at which techResearchRelevance switches to completo.
    expect(techResearchQueryPlan({ stack: ['react', 'dotnet'], depth: 'lite' }).length).toBeLessThanOrEqual(
      TECH_RESEARCH.budget.liteQueries,
    );
    expect(techResearchQueryPlan({ stack: fullStack, depth: 'completo' }).length).toBeLessThanOrEqual(
      TECH_RESEARCH.budget.completoQueries,
    );
  });

  it('the budget governs the pattern queries — mandatory phases are never dropped', () => {
    // A large stack at lite depth is an incoherent combination the real flow never
    // produces (relevance returns completo from 3 technologies up). When forced, the
    // mandatory phases survive and the pattern phase is what collapses to zero —
    // silently skipping a version check would reintroduce the staleness bug.
    const plan = techResearchQueryPlan({ stack: fullStack, depth: 'lite' });
    const versions = plan.filter((q) => q.kind === 'version-currency');
    const patterns = plan.filter((q) => q.kind === 'stack-patterns');
    expect(versions).toHaveLength(5); // every version-sensitive member of the stack
    expect(patterns).toHaveLength(0);
    expect(plan.filter((q) => q.tech === null).length).toBeGreaterThan(0);
  });

  it('PROTECTS the cross-cutting angles from truncation — even at lite depth', () => {
    const lite = techResearchQueryPlan({ stack: fullStack, depth: 'lite' }).map((q) => q.kind);
    expect(lite).toContain('integration-contract');
    expect(lite).toContain('auth-flow');
    const completo = techResearchQueryPlan({ stack: fullStack, depth: 'completo' }).map((q) => q.kind);
    expect(completo).toContain('integration-contract');
    expect(completo).toContain('auth-flow');
    expect(completo).toContain('project-conventions');
  });

  it('spreads pattern queries round-robin instead of spending the budget on the first technology', () => {
    const patterns = techResearchQueryPlan({ stack: fullStack, depth: 'completo' }).filter(
      (q) => q.kind === 'stack-patterns',
    );
    const firstRound = patterns.slice(0, 6).map((q) => q.tech);
    // One query per technology before any technology gets a second one.
    expect(new Set(firstRound).size).toBe(firstRound.length);
    // The back end is not starved.
    expect(patterns.map((q) => q.tech)).toContain('dotnet');
  });

  it('prefers the concrete framework over the bare language in the boundary queries', () => {
    const cross = techResearchQueryPlan({ stack: fullStack, depth: 'completo' }).find(
      (q) => q.kind === 'integration-contract',
    );
    expect(cross.query).toContain('asp.net core');
    expect(cross.query).toContain('react');
  });

  it('still fires the boundary queries when only the server LANGUAGE is known', () => {
    const plan = techResearchQueryPlan({ stack: ['react', 'csharp'], depth: 'completo' }).map((q) => q.kind);
    expect(plan).toContain('integration-contract');
    expect(plan).toContain('auth-flow');
  });

  it('omits boundary queries when one side of the boundary is absent', () => {
    const frontOnly = techResearchQueryPlan({ stack: ['react', 'tailwind'], depth: 'completo' }).map((q) => q.kind);
    expect(frontOnly).not.toContain('integration-contract');
    expect(frontOnly).not.toContain('auth-flow');
    // The stack-agnostic conventions angle still applies.
    expect(frontOnly).toContain('project-conventions');
  });

  it('researches an unknown technology with the generic angles', () => {
    const plan = techResearchQueryPlan({ stack: ['fancy-new-framework'], depth: 'completo' });
    expect(plan.length).toBeGreaterThan(0);
    expect(plan[0].kind).toBe('version-currency');
    expect(plan.some((q) => q.query.includes('fancy-new-framework'))).toBe(true);
  });

  it('emits unique ids, non-empty queries and a stated purpose', () => {
    const plan = techResearchQueryPlan({ stack: fullStack, depth: 'completo' });
    expect(new Set(plan.map((q) => q.id)).size).toBe(plan.length);
    for (const item of plan) {
      expect(item.query.trim()).not.toBe('');
      expect(item.purpose.length).toBeGreaterThan(0);
    }
  });

  it('carries the official docs URL for known technologies', () => {
    const plan = techResearchQueryPlan({ stack: ['react'], depth: 'completo' });
    expect(plan[0].docsUrl).toBe('https://react.dev');
  });

  it('handles an empty stack without throwing', () => {
    expect(techResearchQueryPlan({ stack: [] }).length).toBeLessThanOrEqual(
      TECH_RESEARCH.budget.completoQueries,
    );
    expect(() => techResearchQueryPlan()).not.toThrow();
  });

  it('is total for arbitrary stack input', () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { maxLength: 12 }), (stack) => {
        const plan = techResearchQueryPlan({ stack });
        // Bounded by construction: at most maxTechnologies × (1 version + maxAngles)
        // plus the fixed cross-cutting set.
        const ceiling =
          TECH_RESEARCH.budget.maxTechnologies * (1 + TECH_RESEARCH.budget.maxAnglesPerTech) +
          TECH_CROSS_CUTTING_ANGLES.length;
        expect(plan.length).toBeLessThanOrEqual(ceiling);
        expect(new Set(plan.map((q) => q.id)).size).toBe(plan.length);
      }),
      { numRuns: 150 },
    );
  });

  it('the version angle template targets currency, not features', () => {
    expect(TECH_VERSION_ANGLE).toContain('{{tech}}');
    expect(TECH_VERSION_ANGLE).toMatch(/version/i);
  });

  it('every cross-cutting angle declares a kind and a purpose', () => {
    for (const angle of TECH_CROSS_CUTTING_ANGLES) {
      expect(angle.kind.length).toBeGreaterThan(0);
      expect(angle.purpose.length).toBeGreaterThan(0);
      expect(angle.template).toMatch(/\{\{(frontend|backend|primary)\}\}/);
    }
  });
});

describe('techResearchSnapshotPath', () => {
  it('writes inside the feature dir', () => {
    expect(techResearchSnapshotPath('.pensador/login-v1')).toBe('.pensador/login-v1/tech-research.md');
  });

  it('falls back like the other working files', () => {
    expect(techResearchSnapshotPath(null)).toBe('.pensador/atualizacao-v1/tech-research.md');
  });

  it('is a WORKING file — never a planned artifact', () => {
    const state = {
      ...initState(LOGIN_DEMAND),
      currentStage: 'FINAL',
      consolidated: [{ id: 'r1', source: 'research', text: 'tela de login com api de autenticacao' }],
    };
    expect(buildArtifactList(state).map((a) => a.filename)).not.toContain('tech-research.md');
  });
});

describe('classifyPatternAdoption', () => {
  it('exposes exactly the four adoption levels', () => {
    expect(PATTERN_ADOPTION).toEqual(['current', 'experimental', 'legacy', 'deprecated']);
  });

  it('official docs + recent evidence → current', () => {
    expect(classifyPatternAdoption({ inOfficialDocs: true, sourceAgeMonths: 2 })).toBe('current');
    expect(classifyPatternAdoption({ inOfficialDocs: true, sourceAgeMonths: PATTERN_STALENESS_MONTHS })).toBe('current');
  });

  it('a documented replacement or an explicit discouragement → deprecated', () => {
    expect(classifyPatternAdoption({ inOfficialDocs: true, sourceAgeMonths: 1, replacedBy: 'Server Actions' })).toBe('deprecated');
    expect(classifyPatternAdoption({ inOfficialDocs: true, sourceAgeMonths: 1, discouraged: true })).toBe('deprecated');
  });

  it('deprecation outranks the experimental flag', () => {
    expect(classifyPatternAdoption({ discouraged: true, experimental: true, inOfficialDocs: true })).toBe('deprecated');
  });

  it('preview/RFC status → experimental', () => {
    expect(classifyPatternAdoption({ experimental: true, inOfficialDocs: true, sourceAgeMonths: 1 })).toBe('experimental');
  });

  it('official but stale, or unofficial → legacy', () => {
    expect(classifyPatternAdoption({ inOfficialDocs: true, sourceAgeMonths: PATTERN_STALENESS_MONTHS + 1 })).toBe('legacy');
    expect(classifyPatternAdoption({ inOfficialDocs: false, sourceAgeMonths: 1 })).toBe('legacy');
  });

  it('no evidence at all → legacy, never current', () => {
    expect(classifyPatternAdoption()).toBe('legacy');
    expect(classifyPatternAdoption({})).toBe('legacy');
  });

  it('treats a blank replacedBy as no replacement', () => {
    expect(classifyPatternAdoption({ inOfficialDocs: true, sourceAgeMonths: 1, replacedBy: '   ' })).toBe('current');
  });

  it('sanitizes non-numeric and negative ages', () => {
    expect(classifyPatternAdoption({ inOfficialDocs: true, sourceAgeMonths: Number.NaN })).toBe('legacy');
    expect(classifyPatternAdoption({ inOfficialDocs: true, sourceAgeMonths: -5 })).toBe('current');
  });

  it('is total: always returns a known level', () => {
    fc.assert(
      fc.property(
        fc.record({
          discouraged: fc.boolean(),
          experimental: fc.boolean(),
          inOfficialDocs: fc.boolean(),
          sourceAgeMonths: fc.double({ min: -10, max: 200, noNaN: false }),
          replacedBy: fc.oneof(fc.constant(null), fc.string()),
        }),
        (signals) => {
          expect(PATTERN_ADOPTION).toContain(classifyPatternAdoption(signals));
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('Prompt System spans both tracks', () => {
  it('groups the sections by track without losing any', () => {
    const grouped = [
      ...PROMPT_SYSTEM_SECTION_GROUPS.business,
      ...PROMPT_SYSTEM_SECTION_GROUPS.technical,
      'openQuestions',
    ];
    expect([...PROMPT_SYSTEM_SECTIONS].sort()).toEqual([...grouped].sort());
  });

  it('the groups do not overlap', () => {
    const overlap = PROMPT_SYSTEM_SECTION_GROUPS.business.filter((s) =>
      PROMPT_SYSTEM_SECTION_GROUPS.technical.includes(s),
    );
    expect(overlap).toEqual([]);
  });

  it('carries the technical sections the engineering lenses need', () => {
    expect(PROMPT_SYSTEM_SECTION_GROUPS.technical).toEqual([
      'techStack',
      'architectureBaseline',
      'designPatterns',
      'codingConventions',
      'securityBaseline',
      'testingBaseline',
      'technicalAntiPatterns',
    ]);
  });

  it('derives techStack from the detected stack but leaves the VERSION to be researched', () => {
    const ps = buildResearchPromptSystem({ demanda: LOGIN_DEMAND, stack: ['react', 'csharp'] });
    expect(ps.stack).toEqual(['react', 'csharp']);
    expect(ps.sections.techStack).toContain('React');
    expect(ps.sections.techStack).toContain('C#');
    // The version is never asserted from memory.
    expect(ps.sections.techStack).toContain('TBD');
  });

  it('leaves the researched technical sections as TBD until the track runs', () => {
    const ps = buildResearchPromptSystem({ demanda: LOGIN_DEMAND, stack: ['react'] });
    expect(ps.sections.architectureBaseline).toBe('TBD');
    expect(ps.sections.technicalAntiPatterns).toBe('TBD');
  });

  it('keeps every section present even with no input at all', () => {
    const ps = buildResearchPromptSystem();
    expect(Object.keys(ps.sections)).toEqual(PROMPT_SYSTEM_SECTIONS);
    expect(ps.stack).toEqual([]);
  });
});

describe('withTechResearch', () => {
  const state = initState(LOGIN_DEMAND);

  it('records the stack, researched versions and tiered patterns', () => {
    const next = withTechResearch(state, {
      status: 'DONE',
      stack: ['react', 'dotnet'],
      versions: { react: '19.x', dotnet: '10.x' },
      patterns: [{ name: 'minimal APIs', adoption: 'current', sources: ['https://learn.microsoft.com/aspnet/core/'] }],
      antiPatterns: [{ name: 'class components', adoption: 'deprecated', replacedBy: 'function components + hooks' }],
      sources: ['https://react.dev'],
    });

    expect(next.techStack).toEqual(['react', 'dotnet']);
    expect(next.techResearch.status).toBe('DONE');
    expect(next.techResearch.versions.react).toBe('19.x');
    expect(next.techResearch.antiPatterns[0].adoption).toBe('deprecated');
  });

  it('supports DEFERRED for the ARCH top-up', () => {
    const next = withTechResearch(state, { status: 'DEFERRED', notes: 'stack definida no ARCH' });
    expect(next.techResearch.status).toBe('DEFERRED');
    expect(next.techStack).toEqual([]);
  });

  it('defaults to PARTIAL on an unknown status and coerces bad shapes', () => {
    const next = withTechResearch(state, { status: 'TALVEZ', patterns: 'nope', versions: 'nope' });
    expect(next.techResearch.status).toBe('PARTIAL');
    expect(next.techResearch.patterns).toEqual([]);
    expect(next.techResearch.versions).toEqual({});
  });

  it('normalizes stack ids through the registry', () => {
    expect(withTechResearch(state, { stack: ['DotNet', 'react'] }).techStack).toEqual(['dotnet', 'react']);
  });

  it('does not mutate the input state', () => {
    withTechResearch(state, { status: 'DONE', stack: ['react'] });
    expect(state.techResearch).toBeNull();
    expect(state.techStack).toEqual([]);
  });
});

describe('initState technical fields', () => {
  it('starts with no stack and no technical research', () => {
    const state = initState('demanda');
    expect(state.techStack).toEqual([]);
    expect(state.techResearch).toBeNull();
  });
});
