import { createInterface } from "readline";
import type { BrowserFetcher } from "./browser-fetch";

/**
 * *scan account label pages render an error page instead of the results table
 * when the browser profile is signed out, and the HTML parsers quietly return
 * zero rows for it. That looks identical to "this label is empty", so a
 * signed-out scrape silently writes nothing. Check up front instead.
 */
export async function isSignedIn(
  fetcher: BrowserFetcher,
  website: string,
): Promise<boolean> {
  const html = await fetcher.fetchHtml(`${website}/login`);
  // The login page redirects to /myaccount when a session is already active.
  return /myaccount/i.test(html) && !/<input[^>]+type="password"/i.test(html);
}

function promptEnter(question: string): Promise<void> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, () => {
      rl.close();
      resolve();
    });
  });
}

/**
 * Verify the browser profile has a live session for `website`, and give the
 * operator a chance to sign in if not. Non-blocking in non-interactive runs.
 *
 * Returns whether the scrape is running signed in. Token pulls work signed
 * out; account pulls do not, so this warns rather than throws.
 */
export async function ensureSignedIn(
  fetcher: BrowserFetcher,
  website: string,
): Promise<boolean> {
  if (await isSignedIn(fetcher, website)) {
    console.log(`  🔓 Signed in to ${website}`);
    return true;
  }

  if (!process.stdin.isTTY) {
    console.warn(
      `\n  ⚠️  Not signed in to ${website} and no TTY to prompt on.\n` +
        `      Account labels will come back EMPTY. Token labels still work.\n`,
    );
    return false;
  }

  console.log(
    `\n  ⚠️  Not signed in to ${website}.\n` +
      `      Account label pages return an error page when signed out, which\n` +
      `      parses as zero rows — the scrape would look like it worked.\n\n` +
      `      A Chrome window is already open on this profile. Sign in there,\n` +
      `      then come back to this terminal.\n`,
  );

  for (let attempt = 1; attempt <= 3; attempt++) {
    await promptEnter("      Press Enter once you have signed in... ");
    if (await isSignedIn(fetcher, website)) {
      console.log(`  🔓 Signed in to ${website}`);
      return true;
    }
    console.log(
      `      Still signed out (attempt ${attempt}/3).` +
        (attempt < 3 ? " Try again." : ""),
    );
  }

  console.warn(
    `\n  ⚠️  Continuing signed out. Account labels will be EMPTY.\n`,
  );
  return false;
}
