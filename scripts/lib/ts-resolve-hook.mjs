/** Module resolve hook: lets Node import the Open Design engine sources, which import "./x.js" for "./x.ts". */
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function resolve(specifier, context, next) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
    const base = fileURLToPath(new URL(specifier, context.parentURL));
    for (const candidate of [base.replace(/\.js$/, '.ts'), `${base}.ts`, `${base}/index.ts`]) {
      if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
  }
  return next(specifier, context);
}
