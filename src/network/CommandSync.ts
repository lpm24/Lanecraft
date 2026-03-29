// Turn-based lockstep command synchronization via Firebase RTDB.
//
// Architecture:
// - Simulation is grouped into "turns" of TICKS_PER_TURN ticks (200ms).
// - At each turn boundary, ALL human clients exchange command batches via Firebase RTDB.
// - During a turn, all ticks execute synchronously with pre-exchanged commands.
// - State hash is exchanged every HASH_CHECK_INTERVAL turns for desync detection.
//
// Data layout in Firebase:
//   games/{partyCode}/ready/{slotId}   — true when that player is ready
//   games/{partyCode}/turns/{turn}/{slotId} — { cmds: [...], hash?: number }
//
// Supports 2-6 human players. Each player writes to their own slot,
// listens to all other human players' slots.

import { ref, set, onValue, remove, onDisconnect, Unsubscribe } from 'firebase/database';
import { getDb, goOffline, goOnline, reauth } from './FirebaseService';
import { GameCommand } from '../simulation/types';

export const TICKS_PER_TURN = 4; // 200ms at 20tps
const HASH_CHECK_INTERVAL = 25; // check hash every 25 turns = every 5 seconds
const CONNECTION_TIMEOUT_MS = 15000; // 15 seconds to establish connection
const TURN_CLEANUP_DELAY = 50; // keep last N turns before cleaning up (~10s buffer)

interface TurnData {
  cmds: GameCommand[] | null; // null when no commands (Firebase strips empty arrays)
  hash?: number;
  t: number; // turn number — guarantees non-empty write so Firebase always stores the node
}

export type DesyncCallback = (turn: number, localHash: number, remoteHash: number) => void;
export type DisconnectCallback = () => void;

export class CommandSync {
  private partyCode: string;
  private localSlotId: number; // this client's player slot
  private remoteSlotIds: number[]; // all OTHER human player slots
  private allHumanSlots: number[]; // all human slots including local, sorted

  // Per-turn buffer: for each turn, track data from each human slot
  private turnBuffer: Map<number, Map<number, TurnData>> = new Map();
  private resolvers: Map<number, () => void> = new Map();
  private connected = false;
  private _latencyMs = 0;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private connectionTimeout: ReturnType<typeof setTimeout> | null = null;

  // Firebase listeners to unsubscribe on stop
  private unsubs = new Set<Unsubscribe>();

  // Connection readiness
  private _connectedPromise: Promise<void>;
  private _connectedResolve!: () => void;
  private _connectedReject!: (err: Error) => void;
  private _settled = false;
  private readyPlayers = new Set<number>();

  // Track which turns we've already subscribed to
  private subscribedTurns = new Set<number>();
  // Track the latest turn we've written, for cleanup
  private highestWrittenTurn = -1;
  // Circuit breaker: consecutive write failures → trigger disconnect
  private consecutiveWriteFailures = 0;
  private writesDisabled = false;
  private reauthAttempted = false;
  private reauthInProgress = false;
  private static readonly MAX_WRITE_FAILURES = 5;

  onDesync: DesyncCallback | null = null;
  onDisconnect: DisconnectCallback | null = null;

  /** Human-readable connection status for debugging. */
  status = 'created';

  /** Current estimated round-trip latency in ms. */
  get latencyMs(): number { return this._latencyMs; }

  /** True once all human players have exchanged ready signals. */
  get isConnected(): boolean { return this.connected; }

  /**
   * @param partyCode - Firebase party code
   * @param localSlotId - this client's player slot index
   * @param humanSlotIds - ALL human player slot indices (including local)
   */
  constructor(partyCode: string, localSlotId: number, humanSlotIds: number[]) {
    this.partyCode = partyCode;
    this.localSlotId = localSlotId;
    this.allHumanSlots = [...humanSlotIds].sort((a, b) => a - b);
    this.remoteSlotIds = this.allHumanSlots.filter(id => id !== localSlotId);
    this._connectedPromise = new Promise((resolve, reject) => {
      this._connectedResolve = resolve;
      this._connectedReject = reject;
    });
  }

  /** Returns a promise that resolves when all human peers are connected and ready. */
  whenReady(): Promise<void> {
    return this._connectedPromise;
  }

  /** Initialize Firebase listeners and exchange ready signals. */
  start(): void {
    this.status = `starting slot=${this.localSlotId} humans=[${this.allHumanSlots.join(',')}] remotes=[${this.remoteSlotIds.join(',')}]`;

    const db = getDb();
    const gameRef = `games/${this.partyCode}`;

    // Connection timeout
    this.connectionTimeout = setTimeout(() => {
      if (!this.connected && !this._settled) {
        this._settled = true;
        this.status = `timeout waiting=${this.allHumanSlots.filter(id => !this.readyPlayers.has(id)).join(',')}`;
        console.error(`[CommandSync] ${this.status}`);
        this._connectedReject(new Error('Connection timeout'));
        this.onDisconnect?.();
      }
    }, CONNECTION_TIMEOUT_MS);

    // Clean up our ready signal if we disconnect
    onDisconnect(ref(db, `${gameRef}/ready/${this.localSlotId}`)).remove();

    // Write our ready signal
    this.status = `writing ready for slot ${this.localSlotId}`;
    set(ref(db, `${gameRef}/ready/${this.localSlotId}`), true).then(() => {
      this.status = `ready written, waiting=${this.allHumanSlots.filter(id => !this.readyPlayers.has(id)).join(',')}`;
      // If no remote players (solo + bots), resolve immediately
      this.checkAllReady();
    }).catch((err) => {
      this.status = `ready write FAILED: ${err.message}`;
      console.error(`[CommandSync] ${this.status}`);
    });
    this.readyPlayers.add(this.localSlotId);

    // Listen for each remote player's ready signal
    for (const remoteId of this.remoteSlotIds) {
      const readyUnsub = onValue(ref(db, `${gameRef}/ready/${remoteId}`), (snap) => {
        if (snap.val() === true && !this.readyPlayers.has(remoteId)) {
          this.readyPlayers.add(remoteId);
          const waiting = this.allHumanSlots.filter(id => !this.readyPlayers.has(id));
          this.status = waiting.length > 0 ? `got slot ${remoteId}, waiting=${waiting.join(',')}` : 'all ready';
          this.checkAllReady();
        }
        if (snap.val() === null && this.connected) {
          // Remote player disconnected — remove them individually, don't kill everything
          this.status = `slot ${remoteId} disconnected`;
          console.warn(`[CommandSync] ${this.status}`);
          if (!this.leftSlotQueue.includes(remoteId)) {
            this.leftSlotQueue.push(remoteId);
          }
          this.removeHumanSlot(remoteId);
          // Only fully disconnect if ALL remote players are gone
          if (this.remoteSlotIds.length === 0) {
            this.connected = false;
            this.onDisconnect?.();
          }
        }
      });
      this.unsubs.add(readyUnsub);
    }

    // Start latency measurement via Firebase server time
    this.pingInterval = setInterval(() => this.measureLatency(), 10000);
  }

  private checkAllReady(): void {
    // All human players must be ready
    const allReady = this.allHumanSlots.every(id => this.readyPlayers.has(id));
    if (allReady && !this._settled) {
      this._settled = true;
      this.connected = true;
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = null;
      }
      this.status = 'connected';
      this._connectedResolve();
    }
  }

  private async measureLatency(): Promise<void> {
    const db = getDb();
    const pingRef = `games/${this.partyCode}/ping/${this.localSlotId}`;
    const start = Date.now();
    try {
      await set(ref(db, pingRef), start);
      this._latencyMs = Date.now() - start;
    } catch {
      // Ignore ping failures
    }
  }

  /** Subscribe to all remote players' data for a specific turn.
   *  Uses a single listener on the turn node to receive all players' data at once.
   *  Safe to call multiple times — deduplicates automatically. */
  subscribeToTurn(turn: number): void {
    if (this.subscribedTurns.has(turn)) return;
    this.subscribedTurns.add(turn);

    const db = getDb();
    const turnRef = `games/${this.partyCode}/turns/${turn}`;

    // Single listener for the entire turn node — receives all players' data
    const unsub = onValue(ref(db, turnRef), (snap) => {
      const val = snap.val() as Record<string, TurnData> | null;
      if (!val) return;

      // Buffer ALL remote turn data from this snapshot — not just current remoteSlotIds.
      // A player who submitted commands then disconnected must still have their commands
      // included, even if removeHumanSlot() already removed them from remoteSlotIds.
      let turnMap = this.turnBuffer.get(turn);
      if (!turnMap) {
        turnMap = new Map();
        this.turnBuffer.set(turn, turnMap);
      }

      for (const [key, data] of Object.entries(val)) {
        const slotId = Number(key);
        if (slotId !== this.localSlotId && data) {
          turnMap.set(slotId, data as TurnData);
        }
      }

      // Check if all players (including local) have submitted
      if (this.isTurnComplete(turn)) {
        const resolver = this.resolvers.get(turn);
        if (resolver) {
          this.resolvers.delete(turn);
          resolver();
        }
        // All data received — unsubscribe from this turn
        unsub();
        this.unsubs.delete(unsub);
      }
    });
    this.unsubs.add(unsub);
  }

  /** Check if all human players have submitted data for this turn. */
  private isTurnComplete(turn: number): boolean {
    const turnMap = this.turnBuffer.get(turn);
    if (!turnMap) return false;
    return this.allHumanSlots.every(id => turnMap.has(id));
  }

  /** Send local commands for a turn to remote peers via Firebase. */
  async pushTurn(turn: number, commands: GameCommand[], hash?: number): Promise<void> {
    const data: TurnData = { cmds: commands.length > 0 ? commands : null, t: turn };
    if (hash !== undefined) data.hash = hash;

    // Buffer locally
    let turnMap = this.turnBuffer.get(turn);
    if (!turnMap) {
      turnMap = new Map();
      this.turnBuffer.set(turn, turnMap);
    }
    turnMap.set(this.localSlotId, data);

    // Subscribe to remote BEFORE writing — so we're listening while our write is in flight
    this.subscribeToTurn(turn);

    // If turn is already complete, resolve anyone waiting
    if (this.isTurnComplete(turn)) {
      const resolver = this.resolvers.get(turn);
      if (resolver) {
        this.resolvers.delete(turn);
        resolver();
      }
    }

    // Only write to Firebase if there are remote players to sync with
    if (this.remoteSlotIds.length > 0 && !this.writesDisabled) {
      // Pause writes while re-auth is in progress to avoid flooding failed requests
      if (this.reauthInProgress) return;

      const db = getDb();
      set(ref(db, `games/${this.partyCode}/turns/${turn}/${this.localSlotId}`), data).then(() => {
        this.consecutiveWriteFailures = 0; // reset on success
        this.reauthAttempted = false;
      }).catch((err) => {
        this.consecutiveWriteFailures++;
        console.error(`[CommandSync] Failed to push turn ${turn} (${this.consecutiveWriteFailures}/${CommandSync.MAX_WRITE_FAILURES}):`, err);
        // Try re-auth once before giving up (handles expired token / CORS refresh failure)
        if (this.consecutiveWriteFailures >= 3 && !this.reauthAttempted) {
          this.reauthAttempted = true;
          this.reauthInProgress = true;
          console.warn('[CommandSync] Attempting re-auth after write failures — pausing writes');
          reauth().then(user => {
            this.reauthInProgress = false;
            if (user) {
              this.consecutiveWriteFailures = 0;
            } else {
              // Re-auth failed — treat as disconnect immediately
              console.error('[CommandSync] Re-auth failed — treating as disconnect');
              this.writesDisabled = true;
              this.connected = false;
              this.onDisconnect?.();
            }
          });
        }
        if (this.consecutiveWriteFailures >= CommandSync.MAX_WRITE_FAILURES) {
          console.error('[CommandSync] Too many write failures — treating as disconnect');
          this.writesDisabled = true; // immediately stop future writes
          this.connected = false;
          this.onDisconnect?.();
        }
      });
      this.highestWrittenTurn = Math.max(this.highestWrittenTurn, turn);

      // Clean up old turns from Firebase
      if (turn > TURN_CLEANUP_DELAY) {
        const oldTurn = turn - TURN_CLEANUP_DELAY;
        remove(ref(db, `games/${this.partyCode}/turns/${oldTurn}`)).catch(() => {});
        this.turnBuffer.delete(oldTurn);
      }
    }
  }

  /** Should we include a state hash for this turn? */
  shouldSendHash(turn: number): boolean {
    return turn % HASH_CHECK_INTERVAL === 0;
  }

  /** Wait until all human players have submitted data for the given turn. */
  waitForTurn(turn: number, timeoutMs = 5000): Promise<{ commands: GameCommand[]; remoteHash?: number }> {
    this.subscribeToTurn(turn);

    return new Promise((resolve) => {
      if (this.isTurnComplete(turn)) {
        resolve(this.collectTurn(turn));
        return;
      }

      const timer = setTimeout(() => {
        this.resolvers.delete(turn);
        if (this.isTurnComplete(turn)) {
          resolve(this.collectTurn(turn));
        } else {
          // Identify which players timed out and remove them individually
          const turnMap = this.turnBuffer.get(turn);
          const missing = this.allHumanSlots.filter(id => id !== this.localSlotId && !turnMap?.has(id));
          for (const slotId of missing) {
            console.warn(`[CommandSync] Turn ${turn} timeout — slot ${slotId} missing, converting to bot`);
            if (!this.leftSlotQueue.includes(slotId)) {
              this.leftSlotQueue.push(slotId);
            }
            this.removeHumanSlot(slotId);
          }
          // Only fully disconnect if ALL remote players are gone
          if (this.remoteSlotIds.length === 0) {
            this.connected = false;
            this.onDisconnect?.();
          }
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
    const turnMap = this.turnBuffer.get(turn);
    if (!turnMap) return { commands: [] };

    // CRITICAL: All clients must apply commands in the same order.
    // Collect from ALL slots that submitted data for this turn, sorted by slot ID.
    // This ensures commands aren't dropped if removeHumanSlot() fires asynchronously
    // on one client before collectTurn runs (Firebase listener race condition).
    const allCmds: GameCommand[] = [];
    const remoteHashes: { slotId: number; hash: number }[] = [];

    const sortedSlots = [...turnMap.keys()].sort((a, b) => a - b);
    for (const slotId of sortedSlots) {
      const data = turnMap.get(slotId);
      if (data?.cmds) allCmds.push(...data.cmds);
      if (slotId !== this.localSlotId && data?.hash !== undefined) {
        remoteHashes.push({ slotId, hash: data.hash });
      }
    }

    // Compare all remote hashes against each other (not just last one)
    let remoteHash: number | undefined;
    if (remoteHashes.length > 0) {
      remoteHash = remoteHashes[0].hash;
      for (let i = 1; i < remoteHashes.length; i++) {
        if (remoteHashes[i].hash !== remoteHash) {
          console.error(
            `[CommandSync] Cross-peer desync at turn ${turn}: ` +
            `slot ${remoteHashes[0].slotId} hash=${remoteHash}, ` +
            `slot ${remoteHashes[i].slotId} hash=${remoteHashes[i].hash}`
          );
        }
      }
    }

    return { commands: allCmds, remoteHash };
  }

  /** Write a leave signal so remaining players can replace this slot with a bot. */
  broadcastLeave(): void {
    try {
      const db = getDb();
      set(ref(db, `games/${this.partyCode}/left/${this.localSlotId}`), true).catch(() => {});
    } catch {
      // DB may not be available
    }
  }

  /** Called when a remote player's leave signal is detected. */
  onPlayerLeft: ((slotId: number) => void) | null = null;

  /** Remove a slot from the required human slots (player left → becomes bot).
   *  This must be called so CommandSync stops waiting for that slot's turn data. */
  removeHumanSlot(slotId: number): void {
    const idx = this.allHumanSlots.indexOf(slotId);
    if (idx !== -1) this.allHumanSlots.splice(idx, 1);
    this.remoteSlotIds = this.allHumanSlots.filter(id => id !== this.localSlotId);
    // Defer turn resolution to next microtask — gives any pending Firebase turn-data
    // callbacks a chance to buffer the departing player's final commands before
    // collectTurn runs. Without this, a race between the disconnect listener and the
    // turn-data listener can cause collectTurn to miss already-submitted commands.
    queueMicrotask(() => {
      for (const [turn, resolver] of this.resolvers) {
        if (this.isTurnComplete(turn)) {
          this.resolvers.delete(turn);
          resolver();
        }
      }
    });
  }

  /** Slots that have been flagged as left but not yet processed by the game. */
  leftSlotQueue: number[] = [];

  /** Start listening for leave signals from remote players. */
  listenForLeaves(): void {
    const db = getDb();
    for (const remoteId of this.remoteSlotIds) {
      const unsub = onValue(ref(db, `games/${this.partyCode}/left/${remoteId}`), (snap) => {
        if (snap.val() === true) {
          // Queue the leave — Game will drain this at a deterministic turn boundary
          if (!this.leftSlotQueue.includes(remoteId)) {
            this.leftSlotQueue.push(remoteId);
          }
          // Remove from required slots so we don't stall waiting for their data
          this.removeHumanSlot(remoteId);
        }
      });
      this.unsubs.add(unsub);
    }
  }

  /** Pause network activity (app backgrounded). Disconnects Firebase to save battery. */
  pause(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    goOffline();
  }

  /** Resume network activity (app foregrounded). Reconnects Firebase. */
  resume(): void {
    goOnline();
    // Restart latency ping
    if (!this.pingInterval && this.connected) {
      this.pingInterval = setInterval(() => this.measureLatency(), 10000);
    }
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
    this.unsubs.clear();
    this.subscribedTurns.clear();

    // Clean up only our own ready signal — don't delete the whole game node
    // because the other player may still be writing turns
    try {
      const db = getDb();
      remove(ref(db, `games/${this.partyCode}/ready/${this.localSlotId}`)).catch(() => {});
    } catch {
      // DB may not be available
    }

    this.connected = false;
    this.turnBuffer.clear();
    this.resolvers.clear();
  }

  /** Delete the entire game node from Firebase. Call only when the match is truly over. */
  cleanup(): void {
    try {
      const db = getDb();
      remove(ref(db, `games/${this.partyCode}`)).catch(() => {});
    } catch {
      // DB may not be available
    }
  }
}
