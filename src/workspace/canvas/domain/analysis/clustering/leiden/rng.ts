export type Rng = {
  nextUint32(): number;
  nextFloat01(): number;
  shuffleInPlace<T>(arr: T[]): void;
};

function xorshift32(seed: number): () => number {
  // Ensure non-zero 32-bit seed.
  let x = (seed | 0) >>> 0;
  if (x === 0) x = 0x9e3779b9;

  return () => {
    // xorshift32
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    // force uint32
    return (x >>> 0);
  };
}

export function createRng(seed: number = Date.now()): Rng {
  const next = xorshift32(seed);

  return {
    nextUint32() {
      return next();
    },
    nextFloat01() {
      // [0, 1)
      return next() / 0x1_0000_0000;
    },
    shuffleInPlace<T>(arr: T[]) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(this.nextFloat01() * (i + 1));
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
    },
  };
}
