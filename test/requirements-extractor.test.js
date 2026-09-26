/**
 * Unit tests for scripts/lib/requirements-extractor.mjs.
 *
 * This module is the raw material for the Orchestrador's RF/CA coverage
 * gate — the deterministic check that closes the audit's central finding:
 * "the Orchestrador is obliged to satisfy every acceptance criterion" had no
 * code enforcing it. These tests cover the positive path (a well-formed PRD
 * section 6/14 parses cleanly, including against the REAL template file so
 * a template edit that breaks the table shape is caught here) and the
 * negative path (missing sections, malformed rows, dangling CA->RF
 * references — each degrading with a warning, never throwing).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { extractRequirements, buildRequirementsIndex, expandRequirementReferences } from '../scripts/lib/requirements-extractor.mjs';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const TEMPLATE_PATH = join(REPO_ROOT, 'skills/pensador/assets/prd-template.md');

/** A minimal, well-formed PRD fragment with real (non-placeholder) content. */
const REALISTIC_PRD = `
# PRD — Reservas corporativas

## 6. Requisitos Funcionais

> Instrução: lista de funcionalidades.

| ID | Requisito | Prioridade |
|----|-----------|-----------|
| RF-01 | O sistema DEVE permitir que um administrador crie uma reserva de veiculo. | Must |
| RF-02 | O sistema DEVE impedir reservas sem centro de custo valido. | Must |
| RF-03 | O sistema DEVE notificar o solicitante por e-mail quando a reserva for aprovada. | Should |

---

## 7. Requisitos Não-Funcionais

| ID | Categoria | Requisito |
|----|-----------|-----------|
| RNF-01 | Desempenho | API com p95 < 500 ms para leituras paginadas. |
| RNF-02 | Segurança | Isolamento por tenant com RLS fail-closed. |

---

## 14. Critérios de Aceite

> Instrução: condições verificáveis por requisito.

| ID | RF | Critério |
|----|----|----------|
| CA-01 | RF-01 | DADO um admin autenticado, QUANDO ele submete o formulario de reserva, ENTÃO a reserva e criada com status pendente. |
| CA-02 | RF-02 | DADO um formulario sem centro de custo, QUANDO o admin tenta salvar, ENTÃO o sistema rejeita com erro de validacao. |
| CA-03 | RF-02 | DADO um centro de custo invalido, QUANDO o admin tenta salvar, ENTÃO o sistema rejeita com erro de validacao. |
| CA-04 | RF-03 | DADO uma reserva aprovada, QUANDO a aprovacao e confirmada, ENTÃO o solicitante recebe um e-mail. |

---

## 15. Arquitetura

### Padrões de Arquitetura & Design

| Padrão | Adoção | Aplicado em | Fonte oficial |
|---|---|---|---|
| Repository + UnitOfWork | current | Infrastructure | https://learn.microsoft.com/ef/core |
| CQRS leve por casos de uso | experimental | Application | https://martinfowler.com/bliki/CQRS.html |

### Anti-padrões Técnicos (desencorajados pelo ecossistema)

| Anti-padrão | Substituído por | Fonte oficial |
|---|---|---|
| Active Record | Repository + UnitOfWork | https://learn.microsoft.com/ef/core |
`;

describe('extractRequirements — positive path', () => {
  it('extracts every RF row with id/text/priority', () => {
    const result = extractRequirements(REALISTIC_PRD);
    expect(result.requirements).toEqual([
      { id: 'RF-01', text: 'O sistema DEVE permitir que um administrador crie uma reserva de veiculo.', priority: 'Must' },
      { id: 'RF-02', text: 'O sistema DEVE impedir reservas sem centro de custo valido.', priority: 'Must' },
      { id: 'RF-03', text: 'O sistema DEVE notificar o solicitante por e-mail quando a reserva for aprovada.', priority: 'Should' },
    ]);
  });

  it('extracts every CA row with the RF link preserved, including multiple CAs per RF', () => {
    const result = extractRequirements(REALISTIC_PRD);
    expect(result.acceptanceCriteria).toHaveLength(4);
    expect(result.acceptanceCriteria.filter((ca) => ca.requirementId === 'RF-02')).toHaveLength(2);
    expect(result.acceptanceCriteria[0]).toEqual({
      id: 'CA-01',
      requirementId: 'RF-01',
      requirementIds: ['RF-01'],
      criterion: 'DADO um admin autenticado, QUANDO ele submete o formulario de reserva, ENTÃO a reserva e criada com status pendente.',
    });
  });

  it('produces no warnings for a well-formed PRD with no dangling references', () => {
    expect(extractRequirements(REALISTIC_PRD).warnings).toEqual([]);
  });

  it('does not pick up rows from unrelated sections (RNF has no RF-XX rows to leak)', () => {
    const result = extractRequirements(REALISTIC_PRD);
    expect(result.requirements.every((r) => /^RF-\d+$/.test(r.id))).toBe(true);
  });

  it('buildRequirementsIndex is the same extraction (alias for the FINAL-stage call site)', () => {
    expect(buildRequirementsIndex(REALISTIC_PRD)).toEqual(extractRequirements(REALISTIC_PRD));
  });

  it('parses the REAL prd-template.md placeholders (RF-01/RF-02, CA-01/CA-02) without the RF-N/CA-N template row', () => {
    const templateText = readFileSync(TEMPLATE_PATH, 'utf8');
    const result = extractRequirements(templateText);
    expect(result.requirements.map((r) => r.id)).toEqual(['RF-01', 'RF-02']);
    expect(result.acceptanceCriteria.map((ca) => ca.id)).toEqual(['CA-01', 'CA-02']);
    // The template's own placeholder rows (RF-N / CA-N) must never be treated as real requirements.
    expect(result.requirements.some((r) => r.id === 'RF-N')).toBe(false);
    expect(result.acceptanceCriteria.some((ca) => ca.id === 'CA-N')).toBe(false);
  });

  it('is heading-level agnostic (matches "## 6. Requisitos Funcionais" or a bare "# Requisitos Funcionais")', () => {
    const bareHeading = REALISTIC_PRD.replace('## 6. Requisitos Funcionais', '# Requisitos Funcionais');
    const result = extractRequirements(bareHeading);
    expect(result.requirements.length).toBeGreaterThan(0);
  });

  it('parses domain-qualified bullet requirements and a CA linked to multiple RFs', () => {
    const bulletPrd = `
## 6. Requisitos Funcionais

### Autenticacao & Multi-tenancy
- **RF-AUTH-01**: O sistema DEVE autenticar o operador da plataforma.
- **RF-AUTH-02**: O sistema DEVE provisionar o primeiro tenant.
- **RF-OS-02**: O sistema DEVE registrar uma ordem.
- **RF-OS-02a**: O sistema DEVE registrar uma variante complementar da ordem.

### Area publica
- **RF-PUB-01**: O sistema DEVE exibir servicos com imagem.

## 14. Criterios de Aceite
- **CA-01** (RF-AUTH-01/02): DADO um operador autenticado, QUANDO cria o tenant, ENTAO o Admin inicial recebe acesso.
- **CA-02** (RF-PUB-01): DADO o catalogo, QUANDO abre a vitrine, ENTAO uma imagem real aparece.
- **CA-03** (RF-OS-02/02a): DADO uma ordem, QUANDO a variante e usada, ENTAO ambas as regras sao rastreadas.

## 7. Requisitos Não-Funcionais
| ID | Categoria | Requisito |
|----|-----------|-----------|
| RNF-01 | Disponibilidade | Uptime >= 99.9%. |

## 15. Arquitetura
### Padrões de Arquitetura & Design
| Padrão | Adoção | Aplicado em | Fonte oficial |
|---|---|---|---|
| Multi-tenancy por discriminador | current | Infrastructure | https://learn.microsoft.com/ef/core |
`;
    const result = extractRequirements(bulletPrd);
    expect(result.requirements.map((requirement) => requirement.id)).toEqual([
      'RF-AUTH-01', 'RF-AUTH-02', 'RF-OS-02', 'RF-OS-02A', 'RF-PUB-01',
    ]);
    expect(result.requirements.every((requirement) => requirement.priority === 'Unspecified')).toBe(true);
    expect(result.acceptanceCriteria[0]).toMatchObject({
      id: 'CA-01',
      requirementId: 'RF-AUTH-01',
      requirementIds: ['RF-AUTH-01', 'RF-AUTH-02'],
    });
    expect(result.acceptanceCriteria[2].requirementIds).toEqual(['RF-OS-02', 'RF-OS-02A']);
    expect(result.warnings).toEqual([]);
  });

  it('expands compact slash lists and inclusive RF ranges completely', () => {
    expect(expandRequirementReferences('RF-PUB-01/02/03')).toEqual(['RF-PUB-01', 'RF-PUB-02', 'RF-PUB-03']);
    expect(expandRequirementReferences('RF-OS-02/02a')).toEqual(['RF-OS-02', 'RF-OS-02A']);
    expect(expandRequirementReferences('RF-ORC-01..11')).toEqual(
      Array.from({ length: 11 }, (_, index) => `RF-ORC-${String(index + 1).padStart(2, '0')}`),
    );
  });

  it('extracts every RNF row with id/category/text, from section 7 only', () => {
    const result = extractRequirements(REALISTIC_PRD);
    expect(result.nonFunctionalRequirements).toEqual([
      { id: 'RNF-01', category: 'Desempenho', text: 'API com p95 < 500 ms para leituras paginadas.' },
      { id: 'RNF-02', category: 'Segurança', text: 'Isolamento por tenant com RLS fail-closed.' },
    ]);
  });

  it('synthesizes ARC-XX ids for architecture-pattern rows in appearance order, skipping the header/separator/anti-pattern table', () => {
    const result = extractRequirements(REALISTIC_PRD);
    expect(result.architecturePatterns).toEqual([
      { id: 'ARC-01', pattern: 'Repository + UnitOfWork', adoption: 'current', appliedIn: 'Infrastructure', source: 'https://learn.microsoft.com/ef/core' },
      { id: 'ARC-02', pattern: 'CQRS leve por casos de uso', adoption: 'experimental', appliedIn: 'Application', source: 'https://martinfowler.com/bliki/CQRS.html' },
    ]);
  });
});

describe('extractRequirements — negative path', () => {
  it('never throws on empty input', () => {
    expect(() => extractRequirements('')).not.toThrow();
  });

  it('never throws on non-string input', () => {
    expect(() => extractRequirements(undefined)).not.toThrow();
    expect(() => extractRequirements(null)).not.toThrow();
  });

  it('degrades with a warning (not a throw) when "Requisitos Funcionais" section is absent', () => {
    const prdWithoutRF = REALISTIC_PRD.replace(/## 6\. Requisitos Funcionais[\s\S]*?(?=---\n\n## 7)/, '');
    const result = extractRequirements(prdWithoutRF);
    expect(result.requirements).toEqual([]);
    expect(result.warnings.some((w) => w.startsWith('SECTION_NOT_FOUND') && w.includes('Requisitos Funcionais'))).toBe(true);
  });

  it('degrades with a warning when "Critérios de Aceite" section is absent', () => {
    const prdWithoutCA = REALISTIC_PRD.replace(/## 14\. Crit[ée]rios de Aceite[\s\S]*?(?=---\n\n## 15)/, '');
    const result = extractRequirements(prdWithoutCA);
    expect(result.acceptanceCriteria).toEqual([]);
    expect(result.warnings.some((w) => w.startsWith('SECTION_NOT_FOUND') && w.includes('Critérios de Aceite'))).toBe(true);
  });

  it('warns (NO_REQUIREMENTS_PARSED) when the section exists but has no parseable RF row', () => {
    const prdEmptyTable = REALISTIC_PRD.replace(
      /\| RF-01[\s\S]*?\| RF-03[^\n]*\n/,
      'Nenhum requisito ainda definido.\n',
    );
    const result = extractRequirements(prdEmptyTable);
    expect(result.requirements).toEqual([]);
    expect(result.warnings.some((w) => w.startsWith('NO_REQUIREMENTS_PARSED'))).toBe(true);
  });

  it('flags a CA that references an RF id absent from the Requisitos Funcionais table (DANGLING_REFERENCE)', () => {
    const prdWithDangling = REALISTIC_PRD.replace('| CA-04 | RF-03 |', '| CA-04 | RF-99 |');
    const result = extractRequirements(prdWithDangling);
    expect(result.warnings.some((w) => w.startsWith('DANGLING_REFERENCE') && w.includes('CA-04') && w.includes('RF-99'))).toBe(true);
  });

  it('degrades with a warning when "Requisitos Não-Funcionais" section is absent', () => {
    const prdWithoutRNF = REALISTIC_PRD.replace(/## 7\. Requisitos N[ãa]o-Funcionais[\s\S]*?(?=---\n\n## 14)/, '');
    const result = extractRequirements(prdWithoutRNF);
    expect(result.nonFunctionalRequirements).toEqual([]);
    expect(result.warnings.some((w) => w.startsWith('SECTION_NOT_FOUND') && w.includes('Requisitos Não-Funcionais'))).toBe(true);
  });

  it('warns (NO_NON_FUNCTIONAL_REQUIREMENTS_PARSED) when section 7 exists but has no parseable RNF row', () => {
    const prdEmptyRnf = REALISTIC_PRD.replace(/\| RNF-01[\s\S]*?\| RNF-02[^\n]*\n/, 'Nenhum RNF ainda definido.\n');
    const result = extractRequirements(prdEmptyRnf);
    expect(result.nonFunctionalRequirements).toEqual([]);
    expect(result.warnings.some((w) => w.startsWith('NO_NON_FUNCTIONAL_REQUIREMENTS_PARSED'))).toBe(true);
  });

  it('degrades with a warning when "Padrões de Arquitetura & Design" is absent', () => {
    const prdWithoutArchitecture = REALISTIC_PRD.replace(/### Padr[õo]es de Arquitetura[\s\S]*?(?=### Anti-padr)/, '');
    const result = extractRequirements(prdWithoutArchitecture);
    expect(result.architecturePatterns).toEqual([]);
    expect(result.warnings.some((w) => w.startsWith('SECTION_NOT_FOUND') && w.includes('Padrões de Arquitetura'))).toBe(true);
  });

  it('warns (NO_ARCHITECTURE_PATTERNS_PARSED) when the section exists but has no parseable pattern row (only the anti-pattern table)', () => {
    const prdEmptyArchitecture = REALISTIC_PRD.replace(
      /\| Repository \+ UnitOfWork \| current[\s\S]*?CQRS\.html \|\n/,
      'Nenhum padrão ainda escolhido.\n',
    );
    const result = extractRequirements(prdEmptyArchitecture);
    expect(result.architecturePatterns).toEqual([]);
    expect(result.warnings.some((w) => w.startsWith('NO_ARCHITECTURE_PATTERNS_PARSED'))).toBe(true);
  });

  it('never confuses the anti-pattern table (3 columns) with the pattern table (4 columns, enum-gated)', () => {
    const result = extractRequirements(REALISTIC_PRD);
    expect(result.architecturePatterns.some((p) => p.pattern === 'Active Record')).toBe(false);
    expect(result.architecturePatterns).toHaveLength(2);
  });

  it('ignores a malformed table row (wrong column count) instead of crashing or misparsing', () => {
    const malformed = REALISTIC_PRD.replace('| RF-03 | O sistema DEVE notificar o solicitante por e-mail quando a reserva for aprovada. | Should |', '| RF-03 | malformed row without third column |');
    const result = extractRequirements(malformed);
    expect(result.requirements.map((r) => r.id)).not.toContain('RF-03');
    expect(result.requirements).toHaveLength(2);
  });

  it('ignores lines that merely contain "RF-" without being a valid table row', () => {
    const withNoise = REALISTIC_PRD.replace('---\n\n## 7', '\nVer RF-01 para detalhes.\n\n---\n\n## 7');
    const result = extractRequirements(withNoise);
    expect(result.requirements).toHaveLength(3);
  });
});
