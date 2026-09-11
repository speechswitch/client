export interface AwsAuth {
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  readonly sessionToken?: string;
  readonly region?: string;
}

export interface Auth {
  readonly aws?: AwsAuth;
  readonly deepgram?: {
    /** Falls back to SPEECHSWITCH_DEEPGRAM_API_KEY, then DEEPGRAM_API_KEY. */
    readonly apiKey?: string;
  };
  readonly xai?: {
    /** Falls back to SPEECHSWITCH_XAI_API_KEY, then XAI_API_KEY. */
    readonly apiKey?: string;
  };
}

export function requireAuth<Name extends keyof Auth>(
  auth: Auth,
  name: Name,
): NonNullable<Auth[Name]> {
  const value = auth[name];
  if (value === undefined || value === null) {
    throw new TypeError(`Missing auth.${String(name)} configuration`);
  }
  return value as NonNullable<Auth[Name]>;
}
