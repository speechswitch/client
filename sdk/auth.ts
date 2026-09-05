export interface AwsAuth {
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  readonly sessionToken?: string;
  readonly region?: string;
}

export interface Auth {
  readonly deepdub?: { readonly apiKey?: string };
  readonly cartesia?: { readonly apiKey?: string; readonly accessToken?: string };
  readonly camb?: { readonly apiKey?: string };
  readonly async?: { readonly apiKey?: string };
  readonly aws?: AwsAuth;
  readonly xai?: { readonly apiKey?: string };
  readonly deepgram?: { readonly apiKey?: string };
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
