import { createInitialState, simulateTick, getTeamAlleyOrigin } from '../simulation/GameState';
import { BuildingType, GameCommand, Lane, Race, Team, TICK_RATE } from '../simulation/types';
import { UNIT_STATS, SPAWN_INTERVAL_TICKS } from '../simulation/data';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`simSmoke failed: ${message}`);
  }
}

function runTick(state: ReturnType<typeof createInitialState>, commands: GameCommand[] = []): void {
  simulateTick(state, commands);
}

function testTeamAlleyOccupancy(): void {
  const state = createInitialState([
    { race: Race.Crown, isBot: false },
    { race: Race.Horde, isBot: true },
    { race: Race.Demon, isBot: true },
    { race: Race.Deep, isBot: true },
  ]);
  const bottomAlley = getTeamAlleyOrigin(Team.Bottom);
  const topAlley = getTeamAlleyOrigin(Team.Top);
  state.players[0].meat = 100;
  state.players[1].meat = 100;
  state.players[2].meat = 100;

  runTick(state, [{ type: 'place_building', playerId: 0, buildingType: BuildingType.Tower, gridType: 'alley', gridX: 0, gridY: 0 }]);
  const bottomTeamTowerCount = state.buildings.filter(b => b.buildGrid === 'alley' && b.gridX === 0 && b.gridY === 0).length;
  assert(bottomTeamTowerCount === 1, 'first bottom-team alley tower should be placed');

  runTick(state, [{ type: 'place_building', playerId: 1, buildingType: BuildingType.Tower, gridType: 'alley', gridX: 0, gridY: 0 }]);
  const stillOneBottomTower = state.buildings.filter(b => b.buildGrid === 'alley' && b.gridX === 0 && b.gridY === 0).length;
  assert(stillOneBottomTower === 1, 'teammate should not place a second tower in occupied shared alley slot');

  runTick(state, [{ type: 'place_building', playerId: 2, buildingType: BuildingType.Tower, gridType: 'alley', gridX: 0, gridY: 0 }]);
  const topTeamTowerCount = state.buildings.filter(
    b => b.buildGrid === 'alley' &&
      b.worldX === topAlley.x &&
      b.worldY === topAlley.y
  ).length;
  assert(topTeamTowerCount === 1, 'top team should still be able to place in its own alley slot');

  const bottomWorldSlotCount = state.buildings.filter(
    b => b.buildGrid === 'alley' &&
      b.worldX === bottomAlley.x &&
      b.worldY === bottomAlley.y
  ).length;
  assert(bottomWorldSlotCount === 1, 'bottom alley world slot should contain one tower');
}

function testLaneToggleAllSpawners(): void {
  const state = createInitialState([
    { race: Race.Crown, isBot: false },
    { race: Race.Horde, isBot: true },
    { race: Race.Demon, isBot: true },
    { race: Race.Deep, isBot: true },
  ]);
  state.players[0].gold = 1000;
  state.players[0].wood = 100;
  state.players[0].meat = 100;

  runTick(state, [{ type: 'place_building', playerId: 0, buildingType: BuildingType.MeleeSpawner, gridX: 0, gridY: 0 }]);
  runTick(state, [{ type: 'place_building', playerId: 0, buildingType: BuildingType.RangedSpawner, gridX: 1, gridY: 0 }]);
  runTick(state, [{ type: 'place_building', playerId: 0, buildingType: BuildingType.Tower, gridType: 'alley', gridX: 0, gridY: 0 }]);

  runTick(state, [{ type: 'toggle_all_lanes', playerId: 0, lane: Lane.Right }]);

  const mySpawners = state.buildings.filter(b =>
    b.playerId === 0 &&
    (b.type === BuildingType.MeleeSpawner || b.type === BuildingType.RangedSpawner || b.type === BuildingType.CasterSpawner)
  );
  const myPlacedTowers = state.buildings.filter(b => b.playerId === 0 && b.type === BuildingType.Tower && b.placedTick > 0);

  assert(mySpawners.length === 2, 'expected two spawners for lane toggle check');
  assert(mySpawners.every(b => b.lane === Lane.Right), 'all spawners should switch to requested lane');
  assert(myPlacedTowers.length === 1, 'expected one player-placed tower for lane toggle check');
  assert(myPlacedTowers[0].lane === Lane.Left, 'tower lane should not be changed by toggle_all_lanes');
}

function testSellCooldown(): void {
  const state = createInitialState([
    { race: Race.Crown, isBot: false },
    { race: Race.Horde, isBot: true },
    { race: Race.Demon, isBot: true },
    { race: Race.Deep, isBot: true },
  ]);
  state.players[0].gold = 1000;
  state.players[0].meat = 100;

  runTick(state, [{ type: 'place_building', playerId: 0, buildingType: BuildingType.MeleeSpawner, gridX: 0, gridY: 0 }]);
  const placed = state.buildings.find(b => b.playerId === 0 && b.type === BuildingType.MeleeSpawner);
  assert(placed, 'expected placed building for cooldown test');

  runTick(state, [{ type: 'sell_building', playerId: 0, buildingId: placed.id }]);
  const stillPresent = state.buildings.some(b => b.id === placed.id);
  assert(stillPresent, 'building should not be sellable before 5-second cooldown');
  assert(
    state.floatingTexts.some(ft => ft.text.startsWith('Sell in ')),
    'cooldown-denied sell should show countdown feedback text'
  );

  for (let i = 0; i < 5 * TICK_RATE; i++) runTick(state);
  runTick(state, [{ type: 'sell_building', playerId: 0, buildingId: placed.id }]);
  const removedAfterCooldown = !state.buildings.some(b => b.id === placed.id);
  assert(removedAfterCooldown, 'building should be sellable after 5-second cooldown');
}

function testPurchaseUpgradeAffectsFutureSpawns(): void {
  const state = createInitialState([
    { race: Race.Crown, isBot: false },
    { race: Race.Horde, isBot: true },
    { race: Race.Demon, isBot: true },
    { race: Race.Deep, isBot: true },
  ]);

  state.players[0].gold = 1000;
  state.players[0].wood = 500;
  state.players[0].meat = 500;

  runTick(state, [{ type: 'place_building', playerId: 0, buildingType: BuildingType.MeleeSpawner, gridX: 0, gridY: 0 }]);
  const spawner = state.buildings.find(b => b.playerId === 0 && b.type === BuildingType.MeleeSpawner);
  assert(spawner, 'expected melee spawner to exist for upgrade test');

  runTick(state, [{ type: 'purchase_upgrade', playerId: 0, buildingId: spawner.id, choice: 'B' }]);
  assert(spawner.upgradePath.join(',') === 'A,B', 'tier1 upgrade should apply');

  runTick(state, [{ type: 'purchase_upgrade', playerId: 0, buildingId: spawner.id, choice: 'D' }]);
  assert(spawner.upgradePath.join(',') === 'A,B,D', 'tier2 upgrade should apply after tier1');

  runTick(state, [{ type: 'purchase_upgrade', playerId: 0, buildingId: spawner.id, choice: 'E' }]);
  assert(spawner.upgradePath.join(',') === 'A,B,D', 'no further upgrades should be allowed past tier2');

  for (let i = 0; i < SPAWN_INTERVAL_TICKS + 1; i++) runTick(state);
  for (let i = 0; i < SPAWN_INTERVAL_TICKS + 1; i++) runTick(state);

  const spawned = state.units.find(u => u.playerId === 0 && u.category === 'melee');
  assert(spawned, 'expected at least one spawned melee unit after upgrades');
  const base = UNIT_STATS[Race.Crown][BuildingType.MeleeSpawner];
  assert(!!base, 'missing base unit stat for upgrade test');
  assert(spawned.hp > base.hp, 'upgraded spawn should have higher HP than base');
  assert(spawned.damage > base.damage, 'upgraded spawn should have higher damage than base');
}

function testPingLifecycle(): void {
  const state = createInitialState([
    { race: Race.Crown, isBot: false },
    { race: Race.Horde, isBot: true },
    { race: Race.Demon, isBot: true },
    { race: Race.Deep, isBot: true },
  ]);

  runTick(state, [{ type: 'ping', playerId: 0, x: 20, y: 30 }]);
  assert(state.pings.length > 0, 'ping command should create one ping marker');
  const firstPing = state.pings[0];
  assert(firstPing.x === 20 && firstPing.y === 30, 'ping marker should preserve coordinates');

  for (let i = 0; i < 3 * TICK_RATE + 1; i++) runTick(state);
  assert(state.pings.length === 0, 'ping marker should expire after its max lifetime');
}

function testQuickChatLifecycle(): void {
  const state = createInitialState([
    { race: Race.Crown, isBot: false },
    { race: Race.Horde, isBot: true },
    { race: Race.Demon, isBot: true },
    { race: Race.Deep, isBot: true },
  ]);

  runTick(state, [{ type: 'quick_chat', playerId: 0, message: 'Attack Left' }]);
  assert(state.quickChats.length > 0, 'quick chat command should create a callout');
  const firstChat = state.quickChats[0];
  assert(firstChat.message === 'Attack Left', 'quick chat callout should preserve message');

  for (let i = 0; i < 4 * TICK_RATE + 1; i++) runTick(state);
  assert(state.quickChats.length === 0, 'quick chat callout should expire after its lifetime');
}

function main(): void {
  testTeamAlleyOccupancy();
  testLaneToggleAllSpawners();
  testSellCooldown();
  testPurchaseUpgradeAffectsFutureSpawns();
  testPingLifecycle();
  testQuickChatLifecycle();
  console.log('simSmoke passed');
}

main();
