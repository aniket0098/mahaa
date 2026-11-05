const BASE = 'http://127.0.0.1:8000/api/v1';
const sfx = Date.now().toString(36);
async function req(method, path, token, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch { json = null; }
  return { status: r.status, json };
}
(async () => {
  const sA = await req('POST', '/auth/signup', null, { name: 'P23 Searcher ' + sfx, email: 'p23a.' + sfx + '@example.com', password: 'Passw0rd123' });
  const sB = await req('POST', '/auth/signup', null, { name: 'P23 Target ' + sfx, email: 'p23b.' + sfx + '@example.com', password: 'Passw0rd123' });
  const tA = sA.json.access_token, tB = sB.json.access_token;
  const meA = await req('GET', '/users/me', tA);
  const meB = await req('GET', '/users/me', tB);
  const privB = await req('GET', '/profile/privacy', tB);
  console.log(JSON.stringify({ signupA: sA.status, signupB: sB.status, meA: meA.json.public_id, meB: meB.json.public_id, discoverableB: privB.json && privB.json.discoverable }));
  const frag = 'P23 Target ' + sfx.slice(-4);
  const lkFrag = await req('GET', '/users/lookup?query=' + encodeURIComponent('P23 Target'), tA);
  console.log(JSON.stringify({ fragLookup: lkFrag.status, count: Array.isArray(lkFrag.json) ? lkFrag.json.length : -1, foundB: Array.isArray(lkFrag.json) ? lkFrag.json.some((x) => x.public_id === meB.json.public_id) : false }));
  const lkHandle = await req('GET', '/users/lookup?query=' + encodeURIComponent(meB.json.username), tA);
  console.log(JSON.stringify({ handleLookup: lkHandle.status, foundB: Array.isArray(lkHandle.json) ? lkHandle.json.some((x) => x.public_id === meB.json.public_id) : false }));
  const lkPid = await req('GET', '/users/lookup?query=' + encodeURIComponent(meB.json.public_id), tA);
  console.log(JSON.stringify({ pidLookup: lkPid.status, foundB: Array.isArray(lkPid.json) ? lkPid.json.some((x) => x.public_id === meB.json.public_id) : false }));
  const lkWhite = await req('GET', '/users/lookup?query=' + encodeURIComponent('  p23 TARGET  '), tA);
  console.log(JSON.stringify({ whiteLookup: lkWhite.status, foundB: Array.isArray(lkWhite.json) ? lkWhite.json.some((x) => x.public_id === meB.json.public_id) : false }));
  const conn = await req('POST', '/connections', tA, { user_id: meB.json.id });
  console.log(JSON.stringify({ connPost: conn.status, connId: conn.json && conn.json.id }));
  const acc = await req('POST', '/connections/' + conn.json.id + '/accept', tB);
  console.log(JSON.stringify({ connAccept: acc.status }));
  const open = await req('POST', '/conversations', tA, { user_id: meB.json.id });
  console.log(JSON.stringify({ convOpen: open.status, convId: open.json && open.json.id }));
  const open2 = await req('POST', '/conversations', tA, { user_id: meB.json.id });
  console.log(JSON.stringify({ convReopen: open2.status, sameId: open2.json && open2.json.id === open.json.id }));
  const msgText = 'P23 hello ' + sfx;
  const send = await req('POST', '/conversations/' + open.json.id + '/messages', tA, { body: msgText });
  console.log(JSON.stringify({ send: send.status, msgId: send.json && send.json.id, body: send.json && send.json.body }));
  const histA = await req('GET', '/conversations/' + open.json.id + '/messages', tA);
  console.log(JSON.stringify({ histA: histA.status, items: histA.json && histA.json.items && histA.json.items.length, lastBody: histA.json && histA.json.items && histA.json.items[histA.json.items.length - 1] && histA.json.items[histA.json.items.length - 1].body }));
  const histB = await req('GET', '/conversations/' + open.json.id + '/messages', tB);
  console.log(JSON.stringify({ histB: histB.status, items: histB.json && histB.json.items && histB.json.items.length, sawText: histB.json && histB.json.items && histB.json.items.some((m) => m.body === msgText) }));
  const reply = await req('POST', '/conversations/' + open.json.id + '/messages', tB, { body: 'P23 reply ' + sfx });
  console.log(JSON.stringify({ reply: reply.status, body: reply.json && reply.json.body }));
  const edit = await req('PATCH', '/messages/' + send.json.id, tA, { body: msgText + ' EDITED' });
  console.log(JSON.stringify({ edit: edit.status, body: edit.json && edit.json.body, editedAt: edit.json && edit.json.edited_at }));
  const forbEdit = await req('PATCH', '/messages/' + send.json.id, tB, { body: 'hijack' });
  console.log(JSON.stringify({ forbiddenEdit: forbEdit.status }));
  const privPut = await req('PUT', '/profile/privacy', tB, { profile_visibility: 'private', discoverable: false, allow_messages: true, show_email: false, show_phone: false });
  console.log(JSON.stringify({ optOut: privPut.status }));
  const lkAfter = await req('GET', '/users/lookup?query=' + encodeURIComponent('P23 Target'), tA);
  console.log(JSON.stringify({ fragAfterOptOut: lkAfter.status, stillFound: Array.isArray(lkAfter.json) ? lkAfter.json.some((x) => x.public_id === meB.json.public_id) : 'n/a' }));
  const lkHandleAfter = await req('GET', '/users/lookup?query=' + encodeURIComponent(meB.json.username), tA);
  console.log(JSON.stringify({ handleAfterOptOut: lkHandleAfter.status, foundB: Array.isArray(lkHandleAfter.json) ? lkHandleAfter.json.some((x) => x.public_id === meB.json.public_id) : false }));
})().catch((e) => { console.error('PROBE-FAIL', e.message); process.exit(1); });
