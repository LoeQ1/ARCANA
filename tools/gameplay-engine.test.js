const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

global.window = global;
require(path.join(__dirname, "..", "game", "gameplay-engine.js"));
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "content", "data", "gameplay.json"), "utf8"));

function state() {
    return {
        level: 1, xp: 0, hp: 25, maxHp: 25, gold: 0, location: "forest",
        inventory: {}, quests: {}, questProgress: {}, flags: {}, combat: null
    };
}

test("숲 탐험에서 몬스터 조우를 실제 전투 상태로 만든다", () => {
    const player = state();
    const result = ArcanaGameplayEngine.explore(data, player, () => 0.1);
    assert.equal(player.combat.monsterId, "forest_wolf");
    assert.equal(player.combat.hp, 12);
    assert.equal(result.changed, true);
});

test("편집기로 추가한 탐험 지역도 지정한 몬스터와 조우한다", () => {
    const customData = structuredClone(data);
    customData.locations.ruins = { name: "폐허", explorable: true, monsterId: "forest_wolf", encounterChance: 1 };
    const player = state();
    player.location = "ruins";
    const result = ArcanaGameplayEngine.explore(customData, player, () => 0);
    assert.equal(player.combat.monsterId, "forest_wolf");
    assert.ok(result.messages[0].includes("폐허"));
});

test("탐험을 허용하지 않은 지역에서는 탐험 명령이 게임 상태를 바꾸지 않는다", () => {
    const player = state();
    player.location = "market";
    const result = ArcanaGameplayEngine.explore(data, player, () => 0);
    assert.equal(result.changed, false);
    assert.equal(player.combat, null);
});

test("전투 승리 보상, 경험치 레벨업, 퀘스트 완료를 적용한다", () => {
    const player = state();
    player.combat = { monsterId: "forest_wolf", hp: 12 };
    player.xp = 18;
    player.quests.ruins_clue = "active";
    ArcanaGameplayEngine.attack(data, player);
    ArcanaGameplayEngine.attack(data, player);
    const result = ArcanaGameplayEngine.attack(data, player);
    assert.equal(player.combat, null);
    assert.equal(player.level, 2);
    assert.equal(player.xp, 10);
    assert.equal(player.gold, 5);
    assert.equal(player.quests.ruins_clue, "complete");
    assert.equal(player.questProgress.ruins_clue, 1);
    assert.ok(result.messages.some((message) => message.includes("퀘스트 완료")));
});

test("숲 밖에서 숲늑대를 처치하면 폐허의 단서 퀘스트가 진행되지 않는다", () => {
    const player = state();
    player.location = "market";
    player.combat = { monsterId: "forest_wolf", hp: 12 };
    player.quests.ruins_clue = "active";
    ArcanaGameplayEngine.attack(data, player);
    ArcanaGameplayEngine.attack(data, player);
    ArcanaGameplayEngine.attack(data, player);
    assert.equal(player.quests.ruins_clue, "active");
    assert.equal(player.questProgress.ruins_clue, undefined);
});

test("패배하면 마을로 복귀하고 골드와 체력을 정해진 규칙으로 정산한다", () => {
    const player = state();
    player.gold = 99;
    player.combat = { monsterId: "forest_wolf", hp: 100 };
    for (let index = 0; index < 20 && player.combat; index += 1) ArcanaGameplayEngine.attack(data, player);
    assert.equal(player.location, "village");
    assert.equal(player.gold, 90);
    assert.equal(player.hp, 13);
    assert.equal(player.combat, null);
});

test("장터 구매와 회복 물약 사용이 골드, 인벤토리, 체력을 변경한다", () => {
    const player = state();
    player.location = "market";
    player.gold = 10;
    player.hp = 10;
    assert.equal(ArcanaGameplayEngine.buyItem(data, player, "물약").changed, true);
    assert.equal(player.gold, 5);
    assert.equal(player.inventory.healing_potion, 1);
    assert.equal(ArcanaGameplayEngine.useItem(data, player, "물약").changed, true);
    assert.equal(player.hp, 22);
    assert.equal(player.inventory.healing_potion, 0);
});
