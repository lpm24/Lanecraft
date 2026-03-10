// Party creation, joining, and real-time sync via Firebase RTDB
// Supports N-player parties (up to mapDef.maxPlayers human slots)
import { ref, set, get, onValue, remove, onDisconnect, Unsubscribe, query, orderByChild, equalTo } from 'firebase/database';
import { getDb, getUserId } from './FirebaseService';
import { Race } from '../simulation/types';

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

    // Determine max slots from map (import-free: just pass the number)
    const maxSlots = mapId === 'skirmish' ? 6 : 4;

    const party: PartyState = {
      code,
      hostUid: uid,
      players: { '0': { uid, name: this._localName, race } },
      maxSlots,
      mapId,
      status: 'waiting',
      seed: Math.floor(Math.random() * 2147483647),
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

    // Find first empty slot (slot 0 is host, start from 1)
    let freeSlot = -1;
    for (let i = 1; i < data.maxSlots; i++) {
      if (!data.players[String(i)]) { freeSlot = i; break; }
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

  async updateMap(mapId: string): Promise<void> {
    if (!this.partyCode || !this._state || !this._isHost) return;
    const db = getDb();
    const maxSlots = mapId === 'skirmish' ? 6 : 4;
    await set(ref(db, `parties/${this.partyCode}/mapId`), mapId);
    await set(ref(db, `parties/${this.partyCode}/maxSlots`), maxSlots);
    // If shrinking, remove excess players and bots
    if (maxSlots < this._state.maxSlots) {
      for (let i = maxSlots; i < this._state.maxSlots; i++) {
        if (this._state.players[String(i)]) {
          await remove(ref(db, `parties/${this.partyCode}/players/${i}`));
        }
        if (this._state.bots?.[String(i)]) {
          await remove(ref(db, `parties/${this.partyCode}/bots/${i}`));
        }
      }
    }
  }

  /** Set or clear a bot in a specific slot (host only). Pass null to clear. */
  async setSlotBot(slot: number, difficulty: string | null): Promise<void> {
    if (!this.partyCode || !this._state || !this._isHost) return;
    // Don't overwrite a human player
    if (this._state.players[String(slot)]) return;
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

    // Use update() for atomic multi-path write
    const { update } = await import('firebase/database');
    await update(ref(db), updates);
  }

  async startGame(): Promise<void> {
    if (!this.partyCode || !this._state) return;
    if (!this.isHost) return;
    // Need at least 2 humans to start
    if (getPartyPlayerCount(this._state) < 2) return;
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

    // Collect all candidate parties (has empty slots, not ours)
    const candidates: string[] = [];
    snap.forEach((child) => {
      const data = child.val() as PartyState;
      if (data.hostUid !== uid && child.key) {
        // Check if there's an empty slot
        const playerCount = getPartyPlayerCount(data);
        if (playerCount < data.maxSlots) {
          candidates.push(child.key);
        }
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
      this._state = state;
      this.notify();
    });
  }
}
