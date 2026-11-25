import * as esbuild from 'esbuild';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const outdir = '../dist';
const watch = process.argv.includes('--watch');

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });
writeFileSync(`${outdir}/.keep`, 'Generated RR control assets are written here.\n');

const options = {
  entryPoints: {
    'embed/main': 'embed/main.ts',
    'rc/main': 'rc/main.ts',
  },
  outdir,
  bundle: true,
  format: 'esm',
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  entryNames: '[dir]/[name]',
  target: ['es2020'],
  platform: 'browser',
  minify: !watch,
  sourcemap: watch,
  legalComments: 'none',
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('watching frontend sources...');
} else {
  await esbuild.build(options);
}
