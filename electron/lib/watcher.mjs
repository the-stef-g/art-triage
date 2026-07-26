// Overvaager biblioteksmappen og udloeser en synkronisering naar der sker
// aendringer udefra: redigeringer gemt fra en editor, nye filer, flytninger.
import chokidar from 'chokidar';
import { basename } from 'node:path';
import { debounce } from './util.mjs';

export function watchLibrary(root, onChange) {
  const watcher = chokidar.watch(root, {
    ignored: (path) => {
      const name = basename(path);
      if (name.startsWith('.') && path !== root) return true;
      return path.includes('/.art-triage') || path.includes('/.billedflow');
    },
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 900, pollInterval: 200 },
  });
  const trigger = debounce(onChange, 700);
  watcher.on('add', trigger);
  watcher.on('change', trigger);
  watcher.on('unlink', trigger);
  watcher.on('addDir', trigger);
  watcher.on('unlinkDir', trigger);
  return watcher;
}
