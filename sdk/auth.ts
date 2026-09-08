export interface AwsAuth {
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  readonly sessionToken?: string;
  readonly region?: string;
}

export interface Auth {
  readonly rime?: { readonly apiKey?: string };
  readonly respeecher?: { readonly apiKey?: string };
  /** Hugging Face access token for the Chatterbox Space, not a Resemble cloud API key. */
  readonly resemble?: { readonly token?: string };
  readonly openai?: { readonly apiKey?: string };
  readonly murf?: { readonly apiKey?: string };
  readonly mistral?: { readonly apiKey?: string };
  readonly minimax?: { readonly apiKey?: string };
  readonly microsoft?: { readonly apiKey?: string; readonly accessToken?: string; readonly region?: string };
  readonly lovo?: { readonly apiKey?: string };
  readonly kugelaudio?: { readonly apiKey?: string };
  readonly inworld?: { readonly apiKey?: string; readonly accessToken?: string };
  readonly hume?: { readonly apiKey?: string; readonly accessToken?: string };
  readonly gradium?: { readonly apiKey?: string; readonly singleUseToken?: string };
  readonly google?: { readonly apiKey?: string; readonly accessToken?: string; readonly quotaProject?: string };
  readonly fish?: { readonly apiKey?: string };
  readonly elevenlabs?: { readonly apiKey?: string; readonly singleUseToken?: string };
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
