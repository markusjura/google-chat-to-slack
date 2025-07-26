import { MultiBar, Presets, SingleBar } from 'cli-progress';

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

export class MultiChannelProgressManager {
  private multiBar: MultiBar;
  private channelBars: Map<string, SingleBar> = new Map();

  constructor() {
    this.multiBar = new MultiBar(
      {
        hideCursor: true,
        clearOnComplete: true,
        forceRedraw: true,
        format: '{channel} [{bar}] {value}/{total} messages',
        barCompleteChar: '█',
        barIncompleteChar: '░',
      },
      Presets.rect
    );
  }

  addChannel(channelName: string, total: number): void {
    const bar = this.multiBar.create(total, 0, {
      channel: `#${channelName}`.padEnd(20, ' '),
    });
    this.channelBars.set(channelName, bar);
  }

  updateChannel(channelName: string, current: number): void {
    const bar = this.channelBars.get(channelName);
    if (bar) {
      bar.update(current);
    }
  }

  incrementChannel(channelName: string): void {
    const bar = this.channelBars.get(channelName);
    if (bar) {
      bar.increment();
    }
  }

  finish(): void {
    this.multiBar.stop();
    // Ensure clean terminal state after progress bars
    process.stdout.write('\n');
  }
}
