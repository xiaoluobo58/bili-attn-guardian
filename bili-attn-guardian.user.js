// ==UserScript==
// @name         哔哩哔哩审判庭（Bilibili Attention Guardian）
// @namespace    http://tampermonkey.net/
// @version      1.1.2
// @description  抓取视频标题、简介和标签(TAG)通过AI判断。支持自定义放行分类，保护注意力。
// @author       Misaka Milobo(Gemini)
// @match        *://*.bilibili.com/video/*
// @homepageURL  https://www.milobo.moe
// @updateURL    https://raw.githubusercontent.com/xiaoluobo58/bili-attn-guardian/main/bili-attn-guardian.user.js
// @downloadURL  https://raw.githubusercontent.com/xiaoluobo58/bili-attn-guardian/main/bili-attn-guardian.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      api.openai.com
// @connect      api.deepseek.com
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    // ==========================================
    // ⚙️ 配置读取 (通过油猴存储)
    // ==========================================
    let API_CONFIG = {
        key: GM_getValue('ai_focus_key', ''),
        endpoint: GM_getValue('ai_focus_endpoint', 'https://api.openai.com/v1/chat/completions'),
        model: GM_getValue('ai_focus_model', 'gpt-4o-mini') 
    };

    let ALLOWED_CATEGORIES = GM_getValue('ai_focus_allowed_categories', ['ACADEMIC', 'PRACTICAL', 'GAME_GUIDE', 'TECH_REVIEW']);

    const CATEGORY_MAP = {
        'ACADEMIC': '学术类视频', 'PRACTICAL': '实用类视频', 'GAME_GUIDE': '有意义的游戏视频',
        'TECH_REVIEW': '科技评测', 'HIJACKING': '无意义注意力劫持', 'TOXIC': '煽动对立内容'
    };

    // ==========================================
    // 🎨 M3 样式注入
    // ==========================================
    const injectM3Style = () => {
        if (document.getElementById('m3-focus-styles')) return;
        const style = document.createElement('style');
        style.id = 'm3-focus-styles';
        style.textContent = `
            :root { --md-sys-color-surface: #FDFDFE; --md-sys-color-on-surface: #1A1C1E; --md-sys-color-primary: #6750A4; --md-sys-color-on-primary: #FFFFFF; --md-sys-color-error-container: #FFDAD6; --md-sys-color-on-error-container: #410002; --md-sys-color-success-container: #C4EED0; --md-sys-color-on-success-container: #00391C; --md-sys-color-surface-variant: #E7E0EC; --md-sys-color-on-surface-variant: #49454F; --md-sys-elevation-3: 0px 4px 8px 3px rgba(0, 0, 0, 0.15); }
            .m3-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.65); backdrop-filter: blur(16px); z-index: 999999; display: flex; align-items: center; justify-content: center; font-family: system-ui, -apple-system, sans-serif; opacity: 0; transition: opacity 0.3s ease; pointer-events: none; }
            .m3-overlay.show { opacity: 1; pointer-events: auto; }
            .m3-card { background-color: var(--md-sys-color-surface); color: var(--md-sys-color-on-surface); border-radius: 28px; padding: 40px 32px; max-width: 420px; width: 90%; max-height: 90vh; overflow-y: auto; text-align: center; box-shadow: var(--md-sys-elevation-3); transform: translateY(20px); transition: transform 0.3s cubic-bezier(0.2, 0, 0, 1); }
            .m3-overlay.show .m3-card { transform: translateY(0); }
            .m3-title { font-size: 24px; font-weight: 600; margin: 0 0 16px 0; letter-spacing: 0.5px;}
            .m3-desc { font-size: 14px; line-height: 1.6; color: #44474E; margin-bottom: 24px; text-align: left; }
            .m3-chip { display: inline-block; padding: 6px 16px; border-radius: 8px; font-size: 12px; font-weight: 600; margin-bottom: 24px; letter-spacing: 0.5px; background-color: var(--md-sys-color-error-container); color: var(--md-sys-color-on-error-container); }
            .m3-button { background-color: var(--md-sys-color-on-surface); color: var(--md-sys-color-surface); border: none; border-radius: 100px; padding: 10px 24px; font-size: 14px; font-weight: 500; cursor: pointer; transition: background-color 0.2s; margin: 0 4px; letter-spacing: 0.2px; }
            .m3-button:hover:not(:disabled) { background-color: #313033; }
            .m3-button:disabled { opacity: 0.6; cursor: not-allowed; }
            .m3-button.primary { background-color: var(--md-sys-color-primary); color: var(--md-sys-color-on-primary); }
            .m3-button.primary:hover:not(:disabled) { background-color: #553F88; }
            .m3-button.tonal { background-color: var(--md-sys-color-surface-variant); color: var(--md-sys-color-on-surface-variant); }
            .m3-button.tonal:hover:not(:disabled) { background-color: #D0C9D6; }
            .m3-input-group { margin-bottom: 20px; text-align: left; }
            .m3-input-group label.group-title { display: block; font-size: 12px; font-weight: 600; margin-bottom: 8px; color: var(--md-sys-color-on-surface-variant); }
            .m3-input-group input[type="text"], .m3-input-group input[type="password"] { width: 100%; box-sizing: border-box; padding: 12px 16px; border: 1px solid #79747E; border-radius: 8px; font-size: 14px; background: transparent; color: var(--md-sys-color-on-surface); outline: none; transition: border 0.2s; }
            .m3-input-group input:focus { border: 2px solid var(--md-sys-color-primary); padding: 11px 15px; }
            .m3-checkbox-group { display: flex; flex-direction: column; gap: 10px; background: var(--md-sys-color-surface-variant); padding: 16px; border-radius: 12px;}
            .m3-checkbox-label { font-size: 14px; color: var(--md-sys-color-on-surface); display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: 500;}
            .m3-checkbox-label input { width: 18px; height: 18px; accent-color: var(--md-sys-color-primary); cursor: pointer;}
            .m3-textarea { width: 100%; box-sizing: border-box; padding: 16px; border: 1px solid #79747E; border-radius: 12px; font-size: 14px; background: transparent; color: var(--md-sys-color-on-surface); outline: none; resize: vertical; min-height: 100px; font-family: inherit; margin-bottom: 16px; line-height: 1.5; }
            .m3-textarea:focus { border: 2px solid var(--md-sys-color-primary); padding: 15px; }
            #m3-toast { position: fixed; top: 24px; left: 50%; transform: translateX(-50%) translateY(-20px); padding: 14px 28px; border-radius: 100px; font-family: system-ui, sans-serif; font-size: 14px; font-weight: 500; box-shadow: var(--md-sys-elevation-3); display: flex; align-items: center; gap: 16px; z-index: 9999999; opacity: 0; pointer-events: none; transition: all 0.3s cubic-bezier(0.2, 0, 0, 1); }
            #m3-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); pointer-events: auto; }
            #m3-toast.error { background-color: var(--md-sys-color-error-container); color: var(--md-sys-color-on-error-container); }
            #m3-toast.success { background-color: var(--md-sys-color-success-container); color: var(--md-sys-color-on-success-container); }
            .m3-toast-close { cursor: pointer; font-weight: 600; font-size: 16px; opacity: 0.6; transition: opacity 0.2s; }
            .m3-toast-close:hover { opacity: 1; }
        `;
        document.head.appendChild(style);
    };

    const showToast = (message, type = 'error') => {
        injectM3Style();
        let toast = document.getElementById('m3-toast');
        if (!toast) { toast = document.createElement('div'); toast.id = 'm3-toast'; document.body.appendChild(toast); }
        toast.className = type;
        toast.innerHTML = `<span>${message}</span><span class="m3-toast-close" onclick="document.getElementById('m3-toast').classList.remove('show')">✕</span>`;
        void toast.offsetWidth; toast.classList.add('show');
        if (toast.hideTimer) clearTimeout(toast.hideTimer);
        toast.hideTimer = setTimeout(() => toast.classList.remove('show'), message.length > 20 ? 8000 : 5000);
    };

    // ==========================================
    // ⚙️ 设置面板 
    // ==========================================
    const openSettings = () => {
        injectM3Style();
        if (document.getElementById('m3-settings-mask')) return;
        const isChecked = (val) => ALLOWED_CATEGORIES.includes(val) ? 'checked' : '';
        const mask = document.createElement('div'); mask.id = 'm3-settings-mask'; mask.className = 'm3-overlay';
        mask.innerHTML = `
            <div class="m3-card">
                <h2 class="m3-title">审判庭签证配置</h2>
                <div class="m3-input-group">
                    <label class="group-title">允许通过的视频分类：</label>
                    <div class="m3-checkbox-group">
                        <label class="m3-checkbox-label"><input type="checkbox" value="ACADEMIC" class="m3-cat-cb" ${isChecked('ACADEMIC')}> 学术类 (数学、物理探讨等)</label>
                        <label class="m3-checkbox-label"><input type="checkbox" value="PRACTICAL" class="m3-cat-cb" ${isChecked('PRACTICAL')}> 实用类 (家具维修等)</label>
                        <label class="m3-checkbox-label"><input type="checkbox" value="GAME_GUIDE" class="m3-cat-cb" ${isChecked('GAME_GUIDE')}> 有意义的游戏 (教程、配队等)</label>
                        <label class="m3-checkbox-label"><input type="checkbox" value="TECH_REVIEW" class="m3-cat-cb" ${isChecked('TECH_REVIEW')}> 科技评测 (硬件装机评测等)</label>
                        <label class="m3-checkbox-label"><input type="checkbox" value="HIJACKING" class="m3-cat-cb" ${isChecked('HIJACKING')}> 无意义注意力劫持 (Meme/娱乐)</label>
                        <label class="m3-checkbox-label"><input type="checkbox" value="TOXIC" class="m3-cat-cb" ${isChecked('TOXIC')}> 煽动对立 (引战/网左键政等)</label>
                    </div>
                </div>
                <div class="m3-input-group"><label class="group-title">API Key</label><input type="password" id="m3-cfg-key" value="${API_CONFIG.key}" placeholder="sk-..."></div>
                <div class="m3-input-group"><label class="group-title">API Endpoint</label><input type="text" id="m3-cfg-endpoint" value="${API_CONFIG.endpoint}"></div>
                <div class="m3-input-group"><label class="group-title">Model</label><input type="text" id="m3-cfg-model" value="${API_CONFIG.model}"></div>
                <div style="margin-top: 24px; display: flex; justify-content: center;"><button class="m3-button tonal" id="m3-cfg-cancel">取消</button><button class="m3-button primary" id="m3-cfg-save">保存配置</button></div>
            </div>
        `;
        document.body.appendChild(mask);
        setTimeout(() => mask.classList.add('show'), 10);
        document.getElementById('m3-cfg-cancel').onclick = () => { mask.classList.remove('show'); setTimeout(() => mask.remove(), 300); };
        document.getElementById('m3-cfg-save').onclick = () => {
            const newKey = document.getElementById('m3-cfg-key').value.trim();
            if (!newKey) return showToast