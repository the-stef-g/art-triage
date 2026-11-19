import { existsSync } from 'node:fs';
// Fortryd/gentag for katalog-handlinger. Hver optagelse gemmer et snapshot
// af tilstanden FOER handlingen; apply() genskaber snapshottet og
// returnerer en ny post der kan genskabe tilstanden fra FOER fortrydelsen,
// saa undo og redo er symmetriske.
const MAX_ENTRIES = 100;

// Navnet i Edit-menuen: Undo Master, Redo Rename ...
const MENUNAVN = {
  bedømmelse: 'Rating', edits: 'Edits', serie: 'Series', omdøbning: 'Version Name',
  'virtuel kopi': 'Virtual Copy', flytning: 'Move', master: 'Master', original: 'Original',
  'omdøb værk': 'Rename', beskæring: 'Save Crop',
};

// trash(abs) laegger en fil i papirkurven; works er vaerkerne (titler);
// onChange(undoNavn, redoNavn) faar menuens navne, naar stakkene aendres.
export class UndoManager {
  constructor(catalog, { trash = null, works = null, onChange = null } = {}) {
    this.catalog = catalog;
    this.trash = trash;
    this.works = works;
    this.onChange = onChange;
    this.undoStack = [];
    this.redoStack = [];
  }

  _meld() {
    const navn = (e) => (e ? MENUNAVN[e.label] || e.label : null);
    this.onChange?.(navn(this.undoStack.at(-1)), navn(this.redoStack.at(-1)));
  }

  _push(entry) {
    if (!entry) return;
    this.undoStack.push(entry);
    if (this.undoStack.length > MAX_ENTRIES) this.undoStack.shift();
    this.redoStack = [];
    this._meld();
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  async undo() {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    try {
      const redoEntry = await entry.apply();
      if (redoEntry) this.redoStack.push(redoEntry);
    } finally {
      this._meld();
    }
    return MENUNAVN[entry.label] || entry.label;
  }

  async redo() {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    try {
      const undoEntry = await entry.apply();
      if (undoEntry) this.undoStack.push(undoEntry);
    } finally {
      this._meld();
    }
    return MENUNAVN[entry.label] || entry.label;
  }

  // ---------- Vaerkets trin ----------

  // Kaldes EFTER at en fil er lavet (masteren eller en beskaering): fortryd
  // laegger den i papirkurven. Der er ingen gentag; trinnet laves igen.
  afterNyFil(rel, label) {
    this._push({
      label,
      apply: async () => {
        const abs = this.catalog.abs(rel);
        if (this.trash && existsSync(abs)) await this.trash(abs);
        return null;
      },
    });
  }

  // Kaldes EFTER Original/Edit: gammelFileId er den fil der var originalen.
  afterNyOriginal(imageId, gammelFileId) {
    if (gammelFileId) this._push(this._originalEntry(imageId, gammelFileId));
  }

  _originalEntry(imageId, fileId) {
    return {
      label: 'original',
      apply: () => {
        const nu = this.catalog.db.get('SELECT master_file_id FROM images WHERE id=?', imageId)?.master_file_id;
        const v = this.catalog.db.get('SELECT id FROM versions WHERE image_id=? AND file_id=?', imageId, fileId);
        if (!v || !nu || nu === fileId) return null;
        this.catalog.goerTilOriginal(v.id);
        return this._originalEntry(imageId, nu);
      },
    };
  }

  // Kaldes FOER et vaerk omdoebes: mappen og titlen som de var.
  beforeOmdoebVaerk(imageId) {
    const plan = this.catalog.omdoebPlan(imageId, '');
    if (!plan) return;
    const titel = this.works?.get(imageId)?.title ?? null;
    this._push(this._omdoebEntry(imageId, plan.fra, titel));
  }

  _omdoebEntry(imageId, mappe, titel) {
    return {
      label: 'omdøb værk',
      apply: () => {
        const nu = this.catalog.omdoebPlan(imageId, '');
        const nuTitel = this.works?.get(imageId)?.title ?? null;
        if (nu && nu.fra !== mappe) this.catalog.omdoeb(imageId, mappe);
        this.works?.save(imageId, { title: titel ?? '' });
        return nu ? this._omdoebEntry(imageId, nu.fra, nuTitel) : null;
      },
    };
  }

  // ---------- Optagelser (kaldes FOER handlingen, medmindre andet staar) ----------

  beforeRatings(versionIds) {
    this._push(this._ratingsEntry(versionIds));
  }

  _ratingsEntry(versionIds) {
    const saved = versionIds
      .map((id) => ({ id, rating: this.catalog.getVersion(id)?.rating }))
      .filter((s) => s.rating);
    if (!saved.length) return null;
    return {
      label: 'bedømmelse',
      apply: () => {
        const redo = this._ratingsEntry(saved.map((s) => s.id));
        for (const { id, rating } of saved) this.catalog.setRating([id], rating);
        return redo;
      },
    };
  }

  beforeStage(versionIds) {
    this._push(this._stageEntry(versionIds));
  }

  // Hele trinnet gemmes under ét. Foer blev det ene flag gemt uden det
  // andet, og en fortrydelse kunne saette begge taendt igen.
  _stageEntry(versionIds) {
    const saved = versionIds
      .map((id) => {
        const v = this.catalog.getVersion(id);
        return v ? { id, edited: v.edited, finished: v.finished, editor: v.editor } : null;
      })
      .filter(Boolean);
    if (!saved.length) return null;
    return {
      label: 'edits',
      apply: () => {
        const redo = this._stageEntry(saved.map((s) => s.id));
        for (const s of saved) this.catalog.restoreEdits(s.id, s);
        return redo;
      },
    };
  }

  beforeSeries(imageIds) {
    this._push(this._seriesEntry(imageIds));
  }

  _seriesEntry(imageIds) {
    const saved = imageIds.map((id) => {
      const row = this.catalog.db.get('SELECT id, series_id FROM images WHERE id=?', id);
      return row ? { id: row.id, seriesId: row.series_id } : null;
    }).filter(Boolean);
    if (!saved.length) return null;
    return {
      label: 'serie',
      apply: () => {
        const redo = this._seriesEntry(saved.map((s) => s.id));
        for (const { id, seriesId } of saved) this.catalog.assignSeries([id], seriesId);
        return redo;
      },
    };
  }

  beforeRename(versionId) {
    this._push(this._renameEntry(versionId));
  }

  _renameEntry(versionId) {
    const v = this.catalog.getVersion(versionId);
    if (!v || v.is_master) return null;
    const saved = v.name;
    return {
      label: 'omdøbning',
      apply: () => {
        const redo = this._renameEntry(versionId);
        this.catalog.renameVersion(versionId, saved);
        return redo;
      },
    };
  }

  // Kaldes EFTER at kopien er oprettet.
  afterVirtualCopy(versionId) {
    this._push(this.afterVirtualCopyEntry(versionId));
  }

  afterVirtualCopyEntry(versionId) {
    // Fortryd sletter kopien; gentag opretter en ny paa samme billede.
    // En materialiseret kopi har en fysisk fil; den fortrydes ikke.
    return {
      label: 'virtuel kopi',
      apply: () => {
        const v = this.catalog.getVersion(versionId);
        if (!v || v.is_master || v.file_id) return null;
        const imageId = v.image_id;
        this.catalog.deleteVersion(versionId);
        return {
          label: 'virtuel kopi',
          apply: () => {
            const master = this.catalog.db.get(
              'SELECT id FROM versions WHERE image_id=? AND is_master=1', imageId
            );
            if (!master) return null;
            const nyId = this.catalog.createVirtualCopy(master.id);
            return this.afterVirtualCopyEntry(nyId);
          },
        };
      },
    };
  }

  // Kaldes EFTER en flytning; moves er [{fileId, fromDir, toDir}].
  afterMoves(moves) {
    if (!moves || !moves.length) return;
    this._push(this._movesEntry(moves));
  }

  _movesEntry(moves) {
    const saved = moves.map((m) => ({ ...m }));
    return {
      label: 'flytning',
      apply: () => {
        const tilbage = [];
        const byDir = new Map();
        for (const m of saved) {
          if (!byDir.has(m.fromDir)) byDir.set(m.fromDir, []);
          byDir.get(m.fromDir).push(m.fileId);
        }
        for (const [dir, ids] of byDir) {
          tilbage.push(...this.catalog.moveFiles(ids, dir));
        }
        return tilbage.length ? this._movesEntry(tilbage) : null;
      },
    };
  }
}
