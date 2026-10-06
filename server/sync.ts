import type { LibrarySettings, SyncState } from "../shared/prompts.ts";

type Timer = ReturnType<typeof setTimeout>;

type Result = { message: string };

export type SchedulerOptions<R extends Result> = {
  /** Reads the saved library settings. */
  settings: () => Promise<LibrarySettings>;
  /** Reports whether the library directory has a Git repository yet. */
  initialized: (settings: LibrarySettings) => Promise<boolean>;
  sync: (settings: LibrarySettings) => Promise<R>;
  /** Runs after each successful sync, for example to drop cached prompts. */
  synced?: () => void;
  debounceMs?: number;
  openThrottleMs?: number;
  now?: () => number;
};

/** Runs Git sync on request, after changes, or on an interval, never more than one at a time. */
export class SyncScheduler<R extends Result = Result> {
  private readonly options: SchedulerOptions<R>;
  private current: LibrarySettings | null = null;
  private active: Promise<R> | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private again = false;
  private debounce: Timer | null = null;
  private interval: Timer | null = null;
  private nextAt: number | null = null;
  private lastAttemptAt = 0;
  private state = { running: false, lastSyncedAt: null as string | null, lastError: "", lastMessage: "" };

  constructor(options: SchedulerOptions<R>) {
    this.options = options;
  }

  private now() { return (this.options.now ?? Date.now)(); }

  private automatic() {
    return Boolean(this.current?.gitEnabled && this.current.syncMode !== "manual");
  }

  /** Reloads settings and restarts the interval timer. Call after settings change. */
  async reload() {
    this.current = await this.options.settings();
    this.stopTimers();
    const settings = this.current;
    if (settings.gitEnabled && settings.syncMode === "interval") {
      const period = settings.syncInterval * 60_000;
      this.nextAt = this.now() + period;
      this.interval = setInterval(() => {
        this.nextAt = this.now() + period;
        this.trigger();
      }, period);
      this.interval.unref?.();
    }
  }

  /** Call after a prompt write. Syncs once writes settle when the mode is "changes". */
  changed() {
    if (!this.current?.gitEnabled || this.current.syncMode !== "changes") return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      this.trigger();
    }, this.options.debounceMs ?? 5_000);
    this.debounce.unref?.();
  }

  /** Call when the library opens. Pulls in the background unless a sync ran recently. */
  async opened() {
    if (this.automatic() && this.now() - this.lastAttemptAt >= (this.options.openThrottleMs ?? 120_000)) this.trigger();
    return this.snapshot();
  }

  /** Syncs now and waits for the result. Joins a sync that is already running. */
  syncNow() { return this.run(); }

  /** Starts a background sync. Errors are recorded in the state, not thrown. */
  trigger() {
    void (async () => {
      const settings = this.current;
      if (!settings?.gitEnabled || !await this.options.initialized(settings)) return;
      await this.run();
    })().catch(() => undefined);
  }

  async snapshot(): Promise<SyncState> {
    const settings = this.current ?? await this.options.settings();
    return {
      enabled: settings.gitEnabled,
      initialized: settings.gitEnabled && await this.options.initialized(settings).catch(() => false),
      mode: settings.syncMode,
      interval: settings.syncInterval,
      ...this.state,
      nextSyncAt: this.interval && this.nextAt ? new Date(this.nextAt).toISOString() : null,
    };
  }

  private run() {
    if (this.active) {
      this.again = true;
      return this.active;
    }
    this.active = (async () => {
      try {
        let result: R;
        do {
          this.again = false;
          result = await this.exclusive(() => this.once());
        } while (this.again);
        return result;
      } finally {
        this.active = null;
      }
    })();
    return this.active;
  }

  /** Runs an operation between syncs, for example changing the remote, so neither sees the other half done. */
  exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async once() {
    this.lastAttemptAt = this.now();
    this.state.running = true;
    try {
      const result = await this.options.sync(this.current ?? await this.options.settings());
      this.state.lastSyncedAt = new Date(this.now()).toISOString();
      this.state.lastError = "";
      this.state.lastMessage = result.message;
      this.options.synced?.();
      return result;
    } catch (error) {
      this.state.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.state.running = false;
    }
  }

  private stopTimers() {
    if (this.debounce) clearTimeout(this.debounce);
    if (this.interval) clearInterval(this.interval);
    this.debounce = null;
    this.interval = null;
    this.nextAt = null;
  }

  dispose() {
    this.stopTimers();
    this.current = null;
  }
}
