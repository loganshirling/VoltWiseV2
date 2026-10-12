import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

for (const relativePath of ['dist', 'server.js']) {
  rmSync(resolve(repositoryRoot, relativePath), { recursive: true, force: true });
}
