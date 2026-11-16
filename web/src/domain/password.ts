const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_SHAPE = /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/;
const GENERATED_LENGTH = 8;
const MIN_LENGTH = 8;
const PBKDF2_ITERATIONS = 600_000;
const DERIVED_BYTES = 64;
const KEY_BYTES = 32;
const SALT_PREFIX = "live.versatile.sh/v1/";
const WEAK_BELOW_BITS = 40;
const COMMON = ["password", "senha", "qwerty", "asdf", "12345678", "abcdefgh", "11111111", "00000000", "letmein", "admin"];

/** Fills a byte array with random values; the seam that lets tests script the draw. */
export type RandomBytes = (bytes: Uint8Array<ArrayBuffer>) => void;

/** What the server and the browser each get from one password. */
export type Derived = {
  /** Sent to the server, base64url without padding. */
  verifier: string;
  /** Stays in memory for the media layer; never sent, never stored. */
  mediaKey: Uint8Array;
};

/** Why a typed password is refused. */
export type PasswordProblem = "short" | "needs-letter" | "needs-digit";

/** How a typed password rates: refused, accepted with a warning, or fine. */
export type PasswordAssessment = { rating: "invalid"; problem: PasswordProblem } | { rating: "weak" } | { rating: "ok" };

function browserRandom(bytes: Uint8Array<ArrayBuffer>): void {
  crypto.getRandomValues(bytes);
}

function drawIndex(random: RandomBytes, size: number): number {
  const limit = 256 - (256 % size);
  const byte = new Uint8Array(1);
  for (;;) {
    random(byte);
    const value = byte[0] ?? 0;
    if (value < limit) return value % size;
  }
}

function hasLetterAndDigit(text: string): boolean {
  return /[A-Za-z]/.test(text) && /[0-9]/.test(text);
}

/** A room code such as `8ABH-23HK`: eight capitals and digits without the look-alikes 0 O 1 I, drawn without modulo bias, always holding both kinds. */
export function generatePassword(random: RandomBytes = browserRandom): string {
  for (;;) {
    let text = "";
    for (let i = 0; i < GENERATED_LENGTH; i++) text += ALPHABET[drawIndex(random, ALPHABET.length)];
    if (hasLetterAndDigit(text)) return `${text.slice(0, 4)}-${text.slice(4)}`;
  }
}

/** A room code is the same password however its letters were typed; anything else is kept exactly as written. */
export function canonicalPassword(password: string): string {
  const trimmed = password.trim();
  return CODE_SHAPE.test(trimmed) ? trimmed.toUpperCase() : password;
}

function withoutRuns(password: string): string {
  const chars = [...password.toLowerCase()];
  const code = (i: number) => chars[i]?.codePointAt(0) ?? 0;
  const inRun = new Set<number>();
  for (let i = 0; i + 2 < chars.length; i++) {
    const step = code(i + 1) - code(i);
    if (Math.abs(step) === 1 && code(i + 2) - code(i + 1) === step) [i, i + 1, i + 2].forEach((j) => inRun.add(j));
  }
  return chars.filter((_, i) => !inRun.has(i)).join("");
}

function estimateBits(password: string): number {
  const unique = new Set(withoutRuns(password)).size;
  const pool = (/[a-z]/.test(password) ? 26 : 0) + (/[A-Z]/.test(password) ? 26 : 0) + (/[0-9]/.test(password) ? 10 : 0) + (/[^A-Za-z0-9]/.test(password) ? 32 : 0);
  const bits = Math.min(unique, password.length) * Math.log2(Math.max(pool, 2));
  const lower = password.toLowerCase();
  return COMMON.some((word) => lower.includes(word)) ? Math.min(bits, 20) : bits;
}

/** Judges a password the owner typed: refused when it breaks the rule, weak when it is guessable. */
export function assessPassword(password: string): PasswordAssessment {
  if ([...password].length < MIN_LENGTH) return { rating: "invalid", problem: "short" };
  if (!/[A-Za-z]/.test(password)) return { rating: "invalid", problem: "needs-letter" };
  if (!/[0-9]/.test(password)) return { rating: "invalid", problem: "needs-digit" };
  return estimateBits(password) < WEAK_BELOW_BITS ? { rating: "weak" } : { rating: "ok" };
}

/** Encodes bytes as base64url without padding, the form the server expects. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** PBKDF2-SHA-256, 600000 rounds, salted with the slug: bytes 0-31 are the verifier, bytes 32-63 the media key. */
export async function derive(password: string, slug: string, subtle: SubtleCrypto = crypto.subtle): Promise<Derived> {
  const material = await subtle.importKey("raw", new TextEncoder().encode(canonicalPassword(password)), "PBKDF2", false, ["deriveBits"]);
  const salt = new TextEncoder().encode(SALT_PREFIX + slug);
  const bits = await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS }, material, DERIVED_BYTES * 8);
  const bytes = new Uint8Array(bits);
  return { verifier: toBase64Url(bytes.slice(0, KEY_BYTES)), mediaKey: bytes.slice(KEY_BYTES) };
}
