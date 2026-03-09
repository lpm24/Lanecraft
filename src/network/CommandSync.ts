// Turn-based lockstep command synchronization via Firebase RTDB.
//
// Architecture:
// - Simulation is grouped into "turns" of TICKS_PER_TURN ticks (200ms).
// - At each turn boundary, both clients exchange command batches via Firebase RTDB.
// - During a turn, all ticks execute synchronously with pre-exchanged commands.
// - State hash is exchanged every HASH_CHECK_INTERVAL turns for desync detection.
//
// Data layout in Firebase:
//   games/{partyCode}/ready/{0|1}   — true when that player is ready
//   games/{partyCode}/turns/{turn}/{0|1} — { cmds: [...], hash?: number }
//
// Why Firebase instead of WebRTC:
// - No ICE/STUN/TURN configuration needed — works on any network, any browser, iOS
// - Firebase RTDB latency (~50-150ms) is well within the 200ms turn window
// - Already authenticated via the party system

import { ref, set, onValue, remove, onDisconnect, Unsubscribe } from 'firebase/database';
import { getDb } from './FirebaseService';
import { GameCommand } from '../simulation/types';

export const TICKS_PER_TURN = 4; // 200ms at 20tps
const HASH_CHECK_INTERVAL = 25; // check hash every 25 turns = every 5 seconds
const CONNECTION_TIMEOUT_MS = 15000; // 15 seconds to establish connection
const TURN_CLEANUP_DELAY = 10; // keep last N turns before cleaning up

interface TurnData {
  cmds: GameCommand[] | null; // null when no commands (Firebase strips empty arrays)
  hash?: number;
  t: number; // turn number — guarantees non-empty write so Firebase always stores the node
}

export type DesyncCallback = (turn: number, localHash: number, remoteHash: number) => void;
export type DisconnectCallback = () => void;

export class CommandSync {
  private partyCode: string;
  private localPlayerId: number; // 0 = host, 1 = guest
  private remotePlayerId: number;
  private turnBuffer: Map<number, { local?: TurnData; remote?: TurnData }> = new Map();
  private resolvers: Map<number, () => void> = new Map();
  private connected = false;
  private _latencyMs = 0;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private connectionTimeout: ReturnType<typeof setTimeout> | null = null;

  // Firebase listeners to unsubscribe on stop
  private unsubs: Unsubscribe[] = [];

  // Connection readiness
  private _connectedPromise: Promise<void>;
  private _connectedResolve!: () => void;
  private _connectedReject!: (err: Error) => void;
  private _settled = false;
  private remoteReady = false;
  private localReady = false;

  // Track which turns we've already subscribed to
  private subscribedTurns = new Set<number>();
  // Track the latest turn we've written, for cleanup
  private highestWrittenTurn = -1;

  onDesync: DesyncCallback | null = null;
  onDisconnect: DisconnectCallback | null = null;

  /** Current estimated round-trip latency in ms. */
  get latencyMs(): number { return this._latencyMs; }

  /** True once both sides have exchanged ready signals. */
  get isConnected(): boolean { return this.connected; }

  constructor(partyCode: string, localPlayerId: number) {
    this.partyCode = partyCode;
    this.localPlayerId = localPlayerId;
    this.remotePlayerId = localPlayerId === 0 ? 1 : 0;
    this._connectedPromise = new Promise((resolve, reject) => {
      this._connectedResolve = resolve;
      this._connectedReject = reject;
    });
  }

  /** Returns a promise that resolves when both peers are connected and ready. */
  whenReady(): Promise<void> {
    return this._connectedPromise;
  }

  /** Initialize Firebase listeners and exchange ready signals. */
  start(): void {
    console.log(`[CommandSync] Starting as ${this.localPlayerId === 0 ? 'HOST' : 'GUEST'}, party=${this.partyCode}`);

    const db = getDb();
    const gameRef = `games/${this.partyCode}`;

    // Connection timeout
    this.connectionTimeout = setTimeout(() => {
      if (!this.connected && !this._settled) {
        this._settled = true;
        console.error('[CommandSync] Connection timeout');
        this._connectedReject(new Error('Connection timeout'));
        this.onDisconnect?.();
      }
    }, CONNECTION_TIMEOUT_MS);

    // Clean up game data if we disconnect
    onDisconnect(ref(db, `${gameRef}/ready/${this.localPlayerId}`)).remove();

    // Write our ready signal
    set(ref(db, `${gameRef}/ready/${this.localPlayerId}`), true);
    this.localReady = true;

    // Listen for remote player's ready signal
    const readyUnsub = onValue(ref(db, `${gameRef}/ready/${this.remotePlayerId}`), (snap) => {
      if (snap.val() === true && !this.remoteReady) {
        this.remoteReady = true;
        this.checkBothReady();
      }
      if (snap.val() === null && this.connected) {
        // Remote player disconnected (their onDisconnect fired)
        this.connected = false;
        console.warn('[CommandSync] Remote player disconnected');
        this.onDisconnect?.();
      }
    });
    this.unsubs.push(readyUnsub);

    // Start latency measurement via Firebase server time
    this.pingInterval = setInterval(() => this.measureLatency(), 3000);
  }

  private checkBothReady(): void {
    if (this.localReady && this.remoteReady && !this._settled) {
      this._settled = true;
      this.connected = true;
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = null;
      }
      console.log('[CommandSync] Both peers ready — game can start');
      this._connectedResolve();
    }
  }

  private async measureLatency(): Promise<void> {
    // Approximate latency by measuring a Firebase write round-trip
    const db = getDb();
    const pingRef = `games/${this.partyCode}/ping/${this.localPlayerId}`;
    const start = Date.now();
    try {
      await set(ref(db, pingRef), start);
      this._latencyMs = Date.now() - start;
    } catch {
      // Ignore ping failures
    }
  }

  /** Subscribe to the remote player's data for a specific turn.
   *  Safe to call multiple times — deduplicates automatically. */
  subscribeToTurn(turn: number): void {
    if (this.subscribedTurns.has(turn)) return;
    this.subscribedTurns.add(turn);

    const db = getDb();
    const turnRef = `games/${this.partyCode}/turns/${turn}/${this.remotePlayerId}`;

    const unsub = onValue(ref(db, turnRef), (snap) => {
      const data = snap.val() as TurnData | null;
      if (!data) return;

      // Buffer the remote turn data
      const entry = this.turnBuffer.get(turn) ?? {};
      entry.remote = data;
      this.turnBuffer.set(turn, entry);

      // If local is also ready, resolve anyone waiting
      if (entry.local) {
        const resolver = this.resolvers.get(turn);
        if (resolver) {
          this.resolvers.delete(turn);
          resolver();
        }
      }

      // Unsubscribe from this turn — we got what we need
      unsub();
      this.unsubs = this.unsubs.filter(u => u !== unsub);
      this.subscribedTurns.delete(turn);
    });
    this.unsubs.push(unsub);
  }

  /** Send local commands for a turn to the remote peer via Firebase. */
  async pushTurn(turn: number, commands: GameCommand[], hash?: number): Promise<void> {
    // Firebase RTDB strips empty arrays, so store null instead to keep the node non-empty
    const data: TurnData = { cmds: commands.length > 0 ? commands : null, t: turn };
    if (hash !== undefined) data.hash = hash;

    // Buffer locally
    const entry = this.turnBuffer.get(turn) ?? {};
    entry.local = data;
    this.turnBuffer.set(turn, entry);

    // Subscribe to remote BEFORE writing — so we're listening while our write is in flight
    this.subscribeToTurn(turn);

    // If remote already arrived, resolve anyone waiting
    if (entry.remote) {
      const resolver = this.resolvers.get(turn);
      if (resolver) {
        this.resolvers.delete(turn);
        resolver();
      }
    }

    // Write to Firebase (fire-and-forget — don't await)
    const db = getDb();
    set(ref(db, `games/${this.partyCode}/turns/${turn}/${this.localPlayerId}`), data).catch((err) => {
      console.error(`[CommandSync] Failed to push turn ${turn}:`, err);
    });
    this.highestWrittenTurn = Math.max(this.highestWrittenTurn, turn);

    // Clean up old turns from Firebase
    if (turn > TURN_CLEANUP_DELAY) {
      const oldTurn = turn - TURN_CLEANUP_DELAY;
      remove(ref(db, `games/${this.partyCode}/turns/${oldTurn}`)).catch(() => {});
      this.turnBuffer.delete(oldTurn);
    }
  }

  /** Should we include a state hash for this turn? */
  shouldSendHash(turn: number): boolean {
    return turn % HASH_CHECK_INTERVAL === 0;
  }

  /** Wait until both players have submitted data for the given turn. */
  waitForTurn(turn: number, timeoutMs = 5000): Promise<{ commands: GameCommand[]; remoteHash?: number }> {
    // Make sure we're subscribed to this turn's remote data
    this.subscribeToTurn(turn);

    return new Promise((resolve) => {
      const entry = this.turnBuffer.get(turn);
      if (entry?.local && entry?.remote) {
        resolve(this.collectTurn(turn));
        return;
      }

      const timer = setTimeout(() => {
        this.resolvers.delete(turn);
        const entry2 = this.turnBuffer.get(turn);
        if (entry2?.remote) {
          resolve(this.collectTurn(turn));
        } else {
          // Remote never arrived — treat as disconnect
          console.warn(`[CommandSync] Turn ${turn} timeout — remote data missing, treating as disconnect`);
          this.connected = false;
          this.onDisconnect?.();
          resolve(this.collectTurn(turn));
        }
      }, timeoutMs);

      this.resolvers.set(turn, () => {
        clearTimeout(timer);
        resolve(this.collectTurn(turn));
      });
    });
  }

  private collectTurn(turn: number): { commands: GameCommand[]; remoteHash?: number } {
    const entry = this.turnBuffer.get(turn);
    if (!entry) return { commands: [] };

    // CRITICAL: Both clients must apply commands in the same order.
    // Always: P0 (host) commands first, then P1 (guest) commands.
    const hostData = this.localPlayerId === 0 ? entry.local : entry.remote;
    const guestData = this.localPlayerId === 0 ? entry.remote : entry.local;
    const allCmds: GameCommand[] = [];
    if (hostData?.cmds) allCmds.push(...hostData.cmds);
    if (guestData?.cmds) allCmds.push(...guestData.cmds);

    const remoteHash = entry.remote?.hash;
    return { commands: allCmds, remoteHash };
  }

  stop(): void {
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    // Unsubscribe all Firebase listeners
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
    this.subscribedTurns.clear();

    // Clean up game data from Firebase
    try {
      const db = getDb();
      remove(ref(db, `games/${this.partyCode}`)).catch(() => {});
    } catch {
      // DB may not be available
    }

    this.connected = false;
    this.turnBuffer.clear();
    this.resolvers.clear();
  }
}
