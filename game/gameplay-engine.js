(function (global) {
    "use strict";

    function awardXp(state, amount) {
        state.xp += amount;
        const levels = [];
        while (state.xp >= state.level * 20) {
            state.xp -= state.level * 20;
            state.level += 1;
            state.maxHp += 5;
            state.hp = state.maxHp;
            levels.push(state.level);
        }
        return levels;
    }

    function grantXp(state, amount) { return awardXp(state, amount); }

    function findItem(data, rawItemId) {
        const normalize = (value) => String(value).trim().toLowerCase().replace(/\s+/g, "");
        const query = normalize(rawItemId);
        return Object.entries(data.items || {}).find(([id, item]) =>
            normalize(id) === query || normalize(item.name || "") === query
            || (Array.isArray(item.aliases) && item.aliases.some((alias) => normalize(alias) === query))
        );
    }

    function findStation(data, rawStationId) {
        const normalize = (value) => String(value).trim().toLowerCase().replace(/\s+/g, "");
        const query = normalize(rawStationId);
        return Object.entries(data.stations || {}).find(([id, station]) =>
            normalize(id) === query || normalize(station.name || "") === query
            || (Array.isArray(station.aliases) && station.aliases.some((alias) => normalize(alias) === query))
        );
    }

    function isStationUnlocked(state, stationId, station) {
        return station.unlockedByDefault === true || state.unlockedStations?.[stationId] === true;
    }

    function enterStation(data, state, rawStationId) {
        if (state.combat) return { messages: ["전투 중에는 장치를 사용할 수 없습니다."], changed: false };
        const found = findStation(data, rawStationId);
        if (!found) return { messages: [`알 수 없는 장치입니다: ${rawStationId}`], changed: false };
        const [stationId, station] = found;
        if (station.location && station.location !== state.location) {
            const locationName = data.locations?.[station.location]?.name || station.location;
            return { messages: [`${station.name}은(는) ${locationName}에서만 사용할 수 있습니다.`], changed: false };
        }
        state.unlockedStations ||= {};
        const messages = [];
        if (!isStationUnlocked(state, stationId, station)) {
            const keyId = station.activationItemId;
            if (!keyId || !(state.inventory[keyId] > 0)) {
                return { messages: [`${station.name}은(는) 아직 잠겨 있습니다.`], changed: false };
            }
            state.inventory[keyId] -= 1;
            state.unlockedStations[stationId] = true;
            messages.push(station.activationText || `${station.name}이(가) 열렸습니다.`);
            const reward = station.openingReward;
            if (reward && data.items?.[reward.itemId]) {
                const quantity = Number.isInteger(reward.quantity) && reward.quantity > 0 ? reward.quantity : 1;
                for (let count = 0; count < quantity; count++) addItemToInventory(state, reward.itemId, data.items[reward.itemId]);
                messages.push(`${data.items[reward.itemId].name} x${quantity}을(를) 꺼냈습니다.`);
            }
        }
        state.activeStation = stationId;
        const entryText = station.enterText || `${station.name}의 안쪽 공간이 열립니다.`;
        messages.push(entryText.replace(/필요한 개수만큼 반복하면 조합됩니다\.?/g, "필요한 개수만큼 반복해 담은 뒤 '조합'을 입력하세요."));
        messages.push("재료는 자동 조합되지 않습니다. '넣기 <아이템>'으로 하나씩 담은 뒤 '조합'을 입력하세요. 잘못 넣은 재료는 '빼기 <아이템>'으로 돌려놓을 수 있습니다.");
        const stored = state.stationIngredients?.[stationId] || [];
        if (stored.length) messages.push(`장치에 넣어 둔 재료: ${describeStationIngredients(data, stored)}`);
        return { messages, changed: true };
    }

    function leaveStation(data, state) {
        const station = data.stations?.[state.activeStation];
        state.activeStation = null;
        return { messages: [station?.exitText || "장치에서 물러났습니다."], changed: true };
    }

    function ingredientCounts(ingredients) {
        return ingredients.reduce((counts, entry) => {
            const itemId = typeof entry === "string" ? entry : entry.itemId;
            if (itemId) counts[itemId] = (counts[itemId] || 0) + 1;
            return counts;
        }, {});
    }

    function describeStationIngredients(data, ingredients) {
        const counts = ingredientCounts(ingredients);
        return Object.entries(counts).map(([itemId, quantity]) => `${data.items?.[itemId]?.name || itemId} x${quantity}`).join(", ");
    }

    function listStationRecipes(data, state, rawStationId = state.activeStation) {
        const found = findStation(data, rawStationId || "");
        if (!found) return { messages: ["장치 정보를 찾을 수 없습니다."], changed: false };
        const [stationId, station] = found;
        if (!isStationUnlocked(state, stationId, station)) return { messages: [`${station.name}은(는) 아직 잠겨 있습니다.`], changed: false };
        const recipes = Object.entries(data.recipes || {}).filter(([id, recipe]) => recipe.stationId === stationId && (recipe.discoveredByDefault !== false || state.discoveredRecipes?.[id] === true));
        const lines = recipes.map(([id, recipe], index) => {
            const ingredients = (recipe.ingredients || []).flatMap((entry) => Array.from({ length: entry.quantity }, () => data.items?.[entry.itemId]?.name || entry.itemId)).join(" + ");
            const output = recipe.outcomes?.length > 1 ? "결과 미상" : `${data.items?.[(recipe.output || recipe.outcomes?.[0])?.itemId]?.name || "결과 미상"}`;
            return `${index + 1}. ${recipe.name || id}: ${ingredients} → ${output}`;
        });
        const staged = state.stationIngredients?.[stationId] || [];
        const stagedMessage = staged.length ? `현재 장치 안: ${describeStationIngredients(data, staged)}` : "현재 장치 안: 비어 있음";
        return {
            messages: [`[${station.name} 조합법]`, ...(lines.length ? lines : ["아직 알려진 조합법이 없습니다. 재료를 넣고 직접 조합해 볼 수 있습니다."]), stagedMessage, "재료는 '넣기 아이템명'으로 하나씩 담으세요. '조합'을 입력해야 판정하며, 실패하면 장치 안 재료가 사라집니다."],
            changed: false
        };
    }

    function submitStationIngredients(data, state, offerings) {
        const stationId = state.activeStation;
        const station = data.stations?.[stationId];
        if (!station || !isStationUnlocked(state, stationId, station)) return { messages: ["사용 중인 장치가 없습니다."], changed: false };
        if (!Array.isArray(offerings) || offerings.length !== 1) return { messages: ["재료는 '넣기 <아이템>' 형식으로 한 번에 하나씩 넣어 주세요."], changed: false };
        const entry = offerings[0];
        const foundItem = findItem(data, entry.name);
        if (!foundItem) return { messages: [`아이템을 찾을 수 없습니다: ${entry.name}`], changed: false };
        const itemId = foundItem[0];
        if ((state.inventory[itemId] || 0) < 1) return { messages: [`${data.items[itemId].name}이(가) 없습니다.`], changed: false };

        state.stationIngredients ||= {};
        const staged = state.stationIngredients[stationId] ||= [];
        const item = data.items[itemId];
        const durability = removeItemFromInventory(state, itemId, item);
        staged.push({ itemId, durability });
        return { messages: [`${item.name}을(를) 장치에 넣었습니다. 현재 재료: ${describeStationIngredients(data, staged)}. 조합하려면 '조합'을 입력하세요.`], changed: true };
    }

    function removeStationIngredient(data, state, rawItemName) {
        const stationId = state.activeStation;
        const station = data.stations?.[stationId];
        if (!station || !isStationUnlocked(state, stationId, station)) return { messages: ["사용 중인 장치가 없습니다."], changed: false };
        const found = findItem(data, rawItemName);
        if (!found) return { messages: [`아이템을 찾을 수 없습니다: ${rawItemName}`], changed: false };
        const [itemId, item] = found;
        const staged = state.stationIngredients?.[stationId] || [];
        const index = staged.findIndex((entry) => (typeof entry === "string" ? entry : entry.itemId) === itemId);
        if (index < 0) return { messages: [`장치 안에 ${item.name}이(가) 없습니다.`], changed: false };
        const [removed] = staged.splice(index, 1);
        const durability = typeof removed === "string" ? item.durability || 0 : removed.durability;
        addItemToInventory(state, itemId, item, durability);
        if (!staged.length) delete state.stationIngredients[stationId];
        const remaining = staged.length ? ` 남은 재료: ${describeStationIngredients(data, staged)}.` : " 장치 안이 비었습니다.";
        return { messages: [`${item.name}을(를) 소지품으로 돌려놓았습니다.${remaining}`], changed: true };
    }

    function combineStationIngredients(data, state, random = Math.random) {
        const stationId = state.activeStation;
        const station = data.stations?.[stationId];
        if (!station || !isStationUnlocked(state, stationId, station)) return { messages: ["사용 중인 장치가 없습니다."], changed: false };
        const staged = state.stationIngredients?.[stationId] || [];
        if (!staged.length) return { messages: ["조합할 재료가 없습니다. 먼저 '넣기 <아이템>'으로 재료를 담으세요."], changed: false };
        const stagedCounts = ingredientCounts(staged);
        const recipeEntry = Object.entries(data.recipes || {}).find(([id, recipe]) => {
            if (recipe.stationId !== stationId) return false;
            if (recipe.discoveredByDefault === false && state.discoveredRecipes?.[id] !== true) return false;
            const required = {};
            for (const ingredient of recipe.ingredients || []) required[ingredient.itemId] = (required[ingredient.itemId] || 0) + ingredient.quantity;
            return Object.keys(required).length === Object.keys(stagedCounts).length && Object.entries(required).every(([id, quantity]) => stagedCounts[id] === quantity);
        });
        if (!recipeEntry) {
            delete state.stationIngredients[stationId];
            return { messages: [station.failureText || "재료가 빛을 내다 흩어졌습니다. 조합은 실패했고, 넣은 재료가 사라졌습니다."], changed: true };
        }

        const [recipeId, recipe] = recipeEntry;
        const preserved = staged.find((ingredient) => {
            const itemId = typeof ingredient === "string" ? ingredient : ingredient.itemId;
            return data.items[itemId]?.equipmentSlot;
        });
        const preservedItemId = preserved ? (typeof preserved === "string" ? preserved : preserved.itemId) : null;
        const preservedDurability = preserved ? {
            slot: data.items[preservedItemId].equipmentSlot,
            durability: typeof preserved === "string" ? data.items[preservedItemId].durability || 0 : preserved.durability
        } : null;
        delete state.stationIngredients[stationId];
        let output = recipe.output;
        if (Array.isArray(recipe.outcomes) && recipe.outcomes.length) {
            const totalWeight = recipe.outcomes.reduce((sum, outcome) => sum + (Number.isFinite(outcome.weight) && outcome.weight > 0 ? outcome.weight : 0), 0);
            let roll = random() * totalWeight;
            output = recipe.outcomes.find((outcome) => {
                roll -= Number.isFinite(outcome.weight) && outcome.weight > 0 ? outcome.weight : 0;
                return roll < 0;
            }) || recipe.outcomes[recipe.outcomes.length - 1];
        }
        const outputItem = data.items?.[output?.itemId];
        if (!outputItem) return { messages: [`레시피 '${recipeId}'의 결과 아이템 데이터가 없습니다. 재료는 소모되었습니다.`], changed: true };
        const quantity = Number.isInteger(output.quantity) && output.quantity > 0 ? output.quantity : 1;
        let transfer = preservedDurability;
        if (transfer && transfer.slot !== outputItem.equipmentSlot) transfer = null;
        for (let count = 0; count < quantity; count++) {
            const durability = count === 0 && transfer ? transfer.durability : outputItem.durability || 0;
            addItemToInventory(state, output.itemId, outputItem, durability);
        }
        const success = recipe.successText || `${outputItem.name} x${quantity}을(를) 만들었습니다.`;
        return { messages: [success], changed: true, recipeId, outputItemId: output.itemId };
    }

    function addItemToInventory(state, itemId, item, durability = item.durability || 0) {
        state.inventory[itemId] = (state.inventory[itemId] || 0) + 1;
        if (!item.equipmentSlot) return;
        state.gearDurability ||= {};
        state.gearDurability[itemId] ||= [];
        state.gearDurability[itemId].push(durability);
    }

    function removeItemFromInventory(state, itemId, item) {
        if (!(state.inventory[itemId] > 0)) return null;
        state.inventory[itemId] -= 1;
        let durability = item.durability || 0;
        if (item.equipmentSlot) {
            state.gearDurability ||= {};
            state.gearDurability[itemId] ||= [];
            while (state.gearDurability[itemId].length < state.inventory[itemId] + 1) {
                state.gearDurability[itemId].push(durability);
            }
            durability = state.gearDurability[itemId].shift() ?? durability;
        }
        return durability;
    }

    function resolveEquippedItem(data, state, slot) {
        const equipped = state.equipment?.[slot];
        if (!equipped) return null;
        const itemId = typeof equipped === "string" ? equipped : equipped.itemId;
        const item = data.items[itemId];
        return item ? { itemId, item, durability: typeof equipped === "string" ? item.durability || 0 : equipped.durability || 0 } : null;
    }

    function wearEquippedItem(state, slot, gear, messages, phrase) {
        if (!gear || gear.item.durability <= 0) return;
        gear.durability = Math.max(0, gear.durability - 1);
        if (gear.durability === 0) {
            state.equipment[slot] = null;
            messages.push(`${gear.item.name}의 내구도가 다해 부서졌습니다.`);
        } else {
            state.equipment[slot] = { itemId: gear.itemId, durability: gear.durability };
            if (phrase) messages.push(`${gear.item.name} 내구도 ${gear.durability}/${gear.item.durability}`);
        }
    }

    function recordQuestObjectiveProgress(data, state, monsterId) {
        const messages = [];
        state.questProgress = state.questProgress || {};
        for (const [questId, quest] of Object.entries(data.quests || {})) {
            const objective = quest.objective;
            if (state.quests[questId] !== "active" || objective?.type !== "defeatMonster") continue;
            if (objective.monsterId !== monsterId || objective.location !== state.location) continue;

            const required = objective.required || 1;
            const progress = Math.min(required, (state.questProgress[questId] || 0) + 1);
            state.questProgress[questId] = progress;
            const monsterName = data.monsters[monsterId]?.name || monsterId;
            const locationName = data.locations[state.location]?.name || state.location;
            messages.push(`퀘스트 진행: ${quest.name} — ${locationName}에서 ${monsterName} 처치 (${progress}/${required})`);
            if (progress >= required) {
                state.quests[questId] = "complete";
                messages.push(`퀘스트 완료: ${quest.name}. ${quest.description}`);
            }
        }
        return messages;
    }

    function explore(data, state, random = Math.random) {
        if (state.combat) return { messages: ["전투 중입니다. '공격', '방어' 또는 '도망'을 입력하세요."], changed: false };
        const location = data.locations[state.location];
        if (!location?.explorable) return { messages: ["이곳에서는 탐험할 수 없습니다."], changed: false };
        if (location.monsterId && random() < (location.encounterChance || 0)) {
            const monster = data.monsters[location.monsterId];
            if (!monster) return { messages: ["이 지역의 조우 몬스터 데이터가 없습니다."], changed: false };
            state.combat = { monsterId: location.monsterId, hp: monster.hp, enemyTurnCount: 0, enemyIntent: null };
            return { messages: [`${location.name}에서 ${monster.name}이(가) 나타났습니다! 체력 ${monster.hp}. '공격', '방어' 또는 '도망'을 선택하세요.`], changed: true };
        }
        const resourceItemId = location.resourceItemId || (state.location === "forest" ? "forest_herb" : null);
        const resourceDropChance = location.resourceDropChance ?? 0.5;
        const found = Boolean(resourceItemId) && random() < resourceDropChance;
        if (found && resourceItemId && data.items[resourceItemId]) {
            addItemToInventory(state, resourceItemId, data.items[resourceItemId]);
            return { messages: [`${location.name}에서 ${data.items[resourceItemId].name}을(를) 찾았습니다. (${data.items[resourceItemId].name} x1)`], changed: true };
        }
        const gold = 2 + Math.floor(random() * 4);
        state.gold += gold;
        return { messages: [`${location.name}을(를) 탐험하고 ${gold} 골드를 발견했습니다.`], changed: true };
    }

    function finishPlayerDefeat(state, messages) {
        const lostGold = Math.floor(state.gold * 0.1);
        state.gold -= lostGold;
        state.hp = Math.max(1, Math.ceil(state.maxHp / 2));
        state.location = "village";
        state.combat = null;
        messages.push(`쓰러져 마을 여관에서 깨어났습니다. 골드 ${lostGold}을(를) 잃었고 체력이 ${state.hp}까지 회복되었습니다.`);
    }

    function enemyTurn(data, state, defending = false) {
        if (!state.combat) return { messages: [], events: [], changed: false };
        const combat = state.combat;
        const monster = data.monsters[combat.monsterId];
        if (!monster) throw new Error(`몬스터 데이터 '${combat.monsterId}'가 없습니다.`);
        const heavy = combat.enemyIntent === "heavy" && Number.isInteger(monster.heavyAttackDamage) && monster.heavyAttackDamage > 0;
        const incoming = heavy ? monster.heavyAttackDamage : monster.attack;
        const armor = resolveEquippedItem(data, state, "armor");
        const weapon = resolveEquippedItem(data, state, "weapon");
        const guardedDamage = Math.ceil(incoming * (defending ? (heavy ? 0.25 : 0.5) : 1));
        const armorUsable = armor && (armor.item.durability <= 0 || armor.durability > 0);
        const weaponUsable = weapon && (weapon.item.durability <= 0 || weapon.durability > 0);
        const defense = (armorUsable ? armor.item.defense || 0 : 0) + (weaponUsable ? weapon.item.defense || 0 : 0);
        const damage = Math.max(0, guardedDamage - defense);
        const messages = [];
        if (defending) messages.push("[플레이어 방어] 방어 태세를 취했습니다.");
        state.hp = Math.max(0, state.hp - damage);
        messages.push(heavy
            ? `[몬스터 강공격] ${monster.name}의 강공격! ${damage} 피해를 받았습니다${defending ? " (방어로 피해 감소)" : ""}. (체력 ${state.hp}/${state.maxHp})`
            : `[몬스터 공격] ${monster.name}의 공격으로 ${damage} 피해를 받았습니다${defending ? " (방어로 피해 감소)" : ""}. (체력 ${state.hp}/${state.maxHp})`);
        const events = [heavy ? "enemyHeavyAttack" : "enemyAttack"];
        wearEquippedItem(state, "armor", armor, messages, "");
        if (weapon?.item.defense > 0) wearEquippedItem(state, "weapon", weapon, messages, "");
        combat.enemyIntent = null;
        combat.enemyTurnCount = (combat.enemyTurnCount || 0) + 1;
        if (state.hp === 0) {
            finishPlayerDefeat(state, messages);
            return { messages, events, changed: true };
        }

        const every = monster.heavyAttackEvery;
        if (!heavy && Number.isInteger(monster.heavyAttackDamage) && monster.heavyAttackDamage > 0
            && Number.isInteger(every) && every >= 2 && combat.enemyTurnCount % every === every - 1) {
            combat.enemyIntent = "heavy";
            messages.push(monster.heavyAttackTell || `${monster.name}이(가) 강한 공격을 준비합니다. 다음 공격 전에 '방어'를 선택하면 피해를 줄일 수 있습니다.`);
        }
        return { messages, events, changed: true };
    }

    function attack(data, state, random = Math.random) {
        if (!state.combat) return { messages: ["싸울 상대가 없습니다. 숲에서 '탐험'하세요."], changed: false };
        const monster = data.monsters[state.combat.monsterId];
        if (!monster) throw new Error(`몬스터 데이터 '${state.combat.monsterId}'가 없습니다.`);
        const defeatedMonsterId = state.combat.monsterId;
        const weapon = resolveEquippedItem(data, state, "weapon");
        const weaponAttack = weapon && (weapon.item.durability <= 0 || weapon.durability > 0) ? weapon.item.attack || 0 : 0;
        const armor = resolveEquippedItem(data, state, "armor");
        const armorAttack = armor && (armor.item.durability <= 0 || armor.durability > 0) ? armor.item.attack || 0 : 0;
        const weaponElemental = weapon && (weapon.item.durability <= 0 || weapon.durability > 0) ? weapon.item.elementalAttack || 0 : 0;
        const armorElemental = armor && (armor.item.durability <= 0 || armor.durability > 0) ? armor.item.elementalAttack || 0 : 0;
        const elementalAttack = weaponElemental + armorElemental;
        const damage = 4 + Math.floor((state.level - 1) / 3) + weaponAttack + armorAttack + elementalAttack;
        state.combat.hp = Math.max(0, state.combat.hp - damage);
        const elementName = weapon?.item.elementalAttack ? weapon.item.element : armor?.item.element;
        const elementNote = elementalAttack ? ` (${elementName || "속성"} 공격력 +${elementalAttack} 포함)` : "";
        const messages = [`[플레이어 공격] ${monster.name}에게 ${damage} 피해를 입혔습니다${elementNote}. (${state.combat.hp}/${monster.hp})`];
        const events = ["playerAttack"];
        wearEquippedItem(state, "weapon", weapon, messages, "");
        if (armor?.item.attack > 0) wearEquippedItem(state, "armor", armor, messages, "");
        if (state.combat.hp === 0) {
            state.combat = null;
            state.gold += monster.gold;
            const gainedLevels = awardXp(state, monster.xp);
            messages.push(`${monster.name}을(를) 물리쳤습니다. 경험치 ${monster.xp}, 골드 ${monster.gold}을(를) 얻었습니다.`);
            for (const drop of monster.drops || []) {
                if (!data.items?.[drop.itemId] || random() >= (drop.chance ?? 0)) continue;
                const quantity = Number.isInteger(drop.quantity) && drop.quantity > 0 ? drop.quantity : 1;
                for (let count = 0; count < quantity; count++) addItemToInventory(state, drop.itemId, data.items[drop.itemId]);
                messages.push(`[아이템 드롭] ${data.items[drop.itemId].name} x${quantity}을(를) 얻었습니다.`);
            }
            messages.push(...recordQuestObjectiveProgress(data, state, defeatedMonsterId));
            if (gainedLevels.length) messages.push(`레벨 업! 레벨 ${gainedLevels.join(", ")}. 체력이 회복되었습니다.`);
            return { messages, events, changed: true };
        }
        const response = enemyTurn(data, state);
        messages.push(...response.messages);
        events.push(...response.events);
        return { messages, events, changed: true };
    }

    function defend(data, state) {
        if (!state.combat) return { messages: ["방어할 전투가 없습니다."], changed: false };
        return enemyTurn(data, state, true);
    }

    function flee(state) {
        if (!state.combat) return { messages: ["도망칠 전투가 없습니다."], changed: false };
        state.combat = null;
        state.location = "village";
        return { messages: ["전투를 피해 마을로 돌아왔습니다."], changed: true };
    }

    function useItem(data, state, rawItemId) {
        const aliases = { "물약": "healing_potion", "회복 물약": "healing_potion", "약초": "forest_herb", "숲 약초": "forest_herb" };
        const found = findItem(data, aliases[rawItemId] || rawItemId);
        const itemId = found?.[0];
        const item = found?.[1];
        if (!item) return { messages: [`알 수 없는 아이템입니다: ${rawItemId}`], changed: false };
        if (!(state.inventory[itemId] > 0)) return { messages: [`${item.name}을(를) 가지고 있지 않습니다.`], changed: false };
        if (item.type !== "consumable") return { messages: [`${item.name}은(는) 지금 사용할 수 없습니다.`], changed: false };
        if (item.heal && state.hp >= state.maxHp) return { messages: ["체력이 가득 차 있습니다."], changed: false };
        state.inventory[itemId] -= 1;
        if (item.heal) {
            const healed = Math.min(item.heal, state.maxHp - state.hp);
            state.hp += healed;
            return { messages: [`${item.name}을(를) 사용해 체력을 ${healed} 회복했습니다. (${state.hp}/${state.maxHp})`], changed: true };
        }
        return { messages: [`${item.name}을(를) 사용했습니다.`], changed: true };
    }

    function buyItem(data, state, rawItemId) {
        const found = findItem(data, rawItemId);
        const itemId = found?.[0];
        const item = found?.[1];
        const location = data.locations[state.location];
        if (!location?.shopItems?.length) return { messages: ["이곳에는 거래할 상점이 없습니다."], changed: false };
        if (!item || !location.shopItems.includes(itemId) || !Number.isInteger(item.price) || item.price < 0) return { messages: [`${location.name}에서 '${rawItemId}' 상품을 찾을 수 없습니다.`], changed: false };
        if (state.gold < item.price) return { messages: [`${item.name} 가격은 ${item.price} 골드입니다. 골드가 부족합니다.`], changed: false };
        state.gold -= item.price;
        addItemToInventory(state, itemId, item);
        return { messages: [`${item.name}을(를) ${item.price} 골드에 구입했습니다.${item.equipmentSlot ? ` 내구도 ${item.durability || "무한"}. '장착 ${item.name}'으로 장착할 수 있습니다.` : ""}`], changed: true };
    }

    function listShopItems(data, state) {
        const location = data.locations[state.location];
        if (!location?.shopItems?.length) return { messages: ["이곳에는 거래할 상점이 없습니다."], changed: false };
        const entries = location.shopItems.map((id) => {
            const item = data.items[id];
            return item ? `${item.name} (${item.price ?? "구매 불가"} 골드)` : null;
        }).filter(Boolean);
        return { messages: entries.length ? [`[${location.name} 상품] ${entries.join(" · ")}`, "구매 <아이템> 또는 판매 <아이템>을 입력하세요."] : ["현재 진열된 상품이 없습니다."], changed: false };
    }

    function sellItem(data, state, rawItemId) {
        const found = findItem(data, rawItemId);
        const itemId = found?.[0];
        const item = found?.[1];
        const location = data.locations[state.location];
        if (!location?.shopItems?.length) return { messages: ["이곳에는 거래할 상점이 없습니다."], changed: false };
        if (!item || !location.shopItems.includes(itemId) || !Number.isInteger(item.price)) return { messages: [`${location.name}에서는 '${rawItemId}'을(를) 거래하지 않습니다.`], changed: false };
        if (!(state.inventory[itemId] > 0)) return { messages: [`${item.name}을(를) 가지고 있지 않습니다.`], changed: false };
        const sellPrice = Number.isInteger(item.sellPrice) ? item.sellPrice : Math.floor(item.price / 2);
        if (sellPrice <= 0) return { messages: [`${item.name}은(는) 판매할 수 없습니다.`], changed: false };
        removeItemFromInventory(state, itemId, item);
        state.gold += sellPrice;
        return { messages: [`${item.name}을(를) ${sellPrice} 골드에 판매했습니다.`], changed: true };
    }

    function equipItem(data, state, rawItemId) {
        const found = findItem(data, rawItemId);
        const itemId = found?.[0];
        const item = found?.[1];
        if (!item?.equipmentSlot || !["weapon", "armor"].includes(item.equipmentSlot)) return { messages: [`'${rawItemId}'은(는) 장착할 수 있는 장비가 아닙니다.`], changed: false };
        if (!(state.inventory[itemId] > 0)) return { messages: [`${item.name}을(를) 가지고 있지 않습니다.`], changed: false };
        state.equipment ||= {};
        const previous = resolveEquippedItem(data, state, item.equipmentSlot);
        if (previous) addItemToInventory(state, previous.itemId, previous.item, previous.durability);
        const durability = removeItemFromInventory(state, itemId, item);
        state.equipment[item.equipmentSlot] = { itemId, durability };
        return { messages: [`${item.name}을(를) ${item.equipmentSlot === "weapon" ? "무기" : "방어구"}로 장착했습니다.${item.durability > 0 ? ` 내구도 ${durability}/${item.durability}.` : ""}`], changed: true };
    }

    function unequipItem(data, state, rawSlot) {
        const aliases = { "무기": "weapon", "weapon": "weapon", "방어구": "armor", "갑옷": "armor", "armor": "armor" };
        const slot = aliases[String(rawSlot).trim().toLowerCase()] || rawSlot;
        const gear = resolveEquippedItem(data, state, slot);
        if (!gear) return { messages: ["해제할 장비가 없습니다."], changed: false };
        addItemToInventory(state, gear.itemId, gear.item, gear.durability);
        state.equipment[slot] = null;
        return { messages: [`${gear.item.name}을(를) 해제했습니다.`], changed: true };
    }

    global.ArcanaGameplayEngine = { explore, attack, defend, enemyTurn, flee, useItem, buyItem, sellItem, listShopItems, equipItem, unequipItem, enterStation, leaveStation, listStationRecipes, submitStationIngredients, removeStationIngredient, combineStationIngredients, grantXp };
})(window);
