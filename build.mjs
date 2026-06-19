import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['renderer/editor.mjs'],
  bundle: true,
  format: 'iife',
  globalName: 'EditorModule',
  outfile: 'renderer/bundle/editor-bundle.js',
  external: ['electron'],
  platform: 'browser',
  minify: false,
  sourcemap: true,
});

console.log('Editor bundle built.');
