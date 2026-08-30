export type SignedMode = 'penalty' | 'signed-modularity';

export type SignedOptions = {
  signedMode: SignedMode;
  /** Only used in penalty mode. Default 1. */
  lambda?: number;
};

export function normalizeSignedOptions(options: Partial<SignedOptions> | undefined): Required<SignedOptions> {
  const signedMode: SignedMode = options?.signedMode ?? 'penalty';
  const lambdaRaw = options?.lambda;
  const lambda = Number.isFinite(lambdaRaw) && (lambdaRaw as number) >= 0 ? (lambdaRaw as number) : 1;
  return { signedMode, lambda };
}
