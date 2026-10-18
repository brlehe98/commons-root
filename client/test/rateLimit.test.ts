import { expect, it, vi } from "vitest";

const calls: number[] = [];
let failNext = 0;
vi.mock("@rootsdk/client-app", () => ({
  rootClient: {
    sendWithResponse: async () => {
      calls.push(Date.now());
      if (failNext > 0) {
        failNext--;
        throw new Error("Client request rate limit exceeded: max 10 requests/second");
      }
      return "ok";
    },
  },
}));

it("spreads a burst of requests under Root's limit and retries refusals", async () => {
  vi.useFakeTimers();
  const { rootClient } = await import("@rootsdk/client-app");
  await import("../src/rateLimit");
  const send = (rootClient as unknown as { sendWithResponse: (...a: unknown[]) => Promise<unknown> }).sendWithResponse;

  failNext = 1;
  const all = Promise.all(Array.from({ length: 20 }, (_, i) => send(`/x/${i}`, {}, null)));
  await vi.runAllTimersAsync();
  expect(await all).toEqual(Array(20).fill("ok"));
  // No one-second window holds more than 7 requests.
  for (const t of calls) expect(calls.filter((u) => u >= t && u - t < 1000).length).toBeLessThanOrEqual(7);
  vi.useRealTimers();
});
