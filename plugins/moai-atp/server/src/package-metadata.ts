import { readFileSync } from 'node:fs';
/** Fixed local package metadata only. No environment, credentials or network lookup. */
const metadata: unknown = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
if (!metadata || typeof metadata !== 'object' || !('version' in metadata) || typeof metadata.version !== 'string' ||
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(metadata.version)) {
  throw new Error('invalid_package_metadata');
}
export const PACKAGE_VERSION = metadata.version;
