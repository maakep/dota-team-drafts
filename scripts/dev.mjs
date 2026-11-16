import { watch } from 'node:fs';
import { build, root } from './build.mjs';
import { serve } from './serve.mjs';
import path from 'node:path';

await build();
serve();
let timer;
let pending = Promise.resolve();
for (const item of ['src', 'data', 'index.html']) {
  watch(path.join(root, item), { recursive: item !== 'index.html' }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => { pending = pending.then(build).catch(e => console.error(e.message)); }, 150);
  });
}
