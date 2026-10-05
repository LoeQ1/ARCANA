const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

global.window = global;
require(path.join(__dirname, "..", "game", "story-engine.js"));
require(path.join(__dirname, "..", "game-state.js"));

const story = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "content", "story", "arrival.json"), "utf8"));
const gameplay = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "content", "data", "gameplay.json"), "utf8"));

function makeState() {
    return ArcanaGameState.createDefault("테스트 모험가", story);
}

test("시작 장면과 조건부 분기를 불러온다", () => {
    const state = makeState();
    assert.equal(ArcanaStoryEngine.validate(story).length, 0);
    assert.equal(ArcanaStoryEngine.getCurrentNode(story, state).title, "낡은 게시판");
    ArcanaStoryEngine.choose(story, state, "read_record");
    assert.equal(state.story.currentNode, "record_read");
    assert.equal(ArcanaStoryEngine.conditionsMet(story.nodes.record_read.conditions, state), true);
});

test("선택 효과를 적용하고 같은 선택의 보상을 중복 지급하지 않는다", () => {
    const state = makeState();
    ArcanaStoryEngine.choose(story, state, "read_record");
    assert.equal(state.flags.found_ruins_clue, true);
    assert.equal(state.inventory.torn_record, 1);
    ArcanaStoryEngine.choose(story, state, "return_notice");
    ArcanaStoryEngine.choose(story, state, "read_record");
    assert.equal(state.inventory.torn_record, 1);
});

test("유효하지 않은 선택을 거부한다", () => {
    assert.throws(() => ArcanaStoryEngine.choose(story, makeState(), "missing_choice"), /선택할 수 없는/);
});

test("잘못된 장면 연결을 검사기가 찾는다", () => {
    const invalid = structuredClone(story);
    invalid.nodes.village_notice.choices[0].next = "missing_node";
    assert.ok(ArcanaStoryEngine.validate(invalid).some((message) => message.includes("missing_node")));
});

test("스토리에서 존재하지 않는 게임 데이터 ID를 검사한다", () => {
    const invalid = structuredClone(story);
    invalid.nodes.village_notice.choices[0].effects[1].itemId = "missing_item";
    assert.ok(ArcanaStoryEngine.validate(invalid, gameplay).some((message) => message.includes("missing_item")));
});
