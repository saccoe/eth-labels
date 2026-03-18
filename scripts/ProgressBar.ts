import cliProgress from "cli-progress";

const FORMAT = "{name} {bar} {value}/{total} | ETA: {eta}s";

export class ProgressBar {
  #multi = new cliProgress.MultiBar(
    { clearOnComplete: false, hideCursor: true, format: FORMAT },
    cliProgress.Presets.shades_classic,
  );
  #labelBar = this.#multi.create(0, 0, { name: "labels  " });
  #addressBar = this.#multi.create(0, 0, { name: "        " });

  public start(total: number, startValue = 0) {
    this.#labelBar.setTotal(total);
    this.#labelBar.update(startValue);
  }

  public step() {
    this.#labelBar.increment();
  }

  public startLabel(name: string, total: number) {
    this.#addressBar.update(0, { name: name.slice(0, 8).padEnd(8) });
    this.#addressBar.setTotal(total);
  }

  public stepAddress() {
    this.#addressBar.increment();
  }

  public update(value: number) {
    this.#labelBar.update(value);
  }

  public stop() {
    this.#multi.stop();
  }
}
