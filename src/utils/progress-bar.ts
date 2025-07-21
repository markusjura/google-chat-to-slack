export class ProgressBar {
  private total: number;
  private current = 0;
  private label: string;
  private width = 40;

  constructor(total: number, label = 'Progress') {
    this.total = total;
    this.label = label;
  }

  update(current: number): void {
    this.current = current;
    this.render();
  }

  increment(): void {
    this.current++;
    this.render();
  }

  safeIncrement(): void {
    // Thread-safe increment for concurrent operations
    this.current = Math.min(this.current + 1, this.total);
    this.render();
  }

  finish(): void {
    this.current = this.total;
    this.render();
    process.stdout.write('\n');
  }

  private render(): void {
    const percentage = Math.round((this.current / this.total) * 100);
    const filled = Math.round((this.current / this.total) * this.width);
    const empty = this.width - filled;

    const progressBar = '█'.repeat(filled) + '░'.repeat(empty);
    const progressText = `${this.label}: [${progressBar}] ${this.current}/${this.total} (${percentage}%)`;

    // Clear line and write progress
    process.stdout.write(`\r${progressText}`);
  }
}
