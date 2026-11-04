// Bundles src/ into one self-contained page: dist/index.html.
// Run with `npm run build`. The published artifact is this single file, with
// the sources published beside it so a later session can rebuild and extend it.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

// `node build.js --pages` writes docs/index.html: the same game as a standalone page for
// GitHub Pages (doctype, viewport, iOS home-screen tags). The default build keeps the
// fragment form that the Artifact host wraps itself.
const pages = process.argv.includes('--pages');
const standaloneHead = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0f141b">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Outpost">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="format-detection" content="telephone=no">
<meta name="description" content="Outpost of Azeroth: an unofficial, non-commercial fan-made incremental game.">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%230f141b'/%3E%3Cpath d='M16 5l9 7v14H7V12z' fill='%23d8a640'/%3E%3Crect x='13' y='17' width='6' height='9' fill='%230f141b'/%3E%3C/svg%3E">
`;

const result = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  write: false,
  minify: false,
  legalComments: 'none',
  logLevel: 'warning',
});

const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync('src/styles.css', 'utf8');
let html = readFileSync('index.template.html', 'utf8')
  .replace('/*__CSS__*/', () => css)
  .replace('/*__JS__*/', () => js);

const outDir = pages ? 'docs' : 'dist';
if (pages) {
  html = standaloneHead + html.replace(/<meta name="claude:[^>]*>\n?/, '');
}
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/index.html`, html);
if (pages) writeFileSync('docs/.nojekyll', '');
console.log(`${outDir}/index.html written (${(html.length / 1024).toFixed(1)} KB)`);
