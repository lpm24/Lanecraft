// Party creation, joining, and real-time sync via Firebase RTDB
// Supports N-player parties (up to mapDef.maxPlayers human slots)
import { ref, set, get, onValue, remove, onDisconnect, Unsubscribe, query, orderByChild, equalTo } from 'firebase/database';
import { getDb, getUserId } from './FirebaseService';
import { Race } from '../simulation/types';
import { getMapById } from '../simulation/maps';

export interface PartyPlayer {
  uid: string;
  name: string;
  race: Race;
}

/**
 * Party state synced via Firebase RTDB.
 * `players` is an object keyed by slot index ("0", "1", ...).
 * Slot 0 is always the host. Guests fill the next available slot.
 * Empty slots (null/missing) become bots when the game starts.
 */
export interface PartyState {
  code: string;
  hostUid: string;
  players: { [slot: string]: PartyPlayer }; // keyed by slot index
  bots?: { [slot: string]: string };  // per-slot bot difficulty (BotDifficultyLevel), absent = empty
  maxSlots: number;  // max human players (from mapDef.maxPlayers)
  mapId: string;     // map selection (host controls)
  status: 'waiting' | 'starting' | 'in_game' | 'ended';
  seed: number;
  difficulty?: string; // global fallback BotDifficultyLevel, set by host
  teamSize?: number;   // players per team (1 = 1v1, 2 = 2v2, etc). Default = map's playersPerTeam.
  createdAt?: number;  // Date.now() when party was created — used to skip stale parties
  fogOfWar?: boolean;  // whether fog of war is enabled (default true)
}

/** Helper to get the ordered list of occupied player slots. */
export function getPartyPlayers(ps: PartyState): { slot: number; player: PartyPlayer }[] {
  const result: { slot: number; player: PartyPlayer }[] = [];
  for (let i = 0; i < ps.maxSlots; i++) {
    const p = ps.players[String(i)];
    if (p) result.push({ slot: i, player: p });
  }
  return result;
}

/** How many humans are currently in the party. */
export function getPartyPlayerCount(ps: PartyState): number {
  let count = 0;
  for (let i = 0; i < ps.maxSlots; i++) {
    if (ps.players[String(i)]) count++;
  }
  return count;
}

/** Get slot indices that are active given the party's teamSize.
 *  E.g. 1v1 on duel map → [0, 2] (first slot of each team). */
export function getActiveSlots(ps: PartyState): number[] {
  const mapDef = getMapById(ps.mapId ?? 'duel');
  const teamSize = ps.teamSize ?? mapDef.playersPerTeam;
  const slots: number[] = [];
  for (let t = 0; t < mapDef.teams.length; t++) {
    for (let s = 0; s < teamSize; s++) {
      slots.push(t * mapDef.playersPerTeam + s);
    }
  }
  return slots;
}

export type PartyListener = (state: PartyState | null) => void;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I,O,0,1 to avoid confusion

function generateCode(): string {
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

function defaultName(): string {
  const adj = ['Brave', 'Swift', 'Bold', 'Wild', 'Dark', 'Iron', 'Gold', 'Red', 'Blue', 'Grim'];
  const noun = ['Knight', 'Rider', 'Chief', 'Wolf', 'Raven', 'Bear', 'Hawk', 'Forge', 'Storm', 'Blade'];
  return adj[Math.floor(Math.random() * adj.length)] + noun[Math.floor(Math.random() * noun.length)];
}

export class PartyManager {
  private partyCode: string | null = null;
  private unsubscribe: Unsubscribe | null = null;
  private _state: PartyState | null = null;
  private listeners: Set<PartyListener> = new Set();
  private _localName: string;
  /** Explicitly tracks whether this client created or joined the party.
   *  UID-based detection fails when two tabs share the same anonymous auth. */
  private _isHost = false;
  /** Which player slot this client occupies (0 = host, 1+ = guests). */
  private _localSlot = 0;

  constructor() {
    this._localName = this.loadName();
  }

  get state(): PartyState | null { return this._state; }
  get code(): string | null { return this.partyCode; }
  get isHost(): boolean { return this._isHost; }
  get localName(): string { return this._localName; }
  /** Numeric slot index this client occupies. */
  get localSlotIndex(): number { return this._localSlot; }

  set localName(name: string) {
    this._localName = name;
    try { localStorage.setItem('spawnwars.playerName', name); } catch {}
    // Push name update if in a party
    if (this._state && this.partyCode) {
      const db = getDb();
      set(ref(db, `parties/${this.partyCode}/players/${this._localSlot}/name`), name);
    }
  }

  private loadName(): string {
    try {
      const saved = localStorage.getItem('spawnwars.playerName');
      if (saved) return saved;
    } catch {}
    const name = defaultName();
    try { localStorage.setItem('spawnwars.playerName', name); } catch {}
    return name;
  }

  addListener(fn: PartyListener): void { this.listeners.add(fn); }
  removeListener(fn: PartyListener): void { this.listeners.delete(fn); }

  private notify(): void {
    for (const fn of this.listeners) fn(this._state);
  }

  async createParty(race: Race, mapId = 'duel'): Promise<string> {
    await this.leaveParty();

    const db = getDb();
    const uid = getUserId();

    // Generate a unique code (retry if collision)
    let code = generateCode();
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await get(ref(db, `parties/${code}/hostUid`));
      if (!existing.exists()) break;
      code = generateCode();
    }

    // Determine max slots from map definition
    const maxSlots = getMapById(mapId).maxPlayers;

    const party: PartyState = {
      code,
      hostUid: uid,
      players: { '0': { uid, name: this._localName, race } },
      maxSlots,
      mapId,
      status: 'waiting',
      seed: Math.floor(Math.random() * 2147483647),
      createdAt: Date.now(),
      fogOfWar: true,
    };

    await set(ref(db, `parties/${code}`), party);

    // Clean up party if host disconnects
    onDisconnect(ref(db, `parties/${code}`)).remove();

    this._isHost = true;
    this._localSlot = 0;
    this.partyCode = code;
    this.subscribeToParty(code);
    return code;
  }

  async joinParty(code: string, race: Race): Promise<void> {
    await this.leaveParty();

    const db = getDb();
    const uid = getUserId();
    const snap = await get(ref(db, `parties/${code}`));

    if (!snap.exists()) throw new Error('Party not found');

    const data = snap.val() as PartyState;
    if (data.status !== 'waiting') throw new Error('Party already started');

    // Find first empty active slot (skip slot 0 = host)
    // Active slots respect teamSize: 1v1 on duel → [0, 2], so guest joins slot 2
    const activeSlots = getActiveSlots(data);
    let freeSlot = -1;
    for (const slot of activeSlots) {
      if (slot === 0) continue; // host's slot
      if (!data.players[String(slot)]) { freeSlot = slot; break; }
    }
    if (freeSlot < 0) throw new Error('Party is full');

    const player: PartyPlayer = { uid, name: this._localName, race };
    await set(ref(db, `parties/${code}/players/${freeSlot}`), player);

    // Clean up our slot if we disconnect
    onDisconnect(ref(db, `parties/${code}/players/${freeSlot}`)).remove();

    this._isHost = false;
    this._localSlot = freeSlot;
    this.partyCode = code;
    this.subscribeToParty(code);
  }

  async leaveParty(): Promise<void> {
    if (!this.partyCode) return;

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    const db = getDb();
    const code = this.partyCode;

    try {
      if (this._isHost) {
        // Host leaves → destroy party
        await remove(ref(db, `parties/${code}`));
      } else {
        // Guest leaves → clear their slot
        await remove(ref(db, `parties/${code}/players/${this._localSlot}`));
      }
    } catch {
      // Party may already be gone
    }

    this.partyCode = null;
    this._state = null;
    this._isHost = false;
    this._localSlot = 0;
    this.notify();
  }

  async updateRace(race: Race): Promise<void> {
    if (!this.partyCode || !this._state) return;
    const db = getDb();
    await set(ref(db, `parties/${this.partyCode}/players/${this._localSlot}/race`), race);
  }

  async updateDifficulty(difficulty: string): Promise<void> {
    if (!this.partyCode || !this._state || !this._isHost) return;
    const db = getDb();
    await set(ref(db, `parties/${this.partyCode}/difficulty`), difficulty);
  }

  async updateFogOfWar(fogOfWar: boolean): Promise<void> {
    if (!this.partyCode || !this._state || !this._isHost) return;
    const db = getDb();
    await set(ref(db, `parties/${this.partyCode}/fogOfWar`), fogOfWar);
  }

  async updateTeamSize(teamSize: number): Promise<void> {
    if (!this.partyCode || !this._state || !this._isHost) return;
    const db = getDb();
    const mapDef = getMapById(this._state.mapId ?? 'duel');
    // Clamp to valid range
    const clamped = Math.max(1, Math.min(teamSize, mapDef.playersPerTeam));
    await set(ref(db, `parties/${this.partyCode}/teamSize`), clamped);
    // Kick players and bots from now-inactive slots
    const activeSlots = new Set<number>();
    for (let t = 0; t < mapDef.teams.length; t++) {
      for (let s = 0; s < clamped; s++) {
        activeSlots.add(t * mapDef.playersPerTeam + s);
      }
    }
    for (let i = 0; i < this._state.maxSlots; i++) {
      if (activeSlots.has(i)) continue;
      if (this._state.players[String(i)]) {
        await remove(ref(db, `parties/${this.partyCode}/players/${i}`));
      }
      if (this._state.bots?.[String(i)]) {
        await remove(ref(db, `parties/${this.partyCode}/bots/${i}`));
      }
    }
  }

  async updateMap(mapId: string, teamSize?: number): Promise<void> {
    if (!this.partyCode || !this._state || !this._isHost) return;
    const db = getDb();
    const mapDef = getMapById(mapId);
    const maxSlots = mapDef.maxPlayers;
    await set(ref(db, `parties/${this.partyCode}/mapId`), mapId);
    await set(ref(db, `parties/${this.partyCode}/maxSlots`), maxSlots);
    // Set teamSize atomically with map change to avoid flash/race
    if (teamSize != null) {
      const clamped = Math.max(1, Math.min(teamSize, mapDef.playersPerTeam));
      await set(ref(db, `parties/${this.partyCode}/teamSize`), clamped);
    } else {
      await remove(ref(db, `parties/${this.partyCode}/teamSize`));
    }
    // If shrinking, remove excess players and bots
    const activeSlots = new Set<number>();
    const ts = teamSize ?? mapDef.playersPerTeam;
    for (let t = 0; t < mapDef.teams.length; t++) {
      for (let s = 0; s < ts; s++) {
        activeSlots.add(t * mapDef.playersPerTeam + s);
      }
    }
    for (let i = 0; i < this._state.maxSlots; i++) {
      if (activeSlots.has(i)) continue;
      if (this._state.players[String(i)]) {
        await remove(ref(db, `parties/${this.partyCode}/players/${i}`));
      }
      if (this._state.bots?.[String(i)]) {
        await remove(ref(db, `parties/${this.partyCode}/bots/${i}`));
      }
    }
  }

  /** Set or clear a bot in a specific slot (host only). Pass null to clear. */
  async setSlotBot(slot: number, difficulty: string | null): Promise<void> {
    if (!this.partyCode || !this._state || !this._isHost) return;
    // Don't overwrite a human player
    if (this._state.players[String(slot)]) return;
    // Don't allow bots in inactive slots
    const active = new Set(getActiveSlots(this._state));
    if (!active.has(slot)) return;
    const db = getDb();
    if (difficulty) {
      await set(ref(db, `parties/${this.partyCode}/bots/${slot}`), difficulty);
    } else {
      await remove(ref(db, `parties/${this.partyCode}/bots/${slot}`));
    }
  }

  /** Swap two slots (host only). Moves humans and/or bots between positions. */
  async swapSlots(slotA: number, slotB: number): Promise<void> {
    if (!this.partyCode || !this._state || !this._isHost) return;
    if (slotA === slotB) return;
    const db = getDb();
    const ps = this._state;
    const playerA = ps.players[String(slotA)] ?? null;
    const playerB = ps.players[String(slotB)] ?? null;
    const botA = ps.bots?.[String(slotA)] ?? null;
    const botB = ps.bots?.[String(slotB)] ?? null;

    // Build update object for atomic write
    const updates: { [path: string]: unknown } = {};
    const base = `parties/${this.partyCode}`;

    // Swap players
    updates[`${base}/players/${slotA}`] = playerB;
    updates[`${base}/players/${slotB}`] = playerA;
    // Swap bots
    updates[`${base}/bots/${slotA}`] = botB;
    updates[`${base}/bots/${slotB}`] = botA;

    // Update local slot if we were involved in the swap
    if (this._localSlot === slotA) this._localSlot = slotB;
    else if (this._localSlot === slotB) this._localSlot = slotA;

    // Use update() for atomic multi-path write
    const { update } = await import('firebase/database');
    await update(ref(db), updates);
  }

  /** Reset party status to 'waiting' so the lobby can start a new game. Host only. */
  async resetToWaiting(): Promise<void> {
    if (!this.partyCode || !this._state || !this._isHost) return;
    await set(ref(getDb(), `parties/${this.partyCode}/status`), 'waiting');
    // Generate a new seed for the next match
    await set(ref(getDb(), `parties/${this.partyCode}/seed`), Math.floor(Math.random() * 2147483647));
  }

  async startGame(): Promise<void> {
    if (!this.partyCode || !this._state) return;
    if (!this.isHost) return;
    // Need at least 1 occupant (human or bot) on each team
    const mapDef = getMapById(this._state.mapId ?? 'duel');
    const ppt = mapDef.playersPerTeam;
    const ts = this._state.teamSize ?? ppt;
    for (let t = 0; t < mapDef.teams.length; t++) {
      let hasOccupant = false;
      for (let s = 0; s < ts; s++) {
        const slot = t * ppt + s;
        if (this._state.players[String(slot)] || this._state.bots?.[String(slot)]) { hasOccupant = true; break; }
      }
      if (!hasOccupant) return;
    }
    await set(ref(getDb(), `parties/${this.partyCode}/status`), 'starting');
  }

  /** Find an open party (status=waiting, has empty slots) and join it.
   *  Returns true if joined, false if none found. */
  async findAndJoinGame(race: Race): Promise<boolean> {
    await this.leaveParty();

    const db = getDb();
    const uid = getUserId();
    const q = query(ref(db, 'parties'), orderByChild('status'), equalTo('waiting'));
    const snap = await get(q);

    if (!snap.exists()) return false;

    // Collect all candidate parties (has empty slots, not ours, not stale)
    const now = Date.now();
    const STALE_MS = 3 * 60 * 1000; // 3 minutes — skip parties older than this
    const candidates: string[] = [];
    snap.forEach((child) => {
      const data = child.val() as PartyState;
      if (data.hostUid === uid || !child.key) return;
      // Skip stale parties (host likely disconnected without cleanup)
      if (data.createdAt && now - data.createdAt > STALE_MS) return;
      // Check if there's an empty active slot
      const active = getActiveSlots(data);
      const occupiedActive = active.filter(s => !!data.players[String(s)]).length;
      if (occupiedActive < active.length) {
        candidates.push(child.key);
      }
    });

    // Try each candidate — may fail if someone else joined first
    for (const code of candidates) {
      try {
        await this.joinParty(code, race);
        return true;
      } catch {
        // Race condition — someone else grabbed it, try next
      }
    }

    return false;
  }

  private subscribeToParty(code: string): void {
    const db = getDb();
    this.unsubscribe = onValue(ref(db, `parties/${code}`), (snap) => {
      if (!snap.exists()) {
        // Party was destroyed (host left)
        this.partyCode = null;
        this._state = null;
        this.notify();
        return;
      }
      const raw = snap.val();
      // Normalize: Firebase may deliver players as an array or object
      const state = raw as PartyState;
      if (!state.players) state.players = {};
      // Firebase arrays: if players was stored as array, convert to object
      if (Array.isArray(state.players)) {
        const obj: { [slot: string]: PartyPlayer } = {};
        (state.players as (PartyPlayer | null)[]).forEach((p, i) => {
          if (p) obj[String(i)] = p;
        });
        state.players = obj;
      }
      // Track slot changes: if our UID moved to a different slot (host swapped us),
      // update _localSlot so we report the correct slot when the game starts
      const uid = getUserId();
      for (let i = 0; i < state.maxSlots; i++) {
        if (state.players[String(i)]?.uid === uid) {
          this._localSlot = i;
          break;
        }
      }

      this._state = state;
      this.notify();
    });
  }
}
