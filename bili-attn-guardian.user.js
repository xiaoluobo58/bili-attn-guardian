// ==UserScript==
// @name         哔哩哔哩审判庭（Bilibili Attention Guardian）
// @namespace    http://tampermonkey.net/
// @version      1.2.0
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

    // 🎸 音乐签证专属配置
    let VISA_CONFIG = {
        duration: GM_getValue('ai_focus_music_duration', 5), // N: 每次听歌 N 分钟 (1-10)
        cooldown: GM_getValue('ai_focus_music_cooldown', 60) // M: 冷却时间 M 分钟
    };

    const CATEGORY_MAP = {
        'ACADEMIC': '学术类视频', 'PRACTICAL': '实用类视频', 'GAME_GUIDE': '有意义的游戏视频',
        'TECH_REVIEW': '科技评测', 'HIJACKING': '无意义注意力劫持', 'TOXIC': '煽动对立内容',
        'MUSIC': '音乐放松'
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
            .m3-button { background-color: var(--md-sys-color-on-surface); color: var(--md-sys-color-surface); border: none; border-radius: 100px; padding: 10px 24px; font-size: 14px; font-weight: 500; cursor: pointer; transition: background-color 0.2s; margin: 4px; letter-spacing: 0.2px; }
            .m3-button:hover:not(:disabled) { background-color: #313033; }
            .m3-button:disabled { opacity: 0.6; cursor: not-allowed; }
            .m3-button.primary { background-color: var(--md-sys-color-primary); color: var(--md-sys-color-on-primary); }
            .m3-button.primary:hover:not(:disabled) { background-color: #553F88; }
            .m3-button.tonal { background-color: var(--md-sys-color-surface-variant); color: var(--md-sys-color-on-surface-variant); }
            .m3-button.tonal:hover:not(:disabled) { background-color: #D0C9D6; }
            .m3-input-group { margin-bottom: 20px; text-align: left; }
            .m3-input-group label.group-title { display: block; font-size: 12px; font-weight: 600; margin-bottom: 8px; color: var(--md-sys-color-on-surface-variant); }
            .m3-input-group input[type="text"], .m3-input-group input[type="password"], .m3-input-group input[type="number"] { width: 100%; box-sizing: border-box; padding: 12px 16px; border: 1px solid #79747E; border-radius: 8px; font-size: 14px; background: transparent; color: var(--md-sys-color-on-surface); outline: none; transition: border 0.2s; }
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
    // ⚙️ 设置面板 (增加音乐签证配置)
    // ==========================================
    const openSettings = () => {
        injectM3Style();
        if (document.getElementById('m3-settings-mask')) return;
        const isChecked = (val) => ALLOWED_CATEGORIES.includes(val) ? 'checked' : '';
        const mask = document.createElement('div'); mask.id = 'm3-settings-mask'; mask.className = 'm3-overlay';
        mask.innerHTML = `
            <div class="m3-card" style="max-height: 95vh;">
                <h2 class="m3-title">审判庭签证配置</h2>
                
                <div class="m3-input-group" style="margin-bottom: 12px;">
                    <label class="group-title">允许无条件通过的分类：</label>
                    <div class="m3-checkbox-group" style="padding: 12px;">
                        <label class="m3-checkbox-label"><input type="checkbox" value="ACADEMIC" class="m3-cat-cb" ${isChecked('ACADEMIC')}> 学术类</label>
                        <label class="m3-checkbox-label"><input type="checkbox" value="PRACTICAL" class="m3-cat-cb" ${isChecked('PRACTICAL')}> 实用类</label>
                        <label class="m3-checkbox-label"><input type="checkbox" value="GAME_GUIDE" class="m3-cat-cb" ${isChecked('GAME_GUIDE')}> 游戏硬核教程</label>
                        <label class="m3-checkbox-label"><input type="checkbox" value="TECH_REVIEW" class="m3-cat-cb" ${isChecked('TECH_REVIEW')}> 科技硬件评测</label>
                    </div>
                </div>

                <div class="m3-input-group" style="border-top: 1px solid #E7E0EC; padding-top: 12px; margin-bottom: 12px;">
                    <label class="group-title">🎵 音乐签证单次时长 (N分钟, 1-10)：</label>
                    <input type="number" id="m3-cfg-music-duration" value="${VISA_CONFIG.duration}" min="1" max="10">
                </div>
                <div class="m3-input-group" style="margin-bottom: 12px;">
                    <label class="group-title">⏳ 音乐签证冷却时间 (M分钟)：</label>
                    <input type="number" id="m3-cfg-music-cooldown" value="${VISA_CONFIG.cooldown}" min="1">
                </div>

                <div class="m3-input-group" style="border-top: 1px solid #E7E0EC; padding-top: 12px; margin-bottom: 12px;">
                    <label class="group-title">API Key</label><input type="password" id="m3-cfg-key" value="${API_CONFIG.key}" placeholder="sk-...">
                </div>
                <div class="m3-input-group" style="margin-bottom: 12px;">
                    <label class="group-title">API Endpoint</label><input type="text" id="m3-cfg-endpoint" value="${API_CONFIG.endpoint}">
                </div>
                <div class="m3-input-group" style="margin-bottom: 12px;">
                    <label class="group-title">Model</label><input type="text" id="m3-cfg-model" value="${API_CONFIG.model}">
                </div>
                <div style="margin-top: 16px; display: flex; justify-content: center;"><button class="m3-button tonal" id="m3-cfg-cancel">取消</button><button class="m3-button primary" id="m3-cfg-save">保存配置</button></div>
            </div>
        `;
        document.body.appendChild(mask);
        setTimeout(() => mask.classList.add('show'), 10);
        document.getElementById('m3-cfg-cancel').onclick = () => { mask.classList.remove('show'); setTimeout(() => mask.remove(), 300); };
        document.getElementById('m3-cfg-save').onclick = () => {
            const newKey = document.getElementById('m3-cfg-key').value.trim();
            if (!newKey) return showToast("API Key 不能为空", "error");
            
            // 处理音乐签证数据，防止乱填
            let nVal = parseInt(document.getElementById('m3-cfg-music-duration').value) || 5;
            if (nVal < 1) nVal = 1; if (nVal > 10) nVal = 10;
            let mVal = parseInt(document.getElementById('m3-cfg-music-cooldown').value) || 60;
            if (mVal < 1) mVal = 1;

            const newAllowed = Array.from(document.querySelectorAll('.m3-cat-cb')).filter(cb => cb.checked).map(cb => cb.value);
            GM_setValue('ai_focus_allowed_categories', newAllowed); ALLOWED_CATEGORIES = newAllowed;
            
            GM_setValue('ai_focus_music_duration', nVal); GM_setValue('ai_focus_music_cooldown', mVal);
            VISA_CONFIG = { duration: nVal, cooldown: mVal };

            GM_setValue('ai_focus_key', newKey); GM_setValue('ai_focus_endpoint', document.getElementById('m3-cfg-endpoint').value.trim()); GM_setValue('ai_focus_model', document.getElementById('m3-cfg-model').value.trim());
            API_CONFIG = { key: newKey, endpoint: document.getElementById('m3-cfg-endpoint').value.trim(), model: document.getElementById('m3-cfg-model').value.trim() };
            mask.classList.remove('show'); setTimeout(() => mask.remove(), 300); showToast("配置已保存", "success");
        };
    };
    GM_registerMenuCommand("配置 AI 专注 API 与分类", openSettings);

    // ==========================================
    // 🧠 AI 判断逻辑 (增加 MUSIC 分类)
    // ==========================================
    const checkVideoWithAI = (title, desc, tags, retryCount = 1) => {
        return new Promise((resolve, reject) => {
            if (!API_CONFIG.key) { showToast("未配置 API Key", "error"); openSettings(); return reject("Missing API Key"); }
            const prompt = `分析以下视频将其分类为7种之一：ACADEMIC, PRACTICAL, GAME_GUIDE, TECH_REVIEW, HIJACKING, TOXIC, MUSIC (音乐类如MV、翻唱、演唱会等)。只输出英文单词。标题：${title} 简介：${desc} 标签：${tags}`;
            const sendRequest = (retriesLeft) => {
                GM_xmlhttpRequest({
                    method: "POST", url: API_CONFIG.endpoint,
                    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_CONFIG.key}` },
                    data: JSON.stringify({ model: API_CONFIG.model, messages: [{ role: "user", content: prompt }], temperature: 0.1 }),
                    onload: function(response) {
                        if (response.status !== 200) return retriesLeft > 0 ? setTimeout(() => sendRequest(retriesLeft - 1), 1000) : reject("API Error");
                        try {
                            const res = JSON.parse(response.responseText);
                            const content = res.choices[0].message.content.trim().toUpperCase();
                            const match = content.match(/ACADEMIC|PRACTICAL|GAME_GUIDE|TECH_REVIEW|HIJACKING|TOXIC|MUSIC/);
                            resolve(match ? match[0] : 'HIJACKING');
                        } catch (e) { reject("Parse Error"); }
                    },
                    onerror: function() { retriesLeft > 0 ? setTimeout(() => sendRequest(retriesLeft - 1), 1000) : reject("Network Error"); }
                });
            };
            sendRequest(retryCount);
        });
    };

    const appealVideoWithAI = (title, desc, tags, reason) => {
        return new Promise((resolve, reject) => {
            const prompt = `复审官。基于视频和用户理由判断。批准回复:APPROVED，驳回回复:REJECTED|理由。标题:${title} 简介:${desc} 标签:${tags} 理由:${reason}`;
            GM_xmlhttpRequest({
                method: "POST", url: API_CONFIG.endpoint,
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_CONFIG.key}` },
                data: JSON.stringify({ model: API_CONFIG.model, messages: [{ role: "user", content: prompt }], temperature: 0.1 }),
                onload: function(response) {
                    if (response.status !== 200) return reject("API Error");
                    try { resolve(JSON.parse(response.responseText).choices[0].message.content.trim()); } catch (e) { reject("Parse Error"); }
                },
                onerror: function() { reject("Network Error"); }
            });
        });
    };

    // ==========================================
    // 🛡️ 遮罩 UI 逻辑 (注入音乐申请按钮)
    // ==========================================
    const showPendingMask = () => {
        injectM3Style();
        let mask = document.getElementById('ai-focus-mask');
        if (!mask) { mask = document.createElement('div'); mask.id = 'ai-focus-mask'; mask.className = 'm3-overlay'; document.body.appendChild(mask); }
        mask.innerHTML = `<div class="m3-card"><h2 class="m3-title">哔哩哔哩审判庭</h2><div class="m3-chip" style="background-color: var(--md-sys-color-surface-variant); color: var(--md-sys-color-on-surface-variant);">审查中...</div><p class="m3-desc" style="text-align: center;">AI 审判官正在查阅该视频的卷宗，请稍候...</p></div>`;
        setTimeout(() => mask.classList.add('show'), 10);
        if (!window.pauseInterval) window.pauseInterval = setInterval(() => { const v = document.querySelector('video'); if (v && !v.paused) v.pause(); }, 100);
    };

    const showBlocker = (category, title, desc, tags) => {
        injectM3Style();
        let mask = document.getElementById('ai-focus-mask');
        if (!mask) { mask = document.createElement('div'); mask.id = 'ai-focus-mask'; mask.className = 'm3-overlay'; document.body.appendChild(mask); }
        
        let isMusic = (category === 'MUSIC');
        let musicBtnHtml = '';
        let canApplyMusic = false;

        if (isMusic) {
            let now = Date.now();
            let lastTime = GM_getValue('ai_focus_music_last_time', 0);
            canApplyMusic = (now - lastTime) >= VISA_CONFIG.cooldown * 60 * 1000;
            let cdRemaining = Math.ceil((VISA_CONFIG.cooldown * 60 * 1000 - (now - lastTime)) / 60000);
            
            let btnText = canApplyMusic ? `🎸 申请音乐签证 (${VISA_CONFIG.duration}分钟)` : `⏳ 音乐签证冷却中 (${cdRemaining}分钟)`;
            let btnStyle = canApplyMusic ? `background-color: #006A6A; color: white;` : ``;
            let btnDisabled = canApplyMusic ? '' : 'disabled';
            
            musicBtnHtml = `<button class="m3-button primary" id="m3-music-btn" ${btnDisabled} style="${btnStyle}">${btnText}</button>`;
        }

        mask.innerHTML = `
            <div class="m3-card">
                <h2 class="m3-title">哔哩哔哩审判庭</h2><div class="m3-chip">${CATEGORY_MAP[category] || "未授权分类"}拦截</div>
                <p class="m3-desc">${isMusic ? "经判定这是音乐类视频，你可以申请短期音乐签证进行放松，但请注意时长。" : "此视频命中你设定的拦截规则。若你认为该视频确有当前必须观看的价值，请向审判官提交复议申请。"}</p>
                <div id="m3-initial-actions" style="display: flex; justify-content: center; flex-wrap: wrap; gap: 8px;">
                    <button class="m3-button tonal" id="m3-go-back">返回上一页</button>
                    <button class="m3-button primary" id="m3-appeal-btn">向审判官申诉</button>
                    ${musicBtnHtml}
                </div>
                <div id="m3-appeal-section" style="display: none; margin-top: 8px;"><textarea id="m3-appeal-reason" class="m3-textarea" placeholder="请输入你的抗辩理由..."></textarea><div style="display: flex; justify-content: center; gap: 8px;"><button class="m3-button tonal" id="m3-appeal-cancel">取消申诉</button><button class="m3-button primary" id="m3-appeal-submit">提交辩词</button></div></div>
            </div>`;
        setTimeout(() => mask.classList.add('show'), 10);
        
        document.getElementById('m3-go-back').onclick = () => { window.history.length > 1 ? window.history.back() : (window.close(), setTimeout(() => showToast("这是新建标签页，请手动关闭。", "error"), 300)); };
        document.getElementById('m3-appeal-btn').onclick = () => { document.getElementById('m3-initial-actions').style.display = 'none'; document.getElementById('m3-appeal-section').style.display = 'block'; document.getElementById('m3-appeal-reason').focus(); };
        document.getElementById('m3-appeal-cancel').onclick = () => { document.getElementById('m3-appeal-section').style.display = 'none'; document.getElementById('m3-initial-actions').style.display = 'flex'; document.getElementById('m3-appeal-reason').value = ''; };
        
        // 🎼 音乐签证申请按钮逻辑
        if (isMusic && canApplyMusic) {
            document.getElementById('m3-music-btn').onclick = () => {
                GM_setValue('ai_focus_music_last_time', Date.now());
                showToast(`🎵 音乐签证签发！享受 ${VISA_CONFIG.duration} 分钟放松时间。`, "success");
                mask.classList.remove('show'); setTimeout(() => mask.remove(), 300);
                const videoEle = document.querySelector('video'); if (videoEle) videoEle.play();
                if (window.pauseInterval) { clearInterval(window.pauseInterval); window.pauseInterval = null; }

                // 核心：到点强行打断！
                if (window.musicTimer) clearTimeout(window.musicTimer);
                window.musicTimer = setTimeout(() => {
                    showToast("🎵 音乐签证已到期，恢复拦截！", "error");
                    if (!window.pauseInterval) window.pauseInterval = setInterval(() => { const v = document.querySelector('video'); if (v && !v.paused) v.pause(); }, 100);
                    showBlocker('MUSIC', title, desc, tags);
                }, VISA_CONFIG.duration * 60 * 1000);
            };
        }

        document.getElementById('m3-appeal-submit').onclick = async () => {
            const btn = document.getElementById('m3-appeal-submit'); const input = document.getElementById('m3-appeal-reason');
            if (!input.value.trim()) return showToast("请输入理由。", "error");
            btn.innerText = "裁判中..."; btn.disabled = true; input.disabled = true;
            try {
                const appealResult = await appealVideoWithAI(title, desc, tags, input.value.trim());
                if (appealResult.toUpperCase().startsWith('APPROVED')) {
                    GM_setValue(`ai_focus_cache_${extractVideoId(location.href)}`, 'APPROVED_BY_APPEAL');
                    showToast("复议通过", "success"); mask.classList.remove('show'); setTimeout(() => mask.remove(), 300);
                    const v = document.querySelector('video'); if (v) v.play();
                } else {
                    showToast("驳回：" + (appealResult.split('|')[1] || "理由牵强"), "error");
                    btn.innerText = "重新提交"; btn.disabled = false; input.disabled = false;
                }
            } catch (e) { showToast("网络异常", "error"); btn.innerText = "提交"; btn.disabled = false; input.disabled = false; }
        };
    };

    // ==========================================
    // 🔍 信息提取器 
    // ==========================================
    const extractVideoId = (url) => {
        try { const match = new URL(url).pathname.match(/\/video\/(BV\w+|av\d+)/i); return match ? match[1] : null; } catch(e) { return null; }
    };
    const getVideoInfo = () => {
        let title = document.querySelector('h1.video-title')?.innerText || document.querySelector('.video-title')?.innerText || '';
        let desc = document.querySelector('.desc-info-text, .video-desc, .basic-desc-info')?.innerText || document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
        let tags = Array.from(document.querySelectorAll('.tag-link, .tag-txt')).map(e => e.innerText.trim()).join(', ') || document.querySelector('meta[name="keywords"]')?.getAttribute('content') || '';
        return { title, desc, tags };
    };

    // ==========================================
    // 🚀 主执行程序 (注入音乐时间线判定)
    // ==========================================
    let currentProcessId = 0;
    const main = async () => {
        const processId = ++currentProcessId;
        const currentVideoId = extractVideoId(location.href);
        if (!currentVideoId) return;

        let info = getVideoInfo();
        for(let i=0; i<30; i++) {
            if (info.title) break;
            await new Promise(r => setTimeout(r, 100)); 
            info = getVideoInfo();
        }
        if (!info.title || processId !== currentProcessId) return;
        const { title, desc, tags } = info;

        try {
            const cacheKey = `ai_focus_cache_${currentVideoId}`;
            let category = GM_getValue(cacheKey, null);

            if (category) {
                console.log(`[哔哩哔哩审判庭] ⚡ 命中本地缓存，0延迟放行/拦截: ${category}`);
            } else {
                console.log(`[哔哩哔哩审判庭] 🔍 未命中缓存，呼叫AI审判官...`);
                category = await checkVideoWithAI(title, desc, tags);
                if (processId !== currentProcessId) return;
                GM_setValue(cacheKey, category); 
            }

            let isVisaApproved = ALLOWED_CATEGORIES.includes(category) || category === 'APPROVED_BY_APPEAL';

            // 🎵 检查是否在音乐签证有效期内
            if (category === 'MUSIC') {
                let now = Date.now();
                let lastTime = GM_getValue('ai_focus_music_last_time', 0);
                let expiry = lastTime + VISA_CONFIG.duration * 60 * 1000;
                
                if (now < expiry) {
                    isVisaApproved = true; // 签证有效，强行放行
                    let remaining = expiry - now;
                    console.log(`[哔哩哔哩审判庭] 音乐签证生效中，还剩 ${Math.floor(remaining/1000)} 秒`);
                    
                    // 挂载定时炸弹，时间一到立刻拉闸
                    if (window.musicTimer) clearTimeout(window.musicTimer);
                    window.musicTimer = setTimeout(() => {
                        showToast("🎵 音乐签证已到期，注意劳逸结合，恢复拦截！", "error");
                        if (!window.pauseInterval) window.pauseInterval = setInterval(() => { const v = document.querySelector('video'); if (v && !v.paused) v.pause(); }, 100);
                        showBlocker('MUSIC', title, desc, tags);
                    }, remaining);
                }
            }

            if (isVisaApproved) {
                if (window.pauseInterval) { clearInterval(window.pauseInterval); window.pauseInterval = null; }
                showToast(`临时签注通过`, "success");
                const mask = document.getElementById('ai-focus-mask');
                if (mask) { mask.classList.remove('show'); setTimeout(() => mask.remove(), 300); }
                const videoEle = document.querySelector('video'); if (videoEle) videoEle.play();
            } else {
                if (window.pauseInterval) { clearInterval(window.pauseInterval); window.pauseInterval = null; }
                showBlocker(category, title, desc, tags);
            }
        } catch (error) {
            if (processId === currentProcessId) {
                if (window.pauseInterval) { clearInterval(window.pauseInterval); window.pauseInterval = null; }
                const mask = document.getElementById('ai-focus-mask'); if (mask) mask.remove();
            }
        }
    };

    let debounceTimer = null;
    const triggerMainDebounced = () => {
        showPendingMask();
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => main(), 50);
    };

    let lastVideoId = extractVideoId(location.href);
    new MutationObserver(() => {
        const currentVideoId = extractVideoId(location.href);
        if (currentVideoId && currentVideoId !== lastVideoId) {
            lastVideoId = currentVideoId;
            const existingMask = document.getElementById('ai-focus-mask'); if (existingMask) existingMask.remove();
            if (window.pauseInterval) { clearInterval(window.pauseInterval); window.pauseInterval = null; }
            triggerMainDebounced();
        }
    }).observe(document, {subtree: true, childList: true});

    window.addEventListener('load', () => { if (extractVideoId(location.href)) triggerMainDebounced(); });
})();