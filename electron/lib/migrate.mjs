// Appen hed Art Triage og hedder nu Stef G Art. Electron lægger brugerdata i
// en mappe opkaldt efter appen, saa den nye udgave ville starte uden
// indstillinger, API-noegler og den hentede model. Foer noget andet hentes de
// derfor over fra den gamle mappe, én gang. Den gamle mappe roeres ikke.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const MARKOER = 'billedflow-settings.json';
// Kun det der betyder noget. Resten af mappen er Chromiums egen cache og
// laasefiler, som ikke skal med.
const MED = [MARKOER, 'model-cache'];

export function overtagGamleData(gammel, ny) {
  try {
    if (existsSync(join(ny, MARKOER)) || !existsSync(join(gammel, MARKOER))) return false;
    mkdirSync(ny, { recursive: true });
    for (const navn of MED) {
      const fra = join(gammel, navn);
      if (existsSync(fra)) cpSync(fra, join(ny, navn), { recursive: true, force: false });
    }
    return true;
  } catch {
    return false;
  }
}
