"use strict";

const editorEmail = window.ARCANA_SUPABASE_CONFIG?.editorEmail?.trim().toLowerCase() || "";

if (!editorEmail || !window.supabase?.createClient || !window.ARCANA_SUPABASE_CONFIG?.url || !window.ARCANA_SUPABASE_CONFIG?.publishableKey) {
    window.location.replace("../");
} else {
    const editorAuthClient = window.supabase.createClient(
        window.ARCANA_SUPABASE_CONFIG.url,
        window.ARCANA_SUPABASE_CONFIG.publishableKey
    );
    window.ARCANA_EDITOR_CLIENT = editorAuthClient;

    window.ARCANA_EDITOR_AUTHORIZATION = (async () => {
        try {
            const { data, error } = await editorAuthClient.auth.getUser();
            if (error || data.user?.email?.trim().toLowerCase() !== editorEmail) {
                window.location.replace("../");
                return false;
            }
            window.ARCANA_EDITOR_USER = data.user;
            document.documentElement.dataset.editorAuthorized = "true";
            return true;
        } catch {
            window.location.replace("../");
            return false;
        }
    })();
}
