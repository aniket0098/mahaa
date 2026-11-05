/**
 * Seed the running local API with two finished accounts and three posts —
 * one text, one image, one video — so the physical-device run below can prove
 * the immersive stage against server rows rather than demo data.
 *
 *   node tools/seed-device-feed.mjs
 *
 * Everything goes through the public API (`/auth/signup`, profile PATCH,
 * education POST, raw-body `POST /media?kind=…`, `POST /posts`) exactly as the
 * app does. Output is `tools/.device-seed.json` for the device script to read.
 * The text+image posts are expected to render as bands; assertions on them
 * would only prove the old layout, so the run focuses its PASS/FAIL verdict
 * on the video post and reports the bands as informational witnesses.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const API = 'http://127.0.0.1:8000/api/v1';
const OUT = 'C:/mahaa/tools/.device-seed.json';
const PASSWORD = 'Passw0rd!2026';
const stamp = () => Math.random().toString(36).slice(2, 10);
const write = (m) => process.stdout.write(`${m}\n`);

async function call(method, path, { token = null, json = undefined, raw = undefined, contentType = undefined } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...headers,
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(contentType ? { 'Content-Type': contentType } : {}),
    },
    body: json !== undefined ? JSON.stringify(json) : raw,
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* non-JSON error bodies stay as text */
  }
  return { status: response.status, body: parsed, text };
}

async function signup(label, name) {
  const email = `uiv.${label}.${stamp()}@example.com`;
  const signed = await call('POST', '/auth/signup', {
    json: { name, email, password: PASSWORD, phone: null, role: 'candidate' },
  });
  if (signed.status !== 201 || !signed.body?.access_token) {
    throw new Error(`signup ${label}: ${signed.status} ${signed.text.slice(0, 200)}`);
  }
  const token = signed.body.access_token;

  // Satisfy the onboarding gate through the same public routes the wizard
  // uses, so the device can open Home without driving four wizard screens.
  const identity = await call('PATCH', '/profile', {
    token,
    json: {
      headline: 'Verification Engineer',
      location: 'Pune, India',
      summary: 'A verification account for physical-device checks.',
    },
  });
  if (!identity.ok && identity.status >= 400) {
    write(`warn: identity PATCH for ${label}: ${identity.status}`);
  }
  const education = await call('POST', '/profile/education', {
    token,
    json: { institution: 'MIT', degree: 'B.Tech', field_of_study: 'Computer Science', current: true },
  });
  if (![200, 201].includes(education.status)) {
    write(`warn: education POST for ${label}: ${education.status}`);
  }
  return { label, name, email, password: PASSWORD, token };
}

async function upload(token, file, kind, mime, extra = '') {
  const bytes = readFileSync(file);
  const uploaded = await call('POST', `/media?kind=${kind}${extra}`, {
    token,
    raw: bytes,
    contentType: mime,
  });
  if (uploaded.status !== 201 || !uploaded.body?.id) {
    throw new Error(`upload ${file}: ${uploaded.status} ${uploaded.text.slice(0, 200)}`);
  }
  return uploaded.body.id;
}

async function createPost(token, input) {
  const created = await call('POST', '/posts', { token, json: input });
  if (created.status !== 201 || !created.body?.id) {
    throw new Error(`create post: ${created.status} ${created.text.slice(0, 300)}`);
  }
  return created.body.id;
}

const seed = { api: API, users: {}, posts: {} };

seed.users.author = await signup('author', 'UI Device Author');
seed.users.reader = await signup('reader', 'UI Device Reader');
write(`PASS two accounts created (${seed.users.author.email}, ${seed.users.reader.email})`);

const marker = `STAGE-${stamp().toUpperCase()}`;

seed.posts.text = await createPost(seed.users.author.token, {
  kind: 'text',
  category: 'community',
  body: `${marker} control text post`,
});
write(`PASS text post created (${seed.posts.text})`);

const png = await upload(
  seed.users.author.token,
  'C:/mahaa/.e2e-media/clip-device.png',
  'image',
  'image/png',
);
seed.posts.image = await createPost(seed.users.author.token, {
  kind: 'image',
  category: 'community',
  body: `${marker} control image post`,
  media_ids: [png],
});
write(`PASS image post created (${seed.posts.image})`);

const clip = await upload(
  seed.users.author.token,
  'C:/mahaa/.e2e-media/clip-device.mp4',
  'video',
  'video/mp4',
);
seed.posts.video = await createPost(seed.users.author.token, {
  kind: 'video',
  category: 'community',
  body: `${marker} immersive stage video post`,
  media_ids: [clip],
});
write(`PASS video post created (${seed.posts.video}, marker ${marker})`);

seed.marker = marker;
seed.png = 'C:/mahaa/.e2e-media/clip-device.png';
seed.clip = 'C:/mahaa/.e2e-media/clip-device.mp4';
writeFileSync(OUT, JSON.stringify(seed, null, 2));
write(`seed written to ${OUT}`);
