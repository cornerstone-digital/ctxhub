import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeOpenAiCompatibleGateway, runOpenAiCompatiblePrompt } from './openaiCompatible.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

test('runOpenAiCompatiblePrompt posts the expected request shape and returns the parsed message content', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const fetchFn = (async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return jsonResponse(200, { choices: [{ message: { content: '  answer text  ' } }] });
  }) as typeof fetch;

  const result = await runOpenAiCompatiblePrompt({ baseUrl: 'https://api.example.com/v1', model: 'gpt-test' }, 'a prompt', 5000, fetchFn);

  assert.deepEqual(result, { ok: true, text: 'answer text' });
  assert.equal(capturedUrl, 'https://api.example.com/v1/chat/completions');
  assert.equal(capturedInit?.method, 'POST');
  assert.deepEqual(JSON.parse(capturedInit?.body as string), {
    model: 'gpt-test',
    messages: [{ role: 'user', content: 'a prompt' }]
  });
});

test('runOpenAiCompatiblePrompt trims a trailing slash from baseUrl', async () => {
  let capturedUrl = '';
  const fetchFn = (async (url: string) => {
    capturedUrl = url;
    return jsonResponse(200, { choices: [{ message: { content: 'ok' } }] });
  }) as typeof fetch;

  await runOpenAiCompatiblePrompt({ baseUrl: 'https://api.example.com/v1/', model: 'gpt-test' }, 'prompt', 5000, fetchFn);
  assert.equal(capturedUrl, 'https://api.example.com/v1/chat/completions');
});

test('runOpenAiCompatiblePrompt sends an Authorization header from the named env var, and none when unset', async () => {
  const originalKey = process.env.TEST_GATEWAY_KEY;
  process.env.TEST_GATEWAY_KEY = 'secret-token';
  try {
    let capturedHeaders: Record<string, string> | undefined;
    const fetchFn = (async (_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return jsonResponse(200, { choices: [{ message: { content: 'ok' } }] });
    }) as typeof fetch;

    await runOpenAiCompatiblePrompt({ baseUrl: 'https://api.example.com/v1', model: 'm', apiKeyEnv: 'TEST_GATEWAY_KEY' }, 'p', 5000, fetchFn);
    assert.equal(capturedHeaders?.Authorization, 'Bearer secret-token');
  } finally {
    if (originalKey === undefined) delete process.env.TEST_GATEWAY_KEY;
    else process.env.TEST_GATEWAY_KEY = originalKey;
  }
});

test('runOpenAiCompatiblePrompt reports a clear error for a non-ok HTTP response', async () => {
  const fetchFn = (async () => new Response('rate limited', { status: 429 })) as typeof fetch;
  const result = await runOpenAiCompatiblePrompt({ baseUrl: 'https://api.example.com/v1', model: 'm' }, 'p', 5000, fetchFn);
  assert.equal(result.ok, false);
  assert.equal((result as { reason: string }).reason, 'error');
  assert.match((result as { detail: string }).detail, /HTTP 429/);
});

test('runOpenAiCompatiblePrompt reports an error when the response has no message content', async () => {
  const fetchFn = (async () => jsonResponse(200, { choices: [] })) as typeof fetch;
  const result = await runOpenAiCompatiblePrompt({ baseUrl: 'https://api.example.com/v1', model: 'm' }, 'p', 5000, fetchFn);
  assert.equal(result.ok, false);
  assert.equal((result as { reason: string }).reason, 'error');
  assert.match((result as { detail: string }).detail, /no message content/);
});

test('runOpenAiCompatiblePrompt maps an aborted request to the timeout reason', async () => {
  const fetchFn = ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })) as typeof fetch;

  const result = await runOpenAiCompatiblePrompt({ baseUrl: 'https://api.example.com/v1', model: 'm' }, 'p', 20, fetchFn);
  assert.equal(result.ok, false);
  assert.equal((result as { reason: string }).reason, 'timeout');
});

test('probeOpenAiCompatibleGateway reports ok/not-ok based on the /models response', async () => {
  const okFetch = (async () => new Response('{}', { status: 200 })) as typeof fetch;
  assert.deepEqual(await probeOpenAiCompatibleGateway({ baseUrl: 'https://api.example.com/v1' }, okFetch), { ok: true });

  const failFetch = (async () => new Response('nope', { status: 401 })) as typeof fetch;
  const result = await probeOpenAiCompatibleGateway({ baseUrl: 'https://api.example.com/v1' }, failFetch);
  assert.equal(result.ok, false);
  assert.match(result.detail ?? '', /HTTP 401/);
});

test('probeOpenAiCompatibleGateway reports a clear error when the request itself fails', async () => {
  const throwingFetch = (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch;
  const result = await probeOpenAiCompatibleGateway({ baseUrl: 'https://api.example.com/v1' }, throwingFetch);
  assert.equal(result.ok, false);
  assert.match(result.detail ?? '', /ECONNREFUSED/);
});
