import { eventBus, EventTypes } from "./eventBus";

const BUDGET_WINDOW_MS = 60_000;
const MAX_EVENTS_PER_WINDOW = 500;
const BACKPRESSURE_THRESHOLD = 0.9;
const WARNING_THRESHOLD = 0.75;

interface BudgetWindow {
  count: number;
  windowStart: number;
}

class GlobalEventBudget {
  private window: BudgetWindow = { count: 0, windowStart: Date.now() };
  private backpressureActive = false;

  recordEvent(): void {
    this.refreshWindow();
    this.window.count++;

    const ratio = this.window.count / MAX_EVENTS_PER_WINDOW;

    if (ratio >= BACKPRESSURE_THRESHOLD && !this.backpressureActive) {
      this.backpressureActive = true;
      this.emitBudgetWarning("BACKPRESSURE_ENGAGED", ratio);
    } else if (ratio >= WARNING_THRESHOLD && ratio < BACKPRESSURE_THRESHOLD) {
      this.emitBudgetWarning("APPROACHING_LIMIT", ratio);
    }
  }

  isBackpressureActive(): boolean {
    this.refreshWindow();
    const ratio = this.window.count / MAX_EVENTS_PER_WINDOW;
    if (ratio < BACKPRESSURE_THRESHOLD && this.backpressureActive) {
      this.backpressureActive = false;
    }
    return this.backpressureActive;
  }

  getRemainingCapacity(): number {
    this.refreshWindow();
    return Math.max(0, MAX_EVENTS_PER_WINDOW - this.window.count);
  }

  getRecommendedBatchSize(): number {
    const remaining = this.getRemainingCapacity();
    if (remaining === 0) return 0;
    return Math.min(remaining, Math.floor(remaining * 0.5));
  }

  getStatus(): {
    currentCount: number;
    maxPerWindow: number;
    windowMs: number;
    utilizationPercent: number;
    backpressureActive: boolean;
  } {
    this.refreshWindow();
    return {
      currentCount: this.window.count,
      maxPerWindow: MAX_EVENTS_PER_WINDOW,
      windowMs: BUDGET_WINDOW_MS,
      utilizationPercent: Math.round((this.window.count / MAX_EVENTS_PER_WINDOW) * 100),
      backpressureActive: this.backpressureActive,
    };
  }

  private refreshWindow(): void {
    const now = Date.now();
    if (now - this.window.windowStart > BUDGET_WINDOW_MS) {
      this.window = { count: 0, windowStart: now };
      if (this.backpressureActive) {
        this.backpressureActive = false;
      }
    }
  }

  private emitBudgetWarning(level: string, ratio: number): void {
    setImmediate(async () => {
      try {
        await eventBus.emitAndPersist({
          eventType: EventTypes.GLOBAL_BUDGET_WARNING,
          entityType: "global_event_budget",
          payload: {
            level,
            currentCount: this.window.count,
            maxPerWindow: MAX_EVENTS_PER_WINDOW,
            utilizationPercent: Math.round(ratio * 100),
            backpressureActive: this.backpressureActive,
          },
          emittedBy: null,
        });
      } catch (_err) {}
    });
  }
}

export const globalEventBudget = new GlobalEventBudget();
