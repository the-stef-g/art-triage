// App-indstillinger paa tvaers af biblioteker (senest aabnede mapper og
// brugervalgte editor-apps). Gemmes som JSON i Electrons userData-mappe.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

export class Settings {
  constructor(userDataDir) {
    this.path = join(userDataDir, 'billedflow-settings.json');
    this.data = { recentLibraries: [], customEditors: [] };
    try {
      this.data = { ...this.data, ...JSON.parse(readFileSync(this.path, 'utf8')) };
    } catch {
      // foerste start
    }
  }

  save() {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }

  rememberLibrary(root) {
    this.data.recentLibraries = [
      root,
      ...this.data.recentLibraries.filter((r) => r !== root),
    ].slice(0, 8);
    this.save();
  }

  addCustomEditor(appPath) {
    if (!this.data.customEditors.includes(appPath)) {
      this.data.customEditors.push(appPath);
      this.save();
    }
  }
}
