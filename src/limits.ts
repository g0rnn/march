/**
 * 동시 실행 에이전트 프로세스 상한.
 *
 * 왜 필요한가: 어댑터는 스레드가 아니라 OS 프로세스를 띄웁니다.
 * 실측 기준 claude 프로세스 하나가 RSS 450MB 정도를 씁니다(컨텍스트가
 * 쌓이면 더 늘어남). 16GB 머신에서 무제한 fan-out 하면 스왑으로 들어갑니다.
 */
export class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (limit < 1) throw new Error(`Semaphore limit must be >= 1, got ${limit}`);
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  private release(): void {
    this.active--;
    this.queue.shift()?.();
  }
}
