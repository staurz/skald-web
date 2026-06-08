// WSL-only test shim: adapts Node's built-in `node:sqlite` to the subset of the
// better-sqlite3 API this repo uses, so the DB-touching vitest suites can run
// under WSL — where the installed better-sqlite3 binary is a Windows DLL and
// fails to load (invalid ELF header).
//
// This is NEVER used by the app or by `npm test`. It is wired in ONLY through
// `vitest.shim.config.ts` (run via `npm run test:wsl`), which aliases the
// `better-sqlite3` import to this file. On Windows, everything keeps using the
// real native binary. Requires `node --experimental-sqlite` (set by the script).
import { DatabaseSync } from 'node:sqlite';

class Stmt {
  constructor(stmt) {
    this._stmt = stmt;
  }
  // better-sqlite3 accepts either positional args or a single named-params
  // object ({ id: ... } binding to @id). node:sqlite accepts both the same way.
  run(...args) {
    return this._stmt.run(...args);
  }
  get(...args) {
    return this._stmt.get(...args);
  }
  all(...args) {
    return this._stmt.all(...args);
  }
}

export default class Database {
  constructor(path, opts = {}) {
    this._db = new DatabaseSync(path ?? ':memory:', { readOnly: !!opts.readonly });
  }

  // better-sqlite3's db.pragma('foo = bar'); we only ever use it for side effects
  // (journal_mode, foreign_keys), so translate to a PRAGMA exec.
  pragma(str) {
    this._db.exec(`PRAGMA ${str};`);
    return [];
  }

  exec(sql) {
    this._db.exec(sql);
    return this;
  }

  prepare(sql) {
    return new Stmt(this._db.prepare(sql));
  }

  // better-sqlite3 returns a callable that runs fn inside a transaction.
  transaction(fn) {
    const db = this._db;
    return (...args) => {
      db.exec('BEGIN');
      try {
        const result = fn(...args);
        db.exec('COMMIT');
        return result;
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {
          /* ignore rollback failure */
        }
        throw err;
      }
    };
  }

  close() {
    this._db.close();
  }
}
