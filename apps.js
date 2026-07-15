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
//      Caught / run out / stumped ask which fielder was involved,
//      picked from the fielding side's own lineup (no free text).
//   5. Innings 1 ends automatically (all overs bowled, or all
//      out) — the app snapshots that innings, sets the chase
//      target (innings-1 runs + 1), swaps batting/bowling teams
//      and moves to an "innings break" screen. The owner starts
//      the 2nd innings when ready, then picks openers again.
//   6. During the 2nd innings a live chase bar shows the target,
//      runs still needed, balls left and required run rate. The
//      match ends the instant the target is reached, or when the
//      2nd innings finishes (all out / overs up) — whichever
//      comes first — and the result (win margin / tie) is worked
//      out from the two innings totals.
//   7. On match end, the owner can view the full two-innings
//      scorecard, see Man of the Match plus match awards (most
//      runs, most wickets, best economy, best strike rate), then
//      either proceed to another match in the same series (same
//      team names — same lineups, or reshuffle lineups) or end
//      the series and view Man of the Series + series awards
//      aggregated across every completed match in that series.
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
// seriesId links every match started via "proceed to next match" so
// series-wide awards can be aggregated later; seriesMatchNumber is this
// match's position within that series.
let draft = null; // { code, ownerToken, teamAPlayers: [names], teamBPlayers: [names], seriesId, seriesMatchNumber }

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

// Begins a fresh setup draft. `prefill` lets "proceed to next match" carry
// over the series id/number, team names, and (optionally) the previous
// lineups, so the owner isn't forced to retype anything that hasn't changed.
async function beginSetupDraft(prefill = {}) {
  const code = genCode();
  const ownerToken = uid();
  localStorage.setItem('owner_' + code, ownerToken);
  draft = {
    code,
    ownerToken,
    teamAPlayers: prefill.teamAPlayers ? [...prefill.teamAPlayers] : [],
    teamBPlayers: prefill.teamBPlayers ? [...prefill.teamBPlayers] : [],
    seriesId: prefill.seriesId || code,
    seriesMatchNumber: prefill.seriesMatchNumber || 1,
  };
  $('#setupCodeBanner').textContent = `Session code  ${code.split('').join(' ')}`;
  $('#teamAName').value = prefill.teamAName || '';
  $('#teamBName').value = prefill.teamBName || '';
  $('#oversInput').value = prefill.overs || 20;
  if ($('#balanceBothTeamsCheck')) $('#balanceBothTeamsCheck').checked = false;
  if ($('#commonPlayersDetails')) $('#commonPlayersDetails').open = false;
  resetTossUI();
  renderTeamPlayerPickers();
  await db.collection('sessions').doc(code).set({
    code,
    ownerToken,
    status: 'setup',
    seriesId: draft.seriesId,
    seriesMatchNumber: draft.seriesMatchNumber,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  nav('setup');
}

if ($('#createSessionBtn')) {
  $('#createSessionBtn').addEventListener('click', () => beginSetupDraft());
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
      innings: 1,
      target: null,
      firstInnings: null,
      seriesId: draft.seriesId,
      seriesMatchNumber: draft.seriesMatchNumber,
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

// The innings-break screen between innings 1 and innings 2: shows the
// target the chasing team needs, and (owner only) a button to kick off
// the 2nd innings once everyone's ready.
function renderInningsBreakPanel(d) {
  const panel = $('#inningsBreakPanel');
  if (!panel) return;
  const show = d.status === 'innings-break' && !!d.firstInnings;
  panel.hidden = !show;
  if (!show) return;

  const team1Name = d.firstInnings.battingTeam === 'A' ? d.teamA : d.teamB;
  const team2Name = d.battingTeam === 'A' ? d.teamA : d.teamB;
  const overs1 = `${Math.floor(d.firstInnings.balls / 6)}.${d.firstInnings.balls % 6}`;

  panel.innerHTML = `
    <h2>Innings break</h2>
    <p>${escapeHtml(team1Name)} scored <b>${d.firstInnings.teamRuns}/${d.firstInnings.wickets}</b> from ${overs1} overs.</p>
    <p class="muted">${escapeHtml(team2Name)} need <b>${d.target}</b> to win from ${d.overs} overs.</p>
    ${isOwner
      ? '<div class="panelActions"><button class="btn btn--primary" id="startSecondInningsBtn" type="button">Start 2nd innings</button></div>'
      : '<p class="muted">Waiting for the scorer to start the chase…</p>'}
  `;
  if (isOwner) {
    const btn = $('#startSecondInningsBtn');
    if (btn) btn.addEventListener('click', async () => {
      await db.collection('sessions').doc(currentCode).update({ status: 'live' });
    });
  }
}

function renderLive() {
  const d = currentData;
  if (!d) return;

  $('#liveCodeBanner').textContent = `Session code  ${currentCode.split('').join(' ')}`;
  const balls = d.score?.balls || 0;
  $('#oversText').textContent = `Over ${Math.floor(balls / 6)}.${balls % 6} of ${d.overs}${(d.innings || 1) === 2 ? ' · 2nd innings' : ''}`;
  $('#scoreText').textContent = `${d.score?.runs || 0}/${d.score?.wickets || 0}`;
  $('#namesText').textContent = `${d.teamA} vs ${d.teamB}`;

  if (d.status === 'innings-break') {
    $('#onCrease').innerHTML = '<span class="muted">Innings break</span>';
  } else {
    $('#onCrease').innerHTML = d.striker
      ? `<span>🏏 <b>${escapeHtml(d.striker)}</b>${d.striker && !d.needNewBatsman ? '*' : ''}</span><span>${escapeHtml(d.nonStriker || '')}</span><span>Bowler: <b>${escapeHtml(d.bowler || '—')}</b></span>`
      : '<span class="muted">Waiting for openers…</span>';
  }

  // Live chase bar: target / runs needed / balls left / required run rate.
  const chaseBar = $('#chaseBar');
  if (chaseBar) {
    const showChase = d.status === 'live' && (d.innings || 1) === 2 && d.target != null;
    chaseBar.hidden = !showChase;
    if (showChase) {
      const ballsLeft = Math.max(0, d.overs * 6 - balls);
      const runsNeeded = Math.max(0, d.target - (d.score?.runs || 0));
      const rrr = ballsLeft > 0 ? (runsNeeded / (ballsLeft / 6)).toFixed(2) : '—';
      chaseBar.innerHTML = `Target <b>${d.target}</b> &nbsp;·&nbsp; Need <b>${runsNeeded}</b> off <b>${ballsLeft}</b> balls &nbsp;·&nbsp; RRR <b>${rrr}</b>`;
    }
  }

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

  renderInningsBreakPanel(d);

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
  if ($('#endInningsBtn')) {
    $('#endInningsBtn').hidden = !(isOwner && live);
    $('#endInningsBtn').textContent = (d.innings || 1) === 1 ? 'End innings' : 'End match';
  }
  if ($('#viewResultBtn')) $('#viewResultBtn').hidden = !ended;
  if ($('#viewerNote')) $('#viewerNote').hidden = isOwner;
  if ($('#matchEndedBanner')) {
    $('#matchEndedBanner').hidden = !ended;
    if (ended) $('#matchEndedBanner').textContent = computeMatchResultText(d) || 'Match ended';
  }

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

// Records one ball, and handles all the automatic state transitions that
// follow it: over/bowler changes, wickets needing a new batter, the 1st
// innings ending (-> innings break, with a chase target set), the chase
// being completed (-> match ends immediately, even mid-over), and the
// 2nd innings ending normally (-> match ends).
async function recordBall(opts) {
  if (!isOwner || !currentCode) return;
  const ref = db.collection('sessions').doc(currentCode);
  await db.runTransaction(async tx => {
    const doc = await tx.get(ref);
    const d = doc.data();
    if (d.status !== 'live' || !d.striker || !d.nonStriker || !d.bowler || d.needNewBatsman) return;

    // Snapshot everything this ball will touch, so undo can restore it exactly
    // — including a full innings-transition if this ball happens to trigger one.
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
      innings: d.innings || 1,
      target: d.target || null,
      firstInnings: d.firstInnings || null,
      battingTeam: d.battingTeam,
      bowlingTeam: d.bowlingTeam,
    };

    const score = { ...d.score };
    const battingStats = JSON.parse(JSON.stringify(d.battingStats || {}));
    const bowlingStats = JSON.parse(JSON.stringify(d.bowlingStats || {}));
    let dismissedPlayers = [...(d.dismissedPlayers || [])];

    const strikerName = d.striker, bowlerName = d.bowler;
    ensureBatter(battingStats, strikerName);
    ensureBowler(bowlingStats, bowlerName);

    const legal = !(opts.extra === 'wd' || opts.extra === 'nb');
    // Runs actually run between the wickets by the batsmen — for a wide or
    // no-ball this is on TOP of the fixed 1-run penalty; for a bye or leg
    // bye there's no penalty, so this is the whole total. Strike rotation
    // below is based on this "runs run" count, not the total added to the
    // score (which, for wd/nb, includes the penalty that nobody ran for).
    const extraRunsRun = (opts.extra === 'wd' || opts.extra === 'nb' || opts.extra === 'b' || opts.extra === 'lb')
      ? Math.max(0, parseInt(opts.r, 10) || 0)
      : 0;
    let runsAdded;
    if (opts.extra === 'wd' || opts.extra === 'nb') {
      runsAdded = 1 + extraRunsRun;
    } else if (opts.extra === 'b' || opts.extra === 'lb') {
      runsAdded = extraRunsRun;
    } else {
      runsAdded = opts.r || 0;
    }
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

    const battingTeamPlayers = (d.battingTeam === 'A' ? d.teamAPlayers : d.teamBPlayers) || [];

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
      if (opts.fielder) entry.fielder = opts.fielder;

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

    const inningsNum = d.innings || 1;
    const allOut = !!entry.wicket && !needNewBatsman && dismissedPlayers.length >= battingTeamPlayers.length - 1;
    const oversDone = score.balls >= d.overs * 6;
    const targetReached = inningsNum === 2 && d.target != null && score.runs >= d.target;

    const update = {
      score, log, battingStats, bowlingStats, dismissedPlayers,
      striker: newStriker, nonStriker: newNonStriker,
      bowler: newBowler, lastOverBowler,
      needNewBatsman, outSlot,
      status: 'live',
    };

    if (targetReached) {
      // Chase completed — the match ends the instant the winning run lands,
      // even mid-over. Freeze the on-field state as it stood at that ball.
      update.status = 'ended';
      update.bowler = d.bowler;
      update.needNewBatsman = false;
      update.outSlot = null;
    } else if (allOut || oversDone) {
      if (inningsNum === 1) {
        // Innings change: snapshot innings 1, set the chase target, swap
        // batting/bowling teams, and reset all live-scoring state for a
        // fresh 2nd innings (openers/bowler get picked again).
        update.status = 'innings-break';
        update.innings = 2;
        update.firstInnings = {
          battingTeam: d.battingTeam,
          teamRuns: score.runs, wickets: score.wickets, balls: score.balls,
          battingStats, bowlingStats, log, dismissedPlayers,
        };
        update.target = score.runs + 1;
        update.battingTeam = d.bowlingTeam;
        update.bowlingTeam = d.battingTeam;
        update.striker = null;
        update.nonStriker = null;
        update.bowler = null;
        update.lastOverBowler = null;
        update.needNewBatsman = false;
        update.outSlot = null;
        update.score = { runs: 0, wickets: 0, balls: 0 };
        update.log = [];
        update.battingStats = {};
        update.bowlingStats = {};
        update.dismissedPlayers = [];
      } else {
        update.status = 'ended';
        update.bowler = d.bowler;
        update.needNewBatsman = false;
        update.outSlot = null;
      }
    }

    tx.update(ref, update);
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
      innings: p.innings,
      target: p.target,
      firstInnings: p.firstInnings,
      battingTeam: p.battingTeam,
      bowlingTeam: p.bowlingTeam,
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

// Manual innings/match end (owner override, for declarations or curtailed
// play). Innings 1 -> innings break with a chase target; innings 2 -> match end.
async function manualEndInnings() {
  if (!isOwner || !currentCode) return;
  const ref = db.collection('sessions').doc(currentCode);
  await db.runTransaction(async tx => {
    const doc = await tx.get(ref);
    const d = doc.data();
    if (d.status !== 'live') return;
    const inningsNum = d.innings || 1;
    if (inningsNum === 1) {
      tx.update(ref, {
        status: 'innings-break',
        innings: 2,
        firstInnings: {
          battingTeam: d.battingTeam,
          teamRuns: d.score?.runs || 0, wickets: d.score?.wickets || 0, balls: d.score?.balls || 0,
          battingStats: d.battingStats || {}, bowlingStats: d.bowlingStats || {},
          log: d.log || [], dismissedPlayers: d.dismissedPlayers || [],
        },
        target: (d.score?.runs || 0) + 1,
        battingTeam: d.bowlingTeam,
        bowlingTeam: d.battingTeam,
        striker: null, nonStriker: null, bowler: null, lastOverBowler: null,
        needNewBatsman: false, outSlot: null,
        score: { runs: 0, wickets: 0, balls: 0 },
        log: [], battingStats: {}, bowlingStats: {}, dismissedPlayers: [],
      });
    } else {
      tx.update(ref, { status: 'ended' });
    }
  });
  toast((currentData && (currentData.innings || 1) === 1) ? 'Innings ended' : 'Match ended');
}
if ($('#endInningsBtn')) $('#endInningsBtn').addEventListener('click', manualEndInnings);

// ---------------- Wicket dialog ----------------
// "How out" determines whether a fielder is relevant at all, and the
// fielder is always picked from the fielding side's own lineup — never
// free-typed — so scorecards stay consistent with the roster.
function fielderOptionsFor(d) {
  return (d.battingTeam === 'A' ? d.teamBPlayers : d.teamAPlayers) || [];
}
function updateWicketFielderVisibility() {
  const type = $('#wicketTypeSelect') ? $('#wicketTypeSelect').value : '';
  const needsFielder = type === 'caught' || type === 'runout' || type === 'stumped';
  if ($('#wicketFielderField')) $('#wicketFielderField').hidden = !needsFielder;
}
function openWicketDialog() {
  const d = currentData;
  $('#wicketOutSelect').innerHTML = `
    <option value="striker">${escapeHtml(d.striker)} (striker)</option>
    <option value="nonStriker">${escapeHtml(d.nonStriker)} (non-striker)</option>`;
  $('#wicketTypeSelect').value = 'bowled';
  const fielders = fielderOptionsFor(d);
  if ($('#wicketFielderSelect')) {
    $('#wicketFielderSelect').innerHTML = fielders.length
      ? '<option value="">Not sure / unrecorded</option>' + fielders.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('')
      : '<option value="">No fielding-side players set</option>';
  }
  updateWicketFielderVisibility();
  $('#wicketDialog').hidden = false;
}
if ($('#wicketTypeSelect')) $('#wicketTypeSelect').addEventListener('change', updateWicketFielderVisibility);
if ($('#wicketCancelBtn')) $('#wicketCancelBtn').addEventListener('click', () => { $('#wicketDialog').hidden = true; });
if ($('#wicketConfirmBtn')) {
  $('#wicketConfirmBtn').addEventListener('click', () => {
    const outSlot = $('#wicketOutSelect').value;
    const dismissalType = $('#wicketTypeSelect').value;
    const fielder = $('#wicketFielderSelect') ? $('#wicketFielderSelect').value : '';
    $('#wicketDialog').hidden = true;
    recordBall({ wicket: true, outSlot, dismissalType, fielder });
  });
}

// ---------------- Match awards (fair, transparent scoring) ----------------
// Combines the two innings' stats into one flat view per player, tagging
// each with which team they represented, regardless of whether they batted
// in innings 1 or innings 2.
function mergeMatchStats(d) {
  const battingAll = {}, bowlingAll = {};
  const merge = (bStats, wStats, battingTeamOfInnings) => {
    Object.entries(bStats || {}).forEach(([name, s]) => { battingAll[name] = { ...s, team: battingTeamOfInnings }; });
    Object.entries(wStats || {}).forEach(([name, s]) => { bowlingAll[name] = { ...s, team: battingTeamOfInnings === 'A' ? 'B' : 'A' }; });
  };
  if (d.firstInnings) merge(d.firstInnings.battingStats, d.firstInnings.bowlingStats, d.firstInnings.battingTeam);
  merge(d.battingStats, d.bowlingStats, d.battingTeam);
  return { battingAll, bowlingAll };
}

// A single, documented formula used everywhere a "best player" needs
// picking (Man of the Match and, summed across matches, Man of the Series):
//   batting: runs + 1 per four + 2 per six, plus a strike-rate bonus
//            (only once at least an over's worth of balls faced, so a
//            couple of lucky boundaries can't inflate a tiny sample)
//   bowling: 20 per wicket, plus an economy bonus under the same
//            minimum-balls qualifier
// Ties are broken deterministically (more runs, then more wickets, then
// alphabetically) so the result never depends on iteration order.
function computePlayerScore(bat, bowl) {
  let score = 0;
  if (bat) {
    score += (bat.runs || 0) + (bat.fours || 0) * 1 + (bat.sixes || 0) * 2;
    if (bat.balls >= 6) {
      const sr = (bat.runs / bat.balls) * 100;
      if (sr > 100) score += (sr - 100) / 5;
    }
  }
  if (bowl) {
    score += (bowl.wickets || 0) * 20;
    if (bowl.balls >= 6) {
      const eco = bowl.runs / (bowl.balls / 6);
      if (eco < 6) score += (6 - eco) * 3;
    }
  }
  return score;
}

function computeMatchAwards(d) {
  const { battingAll, bowlingAll } = mergeMatchStats(d);
  const battersArr = Object.entries(battingAll).map(([name, s]) => ({ name, ...s }));
  const bowlersArr = Object.entries(bowlingAll).map(([name, s]) => ({ name, ...s }));

  const mostRuns = battersArr.length
    ? [...battersArr].sort((a, b) => b.runs - a.runs || b.balls - a.balls || a.name.localeCompare(b.name))[0]
    : null;
  const mostWickets = bowlersArr.length
    ? [...bowlersArr].sort((a, b) => b.wickets - a.wickets || a.runs - b.runs || a.name.localeCompare(b.name))[0]
    : null;

  const qualBowlers = bowlersArr.filter(b => b.balls >= 6);
  const economyPool = qualBowlers.length ? qualBowlers : bowlersArr;
  const bestEconomy = economyPool.length
    ? [...economyPool].sort((a, b) => (a.runs / (a.balls / 6 || 1)) - (b.runs / (b.balls / 6 || 1)))[0]
    : null;

  const qualBatters = battersArr.filter(b => b.balls >= 6);
  const srPool = qualBatters.length ? qualBatters : battersArr;
  const bestStrikeRate = srPool.length
    ? [...srPool].sort((a, b) => (b.runs / b.balls) - (a.runs / a.balls))[0]
    : null;

  const names = new Set([...Object.keys(battingAll), ...Object.keys(bowlingAll)]);
  let motm = null, motmScore = -Infinity;
  [...names].sort().forEach(name => {
    const score = computePlayerScore(battingAll[name], bowlingAll[name]);
    if (score > motmScore) { motmScore = score; motm = name; }
  });

  return { mostRuns, mostWickets, bestEconomy, bestStrikeRate, motm, motmScore };
}

// Works out the plain-English result from the two innings totals: chase
// completed = win by wickets in hand, overs/all-out without reaching the
// target = win by runs, equal totals = tie.
function computeMatchResultText(d) {
  if (d.status !== 'ended') return '';
  if (!d.firstInnings) return 'Match ended';
  const team1Name = d.firstInnings.battingTeam === 'A' ? d.teamA : d.teamB;
  const team2Name = d.battingTeam === 'A' ? d.teamA : d.teamB;
  const runs1 = d.firstInnings.teamRuns;
  const runs2 = d.score?.runs || 0;
  if (d.target != null && runs2 >= d.target) {
    const battingPlayers = (d.battingTeam === 'A' ? d.teamAPlayers : d.teamBPlayers) || [];
    const wicketsInHand = Math.max(0, battingPlayers.length - 1 - (d.score?.wickets || 0));
    return `${team2Name} won by ${wicketsInHand} wicket${wicketsInHand === 1 ? '' : 's'}`;
  }
  if (runs2 === runs1) return 'Match tied';
  if (runs2 < runs1) return `${team1Name} won by ${runs1 - runs2} run${runs1 - runs2 === 1 ? '' : 's'}`;
  return `${team2Name} won`;
}

function awardCardHtml(label, name, stat) {
  return `
    <div class="awardCard">
      <div class="awardCard__label">${label}</div>
      <div class="awardCard__name">${name ? escapeHtml(name) : '—'}</div>
      <div class="awardCard__stat">${stat || ''}</div>
    </div>`;
}

function renderMatchAwardsHtml(d) {
  const { mostRuns, mostWickets, bestEconomy, bestStrikeRate, motm } = computeMatchAwards(d);
  return `
    <div class="motmCard">
      <div class="motmCard__label">Man of the Match</div>
      <div class="motmCard__name">${motm ? escapeHtml(motm) : '—'}</div>
    </div>
    <div class="awardGrid">
      ${awardCardHtml('Most Runs', mostRuns?.name, mostRuns ? `${mostRuns.runs} (${mostRuns.balls}b)` : '')}
      ${awardCardHtml('Most Wickets', mostWickets?.name, mostWickets ? `${mostWickets.wickets}/${mostWickets.runs}` : '')}
      ${awardCardHtml('Best Economy', bestEconomy?.name, bestEconomy ? `${(bestEconomy.runs / (bestEconomy.balls / 6 || 1)).toFixed(2)} rpo` : '')}
      ${awardCardHtml('Best Strike Rate', bestStrikeRate?.name, bestStrikeRate ? `${((bestStrikeRate.runs / bestStrikeRate.balls) * 100 || 0).toFixed(1)} SR` : '')}
    </div>
  `;
}

function showMatchResult(d) {
  if (!d) return;
  $('#matchResultTitle').textContent = `${d.teamA} vs ${d.teamB}`;
  const resultText = computeMatchResultText(d);
  $('#matchResultBody').innerHTML = `
    <p class="resultBanner">${escapeHtml(resultText || 'Match ended')}</p>
    ${renderMatchAwardsHtml(d)}
  `;
  nav('matchresult');
}
if ($('#viewResultBtn')) $('#viewResultBtn').addEventListener('click', () => showMatchResult(currentData));

// ---------------- Next match / series flow ----------------
if ($('#mrNextMatchBtn')) $('#mrNextMatchBtn').addEventListener('click', () => { $('#nextMatchDialog').hidden = false; });
if ($('#nmCancelBtn')) $('#nmCancelBtn').addEventListener('click', () => { $('#nextMatchDialog').hidden = true; });

async function proceedNextMatch(sameTeams) {
  const d = currentData;
  if (!d) return;
  $('#nextMatchDialog').hidden = true;
  await beginSetupDraft({
    seriesId: d.seriesId || currentCode,
    seriesMatchNumber: (d.seriesMatchNumber || 1) + 1,
    teamAName: d.teamA,
    teamBName: d.teamB,
    overs: d.overs,
    teamAPlayers: sameTeams ? d.teamAPlayers : [],
    teamBPlayers: sameTeams ? d.teamBPlayers : [],
  });
  toast(sameTeams ? 'Same lineups carried over — set the toss' : 'Pick lineups for the next match');
}
if ($('#nmSameTeamsBtn')) $('#nmSameTeamsBtn').addEventListener('click', () => proceedNextMatch(true));
if ($('#nmReshuffleBtn')) $('#nmReshuffleBtn').addEventListener('click', () => proceedNextMatch(false));

// ---------------- Series awards ----------------
async function computeSeriesAwards(seriesId) {
  const snap = await db.collection('sessions')
    .where('seriesId', '==', seriesId)
    .where('status', '==', 'ended')
    .get();

  const battingTotals = {}, bowlingTotals = {}, seriesPoints = {};
  const matches = [];

  snap.forEach(doc => {
    const d = doc.data();
    matches.push(d);
    const { battingAll, bowlingAll } = mergeMatchStats(d);
    const names = new Set([...Object.keys(battingAll), ...Object.keys(bowlingAll)]);
    names.forEach(name => {
      const bat = battingAll[name], bowl = bowlingAll[name];
      if (bat) {
        if (!battingTotals[name]) battingTotals[name] = { runs: 0, balls: 0, fours: 0, sixes: 0 };
        battingTotals[name].runs += bat.runs || 0;
        battingTotals[name].balls += bat.balls || 0;
        battingTotals[name].fours += bat.fours || 0;
        battingTotals[name].sixes += bat.sixes || 0;
      }
      if (bowl) {
        if (!bowlingTotals[name]) bowlingTotals[name] = { balls: 0, runs: 0, wickets: 0 };
        bowlingTotals[name].balls += bowl.balls || 0;
        bowlingTotals[name].runs += bowl.runs || 0;
        bowlingTotals[name].wickets += bowl.wickets || 0;
      }
      seriesPoints[name] = (seriesPoints[name] || 0) + computePlayerScore(bat, bowl);
    });
  });

  const battersArr = Object.entries(battingTotals).map(([name, s]) => ({ name, ...s }));
  const bowlersArr = Object.entries(bowlingTotals).map(([name, s]) => ({ name, ...s }));

  const mostRuns = battersArr.length
    ? [...battersArr].sort((a, b) => b.runs - a.runs || b.balls - a.balls || a.name.localeCompare(b.name))[0]
    : null;
  const mostWickets = bowlersArr.length
    ? [...bowlersArr].sort((a, b) => b.wickets - a.wickets || a.runs - b.runs || a.name.localeCompare(b.name))[0]
    : null;
  const qualBowlers = bowlersArr.filter(b => b.balls >= 6);
  const economyPool = qualBowlers.length ? qualBowlers : bowlersArr;
  const bestEconomy = economyPool.length
    ? [...economyPool].sort((a, b) => (a.runs / (a.balls / 6 || 1)) - (b.runs / (b.balls / 6 || 1)))[0]
    : null;
  const qualBatters = battersArr.filter(b => b.balls >= 6);
  const srPool = qualBatters.length ? qualBatters : battersArr;
  const bestStrikeRate = srPool.length
    ? [...srPool].sort((a, b) => (b.runs / b.balls) - (a.runs / a.balls))[0]
    : null;

  let mots = null, motsScore = -Infinity;
  Object.keys(seriesPoints).sort().forEach(name => {
    if (seriesPoints[name] > motsScore) { motsScore = seriesPoints[name]; mots = name; }
  });

  return { matches, mostRuns, mostWickets, bestEconomy, bestStrikeRate, mots };
}

async function showSeriesAwards(seriesId) {
  nav('seriesawards');
  $('#seriesAwardsBody').innerHTML = '<p class="muted">Crunching the series numbers…</p>';
  let a;
  try {
    a = await computeSeriesAwards(seriesId);
  } catch (err) {
    $('#seriesAwardsBody').innerHTML = '<p class="emptyState">Could not load series stats.</p>';
    return;
  }
  const matchRows = a.matches
    .sort((x, y) => (x.seriesMatchNumber || 0) - (y.seriesMatchNumber || 0))
    .map(m => `
      <li class="sessionCard">
        <div>
          <div class="sessionCard__code">Match ${m.seriesMatchNumber || ''}</div>
          <div class="sessionCard__meta">${escapeHtml(m.teamA || '')} vs ${escapeHtml(m.teamB || '')} · ${escapeHtml(computeMatchResultText(m) || '')}</div>
        </div>
      </li>`).join('');

  $('#seriesAwardsBody').innerHTML = `
    <div class="motmCard">
      <div class="motmCard__label">Man of the Series</div>
      <div class="motmCard__name">${a.mots ? escapeHtml(a.mots) : '—'}</div>
    </div>
    <div class="awardGrid">
      ${awardCardHtml('Most Runs', a.mostRuns?.name, a.mostRuns ? `${a.mostRuns.runs} runs` : '')}
      ${awardCardHtml('Most Wickets', a.mostWickets?.name, a.mostWickets ? `${a.mostWickets.wickets} wkts` : '')}
      ${awardCardHtml('Best Economy', a.bestEconomy?.name, a.bestEconomy ? `${(a.bestEconomy.runs / (a.bestEconomy.balls / 6 || 1)).toFixed(2)} rpo` : '')}
      ${awardCardHtml('Best Strike Rate', a.bestStrikeRate?.name, a.bestStrikeRate ? `${((a.bestStrikeRate.runs / a.bestStrikeRate.balls) * 100 || 0).toFixed(1)} SR` : '')}
    </div>
    <h2 style="margin-top:20px">Matches in this series</h2>
    <ul class="sessionList">${matchRows || '<p class="emptyState">No completed matches yet.</p>'}</ul>
  `;
}
if ($('#mrEndSeriesBtn')) {
  $('#mrEndSeriesBtn').addEventListener('click', () => {
    if (!currentData) return;
    showSeriesAwards(currentData.seriesId || currentCode);
  });
}

// ---------------- Scorecard (both innings, when applicable) ----------------
function inningsScorecardHtml(view) {
  const battedOrder = [];
  (view.log || []).forEach(e => { if (e.batter && !battedOrder.includes(e.batter)) battedOrder.push(e.batter); });
  if (view.strikerNow && !battedOrder.includes(view.strikerNow)) battedOrder.push(view.strikerNow);
  if (view.nonStrikerNow && !battedOrder.includes(view.nonStrikerNow)) battedOrder.push(view.nonStrikerNow);

  const battingRows = battedOrder.map(name => {
    const s = view.battingStats[name] || { runs: 0, balls: 0, fours: 0, sixes: 0, out: false, dismissal: null };
    const sr = s.balls ? ((s.runs / s.balls) * 100).toFixed(2) : '0.00';
    const status = s.out
      ? escapeHtml(s.dismissal || 'out')
      : (name === view.strikerNow || name === view.nonStrikerNow ? 'not out' : '');
    return `<tr><td>${escapeHtml(name)}</td><td class="muted">${status}</td><td>${s.runs}</td><td>${s.balls}</td><td>${s.fours}</td><td>${s.sixes}</td><td>${sr}</td></tr>`;
  }).join('');

  const yetToBat = view.battingTeamPlayers.filter(p => !battedOrder.includes(p));
  const log = view.log || [];
  const extrasRuns = log.filter(e => e.extra).reduce((sum, e) => sum + e.r, 0);
  const wides = log.filter(e => e.extra === 'wd').reduce((s, e) => s + e.r, 0);
  const noballs = log.filter(e => e.extra === 'nb').reduce((s, e) => s + e.r, 0);
  const byes = log.filter(e => e.extra === 'b').reduce((s, e) => s + e.r, 0);
  const legbyes = log.filter(e => e.extra === 'lb').reduce((s, e) => s + e.r, 0);

  const bowlingRows = Object.keys(view.bowlingStats).map(name => {
    const s = view.bowlingStats[name];
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
  const runRate = view.balls ? (view.runs / (view.balls / 6)).toFixed(2) : '0.00';

  return `
    <h3 style="margin-top:22px">${escapeHtml(view.teamName)} innings</h3>
    <table>
      <thead><tr><th>Batter</th><th></th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead>
      <tbody>${battingRows || '<tr><td colspan="7">No batters yet</td></tr>'}</tbody>
    </table>
    <p><strong>Extras</strong> ${extrasRuns} (b ${byes}, lb ${legbyes}, w ${wides}, nb ${noballs})</p>
    <p><strong>Total</strong> ${view.runs}-${view.wickets} (${Math.floor(view.balls / 6)}.${view.balls % 6} overs, RR: ${runRate})</p>
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
}

function showScorecard(d) {
  if (!d) return;
  $('#scorecardTitle').textContent = `${d.teamA} vs ${d.teamB}`;

  let body = `<p class="muted">Toss: ${d.toss ? `${escapeHtml(d.toss.winner)} chose to ${d.toss.decision}` : '—'}</p>`;
  if (d.status === 'ended') {
    body += `<p class="resultBanner" style="text-align:left;font-size:1rem">${escapeHtml(computeMatchResultText(d) || '')}</p>`;
  }

  if (d.firstInnings) {
    const team1Name = d.firstInnings.battingTeam === 'A' ? d.teamA : d.teamB;
    body += inningsScorecardHtml({
      teamName: team1Name,
      battingTeamPlayers: (d.firstInnings.battingTeam === 'A' ? d.teamAPlayers : d.teamBPlayers) || [],
      battingStats: d.firstInnings.battingStats || {},
      bowlingStats: d.firstInnings.bowlingStats || {},
      log: d.firstInnings.log || [],
      runs: d.firstInnings.teamRuns, wickets: d.firstInnings.wickets, balls: d.firstInnings.balls,
      strikerNow: null, nonStrikerNow: null,
    });
  }

  const team2Name = d.battingTeam === 'A' ? d.teamA : d.teamB;
  body += inningsScorecardHtml({
    teamName: team2Name,
    battingTeamPlayers: (d.battingTeam === 'A' ? d.teamAPlayers : d.teamBPlayers) || [],
    battingStats: d.battingStats || {},
    bowlingStats: d.bowlingStats || {},
    log: d.log || [],
    runs: d.score?.runs || 0, wickets: d.score?.wickets || 0, balls: d.score?.balls || 0,
    strikerNow: d.striker, nonStrikerNow: d.nonStriker,
  });

  $('#scorecardBody').innerHTML = body;
  nav('scorecard');
}
if ($('#viewScorecardBtn')) $('#viewScorecardBtn').addEventListener('click', () => showScorecard(currentData));
if ($('#mrScorecardBtn')) $('#mrScorecardBtn').addEventListener('click', () => showScorecard(currentData));

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
    const statusLabel = d.status === 'ended' ? 'Ended'
      : d.status === 'innings-break' ? 'Innings break'
      : d.status === 'live' ? 'Live' : 'Setup';
    li.innerHTML = `
      <div>
        <div class="sessionCard__code">${doc.id}</div>
        <div class="sessionCard__meta">${escapeHtml(d.teamA || '')} ${d.teamB ? 'vs ' + escapeHtml(d.teamB) : ''} · ${scoreLine}${d.seriesMatchNumber ? ' · Match ' + d.seriesMatchNumber : ''}</div>
      </div>
      <span class="badge ${d.status === 'ended' ? 'badge--ended' : ''}">${statusLabel}</span>`;
    li.addEventListener('click', () => openSessionByCode(doc.id));
    (d.status === 'ended' ? past : live).appendChild(li);
  });
  if (!live.children.length) live.innerHTML = '<p class="emptyState">No matches happening right now.</p>';
  if (!past.children.length) past.innerHTML = '<p class="emptyState">No past sessions yet.</p>';
});
