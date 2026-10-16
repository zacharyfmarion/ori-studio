export interface IndexedBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
type Branch =
  | { bounds: IndexedBounds; ids: number[] }
  | { bounds: IndexedBounds; left: Branch; right: Branch };
/** Immutable broad-phase index. Callers still apply their exact geometric predicate. */
export class BoundsIndex {
  private readonly root: Branch | null;
  constructor(private readonly bounds: readonly IndexedBounds[]) {
    const ids = bounds.map((_, i) => i);
    // Select the middle in place. Sorting every subtree repeatedly costs
    // O(n log² n) comparisons and retains large temporary arrays on dense CPs.
    const partition = (first: number, last: number, middle: number, x: boolean) => {
      const at = (i: number) => {
        const b = bounds[ids[i]!]!;
        return x ? b.minX + b.maxX : b.minY + b.maxY;
      };
      while (first < last) {
        const pivot = at((first + last) >>> 1);
        let i = first,
          j = last;
        while (i <= j) {
          while (at(i) < pivot) i++;
          while (at(j) > pivot) j--;
          if (i <= j) {
            [ids[i], ids[j]] = [ids[j]!, ids[i]!];
            i++;
            j--;
          }
        }
        if (middle <= j) last = j;
        else if (middle >= i) first = i;
        else return;
      }
    };
    const build = (first: number, end: number): Branch => {
      const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (let i = first; i < end; i++) {
        const b = bounds[ids[i]!]!;
        box.minX = Math.min(box.minX, b.minX);
        box.minY = Math.min(box.minY, b.minY);
        box.maxX = Math.max(box.maxX, b.maxX);
        box.maxY = Math.max(box.maxY, b.maxY);
      }
      if (end - first <= 8) return { bounds: box, ids: ids.slice(first, end) };
      const middle = (first + end) >>> 1;
      partition(first, end - 1, middle, box.maxX - box.minX >= box.maxY - box.minY);
      return { bounds: box, left: build(first, middle), right: build(middle, end) };
    };
    this.root = bounds.length ? build(0, bounds.length) : null;
  }
  at(x: number, y: number, epsilon = 0): number[] {
    return this.intersecting({ minX: x - epsilon, minY: y - epsilon, maxX: x + epsilon, maxY: y + epsilon });
  }
  intersecting(box: IndexedBounds): number[] {
    const result: number[] = [];
    const overlaps = (b: IndexedBounds) =>
      box.maxX >= b.minX && box.minX <= b.maxX && box.maxY >= b.minY && box.minY <= b.maxY;
    const visit = (node: Branch) => {
      if (!overlaps(node.bounds)) return;
      if ('ids' in node) {
        for (const id of node.ids) if (overlaps(this.bounds[id]!)) result.push(id);
      } else {
        visit(node.left);
        visit(node.right);
      }
    };
    if (this.root) visit(this.root);
    return result;
  }
}
