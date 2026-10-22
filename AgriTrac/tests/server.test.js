import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const envNames = ['FRESHSERVICE_DOMAIN', 'FRESHSERVICE_API_KEY', 'FRESHSERVICE_GROUP_ID', 'ALLOWED_ORIGINS', 'AGRITRAC_DATA_DIR'];
const previousEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
let dataDirectory;
let server;
let baseUrl;

before(async () => {
  dataDirectory = await mkdtemp(path.join(tmpdir(), 'agritrac-support-test-'));
  process.env.FRESHSERVICE_DOMAIN = '';
  process.env.FRESHSERVICE_API_KEY = '';
  process.env.FRESHSERVICE_GROUP_ID = '';
  process.env.AGRITRAC_DATA_DIR = dataDirectory;
  process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
  const { createServer } = await import('../server.js');
  server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(dataDirectory, { recursive: true, force: true });
  for (const name of envNames) {
    if (previousEnv[name] === undefined) delete process.env[name];
    else process.env[name] = previousEnv[name];
  }
});

test('demo ticket flow validates, persists and protects requester lookup', async () => {
  const healthResponse = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), {
    mode: 'demo',
    freshserviceConfigured: false,
    configurationError: null
  });

  const invalidResponse = await fetch(`${baseUrl}/api/tickets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Taylor Farmer',
      email: 'not-an-email',
      topic: 'Parts & filters',
      message: 'Need an oil filter.'
    })
  });
  assert.equal(invalidResponse.status, 400);
  assert.match((await invalidResponse.json()).error, /valid email/i);

  const createResponse = await fetch(`${baseUrl}/api/tickets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Taylor Farmer',
      email: 'Taylor@example.com',
      topic: 'Parts & filters',
      model: 'AT-42',
      message: 'Need an oil filter.'
    })
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.match(created.ticketNumber, /^AT-\d{6}$/);
  assert.equal(created.status, 'Received');
  assert.equal(created.mode, 'demo');

  const lookupResponse = await fetch(`${baseUrl}/api/tickets/lookup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticketNumber: created.ticketNumber, email: 'taylor@example.com' })
  });
  assert.equal(lookupResponse.status, 200);
  const lookup = await lookupResponse.json();
  assert.equal(lookup.ticketNumber, created.ticketNumber);
  assert.equal(lookup.topic, 'Parts & filters');

  const unauthorizedResponse = await fetch(`${baseUrl}/api/tickets/lookup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticketNumber: created.ticketNumber, email: 'other@example.com' })
  });
  assert.equal(unauthorizedResponse.status, 404);

  const persisted = JSON.parse(await readFile(path.join(dataDirectory, 'requests.json'), 'utf8'));
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].email, 'taylor@example.com');
});

test('rejects browser origins that were not explicitly allowed', async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: 'https://untrusted.example' }
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'This website origin is not allowed by the server.');
});

test('serves the AgriTrac page and its assets on the branded path', async () => {
  const page = await fetch(`${baseUrl}/agritrac`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /AgriTrac Support/);

  const stylesheet = await fetch(`${baseUrl}/styles.css`);
  assert.equal(stylesheet.status, 200);
  assert.match(stylesheet.headers.get('content-type'), /text\/css/);

  const script = await fetch(`${baseUrl}/app.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /javascript/);

  const image = await fetch(`${baseUrl}/assets/tractor-field.jpg`);
  assert.equal(image.status, 200);
  assert.match(image.headers.get('content-type'), /image\/jpeg/);
});

test('creates and looks up Freshservice tickets without exposing credentials', async () => {
  const originalFetch = globalThis.fetch;
  const previousEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  const outboundRequests = [];
  process.env.FRESHSERVICE_DOMAIN = 'https://agritrac.freshservice.com/';
  process.env.FRESHSERVICE_API_KEY = 'server-only-test-key';
  process.env.FRESHSERVICE_GROUP_ID = '42';
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://agritrac.freshservice.com/')) {
      return originalFetch(url, options);
    }
    outboundRequests.push({ url: String(url), options });
    const payload = options.method === 'POST'
      ? { ticket: { id: 777, display_id: 73, status: 2 } }
      : { ticket: { id: 777, display_id: 73, status: 3, subject: 'Parts request', requester: { email: 'farmer@example.com' } } };
    return new Response(JSON.stringify(payload), {
      status: options.method === 'POST' ? 201 : 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const health = await fetch(`${baseUrl}/api/health`);
    const healthText = await health.text();
    assert.equal(health.status, 200);
    assert.match(healthText, /"mode":"freshservice"/);
    assert.equal(healthText.includes('server-only-test-key'), false);

    const createResponse = await fetch(`${baseUrl}/api/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '<script>Farmer</script>',
        email: 'farmer@example.com',
        topic: 'Parts & filters',
        model: 'AT-42',
        message: 'Check <engine> & filter.'
      })
    });
    assert.equal(createResponse.status, 201);
    assert.deepEqual(await createResponse.json(), {
      ticketNumber: 'AT-777',
      displayId: 73,
      status: 'Open',
      mode: 'freshservice'
    });

    const createCall = outboundRequests[0];
    assert.equal(createCall.url, 'https://agritrac.freshservice.com/api/v2/tickets');
    assert.equal(createCall.options.headers.Authorization, `Basic ${Buffer.from('server-only-test-key:X').toString('base64')}`);
    const sentTicket = JSON.parse(createCall.options.body);
    assert.equal(sentTicket.group_id, 42);
    assert.match(sentTicket.description, /&lt;script&gt;Farmer&lt;\/script&gt;/);
    assert.match(sentTicket.description, /Check &lt;engine&gt; &amp; filter\./);

    const lookupResponse = await fetch(`${baseUrl}/api/tickets/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketNumber: 'AT-777', email: 'FARMER@example.com' })
    });
    assert.equal(lookupResponse.status, 200);
    assert.deepEqual(await lookupResponse.json(), {
      ticketNumber: 'AT-777',
      displayId: 73,
      subject: 'Parts request',
      status: 'Pending',
      mode: 'freshservice'
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of envNames) {
      if (previousEnv[name] === undefined) delete process.env[name];
      else process.env[name] = previousEnv[name];
    }
  }
});
