import { AppError } from '../../src/core/errors/app-error';
import {
  toProviderView,
  type SavedProvider,
} from '../../src/modules/providers/domain/model';
import { validateProvider } from '../../src/modules/providers/domain/validation';
import type { ProviderRepository } from '../../src/modules/providers';
import type {
  ArchivePort,
  ManagementArchive,
} from '../../src/persistence/management-archive';

/** Clone on both sides of the persistence boundary, including JSON's undefined semantics. */
export class MemoryPersistence<T> {
  saveError?: Error;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(public value: T) {}
  async load(): Promise<T> {
    return this.value === undefined
      ? this.value
      : JSON.parse(JSON.stringify(this.value));
  }
  async save(value: T): Promise<void> {
    if (this.saveError) throw this.saveError;
    this.value = JSON.parse(JSON.stringify(value));
  }
  update<R>(change: (value: T) => { values: T; result: R }): Promise<R> {
    const operation = this.queue.then(async () => {
      const { values, result } = change(await this.load());
      await this.save(values);
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
/** Serialized in memory so restart, corrupt data and failed commits remain testable. */
export class MemoryArchive implements ArchivePort {
  json?: string;
  saveError?: Error;
  async load(): ReturnType<ArchivePort['load']> {
    return this.json === undefined ? undefined : JSON.parse(this.json);
  }
  async save(records: ManagementArchive): Promise<void> {
    if (this.saveError) throw this.saveError;
    this.json = JSON.stringify(records);
  }
}

/** Isolated provider fixture; production uses ProviderRepository. */
export class MemoryProviderRepository implements ProviderRepository {
  private values: SavedProvider[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  readonly archive = new MemoryArchive();
  constructor(
    readonly storage = new MemoryPersistence<SavedProvider[] | undefined>(
      undefined,
    ),
  ) {}

  /**
   * Load saved providers from the shared fixture backing.
   * Returns false until the catalog has first been seeded.
   */
  async load(): Promise<void> {
    const saved = await this.storage.load();
    this.values = (saved ?? []).map((item) => validateProvider(item));
  }

  /** Seed initial providers in the shared fixture backing. */
  async seed(initial: SavedProvider[]): Promise<void> {
    return this.mutate(async () => {
      this.values = initial.map((item) => validateProvider(item));
      await this.persist(this.values);
    });
  }

  list() {
    return this.values.map(toProviderView);
  }

  get(id: string) {
    return toProviderView(this.getRuntime(id));
  }

  getRuntime(id: string) {
    const provider = this.values.find((p) => p.id === id);
    if (!provider) throw new AppError('模型服务不存在。', 404);
    return { ...provider };
  }

  private async persist(values: SavedProvider[]) {
    await this.storage.save(values);
  }

  private mutate<T>(fn: () => Promise<T>): Promise<T> {
    const operation = this.queue.then(fn);
    this.queue = operation.catch(() => {});
    return operation;
  }

  save(value: unknown, id?: string) {
    return this.mutate(async () => {
      if (!id && this.values.length >= 20)
        throw new AppError('最多保存 20 个模型服务。');
      const provider = validateProvider(
        value,
        id ? this.getRuntime(id) : undefined,
      );
      if (!id && this.values.some((p) => p.id === provider.id)) {
        throw new AppError('已存在相同 ID 的模型服务。', 409);
      }
      const next = id
        ? this.values.map((p) => (p.id === id ? provider : p))
        : [...this.values, provider];
      await this.persist(next);
      this.values = next;
      return toProviderView(provider);
    });
  }

  remove(id: string) {
    return this.mutate(async () => {
      this.getRuntime(id);
      const next = this.values.filter((p) => p.id !== id);
      await this.persist(next);
      this.values = next;
    });
  }
}

export { bootstrapProviders, createDefaultProviders } from './provider-seed';
