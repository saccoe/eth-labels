import "dotenv/config";
import { BrowserFetcher } from "./browser-fetch";
import { ChainPuller } from "./ChainPuller";
import { getChainConfig, SOLSCAN_SENTINEL } from "./cli";
import { ensureSignedIn } from "./ensure-signed-in";
import { SolscanPuller } from "./SolscanPuller";
import { parseError } from "./utils/error-parse";

void (async () => {
  const browserFetcher = new BrowserFetcher();
  try {
    console.log("\n🔗 Connecting to Chrome browser...");
    await browserFetcher.init();

    const config = await getChainConfig();

    // Process chains sequentially to avoid overwhelming the browser tab
    for (const chain of config.chains) {
      if (chain === SOLSCAN_SENTINEL) {
        // SolscanPuller primes its own origin — solscan.io is not a *scan
        // explorer and setActiveOrigin's /labelcloud probe does not apply.
        const puller = new SolscanPuller(browserFetcher);
        await puller.pullAndWriteAllLabels();
      } else {
        await browserFetcher.setActiveOrigin(chain.website);
        await ensureSignedIn(browserFetcher, chain.website);
        const chainPuller = await ChainPuller.init(chain, browserFetcher);
        await chainPuller.pullAndWriteAllLabels();
      }
    }

    console.log("\n🎉 All done!");
    process.exit(0);
  } catch (error) {
    parseError(error);
    process.exit(1);
  } finally {
    await browserFetcher.close();
  }
})();
