const output = document.getElementById("output");
const form = document.getElementById("commandForm");
const input = document.getElementById("commandInput");
const prompt = document.getElementById("prompt");
const settingsPanel = document.getElementById("settingsPanel");
const musicEnabledInput = document.getElementById("musicEnabled");
const musicVolumeInput = document.getElementById("musicVolume");
const settingsMusicStatus = document.getElementById("settingsMusicStatus");
const startGameButton = document.getElementById("startGameButton");
const authPanel = document.getElementById("authPanel");
const loginMusic = document.getElementById("loginMusic");
const loginMusicStatus = document.getElementById("loginMusicStatus");
const authForm = document.getElementById("authForm");
const authMessage = document.getElementById("authMessage");
const authSubmit = document.getElementById("authSubmit");
const authModeToggle = document.getElementById("authModeToggle");
const resendConfirmationButton = document.getElementById("resendConfirmationButton");
const characterNameField = document.getElementById("characterNameField");
const characterNameInput = document.getElementById("characterName");
const gamePanel = document.getElementById("gamePanel");
const titleElement = document.getElementById("title");
const signOutButton = document.getElementById("signOutButton");
const editorLink = document.getElementById("editorLink");
const EDITOR_ALLOWED_EMAIL = window.ARCANA_SUPABASE_CONFIG?.editorEmail?.trim().toLowerCase() || "";
try {
    localStorage.removeItem("arcana.editor-passcode");
    sessionStorage.removeItem("arcana.editor-authorized");
} catch {}

let authMode = "login";
let activeUserId = null;
let supabaseClient = null;
let playerState = null;
let storyContent = null;
let gameplayContent = null;
let contentSourceNotice = "";
let audioCatalog = [];
let gameMusic = null;
let saveRevision = 0;
let saveQueue = Promise.resolve();
let supabaseInitialized = false;
const player = {
    name: "",
    get location() { return playerState?.location || "village"; }
};
let mobileViewportBaseHeight = window.visualViewport?.height || window.innerHeight;
let mobileViewportUpdatePending = false;

function updateMobileGameViewport() {
    document.body.classList.toggle("game-active", !gamePanel.hidden);
    if (!window.matchMedia("(max-width: 600px)").matches || gamePanel.hidden) {
        document.body.classList.remove("mobile-game-active", "mobile-keyboard-open");
        document.documentElement.style.removeProperty("--game-viewport-height");
        document.documentElement.style.removeProperty("--game-viewport-top");
        return;
    }

    const viewport = window.visualViewport;
    const height = viewport?.height || window.innerHeight;
    const focused = document.activeElement === input;
    if (!focused) mobileViewportBaseHeight = Math.max(window.innerHeight, height);
    document.documentElement.style.setProperty("--game-viewport-height", `${height}px`);
    document.documentElement.style.setProperty("--game-viewport-top", `${viewport?.offsetTop || 0}px`);
    document.body.classList.add("mobile-game-active");
    document.body.classList.toggle("mobile-keyboard-open", focused && mobileViewportBaseHeight - height > 120);
}

function scheduleMobileViewportUpdate() {
    if (mobileViewportUpdatePending) return;
    mobileViewportUpdatePending = true;
    requestAnimationFrame(() => {
        mobileViewportUpdatePending = false;
        updateMobileGameViewport();
    });
}

input.addEventListener("focus", () => {
    const viewport = window.visualViewport;
    mobileViewportBaseHeight = Math.max(window.innerHeight, viewport?.height || 0);
    scheduleMobileViewportUpdate();
});
input.addEventListener("blur", scheduleMobileViewportUpdate);
window.addEventListener("resize", scheduleMobileViewportUpdate);
window.visualViewport?.addEventListener("resize", scheduleMobileViewportUpdate);
window.visualViewport?.addEventListener("scroll", scheduleMobileViewportUpdate);

function writeLine(text = "", className = "") {
    const line = document.createElement("p");
    line.className = className;
    line.textContent = text;
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
}

function setPrompt() {
    const locationName = gameplayContent?.locations?.[player.location]?.name || player.location;
    const station = gameplayContent?.stations?.[playerState?.activeStation];
    prompt.textContent = `${player.name}@${locationName}${station ? `[${station.name}]` : ""}>`;
    input.placeholder = "명령어를 입력하고 Enter를 누르세요";
}

function showHelp() {
    const help = [
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "              명 령 어",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "",
        "[기본]",
        "  보기       주변을 살펴봅니다",
        "  상태       캐릭터 상태를 확인합니다",
        "  소지품     아이템을 확인합니다",
        "  이야기     현재 이야기와 선택지를 봅니다",
        "  도움말     이 명령어를 다시 봅니다",
        "",
        "[이동]",
        "  이동 <지역>     다른 지역으로 이동",
        "  예) 이동 숲",
        "  또는 지역 이름을 직접 입력",
        "",
        "[장비]",
        "  장착 <아이템>       장비를 착용합니다",
        "  해제 <무기|방어구>  장비를 해제합니다",
        "",
        "[전투]",
        "  탐험          주변을 탐색합니다",
        "  공격          적을 공격합니다",
        "  방어          방어 태세를 취합니다",
        "  도망          전투에서 도망칩니다",
        "  사용 <아이템>  아이템을 사용합니다",
        "",
        "[상점]",
        "  목록           판매 상품을 확인합니다",
        "  구매 <아이템>  아이템을 구매합니다",
        "  판매 <아이템>  아이템을 판매합니다",
        "",
        "[이야기]",
        "  선택 <번호>  현재 이야기의 선택지를 선택합니다",
        "  예) 선택 1"
    ];
    const availableStations = Object.entries(gameplayContent?.stations || {}).filter(([id, station]) =>
        station.unlockedByDefault === true || playerState?.unlockedStations?.[id] === true
        || (station.activationItemId && playerState?.inventory?.[station.activationItemId] > 0)
    );
    if (availableStations.length) {
        help.push("", "[변환 장치]");
        for (const [, station] of availableStations) help.push(`  ${station.name}  장치에 들어갑니다`);
        help.push("  장치 안: 레시피 / 넣기 <아이템> / 빼기 <아이템> / 조합 / 나가기");
    }
    help.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    writeLine(help.join("\n"), "help-block");
}

function parseStationOfferings(raw) {
    return [{ name: raw.trim(), quantity: 1 }];
}

function isStationName(command) {
    const normalize = (value) => String(value).trim().toLowerCase().replace(/\s+/g, "");
    const query = normalize(command);
    return Object.entries(gameplayContent?.stations || {}).find(([id, station]) =>
        normalize(id) === query || normalize(station.name || "") === query
        || (Array.isArray(station.aliases) && station.aliases.some((alias) => normalize(alias) === query))
    )?.[0] || null;
}

function handleStationCommand(command, normalized) {
    if (["나가기", "닫기", "exit", "leave"].includes(normalized)) {
        ArcanaGameplayEngine.leaveStation(gameplayContent, playerState).messages.forEach((message) => writeLine(message));
        setPrompt();
        return;
    }
    if (["도움말", "help", "?"].includes(normalized)) {
        const station = gameplayContent.stations[playerState.activeStation];
        writeLine(`${station.name}: '넣기 아이템명'으로 재료를 하나씩 담으세요. 모든 재료를 넣은 뒤 '조합'을 입력해야 판정합니다. 잘못 넣은 재료는 '빼기 아이템명'으로 돌려놓을 수 있습니다. '레시피'로 현재 재료와 알려진 조합을 확인하세요.`);
        return;
    }
    if (["레시피", "목록", "recipes"].includes(normalized)) {
        ArcanaGameplayEngine.listStationRecipes(gameplayContent, playerState).messages.forEach((message) => writeLine(message));
        return;
    }
    if (["조합", "combine", "transmute"].includes(normalized)) {
        const result = ArcanaGameplayEngine.combineStationIngredients(gameplayContent, playerState);
        result.messages.forEach((message) => writeLine(message));
        return;
    }
    if (normalized.startsWith("빼기 ") || normalized.startsWith("remove ")) {
        const raw = command.slice(command.indexOf(" ") + 1).trim();
        const result = ArcanaGameplayEngine.removeStationIngredient(gameplayContent, playerState, raw);
        result.messages.forEach((message) => writeLine(message));
        return;
    }
    if (normalized.startsWith("넣기 ") || normalized.startsWith("insert ")) {
        const raw = command.slice(command.indexOf(" ") + 1).trim();
        const result = ArcanaGameplayEngine.submitStationIngredients(gameplayContent, playerState, parseStationOfferings(raw));
        result.messages.forEach((message) => writeLine(message));
        return;
    }
    writeLine("장치 안에서는 '레시피', '넣기 <아이템>', '빼기 <아이템>', '조합', '나가기'를 사용할 수 있습니다.");
}

function lookAround() {
    const location = gameplayContent?.locations?.[player.location];
    if (!location) {
        writeLine("현재 위치 정보를 찾을 수 없습니다. 새로고침한 뒤 다시 시도하세요.");
        return;
    }
    writeLine(`[${location.name}] ${location.description || "주변을 둘러봅니다."}`);
    const exits = (location.exits || []).map((id) => gameplayContent.locations[id]?.name || id);
    if (exits.length) writeLine(`이동 가능한 곳: ${exits.join(", ")} (지역 이름 또는 '이동 <지역>' 입력)`);
    if (location.shopItems?.length) writeLine("이 상점은 상품을 거래합니다. '목록'으로 진열 상품을 확인하세요.");
    if (player.location === "village") writeLine("검을 들어보거나 책을 펼쳐볼 수 있습니다.");
}

function moveTo(destination) {
    const place = destination.trim().toLowerCase();
    const target = Object.entries(gameplayContent.locations || {}).find(([id, location]) =>
        [id, location.name, ...(location.aliases || [])].some((name) => String(name).trim().toLowerCase() === place)
    )?.[0];
    if (target) {
        const exits = gameplayContent.locations[player.location]?.exits || [];
        if (!exits.includes(target)) {
            writeLine("그곳으로 가는 길은 현재 위치에서 이어지지 않습니다.");
            return;
        }
        if (playerState.unlockedLocations[target] === false) {
            writeLine("아직 그 지역은 해금되지 않았습니다.");
            return;
        }
        if (playerState.combat) {
            writeLine("전투 중에는 이동할 수 없습니다. '공격', '방어' 또는 '도망'을 입력하세요.");
            return;
        }
        playerState.location = target;
        syncGameMusic();
        setPrompt();
        writeLine(`${gameplayContent.locations[target].name}(으)로 이동합니다.`);
        lookAround();
        return;
    }

    writeLine(`'${destination}'(으)로는 갈 수 없습니다. '보기'로 주변을 확인하세요.`);
}

function renderStoryNode() {
    const node = ArcanaStoryEngine.getCurrentNode(storyContent, playerState);
    writeLine(`[이야기: ${node.title}]`, "system");
    writeLine(node.text);
    const choices = node.choices.filter((choice) => ArcanaStoryEngine.conditionsMet(choice.conditions, playerState));
    if (!choices.length) {
        writeLine("이 장면에는 더 이상 선택지가 없습니다. 언제든 '이야기'로 다시 확인할 수 있습니다.");
        return;
    }
    choices.forEach((choice, index) => writeLine(`  ${index + 1}. ${choice.text}`));
}

function updateMusicSettings() {
    loginMusic.volume = Number(musicVolumeInput.value);
    try {
        localStorage.setItem("arcana.musicEnabled", String(musicEnabledInput.checked));
        localStorage.setItem("arcana.musicVolume", musicVolumeInput.value);
    } catch {
        // Continue with in-memory settings when browser storage is unavailable.
    }
}

async function startLoginMusic() {
    if (!musicEnabledInput.checked) return;
    try {
        await loginMusic.play();
    } catch {
        // The user can continue to login even when the browser blocks audio.
    }
    loginMusicStatus.textContent = loginMusic.paused
        ? "배경 음악이 재생되지 않으면 브라우저의 사이트 소리 설정을 확인해 주세요."
        : "";
    settingsMusicStatus.textContent = loginMusic.paused
        ? "음악 재생이 차단되었습니다. 브라우저에서 사이트 소리를 허용해 주세요."
        : "배경 음악 재생 중";
}

function stopLoginMusic() {
    loginMusic.pause();
    loginMusic.currentTime = 0;
}

function findAudioTrack(trackId) {
    return audioCatalog.find((track) => track.id === trackId);
}

function stopGameMusic() {
    if (!gameMusic) return;
    gameMusic.pause();
    gameMusic.currentTime = 0;
    gameMusic = null;
}

function syncGameMusic() {
    if (!musicEnabledInput.checked || !playerState || !gameplayContent) {
        stopGameMusic();
        return;
    }
    const location = gameplayContent.locations?.[playerState.location];
    const trackId = playerState.combat ? gameplayContent.audio?.combatMusicId : location?.ambientAudioId;
    if (!trackId) {
        stopGameMusic();
        return;
    }
    if (gameMusic?.datasetTrackId === trackId && !gameMusic.paused) return;
    const track = findAudioTrack(trackId);
    if (!track) {
        stopGameMusic();
        return;
    }
    stopGameMusic();
    gameMusic = new Audio(track.src);
    gameMusic.datasetTrackId = trackId;
    gameMusic.loop = track.loop !== false;
    gameMusic.volume = Number(musicVolumeInput.value);
    gameMusic.play().catch(() => {});
}

function playCombatSound(trackId) {
    if (!musicEnabledInput.checked || !trackId) return;
    const track = findAudioTrack(trackId);
    if (!track) return;
    const audio = new Audio(track.src);
    audio.volume = Math.min(1, Number(musicVolumeInput.value) * 1.35);
    audio.play().catch(() => {});
}

function playCombatEvents(events = [], monster = null) {
    if (events.includes("playerAttack")) playCombatSound(gameplayContent.audio?.playerAttackSoundId);
    if (events.includes("enemyAttack") || events.includes("enemyHeavyAttack")) {
        playCombatSound(monster?.attackSoundId || gameplayContent.audio?.enemyAttackSoundId);
    }
}

function loadMusicSettings() {
    try {
        const savedEnabled = localStorage.getItem("arcana.musicEnabled");
        const savedVolume = localStorage.getItem("arcana.musicVolume");
        if (savedEnabled !== null) musicEnabledInput.checked = savedEnabled === "true";
        if (savedVolume !== null && Number.isFinite(Number(savedVolume))) {
            musicVolumeInput.value = String(Math.min(1, Math.max(0, Number(savedVolume))));
        }
    } catch {
        // Use the default checked state and volume when browser storage is unavailable.
    }
    updateMusicSettings();
}

musicEnabledInput.addEventListener("change", () => {
    updateMusicSettings();
    if (!musicEnabledInput.checked) {
        loginMusic.pause();
        stopGameMusic();
    } else if (!gamePanel.hidden) {
        syncGameMusic();
    } else if (settingsPanel.hidden) {
        startLoginMusic();
    }
});
musicVolumeInput.addEventListener("input", () => {
    updateMusicSettings();
    if (gameMusic) gameMusic.volume = Number(musicVolumeInput.value);
});
startGameButton.addEventListener("click", async () => {
    updateMusicSettings();
    settingsPanel.hidden = true;
    authPanel.hidden = false;
    if (musicEnabledInput.checked) await startLoginMusic();
    if (!supabaseInitialized) {
        supabaseInitialized = true;
        initializeSupabase();
    }
    document.getElementById("authEmail").focus();
});

function showPlayerStatus() {
    const weapon = playerState.equipment?.weapon;
    const armor = playerState.equipment?.armor;
    const weaponId = typeof weapon === "string" ? weapon : weapon?.itemId;
    const armorId = typeof armor === "string" ? armor : armor?.itemId;
    const weaponItem = gameplayContent.items[weaponId];
    const armorItem = gameplayContent.items[armorId];
    const weaponReady = weaponItem && (weaponItem.durability <= 0 || (typeof weapon === "string" ? weaponItem.durability : weapon.durability) > 0);
    const armorReady = armorItem && (armorItem.durability <= 0 || (typeof armor === "string" ? armorItem.durability : armor.durability) > 0);
    const attack = 4 + Math.floor((playerState.level - 1) / 3)
        + (weaponReady ? weaponItem.attack || 0 : 0)
        + (armorReady ? armorItem.attack || 0 : 0)
        + (weaponReady ? weaponItem.elementalAttack || 0 : 0)
        + (armorReady ? armorItem.elementalAttack || 0 : 0);
    const defense = (armorReady ? armorItem.defense || 0 : 0)
        + (weaponReady ? weaponItem.defense || 0 : 0);
    writeLine(`[상태] ${playerState.name} | 레벨 ${playerState.level} (${playerState.xp}/${playerState.level * 20} XP) | 체력 ${playerState.hp}/${playerState.maxHp} | 공격 ${attack} | 방어 ${defense} | 골드 ${playerState.gold}`);
    writeLine(`위치: ${gameplayContent.locations[playerState.location]?.name || playerState.location}`);
    const questStatuses = { active: "진행 중", complete: "완료" };
    const quests = Object.entries(playerState.quests).map(([id, status]) => {
        const quest = gameplayContent.quests?.[id];
        const objective = quest?.objective;
        const objectiveProgress = status === "active" && objective?.type === "defeatMonster"
            ? ` (목표: ${gameplayContent.locations[objective.location]?.name || objective.location}에서 ${gameplayContent.monsters[objective.monsterId]?.name || objective.monsterId} 처치 ${playerState.questProgress?.[id] || 0}/${objective.required || 1})`
            : "";
        return `${quest?.name || id}: ${questStatuses[status] || status}${objectiveProgress}`;
    });
    if (quests.length) writeLine(`퀘스트: ${quests.join(" | ")}`);
    const equipment = Object.entries(playerState.equipment || {}).filter(([, gear]) => gear);
    if (equipment.length) {
        const labels = equipment.map(([slot, gear]) => {
            const itemId = typeof gear === "string" ? gear : gear.itemId;
            const item = gameplayContent.items[itemId];
            const durability = typeof gear === "string" ? item?.durability : gear.durability;
            return `${slot === "weapon" ? "무기" : "방어구"}: ${item?.name || itemId}${item?.durability > 0 ? ` (${durability}/${item.durability})` : ""}`;
        });
        writeLine(`장비: ${labels.join(" | ")}`);
        const elemental = equipment.flatMap(([slot, gear]) => {
            const itemId = typeof gear === "string" ? gear : gear.itemId;
            const item = gameplayContent.items[itemId];
            const ready = item && (item.durability <= 0 || (typeof gear === "string" ? item.durability : gear.durability) > 0);
            return ready && item.elementalAttack > 0 ? [`${slot === "weapon" ? "무기" : "방어구"}: ${item.element} 공격력 +${item.elementalAttack}`] : [];
        });
        if (elemental.length) writeLine(`속성: ${elemental.join(" | ")}`);
    }
}

async function persistPlayerState() {
    const snapshot = JSON.parse(JSON.stringify(playerState));
    const previous = saveQueue;
    let resolveSave;
    saveQueue = new Promise((resolve) => { resolveSave = resolve; });
    await previous;
    try {
        const currentRevision = Number(saveRevision);
        if (!Number.isSafeInteger(currentRevision) || currentRevision < 1) {
            throw new Error("저장 revision 값이 올바르지 않습니다. 새로고침해 주세요.");
        }
        const { data, error } = await supabaseClient
            .from("player_state")
            .update({
                state: snapshot,
                content_version: storyContent.version,
                revision: currentRevision + 1,
                updated_at: new Date().toISOString()
            })
            .eq("user_id", activeUserId)
            .eq("revision", currentRevision)
            .select("revision")
            .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error("다른 탭에서 먼저 저장해 진행 상태가 바뀌었습니다. 최신 기록을 불러오도록 새로고침해 주세요.");
        saveRevision = Number(data.revision);
    } finally {
        resolveSave();
    }
}

async function loadPlayerState(user, fallbackName) {
    let lastConflict = "";
    for (let attempt = 0; attempt < 3; attempt += 1) {
        let data;
        let error;
        try {
            ({ data, error } = await supabaseClient
                .from("player_state")
                .select("state, revision")
                .eq("user_id", user.id)
                .maybeSingle());
        } catch (requestError) {
            throw new Error(`Supabase 캐릭터 조회 네트워크 요청 실패: ${requestError.message}`);
        }
        if (error) throw error;

        if (!data) {
            const freshState = ArcanaGameState.createDefault(fallbackName, storyContent, gameplayContent);
            let saved;
            let saveError;
            try {
                ({ data: saved, error: saveError } = await supabaseClient
                    .from("player_state")
                    .insert({
                        user_id: user.id,
                        state: freshState,
                        content_version: storyContent.version,
                        revision: 1
                    })
                    .select("revision")
                    .single());
            } catch (requestError) {
                throw new Error(`Supabase 신규 캐릭터 저장 네트워크 요청 실패: ${requestError.message}`);
            }
            if (!saveError) {
                saveRevision = Number(saved.revision);
                return freshState;
            }
            if (saveError.code === "23505" || /already exists|duplicate key/i.test(saveError.message || "")) {
                lastConflict = `신규 기록 생성 ${attempt + 1}회차: 다른 세션이 먼저 만들었습니다.`;
                continue;
            }
            throw new Error(`Supabase 신규 캐릭터 저장 실패: ${saveError.message}`);
        }

        saveRevision = data.revision;
        const normalized = ArcanaGameState.normalize(data.state, fallbackName, storyContent, gameplayContent);
        // Loading a content update is read-only. Persist the new content version
        // with the next gameplay change so two tabs cannot race during login.
        return normalized;
    }
    throw new Error(`${lastConflict || "캐릭터 초기화 중 동시 저장 충돌이 발생했습니다."} 다른 ARCANA 탭을 닫고 새로고침해 주세요.`);
}

async function runCommand(command) {
    const normalized = command.trim().toLowerCase();

    if (!normalized) {
        return;
    }

    if (playerState.activeStation) {
        handleStationCommand(command, normalized);
        return;
    }

    const stationId = isStationName(command);
    if (stationId) {
        const result = ArcanaGameplayEngine.enterStation(gameplayContent, playerState, stationId);
        result.messages.forEach((message) => writeLine(message));
        setPrompt();
        return;
    }

    if (["도움말", "help", "?"].includes(normalized)) {
        showHelp();
    } else if (["보기", "주변", "look", "살펴본다"].includes(normalized)) {
        lookAround();
    } else if (["상태", "status"].includes(normalized)) {
        showPlayerStatus();
    } else if (["소지품", "인벤토리", "inventory"].includes(normalized)) {
        const items = Object.entries(playerState.inventory).filter(([, quantity]) => quantity > 0);
        writeLine(items.length ? `[소지품] ${items.map(([id, quantity]) => `${gameplayContent.items[id]?.name || id} x${quantity}`).join(" | ")}` : "[소지품] 비어 있습니다.");
    } else if (["목록", "상품", "상점", "list", "shop"].includes(normalized)) {
        ArcanaGameplayEngine.listShopItems(gameplayContent, playerState).messages.forEach((message) => writeLine(message));
    } else if (["이야기", "story"].includes(normalized)) {
        renderStoryNode();
    } else if (normalized.startsWith("선택 ") || normalized.startsWith("choice ")) {
        const choiceNumber = Number(command.slice(command.indexOf(" ") + 1));
        const node = ArcanaStoryEngine.getCurrentNode(storyContent, playerState);
        const choices = node.choices.filter((choice) => ArcanaStoryEngine.conditionsMet(choice.conditions, playerState));
        const choice = choices[choiceNumber - 1];
        if (!Number.isInteger(choiceNumber) || !choice) {
            writeLine("현재 장면에 표시된 선택지 번호를 입력하세요. '이야기'로 선택지를 볼 수 있습니다.");
        } else {
            const previousState = JSON.parse(JSON.stringify(playerState));
            try {
                ArcanaStoryEngine.choose(storyContent, playerState, choice.id);
                writeLine(`선택: ${choice.text}`, "system");
                renderStoryNode();
            } catch (error) {
                playerState = previousState;
                throw error;
            }
        }
    } else if (["탐험", "조사", "explore"].includes(normalized)) {
        const result = ArcanaGameplayEngine.explore(gameplayContent, playerState);
        result.messages.forEach((message) => writeLine(message));
        syncGameMusic();
    } else if (["공격", "attack"].includes(normalized)) {
        const monster = playerState.combat && gameplayContent.monsters[playerState.combat.monsterId];
        const result = ArcanaGameplayEngine.attack(gameplayContent, playerState);
        result.messages.forEach((message) => writeLine(message));
        if (monster) playCombatEvents(result.events, monster);
        syncGameMusic();
    } else if (["방어", "막기", "defend", "block"].includes(normalized)) {
        const monster = playerState.combat && gameplayContent.monsters[playerState.combat.monsterId];
        const result = ArcanaGameplayEngine.defend(gameplayContent, playerState);
        result.messages.forEach((message) => writeLine(message));
        if (monster) playCombatEvents(result.events, monster);
        syncGameMusic();
    } else if (["도망", "후퇴", "flee"].includes(normalized)) {
        ArcanaGameplayEngine.flee(playerState).messages.forEach((message) => writeLine(message));
        syncGameMusic();
    } else if (normalized.startsWith("사용 ") || normalized.startsWith("use ")) {
        const item = command.slice(command.indexOf(" ") + 1).trim();
        const monster = playerState.combat && gameplayContent.monsters[playerState.combat.monsterId];
        const result = ArcanaGameplayEngine.useItem(gameplayContent, playerState, item);
        result.messages.forEach((message) => writeLine(message));
        if (result.changed && monster && playerState.combat) {
            const response = ArcanaGameplayEngine.enemyTurn(gameplayContent, playerState);
            response.messages.forEach((message) => writeLine(message));
            playCombatEvents(response.events, monster);
            syncGameMusic();
        }
    } else if (normalized.startsWith("장착 ") || normalized.startsWith("equip ")) {
        const item = command.slice(command.indexOf(" ") + 1).trim();
        const monster = playerState.combat && gameplayContent.monsters[playerState.combat.monsterId];
        const result = ArcanaGameplayEngine.equipItem(gameplayContent, playerState, item);
        result.messages.forEach((message) => writeLine(message));
        if (result.changed && monster && playerState.combat) {
            const response = ArcanaGameplayEngine.enemyTurn(gameplayContent, playerState);
            response.messages.forEach((message) => writeLine(message));
            playCombatEvents(response.events, monster);
        }
        syncGameMusic();
    } else if (normalized.startsWith("해제 ") || normalized.startsWith("unequip ")) {
        const slot = command.slice(command.indexOf(" ") + 1).trim();
        const monster = playerState.combat && gameplayContent.monsters[playerState.combat.monsterId];
        const result = ArcanaGameplayEngine.unequipItem(gameplayContent, playerState, slot);
        result.messages.forEach((message) => writeLine(message));
        if (result.changed && monster && playerState.combat) {
            const response = ArcanaGameplayEngine.enemyTurn(gameplayContent, playerState);
            response.messages.forEach((message) => writeLine(message));
            playCombatEvents(response.events, monster);
        }
        syncGameMusic();
    } else if (normalized.startsWith("구매 ") || normalized.startsWith("buy ")) {
        const item = command.slice(command.indexOf(" ") + 1).trim();
        ArcanaGameplayEngine.buyItem(gameplayContent, playerState, item).messages.forEach((message) => writeLine(message));
    } else if (normalized.startsWith("판매 ") || normalized.startsWith("sell ")) {
        const item = command.slice(command.indexOf(" ") + 1).trim();
        ArcanaGameplayEngine.sellItem(gameplayContent, playerState, item).messages.forEach((message) => writeLine(message));
    } else if (["검", "검을 든다", "검을 들어본다", "검을 들어"].includes(normalized)) {
        writeLine("당신은 낡은 연습용 검을 들어 올립니다. 아직은 검을 휘두르는 것조차 어색합니다.");
    } else if (["책", "책을 펼친다", "책을 펼쳐본다", "읽기"].includes(normalized)) {
        writeLine("책장을 펼칩니다. 첫 장에는 이렇게 적혀 있습니다. \"모든 위대한 여정은 작은 선택에서 시작된다.\"");
    } else if (normalized.startsWith("이동 ") || normalized.startsWith("go ")) {
        moveTo(command.slice(command.indexOf(" ") + 1));
    } else if (Object.entries(gameplayContent.locations || {}).some(([id, location]) =>
        [id, location.name, ...(location.aliases || [])].some((name) => String(name).trim().toLowerCase() === normalized)
    )) {
        moveTo(normalized);
    } else {
        writeLine(`알 수 없는 명령어입니다: ${command}`);
        writeLine("'도움말'을 입력하면 사용할 수 있는 명령어를 확인할 수 있습니다.");
    }
}

function beginGame(name) {
    player.name = name;
    setPrompt();
    writeLine(`${name}의 기록을 불러왔습니다.`, "system");
    showPlayerStatus();
    renderStoryNode();
    writeLine("'도움말'로 명령어를 확인하세요.");
}

form.addEventListener("submit", (event) => {
    event.preventDefault();
    const command = input.value.trim();
    input.value = "";

    if (!command) {
        return;
    }

    writeLine(`${prompt.textContent} ${command}`, "command-line");
    const previousState = JSON.stringify(playerState);
    runCommand(command).then(async () => {
        if (JSON.stringify(playerState) !== previousState) {
            try {
                await persistPlayerState();
            } catch (error) {
                playerState = JSON.parse(previousState);
                syncGameMusic();
                writeLine(`[저장 오류] 변경 사항을 저장하지 못해 캐릭터 상태를 되돌렸습니다: ${error.message}`, "error");
                setPrompt();
            }
        }
    }).catch((error) => writeLine(`[오류] ${error.message || "명령을 처리하지 못했습니다."}`, "error"));
});

function showAuthMessage(message, isError = false) {
    authMessage.textContent = message;
    authMessage.classList.toggle("error", isError);
}

function getEmailRedirectUrl() {
    return window.ARCANA_SUPABASE_CONFIG.redirectUrl;
}

function setAuthMode(mode) {
    authMode = mode;
    const isSignUp = mode === "signup";
    characterNameField.hidden = !isSignUp;
    characterNameInput.required = isSignUp;
    document.getElementById("authTitle").textContent = isSignUp
        ? "새 모험가 기록 만들기"
        : "기록의 서고에 접속";
    document.getElementById("authDescription").textContent = isSignUp
        ? "계정을 만들고 새로운 여정을 시작하세요."
        : "이메일과 비밀번호로 모험가 기록에 로그인하세요.";
    authSubmit.textContent = isSignUp ? "계정 만들기" : "로그인";
    authModeToggle.textContent = isSignUp ? "이미 계정이 있어요" : "새 계정 만들기";
    document.getElementById("authPassword").autocomplete = isSignUp
        ? "new-password"
        : "current-password";
    resendConfirmationButton.hidden = true;
    showAuthMessage("");
}

async function showGame(user) {
    const name = user.user_metadata?.character_name?.trim()
        || user.email?.split("@")[0]
        || "모험가";

    activeUserId = user.id;
    gamePanel.hidden = true;
    updateMobileGameViewport();
    authPanel.hidden = false;
    showAuthMessage("스토리 콘텐츠와 캐릭터 기록을 불러오는 중입니다.");
    try {
        if (!gameplayContent || !storyContent) await loadGameContent();
        if (!audioCatalog.length) {
            try {
                const audioData = await fetchGameContent("game/audio-catalog.json", "오디오 목록");
                audioCatalog = audioData.tracks || [];
            } catch (error) {
                console.warn("오디오 목록을 불러오지 못했습니다.", error);
            }
        }
        playerState = await loadPlayerState(user, name);
    } catch (error) {
        activeUserId = null;
        let nextStep = "Supabase 프로젝트 오류입니다. 아래 오류 문구를 확인하세요.";
        if (/player_state|save_player_state|schema cache|does not exist|Could not find the table/i.test(error.message)) {
            nextStep = "Supabase 저장 테이블 마이그레이션을 적용해야 합니다.";
        } else if (/다른 탭|changed in another session|revision/i.test(error.message)) {
            nextStep = "다른 ARCANA 탭을 닫고 새로고침해 주세요.";
        } else if (/네트워크 요청 실패|Failed to fetch|요청 실패/i.test(error.message)) {
            nextStep = "네트워크 연결과 현재 실행 주소를 확인해 주세요.";
        }
        showAuthMessage(`로그인은 되었지만 게임 준비에 실패했습니다: ${error.message} ${nextStep}`, true);
        return;
    }
    authPanel.hidden = true;
    stopLoginMusic();
    gamePanel.hidden = false;
    titleElement.textContent = "아르카나";
    editorLink.hidden = user.email?.trim().toLowerCase() !== EDITOR_ALLOWED_EMAIL;
    updateMobileGameViewport();
    output.replaceChildren();
    beginGame(name);
    if (contentSourceNotice) writeLine(`[콘텐츠 안내] ${contentSourceNotice}`, "system");
    syncGameMusic();
    input.focus();
}

async function loadGameContent() {
    contentSourceNotice = "";
    let published = null;
    let readError = null;
    try {
        published = await ArcanaGameContentStore.read(supabaseClient);
    } catch (error) {
        readError = error;
        console.warn("Supabase 게임 콘텐츠를 불러오지 못했습니다. 기본 JSON으로 전환합니다.", error);
    }

    if (published) {
        gameplayContent = published.gameplay;
        storyContent = published.story;
    } else {
        [gameplayContent, storyContent] = await Promise.all([
            fetchGameContent("content/data/gameplay.json", "게임 데이터"),
            fetchGameContent("content/story/arrival.json", "스토리")
        ]);
        contentSourceNotice = readError
            ? `Supabase 콘텐츠 조회에 실패해 기본 데이터를 사용 중입니다. ${readError.message}`
            : "Supabase에 게시된 콘텐츠가 없어 기본 데이터를 사용 중입니다. 편집기에서 콘텐츠를 저장해 주세요.";
    }

    const contentErrors = ArcanaStoryEngine.validate(storyContent, gameplayContent);
    if (contentErrors.length) throw new Error(`스토리 데이터 오류: ${contentErrors.join(" ")}`);
}

async function fetchGameContent(path, label) {
    if (window.location.protocol === "file:") {
        throw new Error(`${label} 파일은 file:// 주소에서 읽을 수 없습니다. 프로젝트 폴더에서 HTTP 서버로 실행하세요.`);
    }
    let response;
    try {
        response = await fetch(path, { cache: "no-cache" });
    } catch (error) {
        throw new Error(`${label} 요청 실패 (${new URL(path, window.location.href).href}): ${error.message}`);
    }
    if (!response.ok) throw new Error(`${label} 요청 실패 (HTTP ${response.status}, ${path}).`);
    try {
        return await response.json();
    } catch (error) {
        throw new Error(`${label} JSON 형식 오류 (${path}): ${error.message}`);
    }
}

function showLogin() {
    activeUserId = null;
    stopGameMusic();
    gamePanel.hidden = true;
    titleElement.textContent = "Arcana: The Art of All Things";
    editorLink.hidden = true;
    updateMobileGameViewport();
    authPanel.hidden = false;
    player.name = "";
    playerState = null;
    saveRevision = 0;
    showAuthMessage("");
    document.getElementById("authEmail").focus();
}

function renderSession(session) {
    if (session?.user) {
        if (activeUserId !== session.user.id) {
            showGame(session.user).catch((error) => showAuthMessage(`게임을 열지 못했습니다: ${error.message}`, true));
        }
        return;
    }

    if (activeUserId !== null || gamePanel.hidden === false) {
        showLogin();
    }
}

function initializeSupabase() {
    if (!window.supabase?.createClient || !window.ARCANA_SUPABASE_CONFIG?.url || !window.ARCANA_SUPABASE_CONFIG?.publishableKey) {
        showAuthMessage("로그인 서비스를 불러오지 못했습니다. 네트워크와 Supabase 설정을 확인하세요.", true);
        authSubmit.disabled = true;
        authModeToggle.disabled = true;
        return;
    }

    supabaseClient = window.supabase.createClient(
        window.ARCANA_SUPABASE_CONFIG.url,
        window.ARCANA_SUPABASE_CONFIG.publishableKey
    );

    const callbackParams = new URLSearchParams(window.location.hash.slice(1));
    if (callbackParams.get("error_code") === "otp_expired") {
        setAuthMode("signup");
        showAuthMessage("이메일 확인 링크가 만료되었거나 이미 사용되었습니다. 이메일 주소를 입력하고 확인 메일을 다시 보내세요.", true);
        resendConfirmationButton.hidden = false;
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    } else if (callbackParams.has("error")) {
        showAuthMessage(
            callbackParams.get("error_description") || "이메일 확인 중 오류가 발생했습니다. 새 확인 메일을 요청해 주세요.",
            true
        );
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }

    authModeToggle.addEventListener("click", () => {
        setAuthMode(authMode === "login" ? "signup" : "login");
    });

    resendConfirmationButton.addEventListener("click", async () => {
        const email = document.getElementById("authEmail").value.trim();
        if (!email) {
            showAuthMessage("확인 메일을 받을 이메일 주소를 입력하세요.", true);
            document.getElementById("authEmail").focus();
            return;
        }

        resendConfirmationButton.disabled = true;
        showAuthMessage("");
        try {
            const { error } = await supabaseClient.auth.resend({
                type: "signup",
                email,
                options: { emailRedirectTo: getEmailRedirectUrl() }
            });
            if (error) {
                throw error;
            }
            showAuthMessage("새 확인 메일을 요청했습니다. 받은 편지함을 확인하세요.");
        } catch (error) {
            showAuthMessage(`확인 메일을 보내지 못했습니다: ${error.message}`, true);
        } finally {
            resendConfirmationButton.disabled = false;
        }
    });

    authForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        showAuthMessage("");

        const email = document.getElementById("authEmail").value.trim();
        const password = document.getElementById("authPassword").value;
        const name = characterNameInput.value.trim();
        if (authMode === "signup" && !name) {
            showAuthMessage("모험가 이름을 입력하세요.", true);
            characterNameInput.focus();
            return;
        }

        authSubmit.disabled = true;
        authModeToggle.disabled = true;

        try {
            if (authMode === "signup") {
                const { data, error } = await supabaseClient.auth.signUp({
                    email,
                    password,
                    options: {
                        data: { character_name: name },
                        emailRedirectTo: getEmailRedirectUrl()
                    }
                });
                if (error) {
                    throw error;
                }
                if (!data.session) {
                    showAuthMessage("가입 요청이 완료되었습니다. 이메일을 확인한 뒤 로그인하세요.");
                    resendConfirmationButton.hidden = false;
                }
            } else {
                const { error } = await supabaseClient.auth.signInWithPassword({
                    email,
                    password
                });
                if (error) {
                    throw error;
                }
            }
        } catch (error) {
            showAuthMessage(`인증에 실패했습니다: ${error.message}`, true);
        } finally {
            authSubmit.disabled = false;
            authModeToggle.disabled = false;
        }
    });

    signOutButton.addEventListener("click", async () => {
        signOutButton.disabled = true;
        try {
            const { error } = await supabaseClient.auth.signOut();
            if (error) {
                writeLine(`[오류] 로그아웃에 실패했습니다: ${error.message}`);
            }
        } catch (error) {
            writeLine(`[오류] 로그아웃에 실패했습니다: ${error.message}`);
        } finally {
            signOutButton.disabled = false;
        }
    });

    supabaseClient.auth.onAuthStateChange((_event, session) => {
        renderSession(session);
    });

    supabaseClient.auth.getSession()
        .then(({ data, error }) => {
            if (error) {
                showAuthMessage(`저장된 로그인 정보를 확인하지 못했습니다: ${error.message}`, true);
                return;
            }
            renderSession(data.session);
        })
        .catch((error) => {
            showAuthMessage(`저장된 로그인 정보를 확인하지 못했습니다: ${error.message}`, true);
        });
}

setAuthMode("login");
loadMusicSettings();
