/** Vitest setup: the approval key of every test lives in a throwaway directory, never in the real user profile. */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APPROVAL_KEY_DIR_ENV } from '../../scripts/lib/design-approval.mjs';

process.env[APPROVAL_KEY_DIR_ENV] = mkdtempSync(join(tmpdir(), 'pensador-approval-key-'));
