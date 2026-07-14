// ============================================================
// CricketScore — app.js
// All state lives in Firestore (collections: players, gallery,
// sessions). Every open tab/device subscribes with onSnapshot,
// so a session updates live everywhere the code is entered.
//
// Match flow:
//   1. Setup: team names, overs, toss (Team A calls heads/tails,
//      then the coin decides, then the winner picks bat/bowl),
//      then build Team A / Team B player lists (from roster
//      and/or free-typed names — a name can be added to both
//      teams to balance sides, either via the "common players"
//      list or the "add to both" checkbox next to a typed name).
//   2. Live - openers: pick striker + non-striker for the batting
//      team (decided by the toss).
//   3. Live - bowler: pick the opening bowler. After every
//      completed over (6 legal balls) the bowler is cleared and
//      this step repeats — mandatory, and the previous over's
//      bowler is excluded (can't bowl two overs running).
//   4. Live - wicket: whenever a wicket falls, scoring is blocked
//      until the next batter is chosen from the remaining team.
//   5. Innings ends automatically (all overs bowled, or all out),
//      the match ends, and the owner can view the full scorecard.
// ============================================================

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function toast(msg) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2200);
}

function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
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
if ($('#manageToggleBtn')) {
  $('#manageToggleBtn').addEventListener('click', () => {
    manageDrawer.classList.toggle('is-open');
    $('#manageToggleBtn').classList.toggle('is-active');
  });
}
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

if ($('#playerPhotoInput')) {
  $('#playerPhotoInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    pendingPhoto = await resizeImageFile(file, 200, 0.75);
    $('#playerPhotoPreview').src = pendingPhoto;
    $('#playerPhotoPreview').hidden = false;
    $('#photoPickerPlaceholder').hidden = true;
  });
}

if ($('#playerAddForm')) {
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
}

function renderRoster() {
  const grid = $('#rosterGrid');
  if (!grid) return;
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
  // Setup screen's team pickers are roster-driven, keep them fresh too.
  if (draft) renderTeamPlayerPickers();
}
function roleLabel(r) { return { bat: 'Batter', bowl: 'Bowler', all: 'All-rounder', wk: 'Wicketkeeper' }[r] || r; }
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fallbackAvatar(name) {
  const initial = (name || '?')[0].toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="%231A4433"/><text x="32" y="40" font-size="26" fill="%23E8B33D" text-anchor="middle" font-family="Arial">${initial}</text></svg>`;
  return `data:image/svg+xml,${svg}`;
}
// Look up an avatar for any name in play — roster players use their real
// photo (or roster fallback), free-typed / ad-hoc names get an initials
// avatar so every player, roster or not, shows as "name + image".
function avatarFor(name) {
  const rosterPlayer = rosterCache.find(p => p.name === name);
  return (rosterPlayer && rosterPlayer.photo) || fallbackAvatar(name);
}

db.collection('players').orderBy('name').onSnapshot(snap => {
  rosterCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderRoster();
});

// ---------------- Gallery ----------------
if ($('#galleryPhotoInput')) {
  $('#galleryPhotoInput').addEventListener('change', async e => {
    const files = [...e.target.files];
    for (const file of files) {
      const dataUrl = await resizeImageFile(file, 900, 0.75);
      await db.collection('gallery').add({ photo: dataUrl, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    }
    e.target.value = '';
    toast(files.length > 1 ? 'Photos uploaded' : 'Photo uploaded');
  });
}

db.collection('gallery').orderBy('createdAt', 'desc').limit(60).onSnapshot(snap => {
  const grid = $('#galleryGrid');
  if (!grid) return;
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

// draft = the setup-in-progress session, before it goes live.
let draft = null; // { code, ownerToken, teamAPlayers: [names], teamBPlayers: [names] }

function resetTossUI() {
  tossWinner = null;
  tossDecision = null;
  tossCall = null;
  tossFlip = null;
  if ($('#tossResult')) $('#tossResult').hidden = true;
  if ($('#tossFlipOutcome')) $('#tossFlipOutcome').textContent = '';
  $$('#tossResult .segmented button').forEach(x => x.classList.remove('is-active'));
  $$('.callBtn').forEach(x => x.classList.remove('is-active'));
  if ($('#coinFlipBtn')) $('#coinFlipBtn').disabled = true;
  if ($('#coinFlipHint')) $('#coinFlipHint').hidden = false;
  updateTossCallPrompt();
}

function updateTossCallPrompt() {
  const prompt = $('#tossCallPrompt');
  if (!prompt) return;
  const teamA = ($('#teamAName') && $('#teamAName').value.trim()) || 'Team A';
  prompt.textContent = `${teamA}, call it in the air:`;
}

if ($('#createSessionBtn')) {
  $('#createSessionBtn').addEventListener('click', async () => {
    const code = genCode();
    const ownerToken = uid();
    localStorage.setItem('owner_' + code, ownerToken);
    draft = { code, ownerToken, teamAPlayers: [], teamBPlayers: [] };
    $('#setupCodeBanner').textContent = `Session code  ${code.split('').join(' ')}`;
    $('#teamAName').value = '';
    $('#teamBName').value = '';
    $('#oversInput').value = 20;
    if ($('#balanceBothTeamsCheck')) $('#balanceBothTeamsCheck').checked = false;
    if ($('#commonPlayersDetails')) $('#commonPlayersDetails').open = false;
    resetTossUI();
    renderTeamPlayerPickers();
    await db.collection('sessions').doc(code).set({
      code,
      ownerToken,
      status: 'setup',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    nav('setup');
  });
}

if ($('#joinSessionBtn')) {
  $('#joinSessionBtn').addEventListener('click', () => openSessionByCode($('#joinCodeInput').value.trim()));
}

async function openSessionByCode(code) {
  if (!/^\d{5}$/.test(code)) { toast('Enter a valid 5-digit code'); return; }
  const doc = await db.collection('sessions').doc(code).get();
  if (!doc.exists) { toast('No session found with that code'); return; }
  watchSession(code);
  nav('live');
}

// ---------------- Setup: toss ----------------
// Flow: Team A calls heads or tails -> coin is flipped -> the actual
// result is compared against Team A's call to find the toss winner ->
// the winner picks to bat or bowl.
let tossWinner = null;
let tossDecision = null;
let tossCall = null;   // 'heads' | 'tails' — Team A's call
let tossFlip = null;   // 'heads' | 'tails' — the actual flip result

// Keep the "Team A, call it..." label in sync if the name is typed after load.
if ($('#teamAName')) $('#teamAName').addEventListener('input', updateTossCallPrompt);

$$('.callBtn').forEach(btn => btn.addEventListener('click', () => {
  tossCall = btn.dataset.call;
  $$('.callBtn').forEach(b => b.classList.remove('is-active'));
  btn.classList.add('is-active');
  // A fresh call invalidates any previous flip/decision.
  tossWinner = null;
  tossDecision = null;
  tossFlip = null;
  if ($('#tossResult')) $('#tossResult').hidden = true;
  if ($('#coinFlipBtn')) $('#coinFlipBtn').disabled = false;
  if ($('#coinFlipHint')) $('#coinFlipHint').hidden = true;
}));

if ($('#coinFlipBtn')) {
  $('#coinFlipBtn').addEventListener('click', () => {
    if (!tossCall) { toast('Call heads or tails first'); return; }
    const teamA = $('#teamAName').value.trim() || 'Team A';
    const teamB = $('#teamBName').value.trim() || 'Team B';
    tossFlip = Math.random() < 0.5 ? 'heads' : 'tails';
    tossWinner = (tossFlip === tossCall) ? teamA : teamB;
    tossDecision = null;
    $$('#tossResult .segmented button').forEach(x => x.classList.remove('is-active'));
    if ($('#tossFlipOutcome')) {
      $('#tossFlipOutcome').textContent =
        `Coin shows ${tossFlip.toUpperCase()} — ${teamA} called ${tossCall}.`;
    }
    $('#tossWinnerName').textContent = tossWinner;
    $('#tossResult').hidden = false;
  });
}

$$('#tossResult .segmented button').forEach(b => b.addEventListener('click', () => {
  tossDecision = b.dataset.choice;
  $$('#tossResult .segmented button').forEach(x => x.classList.remove('is-active'));
  b.classList.add('is-active');
}));

// ---------------- Setup: team player pickers ----------------
function renderTeamPlayerPickers() {
  if (!draft) return;
  const rosterAList = $('#teamARosterList');
  const rosterBList = $('#teamBRosterList');
  if (!rosterAList || !rosterBList) return;
  const rosterOptionHtml = (team) => rosterCache.length
    ? rosterCache.map(p => `
        <label style="
            display:flex;
            align-items:center;
            gap:10px;
            padding:8px 12px;
            margin-bottom:8px;
            background:var(--pitch-800);
            border:1px solid var(--line);
            border-radius:10px;
            cursor:pointer;
            color:var(--cream);
        ">
            <input
                type="checkbox"
                data-roster-team="${team}"
                value="${escapeHtml(p.name)}"
                ${draft['team' + team + 'Players'].includes(p.name) ? 'checked' : ''}
            >
            <img
                src="${p.photo || fallbackAvatar(p.name)}"
                style="
                    width:36px;
                    height:36px;
                    border-radius:50%;
                    object-fit:cover;
                    border:1px solid var(--line);
                "
            >
            <div style="display:flex;flex-direction:column;">
                <span style="font-weight:600;">${escapeHtml(p.name)}</span>
                <small style="color:var(--gold);font-size:11px;">
                    ${roleLabel(p.role)}
                </small>
            </div>
        </label>
    `).join('')
    : '<p class="emptyState" style="margin:0">No roster players yet — add some in ⚙ Manage, or type a name below.</p>';
  rosterAList.innerHTML = rosterOptionHtml('A');
  rosterBList.innerHTML = rosterOptionHtml('B');
  renderCommonPlayersList();
  renderTeamChips();
}

// The "common players" collapsible: one checkbox per roster player. Ticking
// it adds that player to BOTH teams at once (and unticking removes them
// from both) — regardless of which team's roster list they were ticked in
// before.
function renderCommonPlayersList() {
  if (!draft) return;
  const list = $('#commonPlayersList');
  if (!list) return;
  list.innerHTML = rosterCache.length
    ? rosterCache.map(p => {
        const inBoth = draft.teamAPlayers.includes(p.name) && draft.teamBPlayers.includes(p.name);
        return `
        <label style="
            display:flex;
            align-items:center;
            gap:10px;
            padding:8px 12px;
            margin-bottom:8px;
            background:var(--pitch-800);
            border:1px solid var(--line);
            border-radius:10px;
            cursor:pointer;
            color:var(--cream);
        ">
            <input type="checkbox" data-common-player="${escapeHtml(p.name)}" value="${escapeHtml(p.name)}" ${inBoth ? 'checked' : ''}>
            <img src="${p.photo || fallbackAvatar(p.name)}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;border:1px solid var(--line);">
            <span style="font-weight:600;">${escapeHtml(p.name)}</span>
        </label>`;
      }).join('')
    : '<p class="emptyState" style="margin:0">No roster players yet.</p>';
}

function renderTeamChips() {
  if (!draft) return;
  const chip = (name, team) => {
    const inBoth = draft.teamAPlayers.includes(name) && draft.teamBPlayers.includes(name);
    return `
    <span style="background:#e8f0ea;border-radius:14px;padding:4px 10px 4px 4px;display:inline-flex;align-items:center;gap:6px;font-size:13px">
      <img src="${avatarFor(name)}" style="width:22px;height:22px;border-radius:50%;object-fit:cover;">
      ${escapeHtml(name)}
      ${inBoth ? '<span title="Plays for both teams" style="font-size:11px;">🔁</span>' : ''}
      <button type="button" data-remove-${team.toLowerCase()}="${escapeHtml(name)}" style="border:none;background:transparent;cursor:pointer;font-size:14px;line-height:1;padding:0">×</button>
    </span>`;
  };
  if ($('#teamAChips')) {
    $('#teamAChips').innerHTML = draft.teamAPlayers.length
      ? draft.teamAPlayers.map(n => chip(n, 'A')).join('')
      : '<span class="muted">No players added yet</span>';
  }
  if ($('#teamBChips')) {
    $('#teamBChips').innerHTML = draft.teamBPlayers.length
      ? draft.teamBPlayers.map(n => chip(n, 'B')).join('')
      : '<span class="muted">No players added yet</span>';
  }
}

function toggleTeamPlayer(team, name, checked) {
  const list = draft['team' + team + 'Players'];
  const idx = list.indexOf(name);
  if (checked && idx === -1) list.push(name);
  if (!checked && idx > -1) list.splice(idx, 1);
  syncCommonCheckbox(name);
  renderTeamChips();
}

// Keep the common-players checkbox for `name` in sync without rebuilding
// the whole list (avoids losing scroll position / focus).
function syncCommonCheckbox(name) {
  if (!draft) return;
  const cb = $(`input[data-common-player="${CSS.escape(name)}"]`);
  if (cb) cb.checked = draft.teamAPlayers.includes(name) && draft.teamBPlayers.includes(name);
}

// Keep a team roster checkbox in sync without rebuilding the whole list.
function syncRosterCheckbox(team, name) {
  const cb = $(`input[data-roster-team="${team}"][value="${CSS.escape(name)}"]`);
  if (cb) cb.checked = draft['team' + team + 'Players'].includes(name);
}

if ($('#teamARosterList')) {
  $('#teamARosterList').addEventListener('change', e => {
    const cb = e.target.closest('input[type=checkbox]');
    if (!cb) return;
    toggleTeamPlayer('A', cb.value, cb.checked);
  });
}
if ($('#teamBRosterList')) {
  $('#teamBRosterList').addEventListener('change', e => {
    const cb = e.target.closest('input[type=checkbox]');
    if (!cb) return;
    toggleTeamPlayer('B', cb.value, cb.checked);
  });
}
if ($('#commonPlayersList')) {
  $('#commonPlayersList').addEventListener('change', e => {
    const cb = e.target.closest('input[data-common-player]');
    if (!cb || !draft) return;
    const name = cb.value;
    ['A', 'B'].forEach(team => {
      const list = draft['team' + team + 'Players'];
      const idx = list.indexOf(name);
      if (cb.checked && idx === -1) list.push(name);
      if (!cb.checked && idx > -1) list.splice(idx, 1);
      syncRosterCheckbox(team, name);
    });
    renderTeamChips();
  });
}

function removeTeamPlayer(team, name) {
  const list = draft['team' + team + 'Players'];
  const idx = list.indexOf(name);
  if (idx > -1) list.splice(idx, 1);
  const cb = $(`input[data-roster-team="${team}"][value="${CSS.escape(name)}"]`);
  if (cb) cb.checked = false;
  syncCommonCheckbox(name);
  renderTeamChips();
}

if ($('#teamAChips')) {
  $('#teamAChips').addEventListener('click', e => {
    const btn = e.target.closest('button[data-remove-a]');
    if (!btn) return;
    removeTeamPlayer('A', btn.dataset.removeA);
  });
}
if ($('#teamBChips')) {
  $('#teamBChips').addEventListener('click', e => {
    const btn = e.target.closest('button[data-remove-b]');
    if (!btn) return;
    removeTeamPlayer('B', btn.dataset.removeB);
  });
}

if ($('#addTeamAPlayerBtn')) {
  $('#addTeamAPlayerBtn').addEventListener('click', () => {
    const input = $('#teamAAdHocInput');
    const name = input.value.trim();
    if (!name) return;
    const both = $('#balanceBothTeamsCheck') ? $('#balanceBothTeamsCheck').checked : false;
    if (!draft.teamAPlayers.includes(name)) draft.teamAPlayers.push(name);
    if (both && !draft.teamBPlayers.includes(name)) draft.teamBPlayers.push(name);
    input.value = '';
    input.focus();
    syncCommonCheckbox(name);
    renderTeamChips();
  });
}
if ($('#addTeamBPlayerBtn')) {
  $('#addTeamBPlayerBtn').addEventListener('click', () => {
    const input = $('#teamBAdHocInput');
    const name = input.value.trim();
    if (!name) return;
    const both = $('#balanceBothTeamsCheck') ? $('#balanceBothTeamsCheck').checked : false;
    if (!draft.teamBPlayers.includes(name)) draft.teamBPlayers.push(name);
    if (both && !draft.teamAPlayers.includes(name)) draft.teamAPlayers.push(name);
    input.value = '';
    input.focus();
    syncCommonCheckbox(name);
    renderTeamChips();
  });
}
// Pressing Enter in the ad-hoc name field adds the player too.
if ($('#teamAAdHocInput')) $('#teamAAdHocInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#addTeamAPlayerBtn').click(); } });
if ($('#teamBAdHocInput')) $('#teamBAdHocInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#addTeamBPlayerBtn').click(); } });

// ---------------- Setup: start match ----------------
if ($('#startMatchBtn')) {
  $('#startMatchBtn').addEventListener('click', async () => {
    const teamA = $('#teamAName').value.trim() || 'Team A';
    const teamB = $('#teamBName').value.trim() || 'Team B';
    const overs = parseInt($('#oversInput').value, 10) || 20;

    if (draft.teamAPlayers.length < 2) { toast(`Add at least 2 players to ${teamA}`); return; }
    if (draft.teamBPlayers.length < 2) { toast(`Add at least 2 players to ${teamB}`); return; }
    if (!tossCall) { toast('Team A must call heads or tails first'); return; }
    if (!tossWinner) { toast('Flip the coin to decide the toss first'); return; }
    if (!tossDecision) { toast('Pick bat or bowl after the toss'); return; }

    const winnerIsA = tossWinner === teamA;
    const battingTeam = (tossDecision === 'bat')
      ? (winnerIsA ? 'A' : 'B')
      : (winnerIsA ? 'B' : 'A');
    const bowlingTeam = battingTeam === 'A' ? 'B' : 'A';

    await db.collection('sessions').doc(draft.code).update({
      teamA, teamB, overs,
      toss: { call: tossCall, flip: tossFlip, winner: tossWinner, decision: tossDecision },
      teamAPlayers: draft.teamAPlayers,
      teamBPlayers: draft.teamBPlayers,
      battingTeam, bowlingTeam,
      striker: null,
      nonStriker: null,
      bowler: null,
      lastOverBowler: null,
      needNewBatsman: false,
      outSlot: null,
      score: { runs: 0, wickets: 0, balls: 0 },
      log: [],
      battingStats: {},
      bowlingStats: {},
      dismissedPlayers: [],
      status: 'live',
    });
    watchSession(draft.code);
    nav('live');
  });
}

// ---------------- Live session watching ----------------
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

function populateSelect(sel, names) {
  const el = typeof sel === 'string' ? $(sel) : sel;
  if (!el) return;
  el.innerHTML = names.length
    ? names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('')
    : '<option value="">No players available</option>';
}

function renderLive() {
  const d = currentData;
  if (!d) return;

  $('#liveCodeBanner').textContent = `Session code  ${currentCode.split('').join(' ')}`;
  const balls = d.score?.balls || 0;
  $('#oversText').textContent = `Over ${Math.floor(balls / 6)}.${balls % 6} of ${d.overs}`;
  $('#scoreText').textContent = `${d.score?.runs || 0}/${d.score?.wickets || 0}`;
  $('#namesText').textContent = `${d.teamA} vs ${d.teamB}`;
  $('#onCrease').innerHTML = d.striker
    ? `<span>🏏 <b>${escapeHtml(d.striker)}</b>${d.striker && !d.needNewBatsman ? '*' : ''}</span><span>${escapeHtml(d.nonStriker || '')}</span><span>Bowler: <b>${escapeHtml(d.bowler || '—')}</b></span>`
    : '<span class="muted">Waiting for openers…</span>';

  const strip = $('#ledStrip');
  if (strip) {
    strip.innerHTML = '';
    (d.log || []).slice(-18).forEach(entry => {
      const led = document.createElement('span');
      led.className = 'led' + (entry.wicket ? ' led--w' : entry.extra ? ' led--extra' : entry.r === 4 ? ' led--4' : entry.r === 6 ? ' led--6' : '');
      led.textContent = entry.wicket ? 'W' : entry.extra ? entry.extra.toUpperCase() : entry.r;
      strip.appendChild(led);
    });
  }

  const live = d.status === 'live';
  const ended = d.status === 'ended';

  const battingPlayers = (d.battingTeam === 'A' ? d.teamAPlayers : d.teamBPlayers) || [];
  const bowlingPlayers = (d.battingTeam === 'A' ? d.teamBPlayers : d.teamAPlayers) || [];

  const needOpeners = live && (!d.striker || !d.nonStriker);
  const needBatsman = live && !needOpeners && !!d.needNewBatsman;
  const needBowler = live && !needOpeners && !needBatsman && !d.bowler;
  const readyToScore = live && !needOpeners && !needBatsman && !needBowler;

  if ($('#openerPanel')) $('#openerPanel').hidden = !(isOwner && needOpeners);
  if ($('#newBatsmanPanel')) $('#newBatsmanPanel').hidden = !(isOwner && needBatsman);
  if ($('#bowlerPanel')) $('#bowlerPanel').hidden = !(isOwner && needBowler);
  if ($('#quickScore')) $('#quickScore').hidden = !(isOwner && readyToScore);
  if ($('#endInningsBtn')) $('#endInningsBtn').hidden = !(isOwner && live);
  if ($('#viewerNote')) $('#viewerNote').hidden = isOwner;
  if ($('#matchEndedBanner')) $('#matchEndedBanner').hidden = !ended;

  if (isOwner && needOpeners) {
    populateSelect('#liveStrikerSelect', battingPlayers);
    populateSelect('#liveNonStrikerSelect', battingPlayers);
  }
  if (isOwner && needBatsman) {
    const dismissed = d.dismissedPlayers || [];
    const otherOnCrease = d.outSlot === 'striker' ? d.nonStriker : d.striker;
    const outgoing = d.outSlot === 'striker' ? d.striker : d.nonStriker;
    const remaining = battingPlayers.filter(p => !dismissed.includes(p) && p !== otherOnCrease);
    if ($('#newBatsmanLabel')) $('#newBatsmanLabel').textContent = `${outgoing || 'Batter'} is out — pick the next batter`;
    populateSelect('#liveNewBatsmanSelect', remaining);
  }
  if (isOwner && needBowler) {
    let options = bowlingPlayers;
    if (d.lastOverBowler && bowlingPlayers.length > 1) {
      options = bowlingPlayers.filter(p => p !== d.lastOverBowler);
    }
    populateSelect('#liveBowlerSelect', options);
    if ($('#bowlerHint')) {
      $('#bowlerHint').textContent = d.lastOverBowler
        ? `${d.lastOverBowler} just finished an over and can't bowl the next one.`
        : `A bowler can't bowl two overs in a row.`;
    }
  }
}

// ---------------- Live: openers / bowler / next batter ----------------
if ($('#confirmOpenersBtn')) {
  $('#confirmOpenersBtn').addEventListener('click', async () => {
    const striker = $('#liveStrikerSelect').value;
    const nonStriker = $('#liveNonStrikerSelect').value;
    if (!striker || !nonStriker || striker === nonStriker) { toast('Pick two different openers'); return; }
    await db.collection('sessions').doc(currentCode).update({ striker, nonStriker });
  });
}

if ($('#confirmBowlerBtn')) {
  $('#confirmBowlerBtn').addEventListener('click', async () => {
    const bowler = $('#liveBowlerSelect').value;
    if (!bowler) { toast('Pick a bowler'); return; }
    await db.collection('sessions').doc(currentCode).update({ bowler });
  });
}

if ($('#confirmNewBatsmanBtn')) {
  $('#confirmNewBatsmanBtn').addEventListener('click', async () => {
    const name = $('#liveNewBatsmanSelect').value;
    if (!name) { toast('Pick the next batter'); return; }
    const d = currentData;
    const update = { needNewBatsman: false, outSlot: null };
    if (d.outSlot === 'striker') update.striker = name; else update.nonStriker = name;
    await db.collection('sessions').doc(currentCode).update(update);
  });
}

// ---------------- Live: scoring ----------------
function ensureBatter(stats, name) {
  if (!stats[name]) stats[name] = { runs: 0, balls: 0, fours: 0, sixes: 0, out: false, dismissal: null };
}
function ensureBowler(stats, name) {
  if (!stats[name]) stats[name] = { balls: 0, runs: 0, wickets: 0, wides: 0, noballs: 0 };
}
function formatDismissal(type, bowler, fielder) {
  fielder = (fielder || '').trim();
  switch (type) {
    case 'bowled': return `b ${bowler}`;
    case 'caught': return fielder ? `c ${fielder} b ${bowler}` : `c & b ${bowler}`;
    case 'lbw': return `lbw b ${bowler}`;
    case 'runout': return fielder ? `run out (${fielder})` : 'run out';
    case 'stumped': return fielder ? `st ${fielder} b ${bowler}` : `st b ${bowler}`;
    case 'hitwicket': return `hit wicket b ${bowler}`;
    default: return 'out';
  }
}

async function recordBall(opts) {
  if (!isOwner || !currentCode) return;
  const ref = db.collection('sessions').doc(currentCode);
  await db.runTransaction(async tx => {
    const doc = await tx.get(ref);
    const d = doc.data();
    if (d.status !== 'live' || !d.striker || !d.nonStriker || !d.bowler || d.needNewBatsman) return;

    // Snapshot everything this ball will touch, so undo can restore it exactly.
    const prev = {
      score: d.score,
      striker: d.striker,
      nonStriker: d.nonStriker,
      bowler: d.bowler,
      lastOverBowler: d.lastOverBowler || null,
      needNewBatsman: d.needNewBatsman || false,
      outSlot: d.outSlot || null,
      battingStats: d.battingStats || {},
      bowlingStats: d.bowlingStats || {},
      dismissedPlayers: d.dismissedPlayers || [],
      status: d.status,
    };

    const score = { ...d.score };
    const battingStats = JSON.parse(JSON.stringify(d.battingStats || {}));
    const bowlingStats = JSON.parse(JSON.stringify(d.bowlingStats || {}));
    let dismissedPlayers = [...(d.dismissedPlayers || [])];

    const strikerName = d.striker, bowlerName = d.bowler;
    ensureBatter(battingStats, strikerName);
    ensureBowler(bowlingStats, bowlerName);

    const legal = !(opts.extra === 'wd' || opts.extra === 'nb');
    const runsAdded = opts.extra ? 1 : (opts.r || 0);
    const entry = {
      r: runsAdded, extra: opts.extra || null, wicket: !!opts.wicket, legal,
      ts: Date.now(), batter: strikerName, bowler: bowlerName,
    };

    score.runs += entry.r;
    if (entry.legal) score.balls += 1;

    if (!entry.extra) {
      battingStats[strikerName].runs += entry.r;
      battingStats[strikerName].balls += 1;
      if (entry.r === 4) battingStats[strikerName].fours += 1;
      if (entry.r === 6) battingStats[strikerName].sixes += 1;
    } else if (entry.extra === 'b' || entry.extra === 'lb') {
      battingStats[strikerName].balls += 1;
    }

    bowlingStats[bowlerName].runs += entry.r;
    if (entry.legal) bowlingStats[bowlerName].balls += 1;
    if (entry.extra === 'wd') bowlingStats[bowlerName].wides = (bowlingStats[bowlerName].wides || 0) + 1;
    if (entry.extra === 'nb') bowlingStats[bowlerName].noballs = (bowlingStats[bowlerName].noballs || 0) + 1;

    let needNewBatsman = false, outSlot = null;
    if (entry.wicket) {
      score.wickets += 1;
      const slot = opts.outSlot === 'nonStriker' ? 'nonStriker' : 'striker';
      const outPlayerName = slot === 'striker' ? d.striker : d.nonStriker;
      ensureBatter(battingStats, outPlayerName);
      battingStats[outPlayerName].out = true;
      battingStats[outPlayerName].dismissal = formatDismissal(opts.dismissalType, bowlerName, opts.fielder);
      bowlingStats[bowlerName].wickets = (bowlingStats[bowlerName].wickets || 0) + 1;
      dismissedPlayers.push(outPlayerName);
      entry.outPlayer = outPlayerName;
      entry.dismissal = battingStats[outPlayerName].dismissal;

      const battingTeamPlayers = (d.battingTeam === 'A' ? d.teamAPlayers : d.teamBPlayers) || [];
      const otherOnCrease = slot === 'striker' ? d.nonStriker : d.striker;
      const remaining = battingTeamPlayers.filter(p => !dismissedPlayers.includes(p) && p !== otherOnCrease);
      if (remaining.length > 0) { needNewBatsman = true; outSlot = slot; }
    }

    let newStriker = d.striker, newNonStriker = d.nonStriker;
    let swapped = false;
    if (!entry.wicket && !entry.extra && entry.r % 2 === 1) {
      [newStriker, newNonStriker] = [newNonStriker, newStriker];
      swapped = true;
    }

    let newBowler = d.bowler, lastOverBowler = d.lastOverBowler || null;
    if (entry.legal && score.balls > 0 && score.balls % 6 === 0) {
      [newStriker, newNonStriker] = [newNonStriker, newStriker];
      swapped = !swapped;
      lastOverBowler = d.bowler;
      newBowler = null; // forces the mandatory bowler-change panel
    }
    entry.swapped = swapped;
    entry.prev = prev;

    const log = [...(d.log || []), entry];

    // Innings ends automatically: all overs bowled, or all out.
    const battingTeamPlayers = (d.battingTeam === 'A' ? d.teamAPlayers : d.teamBPlayers) || [];
    let status = d.status;
    if (score.balls >= d.overs * 6) status = 'ended';
    if (entry.wicket && needNewBatsman === false && dismissedPlayers.length >= battingTeamPlayers.length - 1) {
      // fewer than 2 players left to bat = all out
      status = 'ended';
    }

    tx.update(ref, {
      score, log, battingStats, bowlingStats, dismissedPlayers,
      striker: newStriker, nonStriker: newNonStriker,
      bowler: status === 'ended' ? d.bowler : newBowler,
      lastOverBowler,
      needNewBatsman: status === 'ended' ? false : needNewBatsman,
      outSlot: status === 'ended' ? null : outSlot,
      status,
    });
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
    if (!entry || !entry.prev) return;
    const p = entry.prev;
    tx.update(ref, {
      log,
      score: p.score,
      striker: p.striker,
      nonStriker: p.nonStriker,
      bowler: p.bowler,
      lastOverBowler: p.lastOverBowler,
      needNewBatsman: p.needNewBatsman,
      outSlot: p.outSlot,
      battingStats: p.battingStats,
      bowlingStats: p.bowlingStats,
      dismissedPlayers: p.dismissedPlayers,
      status: p.status,
    });
  });
}

if ($('#quickScore')) {
  $('#quickScore').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.run !== undefined) recordBall({ r: parseInt(btn.dataset.run, 10) });
    else if (btn.dataset.extra) recordBall({ extra: btn.dataset.extra });
    else if (btn.dataset.wicket) openWicketDialog();
    else if (btn.dataset.action === 'undo') undoLastBall();
  });
}

// ---------------- Wicket dialog ----------------
function openWicketDialog() {
  const d = currentData;
  $('#wicketOutSelect').innerHTML = `
    <option value="striker">${escapeHtml(d.striker)} (striker)</option>
    <option value="nonStriker">${escapeHtml(d.nonStriker)} (non-striker)</option>`;
  $('#wicketTypeSelect').value = 'bowled';
  $('#wicketFielderInput').value = '';
  $('#wicketDialog').hidden = false;
}
if ($('#wicketCancelBtn')) $('#wicketCancelBtn').addEventListener('click', () => { $('#wicketDialog').hidden = true; });
if ($('#wicketConfirmBtn')) {
  $('#wicketConfirmBtn').addEventListener('click', () => {
    const outSlot = $('#wicketOutSelect').value;
    const dismissalType = $('#wicketTypeSelect').value;
    const fielder = $('#wicketFielderInput').value.trim();
    $('#wicketDialog').hidden = true;
    recordBall({ wicket: true, outSlot, dismissalType, fielder });
  });
}

if ($('#endInningsBtn')) {
  $('#endInningsBtn').addEventListener('click', async () => {
    await db.collection('sessions').doc(currentCode).update({ status: 'ended' });
    toast('Match ended');
  });
}

// ---------------- Scorecard ----------------
if ($('#viewScorecardBtn')) {
  $('#viewScorecardBtn').addEventListener('click', () => {
    const d = currentData;
    $('#scorecardTitle').textContent = `${d.teamA} vs ${d.teamB}`;
    const balls = d.score?.balls || 0;
    const log = d.log || [];
    const battingTeamPlayers = (d.battingTeam === 'A' ? d.teamAPlayers : d.teamBPlayers) || [];
    const battingStats = d.battingStats || {};
    const bowlingStats = d.bowlingStats || {};

    // Batting order = order players first appear on strike in the log.
    const battedOrder = [];
    log.forEach(e => { if (e.batter && !battedOrder.includes(e.batter)) battedOrder.push(e.batter); });
    [d.striker, d.nonStriker].forEach(n => { if (n && !battedOrder.includes(n)) battedOrder.push(n); });

    const battingRows = battedOrder.map(name => {
      const s = battingStats[name] || { runs: 0, balls: 0, fours: 0, sixes: 0, out: false, dismissal: null };
      const sr = s.balls ? ((s.runs / s.balls) * 100).toFixed(2) : '0.00';
      const status = s.out
        ? escapeHtml(s.dismissal || 'out')
        : (name === d.striker || name === d.nonStriker ? 'not out' : '');
      return `<tr><td>${escapeHtml(name)}</td><td class="muted">${status}</td><td>${s.runs}</td><td>${s.balls}</td><td>${s.fours}</td><td>${s.sixes}</td><td>${sr}</td></tr>`;
    }).join('');

    const yetToBat = battingTeamPlayers.filter(p => !battedOrder.includes(p));

    const extrasRuns = log.filter(e => e.extra).reduce((sum, e) => sum + e.r, 0);
    const wides = log.filter(e => e.extra === 'wd').reduce((s, e) => s + e.r, 0);
    const noballs = log.filter(e => e.extra === 'nb').reduce((s, e) => s + e.r, 0);
    const byes = log.filter(e => e.extra === 'b').reduce((s, e) => s + e.r, 0);
    const legbyes = log.filter(e => e.extra === 'lb').reduce((s, e) => s + e.r, 0);

    const bowlingRows = Object.keys(bowlingStats).map(name => {
      const s = bowlingStats[name];
      const overs = `${Math.floor(s.balls / 6)}.${s.balls % 6}`;
      const eco = s.balls ? (s.runs / (s.balls / 6)).toFixed(2) : '0.00';
      return `<tr><td>${escapeHtml(name)}</td><td>${overs}</td><td>${s.runs}</td><td>${s.wickets}</td><td>${s.noballs || 0}</td><td>${s.wides || 0}</td><td>${eco}</td></tr>`;
    }).join('');

    let runTotal = 0, ballTotal = 0, wktCount = 0;
    const fow = [];
    log.forEach(e => {
      runTotal += e.r;
      if (e.legal) ballTotal += 1;
      if (e.wicket) {
        wktCount += 1;
        fow.push({ name: e.outPlayer, score: runTotal, wkt: wktCount, over: `${Math.floor(ballTotal / 6)}.${ballTotal % 6}` });
      }
    });
    const fowHtml = fow.map(w => `<tr><td>${escapeHtml(w.name)}</td><td>${w.score}-${w.wkt}</td><td>${w.over}</td></tr>`).join('');

    const runRate = balls ? ((d.score.runs || 0) / (balls / 6)).toFixed(2) : '0.00';

    $('#scorecardBody').innerHTML = `
      <p class="muted">Toss: ${d.toss ? `${escapeHtml(d.toss.winner)} chose to ${d.toss.decision}` : '—'}</p>
      <table>
        <thead><tr><th>Batter</th><th></th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead>
        <tbody>${battingRows || '<tr><td colspan="7">No batters yet</td></tr>'}</tbody>
      </table>
      <p><strong>Extras</strong> ${extrasRuns} (b ${byes}, lb ${legbyes}, w ${wides}, nb ${noballs})</p>
      <p><strong>Total</strong> ${d.score?.runs || 0}-${d.score?.wickets || 0} (${Math.floor(balls / 6)}.${balls % 6} overs, RR: ${runRate})</p>
      ${yetToBat.length ? `<p class="muted"><strong>Yet to bat</strong> ${yetToBat.map(escapeHtml).join(', ')}</p>` : ''}
      <table>
        <thead><tr><th>Bowler</th><th>O</th><th>R</th><th>W</th><th>NB</th><th>WD</th><th>ECO</th></tr></thead>
        <tbody>${bowlingRows || '<tr><td colspan="7">No overs bowled yet</td></tr>'}</tbody>
      </table>
      ${fow.length ? `
        <table>
          <thead><tr><th>Fall of Wickets</th><th>Score</th><th>Over</th></tr></thead>
          <tbody>${fowHtml}</tbody>
        </table>` : ''}
    `;
    nav('scorecard');
  });
}

// ---------------- Home: session lists ----------------
db.collection('sessions').orderBy('createdAt', 'desc').limit(25).onSnapshot(snap => {
  const live = $('#liveSessionList'), past = $('#pastSessionList');
  if (!live || !past) return;
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
