"use strict";

const $ = (selector) => document.querySelector(selector);
const graphCanvas = $("#graphCanvas");
const graphLinks = $("#graphLinks");
const graphNodes = $("#graphNodes");
const graphViewport = $("#graphViewport");
const storyWorkspace = $("#storyWorkspace");
const worldWorkspace = $("#worldWorkspace");
const monsterWorkspace = $("#monsterWorkspace");
const itemWorkspace = $("#itemWorkspace");
const stationWorkspace = $("#stationWorkspace");
const inspector = $("#inspector");
const nodeForm = $("#nodeForm");
const choicesEditor = $("#choicesEditor");
const questTriggerList = $("#questTriggerList");
const fileInput = $("#fileInput");
const validationPanel = $("#validationPanel");
const validationTitle = $("#validationTitle");
const validationList = $("#validationList");

let story = null;
let gameplay = null;
let audioTracks = [];
let previewAudio = null;
let previewAudioTrackId = null;
let activeNodeId = null;
let fileHandle = null;
let gameplayFileHandle = null;
let currentFileName = "arrival.json";
let dirty = false;
let gameplayDirty = false;
let contentRevision = 0;
let contentNeedsPublish = false;
let activeLocationId = null;
let activeMonsterId = null;
let activeItemId = null;
let activeStationId = null;
let activeRecipeId = null;

function setStatus(message, isError = false) {
    validationTitle.textContent = message;
    validationPanel.classList.toggle("invalid", isError);
}

function markDirty() {
    dirty = true;
    updateFileLabel();
}

function markGameplayDirty() {
    gameplayDirty = true;
    updateFileLabel();
}

function fillAudioSelect(select, type, selectedId, emptyLabel = "없음") {
    select.replaceChildren();
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = emptyLabel;
    select.append(emptyOption);
    for (const track of audioTracks.filter((item) => item.type === type)) {
        const option = document.createElement("option");
        option.value = track.id;
        option.textContent = track.name;
        select.append(option);
    }
    select.value = selectedId || "";
}

function previewAudioTrack(trackId) {
    const track = audioTracks.find((item) => item.id === trackId);
    if (!track) return;
    if (previewAudio) {
        const isSameTrackPlaying = previewAudioTrackId === trackId && !previewAudio.paused;
        previewAudio.pause();
        previewAudio.currentTime = 0;
        if (isSameTrackPlaying) {
            previewAudio = null;
            previewAudioTrackId = null;
            return;
        }
    }
    previewAudio = new Audio(`../${track.src}`);
    previewAudioTrackId = trackId;
    previewAudio.loop = track.loop !== false;
    previewAudio.volume = 0.5;
    previewAudio.play().catch(() => setStatus("미리듣기를 시작할 수 없습니다. 브라우저의 사이트 소리 설정을 확인하세요.", true));
}

function renderAudioSettings() {
    gameplay.audio ||= {};
    const controls = [
        ["combatMusicSelect", "music", "combatMusicId"],
        ["playerAttackSoundSelect", "sfx", "playerAttackSoundId"],
        ["enemyAttackSoundSelect", "sfx", "enemyAttackSoundId"]
    ];
    for (const [id, type, key] of controls) {
        const select = $(`#${id}`);
        fillAudioSelect(select, type, gameplay.audio[key]);
        select.onchange = () => {
            gameplay.audio[key] = select.value || null;
            markGameplayDirty();
            showValidation();
        };
    }
}

function updateFileLabel() {
    const changes = [dirty && "스토리 수정됨", gameplayDirty && "게임 데이터 수정됨"].filter(Boolean);
    const storageLabel = contentNeedsPublish ? "Supabase 최초 저장 필요" : `Supabase · r${contentRevision}`;
    $("#storyFileLabel").textContent = `${storageLabel}${changes.length ? ` · ${changes.join(" · ")}` : ""}`;
}

function parseArray(value, label) {
    let parsed;
    try {
        parsed = JSON.parse(value);
    } catch (error) {
        throw new Error(`${label}: ${error.message}`);
    }
    if (!Array.isArray(parsed)) throw new Error(`${label}: JSON 배열이어야 합니다.`);
    return parsed;
}

function validateStory() {
    if (!story || !gameplay) return ["스토리 또는 게임 데이터를 불러오지 못했습니다."];
    const errors = ArcanaStoryEngine.validate(story, gameplay);
    for (const [questId, quest] of Object.entries(gameplay.quests || {})) {
        const objective = quest.objective;
        if (!objective) continue;
        if (objective.type !== "defeatMonster") errors.push(`퀘스트 '${questId}' 목표 유형 '${objective.type}'은 지원하지 않습니다.`);
        if (!gameplay.monsters?.[objective.monsterId]) errors.push(`퀘스트 '${questId}' 목표 몬스터 '${objective.monsterId}'을(를) 찾을 수 없습니다.`);
        if (!gameplay.locations?.[objective.location]) errors.push(`퀘스트 '${questId}' 목표 지역 '${objective.location}'을(를) 찾을 수 없습니다.`);
        if (!Number.isInteger(objective.required) || objective.required < 1) errors.push(`퀘스트 '${questId}' 목표 횟수는 1 이상의 정수여야 합니다.`);
    }
    for (const [locationId, location] of Object.entries(gameplay.locations || {})) {
        if (!location.name?.trim()) errors.push(`지역 '${locationId}' 표시 이름이 필요합니다.`);
        if (!Array.isArray(location.exits)) errors.push(`지역 '${locationId}' exits는 배열이어야 합니다.`);
        else for (const exit of location.exits) if (!gameplay.locations[exit]) errors.push(`지역 '${locationId}' 출구 '${exit}'을(를) 찾을 수 없습니다.`);
        if (location.monsterId && !gameplay.monsters?.[location.monsterId]) errors.push(`지역 '${locationId}' 몬스터 '${location.monsterId}'을(를) 찾을 수 없습니다.`);
        if (location.resourceItemId && !gameplay.items?.[location.resourceItemId]) errors.push(`지역 '${locationId}' 자원 아이템 '${location.resourceItemId}'을(를) 찾을 수 없습니다.`);
        if (location.resourceDropChance !== undefined && (!Number.isFinite(location.resourceDropChance) || location.resourceDropChance < 0 || location.resourceDropChance > 1)) errors.push(`지역 '${locationId}' 탐험 아이템 발견 확률은 0~1 사이여야 합니다.`);
        if (location.shopItems !== undefined && !Array.isArray(location.shopItems)) errors.push(`지역 '${locationId}' shopItems는 배열이어야 합니다.`);
        else for (const itemId of location.shopItems || []) if (!gameplay.items?.[itemId]) errors.push(`지역 '${locationId}' 상점 상품 '${itemId}'을(를) 찾을 수 없습니다.`);
        if (!Number.isFinite(location.encounterChance) || location.encounterChance < 0 || location.encounterChance > 1) errors.push(`지역 '${locationId}' 조우 확률은 0~1 사이여야 합니다.`);
        if (location.ambientAudioId && !audioTracks.some((track) => track.id === location.ambientAudioId && track.type === "ambience")) errors.push(`지역 '${locationId}' 배경음 '${location.ambientAudioId}'을(를) 오디오 목록에서 찾을 수 없습니다.`);
    }
    for (const [itemId, item] of Object.entries(gameplay.items || {})) {
        if (item.upgradeable === true && !item.equipmentSlot) errors.push("강화 가능 설정은 장착 부위가 있는 장비에만 사용할 수 있습니다.");
        if (!item.name?.trim()) errors.push(`아이템 '${itemId}' 표시 이름이 필요합니다.`);
        if (!["consumable", "weapon", "armor", "material", "quest"].includes(item.type)) errors.push(`아이템 '${itemId}' 종류가 올바르지 않습니다.`);
        if (item.aliases !== undefined && !Array.isArray(item.aliases)) errors.push(`아이템 '${itemId}' aliases는 배열이어야 합니다.`);
        if (item.price !== undefined && (!Number.isInteger(item.price) || item.price < 0)) errors.push(`아이템 '${itemId}' 구매 가격은 0 이상의 정수여야 합니다.`);
        if (item.sellPrice !== undefined && (!Number.isInteger(item.sellPrice) || item.sellPrice < 0)) errors.push(`아이템 '${itemId}' 판매 가격은 0 이상의 정수여야 합니다.`);
        for (const stat of ["heal", "attack", "elementalAttack", "defense", "durability"]) {
            if (item[stat] !== undefined && (!Number.isInteger(item[stat]) || item[stat] < 0)) errors.push(`아이템 '${itemId}' ${stat} 값은 0 이상의 정수여야 합니다.`);
        }
        if (item.equipmentSlot && !["weapon", "armor"].includes(item.equipmentSlot)) errors.push(`아이템 '${itemId}' 장착 부위가 올바르지 않습니다.`);
        if (item.elementalAttack > 0 && (!item.element?.trim() || item.type !== "weapon")) errors.push(`아이템 '${itemId}' 속성 공격력은 속성 이름이 있는 무기에만 설정할 수 있습니다.`);
        if (["weapon", "armor"].includes(item.type) && item.equipmentSlot !== item.type) errors.push(`아이템 '${itemId}' 종류와 장착 부위를 일치시켜 주세요.`);
        if (item.equipmentSlot && !["weapon", "armor"].includes(item.type)) errors.push(`아이템 '${itemId}'은 무기나 방어구만 장착 부위를 가질 수 있습니다.`);
    }
    for (const [key, type] of [["combatMusicId", "music"], ["playerAttackSoundId", "sfx"], ["enemyAttackSoundId", "sfx"]]) {
        const trackId = gameplay.audio?.[key];
        if (trackId && !audioTracks.some((track) => track.id === trackId && track.type === type)) errors.push(`전투 오디오 '${trackId}'이(가) 오디오 목록에 없거나 유형이 맞지 않습니다.`);
    }
    for (const [monsterId, monster] of Object.entries(gameplay.monsters || {})) {
        if (!monster.name?.trim()) errors.push(`몬스터 '${monsterId}' 표시 이름이 필요합니다.`);
        for (const stat of ["hp", "attack", "xp", "gold"]) {
            if (!Number.isInteger(monster[stat]) || monster[stat] < (stat === "hp" ? 1 : 0)) errors.push(`몬스터 '${monsterId}' ${stat} 값이 올바르지 않습니다.`);
        }
        if (monster.heavyAttackDamage !== undefined && (!Number.isInteger(monster.heavyAttackDamage) || monster.heavyAttackDamage < 0)) errors.push(`몬스터 '${monsterId}' 강공격 피해는 0 이상의 정수여야 합니다.`);
        if (monster.heavyAttackDamage > 0 && (!Number.isInteger(monster.heavyAttackEvery) || monster.heavyAttackEvery < 2)) errors.push(`몬스터 '${monsterId}' 강공격 간격은 2 이상의 정수여야 합니다.`);
        if (monster.attackSoundId && !audioTracks.some((track) => track.id === monster.attackSoundId && track.type === "sfx")) errors.push(`몬스터 '${monsterId}' 공격 효과음 '${monster.attackSoundId}'을(를) 오디오 목록에서 찾을 수 없습니다.`);
        if (monster.drops !== undefined && !Array.isArray(monster.drops)) errors.push(`몬스터 '${monsterId}' drops는 배열이어야 합니다.`);
        for (const [index, drop] of (monster.drops || []).entries()) {
            if (!gameplay.items?.[drop.itemId]) errors.push(`몬스터 '${monsterId}' 드롭 ${index + 1}: 아이템 '${drop.itemId}'을(를) 찾을 수 없습니다.`);
            if (!Number.isFinite(drop.chance) || drop.chance < 0 || drop.chance > 1) errors.push(`몬스터 '${monsterId}' 드롭 ${index + 1} 확률은 0~1 사이여야 합니다.`);
            if (!Number.isInteger(drop.quantity) || drop.quantity < 1) errors.push(`몬스터 '${monsterId}' 드롭 ${index + 1} 수량은 1 이상의 정수여야 합니다.`);
        }
    }
    for (const [stationId, station] of Object.entries(gameplay.stations || {})) {
        if (!station.name?.trim()) errors.push(`장치 '${stationId}' 표시 이름이 필요합니다.`);
        if (station.aliases !== undefined && !Array.isArray(station.aliases)) errors.push(`장치 '${stationId}' aliases는 배열이어야 합니다.`);
        if (station.location && !gameplay.locations?.[station.location]) errors.push(`장치 '${stationId}' 위치 '${station.location}'을(를) 찾을 수 없습니다.`);
        if (station.activationItemId && !gameplay.items?.[station.activationItemId]) errors.push(`장치 '${stationId}' 해금 아이템 '${station.activationItemId}'을(를) 찾을 수 없습니다.`);
        if (station.openingReward && !gameplay.items?.[station.openingReward.itemId]) errors.push(`장치 '${stationId}' 개방 보상 아이템 '${station.openingReward.itemId}'을(를) 찾을 수 없습니다.`);
        if (station.openingReward && (!Number.isInteger(station.openingReward.quantity) || station.openingReward.quantity < 1)) errors.push(`장치 '${stationId}' 개방 보상 수량은 1 이상의 정수여야 합니다.`);
    }
    const stationCommands = new Map();
    const reservedStationCommands = new Set(["보기", "상태", "소지품", "이야기", "도움말", "탐험", "공격", "방어", "도망", "사용", "구매", "판매", "목록", "이동", "장착", "해제", "선택", "넣기", "레시피", "나가기"]);
    for (const [stationId, station] of Object.entries(gameplay.stations || {})) {
        const names = [stationId, station.name, ...(station.aliases || [])].filter(Boolean).map((value) => String(value).trim().toLowerCase());
        for (const name of names) {
            if (reservedStationCommands.has(name)) errors.push(`장치 '${stationId}' 명령어 '${name}'은 기본 명령어와 겹칩니다.`);
            const previous = stationCommands.get(name);
            if (previous && previous !== stationId) errors.push(`장치 명령어 '${name}'이(가) '${previous}'과 '${stationId}'에서 중복됩니다.`);
            stationCommands.set(name, stationId);
            for (const [locationId, location] of Object.entries(gameplay.locations || {})) {
                const locationNames = [locationId, location.name, ...(location.aliases || [])].filter(Boolean).map((value) => String(value).trim().toLowerCase());
                if (locationNames.includes(name)) errors.push(`장치 명령어 '${name}'이(가) 지역 '${locationId}'과 겹칩니다.`);
            }
        }
    }
    for (const [recipeId, recipe] of Object.entries(gameplay.recipes || {})) {
        if (!recipe.name?.trim()) errors.push(`레시피 '${recipeId}' 이름이 필요합니다.`);
        if (!gameplay.stations?.[recipe.stationId]) errors.push(`레시피 '${recipeId}' 장치 '${recipe.stationId}'을(를) 찾을 수 없습니다.`);
        if (!Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0) errors.push(`레시피 '${recipeId}'에 재료가 하나 이상 필요합니다.`);
        for (const [index, ingredient] of (recipe.ingredients || []).entries()) {
            if (!gameplay.items?.[ingredient.itemId]) errors.push(`레시피 '${recipeId}' 재료 ${index + 1} 아이템 '${ingredient.itemId}'을(를) 찾을 수 없습니다.`);
            if (!Number.isInteger(ingredient.quantity) || ingredient.quantity < 1) errors.push(`레시피 '${recipeId}' 재료 ${index + 1} 수량은 1 이상의 정수여야 합니다.`);
        }
        const validOutput = (output, path) => {
            if (!output || typeof output !== "object" || Array.isArray(output)) {
                errors.push(`레시피 '${recipeId}' ${path} 데이터가 올바르지 않습니다.`);
                return;
            }
            if (!gameplay.items?.[output.itemId]) errors.push(`레시피 '${recipeId}' ${path} 아이템 '${output.itemId}'을(를) 찾을 수 없습니다.`);
            if (!Number.isInteger(output.quantity) || output.quantity < 1) errors.push(`레시피 '${recipeId}' ${path} 수량은 1 이상의 정수여야 합니다.`);
        };
        const hasRandomOutcomes = Array.isArray(recipe.outcomes) && recipe.outcomes.length > 0;
        if (hasRandomOutcomes) {
            for (const [index, outcome] of recipe.outcomes.entries()) {
                validOutput(outcome, `무작위 결과 ${index + 1}`);
                if (!Number.isFinite(outcome?.weight) || outcome.weight <= 0) errors.push(`레시피 '${recipeId}' 결과 ${index + 1} 가중치는 0보다 커야 합니다.`);
            }
        } else if (recipe.output) validOutput(recipe.output, "고정 결과");
        else errors.push(`레시피 '${recipeId}'에 고정 결과 아이템을 지정하거나 무작위 결과를 하나 이상 추가해야 합니다.`);
    }
    for (const [recipeId, recipe] of Object.entries(gameplay.recipes || {})) {
        const equipmentInputs = (recipe.ingredients || []).filter((entry) => gameplay.items?.[entry.itemId]?.equipmentSlot);
        const equipmentOutputList = Array.isArray(recipe.outcomes) && recipe.outcomes.length ? recipe.outcomes : (recipe.output ? [recipe.output] : []);
        const equipmentOutputs = equipmentOutputList.filter((entry) => gameplay.items?.[entry?.itemId]?.equipmentSlot);
        if (equipmentInputs.length && equipmentOutputs.length) {
            for (const input of equipmentInputs) if (gameplay.items[input.itemId].upgradeable !== true) errors.push("장비 변환 레시피의 입력 장비를 강화 가능으로 설정하세요.");
            for (const output of equipmentOutputs) if (gameplay.items[output.itemId].upgradeable === true) errors.push("1회 강화 결과 장비의 강화 가능 설정을 해제하세요.");
        }
    }
    const recipeSignatures = new Map();
    for (const [recipeId, recipe] of Object.entries(gameplay.recipes || {})) {
        const ingredients = {};
        for (const entry of recipe.ingredients || []) ingredients[entry.itemId] = (ingredients[entry.itemId] || 0) + entry.quantity;
        const signature = recipe.stationId + "|" + Object.entries(ingredients).sort(([a], [b]) => a.localeCompare(b)).map(([id, quantity]) => id + ":" + quantity).join("|");
        if (recipeSignatures.has(signature)) errors.push("같은 장치에 재료 구성이 중복된 레시피가 있습니다.");
        recipeSignatures.set(signature, recipeId);
    }
    return errors;
}

function showValidation() {
    const errors = validateStory();
    for (const message of [$("#editMessage").textContent, $("#storyMetaMessage").textContent]) {
        if (message) errors.push(message);
    }
    validationList.replaceChildren();
    if (errors.length) {
        setStatus(`검증 실패 · 오류 ${errors.length}개`, true);
        for (const error of errors) {
            const item = document.createElement("li");
            item.textContent = error;
            validationList.append(item);
        }
        return false;
    }
    setStatus(`검증 통과 · ${Object.keys(story.nodes).length}개 장면, 게임 데이터 연결 확인`, false);
    return true;
}

function getNodeLayout() {
    const ids = Object.keys(story.nodes);
    const depths = new Map([[story.startNode, 0]]);
    const pending = [story.startNode];
    while (pending.length) {
        const id = pending.shift();
        const node = story.nodes[id];
        for (const choice of node?.choices || []) {
            if (choice.next && story.nodes[choice.next] && !depths.has(choice.next)) {
                depths.set(choice.next, depths.get(id) + 1);
                pending.push(choice.next);
            }
        }
    }

    const maxDepth = Math.max(0, ...depths.values());
    let unreachableIndex = 0;
    for (const id of ids) {
        if (!depths.has(id)) {
            depths.set(id, maxDepth + 1 + Math.floor(unreachableIndex / 5));
            unreachableIndex += 1;
        }
    }

    const columns = new Map();
    for (const id of ids) {
        const depth = depths.get(id);
        if (!columns.has(depth)) columns.set(depth, []);
        columns.get(depth).push(id);
    }
    const positions = new Map();
    let maxRows = 0;
    for (const [depth, columnIds] of columns) {
        maxRows = Math.max(maxRows, columnIds.length);
        columnIds.forEach((id, row) => positions.set(id, { x: 32 + depth * 350, y: 30 + row * 190 }));
    }
    return {
        ids,
        positions,
        width: Math.max(800, 32 + (Math.max(...columns.keys()) + 1) * 350),
        height: Math.max(520, 30 + maxRows * 190)
    };
}

function svgElement(name, attributes = {}) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
}

function renderGraph() {
    if (!story) return;
    const layout = getNodeLayout();
    graphCanvas.style.width = `${layout.width}px`;
    graphCanvas.style.height = `${layout.height}px`;
    graphLinks.setAttribute("width", String(layout.width));
    graphLinks.setAttribute("height", String(layout.height));
    graphLinks.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
    graphLinks.replaceChildren();

    const defs = svgElement("defs");
    const marker = svgElement("marker", { id: "arrow", viewBox: "0 0 10 10", refX: "8", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" });
    marker.append(svgElement("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#89927b" }));
    defs.append(marker);
    graphLinks.append(defs);

    for (const [sourceId, node] of Object.entries(story.nodes)) {
        const source = layout.positions.get(sourceId);
        for (const [index, choice] of (node.choices || []).entries()) {
            const target = layout.positions.get(choice.next);
            if (!target) continue;
            const x1 = source.x + 260;
            const y1 = source.y + 72 + Math.min(index, 3) * 8;
            const x2 = target.x;
            const y2 = target.y + 72;
            const backward = x2 < x1;
            const curve = Math.max(55, Math.abs(x2 - x1) * .45);
            const path = svgElement("path", {
                d: backward
                    ? `M ${x1} ${y1} C ${x1 + 45} ${y1 - 82}, ${x2 - 45} ${y2 - 82}, ${x2} ${y2}`
                    : `M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`,
                class: `edge-path${backward ? " back-edge" : ""}`
            });
            const title = svgElement("title");
            title.textContent = `${choice.id || "선택지"}: ${choice.text || "텍스트 없음"} → ${choice.next}`;
            path.append(title);
            graphLinks.append(path);
        }
    }

    graphNodes.replaceChildren();
    for (const id of layout.ids) {
        const node = story.nodes[id];
        const position = layout.positions.get(id);
        const card = document.createElement("button");
        card.type = "button";
        card.className = `scene-card${id === activeNodeId ? " selected" : ""}${id === story.startNode ? " start-scene" : ""}`;
        card.style.left = `${position.x}px`;
        card.style.top = `${position.y}px`;
        card.setAttribute("aria-label", `${node.title || id} 장면 편집`);

        const sceneId = document.createElement("span");
        sceneId.className = "scene-id";
        sceneId.textContent = id;
        const sceneTitle = document.createElement("span");
        sceneTitle.className = "scene-title";
        sceneTitle.textContent = node.title || "제목 없음";
        const sceneCopy = document.createElement("span");
        sceneCopy.className = "scene-copy";
        sceneCopy.textContent = node.text || "본문 없음";
        const sceneMeta = document.createElement("span");
        sceneMeta.className = "scene-meta";
        sceneMeta.textContent = `선택지 ${(node.choices || []).length}개`;
        card.append(sceneId, sceneTitle, sceneCopy, sceneMeta);
        card.addEventListener("click", () => selectNode(id));
        graphNodes.append(card);
    }
    $("#graphSummary").textContent = `${layout.ids.length}개 장면 · ${Object.values(story.nodes).reduce((total, node) => total + (node.choices || []).length, 0)}개 선택지`;
}

function addField(container, labelText, name, value, { multiline = false, rows = 2, json = false } = {}) {
    const label = document.createElement("label");
    label.textContent = labelText;
    const field = document.createElement(multiline ? "textarea" : "input");
    if (!multiline) field.type = "text";
    if (multiline) field.rows = rows;
    field.value = json ? JSON.stringify(value || [], null, 2) : (value || "");
    field.dataset.choiceField = name;
    if (json) {
        field.spellcheck = false;
        field.classList.add("code-field");
    }
    label.append(field);
    container.append(label);
}

function renderStationUnlockControls(container, choice, effectsField) {
    container.replaceChildren();
    const stationEffects = (choice.effects || []).filter((effect) => effect.type === "unlockStation");
    const createStationSelect = (selectedId, onChange, emptyLabel) => {
        const select = document.createElement("select");
        const emptyOption = document.createElement("option");
        emptyOption.value = "";
        emptyOption.textContent = emptyLabel;
        select.append(emptyOption);
        for (const [id, station] of Object.entries(gameplay.stations || {})) {
            const option = document.createElement("option");
            option.value = id;
            option.textContent = `${station.name || id} · ${id}`;
            select.append(option);
        }
        select.value = selectedId || "";
        select.addEventListener("change", () => {
            let effects;
            try {
                effects = parseArray(effectsField.value, `선택지 '${choice.id}' 효과`);
            } catch (error) {
                $("#editMessage").textContent = error.message;
                renderStationUnlockControls(container, choice, effectsField);
                return;
            }
            onChange(effects, select.value);
            choice.effects = effects;
            effectsField.value = JSON.stringify(effects, null, 2);
            $("#editMessage").textContent = "";
            markDirty();
            showValidation();
            renderStationUnlockControls(container, choice, effectsField);
        });
        return select;
    };

    const label = document.createElement("label");
    label.textContent = "스토리 선택 시 해금할 변환 장치";
    container.append(label);
    for (const [index, effect] of stationEffects.entries()) {
        const row = document.createElement("div");
        row.className = "station-unlock-effect";
        row.append(createStationSelect(effect.stationId, (effects, stationId) => {
            const matches = effects.filter((entry) => entry.type === "unlockStation");
            const target = matches[index];
            if (!target) {
                if (stationId) effects.push({ type: "unlockStation", stationId });
                return;
            }
            if (!stationId) effects.splice(effects.indexOf(target), 1);
            else target.stationId = stationId;
        }, "장치 해금 효과 제거"));
        container.append(row);
    }

    const addSelect = createStationSelect("", (effects, stationId) => {
        if (stationId) effects.push({ type: "unlockStation", stationId });
    }, "장치 해금 효과 추가...");
    container.append(addSelect);
}

function createChoiceCard(choice, index) {
    const card = document.createElement("section");
    card.className = "choice-card";
    card.dataset.choiceIndex = String(index);
    const header = document.createElement("div");
    header.className = "choice-card-header";
    const label = document.createElement("span");
    label.textContent = `선택지 ${index + 1}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "삭제";
    remove.addEventListener("click", () => {
        story.nodes[activeNodeId].choices.splice(index, 1);
        markDirty();
        renderInspector();
        renderGraph();
        showValidation();
    });
    header.append(label, remove);
    card.append(header);

    addField(card, "선택지 ID", "id", choice.id);
    addField(card, "표시 문장", "text", choice.text, { multiline: true, rows: 2 });

    const nextLabel = document.createElement("label");
    nextLabel.textContent = "다음 장면";
    const next = document.createElement("select");
    next.dataset.choiceField = "next";
    const terminal = document.createElement("option");
    terminal.value = "";
    terminal.textContent = "장면 종료 (권장하지 않음)";
    next.append(terminal);
    for (const id of Object.keys(story.nodes)) {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = `${story.nodes[id].title || id} · ${id}`;
        next.append(option);
    }
    next.value = choice.next || "";
    nextLabel.append(next);
    card.append(nextLabel);
    addField(card, "표시 조건", "conditions", choice.conditions, { multiline: true, rows: 3, json: true });
    addField(card, "선택 효과", "effects", choice.effects, { multiline: true, rows: 4, json: true });
    const effectsField = card.querySelector('[data-choice-field="effects"]');
    const stationUnlockControls = document.createElement("div");
    stationUnlockControls.className = "station-unlock-controls";
    renderStationUnlockControls(stationUnlockControls, choice, effectsField);
    card.append(stationUnlockControls);
    for (const effect of choice.effects || []) {
        if (effect.type !== "startQuest") continue;
        const summary = document.createElement("p");
        summary.className = "trigger-summary";
        summary.dataset.triggerSummary = effect.questId;
        summary.textContent = gameplay.quests?.[effect.questId]
            ? `연결된 게임 트리거: ${formatTrigger(gameplay.quests[effect.questId])}`
            : `연결된 퀘스트 데이터를 찾을 수 없습니다: ${effect.questId}`;
        card.append(summary);
    }
    return card;
}

function renderInspector() {
    const node = story?.nodes[activeNodeId];
    const empty = !node;
    $("#emptyInspector").hidden = !empty;
    nodeForm.hidden = empty;
    $("#deleteNodeButton").disabled = empty || activeNodeId === story.startNode || hasIncomingChoice(activeNodeId);
    if (empty) {
        $("#inspectorTitle").textContent = "장면 선택";
        $("#inspectorSubtitle").textContent = "흐름도에서 장면을 선택하세요.";
        return;
    }

    $("#inspectorTitle").textContent = node.title || "제목 없음";
    $("#inspectorSubtitle").textContent = activeNodeId;
    $("#nodeId").value = activeNodeId;
    $("#nodeTitle").value = node.title || "";
    $("#nodeText").value = node.text || "";
    $("#nodeConditions").value = JSON.stringify(node.conditions || [], null, 2);
    $("#editMessage").textContent = "";
    choicesEditor.replaceChildren();
    (node.choices || []).forEach((choice, index) => choicesEditor.append(createChoiceCard(choice, index)));
}

function getWorldLayout() {
    const ids = Object.keys(gameplay.locations || {});
    const startId = gameplay.locations.village ? "village" : ids[0];
    const depths = new Map(startId ? [[startId, 0]] : []);
    const pending = startId ? [startId] : [];
    while (pending.length) {
        const id = pending.shift();
        for (const exit of gameplay.locations[id]?.exits || []) {
            if (gameplay.locations[exit] && !depths.has(exit)) {
                depths.set(exit, depths.get(id) + 1);
                pending.push(exit);
            }
        }
    }
    const maxDepth = Math.max(0, ...depths.values());
    let looseIndex = 0;
    for (const id of ids) if (!depths.has(id)) depths.set(id, maxDepth + 1 + Math.floor(looseIndex++ / 5));
    const columns = new Map();
    for (const id of ids) {
        const depth = depths.get(id);
        if (!columns.has(depth)) columns.set(depth, []);
        columns.get(depth).push(id);
    }
    const positions = new Map();
    let maxRows = 0;
    for (const [depth, column] of columns) {
        maxRows = Math.max(maxRows, column.length);
        column.forEach((id, row) => positions.set(id, { x: 34 + depth * 340, y: 34 + row * 180 }));
    }
    return {
        ids, positions,
        width: Math.max(760, 34 + Math.max(0, ...columns.keys()) * 340 + 320),
        height: Math.max(500, 34 + maxRows * 180)
    };
}

function renderWorldGraph() {
    if (!gameplay) return;
    const layout = getWorldLayout();
    const canvas = $("#worldGraphCanvas");
    const svg = $("#worldGraphLinks");
    const nodes = $("#worldGraphNodes");
    canvas.style.width = `${layout.width}px`;
    canvas.style.height = `${layout.height}px`;
    svg.setAttribute("width", String(layout.width));
    svg.setAttribute("height", String(layout.height));
    svg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
    svg.replaceChildren();
    const defs = svgElement("defs");
    const marker = svgElement("marker", { id: "worldArrow", viewBox: "0 0 10 10", refX: "8", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" });
    marker.append(svgElement("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#89927b" }));
    defs.append(marker);
    svg.append(defs);

    const renderedRoutes = new Set();
    for (const [sourceId, location] of Object.entries(gameplay.locations || {})) {
        const source = layout.positions.get(sourceId);
        for (const targetId of location.exits || []) {
            const target = layout.positions.get(targetId);
            if (!source || !target || sourceId === targetId) continue;
            const routeKey = [sourceId, targetId].sort().join("::");
            if (renderedRoutes.has(routeKey)) continue;
            renderedRoutes.add(routeKey);
            const reciprocal = (gameplay.locations[targetId]?.exits || []).includes(sourceId);
            const x1 = source.x + 260;
            const y1 = source.y + 63;
            const x2 = target.x;
            const y2 = target.y + 63;
            const path = svgElement("path", {
                d: `M ${x1} ${y1} C ${x1 + 48} ${y1}, ${x2 - 48} ${y2}, ${x2} ${y2}`,
                class: "edge-path",
                "marker-end": "url(#worldArrow)",
                ...(reciprocal ? { "marker-start": "url(#worldArrow)" } : {})
            });
            const title = svgElement("title");
            title.textContent = reciprocal
                ? `${gameplay.locations[sourceId].name} ↔ ${gameplay.locations[targetId].name}`
                : `${location.name} → ${gameplay.locations[targetId].name}`;
            path.append(title);
            svg.append(path);
        }
    }

    nodes.replaceChildren();
    for (const id of layout.ids) {
        const location = gameplay.locations[id];
        const pos = layout.positions.get(id);
        const card = document.createElement("button");
        card.type = "button";
        card.className = `scene-card world-card${id === activeLocationId ? " selected" : ""}`;
        card.style.left = `${pos.x}px`;
        card.style.top = `${pos.y}px`;
        const idText = document.createElement("span");
        idText.className = "scene-id";
        idText.textContent = id;
        const title = document.createElement("span");
        title.className = "scene-title";
        title.textContent = location.name || "이름 없음";
        const exitsText = document.createElement("span");
        exitsText.className = "scene-copy";
        exitsText.textContent = (location.exits || []).map((exit) => gameplay.locations[exit]?.name || exit).join(" · ") || "출구 없음";
        const encounterText = document.createElement("span");
        encounterText.className = "scene-meta";
        encounterText.textContent = location.monsterId
            ? `${gameplay.monsters[location.monsterId]?.name || location.monsterId} 조우 · ${Math.round(location.encounterChance * 100)}%`
            : (location.explorable ? "탐험 가능 · 몬스터 조우 없음" : "탐험 비활성");
        card.append(idText, title, exitsText, encounterText);
        card.addEventListener("click", () => selectLocation(id));
        nodes.append(card);
    }
}

function hasLocationReferences(locationId) {
    if (Object.values(gameplay.locations).some((location) => (location.exits || []).includes(locationId))) return true;
    if (Object.values(gameplay.quests || {}).some((quest) => quest.objective?.location === locationId)) return true;
    return Object.values(story?.nodes || {}).some((node) => [
        ...(node.conditions || []),
        ...(node.choices || []).flatMap((choice) => [...(choice.conditions || []), ...(choice.effects || [])])
    ].some((rule) => rule.location === locationId));
}

function selectLocation(id) {
    activeLocationId = id;
    renderWorldGraph();
    renderLocationInspector();
}

function renderLocationInspector() {
    const location = gameplay?.locations[activeLocationId];
    const empty = !location;
    $("#locationInspectorEmpty").hidden = !empty;
    $("#locationForm").hidden = empty;
    $("#deleteLocationButton").disabled = empty || activeLocationId === "village" || hasLocationReferences(activeLocationId);
    if (empty) {
        $("#locationInspectorTitle").textContent = "지역 선택";
        $("#locationInspectorSubtitle").textContent = "지도에서 지역을 선택하세요.";
        return;
    }
    $("#locationInspectorTitle").textContent = location.name || "지역 설정";
    $("#locationInspectorSubtitle").textContent = activeLocationId;
    $("#locationId").value = activeLocationId;
    $("#locationName").value = location.name || "";
    $("#locationDescription").value = location.description || "";
    $("#locationAliases").value = (location.aliases || []).join(", ");
    $("#locationExplorable").checked = Boolean(location.explorable);
    $("#locationEncounterChance").value = String(location.encounterChance || 0);
    $("#encounterChanceLabel").textContent = `${Math.round((location.encounterChance || 0) * 100)}%`;
    const ambientAudio = $("#locationAmbientAudio");
    fillAudioSelect(ambientAudio, "ambience", location.ambientAudioId);
    ambientAudio.onchange = () => {
        location.ambientAudioId = ambientAudio.value || null;
        markGameplayDirty();
        showValidation();
    };

    const resourceItemSelect = $("#locationResourceItem");
    resourceItemSelect.replaceChildren();
    const noResource = document.createElement("option");
    noResource.value = "";
    noResource.textContent = "없음 (골드만 발견)";
    resourceItemSelect.append(noResource);
    for (const [id, item] of Object.entries(gameplay.items || {})) {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = `${item.name || id} · ${id}`;
        resourceItemSelect.append(option);
    }
    resourceItemSelect.value = location.resourceItemId || "";
    const resourceDropChance = $("#locationResourceDropChance");
    resourceDropChance.value = String(location.resourceDropChance ?? (location.resourceItemId ? 0.5 : 0));
    $("#resourceDropChanceLabel").textContent = `${Math.round(Number(resourceDropChance.value) * 100)}%`;
    resourceItemSelect.onchange = () => {
        location.resourceItemId = resourceItemSelect.value || null;
        if (location.resourceDropChance === undefined) location.resourceDropChance = location.resourceItemId ? 0.5 : 0;
        resourceDropChance.value = String(location.resourceDropChance);
        $("#resourceDropChanceLabel").textContent = `${Math.round(location.resourceDropChance * 100)}%`;
        markGameplayDirty();
        showValidation();
    };
    resourceDropChance.oninput = () => {
        location.resourceDropChance = Number(resourceDropChance.value);
        $("#resourceDropChanceLabel").textContent = `${Math.round(location.resourceDropChance * 100)}%`;
        markGameplayDirty();
        showValidation();
    };

    const shopItems = $("#locationShopItems");
    shopItems.replaceChildren();
    for (const [itemId, item] of Object.entries(gameplay.items || {})) {
        const label = document.createElement("label");
        label.className = "exit-option";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = itemId;
        checkbox.checked = (location.shopItems || []).includes(itemId);
        checkbox.addEventListener("change", () => {
            const selected = new Set(location.shopItems || []);
            if (checkbox.checked) selected.add(itemId);
            else selected.delete(itemId);
            location.shopItems = [...selected];
            markGameplayDirty();
            showValidation();
        });
        label.append(checkbox, document.createTextNode(`${item.name || itemId} · ${Number.isInteger(item.price) ? `${item.price} 골드` : "구매가 미설정"}`));
        shopItems.append(label);
    }

    const exits = $("#locationExits");
    exits.replaceChildren();
    for (const [id, candidate] of Object.entries(gameplay.locations)) {
        if (id === activeLocationId) continue;
        const label = document.createElement("label");
        label.className = "exit-option";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = id;
        checkbox.checked = (location.exits || []).includes(id);
        checkbox.addEventListener("change", () => {
            const nextExits = new Set(location.exits || []);
            if (checkbox.checked) nextExits.add(id);
            else nextExits.delete(id);
            location.exits = [...nextExits];
            markGameplayDirty();
            renderWorldGraph();
            showValidation();
        });
        label.append(checkbox, document.createTextNode(candidate.name || id));
        exits.append(label);
    }

    const monsterSelect = $("#locationMonster");
    monsterSelect.replaceChildren();
    const noMonster = document.createElement("option");
    noMonster.value = "";
    noMonster.textContent = "없음";
    monsterSelect.append(noMonster);
    for (const [id, monster] of Object.entries(gameplay.monsters || {})) {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = `${monster.name || id} · ${id}`;
        monsterSelect.append(option);
    }
    monsterSelect.value = location.monsterId || "";

    const deleteButton = $("#deleteLocationButton");
    deleteButton.title = hasLocationReferences(activeLocationId) ? "출구, 퀘스트 목표 또는 스토리 규칙에서 참조 중인 지역입니다." : "";

    $("#locationName").oninput = () => {
        location.name = $("#locationName").value;
        $("#locationInspectorTitle").textContent = location.name || "지역 설정";
        markGameplayDirty();
        renderWorldGraph();
        renderQuestTriggers();
    };
    $("#locationDescription").oninput = () => { location.description = $("#locationDescription").value; markGameplayDirty(); };
    $("#locationAliases").oninput = () => {
        location.aliases = $("#locationAliases").value.split(",").map((alias) => alias.trim()).filter(Boolean);
        markGameplayDirty();
    };
    $("#locationExplorable").onchange = () => { location.explorable = $("#locationExplorable").checked; markGameplayDirty(); renderWorldGraph(); };
    monsterSelect.onchange = () => {
        location.monsterId = monsterSelect.value || null;
        markGameplayDirty();
        renderWorldGraph();
        showValidation();
    };
    $("#locationEncounterChance").oninput = () => {
        location.encounterChance = Number($("#locationEncounterChance").value);
        $("#encounterChanceLabel").textContent = `${Math.round(location.encounterChance * 100)}%`;
        markGameplayDirty();
        renderWorldGraph();
    };
}

function addLocation() {
    let number = Object.keys(gameplay.locations).length + 1;
    let id = `region_${number}`;
    while (gameplay.locations[id]) id = `region_${++number}`;
    gameplay.locations[id] = { name: "새 지역", description: "", aliases: [], exits: [], explorable: false, monsterId: null, encounterChance: 0, shopItems: [] };
    activeLocationId = id;
    markGameplayDirty();
    renderWorldGraph();
    renderLocationInspector();
    showValidation();
}

function deleteLocation() {
    if (!activeLocationId || activeLocationId === "village" || hasLocationReferences(activeLocationId)) return;
    delete gameplay.locations[activeLocationId];
    activeLocationId = Object.keys(gameplay.locations)[0] || null;
    markGameplayDirty();
    renderWorldGraph();
    renderLocationInspector();
    showValidation();
}

function renderMonsterList() {
    const list = $("#monsterList");
    list.replaceChildren();
    for (const [id, monster] of Object.entries(gameplay.monsters || {})) {
        const card = document.createElement("button");
        card.type = "button";
        card.className = `monster-card${id === activeMonsterId ? " selected" : ""}`;
        const name = document.createElement("strong");
        name.textContent = monster.name || id;
        const stats = document.createElement("small");
        const heavyAttack = monster.heavyAttackDamage > 0 ? ` · 강공격 ${monster.heavyAttackDamage} (${monster.heavyAttackEvery}회마다)` : " · 강공격 없음";
        stats.textContent = `HP ${monster.hp} · 공격 ${monster.attack}${heavyAttack} · XP ${monster.xp} · 골드 ${monster.gold}`;
        card.append(name, stats);
        card.addEventListener("click", () => selectMonster(id));
        list.append(card);
    }
}

function hasMonsterReferences(monsterId) {
    return Object.values(gameplay.locations || {}).some((location) => location.monsterId === monsterId)
        || Object.values(gameplay.quests || {}).some((quest) => quest.objective?.monsterId === monsterId);
}

function selectMonster(id) {
    activeMonsterId = id;
    renderMonsterList();
    renderMonsterInspector();
}

function renderMonsterDrops(monster) {
    const container = $("#monsterDrops");
    container.replaceChildren();
    monster.drops ||= [];
    monster.drops.forEach((drop, index) => {
        const row = document.createElement("div");
        row.className = "monster-drop-row";

        const itemLabel = document.createElement("label");
        itemLabel.textContent = "아이템";
        const itemSelect = document.createElement("select");
        for (const [id, item] of Object.entries(gameplay.items || {})) {
            const option = document.createElement("option");
            option.value = id;
            option.textContent = item.name || id;
            itemSelect.append(option);
        }
        itemSelect.value = drop.itemId || "";
        itemSelect.addEventListener("change", () => {
            drop.itemId = itemSelect.value;
            markGameplayDirty();
            showValidation();
        });
        itemLabel.append(itemSelect);

        const chanceLabel = document.createElement("label");
        chanceLabel.textContent = "확률 %";
        const chanceInput = document.createElement("input");
        chanceInput.type = "number";
        chanceInput.min = "0";
        chanceInput.max = "100";
        chanceInput.step = "1";
        chanceInput.value = String(Math.round((drop.chance ?? 0.25) * 100));
        chanceInput.addEventListener("input", () => {
            drop.chance = Number(chanceInput.value) / 100;
            markGameplayDirty();
            showValidation();
        });
        chanceLabel.append(chanceInput);

        const quantityLabel = document.createElement("label");
        quantityLabel.textContent = "수량";
        const quantityInput = document.createElement("input");
        quantityInput.type = "number";
        quantityInput.min = "1";
        quantityInput.step = "1";
        quantityInput.value = String(drop.quantity ?? 1);
        quantityInput.addEventListener("input", () => {
            drop.quantity = Number(quantityInput.value);
            markGameplayDirty();
            showValidation();
        });
        quantityLabel.append(quantityInput);

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "danger";
        removeButton.textContent = "삭제";
        removeButton.addEventListener("click", () => {
            monster.drops.splice(index, 1);
            markGameplayDirty();
            renderMonsterDrops(monster);
            showValidation();
        });
        row.append(itemLabel, chanceLabel, quantityLabel, removeButton);
        container.append(row);
    });
}

function renderMonsterInspector() {
    const monster = gameplay?.monsters[activeMonsterId];
    const empty = !monster;
    $("#monsterInspectorEmpty").hidden = !empty;
    $("#monsterForm").hidden = empty;
    $("#deleteMonsterButton").disabled = empty || hasMonsterReferences(activeMonsterId);
    if (empty) {
        $("#monsterInspectorTitle").textContent = "몬스터 선택";
        $("#monsterInspectorSubtitle").textContent = "목록에서 몬스터를 선택하세요.";
        return;
    }
    $("#monsterInspectorTitle").textContent = monster.name || "몬스터 설정";
    $("#monsterInspectorSubtitle").textContent = activeMonsterId;
    $("#monsterId").value = activeMonsterId;
    for (const field of ["name", "hp", "attack", "xp", "gold"]) $(`#monster${field[0].toUpperCase()}${field.slice(1)}`).value = monster[field] ?? "";
    $("#monsterHeavyAttackDamage").value = monster.heavyAttackDamage ?? 0;
    $("#monsterHeavyAttackEvery").value = monster.heavyAttackEvery ?? 3;
    $("#monsterHeavyAttackTell").value = monster.heavyAttackTell || "";
    renderMonsterDrops(monster);
    const attackSound = $("#monsterAttackSound");
    fillAudioSelect(attackSound, "sfx", monster.attackSoundId);
    attackSound.onchange = () => {
        monster.attackSoundId = attackSound.value || null;
        markGameplayDirty();
        showValidation();
    };
    $("#deleteMonsterButton").title = hasMonsterReferences(activeMonsterId) ? "지역 조우 또는 퀘스트 목표에서 사용 중인 몬스터입니다." : "";
    $("#monsterEditMessage").textContent = "";
    $("#monsterName").oninput = () => {
        monster.name = $("#monsterName").value;
        $("#monsterInspectorTitle").textContent = monster.name || "몬스터 설정";
        markGameplayDirty();
        renderMonsterList();
        renderLocationInspector();
        renderQuestTriggers();
    };
    for (const field of ["hp", "attack", "xp", "gold"]) {
        $(`#monster${field[0].toUpperCase()}${field.slice(1)}`).oninput = () => {
            monster[field] = Number($(`#monster${field[0].toUpperCase()}${field.slice(1)}`).value);
            markGameplayDirty();
            renderMonsterList();
        };
    }
    for (const [field, elementId] of [["heavyAttackDamage", "monsterHeavyAttackDamage"], ["heavyAttackEvery", "monsterHeavyAttackEvery"]]) {
        $(`#${elementId}`).oninput = () => {
            monster[field] = Number($(`#${elementId}`).value);
            markGameplayDirty();
            renderMonsterList();
            showValidation();
        };
    }
    $("#monsterHeavyAttackTell").oninput = () => {
        monster.heavyAttackTell = $("#monsterHeavyAttackTell").value;
        markGameplayDirty();
    };
}

function addMonster() {
    let number = Object.keys(gameplay.monsters).length + 1;
    let id = `new_monster_${number}`;
    while (gameplay.monsters[id]) id = `new_monster_${++number}`;
    gameplay.monsters[id] = { name: "새 몬스터", hp: 10, attack: 2, xp: 5, gold: 2, heavyAttackDamage: 0, heavyAttackEvery: 3, heavyAttackTell: "", drops: [] };
    activeMonsterId = id;
    markGameplayDirty();
    renderMonsterList();
    renderMonsterInspector();
    renderLocationInspector();
    renderQuestTriggers();
    showValidation();
}

function deleteMonster() {
    if (!activeMonsterId || hasMonsterReferences(activeMonsterId)) return;
    delete gameplay.monsters[activeMonsterId];
    activeMonsterId = Object.keys(gameplay.monsters)[0] || null;
    markGameplayDirty();
    renderMonsterList();
    renderMonsterInspector();
    renderLocationInspector();
    renderQuestTriggers();
    showValidation();
}

function renderItemList() {
    const list = $("#itemList");
    list.replaceChildren();
    for (const [id, item] of Object.entries(gameplay.items || {})) {
        const card = document.createElement("button");
        card.type = "button";
        card.className = `monster-card${id === activeItemId ? " selected" : ""}`;
        const name = document.createElement("strong");
        name.textContent = item.name || id;
        const summary = document.createElement("small");
        const stats = [];
        if (Number.isInteger(item.price)) stats.push(`구매 ${item.price}G`);
        if (item.heal) stats.push(`회복 ${item.heal}`);
        if (item.attack) stats.push(`공격 +${item.attack}`);
        if (item.elementalAttack) stats.push(`${item.element || "속성"} +${item.elementalAttack}`);
        if (item.defense) stats.push(`방어 +${item.defense}`);
        if (item.durability) stats.push(`내구 ${item.durability}`);
        summary.textContent = `${item.type || "item"} · ${stats.join(" · ") || "능력치 없음"}`;
        card.append(name, summary);
        card.addEventListener("click", () => selectItem(id));
        list.append(card);
    }
}

function hasItemReferences(itemId) {
    if (Object.values(gameplay.locations || {}).some((location) => location.resourceItemId === itemId || (location.shopItems || []).includes(itemId))) return true;
    if (Object.values(gameplay.stations || {}).some((station) => station.activationItemId === itemId || station.openingReward?.itemId === itemId)) return true;
    if (Object.values(gameplay.recipes || {}).some((recipe) =>
        (recipe.ingredients || []).some((ingredient) => ingredient.itemId === itemId)
        || recipe.output?.itemId === itemId
        || (recipe.outcomes || []).some((outcome) => outcome.itemId === itemId)
    )) return true;
    return Object.values(story?.nodes || {}).some((node) => {
        const conditions = [...(node.conditions || []), ...(node.choices || []).flatMap((choice) => choice.conditions || [])];
        const effects = (node.choices || []).flatMap((choice) => choice.effects || []);
        return [...conditions, ...effects].some((entry) => entry.itemId === itemId || entry.item === itemId);
    });
}

function selectItem(id) {
    activeItemId = id;
    renderItemList();
    renderItemInspector();
}

function renderItemInspector() {
    const item = gameplay?.items?.[activeItemId];
    const empty = !item;
    $("#itemInspectorEmpty").hidden = !empty;
    $("#itemForm").hidden = empty;
    $("#deleteItemButton").disabled = empty || hasItemReferences(activeItemId);
    if (empty) {
        $("#itemInspectorTitle").textContent = "아이템 선택";
        $("#itemInspectorSubtitle").textContent = "목록에서 아이템을 선택하세요.";
        return;
    }
    $("#itemInspectorTitle").textContent = item.name || "아이템 설정";
    $("#itemInspectorSubtitle").textContent = activeItemId;
    $("#itemId").value = activeItemId;
    $("#itemName").value = item.name || "";
    $("#itemType").value = item.type || "material";
    $("#itemDescription").value = item.description || "";
    $("#itemAliases").value = (item.aliases || []).join(", ");
    $("#itemPrice").value = item.price ?? "";
    $("#itemSellPrice").value = item.sellPrice ?? "";
    $("#itemEquipmentSlot").value = item.equipmentSlot || "";
    $("#itemUpgradeable").checked = item.upgradeable === true;
    for (const field of ["heal", "attack", "elementalAttack", "defense", "durability"]) $(`#item${field[0].toUpperCase()}${field.slice(1)}`).value = item[field] ?? 0;
    $("#itemElement").value = item.element || "";
    $("#deleteItemButton").title = hasItemReferences(activeItemId) ? "상점·탐험·변환 레시피 또는 스토리에서 사용 중인 아이템입니다." : "";

    $("#itemName").oninput = () => {
        item.name = $("#itemName").value;
        $("#itemInspectorTitle").textContent = item.name || "아이템 설정";
        markGameplayDirty();
        renderItemList();
        renderLocationInspector();
        renderStationInspector();
    };
    $("#itemType").onchange = () => {
        item.type = $("#itemType").value;
        if (item.type === "weapon") item.equipmentSlot = "weapon";
        else if (item.type === "armor") item.equipmentSlot = "armor";
        else item.equipmentSlot = null;
        if (!item.equipmentSlot) item.upgradeable = false;
        $("#itemUpgradeable").checked = item.upgradeable === true;
        $("#itemEquipmentSlot").value = item.equipmentSlot || "";
        markGameplayDirty();
        renderItemList();
        showValidation();
    };
    $("#itemDescription").oninput = () => { item.description = $("#itemDescription").value; markGameplayDirty(); };
    $("#itemElement").oninput = () => { item.element = $("#itemElement").value.trim() || null; markGameplayDirty(); renderItemList(); showValidation(); };
    $("#itemAliases").oninput = () => {
        item.aliases = $("#itemAliases").value.split(",").map((alias) => alias.trim()).filter(Boolean);
        markGameplayDirty();
    };
    for (const [field, id] of [["price", "itemPrice"], ["sellPrice", "itemSellPrice"]]) {
        $(`#${id}`).oninput = () => {
            const value = $(`#${id}`).value;
            if (value === "") delete item[field];
            else item[field] = Number(value);
            markGameplayDirty();
            renderItemList();
            renderLocationInspector();
            renderStationInspector();
            showValidation();
        };
    }
    $("#itemEquipmentSlot").onchange = () => {
        item.equipmentSlot = $("#itemEquipmentSlot").value || null;
        if (!item.equipmentSlot) item.upgradeable = false;
        $("#itemUpgradeable").checked = item.upgradeable === true;
        markGameplayDirty();
        showValidation();
    };
    $("#itemUpgradeable").onchange = () => {
        item.upgradeable = $("#itemUpgradeable").checked;
        markGameplayDirty();
        showValidation();
    };
    for (const field of ["heal", "attack", "elementalAttack", "defense", "durability"]) {
        const id = `item${field[0].toUpperCase()}${field.slice(1)}`;
        $(`#${id}`).oninput = () => {
            item[field] = Number($(`#${id}`).value);
            markGameplayDirty();
            renderItemList();
            showValidation();
        };
    }
}

function addItem() {
    let number = Object.keys(gameplay.items || {}).length + 1;
    let id = `new_item_${number}`;
    while (gameplay.items[id]) id = `new_item_${++number}`;
    gameplay.items[id] = { name: "새 아이템", description: "", type: "material", heal: 0, attack: 0, defense: 0, durability: 0 };
    activeItemId = id;
    markGameplayDirty();
    renderItemList();
    renderItemInspector();
    renderLocationInspector();
    renderStationInspector();
    showValidation();
}

function deleteItem() {
    if (!activeItemId || hasItemReferences(activeItemId)) return;
    delete gameplay.items[activeItemId];
    activeItemId = Object.keys(gameplay.items || {})[0] || null;
    markGameplayDirty();
    renderItemList();
    renderItemInspector();
    renderLocationInspector();
    renderStationInspector();
    renderQuestTriggers();
    showValidation();
}

function hasStationReferences(stationId) {
    if (Object.values(gameplay.recipes || {}).some((recipe) => recipe.stationId === stationId)) return true;
    return Object.values(story?.nodes || {}).some((node) => {
        const conditions = [...(node.conditions || []), ...(node.choices || []).flatMap((choice) => choice.conditions || [])];
        const effects = (node.choices || []).flatMap((choice) => choice.effects || []);
        return [...conditions, ...effects].some((rule) => rule.stationId === stationId);
    });
}

function hasRecipeReferences(recipeId) {
    return Object.values(story?.nodes || {}).some((node) => {
        const conditions = [...(node.conditions || []), ...(node.choices || []).flatMap((choice) => choice.conditions || [])];
        const effects = (node.choices || []).flatMap((choice) => choice.effects || []);
        return [...conditions, ...effects].some((rule) => rule.recipeId === recipeId);
    });
}

function makeSelect(options, selectedValue, emptyLabel) {
    const select = document.createElement("select");
    if (emptyLabel !== undefined) {
        const empty = document.createElement("option");
        empty.value = "";
        empty.textContent = emptyLabel;
        select.append(empty);
    }
    for (const [value, label] of options) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        select.append(option);
    }
    select.value = selectedValue || "";
    return select;
}

function renderStationList() {
    const list = $("#stationList");
    list.replaceChildren();
    for (const [id, station] of Object.entries(gameplay.stations || {})) {
        const card = document.createElement("button");
        card.type = "button";
        card.className = `monster-card${id === activeStationId ? " selected" : ""}`;
        const name = document.createElement("strong");
        name.textContent = station.name || id;
        const details = document.createElement("small");
        const locationName = gameplay.locations?.[station.location]?.name || (station.location ? station.location : "장소 제한 없음");
        const recipeCount = Object.values(gameplay.recipes || {}).filter((recipe) => recipe.stationId === id).length;
        details.textContent = `${locationName} · 레시피 ${recipeCount}개`;
        card.append(name, details);
        card.addEventListener("click", () => {
            activeStationId = id;
            const recipe = Object.entries(gameplay.recipes || {}).find(([, value]) => value.stationId === id)?.[0];
            activeRecipeId = recipe || null;
            renderStationList();
            renderStationInspector();
        });
        list.append(card);
    }
}

function renderRecipeList(stationId) {
    const list = $("#stationRecipeList");
    list.replaceChildren();
    for (const [id, recipe] of Object.entries(gameplay.recipes || {}).filter(([, value]) => value.stationId === stationId)) {
        const card = document.createElement("button");
        card.type = "button";
        card.className = `monster-card${id === activeRecipeId ? " selected" : ""}`;
        const name = document.createElement("strong");
        name.textContent = recipe.name || id;
        const summary = document.createElement("small");
        const inputText = (recipe.ingredients || []).map((entry) => `${gameplay.items?.[entry.itemId]?.name || entry.itemId} x${entry.quantity}`).join(" + ");
        const output = recipe.outcomes?.length ? "무작위 결과" : gameplay.items?.[recipe.output?.itemId]?.name || recipe.output?.itemId || "결과 미설정";
        summary.textContent = `${inputText} → ${output}`;
        card.append(name, summary);
        card.addEventListener("click", () => {
            activeRecipeId = id;
            renderRecipeList(stationId);
            renderRecipeInspector();
        });
        list.append(card);
    }
}

function renderStationInspector() {
    const station = gameplay?.stations?.[activeStationId];
    const empty = !station;
    $("#stationInspectorEmpty").hidden = !empty;
    $("#stationEditor").hidden = empty;
    $("#deleteStationButton").disabled = empty || hasStationReferences(activeStationId);
    if (empty) {
        $("#stationInspectorTitle").textContent = "장치 선택";
        $("#stationInspectorSubtitle").textContent = "목록에서 장치를 선택하세요.";
        $("#stationRecipeList").replaceChildren();
        $("#recipeEditor").hidden = true;
        $("#recipeInspectorEmpty").hidden = false;
        return;
    }
    $("#stationInspectorTitle").textContent = station.name || "장치 설정";
    $("#stationInspectorSubtitle").textContent = activeStationId;
    $("#stationId").value = activeStationId;
    $("#stationName").value = station.name || "";
    $("#stationAliases").value = (station.aliases || []).join(", ");
    const locationSelect = makeSelect(Object.entries(gameplay.locations || {}).map(([id, value]) => [id, `${value.name || id} · ${id}`]), station.location, "어디서나 사용 가능");
    $("#stationLocation").replaceWith(locationSelect);
    locationSelect.id = "stationLocation";
    const itemOptions = Object.entries(gameplay.items || {}).map(([id, item]) => [id, `${item.name || id} · ${id}`]);
    const activationSelect = makeSelect(itemOptions, station.activationItemId, "열쇠 없이 사용");
    $("#stationActivationItem").replaceWith(activationSelect);
    activationSelect.id = "stationActivationItem";
    const rewardSelect = makeSelect(itemOptions, station.openingReward?.itemId, "첫 개방 보상 없음");
    $("#stationOpeningReward").replaceWith(rewardSelect);
    rewardSelect.id = "stationOpeningReward";
    $("#stationOpeningRewardQuantity").value = String(station.openingReward?.quantity || 1);
    $("#stationUnlockedByDefault").checked = station.unlockedByDefault === true;
    $("#stationActivationText").value = station.activationText || "";
    $("#stationEnterText").value = station.enterText || "";
    $("#stationFailureText").value = station.failureText || "";
    $("#stationExitText").value = station.exitText || "";
    $("#deleteStationButton").title = hasStationReferences(activeStationId) ? "연결된 레시피나 스토리 조건·효과를 먼저 제거하세요." : "";

    $("#stationName").oninput = () => { station.name = $("#stationName").value; $("#stationInspectorTitle").textContent = station.name || "장치 설정"; markGameplayDirty(); renderStationList(); };
    $("#stationAliases").oninput = () => { station.aliases = $("#stationAliases").value.split(",").map((alias) => alias.trim()).filter(Boolean); markGameplayDirty(); };
    locationSelect.onchange = () => { station.location = locationSelect.value || null; markGameplayDirty(); renderStationList(); showValidation(); };
    activationSelect.onchange = () => { station.activationItemId = activationSelect.value || null; markGameplayDirty(); showValidation(); };
    rewardSelect.onchange = () => {
        if (rewardSelect.value) station.openingReward = { itemId: rewardSelect.value, quantity: Number($("#stationOpeningRewardQuantity").value) || 1 };
        else delete station.openingReward;
        markGameplayDirty();
        showValidation();
    };
    $("#stationOpeningRewardQuantity").oninput = () => {
        if (station.openingReward) station.openingReward.quantity = Number($("#stationOpeningRewardQuantity").value);
        markGameplayDirty();
        showValidation();
    };
    $("#stationUnlockedByDefault").onchange = () => { station.unlockedByDefault = $("#stationUnlockedByDefault").checked; markGameplayDirty(); };
    for (const [field, id] of [["activationText", "stationActivationText"], ["enterText", "stationEnterText"], ["failureText", "stationFailureText"], ["exitText", "stationExitText"]]) {
        $(`#${id}`).oninput = () => { station[field] = $(`#${id}`).value; markGameplayDirty(); };
    }

    renderRecipeList(activeStationId);
    $("#addRecipeButton").disabled = !Object.keys(gameplay.items || {}).length;
    if (!activeRecipeId || gameplay.recipes?.[activeRecipeId]?.stationId !== activeStationId) {
        activeRecipeId = Object.entries(gameplay.recipes || {}).find(([, recipe]) => recipe.stationId === activeStationId)?.[0] || null;
    }
    renderRecipeInspector();
}

function renderIngredientRows(recipe) {
    const container = $("#recipeIngredients");
    container.replaceChildren();
    recipe.ingredients ||= [];
    recipe.ingredients.forEach((ingredient, index) => {
        const row = document.createElement("div");
        row.className = "recipe-row";
        const itemLabel = document.createElement("label"); itemLabel.textContent = "아이템";
        const select = makeSelect(Object.entries(gameplay.items || {}).map(([id, item]) => [id, item.name || id]), ingredient.itemId);
        itemLabel.append(select);
        const qtyLabel = document.createElement("label"); qtyLabel.textContent = "수량";
        const quantity = document.createElement("input"); quantity.type = "number"; quantity.min = "1"; quantity.step = "1"; quantity.value = String(ingredient.quantity || 1); qtyLabel.append(quantity);
        const remove = document.createElement("button"); remove.type = "button"; remove.className = "danger"; remove.textContent = "삭제";
        select.onchange = () => { ingredient.itemId = select.value; markGameplayDirty(); renderRecipeList(activeStationId); showValidation(); };
        quantity.oninput = () => { ingredient.quantity = Number(quantity.value); markGameplayDirty(); renderRecipeList(activeStationId); showValidation(); };
        remove.onclick = () => { recipe.ingredients.splice(index, 1); markGameplayDirty(); renderIngredientRows(recipe); renderRecipeList(activeStationId); showValidation(); };
        row.append(itemLabel, qtyLabel, remove); container.append(row);
    });
}

function renderOutcomeRows(recipe) {
    const container = $("#recipeOutcomes");
    container.replaceChildren();
    recipe.outcomes ||= [];
    recipe.outcomes.forEach((outcome, index) => {
        const row = document.createElement("div");
        row.className = "recipe-row outcome-row";
        const itemLabel = document.createElement("label"); itemLabel.textContent = "결과 아이템";
        const select = makeSelect(Object.entries(gameplay.items || {}).map(([id, item]) => [id, item.name || id]), outcome.itemId); itemLabel.append(select);
        const quantityLabel = document.createElement("label"); quantityLabel.textContent = "수량";
        const quantity = document.createElement("input"); quantity.type = "number"; quantity.min = "1"; quantity.step = "1"; quantity.value = String(outcome.quantity || 1); quantityLabel.append(quantity);
        const weightLabel = document.createElement("label"); weightLabel.textContent = "가중치";
        const weight = document.createElement("input"); weight.type = "number"; weight.min = "0.01"; weight.step = "0.1"; weight.value = String(outcome.weight || 1); weightLabel.append(weight);
        const remove = document.createElement("button"); remove.type = "button"; remove.className = "danger"; remove.textContent = "삭제";
        select.onchange = () => { outcome.itemId = select.value; markGameplayDirty(); renderRecipeList(activeStationId); showValidation(); };
        quantity.oninput = () => { outcome.quantity = Number(quantity.value); markGameplayDirty(); showValidation(); };
        weight.oninput = () => { outcome.weight = Number(weight.value); markGameplayDirty(); showValidation(); };
        remove.onclick = () => { recipe.outcomes.splice(index, 1); markGameplayDirty(); renderOutcomeRows(recipe); showValidation(); };
        row.append(itemLabel, quantityLabel, weightLabel, remove); container.append(row);
    });
}

function renderRecipeInspector() {
    const recipe = gameplay?.recipes?.[activeRecipeId];
    const empty = !recipe || recipe.stationId !== activeStationId;
    $("#recipeInspectorEmpty").hidden = !empty;
    $("#recipeEditor").hidden = empty;
    if (empty) return;
    $("#recipeInspectorTitle").textContent = recipe.name || "레시피 설정";
    $("#recipeId").value = activeRecipeId;
    $("#recipeName").value = recipe.name || "";
    $("#recipeDiscoveredByDefault").checked = recipe.discoveredByDefault !== false;
    $("#recipeSuccessText").value = recipe.successText || "";
    $("#recipeName").oninput = () => { recipe.name = $("#recipeName").value; $("#recipeInspectorTitle").textContent = recipe.name || "레시피 설정"; markGameplayDirty(); renderRecipeList(activeStationId); };
    $("#recipeDiscoveredByDefault").onchange = () => { recipe.discoveredByDefault = $("#recipeDiscoveredByDefault").checked; markGameplayDirty(); };
    $("#recipeSuccessText").oninput = () => { recipe.successText = $("#recipeSuccessText").value; markGameplayDirty(); };
    renderIngredientRows(recipe);
    const randomMode = Array.isArray(recipe.outcomes) && (recipe.outcomes.length > 0 || !recipe.output);
    $("#recipeOutputMode").value = randomMode ? "random" : "fixed";
    $("#fixedRecipeOutput").hidden = randomMode;
    $("#randomRecipeOutput").hidden = !randomMode;
    const outputSelect = makeSelect(Object.entries(gameplay.items || {}).map(([id, item]) => [id, item.name || id]), recipe.output?.itemId);
    $("#recipeOutputItem").replaceWith(outputSelect); outputSelect.id = "recipeOutputItem";
    $("#recipeOutputQuantity").value = String(recipe.output?.quantity || 1);
    outputSelect.onchange = () => { recipe.output ||= { quantity: 1 }; recipe.output.itemId = outputSelect.value; markGameplayDirty(); renderRecipeList(activeStationId); showValidation(); };
    $("#recipeOutputQuantity").oninput = () => { recipe.output ||= { itemId: Object.keys(gameplay.items || {})[0], quantity: 1 }; recipe.output.quantity = Number($("#recipeOutputQuantity").value); markGameplayDirty(); showValidation(); };
    $("#recipeOutputMode").onchange = () => {
        if ($("#recipeOutputMode").value === "random") {
            const current = recipe.output || { itemId: Object.keys(gameplay.items || {})[0], quantity: 1 };
            recipe.outcomes = [{ ...current, weight: 1 }];
            delete recipe.output;
        } else {
            recipe.output = recipe.outcomes?.[0] ? { itemId: recipe.outcomes[0].itemId, quantity: recipe.outcomes[0].quantity } : { itemId: Object.keys(gameplay.items || {})[0], quantity: 1 };
            delete recipe.outcomes;
        }
        markGameplayDirty();
        renderRecipeInspector();
        renderRecipeList(activeStationId);
        showValidation();
    };
    renderOutcomeRows(recipe);
    $("#addIngredientButton").onclick = () => {
        const firstItemId = Object.keys(gameplay.items || {})[0];
        if (!firstItemId) return;
        recipe.ingredients.push({ itemId: firstItemId, quantity: 1 });
        markGameplayDirty(); renderIngredientRows(recipe); showValidation();
    };
    $("#addOutcomeButton").onclick = () => {
        const firstItemId = Object.keys(gameplay.items || {})[0];
        if (!firstItemId) return;
        recipe.outcomes.push({ itemId: firstItemId, quantity: 1, weight: 1 });
        markGameplayDirty(); renderOutcomeRows(recipe); showValidation();
    };
    $("#deleteRecipeButton").disabled = hasRecipeReferences(activeRecipeId);
    $("#deleteRecipeButton").title = hasRecipeReferences(activeRecipeId) ? "스토리 조건이나 효과에서 참조 중인 레시피입니다." : "";
}

function addStation() {
    let number = Object.keys(gameplay.stations || {}).length + 1;
    let id = `new_station_${number}`;
    while (gameplay.stations?.[id]) id = `new_station_${++number}`;
    gameplay.stations ||= {};
    gameplay.stations[id] = { name: "새 변환 장치", aliases: [], location: null, unlockedByDefault: false, enterText: "재료를 넣으세요.", failureText: "재료가 사라졌습니다." };
    activeStationId = id;
    activeRecipeId = null;
    markGameplayDirty(); renderStationList(); renderStationInspector(); showValidation();
}

function deleteStation() {
    if (!activeStationId || hasStationReferences(activeStationId)) return;
    delete gameplay.stations[activeStationId];
    activeStationId = Object.keys(gameplay.stations || {})[0] || null;
    activeRecipeId = Object.entries(gameplay.recipes || {}).find(([, recipe]) => recipe.stationId === activeStationId)?.[0] || null;
    markGameplayDirty(); renderStationList(); renderStationInspector(); showValidation();
}

function addRecipe() {
    if (!activeStationId) return;
    let number = Object.keys(gameplay.recipes || {}).length + 1;
    let id = `new_recipe_${number}`;
    while (gameplay.recipes?.[id]) id = `new_recipe_${++number}`;
    const firstItemId = Object.keys(gameplay.items || {})[0];
    if (!firstItemId) return;
    gameplay.recipes ||= {};
    gameplay.recipes[id] = { name: "새 조합법", stationId: activeStationId, ingredients: [{ itemId: firstItemId, quantity: 1 }], output: { itemId: firstItemId, quantity: 1 }, discoveredByDefault: true };
    activeRecipeId = id;
    markGameplayDirty(); renderStationList(); renderStationInspector(); showValidation();
}

function deleteRecipe() {
    if (!activeRecipeId || hasRecipeReferences(activeRecipeId)) return;
    delete gameplay.recipes[activeRecipeId];
    activeRecipeId = Object.entries(gameplay.recipes || {}).find(([, recipe]) => recipe.stationId === activeStationId)?.[0] || null;
    markGameplayDirty(); renderStationList(); renderStationInspector(); showValidation();
}

function setActiveTab(tab) {
    const workspaces = { story: storyWorkspace, world: worldWorkspace, monsters: monsterWorkspace, items: itemWorkspace, stations: stationWorkspace };
    for (const [name, workspace] of Object.entries(workspaces)) {
        workspace.hidden = name !== tab;
        document.querySelector(`[data-tab="${name}"]`).classList.toggle("active", name === tab);
    }
    $("#addNodeButton").hidden = tab !== "story";
}

function renderStoryMeta() {
    if (!story) return;
    $("#storyId").value = story.storyId || "";
    $("#storyVersion").value = String(story.version || "");
    const start = $("#storyStartNode");
    start.replaceChildren();
    for (const id of Object.keys(story.nodes)) {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = `${story.nodes[id].title || id} · ${id}`;
        start.append(option);
    }
    start.value = story.startNode || "";
    $("#storyMetaMessage").textContent = "";
    renderQuestTriggers();
}

function addTriggerSelect(card, questId, fieldName, labelText, options, selectedValue) {
    const label = document.createElement("label");
    label.textContent = labelText;
    const select = document.createElement("select");
    select.dataset.questId = questId;
    select.dataset.triggerField = fieldName;
    for (const [id, name] of Object.entries(options)) {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = `${name} · ${id}`;
        select.append(option);
    }
    select.value = selectedValue || "";
    label.append(select);
    card.append(label);
}

function formatTrigger(quest) {
    const objective = quest.objective;
    if (!objective) return "트리거 미설정";
    const location = gameplay.locations?.[objective.location]?.name || objective.location;
    const monster = gameplay.monsters?.[objective.monsterId]?.name || objective.monsterId;
    return `몬스터 처치 · ${location}에서 ${monster} ${objective.required || 1}회`;
}

function updateTriggerSummaries() {
    for (const summary of document.querySelectorAll("[data-trigger-summary]")) {
        const quest = gameplay.quests[summary.dataset.triggerSummary];
        summary.textContent = quest ? `연결된 게임 트리거: ${formatTrigger(quest)}` : "연결된 퀘스트 데이터가 없습니다.";
    }
}

function renderQuestTriggers() {
    if (!gameplay) return;
    questTriggerList.replaceChildren();
    for (const [questId, quest] of Object.entries(gameplay.quests || {})) {
        const card = document.createElement("section");
        card.className = "quest-trigger";
        const title = document.createElement("h4");
        title.textContent = `${quest.name || questId} · ${questId}`;
        const description = document.createElement("p");
        description.textContent = quest.description || "퀘스트 설명 없음";
        card.append(title, description);
        if (!quest.objective) {
            const unset = document.createElement("p");
            unset.textContent = "게임 이벤트 트리거가 설정되지 않았습니다.";
            const add = document.createElement("button");
            add.type = "button";
            add.textContent = "+ 몬스터 처치 목표";
            add.addEventListener("click", () => {
                quest.objective = {
                    type: "defeatMonster",
                    monsterId: Object.keys(gameplay.monsters || {})[0] || "",
                    location: Object.keys(gameplay.locations || {})[0] || "",
                    required: 1
                };
                markGameplayDirty();
                renderQuestTriggers();
                updateTriggerSummaries();
                showValidation();
            });
            card.append(unset, add);
        } else {
            const event = document.createElement("p");
            event.textContent = "이벤트: 몬스터 처치 · 퀘스트가 진행 중일 때만 적용";
            card.append(event);
            addTriggerSelect(card, questId, "location", "발생 장소", Object.fromEntries(Object.entries(gameplay.locations || {}).map(([id, value]) => [id, value.name || id])), quest.objective.location);
            addTriggerSelect(card, questId, "monsterId", "대상 몬스터", Object.fromEntries(Object.entries(gameplay.monsters || {}).map(([id, value]) => [id, value.name || id])), quest.objective.monsterId);
            const requiredLabel = document.createElement("label");
            requiredLabel.textContent = "필요 처치 횟수";
            const required = document.createElement("input");
            required.type = "number";
            required.min = "1";
            required.step = "1";
            required.value = String(quest.objective.required || 1);
            required.dataset.questId = questId;
            required.dataset.triggerField = "required";
            requiredLabel.append(required);
            card.append(requiredLabel);
            const summary = document.createElement("p");
            summary.className = "trigger-summary";
            summary.dataset.triggerSummary = questId;
            summary.textContent = formatTrigger(quest);
            card.append(summary);
        }
        questTriggerList.append(card);
    }
}

questTriggerList.addEventListener("change", (event) => {
    const field = event.target.closest("[data-trigger-field]");
    if (!field) return;
    const quest = gameplay.quests[field.dataset.questId];
    if (!quest) return;
    if (!quest.objective) quest.objective = { type: "defeatMonster", required: 1 };
    if (field.dataset.triggerField === "required") {
        quest.objective.required = Number(field.value);
    } else {
        quest.objective[field.dataset.triggerField] = field.value;
    }
    markGameplayDirty();
    updateTriggerSummaries();
    showValidation();
});

function applyStoryMeta(mark = true) {
    if (!story) return false;
    const version = Number($("#storyVersion").value);
    if (!Number.isInteger(version) || version < 1) {
        $("#storyMetaMessage").textContent = "버전은 1 이상의 정수여야 합니다.";
        return false;
    }
    story.storyId = $("#storyId").value.trim();
    story.version = version;
    story.startNode = $("#storyStartNode").value;
    $("#storyMetaMessage").textContent = "";
    if (mark) markDirty();
    renderGraph();
    return true;
}

function hasIncomingChoice(nodeId) {
    return Object.values(story.nodes).some((node) => (node.choices || []).some((choice) => choice.next === nodeId));
}

function selectNode(id) {
    activeNodeId = id;
    renderGraph();
    renderInspector();
}

function applyInspectorChanges(mark = true) {
    const node = story.nodes[activeNodeId];
    if (!node) return true;
    const messages = [];
    node.title = $("#nodeTitle").value;
    node.text = $("#nodeText").value;
    try {
        node.conditions = parseArray($("#nodeConditions").value, "장면 조건");
    } catch (error) {
        messages.push(error.message);
    }

    for (const card of choicesEditor.querySelectorAll(".choice-card")) {
        const choice = node.choices[Number(card.dataset.choiceIndex)];
        if (!choice) continue;
        for (const field of card.querySelectorAll("[data-choice-field]")) {
            const name = field.dataset.choiceField;
            if (name === "id" || name === "text") choice[name] = field.value;
            if (name === "next") choice.next = field.value || null;
            if (name === "conditions" || name === "effects") {
                try {
                    choice[name] = parseArray(field.value, `선택지 '${choice.id}' ${name === "conditions" ? "조건" : "효과"}`);
                } catch (error) {
                    messages.push(error.message);
                }
            }
        }
    }
    $("#editMessage").textContent = [...new Set(messages)].join(" · ");
    $("#inspectorTitle").textContent = node.title || "제목 없음";
    renderGraph();
    if (mark) markDirty();
    return messages.length === 0;
}

function addNode() {
    if (!story) return;
    let number = Object.keys(story.nodes).length + 1;
    let id = `scene_${number}`;
    while (story.nodes[id]) id = `scene_${++number}`;
    story.nodes[id] = { title: "새 장면", text: "", conditions: [], choices: [] };
    activeNodeId = id;
    markDirty();
    renderGraph();
    renderStoryMeta();
    renderInspector();
    showValidation();
}

function addChoice() {
    const node = story?.nodes[activeNodeId];
    if (!node) return;
    const ids = new Set(node.choices.map((choice) => choice.id));
    let number = node.choices.length + 1;
    let id = `choice_${number}`;
    while (ids.has(id)) id = `choice_${++number}`;
    node.choices.push({ id, text: "새 선택지", conditions: [], effects: [], next: activeNodeId });
    markDirty();
    renderInspector();
    renderGraph();
    showValidation();
}

function deleteNode() {
    if (!activeNodeId || activeNodeId === story.startNode || hasIncomingChoice(activeNodeId)) return;
    const id = activeNodeId;
    delete story.nodes[id];
    activeNodeId = story.startNode;
    markDirty();
    renderGraph();
    renderStoryMeta();
    renderInspector();
    showValidation();
}

function loadStory(data, fileName, handle = null) {
    if (!data || typeof data !== "object" || !data.nodes || typeof data.nodes !== "object") {
        throw new Error("스토리 JSON에 nodes 객체가 없습니다.");
    }
    story = data;
    currentFileName = fileName || "story.json";
    fileHandle = handle;
    dirty = false;
    activeNodeId = story.startNode && story.nodes[story.startNode] ? story.startNode : Object.keys(story.nodes)[0];
    updateFileLabel();
    renderStoryMeta();
    renderGraph();
    renderInspector();
    showValidation();
}

async function openStoryFile() {
    if (window.showOpenFilePicker) {
        try {
            const [handle] = await window.showOpenFilePicker({
                multiple: false,
                types: [{ description: "ARCANA 스토리 JSON", accept: { "application/json": [".json"] } }]
            });
            const file = await handle.getFile();
            const data = JSON.parse(await file.text());
            loadStory(data, file.name, handle);
            markDirty();
            showValidation();
            return;
        } catch (error) {
            if (error.name === "AbortError") return;
            setStatus(`파일을 열지 못했습니다: ${error.message}`, true);
            return;
        }
    }
    fileInput.click();
}

fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
        loadStory(JSON.parse(await file.text()), file.name);
        markDirty();
        showValidation();
    } catch (error) {
        setStatus(`파일을 열지 못했습니다: ${error.message}`, true);
    } finally {
        fileInput.value = "";
    }
});

async function saveStory() {
    if (!story) return;
    if (!applyInspectorChanges(false) || !applyStoryMeta(false)) {
        setStatus("입력 오류가 있습니다. 편집 중인 JSON과 스토리 설정을 확인하세요.", true);
        return;
    }
    if (!showValidation()) return;
    if (!dirty && !gameplayDirty && !contentNeedsPublish) {
        setStatus("저장할 변경 사항이 없습니다.");
        return;
    }
    try {
        contentRevision = await ArcanaGameContentStore.save(
            window.ARCANA_EDITOR_CLIENT,
            window.ARCANA_EDITOR_USER?.id,
            gameplay,
            story,
            contentRevision
        );
        contentNeedsPublish = false;
        dirty = false;
        gameplayDirty = false;
        updateFileLabel();
        setStatus("Supabase에 저장했습니다. 게임에 적용하려면 ARCANA 페이지를 새로고침하세요.");
    } catch (error) {
        setStatus(`Supabase에 저장하지 못했습니다: ${error.message}`, true);
    }
}

inspector.addEventListener("input", applyInspectorChanges);
inspector.addEventListener("change", applyInspectorChanges);
$("#addNodeButton").addEventListener("click", addNode);
$("#addChoiceButton").addEventListener("click", addChoice);
$("#deleteNodeButton").addEventListener("click", deleteNode);
$("#openButton").addEventListener("click", openStoryFile);
$("#saveButton").addEventListener("click", saveStory);
$("#validateButton").addEventListener("click", showValidation);
$("#storyId").addEventListener("input", applyStoryMeta);
$("#storyVersion").addEventListener("input", applyStoryMeta);
$("#storyStartNode").addEventListener("change", applyStoryMeta);
document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => setActiveTab(button.dataset.tab)));
$("#addLocationButton").addEventListener("click", addLocation);
$("#deleteLocationButton").addEventListener("click", deleteLocation);
$("#addMonsterButton").addEventListener("click", addMonster);
$("#deleteMonsterButton").addEventListener("click", deleteMonster);
$("#addMonsterDropButton").addEventListener("click", () => {
    const monster = gameplay?.monsters?.[activeMonsterId];
    if (!monster) return;
    const firstItemId = Object.keys(gameplay.items || {})[0];
    if (!firstItemId) return;
    monster.drops ||= [];
    monster.drops.push({ itemId: firstItemId, chance: 0.25, quantity: 1 });
    markGameplayDirty();
    renderMonsterDrops(monster);
    showValidation();
});
$("#addItemButton").addEventListener("click", addItem);
$("#deleteItemButton").addEventListener("click", deleteItem);
$("#addStationButton").addEventListener("click", addStation);
$("#deleteStationButton").addEventListener("click", deleteStation);
$("#addRecipeButton").addEventListener("click", addRecipe);
$("#deleteRecipeButton").addEventListener("click", deleteRecipe);
document.querySelectorAll("[data-preview-select]").forEach((button) => {
    button.addEventListener("click", () => previewAudioTrack($(`#${button.dataset.previewSelect}`).value));
});

window.addEventListener("beforeunload", (event) => {
    if (!dirty && !gameplayDirty) return;
    event.preventDefault();
    event.returnValue = "";
});

async function initializeEditor() {
    try {
        if (!window.ARCANA_EDITOR_AUTHORIZATION) throw new Error("편집자 계정 확인을 시작하지 못했습니다.");
        if (!await window.ARCANA_EDITOR_AUTHORIZATION) return;
        const [audioResponse, published] = await Promise.all([
            fetch("../game/audio-catalog.json", { cache: "no-store" }),
            ArcanaGameContentStore.read(window.ARCANA_EDITOR_CLIENT).catch((error) => ({ readError: error }))
        ]);
        if (!audioResponse.ok) throw new Error(`오디오 목록 요청 실패 (HTTP ${audioResponse.status})`);
        let storyData;
        const contentLoadError = published?.readError || null;
        if (published && !published.readError) {
            gameplay = published.gameplay;
            storyData = published.story;
            contentRevision = published.revision;
            contentNeedsPublish = false;
        } else {
            const [gameplayResponse, storyResponse] = await Promise.all([
                fetch("../content/data/gameplay.json", { cache: "no-store" }),
                fetch("../content/story/arrival.json", { cache: "no-store" })
            ]);
            if (!gameplayResponse.ok) throw new Error(`게임 데이터 요청 실패 (HTTP ${gameplayResponse.status})`);
            if (!storyResponse.ok) throw new Error(`스토리 요청 실패 (HTTP ${storyResponse.status})`);
            gameplay = await gameplayResponse.json();
            storyData = await storyResponse.json();
            contentRevision = 0;
            contentNeedsPublish = true;
        }
        audioTracks = (await audioResponse.json()).tracks || [];
        renderAudioSettings();
        activeLocationId = gameplay.locations?.village ? "village" : Object.keys(gameplay.locations || {})[0] || null;
        activeMonsterId = Object.keys(gameplay.monsters || {})[0] || null;
        activeItemId = Object.keys(gameplay.items || {})[0] || null;
        activeStationId = Object.keys(gameplay.stations || {})[0] || null;
        activeRecipeId = Object.entries(gameplay.recipes || {}).find(([, recipe]) => recipe.stationId === activeStationId)?.[0] || null;
        loadStory(storyData, "arrival.json");
        renderWorldGraph();
        renderLocationInspector();
        renderMonsterList();
        renderMonsterInspector();
        renderItemList();
        renderItemInspector();
        renderStationList();
        renderStationInspector();
        setActiveTab("story");
        updateFileLabel();
        if (contentLoadError) {
            setStatus(`Supabase 콘텐츠를 읽지 못했습니다. 기본 JSON으로 열었습니다. 테이블 마이그레이션과 권한을 확인하세요. (${contentLoadError.message})`, true);
        } else if (contentNeedsPublish) {
            setStatus("Supabase에 콘텐츠가 아직 없습니다. 기본 데이터를 확인한 뒤 저장을 눌러 Supabase에 최초 등록하세요.");
        }
    } catch (error) {
        $("#storyFileLabel").textContent = "파일 로드 실패";
        setStatus(`편집기를 불러오지 못했습니다: ${error.message} · 프로젝트 HTTP 서버에서 /editor/를 여세요.`, true);
    }
}

initializeEditor();
