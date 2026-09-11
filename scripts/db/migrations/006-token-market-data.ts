import { database } from "../database";

/**
 * Adds the token market columns etherscan already returns on every
 * GetTokensBySubLabel response but which were being discarded:
 *
 * - market_cap: "$13,494,555,949.00" in the API, stored as a whole-dollar integer
 * - holders:    "15,784,457" in the API, stored as an integer
 *
 * Both are point-in-time values, unlike the label itself. They are refreshed on
 * every rescrape and dated by the existing updated_at column rather than kept
 * as a time series.
 */
export function up() {
  database.exec(`ALTER TABLE tokens ADD COLUMN market_cap INTEGER`);
  database.exec(`ALTER TABLE tokens ADD COLUMN holders INTEGER`);
}

export function down() {
  database.exec(`ALTER TABLE tokens DROP COLUMN market_cap`);
  database.exec(`ALTER TABLE tokens DROP COLUMN holders`);
}
