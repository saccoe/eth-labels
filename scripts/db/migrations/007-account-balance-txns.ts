import { database } from "../database";

/**
 * Adds the two account columns etherscan renders on every label page but which
 * were being discarded:
 *
 * - balance:   the native-currency balance, e.g. "0.016363656115590326"
 * - txn_count: the transaction count, e.g. 17017901
 *
 * balance is TEXT rather than a number on purpose. The tooltip carries full
 * 18-decimal precision, which REAL cannot represent exactly, and the wei
 * integer for a large balance exceeds SQLite's signed 64-bit INTEGER. The unit
 * is dropped because it follows from chain_id (ETH, BNB, MATIC, ...).
 *
 * Both are point-in-time values, refreshed on rescrape and dated by updated_at.
 */
export function up() {
  database.exec(`ALTER TABLE accounts ADD COLUMN balance TEXT`);
  database.exec(`ALTER TABLE accounts ADD COLUMN txn_count INTEGER`);
}

export function down() {
  database.exec(`ALTER TABLE accounts DROP COLUMN balance`);
  database.exec(`ALTER TABLE accounts DROP COLUMN txn_count`);
}
