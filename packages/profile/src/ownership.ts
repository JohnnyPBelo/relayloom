import { closeSync, lstatSync, openSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

const APPLICATION = 0x524c504c;
const SCHEMA =
  "CREATE TABLE ownership (version INTEGER PRIMARY KEY CHECK(version = 1))";

/** A cooperating running process owns a profile until close or actual OS exit.
 * This lock stores no identity/content and never recovers by killing a PID. */
export class ProfileOwnership {
  private database?: DatabaseSync;
  constructor(directory: string) {
    const path = join(directory, "profile-owner.sqlite");
    try {
      closeSync(openSync(path, "wx", 0o600));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const info = lstatSync(path);
    if (!info.isFile() || info.size > 65536)
      throw new Error("Ficheiro de exclusividade do perfil inválido");
    const db = new DatabaseSync(path);
    let active = false;
    try {
      db.exec(
        "PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=0; PRAGMA synchronous=FULL; PRAGMA temp_store=MEMORY",
      );
      db.exec("BEGIN EXCLUSIVE");
      active = true;
      const application = Number(
        db.prepare("PRAGMA application_id").get()?.application_id,
      );
      const version = Number(
        db.prepare("PRAGMA user_version").get()?.user_version,
      );
      const schema = db
        .prepare(
          "SELECT name,sql FROM sqlite_schema WHERE substr(name,1,7) != 'sqlite_' ORDER BY name",
        )
        .all();
      if (application === 0 && version === 0 && schema.length === 0) {
        // A process killed during the very first initialization may leave a
        // genuinely empty database. It is safe to initialize under this lock.
        db.exec(
          `PRAGMA application_id=${APPLICATION}; PRAGMA user_version=1; ${SCHEMA}; INSERT INTO ownership(version) VALUES(1);`,
        );
        db.exec("COMMIT");
        active = false;
        db.exec("BEGIN EXCLUSIVE");
        active = true;
      }
      const current = db
        .prepare(
          "SELECT name,sql FROM sqlite_schema WHERE substr(name,1,7) != 'sqlite_' ORDER BY name",
        )
        .all();
      if (
        Number(db.prepare("PRAGMA application_id").get()?.application_id) !==
          APPLICATION ||
        Number(db.prepare("PRAGMA user_version").get()?.user_version) !== 1 ||
        db.prepare("PRAGMA journal_mode").get()?.journal_mode !== "delete" ||
        current.length !== 1 ||
        current[0].name !== "ownership" ||
        current[0].sql !== SCHEMA
      ) {
        throw new Error("Formato de exclusividade do perfil inválido");
      }
      const rows = db.prepare("SELECT version FROM ownership").all();
      if (rows.length !== 1 || rows[0].version !== 1)
        throw new Error("Estado de exclusividade do perfil inválido");
      this.database = db;
    } catch (error) {
      if (active) {
        try {
          db.exec("ROLLBACK");
        } catch {}
      }
      db.close();
      if (
        (error as any).errcode === 5 ||
        /database is locked/.test((error as Error).message)
      )
        throw new Error(
          "Este perfil já está aberto noutro processo. Feche-o antes de voltar a abrir.",
          { cause: error },
        );
      throw error;
    }
  }
  close() {
    const database = this.database;
    if (!database) return;
    this.database = undefined;
    try {
      database.exec("ROLLBACK");
    } finally {
      database.close();
    }
  }
}
