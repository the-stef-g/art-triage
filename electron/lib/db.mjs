// Tynd database-wrapper med to motorer:
//  1) node:sqlite (indbygget i nyere Node/Electron) - rigtig fil, ingen native build
//  2) sql.js (WASM) som fallback - ren JS, virker overalt
// API'et er det samme uanset motor: run/get/all/exec/transaction/flush/close.
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

class NodeSqliteDb {
  constructor(DatabaseSync, filePath) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    // Kataloget ligger paa biblioteksdrevet, ofte et eksternt drev. FULL
    // venter paa disken ved hver enkelt aendring; med WAL er NORMAL lige
    // sikker mod en odelagt database og kan hoejst miste de allersidste
    // aendringer ved strømsvigt. Standardcachen er kun 2 MB og for lille til
    // en database paa flere hundrede MB.
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.db.exec('PRAGMA cache_size = -65536');
    this.db.exec('PRAGMA temp_store = MEMORY');
    this.stmts = new Map();
    this.engine = 'node:sqlite';
  }
  prepare(sql) {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }
  run(sql, ...params) {
    const r = this.prepare(sql).run(...params);
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }
  get(sql, ...params) {
    return this.prepare(sql).get(...params);
  }
  all(sql, ...params) {
    return this.prepare(sql).all(...params);
  }
  exec(sql) {
    this.db.exec(sql);
  }
  transaction(fn) {
    this.exec('BEGIN');
    try {
      const out = fn();
      this.exec('COMMIT');
      return out;
    } catch (err) {
      this.exec('ROLLBACK');
      throw err;
    }
  }
  flush() {}
  close() {
    this.db.close();
  }
}

class SqlJsDb {
  constructor(SQL, filePath) {
    this.filePath = filePath;
    mkdirSync(dirname(filePath), { recursive: true });
    const bytes = existsSync(filePath) ? readFileSync(filePath) : null;
    this.db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    this.db.exec('PRAGMA foreign_keys = ON');
    this.engine = 'sql.js';
    this._dirty = false;
    this._timer = null;
  }
  _scheduleFlush() {
    this._dirty = true;
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.flush();
    }, 300);
    if (this._timer.unref) this._timer.unref();
  }
  run(sql, ...params) {
    this.db.run(sql, params);
    const changes = this.db.getRowsModified();
    let lastInsertRowid = 0;
    if (/^\s*insert/i.test(sql)) {
      const r = this.db.exec('SELECT last_insert_rowid() AS id');
      lastInsertRowid = r[0]?.values?.[0]?.[0] ?? 0;
    }
    this._scheduleFlush();
    return { changes, lastInsertRowid: Number(lastInsertRowid) };
  }
  _rows(sql, params) {
    const stmt = this.db.prepare(sql);
    try {
      if (params.length) stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }
  get(sql, ...params) {
    return this._rows(sql, params)[0];
  }
  all(sql, ...params) {
    return this._rows(sql, params);
  }
  exec(sql) {
    this.db.exec(sql);
    this._scheduleFlush();
  }
  transaction(fn) {
    this.db.exec('BEGIN');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      this._scheduleFlush();
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
  flush() {
    if (!this._dirty) return;
    this._dirty = false;
    const data = Buffer.from(this.db.export());
    const tmp = this.filePath + '.tmp';
    writeFileSync(tmp, data);
    renameSync(tmp, this.filePath);
  }
  close() {
    this.flush();
    this.db.close();
  }
}

// engine: 'sqljs' tvinger fallback-motoren, saa begge kan maales og testes.
export async function openDatabase(filePath, { engine = null } = {}) {
  try {
    if (engine === 'sqljs') throw new Error('sql.js requested');
    const { DatabaseSync } = await import('node:sqlite');
    return new NodeSqliteDb(DatabaseSync, filePath);
  } catch {
    const initSqlJs = (await import('sql.js')).default;
    const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
    const SQL = await initSqlJs({ wasmBinary: readFileSync(wasmPath) });
    return new SqlJsDb(SQL, filePath);
  }
}
