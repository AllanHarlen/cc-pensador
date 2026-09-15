/**
 * Requirements-index extraction — the RF/CA -> evidence coverage gate's raw
 * material.
 *
 * Audit finding: the Orchestrador's completionAudit() checks tasks, gates,
 * evidence and artifacts, but has NO field connecting a task to the `RF`/`CA`
 * it implements. The traceability matrix required by
 * `implementation-report.md` section 13 is prose, assembled by the same
 * agent that wrote the code — so a dropped requirement in Fase 1.2's task
 * extraction is invisible to every deterministic check downstream (contract
 * validation, wire format, scope) while `report/handoff.json` still reports
 * `status: DONE`.
 *
 * `prd-template.md` already produces exactly the machine-parseable material
 * this gate needs: section 6 ("Requisitos Funcionais") is a stable
 * `| RF-XX | requirement | priority |` table, and section 14 ("Critérios de
 * Aceite") is `| CA-XX | RF-XX | criterion |` — with the CA->RF link already
 * explicit. This module is a PURE text parser (no engine state, no I/O) over
 * the actual PRD markdown the LLM writes, so it can run identically whether
 * called from the Pensador (to emit `requirements.json` at FINAL) or by a
 * consumer re-deriving from a raw PRD in independent mode.
 *
 * Scope: PRD mode only. In Spec mode (OpenSpec) the equivalent material is
 * `SHALL` requirements + `#### Scenario:` blocks inside
 * `specs/<capability>/spec.md`, already exposed live via
 * `openspec status --change <nome> --json` — a different, I/O-based
 * extraction path a consumer can call directly; this module does not
 * attempt to also parse that format.
 */

const RF_ID_SOURCE = 'RF-(?:[A-Z]+-)?\\d+[A-Z]?';
const RF_ROW_RE = new RegExp(`^\\|\\s*(${RF_ID_SOURCE})\\s*\\|\\s*(.+?)\\s*\\|\\s*(.+?)\\s*\\|\\s*$`, 'i');
const RF_BULLET_RE = new RegExp(`^-\\s+\\*\\*(${RF_ID_SOURCE})\\*\\*:\\s*(.+)$`, 'i');
const CA_ROW_RE = /^\|\s*(CA-\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/i;
const CA_BULLET_RE = /^-\s+\*\*(CA-\d+)\*\*\s*\(([^)]+)\)\s*:\s*(.+)$/i;

/** Matches the placeholder template row itself (e.g. `RF-N`, `CA-N`), never a real requirement. */
const isTemplatePlaceholderId = (id) => /-N$/.test(id);

/** Expands `RF-PUB-01/02/03`, `RF-OS-02/02a`, `RF-ORC-01..11`, and ordinary RF lists. */
export function expandRequirementReferences(value) {
  const expressions = String(value ?? '').toUpperCase()
    .match(/RF-(?:[A-Z]+-)?\d+[A-Z]?(?:(?:\/\d+[A-Z]?)+|\.\.\d+)?/g) ?? [];
  const ids = [];
  for (const expression of expressions) {
    const head = expression.match(/^(RF-(?:[A-Z]+-)?)(\d+)/);
    if (!head) continue;
    const [, prefix, firstDigits] = head;
    if (expression.includes('..')) {
      const endDigits = expression.split('..')[1];
      const start = Number(firstDigits);
      const end = Number(endDigits);
      if (Number.isInteger(start) && Number.isInteger(end) && end >= start && end - start <= 999) {
        const width = Math.max(firstDigits.length, endDigits.length);
        for (let number = start; number <= end; number += 1) ids.push(`${prefix}${String(number).padStart(width, '0')}`);
      }
      continue;
    }
    const suffixes = expression.slice(prefix.length).split('/');
    for (const suffix of suffixes) ids.push(`${prefix}${suffix}`);
  }
  return [...new Set(ids)];
}

/**
 * Extracts the body of the FIRST markdown section whose heading matches
 * `headingPattern` (case-insensitive), stopping at the next heading of the
 * same or shallower level. Returns null when no matching heading is found.
 *
 * @param {string} markdown
 * @param {RegExp} headingPattern - must NOT be global; matched against each heading line.
 * @returns {string|null}
 */
function extractSection(markdown, headingPattern) {
  const lines = markdown.split(/\r?\n/);
  let startIndex = -1;
  let startLevel = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^(#+)\s*(.*)$/);
    if (!match) continue;
    if (headingPattern.test(match[2])) {
      startIndex = i;
      startLevel = match[1].length;
      break;
    }
  }
  if (startIndex === -1) return null;

  let endIndex = lines.length;
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const match = lines[i].match(/^(#+)\s*(.*)$/);
    if (match && match[1].length <= startLevel) {
      endIndex = i;
      break;
    }
  }
  return lines.slice(startIndex + 1, endIndex).join('\n');
}

/**
 * Parses a PRD (prd-template.md shape) and extracts its `RF-XX` requirements
 * (section 6, "Requisitos Funcionais") and `CA-XX` acceptance criteria
 * (section 14, "Critérios de Aceite"), including the CA -> RF link.
 *
 * Never throws on malformed input — an empty/absent section yields an empty
 * list plus a warning, so a caller can register the degradation (mirrors
 * the rest of the Pensador's fallback style: register, don't crash).
 *
 * @param {string} prdMarkdown
 * @returns {{
 *   requirements: Array<{ id: string, text: string, priority: string }>,
 *   acceptanceCriteria: Array<{ id: string, requirementId: string, requirementIds: string[], criterion: string }>,
 *   warnings: string[],
 * }}
 */
export function extractRequirements(prdMarkdown) {
  const warnings = [];
  const text = typeof prdMarkdown === 'string' ? prdMarkdown : '';

  const rfSection = extractSection(text, /^\d*\.?\s*Requisitos Funcionais/i);
  const requirements = [];
  if (rfSection == null) {
    warnings.push('SECTION_NOT_FOUND: "Requisitos Funcionais" (PRD section 6) not found');
  } else {
    for (const line of rfSection.split(/\r?\n/)) {
      const tableMatch = line.match(RF_ROW_RE);
      const bulletMatch = line.match(RF_BULLET_RE);
      const match = tableMatch ?? bulletMatch;
      if (!match) continue;
      const [, rawId, reqText, tablePriority] = match;
      const id = rawId.toUpperCase();
      const priority = tableMatch ? tablePriority : 'Unspecified';
      if (isTemplatePlaceholderId(id)) continue;
      if (requirements.some((requirement) => requirement.id === id)) continue;
      requirements.push({ id, text: reqText, priority });
    }
    if (requirements.length === 0) {
      warnings.push('NO_REQUIREMENTS_PARSED: "Requisitos Funcionais" section found but no RF-XX row parsed');
    }
  }

  const caSection = extractSection(text, /^\d*\.?\s*Crit[ée]rios de Aceite/i);
  const acceptanceCriteria = [];
  if (caSection == null) {
    warnings.push('SECTION_NOT_FOUND: "Critérios de Aceite" (PRD section 14) not found');
  } else {
    for (const line of caSection.split(/\r?\n/)) {
      const match = line.match(CA_ROW_RE) ?? line.match(CA_BULLET_RE);
      if (!match) continue;
      const [, rawId, requirementRefs, criterion] = match;
      const id = rawId.toUpperCase();
      if (isTemplatePlaceholderId(id)) continue;
      const requirementIds = expandRequirementReferences(requirementRefs);
      if (requirementIds.length === 0 || acceptanceCriteria.some((criterionEntry) => criterionEntry.id === id)) continue;
      acceptanceCriteria.push({ id, requirementId: requirementIds[0], requirementIds, criterion });
    }
  }

  const requirementIds = new Set(requirements.map((r) => r.id));
  for (const ca of acceptanceCriteria) {
    for (const requirementId of ca.requirementIds) {
      if (!requirementIds.has(requirementId)) {
        warnings.push(`DANGLING_REFERENCE: ${ca.id} references ${requirementId}, which is not in the Requisitos Funcionais section`);
      }
    }
  }

  return { requirements, acceptanceCriteria, warnings };
}

/**
 * Builds the machine-readable content of `requirements.json` (role
 * `requirements-index`) from the already-generated PRD markdown text.
 *
 * @param {string} prdMarkdown
 * @returns {{
 *   requirements: Array<{ id: string, text: string, priority: string }>,
 *   acceptanceCriteria: Array<{ id: string, requirementId: string, requirementIds: string[], criterion: string }>,
 *   warnings: string[],
 * }}
 */
export function buildRequirementsIndex(prdMarkdown) {
  return extractRequirements(prdMarkdown);
}
