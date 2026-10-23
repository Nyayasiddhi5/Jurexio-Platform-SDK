export class ParallelExecutionEngine {
  async runParallel<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
    return Promise.all(tasks.map(t => t()));
  }
}
