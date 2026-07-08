// ============================================================
// CricketScore — app.js
// All state lives in Firestore (collections: players, gallery,
// sessions). Every open tab/device subscribes with onSnapshot,
// so a session updates live everywhere the code is entered.
// ============================================================

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2200);
}

function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)) ;
}

function resizeImageFile(file, maxDim = 300, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = e => (img.src = e.target.result);
    reader.onerror = reject;
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxDim) { height *= maxDim / width; width = maxDim; }
      else if (height > maxDim) { width *= maxDim / height; height = maxDim; }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------------- Navigation ----------------
const navStack = ['home'];
function nav(view, push = true) {
  $$('.view').forEach(v => (v.hidden = v.dataset.view !== view));
  if (push) navStack.push(view);
}
$$('[data-nav]').forEach(b => b.addEventListener('click', () => nav(b.dataset.nav)));
$$('[data-nav-back]').forEach(b => b.addEventListener('click', () => {
  navStack.pop();
  nav(navStack[navStack.length - 1] || 'home', false);
}));

// ---------------- Manage drawer ----------------
const manageDrawer = $('#manageDrawer');
$('#manageToggleBtn').addEventListener('click', () => {
  manageDrawer.classList.toggle('is-open');
  $('#manageToggleBtn').classList.toggle('is-active');
});
$$('.tabs button').forEach(tabBtn => {
  tabBtn.addEventListener('click', () => {
    $$('.tabs button').forEach(b => b.classList.remove('is-active'));
    tabBtn.classList.add('is-active');
    $$('.tabPanel').forEach(p => p.classList.toggle('is-active', p.dataset.panel === tabBtn.dataset.tab));
  });
});

// ---------------- Players (roster) ----------------
let rosterCache = [];
let pendingPhoto = null;

$('#playerPhotoInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  pendingPhoto = await resizeImageFile(file, 200, 0.75);
  $('#playerPhotoPreview').src = pendingPhoto;
  $('#playerPhotoPreview').hidden = false;
  $('#photoPickerPlaceholder').hidden = true;
});

$('#playerAddForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('#playerNameInput').value.trim();
  if (!name) return;
  await db.collection('players').add({
    name,
    role: $('#playerRoleInput').value,
    photo: pendingPhoto || null,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  e.target.reset();
  pendingPhoto = null;
  $('#playerPhotoPreview').hidden = true;
  $('#photoPickerPlaceholder').hidden = false;
  toast('Player added');
});

function renderRoster() {
  const grid = $('#rosterGrid');
  grid.innerHTML = rosterCache.length ? '' : '<p class="emptyState">No players yet — add one above.</p>';
  rosterCache.forEach(p => {
    const card = document.createElement('div');
    card.className = 'playerCard';
    card.innerHTML = `
      <button class="cardDelete" title="Remove">×</button>
      <img class="playerCard__photo" src="${p.photo || fallbackAvatar(p.name)}" alt="">
      <div class="playerCard__name">${escapeHtml(p.name)}</div>
      <div class="playerCard__role">${roleLabel(p.role)}</div>`;
    card.querySelector('.cardDelete').addEventListener('click', () => db.collection('players').doc(p.id).delete());
    grid.appendChild(card);
  });
  fillPlayerSelects();
}
function roleLabel(r) { return { bat: 'Batter', bowl: 'Bowler', all: 'All-rounder', wk: 'Wicketkeeper' }[r] || r; }
function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fallbackAvatar(name) {
  const initial = (name || '?')[0].toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="%231A4433"/><text x="32" y="40" font-size="26" fill="%23E8B33D" text-anchor="middle" font-family="Arial">${initial}</text></svg>`;
  return `data:image/svg+xml,${svg}`;
}

db.collection('players').orderBy('name').onSnapshot(snap => {
  rosterCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderRoster();
});

function fillPlayerSelects() {
  ['strikerSelect', 'nonStrikerSelect', 'bowlerSelect'].forEach(id => {
    const sel = $('#' + id);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = rosterCache.length
      ? rosterCache.map(p => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`).join('')
      : '<option value="">Add players in ⚙ Manage first</option>';
    if (current) sel.value = current;
  });
}

// ---------------- Gallery ----------------
$('#galleryPhotoInput').addEventListener('change', async e => {
  const files = [...e.target.files];
  for (const file of files) {
    const dataUrl = await resizeImageFile(file, 900, 0.75);
    await db.collection('gallery').add({ photo: dataUrl, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  }
  e.target.value = '';
  toast(files.length > 1 ? 'Photos uploaded' : 'Photo uploaded');
});

db.collection('gallery').orderBy('createdAt', 'desc').limit(60).onSnapshot(snap => {
  const grid = $('#galleryGrid');
  grid.innerHTML = snap.empty ? '<p class="emptyState">No photos yet — upload some above.</p>' : '';
  snap.forEach(doc => {
    const d = doc.data();
    const item = document.createElement('div');
    item.className = 'galleryItem';
    item.innerHTML = `<img src="${d.photo}" alt=""><button class="cardDelete" style="top:6px;right:6px" title="Remove">×</button>`;
    item.querySelector('.cardDelete').addEventListener('click', () => db.collection('gallery').doc(doc.id).delete());
    grid.appendChild(item);
  });
});

// ---------------- Sessions: create / join / list ----------------
function genCode() { return String(Math.floor(10000 + Math.random() * 90000)); }

let draft = null; // { code, teamA, teamB, overs, toss:{winner,decision} }

$('#createSessionBtn').addEventListener('click', async () => {
  const code = genCode();
  const ownerToken = uid();
  localStorage.setItem('owner_' + code, ownerToken);
  draft = { code, ownerToken };
  $('#setupCodeBanner').textContent = `Session code  ${code.split('').join(' ')}`;
  $('#tossResult').hidden = true;
  $('#startMatchBtn').disabled = false;
  fillPlayerSelects();
  await db.collection('sessions').doc(code).set({
    code,
    ownerToken,
    status: 'setup',
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  nav('setup');
});

$('#joinSessionBtn').addEventListener('click', () => openSessionByCode($('#joinCodeInput').value.trim()));

async function openSessionByCode(code) {
  if (!/^\d{5}$/.test(code)) { toast('Enter a valid 5-digit code'); return; }
  const doc = await db.collection('sessions').doc(code).get();
  if (!doc.exists) { toast('No session found with that code'); return; }
  watchSession(code);
  nav('live');
}

let tossWinner = null;
$('#coinFlipBtn').addEventListener('click', () => {
  const teamA = $('#teamAName').value.trim() || 'Team A';
  const teamB = $('#teamBName').value.trim() || 'Team B';
  tossWinner = Math.random() < 0.5 ? teamA : teamB;
  $('#tossWinnerName').textContent = tossWinner;
  $('#tossResult').hidden = false;
});
let tossDecision = null;
$$('#tossResult .segmented button').forEach(b => b.addEventListener('click', () => {
  tossDecision = b.dataset.choice;
  $$('#tossResult .segmented button').forEach(x => x.classList.remove('is-active'));
  b.classList.add('is-active');
}));

$('#startMatchBtn').addEventListener('click', async () => {
  const teamA = $('#teamAName').value.trim() || 'Team A';
  const teamB = $('#teamBName').value.trim() || 'Team B';
  const overs = parseInt($('#oversInput').value, 10) || 20;
  const striker = $('#strikerSelect').value;
  const nonStriker = $('#nonStrikerSelect').value;
  const bowler = $('#bowlerSelect').value;
  if (!striker || !nonStriker || !bowler) { toast('Pick opening players first'); return; }
  if (striker === nonStriker) { toast('Striker and non-striker must differ'); return; }
  await db.collection('sessions').doc(draft.code).update({
    teamA, teamB, overs,
    toss: { winner: tossWinner || teamA, decision: tossDecision || 'bat' },
    striker, nonStriker, bowler,
    score: { runs: 0, wickets: 0, balls: 0 },
    log: [],
    status: 'live',
  });
  watchSession(draft.code);
  nav('live');
});

// ---------------- Live session watching + scoring ----------------
let currentCode = null, currentUnsub = null, currentData = null, isOwner = false;

function watchSession(code) {
  if (currentUnsub) currentUnsub();
  currentCode = code;
  isOwner = localStorage.getItem('owner_' + code) !== null;
  currentUnsub = db.collection('sessions').doc(code).onSnapshot(doc => {
    if (!doc.exists) return;
    currentData = doc.data();
    renderLive();
  });
}

function renderLive() {
  const d = currentData;
  $('#liveCodeBanner').textContent = `Session code  ${currentCode.split('').join(' ')}`;
  const balls = d.score?.balls || 0;
  $('#oversText').textContent = `Over ${Math.floor(balls / 6)}.${balls % 6} of ${d.overs}`;
  $('#scoreText').textContent = `${d.score?.runs || 0}/${d.score?.wickets || 0}`;
  $('#namesText').textContent = `${d.teamA} vs ${d.teamB}`;
  $('#onCrease').innerHTML = `<span>🏏 <b>${escapeHtml(d.striker || '')}</b>*</span><span>${escapeHtml(d.nonStriker || '')}</span><span>Bowler: <b>${escapeHtml(d.bowler || '')}</b></span>`;

  const strip = $('#ledStrip');
  strip.innerHTML = '';
  (d.log || []).slice(-18).forEach(entry => {
    const led = document.createElement('span');
    led.className = 'led' + (entry.wicket ? ' led--w' : entry.extra ? ' led--extra' : entry.r === 4 ? ' led--4' : entry.r === 6 ? ' led--6' : '');
    led.textContent = entry.wicket ? 'W' : entry.extra ? entry.extra.toUpperCase() : entry.r;
    strip.appendChild(led);
  });

  const live = d.status === 'live';
  $('#quickScore').hidden = !(isOwner && live);
  $('#endInningsBtn').hidden = !(isOwner && live);
  $('#viewerNote').hidden = isOwner;
}

function makeLogEntry({ r = 0, extra = null, wicket = false }) {
  const legal = !(extra === 'wd' || extra === 'nb');
  const runsAdded = extra ? 1 : r;
  return { r: runsAdded, extra, wicket, legal, ts: Date.now() };
}

async function recordBall(opts) {
  if (!isOwner || !currentCode) return;
  const entry = makeLogEntry(opts);
  const ref = db.collection('sessions').doc(currentCode);
  await db.runTransaction(async tx => {
    const doc = await tx.get(ref);
    const d = doc.data();
    const score = { ...d.score };
    score.runs += entry.r;
    if (entry.legal) score.balls += 1;
    if (entry.wicket) score.wickets += 1;
    let { striker, nonStriker } = d;
    let swapped = false;
    const battingRunsOdd = !entry.extra && entry.r % 2 === 1;
    if (battingRunsOdd) { [striker, nonStriker] = [nonStriker, striker]; swapped = true; }
    if (entry.legal && score.balls % 6 === 0) { [striker, nonStriker] = [nonStriker, striker]; swapped = !swapped ? true : false; }
    entry.swapped = swapped;
    const log = [...(d.log || []), entry];
    tx.update(ref, { score, log, striker, nonStriker });
  });
}

async function undoLastBall() {
  if (!isOwner || !currentCode) return;
  const ref = db.collection('sessions').doc(currentCode);
  await db.runTransaction(async tx => {
    const doc = await tx.get(ref);
    const d = doc.data();
    const log = [...(d.log || [])];
    const entry = log.pop();
    if (!entry) return;
    const score = { ...d.score };
    score.runs -= entry.r;
    if (entry.legal) score.balls -= 1;
    if (entry.wicket) score.wickets -= 1;
    let { striker, nonStriker } = d;
    if (entry.swapped) [striker, nonStriker] = [nonStriker, striker];
    tx.update(ref, { score, log, striker, nonStriker });
  });
}

$('#quickScore').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.run !== undefined) recordBall({ r: parseInt(btn.dataset.run, 10) });
  else if (btn.dataset.extra) recordBall({ extra: btn.dataset.extra });
  else if (btn.dataset.wicket) recordBall({ wicket: true });
  else if (btn.dataset.action === 'undo') undoLastBall();
});

$('#endInningsBtn').addEventListener('click', async () => {
  await db.collection('sessions').doc(currentCode).update({ status: 'ended' });
  toast('Match ended');
});

// ---------------- Scorecard ----------------
$('#viewScorecardBtn').addEventListener('click', () => {
  const d = currentData;
  $('#scorecardTitle').textContent = `${d.teamA} vs ${d.teamB}`;
  const balls = d.score?.balls || 0;
  const rows = (d.log || []).map((e, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${e.wicket ? 'Wicket' : e.extra ? e.extra.toUpperCase() : e.r + ' run' + (e.r === 1 ? '' : 's')}</td>
    </tr>`).join('');
  $('#scorecardBody').innerHTML = `
    <p><strong>${d.score?.runs || 0}/${d.score?.wickets || 0}</strong> after ${Math.floor(balls / 6)}.${balls % 6} overs (of ${d.overs})</p>
    <p class="muted">Toss: ${d.toss ? `${escapeHtml(d.toss.winner)} chose to ${d.toss.decision}` : '—'}</p>
    <table><thead><tr><th>Ball</th><th>Outcome</th></tr></thead><tbody>${rows || '<tr><td colspan="2">No balls bowled yet</td></tr>'}</tbody></table>`;
  nav('scorecard');
});

// ---------------- Home: session lists ----------------
db.collection('sessions').orderBy('createdAt', 'desc').limit(25).onSnapshot(snap => {
  const live = $('#liveSessionList'), past = $('#pastSessionList');
  live.innerHTML = ''; past.innerHTML = '';
  snap.forEach(doc => {
    const d = doc.data();
    const li = document.createElement('li');
    li.className = 'sessionCard';
    const scoreLine = d.score ? `${d.score.runs}/${d.score.wickets}` : 'Not started';
    li.innerHTML = `
      <div>
        <div class="sessionCard__code">${doc.id}</div>
        <div class="sessionCard__meta">${escapeHtml(d.teamA || '')} ${d.teamB ? 'vs ' + escapeHtml(d.teamB) : ''} · ${scoreLine}</div>
      </div>
      <span class="badge ${d.status === 'ended' ? 'badge--ended' : ''}">${d.status === 'ended' ? 'Ended' : d.status === 'live' ? 'Live' : 'Setup'}</span>`;
    li.addEventListener('click', () => openSessionByCode(doc.id));
    (d.status === 'ended' ? past : live).appendChild(li);
  });
  if (!live.children.length) live.innerHTML = '<p class="emptyState">No matches happening right now.</p>';
  if (!past.children.length) past.innerHTML = '<p class="emptyState">No past sessions yet.</p>';
});
