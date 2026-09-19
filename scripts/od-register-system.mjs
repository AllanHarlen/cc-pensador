#!/usr/bin/env node
/**
 * Registers design-systems/<id>/resolved/ in an Open Design daemon so the OPTIONAL prototype reads the
 * tokens verbatim (replaces `od design-systems import-local`, which regenerates tokens.css).
 *
 *   node od-register-system.mjs --dir <featurePath>/design-systems/<id> --daemon-url http://127.0.0.1:7456 \
 *        (--data-dir <daemon data dir> | --container open-design [--container-data-dir /app/.od]) \
 *        [--system-id <id>] --accepted [--allow-remote]
 *
 * It writes state into the daemon, so it needs the user's acceptance (AskUserQuestion header RegistroOD),
 * passed as --accepted by the skill layer. It NEVER starts a run (`od run start` costs tokens and has its
 * own acceptance). The bearer token comes from OD_API_TOKEN or the Open Design deploy .env and is never printed.
 * Refuses (exit 1, stable reasonCode + remediation) when the tokens.css the daemon serves is not byte-for-byte
 * resolved/tokens.css. Prints JSON, including statePatch.designRegistrations; exit 0 = ok, 1 = refused, 2 = usage.
 */
import { join, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { odApiToken } from './lib/open-design-preflight.mjs';
import { REGISTER_REASON, dockerTarget, fsTarget, registerDesignSystem } from './lib/od-register.mjs';

export const REGISTER_CONSENT_HEADER = 'RegistroOD';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

export async function registerCommand({ dir, daemonUrl, dataDir, container, containerDataDir, systemId, accepted = false, allowRemote = false, token, fetchFn, exec, now }) {
  if (accepted !== true) {
    return {
      status: 'REFUSED',
      reasonCode: 'OD_REGISTER_CONSENT_REQUIRED',
      message: 'registering writes a design system into the daemon: it needs the user\'s acceptance',
      remediation: `ask the user with AskUserQuestion (header "${REGISTER_CONSENT_HEADER}") and run again with --accepted; this command never starts a run`,
    };
  }
  const systemDir = resolve(dir);
  const target = container
    ? dockerTarget({ container, ...(containerDataDir ? { dataDir: containerDataDir } : {}), ...(exec ? { exec } : {}) })
    : dataDir ? fsTarget(dataDir) : null;
  return registerDesignSystem({
    resolvedDir: join(systemDir, 'resolved'),
    daemonUrl,
    systemId: systemId ?? basename(systemDir),
    token: token === undefined ? odApiToken() : token,
    target,
    allowRemote,
    ...(fetchFn ? { fetchFn } : {}),
    ...(now ? { now } : {}),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  const str = (key) => (typeof args[key] === 'string' ? args[key] : undefined);
  if (!str('dir') || !str('daemon-url')) {
    console.error('usage: od-register-system.mjs --dir <featurePath>/design-systems/<id> --daemon-url <url> (--data-dir <dir> | --container <name>) [--system-id id] --accepted');
    process.exit(2);
  }
  let result;
  try {
    result = await registerCommand({
      dir: str('dir'), daemonUrl: str('daemon-url'), dataDir: str('data-dir'), container: str('container'),
      containerDataDir: str('container-data-dir'), systemId: str('system-id'), accepted: args.accepted === true, allowRemote: args['allow-remote'] === true,
    });
  } catch (error) {
    result = { status: 'ERROR', reasonCode: REGISTER_REASON.COPY_FAILED, message: error.name };
  }
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === 'ok' ? 0 : 1;
}
