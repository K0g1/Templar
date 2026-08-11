import type { TemplarSettings } from '../types';
import { clone } from '../utils/value';
import { normalizeSettings } from '../templates/settings';

/**
 * Owns the durable boundary for plugin settings.
 *
 * Callers edit a draft. The stable `current` object is changed only after the
 * normalized candidate has been persisted successfully. Transactions are
 * serialized so the order users requested is also the order written to disk.
 */
export class SettingsStore {
  public readonly current: TemplarSettings;
  private tail: Promise<void> = Promise.resolve();

  public constructor(
    initial: TemplarSettings,
    private readonly persist: (value: TemplarSettings) => Promise<void>,
  ) {
    this.current = initial;
  }

  public transaction<T>(mutate: (draft: TemplarSettings) => T): Promise<T> {
    const run = this.tail.then(async () => {
      const draft = clone(this.current);
      const result = mutate(draft);
      const candidate = normalizeSettings(draft);
      // Never hand the live object to an adapter that might retain or mutate
      // it while the transaction is still being committed.
      await this.persist(clone(candidate));
      Object.assign(this.current, candidate);
      return result;
    });
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  /** Persist the already-committed value for compatibility with integrations. */
  public persistCurrent(): Promise<void> {
    return this.transaction(() => undefined);
  }
}
