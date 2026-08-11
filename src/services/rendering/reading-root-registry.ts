/** Small owner-aware registry used by the Reading whitespace state machine. */
export class ReadingRootRegistry<T> {
  private readonly values = new Map<HTMLElement, T>();

  public get(root: HTMLElement): T | undefined { return this.values.get(root); }
  public set(root: HTMLElement, value: T): this { this.values.set(root, value); return this; }
  public delete(root: HTMLElement): boolean { return this.values.delete(root); }
  public keys(): ReturnType<Map<HTMLElement, T>['keys']> { return this.values.keys(); }
  public clear(): void { this.values.clear(); }
}
