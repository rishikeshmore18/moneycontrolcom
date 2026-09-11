// AES-GCM encryption for Plaid access tokens. Server-only.
const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function getKey(): Promise<CryptoKey> {
  const raw = process.env["PLAID_TOKEN_ENC_KEY"];
  if (!raw) throw new Error("Missing PLAID_TOKEN_ENC_KEY");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(raw));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function toB64(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}

function fromB64(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encryptToken(token: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(token));
  return `${toB64(iv)}.${toB64(new Uint8Array(ct))}`;
}

export async function decryptToken(payload: string): Promise<string> {
  const [ivPart, ctPart] = payload.split(".");
  if (!ivPart || !ctPart) throw new Error("Malformed encrypted token");
  const key = await getKey();
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(ivPart) },
    key,
    fromB64(ctPart),
  );
  return decoder.decode(pt);
}
