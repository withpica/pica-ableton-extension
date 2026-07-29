// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

/**
 * Unit tests must never reach the network.
 *
 * Every network-touching module in src/ takes an injected `fetch` (mcpClient,
 * audioUpload, identity, connect) precisely so it can be driven from a test.
 * The risk is not that injection is hard, it is that a NEW test forgets and
 * quietly exercises the default parameter instead, which points at
 * https://withpica.com, i.e. production. That failure is invisible: the request
 * 401s, the code under test handles it, and the test passes while a unit suite
 * sends live traffic to prod on every run.
 *
 * So the default global is a tripwire rather than a client. Any real call fails
 * immediately and names the fix. A test that wants a fake fetch injects one,
 * which also makes the request assertable.
 */
globalThis.fetch = (async (input: unknown) => {
  const target = typeof input === "string" ? input : String(input);
  const message =
    `unit test attempted a real network request to ${target}. ` +
    `pass a fake fetch into the function under test (see __tests__/identity.test.ts) ` +
    `instead of relying on the default global.`;
  // Logged as well as thrown: the callers most likely to trip this (identity,
  // connect) swallow their errors by design, so the throw alone would surface
  // only as a confusing assertion failure somewhere downstream.
  console.error(`[test-network-tripwire] ${message}`);
  throw new Error(message);
}) as unknown as typeof fetch;
