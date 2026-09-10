import { homedir } from "os";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { z } from "zod";

function getChromeUserDataDir(): string {
  const raw = process.env["CHROME_USER_DATA_DIR"] ?? "~/.chrome-eth-labels";
  return raw.startsWith("~") ? raw.replace("~", homedir()) : raw;
}

/**
 * BrowserFetcher - Makes HTTP requests through a real Chrome browser via CDP.
 *
 * Cloudflare blocks all out-of-browser requests (Node.js fetch, curl, etc.)
 * because it fingerprints TLS handshakes (JA3/JA4). The only way to make
 * requests to Cloudflare-protected endpoints is through a real browser.
 *
 * This class connects to an already-running Chrome instance (e.g. Clawdbot's
 * managed browser at port 18800) and uses page.evaluate(fetch(...)) to make
 * requests from within the browser context.
 */
export class BrowserFetcher {
  #browser: Browser | null = null;
  #page: Page | null = null;
  #ready = false;
  #activeOrigin: string | null = null;

  /**
   * Connect to a running Chrome instance and prepare for fetching.
   */
  public async init(): Promise<void> {
    const endpoints = [
      "http://127.0.0.1:18800/json/version", // Clawdbot managed browser
      "http://127.0.0.1:9222/json/version", // Standard Chrome DevTools
    ];

    for (const endpoint of endpoints) {
      try {
        const resp = await fetch(endpoint);
        const data = z
          .object({ webSocketDebuggerUrl: z.string().optional() })
          .parse(await resp.json());
        const wsUrl = data.webSocketDebuggerUrl;
        if (wsUrl) {
          console.log(`  ✅ Found Chrome at ${endpoint}`);
          this.#browser = await puppeteer.connect({
            browserWSEndpoint: wsUrl,
            defaultViewport: null,
          });
          this.#page = await this.#browser.newPage();

          await this.setActiveOrigin("https://etherscan.io");

          this.#ready = true;
          console.log("  ✅ Browser fetch ready\n");
          return;
        }
      } catch {
        // try next endpoint
      }
    }

    const userDataDir = getChromeUserDataDir();
    throw new Error(
      "No Chrome instance found. Launch Chrome in a separate terminal with:\n" +
        `  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 --user-data-dir="${userDataDir}"`,
    );
  }

  #requirePage(): Page {
    if (!this.#page) throw new Error("BrowserFetcher not initialized");
    return this.#page;
  }

  #isConnectionError(e: unknown): boolean {
    const msg = e instanceof Error ? e.message : String(e);
    return (
      msg.includes("detached") ||
      msg.includes("Target closed") ||
      msg.includes("Session closed")
    );
  }

  /**
   * Rebuild the CDP connection after Chrome drops it mid-scrape.
   * Clears the primed origin so the caller's re-prime actually re-runs.
   */
  async #reconnect(): Promise<void> {
    console.log("  🔄 Browser connection lost — reconnecting...");
    this.#ready = false;
    this.#page = null;
    this.#browser = null;
    this.#activeOrigin = null;
    await this.init();
  }

  /**
   * Prime Cloudflare/session state for a target origin.
   * Must be called when switching chains (different explorer domains).
   */
  public async setActiveOrigin(originOrUrl: string): Promise<void> {
    const page = this.#requirePage();

    const origin = new URL(originOrUrl).origin;
    if (this.#activeOrigin === origin) return;

    console.log(`  🔐 Establishing Cloudflare clearance for ${origin}...`);
    await page.goto(`${origin}/labelcloud`, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    const title = await page.title();
    if (title.includes("Just a moment")) {
      console.log("  ⏳ Solving Cloudflare challenge...");
      await page.waitForFunction(
        () => !document.title.includes("Just a moment"),
        { timeout: 30000 },
      );
      // Give the site a moment to set cookies/session state after challenge.
      await new Promise((r) => setTimeout(r, 1500));
    }

    this.#activeOrigin = origin;
  }

  /**
   * Re-establish the connection and re-prime `origin`, then hand back a
   * usable page. Only call this after #isConnectionError has matched.
   */
  async #recoverTo(origin: string): Promise<Page> {
    await this.#reconnect();
    await this.setActiveOrigin(origin);
    return this.#requirePage();
  }

  /**
   * Fetch HTML content through the browser.
   */
  public async fetchHtml(url: string): Promise<string> {
    if (!this.#ready) throw new Error("BrowserFetcher not initialized");

    const origin = new URL(url).origin;
    if (this.#activeOrigin !== origin) {
      await this.setActiveOrigin(origin);
    }

    // Navigation-based fetch is slower than page.evaluate(fetch), but far more
    // reliable across explorers and Cloudflare policies.
    let page = this.#requirePage();
    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    } catch (e) {
      if (!this.#isConnectionError(e)) throw e;
      page = await this.#recoverTo(origin);
      await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    }

    const title = await page.title();
    if (title.includes("Just a moment")) {
      await page.waitForFunction(
        () => !document.title.includes("Just a moment"),
        { timeout: 30000 },
      );
      await new Promise((r) => setTimeout(r, 1500));
    }

    return await page.content();
  }

  /**
   * Fetch a URL using only page.evaluate(fetch(...)) — no navigation fallback.
   * Use this for cross-origin API calls (e.g. api-v2.solscan.io called from
   * solscan.io) where falling back to page.goto would trigger Cloudflare on
   * the API domain. The caller is responsible for priming the *page* origin
   * (via setActiveOrigin) that is allowed to call this API.
   */
  public async fetchFromPageContext(url: string): Promise<string> {
    if (!this.#ready) throw new Error("BrowserFetcher not initialized");

    const evaluateFetch = (page: Page) =>
      page.evaluate(async (fetchUrl: string) => {
        const res = await fetch(fetchUrl);
        return { status: res.status, text: await res.text() };
      }, url);

    let result: { status: number; text: string };
    try {
      result = await evaluateFetch(this.#requirePage());
    } catch (e) {
      if (!this.#isConnectionError(e)) throw e;
      // Preserve whichever origin the page was on — that is what makes this
      // cross-origin call allowed.
      const origin = this.#activeOrigin ?? new URL(url).origin;
      result = await evaluateFetch(await this.#recoverTo(origin));
    }

    if (result.status !== 200) {
      throw new Error(`fetchFromPageContext: HTTP ${result.status} for ${url}`);
    }

    return result.text;
  }

  /**
   * POST JSON through the browser (for token API calls).
   */
  public async postJson(url: string, body: string): Promise<string> {
    if (!this.#ready) throw new Error("BrowserFetcher not initialized");

    const origin = new URL(url).origin;
    if (this.#activeOrigin !== origin) {
      await this.setActiveOrigin(origin);
    }

    const attemptPost = (page: Page) =>
      page.evaluate(
        async (fetchUrl: string, fetchBody: string) => {
          const res = await fetch(fetchUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Requested-With": "XMLHttpRequest",
            },
            body: fetchBody,
          });
          return { status: res.status, text: await res.text() };
        },
        url,
        body,
      );

    const postWithReconnect = async () => {
      try {
        return await attemptPost(this.#requirePage());
      } catch (e) {
        if (!this.#isConnectionError(e)) throw e;
        return await attemptPost(await this.#recoverTo(origin));
      }
    };

    let result = await postWithReconnect();
    if (result.status !== 200 || result.text.includes("Just a moment...")) {
      // Re-prime once and retry the POST.
      this.#activeOrigin = null;
      await this.setActiveOrigin(origin);
      result = await postWithReconnect();
    }

    if (result.status !== 200 || result.text.includes("Just a moment...")) {
      throw new Error(
        `Cloudflare blocked POST to ${url} (status ${result.status})`,
      );
    }

    return result.text;
  }

  /**
   * Navigate to a URL in the browser and return the rendered HTML.
   * Use this when fetch() gets blocked — full page navigation always works.
   */
  public async navigateAndGetHtml(url: string): Promise<string> {
    const page = this.#requirePage();

    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    this.#activeOrigin = new URL(url).origin;

    const title = await page.title();
    if (title.includes("Just a moment")) {
      await page.waitForFunction(
        () => !document.title.includes("Just a moment"),
        { timeout: 30000 },
      );
    }

    return await page.content();
  }

  /**
   * Close the browser tab (not the browser itself).
   */
  public async close(): Promise<void> {
    if (this.#page) {
      await this.#page.close();
      this.#page = null;
    }
    if (this.#browser) {
      void this.#browser.disconnect();
      this.#browser = null;
    }
    this.#ready = false;
    this.#activeOrigin = null;
  }
}
