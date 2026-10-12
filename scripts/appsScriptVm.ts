import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

/** Any function exposed by the Apps Script sources. */
export type GsFunction = (...args: unknown[]) => unknown;
export type GsContext = Record<string, GsFunction>;

const APPS_SCRIPT_DIR = path.resolve(__dirname, '..', 'apps-script');

/**
 * Loads every .gs file into one V8 context (the way Apps Script shares one global scope) so the pure
 * logic (aggregation, parsing, queue, pattern matching) can be tested and reused without Google services.
 */
export function loadAppsScript(globals: Record<string, unknown> = {}): GsContext {
  const context = vm.createContext({ console, ...globals });
  for (const file of fs.readdirSync(APPS_SCRIPT_DIR).filter((f) => f.endsWith('.gs')).sort()) {
    vm.runInContext(fs.readFileSync(path.join(APPS_SCRIPT_DIR, file), 'utf8'), context, { filename: file });
  }
  return context as unknown as GsContext;
}

/** Values created inside the vm have another realm's prototypes; this makes them ordinary objects. */
export function plain<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
