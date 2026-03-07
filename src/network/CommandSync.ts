// Command synchronization for networked multiplayer via Firebase RTDB.
// Both clients run identical deterministic simulation; commands are relayed through RTDB.
//
// Usage (future integration with Game.ts):
//   const sync = new CommandSync(partyCode, localPlayerId);
//   sync.start();
//   // Each tick: sync.pushCommands(tick, myCommands);
//   // Wait:     const allCmds = await sync.waitForTick(tick);
//   // Cleanup:  sync.stop();

import { ref, set, onValue, Unsubscribe } from 'firebase/database';
import { getDb } from './FirebaseService';
import { GameCommand } from '../simulation/types';

export class CommandSync {
  private partyCode: string;
  private localPlayerId: number; // 0 = host, 1 = guest
  private tickBuffer: Map<number, Map<number, GameCommand[]>> = new Map();
  private unsubscribes: Unsubscribe[] = [];
  private resolvers: Map<number, () => void> = new Map();

  constructor(partyCode: string, localPlayerId: number) {
    this.partyCode = partyCode;
    this.localPlayerId = localPlayerId;
  }

  start(): void {
    const db = getDb();
    const cmdRef = ref(db, `parties/${this.partyCode}/commands`);
    const unsub = onValue(cmdRef, (snap) => {
      if (!snap.exists()) return;
      const data = snap.val() as Record<string, Record<string, GameCommand[]>>;
      for (const [tickStr, players] of Object.entries(data)) {
        const tick = parseInt(tickStr);
        if (!this.tickBuffer.has(tick)) this.tickBuffer.set(tick, new Map());
        const tickMap = this.tickBuffer.get(tick)!;
        for (const [pidStr, cmds] of Object.entries(players)) {
          tickMap.set(parseInt(pidStr), cmds);
        }
        // Check if anyone is waiting for this tick
        if (tickMap.size >= 2) {
          const resolver = this.resolvers.get(tick);
          if (resolver) {
            this.resolvers.delete(tick);
            resolver();
          }
        }
      }
    });
    this.unsubscribes.push(unsub);
  }

  async pushCommands(tick: number, commands: GameCommand[]): Promise<void> {
    const db = getDb();
    await set(
      ref(db, `parties/${this.partyCode}/commands/${tick}/${this.localPlayerId}`),
      commands.length > 0 ? commands : [],
    );
  }

  /** Wait until both players have submitted commands for the given tick. */
  waitForTick(tick: number, timeoutMs = 2000): Promise<GameCommand[]> {
    return new Promise((resolve) => {
      // Check if already available
      const existing = this.tickBuffer.get(tick);
      if (existing && existing.size >= 2) {
        resolve(this.collectCommands(tick));
        return;
      }

      const timer = setTimeout(() => {
        this.resolvers.delete(tick);
        // Timeout: return whatever we have (opponent may have disconnected)
        resolve(this.collectCommands(tick));
      }, timeoutMs);

      this.resolvers.set(tick, () => {
        clearTimeout(timer);
        resolve(this.collectCommands(tick));
      });
    });
  }

  private collectCommands(tick: number): GameCommand[] {
    const tickMap = this.tickBuffer.get(tick);
    if (!tickMap) return [];
    const allCmds: GameCommand[] = [];
    for (const [, cmds] of tickMap) {
      allCmds.push(...cmds);
    }
    // Clean up old ticks to avoid memory leak
    for (const key of this.tickBuffer.keys()) {
      if (key < tick - 10) this.tickBuffer.delete(key);
    }
    return allCmds;
  }

  stop(): void {
    for (const unsub of this.unsubscribes) unsub();
    this.unsubscribes = [];
    this.tickBuffer.clear();
    this.resolvers.clear();
  }
}
