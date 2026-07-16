// Fortryd/gentag for katalog-handlinger. Hver optagelse gemmer et snapshot
// af tilstanden FOER handlingen; apply() genskaber snapshottet og
// returnerer en ny post der kan genskabe tilstanden fra FOER fortrydelsen,
// saa undo og redo er symmetriske.
const MAX_ENTRIES = 100;

export class UndoManager {
  constructor(catalog) {
    this.catalog = catalog;
    this.undoStack = [];
    this.redoStack = [];
  }

  _push(entry) {
    if (!entry) return;
    this.undoStack.push(entry);
    if (this.undoStack.length > MAX_ENTRIES) this.undoStack.shift();
    this.redoStack = [];
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    const redoEntry = entry.apply();
    if (redoEntry) this.redoStack.push(redoEntry);
    return entry.label;
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    const undoEntry = entry.apply();
    if (undoEntry) this.undoStack.push(undoEntry);
    return entry.label;
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

  beforeFlags(versionIds, flag) {
    this._push(this._flagsEntry(versionIds, flag));
  }

  _flagsEntry(versionIds, flag) {
    const key = flag === 'edited' ? 'edited' : 'finished';
    const saved = versionIds
      .map((id) => {
        const v = this.catalog.getVersion(id);
        return v ? { id, value: Boolean(v[key]) } : null;
      })
      .filter(Boolean);
    if (!saved.length) return null;
    return {
      label: flag === 'edited' ? 'redigeret-mærke' : 'færdig-mærke',
      apply: () => {
        const redo = this._flagsEntry(saved.map((s) => s.id), flag);
        for (const { id, value } of saved) this.catalog.setFlag([id], flag, value);
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
