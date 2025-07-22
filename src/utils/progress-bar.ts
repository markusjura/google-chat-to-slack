import { Presets, SingleBar } from 'cli-progress';

export class ProgressBar {
  private bar: SingleBar;

  constructor(total: number, label = 'Progress') {
    this.bar = new SingleBar(
      {
        format: `${label}: [{bar}] {value}/{total}`,
        barCompleteChar: '█',
        barIncompleteChar: '░',
        hideCursor: true,
        stopOnComplete: true,
        clearOnComplete: true,
        forceRedraw: true,
      },
      Presets.rect
    );

    this.bar.start(total, 0);
  }

  update(current: number): void {
    this.bar.update(current);
  }

  increment(): void {
    this.bar.increment();
  }

  safeIncrement(): void {
    this.bar.increment();
  }

  finish(): void {
    this.bar.stop();
    // Ensure clean terminal state after progress bar
    process.stdout.write('\n');
  }
}
