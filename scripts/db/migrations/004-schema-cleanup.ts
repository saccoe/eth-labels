import { database } from "../database";
/**
 * - Deduplicates tokens on (chain_id, address, label) and restores unique index lost in migration 003
 * - Deduplicates accounts on (chain_id, address, label) and removes name_tag from unique index
 *   (name_tag is nullable, which breaks ON CONFLICT detection in SQLite)
 */
export function up() {
  database.exec(`
    DELETE FROM tokens
    WHERE id NOT IN (
      SELECT MAX(id) FROM tokens GROUP BY chain_id, address, label
    )
  `);

  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS tokens_address_unique_index
    ON tokens (chain_id, address, label)
  `);

  database.exec(`
    DELETE FROM accounts
    WHERE id NOT IN (
      SELECT MAX(id) FROM accounts GROUP BY chain_id, address, label
    )
  `);

  database.exec(`DROP INDEX IF EXISTS accounts_address_unique_index`);
  database.exec(`
    CREATE UNIQUE INDEX accounts_address_unique_index
    ON accounts (chain_id, address, label)
  `);
}

export function down() {
  database.exec(`DROP INDEX IF EXISTS tokens_address_unique_index`);
  database.exec(`DROP INDEX IF EXISTS accounts_address_unique_index`);
  database.exec(`
    CREATE UNIQUE INDEX accounts_address_unique_index
    ON accounts (chain_id, address, label, name_tag)
  `);
}
