import { execSync, spawn } from "child_process";
import "dotenv/config";
import { homedir } from "os";

const CHROME_BIN =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const raw = process.env["CHROME_USER_DATA_DIR"] ?? "~/.chrome-eth-labels";
const userDataDir = raw.startsWith("~") ? raw.replace("~", homedir()) : raw;

// Check if Chrome is already running
const running = execSync("pgrep -x 'Google Chrome' || true").toString().trim();

if (running) {
  console.error(
    "❌ Chrome is already running. Close it first, then run this script again.\n" +
      "   You can quit Chrome from the menu bar or run: killall 'Google Chrome'",
  );
  process.exit(1);
}

console.log(`Launching Chrome with profile: ${userDataDir}`);

spawn(
  CHROME_BIN,
  [`--remote-debugging-port=9222`, `--user-data-dir=${userDataDir}`],
  {
    stdio: "inherit",
  },
);
