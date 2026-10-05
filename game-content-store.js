(function (global) {
    "use strict";

    const CONTENT_ID = "main";

    async function read(client) {
        if (!client) throw new Error("Supabase 클라이언트가 준비되지 않았습니다.");
        const { data, error } = await client
            .from("game_content")
            .select("gameplay, story, revision, updated_at")
            .eq("id", CONTENT_ID)
            .maybeSingle();
        if (error) throw new Error(`Supabase 콘텐츠 조회 실패: ${error.message}`);
        if (!data) return null;
        if (!data.gameplay || typeof data.gameplay !== "object" || !data.story || typeof data.story !== "object") {
            throw new Error("Supabase에 저장된 게임 콘텐츠 형식이 올바르지 않습니다.");
        }
        return {
            gameplay: data.gameplay,
            story: data.story,
            revision: Number(data.revision) || 0,
            updatedAt: data.updated_at || null
        };
    }

    async function save(client, userId, gameplay, story, expectedRevision) {
        if (!client || !userId) throw new Error("편집자 로그인 정보가 없습니다. 다시 로그인해 주세요.");
        const nextRevision = expectedRevision + 1;
        const values = {
            gameplay,
            story,
            revision: nextRevision,
            updated_by: userId,
            updated_at: new Date().toISOString()
        };
        let result;
        if (expectedRevision === 0) {
            result = await client
                .from("game_content")
                .insert({ id: CONTENT_ID, ...values })
                .select("revision")
                .single();
            if (result.error?.code === "23505") {
                throw new Error("다른 편집기에서 콘텐츠를 먼저 등록했습니다. 새로고침한 뒤 다시 불러오세요.");
            }
        } else {
            result = await client
                .from("game_content")
                .update(values)
                .eq("id", CONTENT_ID)
                .eq("revision", expectedRevision)
                .select("revision")
                .maybeSingle();
            if (!result.error && !result.data) {
                throw new Error("다른 편집기에서 콘텐츠가 먼저 변경되었습니다. 새로고침해 최신 내용을 불러오세요.");
            }
        }
        if (result.error) throw new Error(`Supabase 콘텐츠 저장 실패: ${result.error.message}`);
        return Number(result.data.revision);
    }

    global.ArcanaGameContentStore = { read, save };
})(window);
