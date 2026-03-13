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
  private unsubs: Unsubscribe[] = [];

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
    console.log(`[CommandSync] ${this.status}, party=${this.partyCode}`);

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
      console.log(`[CommandSync] ${this.status}`);
    }).catch((err) => {
      this.status = `ready write FAILED: ${err.message}`;
      console.error(`[CommandSync] ${this.status}`);
    });
    this.readyPlayers.add(this.localSlotId);

    // Listen for each remote player's ready signal
    for (const remoteId of this.remoteSlotIds) {
      console.log(`[CommandSync] Listening for ready at ${gameRef}/ready/${remoteId}`);
      const readyUnsub = onValue(ref(db, `${gameRef}/ready/${remoteId}`), (snap) => {
        console.log(`[CommandSync] ready/${remoteId} snap:`, snap.val());
        if (snap.val() === true && !this.readyPlayers.has(remoteId)) {
          this.readyPlayers.add(remoteId);
          const waiting = this.allHumanSlots.filter(id => !this.readyPlayers.has(id));
          this.status = waiting.length > 0 ? `got slot ${remoteId}, waiting=${waiting.join(',')}` : 'all ready';
          console.log(`[CommandSync] ${this.status}`);
          this.checkAllReady();
        }
        if (snap.val() === null && this.connected) {
          // Remote player disconnected
          this.connected = false;
          this.status = `slot ${remoteId} disconnected`;
          console.warn(`[CommandSync] ${this.status}`);
          this.onDisconnect?.();
        }
      });
      this.unsubs.push(readyUnsub);
    }

    // Start latency measurement via Firebase server time
    this.pingInterval = setInterval(() => this.measureLatency(), 3000);
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
      console.log(`[CommandSync] All ${this.allHumanSlots.length} peers ready — game can start`);
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

      // Buffer all remote turn data from this snapshot
      let turnMap = this.turnBuffer.get(turn);
      if (!turnMap) {
        turnMap = new Map();
        this.turnBuffer.set(turn, turnMap);
      }

      for (const remoteId of this.remoteSlotIds) {
        const data = val[String(remoteId)];
        if (data) turnMap.set(remoteId, data);
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
        this.unsubs = this.unsubs.filter(u => u !== unsub);
      }
    });
    this.unsubs.push(unsub);
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

    // Write to Firebase (fire-and-forget — don't await)
    const db = getDb();
    set(ref(db, `games/${this.partyCode}/turns/${turn}/${this.localSlotId}`), data).catch((err) => {
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
          // Some remote(s) never arrived — treat as disconnect
          console.warn(`[CommandSync] Turn ${turn} timeout — missing remote data, treating as disconnect`);
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
    const turnMap = this.turnBuffer.get(turn);
    if (!turnMap) return { commands: [] };

    // CRITICAL: All clients must apply commands in the same order.
    // Always sort by slot ID (ascending) for determinism.
    const allCmds: GameCommand[] = [];
    let remoteHash: number | undefined;

    for (const slotId of this.allHumanSlots) {
      const data = turnMap.get(slotId);
      if (data?.cmds) allCmds.push(...data.cmds);
      // Use any remote hash for desync detection
      if (slotId !== this.localSlotId && data?.hash !== undefined) {
        remoteHash = data.hash;
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

  /** Start listening for leave signals from remote players. */
  listenForLeaves(): void {
    const db = getDb();
    for (const remoteId of this.remoteSlotIds) {
      const unsub = onValue(ref(db, `games/${this.partyCode}/left/${remoteId}`), (snap) => {
        if (snap.val() === true) {
          this.onPlayerLeft?.(remoteId);
        }
      });
      this.unsubs.push(unsub);
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
    this.unsubs = [];
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
