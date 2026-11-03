/**
 * Seeded PRNG (mulberry32). `seed` advances on every call so state can be persisted and resumed.
 * The seed must be an integer (a 32-bit value); fractional seeds are truncated by the `| 0` step.
 */
export class Rng {
  constructor(public seed: number) {}

  next(): number {
    this.seed = (this.seed + 0x6d2b79f5) | 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick on empty list");
    return items[this.int(items.length)]!;
  }

  sample<T>(items: readonly T[], n: number): T[] {
    const copy = [...items];
    const count = Math.max(0, Math.min(n, copy.length));
    for (let i = 0; i < count; i++) {
      const j = i + this.int(copy.length - i);
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy.slice(0, count);
  }
}
