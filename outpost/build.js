// Bundles src/ into one self-contained page: dist/index.html.
// Run with `npm run build`. The published artifact is this single file, with
// the sources published beside it so a later session can rebuild and extend it.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

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
const html = readFileSync('index.template.html', 'utf8')
  .replace('/*__CSS__*/', () => css)
  .replace('/*__JS__*/', () => js);

mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html);
console.log(`dist/index.html written (${(html.length / 1024).toFixed(1)} KB)`);
