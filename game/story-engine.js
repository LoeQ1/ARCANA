(function (global) {
    "use strict";

    const CONDITION_TYPES = new Set(["flagEquals", "levelAtLeast", "hasItem", "questStatus", "locationIs", "stationUnlocked", "recipeKnown"]);
    const EFFECT_TYPES = new Set(["setFlag", "startQuest", "advanceQuest", "completeQuest", "grantItem", "removeItem", "grantXp", "grantGold", "unlockLocation", "unlockStation", "discoverRecipe", "changeRelation"]);

    function validate(story, gameplay) {
        const errors = [];
        if (!story || typeof story !== "object") return ["스토리 최상위 값은 객체여야 합니다."];
        if (!story.storyId || typeof story.storyId !== "string") errors.push("storyId가 필요합니다.");
        if (!Number.isInteger(story.version) || story.version < 1) errors.push("version은 1 이상의 정수여야 합니다.");
        if (!story.nodes || typeof story.nodes !== "object") return [...errors, "nodes 객체가 필요합니다."];
        if (!story.nodes[story.startNode]) errors.push(`시작 장면 '${story.startNode}'이(가) 없습니다.`);

        const reachable = new Set();
        const visit = (id) => {
            if (reachable.has(id) || !story.nodes[id]) return;
            reachable.add(id);
            const choices = Array.isArray(story.nodes[id].choices) ? story.nodes[id].choices : [];
            for (const choice of choices) if (choice && choice.next) visit(choice.next);
        };
        visit(story.startNode);

        for (const [nodeId, node] of Object.entries(story.nodes)) {
            if (!node || typeof node.title !== "string" || typeof node.text !== "string" || !Array.isArray(node.choices)) {
                errors.push(`장면 '${nodeId}'에 title, text, choices가 필요합니다.`);
                continue;
            }
            if (!reachable.has(nodeId)) errors.push(`장면 '${nodeId}'은 시작 장면에서 도달할 수 없습니다.`);
            validateRules(node.conditions || [], CONDITION_TYPES, `${nodeId}.conditions`, errors, gameplay);
            const choiceIds = new Set();
            for (const choice of node.choices) {
                if (!choice || typeof choice !== "object") {
                    errors.push(`장면 '${nodeId}'에 객체가 아닌 선택지가 있습니다.`);
                    continue;
                }
                if (!choice.id || choiceIds.has(choice.id)) errors.push(`장면 '${nodeId}'의 선택지 ID가 없거나 중복됩니다: '${choice.id || ""}'.`);
                choiceIds.add(choice.id);
                if (typeof choice.text !== "string" || !Array.isArray(choice.effects) || !Array.isArray(choice.conditions)) {
                    errors.push(`선택지 '${nodeId}.${choice.id}'에 text, conditions, effects가 필요합니다.`);
                    continue;
                }
                if (choice.next && !story.nodes[choice.next]) errors.push(`선택지 '${nodeId}.${choice.id}'의 다음 장면 '${choice.next}'이(가) 없습니다.`);
                validateRules(choice.conditions, CONDITION_TYPES, `${nodeId}.${choice.id}.conditions`, errors, gameplay);
                validateRules(choice.effects, EFFECT_TYPES, `${nodeId}.${choice.id}.effects`, errors, gameplay);
            }
        }
        return errors;
    }

    function validateRules(rules, allowed, path, errors, gameplay) {
        if (!Array.isArray(rules)) { errors.push(`${path}는 배열이어야 합니다.`); return; }
        const fields = {
            flagEquals: ["key", "value"], levelAtLeast: ["value"], hasItem: ["itemId"],
            questStatus: ["questId", "status"], locationIs: ["location"], setFlag: ["key", "value"],
            startQuest: ["questId"], advanceQuest: ["questId", "step"], completeQuest: ["questId"],
            grantItem: ["itemId", "quantity"], removeItem: ["itemId", "quantity"], grantXp: ["amount"],
            grantGold: ["amount"], unlockLocation: ["location"], unlockStation: ["stationId"], discoverRecipe: ["recipeId"],
            stationUnlocked: ["stationId"], recipeKnown: ["recipeId"], changeRelation: ["npcId", "amount"]
        };
        for (const rule of rules) {
            if (!rule || !allowed.has(rule.type)) {
                errors.push(`${path}에 알 수 없는 규칙이 있습니다: '${rule?.type || ""}'.`);
                continue;
            }
            for (const field of fields[rule.type]) if (!(field in rule)) errors.push(`${path}의 ${rule.type} 규칙에 '${field}'가 필요합니다.`);
            for (const field of ["quantity", "amount"]) {
                if (field in rule && (!Number.isInteger(rule[field]) || rule[field] < 0)) errors.push(`${path}의 ${field} 값은 0 이상의 정수여야 합니다.`);
            }
            if (gameplay) {
                const references = {
                    hasItem: ["items", "itemId"], grantItem: ["items", "itemId"], removeItem: ["items", "itemId"],
                    questStatus: ["quests", "questId"], startQuest: ["quests", "questId"],
                    advanceQuest: ["quests", "questId"], completeQuest: ["quests", "questId"],
                    locationIs: ["locations", "location"], unlockLocation: ["locations", "location"],
                    stationUnlocked: ["stations", "stationId"], unlockStation: ["stations", "stationId"],
                    recipeKnown: ["recipes", "recipeId"], discoverRecipe: ["recipes", "recipeId"]
                }[rule.type];
                if (references && rule[references[1]] && !gameplay[references[0]]?.[rule[references[1]]]) {
                    errors.push(`${path}에서 게임 데이터 '${rule[references[1]]}'을(를) 찾을 수 없습니다.`);
                }
            }
        }
    }

    function hasItem(state, itemId, quantity = 1) {
        return (state.inventory[itemId] || 0) >= quantity;
    }

    function testCondition(condition, state) {
        switch (condition.type) {
            case "flagEquals": return state.flags[condition.key] === condition.value;
            case "levelAtLeast": return state.level >= condition.value;
            case "hasItem": return hasItem(state, condition.itemId, condition.quantity || 1);
            case "questStatus": return state.quests[condition.questId] === condition.status;
            case "locationIs": return state.location === condition.location;
            case "stationUnlocked": return state.unlockedStations?.[condition.stationId] === true;
            case "recipeKnown": return state.discoveredRecipes?.[condition.recipeId] === true;
            default: throw new Error(`지원하지 않는 조건: ${condition.type}`);
        }
    }

    function conditionsMet(conditions, state) {
        return conditions.every((condition) => testCondition(condition, state));
    }

    function getCurrentNode(story, state) {
        const id = state.story.currentNode || story.startNode;
        const node = story.nodes[id];
        if (!node) throw new Error(`현재 장면 '${id}'을(를) 찾을 수 없습니다.`);
        if (!conditionsMet(node.conditions || [], state)) throw new Error(`현재 장면 '${id}'의 표시 조건을 만족하지 않습니다.`);
        return node;
    }

    function choose(story, state, choiceId) {
        const node = getCurrentNode(story, state);
        const choice = node.choices.find((candidate) => candidate.id === choiceId);
        if (!choice) throw new Error("현재 장면에서 선택할 수 없는 항목입니다.");
        if (!conditionsMet(choice.conditions, state)) throw new Error(choice.unavailableMessage || "아직 선택할 수 없습니다.");
        const eventId = `${story.storyId}:${node.id || state.story.currentNode}:${choice.id}`;
        if (!state.story.appliedChoices.includes(eventId)) {
            for (const effect of choice.effects) applyEffect(effect, state);
            state.story.appliedChoices.push(eventId);
        }
        state.story.history.push({ nodeId: state.story.currentNode || story.startNode, choiceId: choice.id, next: choice.next || null, at: new Date().toISOString() });
        state.story.currentNode = choice.next || null;
        state.story.contentVersion = story.version;
        return choice;
    }

    function applyEffect(effect, state) {
        switch (effect.type) {
            case "setFlag": state.flags[effect.key] = effect.value; break;
            case "startQuest": if (!state.quests[effect.questId]) state.quests[effect.questId] = "active"; break;
            case "advanceQuest": if (state.quests[effect.questId] === "active") state.questSteps[effect.questId] = effect.step; break;
            case "completeQuest": state.quests[effect.questId] = "complete"; break;
            case "grantItem": state.inventory[effect.itemId] = (state.inventory[effect.itemId] || 0) + effect.quantity; break;
            case "removeItem":
                if (!hasItem(state, effect.itemId, effect.quantity)) throw new Error(`아이템이 부족합니다: ${effect.itemId}`);
                state.inventory[effect.itemId] -= effect.quantity;
                break;
            case "grantXp":
                if (global.ArcanaGameplayEngine) global.ArcanaGameplayEngine.grantXp(state, effect.amount);
                else {
                    state.xp += effect.amount;
                    while (state.xp >= state.level * 20) { state.xp -= state.level * 20; state.level += 1; state.maxHp += 5; state.hp = state.maxHp; }
                }
                break;
            case "grantGold": state.gold += effect.amount; break;
            case "unlockLocation": state.unlockedLocations[effect.location] = true; break;
            case "unlockStation": state.unlockedStations[effect.stationId] = true; break;
            case "discoverRecipe": state.discoveredRecipes[effect.recipeId] = true; break;
            case "changeRelation": state.relations[effect.npcId] = (state.relations[effect.npcId] || 0) + effect.amount; break;
            default: throw new Error(`지원하지 않는 효과: ${effect.type}`);
        }
    }

    global.ArcanaStoryEngine = { validate, conditionsMet, getCurrentNode, choose };
})(window);
