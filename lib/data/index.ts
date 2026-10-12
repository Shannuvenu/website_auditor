import { getDataSourceKind } from '@/lib/config/env';
import { appsScriptSource } from './appsScriptSource';
import { mockSource } from './mockSource';
import type { DataSource } from './source';

export function getDataSource(): DataSource {
  return getDataSourceKind() === 'apps-script' ? appsScriptSource : mockSource;
}

export type { DataSource } from './source';
