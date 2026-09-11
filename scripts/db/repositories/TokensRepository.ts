import type {
  ExpressionBuilder,
  OnConflictDatabase,
  OnConflictTables,
} from "kysely";
import type { Address } from "viem";
import { z } from "zod";
import { db } from "../database";
import type { Database, NewToken, TokenSearchOptions } from "../types";

/**
 * Columns refreshed when a rescrape hits an existing (chainId, address, label).
 *
 * market_cap and holders are point-in-time, so they must be rewritten for
 * updated_at to mean anything; image is included because its stored form
 * changed from a root-relative path to an absolute URL.
 *
 * name, symbol and website are deliberately NOT refreshed: symbol is
 * backfilled on-chain by ChainPuller when the API omits it, and overwriting
 * from a later response that lacks it would discard that work.
 */
const refreshOnConflict = (
  eb: ExpressionBuilder<
    OnConflictDatabase<Database, "tokens">,
    OnConflictTables<"tokens">
  >,
) => ({
  updated_at: new Date().toISOString(),
  marketCap: eb.ref("excluded.marketCap"),
  holders: eb.ref("excluded.holders"),
  image: eb.ref("excluded.image"),
});

export class TokensRepository {
  private static allColumns = [
    "tokens.address",
    "tokens.chainId",
    "tokens.label",
    "tokens.name",
    "tokens.symbol",
    "tokens.website",
    "tokens.image",
  ] as const;

  public static selectAllTokens() {
    return db
      .selectFrom("tokens")
      .select(TokensRepository.allColumns)
      .orderBy("tokens.chainId asc")
      .orderBy("tokens.label asc")
      .execute();
  }

  public static selectTokensByLabel(label: string) {
    return db
      .selectFrom("tokens")
      .select(this.allColumns)
      .where("label", "=", label)
      .execute();
  }

  public static selectTokensByAddress(address: Address) {
    return db
      .selectFrom("tokens")
      .select(this.allColumns)
      .where("address", "=", address.toLowerCase() as Address)
      .execute();
  }

  public static selectAllLabels = async () => {
    const allRows = await db
      .selectFrom("tokens")
      .select(["label"])
      .distinct()
      .orderBy("label")
      .execute();
    return allRows.map((row) => row.label);
  };

  public static selectMissingSymbols = () => {
    return db
      .selectFrom("tokens")
      .selectAll()
      .where("symbol", "=", "")
      .execute();
  };

  public static selectMissingNames = () => {
    return db.selectFrom("tokens").selectAll().where("name", "=", "").execute();
  };

  public static updateTokenSymbol(id: number, symbol: string) {
    return db
      .updateTable("tokens")
      .set({ symbol, updated_at: new Date().toISOString() })
      .where("id", "=", id)
      .execute();
  }

  public static updateTokenName(id: number, name: string) {
    return db
      .updateTable("tokens")
      .set({ name, updated_at: new Date().toISOString() })
      .where("id", "=", id)
      .execute();
  }

  public static insertToken(newToken: NewToken) {
    return db
      .insertInto("tokens")
      .values(newToken)
      .onConflict((oc) =>
        oc
          .column("chainId")
          .column("address")
          .column("label")
          .doUpdateSet(refreshOnConflict),
      )
      .execute();
  }

  public static async computeLastModifiedDate(chainId: number) {
    const result = await db
      .selectFrom("tokens")
      .select(({ fn }) => [fn.max("updated_at").as("latest_updated_at")])
      .where("chainId", "=", chainId)
      .executeTakeFirst();

    return z.string().parse(result?.latest_updated_at);
  }

  public static async insertTokens(newTokens: Array<NewToken>) {
    const MAX_ROW_INSERT_LENGTH = 1_000;
    let remainingRows = newTokens;
    do {
      const rowsToInsert = remainingRows.slice(0, MAX_ROW_INSERT_LENGTH);
      remainingRows = remainingRows.slice(MAX_ROW_INSERT_LENGTH);
      await db
        .insertInto("tokens")
        .values(rowsToInsert)
        .onConflict((oc) =>
          oc
            .column("chainId")
            .column("address")
            .column("label")
            .doUpdateSet(refreshOnConflict),
        )
        .execute();
    } while (remainingRows.length > 0);
  }

  public static selectTokensByObj(tokenSearchOptions: TokenSearchOptions) {
    let query = db.selectFrom("tokens").select(this.allColumns);
    for (const [key, value] of Object.entries(tokenSearchOptions)) {
      const verifiedKey = key as
        | `address`
        | `chainId`
        | `label`
        | `name`
        | `website`
        | `symbol`;
      if (this.allColumns.includes(`tokens.${verifiedKey}`) && value) {
        if (key === "name" || key === "symbol") {
          query = query.where(key, "like", `%${value}%`);
        } else {
          query = query.where(verifiedKey, "=", value.toLowerCase());
        }
      }
    }
    return query.execute();
  }
}
