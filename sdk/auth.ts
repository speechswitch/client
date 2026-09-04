export interface AwsAuth {
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  readonly sessionToken?: string;
  readonly region?: string;
}

export interface Auth {
  readonly aws?: AwsAuth;
  readonly xai?: { readonly apiKey?: string };
  readonly deepgram?: { readonly apiKey?: string };
  readonly elevenlabs?: { readonly apiKey?: string };
  readonly fish?: { readonly apiKey?: string };
  readonly google?: { readonly apiKey?: string; readonly accessToken?: string };
  readonly gradium?: { readonly apiKey?: string };
  readonly hume?: { readonly apiKey?: string };
  readonly inworld?: { readonly apiKey?: string };
  readonly kugelaudio?: { readonly apiKey?: string };
  readonly lovo?: { readonly apiKey?: string };
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
