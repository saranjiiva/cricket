/**
 * sessions.js — Only session management.
 * A session is a named group of matches sharing one 5-digit code.
 * Anyone who types the code in on this same device can view it; only
 * the device that created it is marked as the "owner" and gets edit
 * controls (tracked in a local ownership list — see the note in
 * app.js about the single-device nature of this storage model).
 */
const Sessions = (() => {
  function all() {
    return DB.jget("sessions", []);
  }

  function save(list) {
    DB.jset("sessions", list);
  }

  function ownedIds() {
    return DB.jget("ownedSessionIds", []);
  }

  function markOwned(id) {
    const ids = ownedIds();
    if (!ids.includes(id)) {
      ids.push(id);
      DB.jset("ownedSessionIds", ids);
    }
  }

  function isOwned(id) {
    return ownedIds().includes(id);
  }

  function generateCode() {
    const existing = new Set(all().map((s) => s.id));
    let code;
    do {
      code = String(Math.floor(10000 + Math.random() * 90000));
    } while (existing.has(code));
    return code;
  }

  function create(name, oversDefault = 20) {
    const session = {
      id: generateCode(),
      name: name && name.trim() ? name.trim() : `Session ${new Date().toLocaleDateString()}`,
      createdAt: Date.now(),
      status: "open", // 'open' | 'closed'
      matchIds: [],
      oversDefault,
      lastTeams: null, // {A:{name,playerIds}, B:{name,playerIds}} for carry-forward
    };
    const list = all();
    list.unshift(session);
    save(list);
    markOwned(session.id);
    return session;
  }

  function find(id) {
    return all().find((s) => s.id === id) || null;
  }

  function update(session) {
    const list = all().map((s) => (s.id === session.id ? session : s));
    save(list);
  }

  function addMatch(sessionId, matchId, teams) {
    const session = find(sessionId);
    if (!session) return;
    session.matchIds.push(matchId);
    session.lastTeams = teams;
    if (session.status === "closed") session.status = "open";
    update(session);
  }

  function close(sessionId) {
    const session = find(sessionId);
    if (!session) return;
    session.status = "closed";
    update(session);
  }

  return { all, create, find, update, addMatch, close, isOwned, markOwned };
})();
