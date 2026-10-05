(function (global) {
    "use strict";

    function createDefault(name, story, gameplay = {}) {
        const unlockedStations = Object.fromEntries(Object.entries(gameplay.stations || {}).filter(([, station]) => station.unlockedByDefault === true).map(([id]) => [id, true]));
        const discoveredRecipes = Object.fromEntries(Object.entries(gameplay.recipes || {}).filter(([, recipe]) => recipe.discoveredByDefault !== false).map(([id]) => [id, true]));
        return {
            schemaVersion: 1,
            name,
            level: 1,
            xp: 0,
            hp: 25,
            maxHp: 25,
            gold: 0,
            location: "village",
            inventory: {},
            equipment: {},
            gearDurability: {},
            combat: null,
            unlockedLocations: { village: true, forest: true, market: true, apothecary: true, weapon_shop: true },
            unlockedStations,
            discoveredRecipes,
            activeStation: null,
            stationIngredients: {},
            quests: {},
            questProgress: {},
            questSteps: {},
            flags: {},
            relations: {},
            story: { currentNode: story.startNode, contentVersion: story.version, history: [], appliedChoices: [] }
        };
    }

    function normalize(saved, name, story, gameplay = {}) {
        if (!saved || typeof saved !== "object" || Array.isArray(saved)) throw new Error("저장 데이터 형식이 올바르지 않습니다.");
        const defaults = createDefault(name, story, gameplay);
        const state = { ...defaults, ...saved, name: typeof saved.name === "string" ? saved.name : name };
        state.unlockedStations = { ...defaults.unlockedStations, ...(saved.unlockedStations || {}) };
        state.discoveredRecipes = { ...defaults.discoveredRecipes, ...(saved.discoveredRecipes || {}) };
        state.stationIngredients = saved.stationIngredients && typeof saved.stationIngredients === "object" && !Array.isArray(saved.stationIngredients) ? saved.stationIngredients : {};
        if (typeof state.activeStation !== "string" || !gameplay.stations?.[state.activeStation]) state.activeStation = null;
        for (const key of ["inventory", "equipment", "gearDurability", "unlockedLocations", "unlockedStations", "discoveredRecipes", "quests", "questProgress", "questSteps", "flags", "relations"]) {
            if (!state[key] || typeof state[key] !== "object" || Array.isArray(state[key])) throw new Error(`저장 데이터 '${key}' 형식이 올바르지 않습니다.`);
        }
        if (state.combat !== null && (!state.combat || typeof state.combat.monsterId !== "string" || !Number.isFinite(state.combat.hp) || state.combat.hp <= 0)) {
            throw new Error("저장된 전투 상태 형식이 올바르지 않습니다.");
        }
        if (!state.story || typeof state.story !== "object" || !Array.isArray(state.story.history) || !Array.isArray(state.story.appliedChoices)) {
            throw new Error("저장된 스토리 진행 데이터 형식이 올바르지 않습니다.");
        }
        if (state.story.contentVersion !== story.version) {
            if (state.story.currentNode && !story.nodes[state.story.currentNode]) {
                throw new Error(`저장된 장면 '${state.story.currentNode}'은 현재 스토리 버전에서 찾을 수 없습니다. 진행 데이터를 초기화하지 않았습니다.`);
            }
            state.story.contentVersion = story.version;
        }
        for (const key of ["level", "xp", "hp", "maxHp", "gold"]) {
            if (!Number.isFinite(state[key]) || state[key] < 0) throw new Error(`저장된 값 '${key}'이(가) 올바르지 않습니다.`);
        }
        if (!story.nodes[state.story.currentNode]) throw new Error(`저장된 장면 '${state.story.currentNode}'을(를) 찾을 수 없습니다.`);
        return state;
    }

    global.ArcanaGameState = { createDefault, normalize };
})(window);
