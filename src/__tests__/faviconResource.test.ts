import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const indexPath = new URL('../../index.html', import.meta.url);
const faviconPath = new URL('../../public/favicon.svg', import.meta.url);

describe('static favicon resource', () => {
  it('declares the self-contained VoltWise SVG favicon', async () => {
    const html = await readFile(indexPath, 'utf8');
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
    await expect(readFile(faviconPath, 'utf8')).resolves.toBeTruthy();
  });

  it('contains a valid SVG root and viewBox without scripts or external resources', async () => {
    const svg = await readFile(faviconPath, 'utf8');
    expect(svg).toMatch(/^\s*<svg\b[^>]*\bviewBox="0 0 64 64"[^>]*>[\s\S]*<\/svg>\s*$/);
    expect(svg).not.toMatch(/<script\b/i);
    expect(svg).not.toMatch(/\b(?:href|src)\s*=\s*["'](?:https?:)?\/\//i);
    expect(svg).not.toMatch(/url\(\s*["']?(?:https?:)?\/\//i);
  });
});
