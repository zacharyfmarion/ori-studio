/**
 * Which design the store is currently showing, for the engine runtimes.
 *
 * Registered by the store at init rather than imported, because the runtimes sit
 * *below* the store and importing it would close a cycle. Both runtimes read the
 * same source: "which design does this call belong to" is one question, and two
 * answers could disagree.
 *
 * `kind` is null while the tab is still on the chooser, and that tab is still a
 * real design with a real id. Consumers that need a kind check for one; the ones
 * that are *establishing* a design (and therefore run before the tab is marked)
 * need only the id.
 */
export interface ActiveDesignRef {
  id: string;
  kind: string | null;
}

let read: () => ActiveDesignRef | null = () => null;

export function registerActiveDesignSource(source: () => ActiveDesignRef | null): void {
  read = source;
}

export function readActiveDesign(): ActiveDesignRef | null {
  return read();
}
