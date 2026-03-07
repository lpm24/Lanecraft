// Party creation, joining, and real-time sync via Firebase RTDB
import { ref, set, get, onValue, remove, onDisconnect, Unsubscribe } from 'firebase/database';
import { getDb, getUserId } from './FirebaseService';
import { Race } from '../simulation/types';

export interface PartyPlayer {
  uid: string;
  name: string;
  race: Race;
}

export interface PartyState {
  code: string;
  hostUid: string;
  host: PartyPlayer;
  guest: PartyPlayer | null;
  status: 'waiting' | 'starting' | 'in_game' | 'ended';
  seed: number;
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

  constructor() {
    this._localName = this.loadName();
  }

  get state(): PartyState | null { return this._state; }
  get code(): string | null { return this.partyCode; }
  get isHost(): boolean {
    try { return this._state?.hostUid === getUserId(); }
    catch { return false; }
  }
  get localName(): string { return this._localName; }

  set localName(name: string) {
    this._localName = name;
    try { localStorage.setItem('spawnwars.playerName', name); } catch {}
    // Push name update if in a party
    if (this._state && this.partyCode) {
      const uid = getUserId();
      const slot = this._state.hostUid === uid ? 'host' : 'guest';
      const db = getDb();
      set(ref(db, `parties/${this.partyCode}/${slot}/name`), name);
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

  async createParty(race: Race): Promise<string> {
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

    const party: PartyState = {
      code,
      hostUid: uid,
      host: { uid, name: this._localName, race },
      guest: null,
      status: 'waiting',
      seed: Math.floor(Math.random() * 2147483647),
    };

    await set(ref(db, `parties/${code}`), party);

    // Clean up party if host disconnects
    onDisconnect(ref(db, `parties/${code}`)).remove();

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
    if (data.guest) throw new Error('Party is full');
    if (data.status !== 'waiting') throw new Error('Party already started');

    const guest: PartyPlayer = { uid, name: this._localName, race };
    await set(ref(db, `parties/${code}/guest`), guest);

    // Clean up guest slot if guest disconnects
    onDisconnect(ref(db, `parties/${code}/guest`)).remove();

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
    const uid = getUserId();

    try {
      if (this._state?.hostUid === uid) {
        // Host leaves → destroy party
        await remove(ref(db, `parties/${code}`));
      } else {
        // Guest leaves → clear guest slot
        await set(ref(db, `parties/${code}/guest`), null);
      }
    } catch {
      // Party may already be gone
    }

    this.partyCode = null;
    this._state = null;
    this.notify();
  }

  async updateRace(race: Race): Promise<void> {
    if (!this.partyCode || !this._state) return;
    const db = getDb();
    const uid = getUserId();
    const slot = this._state.hostUid === uid ? 'host' : 'guest';
    await set(ref(db, `parties/${this.partyCode}/${slot}/race`), race);
  }

  async startGame(): Promise<void> {
    if (!this.partyCode || !this._state) return;
    if (!this.isHost) return;
    if (!this._state.guest) return;
    await set(ref(getDb(), `parties/${this.partyCode}/status`), 'starting');
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
      this._state = snap.val() as PartyState;
      this.notify();
    });
  }
}
