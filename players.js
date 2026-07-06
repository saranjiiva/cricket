/**
 * players.js — Only player management.
 * Players are a single global roster shared across all sessions on
 * this device (so the same person can be picked into any team without
 * re-entering their name each time). Career stats are computed later
 * by scorecard.js from match data — this file only owns identity.
 */
const Players = (() => {
  function all() {
    return DB.jget("players", []);
  }

  function save(list) {
    DB.jset("players", list);
  }

  function makeId() {
    return "pl" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  async function add({ name, role, photoFile }) {
    const list = all();
    const player = { id: makeId(), name: name.trim(), role: role || "bat", createdAt: Date.now() };
    list.push(player);
    save(list);
    if (photoFile) {
      const dataUrl = await DB.fileToDataUrl(photoFile);
      await DB.savePhoto(player.id, dataUrl);
    }
    return player;
  }

  function find(id) {
    return all().find((p) => p.id === id) || null;
  }

  async function remove(id) {
    save(all().filter((p) => p.id !== id));
    await DB.deletePhoto(id);
  }

  async function photoUrl(id) {
    return DB.getPhoto(id);
  }

  return { all, add, find, remove, photoUrl };
})();
