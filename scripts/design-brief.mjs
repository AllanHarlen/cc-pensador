/**
 * Persists and updates the design brief (<featurePath>/design-brief.json) and its seed. The skill
 * layer calls this instead of hand-writing JSON, so the brief, the seed and the approval always come
 * from the engine's pure functions.
 *
 *   build   --feature <featurePath> --answers answers.json [--name "Produto"] [--slug produto]
 *   seed    --feature <featurePath> --dir <featurePath>/design-systems/<id> [--proposals proposals.json]
 *   brand-url --feature <featurePath> --dir <featurePath>/design-systems/<id> [--url https://site] [--container name]
 *           optional: the engine reads the brand site (no LLM) and proposes colorPrimary/fontFamily for the UNLOCKED fields;
 *           writes source/brand-url.json, which the user confirms before it is passed to `seed --proposals`
 *   adjust  --feature <featurePath> --set '{"colorPrimary":"#0F766E"}'   (quick adjustments of the visual approval)
 *   approve --feature <featurePath> --dir <featurePath>/design-systems/<id> [--unverified]   (after the user approved preview/)
 *           needs the approval question (AskUserQuestion header AprovDesign) in the hook log; --unverified only where hooks are disabled
 *   agent   --agents <preflight.json|designAgents.json> --choose <agentId|none> [--daemon-where host|container]
 *           binds the agent the user picked (AskUserQuestion header AgenteDesign) to the OPTIONAL OD prototype/Critique;
 *           prints statePatch.designAgent. Refuses (exit 1, with remediations) an agent the daemon cannot see; never starts a run
 *
 * Every command prints JSON; exit 0 = ok, 1 = refused (issues), 2 = usage.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  applyDesignAdjustments, approveDesignBrief, briefToSeed, buildDesignBrief, resolveDesignAgent, validateDesignAgent,
} from './pensador-engine.mjs';
import { canonicalJson } from './lib/token-mapper.mjs';
import { APPROVAL_FILE, DESIGN_APPROVAL_HEADER, approvalQuestionsIn, buildApprovalRecord, loadApprovalKey } from './lib/design-approval.mjs';
import { QUESTION_LOG } from './lib/stage-gate.mjs';
import { deriveSeedFromUrl } from './lib/brand-url.mjs';

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeText(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, 'utf8');
}

const briefFileOf = (feature) => join(resolve(feature), 'design-brief.json');

function loadBrief(feature) {
  const file = briefFileOf(feature);
  if (!existsSync(file)) throw new Error(`design-brief.json not found at ${file}; run "design-brief.mjs build" first`);
  return { file, brief: readJson(file) };
}

/** briefToSeed provenance -> the origin vocabulary of the contract ("brief-unlocked" is still the brief's value). */
export function seedOriginFrom(provenance) {
  return Object.fromEntries(Object.entries(provenance).map(([key, origin]) => [key, origin === 'brief-unlocked' ? 'brief' : origin]));
}

/** The engine input (brand.json): identity + the brief's seed; the display font and default theme travel with it. */
export function brandFromBrief(brief, seed) {
  const fields = brief.fields ?? {};
  const name = brief.product?.name || brief.product?.slug || 'Design System';
  const slug = brief.product?.slug || String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return {
    name,
    slug,
    colors: seed.colorPrimary ? [{ role: 'accent', hex: seed.colorPrimary, name: 'Primary' }] : [],
    seed,
    ...(fields.themeDefault?.value ? { defaultTheme: fields.themeDefault.value } : {}),
  };
}

export function buildCommand({ feature, answers, name, slug }) {
  const brief = buildDesignBrief({ product: { name, slug }, answers });
  const file = briefFileOf(feature);
  writeText(file, canonicalJson(brief));
  return { status: brief.issues.length ? 'ISSUES' : 'ok', file, issues: brief.issues, statePatch: { designBriefPath: file } };
}

export function seedCommand({ feature, dir, proposals = {} }) {
  const { brief } = loadBrief(feature);
  const { seed, provenance } = briefToSeed(brief, proposals);
  const systemDir = resolve(dir);
  const seedOrigin = seedOriginFrom(provenance);
  writeText(join(systemDir, 'source', 'seed.json'), canonicalJson(seed));
  writeText(join(systemDir, 'source', 'seed-origin.json'), canonicalJson(seedOrigin));
  writeText(join(systemDir, 'source', 'brand.json'), canonicalJson(brandFromBrief(brief, seed)));
  return {
    status: 'ok',
    seed,
    provenance,
    next: `node od-brand-build.mjs --brand "${join(systemDir, 'source', 'brand.json')}" --dir "${systemDir}" --brief-ref design-brief.json --seed-origin "${join(systemDir, 'source', 'seed-origin.json')}" --extras <extras.json>`,
  };
}

/** Proposes seed fields from the brand URL (brief field brandUrl or --url). A locked field is never overridden later by briefToSeed. */
export function brandUrlCommand({ feature, dir, url, container, derive = deriveSeedFromUrl }) {
  const { brief } = loadBrief(feature);
  const target = url ?? brief.fields?.brandUrl?.value;
  if (!target) return { status: 'REFUSED', issue: 'brand-url-missing', message: 'pass --url or record brandUrl in the brief' };
  const result = derive({ url: target, container });
  if (result.status !== 'ok') return { status: 'UNAVAILABLE', reasonCode: result.reasonCode, message: result.message, note: 'the brand URL is optional: continue without it (the AGY proposal and the engine defaults still apply)' };
  const locked = Object.entries(brief.fields ?? {}).filter(([, field]) => field?.locked === true).map(([name]) => name);
  const file = join(resolve(dir), 'source', 'brand-url.json');
  writeText(file, canonicalJson({ url: target, proposals: result.proposals, engine: result.engine, ignoredLocked: Object.keys(result.proposals).filter((name) => locked.includes(name)) }));
  return { status: 'ok', file, url: target, proposals: result.proposals, ignoredLocked: Object.keys(result.proposals).filter((name) => locked.includes(name)), next: `show the colour preview to the user (AskUserQuestion); if confirmed: design-brief.mjs seed --proposals "<dir>/source/brand-url.json"` };
}

export function adjustCommand({ feature, set }) {
  const { file, brief } = loadBrief(feature);
  const result = applyDesignAdjustments(brief, set);
  if (result.applied.length > 0) writeText(file, canonicalJson(result.brief));
  return { status: result.issues.length ? 'ISSUES' : 'ok', applied: result.applied, issues: result.issues, approvalCleared: result.applied.length > 0, file };
}

export function approveCommand({ feature, dir, unverified = false, now = () => new Date().toISOString() }) {
  const { file, brief } = loadBrief(feature);
  const resolvedDir = join(resolve(dir), 'resolved');
  const contractFile = join(resolvedDir, 'design-contract.json');
  const auditFile = join(resolvedDir, 'design-audit.json');
  const refuse = (issue, message) => ({ status: 'REFUSED', issue, message, file });
  if (!existsSync(contractFile)) return refuse('contract-missing', `${contractFile} not found`);
  const contract = readJson(contractFile);
  const audit = existsSync(auditFile) ? readJson(auditFile) : null;
  if (audit?.status !== 'PASS' || audit.contractSha256 !== contract.sha256) {
    return refuse('audit-not-pass', 'only an audited contract can be approved: run design-package.mjs audit and get status PASS for this design-contract.json');
  }
  const featureDir = resolve(feature);
  const logFile = join(featureDir, QUESTION_LOG);
  const logText = existsSync(logFile) ? readFileSync(logFile, 'utf8') : '';
  if (!unverified && approvalQuestionsIn(logText, 'DESIGN') < 1) {
    return refuse('approval-question-not-observed', `no AskUserQuestion with header "${DESIGN_APPROVAL_HEADER}" was logged in DESIGN: show the preview/ and ask the user to approve it first (only where hooks are disabled: --unverified)`);
  }
  // the key is minted (or read) before anything is written, so a failure leaves brief and record untouched
  const key = loadApprovalKey({ create: true });
  const result = approveDesignBrief(brief, { approvedAt: now(), contractSha256: contract.sha256 });
  if (!result.ok) return refuse(result.issue, `approval refused (${result.issue})`);
  writeText(file, canonicalJson(result.brief));
  writeText(join(featureDir, APPROVAL_FILE), canonicalJson(buildApprovalRecord({
    key, systemId: basename(resolve(dir)),
    brief: result.brief, contractSha256: contract.sha256, approvedAt: result.brief.approvedAt, unverified,
  })));
  return { status: 'ok', approvedAt: result.brief.approvedAt, approvedSha256: result.brief.approvedSha256, unverified, file, statePatch: { designBriefPath: file } };
}

/** source/brand-url.json wraps the proposals next to the url and the engine version. */
/** Accepts the whole preflight output, its `integrations.designAgents` block, or a bare agents array. */
function designAgentsFrom(json) {
  const block = json?.integrations?.designAgents ?? json;
  const agents = Array.isArray(block) ? block : Array.isArray(block?.agents) ? block.agents : [];
  return { agents, daemonWhere: Array.isArray(block) ? null : block?.daemonWhere ?? null };
}

export function agentCommand({ agents, choose, daemonWhere, now }) {
  const detected = designAgentsFrom(agents);
  const where = daemonWhere ?? detected.daemonWhere;
  const resolved = resolveDesignAgent(detected.agents, choose, { daemonWhere: where, ...(now ? { now } : {}) });
  if (resolved.designAgent && !validateDesignAgent(resolved.designAgent).ok) return { status: 'ERROR', message: 'resolved designAgent failed validation' };
  return {
    status: resolved.ok ? 'ok' : 'REFUSED',
    prototypeEnabled: resolved.prototypeEnabled,
    designAgent: resolved.designAgent,
    issues: resolved.issues,
    remediations: resolved.remediations,
    statePatch: resolved.ok ? { designAgent: resolved.designAgent } : {},
  };
}

function unwrapProposals(json) {
  return json && typeof json.proposals === 'object' && json.proposals !== null ? json.proposals : json;
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) out._.push(argv[i]);
    else out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  const need = (...keys) => keys.every((key) => typeof args[key] === 'string');
  const usage = () => {
    console.error('usage: design-brief.mjs build|seed|adjust|approve|agent --feature <featurePath> [--answers f | --dir d [--proposals f] | --set json | --dir d]');
    process.exit(2);
  };
  let result;
  try {
    if (command === 'build' && need('feature', 'answers')) result = buildCommand({ feature: args.feature, answers: readJson(resolve(args.answers)), name: args.name, slug: args.slug });
    else if (command === 'seed' && need('feature', 'dir')) result = seedCommand({ feature: args.feature, dir: args.dir, proposals: args.proposals ? unwrapProposals(readJson(resolve(args.proposals))) : {} });
    else if (command === 'brand-url' && need('feature', 'dir')) result = brandUrlCommand({ feature: args.feature, dir: args.dir, url: typeof args.url === 'string' ? args.url : undefined, container: typeof args.container === 'string' ? args.container : undefined });
    else if (command === 'adjust' && need('feature', 'set')) result = adjustCommand({ feature: args.feature, set: JSON.parse(args.set) });
    else if (command === 'approve' && need('feature', 'dir')) result = approveCommand({ feature: args.feature, dir: args.dir, unverified: args.unverified === true });
    else if (command === 'agent' && need('agents', 'choose')) result = agentCommand({ agents: readJson(resolve(args.agents)), choose: args.choose, daemonWhere: typeof args['daemon-where'] === 'string' ? args['daemon-where'] : undefined });
    else usage();
  } catch (error) {
    result = { status: 'ERROR', message: error.message };
  }
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === 'ok' ? 0 : 1;
}
