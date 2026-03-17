import { database } from "../database";

/**
 * Makes tokens.name and tokens.symbol nullable.
 * Security-label tokens (spam, phish-hack, etc.) have no meaningful metadata
 * but their addresses are valuable — we should store them regardless.
 */
export function up() {
  database.exec(`
    CREATE TABLE tokens_new (
      id         INTEGER PRIMARY KEY,
      chain_id   INTEGER NOT NULL,
      address    TEXT NOT NULL,
      label      TEXT NOT NULL,
      name       TEXT,
      symbol     TEXT,
      website    TEXT,
      image      TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);

  database.exec(`INSERT INTO tokens_new SELECT * FROM tokens`);
  database.exec(`DROP TABLE tokens`);
  database.exec(`ALTER TABLE tokens_new RENAME TO tokens`);
  database.exec(`
    CREATE UNIQUE INDEX tokens_address_unique_index ON tokens (chain_id, address, label)
  `);
}

export function down() {
  // Not reverting — rows with null name/symbol would violate the constraint
}
