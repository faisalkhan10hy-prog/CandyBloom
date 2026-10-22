import { randomInt } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIRECTORY = process.env.AGRITRAC_DATA_DIR || path.join(ROOT, 'data');
const REQUESTS_FILE = path.join(DATA_DIRECTORY, 'requests.json');
const MAX_BODY_BYTES = 32 * 1024;
const REQUESTS_PER_MINUTE = 12;
const RATE_WINDOW_MS = 60_000;
const VALID_TOPICS = new Set([
  'Parts & filters',
  'Service & maintenance',
  'Manuals & guides',
  'Warranty & coverage',
  'Machine troubleshooting',
  'Other question'
]);
const PUBLIC_FILES = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/agritrac', 'index.html'],
  ['/agritrac/', 'index.html'],
  ['/agritrac/index.html', 'index.html'],
  ['/styles.css', 'styles.css'],
  ['/agritrac/styles.css', 'styles.css'],
  ['/app.js', 'app.js'],
  ['/agritrac/app.js', 'app.js'],
  ['/assets/tractor-field.jpg', 'assets/tractor-field.jpg'],
  ['/agritrac/assets/tractor-field.jpg', 'assets/tractor-field.jpg']
]);
const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.jpg', 'image/jpeg']
]);
const rateLimits = new Map();
let writes = Promise.resolve();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function freshserviceSettings() {
  const domain = process.env.FRESHSERVICE_DOMAIN?.trim() ?? '';
  const apiKey = process.env.FRESHSERVICE_API_KEY?.trim() ?? '';
  const groupIdValue = process.env.FRESHSERVICE_GROUP_ID?.trim() ?? '';

  if (Boolean(domain) !== Boolean(apiKey)) {
    return { error: 'Set both FRESHSERVICE_DOMAIN and FRESHSERVICE_API_KEY, or leave both blank for demo mode.' };
  }
  if (!domain) return { mode: 'demo' };

  let accountUrl;
  try {
    accountUrl = new URL(domain.includes('://') ? domain : `https://${domain}`);
  } catch {
    return { error: 'FRESHSERVICE_DOMAIN must be a valid HTTPS hostname.' };
  }
  if (accountUrl.protocol !== 'https:' || !accountUrl.hostname || accountUrl.username || accountUrl.password || accountUrl.search || accountUrl.hash) {
    return { error: 'FRESHSERVICE_DOMAIN must be an HTTPS account hostname without credentials, query, or fragment.' };
  }
  if (accountUrl.pathname !== '/' && accountUrl.pathname !== '') {
    return { error: 'FRESHSERVICE_DOMAIN must not include an API path.' };
  }

  let groupId;
  if (groupIdValue) {
    groupId = Number(groupIdValue);
    if (!Number.isSafeInteger(groupId) || groupId < 1) {
      return { error: 'FRESHSERVICE_GROUP_ID must be a positive integer.' };
    }
  }

  return {
    mode: 'freshservice',
    baseUrl: `${accountUrl.origin}/api/v2`,
    apiKey,
    groupId
  };
}

function allowedOrigins() {
  const port = Number(process.env.PORT) || 3000;
  const configured = process.env.ALLOWED_ORIGINS
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean) ?? [];
  return new Set([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    ...configured
  ]);
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request body is too large.');
    chunks.push(chunk);
  }

  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Expected an object.');
    }
    return parsed;
  } catch {
    throw new HttpError(400, 'Send a valid JSON object.');
  }
}

function readText(value, field, maxLength, { required = true } = {}) {
  if (typeof value !== 'string') {
    if (!required && (value === undefined || value === null)) return '';
    throw new HttpError(400, `${field} must be text.`);
  }
  const text = value.trim();
  if (required && !text) throw new HttpError(400, `${field} is required.`);
  if (text.length > maxLength) throw new HttpError(400, `${field} must be ${maxLength} characters or fewer.`);
  return text;
}

function validateTicket(body) {
  const name = readText(body.name, 'Name', 100);
  const email = readText(body.email, 'Email', 254).toLowerCase();
  const topic = readText(body.topic, 'Topic', 80);
  const model = readText(body.model, 'Model or serial number', 100, { required: false });
  const message = readText(body.message, 'Message', 5000);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  if (!VALID_TOPICS.has(topic)) throw new HttpError(400, 'Choose a valid support topic.');
  return { name, email, topic, model, message };
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function checkRateLimit(request) {
  const remoteAddress = request.socket.remoteAddress ?? 'unknown';
  const now = Date.now();
  const current = rateLimits.get(remoteAddress);
  if (!current || now >= current.resetAt) {
    rateLimits.set(remoteAddress, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return;
  }
  current.count += 1;
  if (current.count > REQUESTS_PER_MINUTE) {
    throw new HttpError(429, 'Too many requests. Please wait a minute and try again.');
  }
}

async function readDemoRequests() {
  try {
    const stored = await readFile(REQUESTS_FILE, 'utf8');
    const requests = JSON.parse(stored);
    return Array.isArray(requests) ? requests : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function updateDemoRequests(update) {
  const operation = writes.then(async () => {
    const requests = await readDemoRequests();
    const result = await update(requests);
    await mkdir(DATA_DIRECTORY, { recursive: true });
    const temporaryFile = `${REQUESTS_FILE}.tmp`;
    await writeFile(temporaryFile, JSON.stringify(requests, null, 2), { mode: 0o600 });
    await rename(temporaryFile, REQUESTS_FILE);
    return result;
  });
  writes = operation.catch(() => {});
  return operation;
}

async function listDemoRequests() {
  await writes;
  return readDemoRequests();
}

async function callFreshservice(settings, endpoint, options = {}) {
  let response;
  try {
    response = await fetch(`${settings.baseUrl}${endpoint}`, {
      ...options,
      signal: AbortSignal.timeout(12_000),
      headers: {
        Authorization: `Basic ${Buffer.from(`${settings.apiKey}:X`).toString('base64')}`,
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers
      }
    });
  } catch {
    throw new HttpError(502, 'Could not reach Freshservice. Try again shortly.');
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 404) throw new HttpError(404, 'No matching support request was found.');
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(502, 'Freshservice rejected the server credentials. Check the API key and account domain.');
    }
    if (response.status === 429) throw new HttpError(503, 'Freshservice is rate limiting requests. Try again shortly.');
    throw new HttpError(502, 'Freshservice could not complete the request. Check the server logs and account configuration.');
  }
  return payload;
}

function ticketStatus(status) {
  return ({ 2: 'Open', 3: 'Pending', 4: 'Resolved', 5: 'Closed' })[status] ?? 'In progress';
}

async function createFreshserviceTicket(settings, ticketData) {
  const details = [
    `<p><strong>Support topic:</strong> ${escapeHtml(ticketData.topic)}</p>`,
    `<p><strong>Requester:</strong> ${escapeHtml(ticketData.name)} (${escapeHtml(ticketData.email)})</p>`,
    `<p><strong>Model / serial:</strong> ${escapeHtml(ticketData.model || 'Not provided')}</p>`,
    `<p><strong>Message:</strong><br>${escapeHtml(ticketData.message).replace(/\r?\n/g, '<br>')}</p>`
  ].join('\n');
  const ticket = {
    subject: `AgriTrac support: ${ticketData.topic}`,
    description: details,
    email: ticketData.email,
    name: ticketData.name,
    status: 2,
    priority: 2,
    source: 2,
    tags: ['agritrac-portal']
  };
  if (settings.groupId) ticket.group_id = settings.groupId;

  const result = await callFreshservice(settings, '/tickets', {
    method: 'POST',
    body: JSON.stringify(ticket)
  });
  const created = result?.ticket;
  if (!created?.id) throw new HttpError(502, 'Freshservice returned an unexpected ticket response.');
  return {
    ticketNumber: `AT-${created.id}`,
    displayId: created.display_id ?? created.id,
    status: ticketStatus(created.status ?? 2),
    mode: 'freshservice'
  };
}

async function createTicket(body, settings) {
  const ticketData = validateTicket(body);
  if (settings.mode === 'freshservice') return createFreshserviceTicket(settings, ticketData);

  return updateDemoRequests((requests) => {
    let ticketNumber;
    do {
      ticketNumber = `AT-${randomInt(100000, 1_000_000)}`;
    } while (requests.some((request) => request.ticketNumber === ticketNumber));
    const ticket = {
      ...ticketData,
      ticketNumber,
      status: 'Received',
      createdAt: new Date().toISOString()
    };
    requests.push(ticket);
    return { ticketNumber, status: ticket.status, mode: 'demo' };
  });
}

function validateLookup(body) {
  const ticketNumber = readText(body.ticketNumber, 'Request number', 32).toUpperCase();
  const email = readText(body.email, 'Email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  const match = /^AT-(\d{1,18})$/.exec(ticketNumber);
  if (!match) throw new HttpError(400, 'Request number must look like AT-123456.');
  return { ticketNumber, ticketId: match[1], email };
}

async function lookupTicket(body, settings) {
  const lookup = validateLookup(body);
  if (settings.mode === 'freshservice') {
    const result = await callFreshservice(settings, `/tickets/${lookup.ticketId}?include=requester`);
    const ticket = result?.ticket;
    const requesterEmail = ticket?.requester?.email ?? ticket?.email;
    if (!ticket || !requesterEmail || requesterEmail.toLowerCase() !== lookup.email) {
      throw new HttpError(404, 'No matching support request was found.');
    }
    return {
      ticketNumber: `AT-${ticket.id}`,
      displayId: ticket.display_id ?? ticket.id,
      subject: ticket.subject,
      status: ticketStatus(ticket.status),
      mode: 'freshservice'
    };
  }

  const requests = await listDemoRequests();
  const ticket = requests.find((request) => request.ticketNumber === lookup.ticketNumber && request.email === lookup.email);
  if (!ticket) throw new HttpError(404, 'No matching support request was found. Check the request number and email.');
  return {
    ticketNumber: ticket.ticketNumber,
    topic: ticket.topic,
    status: ticket.status,
    createdAt: ticket.createdAt,
    mode: 'demo'
  };
}

function serveStatic(pathname, response) {
  const relativePath = PUBLIC_FILES.get(pathname);
  if (!relativePath) {
    sendJson(response, 404, { error: 'Not found.' });
    return;
  }
  const filePath = path.join(ROOT, relativePath);
  readFile(filePath).then((content) => {
    response.writeHead(200, {
      'Content-Type': MIME_TYPES.get(path.extname(filePath)),
      'Content-Length': content.length,
      'Cache-Control': relativePath.endsWith('.jpg') ? 'public, max-age=86400' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    });
    response.end(content);
  }).catch(() => sendJson(response, 404, { error: 'Not found.' }));
}

function setSecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self'; connect-src 'self' https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
  );
}

export function createServer() {
  return createHttpServer(async (request, response) => {
    setSecurityHeaders(response);
    const origin = request.headers.origin;
    if (origin) {
      if (!allowedOrigins().has(origin)) {
        sendJson(response, 403, { error: 'This website origin is not allowed by the server.' });
        return;
      }
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    } catch {
      sendJson(response, 400, { error: 'Invalid request path.' });
      return;
    }

    try {
      const settings = freshserviceSettings();
      if (pathname === '/api/health' && request.method === 'GET') {
        sendJson(response, 200, {
          mode: settings.error ? 'unconfigured' : settings.mode,
          freshserviceConfigured: settings.mode === 'freshservice',
          configurationError: settings.error ?? null
        });
        return;
      }

      if (pathname.startsWith('/api/')) {
        if (settings.error) throw new HttpError(503, settings.error);
        if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
        checkRateLimit(request);
        const body = await readJson(request);
        if (pathname === '/api/tickets') {
          sendJson(response, 201, await createTicket(body, settings));
          return;
        }
        if (pathname === '/api/tickets/lookup') {
          sendJson(response, 200, await lookupTicket(body, settings));
          return;
        }
        throw new HttpError(404, 'API route not found.');
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        throw new HttpError(405, 'Method not allowed.');
      }
      if (request.method === 'HEAD') {
        response.writeHead(405, { Allow: 'GET' });
        response.end();
        return;
      }
      serveStatic(pathname, response);
    } catch (error) {
      if (!(error instanceof HttpError)) {
        console.error('Request failed:', error.message);
      }
      sendJson(response, error instanceof HttpError ? error.status : 500, {
        error: error instanceof HttpError ? error.message : 'An unexpected server error occurred.'
      });
    }
  });
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const server = createServer();
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  const settings = freshserviceSettings();
  server.listen(port, host, () => {
    console.log(`AgriTrac server listening at http://${host}:${port} (${settings.error ? 'configuration error' : settings.mode} mode).`);
    if (settings.error) console.error(settings.error);
  });
}
