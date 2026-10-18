import { AccessError } from "./access";
import { RateLimitError } from "./rateLimit";

/** What a member sees when something unexpected fails; details stay in the server log. */
export const GENERIC_ERROR = "Something went wrong on the server. Try again in a moment.";

/**
 * Errors the app throws on purpose carry a message written for members:
 * plain `Error`, `AccessError`, `RateLimitError`. Anything else (SQLite,
 * file system, a bug's TypeError) may hold SQL, paths or internals.
 */
export function isUserFacing(err: unknown): err is Error {
  if (!(err instanceof Error)) return false;
  // Library and system errors carry a code (SQLITE_*, ENOENT…).
  if ((err as { code?: unknown }).code !== undefined) return false;
  const kind = Object.getPrototypeOf(err)?.constructor;
  return kind === Error || kind === AccessError || kind === RateLimitError;
}

export function toClientError(err: unknown, where: string): Error {
  if (isUserFacing(err)) return err;
  console.error(`Unexpected error in ${where}:`, err);
  return new Error(GENERIC_ERROR);
}

/**
 * Wraps every RPC handler of a service so unexpected errors reach the
 * client as a generic message. Applied once, where services are registered.
 */
export function guardService<T extends object>(service: T): T {
  const proto = Object.getPrototypeOf(service);
  const name = proto?.constructor?.name ?? "Service";
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key === "constructor" || key.startsWith("broadcast")) continue;
    const method = (service as Record<string, unknown>)[key];
    if (typeof method !== "function") continue;
    const wrapped = async function (this: unknown, ...args: unknown[]) {
      try {
        return await (method as (...a: unknown[]) => unknown).apply(this, args);
      } catch (err) {
        throw toClientError(err, `${name}.${key}`);
      }
    };
    Object.defineProperty(service, key, { value: wrapped, writable: true, configurable: true });
  }
  return service;
}
