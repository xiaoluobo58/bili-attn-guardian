// ==UserScript==
// @name         哔哩哔哩审判庭（Bilibili Attention Guardian）
// @namespace    http://tampermonkey.net/
// @version      1.2.5
// @description  抓取视频标题、简介和标签(TAG)通过AI判断。支持自定义放行分类，保护注意力。
// @author       Misaka Milobo(By Gemini)
// @match        *://*.bilibili.com/video/*
// @homepageURL  https://www.milobo.moe
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
    // ⚙️ 配置与状态 (动态获取以支持多标签页同步)
    // ==========================================
    const getApiConfig = () => ({
        key: GM_getValue('ai_focus_key', ''),
        endpoint: GM_getValue('ai_focus_endpoint', 'https://api.openai.com/v1/chat/completions'),
        model: GM_getValue('ai_focus_model', 'gpt-4o-mini') 
    });

    const getAllowedCategories = () => GM_getValue('ai_focus_allowed_categories', ['ACADEMIC', 'PRACTICAL', 'GAME_GUIDE', 'TECH_REVIEW']);

    const getVisaConfig = () => ({
        duration: GM_getValue('ai_focus_music_duration', 5), 
        cooldown: GM_getValue('ai_focus_music_cooldown', 60) 
    });

    const CATEGORY_MAP = {
        'ACADEMIC': '学术类视频', 'PRACTICAL': '实用类视频', 'GAME_GUIDE': '有意义的游戏视频',
        'TECH_REVIEW': '科技评测', 'HIJACKING': '无意义注意力劫持', 'TOXIC': '煽动对立内容',
        'MUSIC': '音乐放松'
    };

    // ==========================================
    // 🎬 播放器控制封装 
    // ==========================================
    const getMainVideoElement = () => document.querySelector('.bpx-player-video-area video') || document.querySelector('video');

    const forcePauseVideo = () => {
        const v = getMainVideoElement();
        if (v && !v.paused) v.pause();
    };

    const tryPlayVideo = () => {
        const v = getMainVideoElement();
        if (v && v.paused) {
            const playPromise = v.play();
            if (playPromise !== undefined) {
                playPromise.catch(e => console.log("[哔哩哔哩审判庭] 浏览器阻止了自动播放，需用户手动点击"));
            }
        }
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
    // ⚙️ 设置面板 (支持拉取云端模型列表)
    // ==========================================
    const openSettings = () => {
        injectM3Style();
        if (document.getElementById('m3-settings-mask')) return;
        const currentAllowed = getAllowedCategories();
        const currentVisa = getVisaConfig();
        const currentApi = getApiConfig();

        const isChecked = (val) => currentAllowed.includes(val) ? 'checked' : '';
        const mask = document.createElement('div'); mask.id = 'm3-settings-mask'; mask.className = 'm3-overlay';
        mask.innerHTML = `
            <div class="m3-card" style="max-height: 95vh;">
                <h2 class="m3-title">审判庭签证配置</h2>
                <div class="m3-input-group" style="margin-bottom: 12px;">
                    <label class="group-title">允许无条件通过的分类 (不限时)：</label>
                    <div class="m3-checkbox-group" style="padding: 12px;">
                        <label class="m3-checkbox-label"><input type="checkbox" value="ACADEMIC" class="m3-cat-cb" ${isChecked('ACADEMIC')}> 学术类视频 </label>
                        <label class="m3-checkbox-label"><input type="checkbox" value="PRACTICAL" class="m3-cat-cb" ${isChecked('PRACTICAL')}> 实用类视频 </label>
                        <label class="m3-checkbox-label"><input type="checkbox" value="GAME_GUIDE" class="m3-cat-cb" ${isChecked('GAME_GUIDE')}> 有意义游戏视频 </label>
                        <label class="m3-checkbox-label"><input type="checkbox" value="TECH_REVIEW" class="m3-cat-cb" ${isChecked('TECH_REVIEW')}> 科技数码评测视频 </label>
                        <label class="m3-checkbox-label"><input type="checkbox" value="MUSIC" class="m3-cat-cb" ${isChecked('MUSIC')}> 音乐放松 </label>
                        <label class="m3-checkbox-label"><input type="checkbox" value="HIJACKING" class="m3-cat-cb" ${isChecked('HIJACKING')}> 无意义注意力劫持、MEME</label>
                        <label class="m3-checkbox-label"><input type="checkbox" value="TOXIC" class="m3-cat-cb" ${isChecked('TOXIC')}> 煽动对立、引战</label>
                    </div>
                </div>
                <div class="m3-input-group" style="border-top: 1px solid #E7E0EC; padding-top: 12px; margin-bottom: 12px;">
                    <label class="group-title">🎵 音乐签证单次时长 (1-10，分钟)：</label>
                    <input type="number" id="m3-cfg-music-duration" value="${currentVisa.duration}" min="1" max="10">
                </div>
                <div class="m3-input-group" style="margin-bottom: 12px;">
                    <label class="group-title">⏳ 音乐签证冷却时间 (分钟)：</label>
                    <input type="number" id="m3-cfg-music-cooldown" value="${currentVisa.cooldown}" min="1">
                </div>
                <div class="m3-input-group" style="border-top: 1px solid #E7E0EC; padding-top: 12px; margin-bottom: 12px;">
                    <label class="group-title">API Key</label><input type="password" id="m3-cfg-key" value="${currentApi.key}" placeholder="sk-...">
                </div>
                <div class="m3-input-group" style="margin-bottom: 12px;">
                    <label class="group-title">API Endpoint (如: https://api.openai.com/v1/chat/completions)</label><input type="text" id="m3-cfg-endpoint" value="${currentApi.endpoint}">
                </div>
                
                <div class="m3-input-group" style="margin-bottom: 12px;">
                    <label class="group-title">Model (大语言模型)</label>
                    <div style="display: flex; gap: 8px;">
                        <input type="text" id="m3-cfg-model" value="${currentApi.model}" list="m3-model-list" style="flex: 1;" placeholder="手动输入或点击右侧拉取">
                        <button class="m3-button tonal" id="m3-cfg-fetch-models" style="margin: 0; padding: 0 16px; flex-shrink: 0;">拉取列表</button>
                    </div>
                    <datalist id="m3-model-list"></datalist>
                </div>

                <div style="margin-top: 16px; display: flex; justify-content: center;"><button class="m3-button tonal" id="m3-cfg-cancel">取消</button><button class="m3-button primary" id="m3-cfg-save">保存配置</button></div>
            </div>
        `;
        document.body.appendChild(mask);
        setTimeout(() => mask.classList.add('show'), 10);
        
        document.getElementById('m3-cfg-cancel').onclick = () => { mask.classList.remove('show'); setTimeout(() => mask.remove(), 300); };
        
        // --- 拉取模型列表核心逻辑 ---
        document.getElementById('m3-cfg-fetch-models').onclick = () => {
            const key = document.getElementById('m3-cfg-key').value.trim();
            const endpoint = document.getElementById('m3-cfg-endpoint').value.trim();
            const btn = document.getElementById('m3-cfg-fetch-models');

            if (!key || !endpoint) return showToast("请先填写 API Key 和 Endpoint", "error");

            // 智能推导 models 接口地址 (将 /chat/completions 替换为 /models)
            let modelsUrl = endpoint.replace(/\/chat\/completions\/?$/i, '/models');

            btn.innerText = "拉取中...";
            btn.disabled = true;

            GM_xmlhttpRequest({
                method: "GET",
                url: modelsUrl,
                headers: {
                    "Authorization": `Bearer ${key}`,
                    "Content-Type": "application/json"
                },
                onload: function(response) {
                    btn.innerText = "拉取列表";
                    btn.disabled = false;
                    if (response.status === 200) {
                        try {
                            const resJson = JSON.parse(response.responseText);
                            const models = resJson.data || [];
                            if (models.length === 0) return showToast("拉取成功，但该供应商模型列表为空", "error");

                            const datalist = document.getElementById('m3-model-list');
                            datalist.innerHTML = ''; // 清空旧列表
                            
                            // 解析并填充选项
                            models.forEach(m => {
                                if (m.id) {
                                    const option = document.createElement('option');
                                    option.value = m.id;
                                    datalist.appendChild(option);
                                }
                            });
                            
                            showToast(`✅ 成功获取 ${models.length} 个模型！请点击输入框下拉选择。`, "success");
                            
                            // 自动将焦点放回输入框，并触发点击效果方便展开下拉
                            const modelInput = document.getElementById('m3-cfg-model');
                            modelInput.value = ""; // 清空当前方便下拉
                            modelInput.focus();
                            modelInput.click();

                        } catch (e) {
                            showToast("解析数据失败，API 格式不兼容标准规范", "error");
                        }
                    } else {
                        showToast(`拉取失败，状态码: ${response.status}`, "error");
                    }
                },
                onerror: function() {
                    btn.innerText = "拉取列表";
                    btn.disabled = false;
                    showToast("网络请求失败，请检查网络或跨域限制", "error");
                }
            });
        };

        // --- 保存逻辑 ---
        document.getElementById('m3-cfg-save').onclick = () => {
            const newKey = document.getElementById('m3-cfg-key').value.trim();
            const newModel = document.getElementById('m3-cfg-model').value.trim();
            if (!newKey) return showToast("API Key 不能为空", "error");
            if (!newModel) return showToast("模型名称不能为空", "error");
            
            let nVal = parseInt(document.getElementById('m3-cfg-music-duration').value) || 5;
            if (nVal < 1) nVal = 1; if (nVal > 10) nVal = 10;
            let mVal = parseInt(document.getElementById('m3-cfg-music-cooldown').value) || 60;
            if (mVal < 1) mVal = 1;

            const newAllowed = Array.from(document.querySelectorAll('.m3-cat-cb')).filter(cb => cb.checked).map(cb => cb.value);
            
            GM_setValue('ai_focus_allowed_categories', newAllowed); 
            GM_setValue('ai_focus_music_duration', nVal); 
            GM_setValue('ai_focus_music_cooldown', mVal);
            GM_setValue('ai_focus_key', newKey); 
            GM_setValue('ai_focus_endpoint', document.getElementById('m3-cfg-endpoint').value.trim()); 
            GM_setValue('ai_focus_model', newModel);
            
            mask.classList.remove('show'); setTimeout(() => mask.remove(), 300); showToast("配置已保存", "success");
        };
    };
    GM_registerMenuCommand("配置 AI 专注 API 与分类", openSettings);

    // ==========================================
    // 🧠 AI 判断逻辑
    // ==========================================
    const checkVideoWithAI = (title, desc, tags, retryCount = 1) => {
        return new Promise((resolve, reject) => {
            const api = getApiConfig();
            if (!api.key) { showToast("未配置 API Key", "error"); openSettings(); return reject("Missing API Key"); }
            const prompt = `分析以下视频将其分类为7种之一：ACADEMIC, PRACTICAL, GAME_GUIDE, TECH_REVIEW, HIJACKING, TOXIC, MUSIC (音乐类如MV、翻唱、演唱会等)。只输出英文单词。标题：${title} 简介：${desc} 标签：${tags}`;
            const sendRequest = (retriesLeft) => {
                GM_xmlhttpRequest({
                    method: "POST", url: api.endpoint,
                    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
                    data: JSON.stringify({ model: api.model, messages: [{ role: "user", content: prompt }], temperature: 0.1 }),
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
            const api = getApiConfig();
            const prompt = `复审官。基于视频和用户理由判断。批准回复:APPROVED，驳回回复:REJECTED|理由。标题:${title} 简介:${desc} 标签:${tags} 理由:${reason}`;
            GM_xmlhttpRequest({
                method: "POST", url: api.endpoint,
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api.key}` },
                data: JSON.stringify({ model: api.model, messages: [{ role: "user", content: prompt }], temperature: 0.1 }),
                onload: function(response) {
                    if (response.status !== 200) return reject("API Error");
                    try { resolve(JSON.parse(response.responseText).choices[0].message.content.trim()); } catch (e) { reject("Parse Error"); }
                },
                onerror: function() { reject("Network Error"); }
            });
        });
    };

    // ==========================================
    // 🛡️ 遮罩 UI 逻辑 
    // ==========================================
    const showPendingMask = () => {
        injectM3Style();
        let mask = document.getElementById('ai-focus-mask');
        if (!mask) { mask = document.createElement('div'); mask.id = 'ai-focus-mask'; mask.className = 'm3-overlay'; document.body.appendChild(mask); }
        mask.innerHTML = `<div class="m3-card"><h2 class="m3-title">哔哩哔哩审判庭</h2><div class="m3-chip" style="background-color: var(--md-sys-color-surface-variant); color: var(--md-sys-color-on-surface-variant);">审查中...</div><p class="m3-desc" style="text-align: center;">AI 审判官正在查阅该视频的卷宗，请稍候...</p></div>`;
        setTimeout(() => mask.classList.add('show'), 10);
        if (!window.pauseInterval) window.pauseInterval = setInterval(forcePauseVideo, 100);
    };

    const showBlocker = (category, title, desc, tags, currentVideoId) => {
        injectM3Style();
        let mask = document.getElementById('ai-focus-mask');
        if (!mask) { mask = document.createElement('div'); mask.id = 'ai-focus-mask'; mask.className = 'm3-overlay'; document.body.appendChild(mask); }
        
        const visaCfg = getVisaConfig();
        let isMusic = (category === 'MUSIC');
        let musicBtnHtml = '';
        let canApplyMusic = false;

        if (isMusic) {
            let now = Date.now();
            let lastTime = GM_getValue('ai_focus_music_last_time', 0);
            canApplyMusic = (now - lastTime) >= visaCfg.cooldown * 60 * 1000;
            let cdRemaining = Math.ceil((visaCfg.cooldown * 60 * 1000 - (now - lastTime)) / 60000);
            
            let btnText = canApplyMusic ? `🎸 申请音乐签证 (${visaCfg.duration}分钟)` : `⏳ 音乐签证冷却中 (${cdRemaining}分钟)`;
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
        
        if (isMusic && canApplyMusic) {
            document.getElementById('m3-music-btn').onclick = () => {
                GM_setValue('ai_focus_music_last_time', Date.now());
                showToast(`🎵 音乐签证签发！享受 ${visaCfg.duration} 分钟放松时间。`, "success");
                mask.classList.remove('show'); setTimeout(() => mask.remove(), 300);
                
                tryPlayVideo();
                if (window.pauseInterval) { clearInterval(window.pauseInterval); window.pauseInterval = null; }

                if (window.musicTimer) clearTimeout(window.musicTimer);
                window.musicTimer = setTimeout(() => {
                    showToast("🎵 音乐签证已到期，恢复拦截！", "error");
                    if (!window.pauseInterval) window.pauseInterval = setInterval(forcePauseVideo, 100);
                    showBlocker('MUSIC', title, desc, tags, currentVideoId);
                }, visaCfg.duration * 60 * 1000);
            };
        }

        document.getElementById('m3-appeal-submit').onclick = async () => {
            const btn = document.getElementById('m3-appeal-submit'); const input = document.getElementById('m3-appeal-reason');
            if (!input.value.trim()) return showToast("请输入理由。", "error");
            btn.innerText = "裁判中..."; btn.disabled = true; input.disabled = true;
            try {
                const appealResult = await appealVideoWithAI(title, desc, tags, input.value.trim());
                if (appealResult.toUpperCase().startsWith('APPROVED')) {
                    GM_setValue(`ai_focus_cache_${currentVideoId}`, 'APPROVED_BY_APPEAL');
                    if (window.pauseInterval) { clearInterval(window.pauseInterval); window.pauseInterval = null; }
                    showToast("复议通过", "success"); mask.classList.remove('show'); setTimeout(() => mask.remove(), 300);
                    tryPlayVideo();
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
        try { 
            const urlObj = new URL(url);
            const match = urlObj.pathname.match(/\/video\/(BV\w+|av\d+)/i); 
            if (!match) return null;
            const p = urlObj.searchParams.get('p') || '1';
            return `${match[1]}_p${p}`;
        } catch(e) { return null; }
    };
    
    const getVideoInfo = () => {
        let title = document.querySelector('h1.video-title')?.innerText || document.querySelector('.video-title')?.innerText || '';
        let desc = document.querySelector('.desc-info-text, .video-desc, .basic-desc-info')?.innerText || document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
        let tags = Array.from(document.querySelectorAll('.tag-link, .tag-txt')).map(e => e.innerText.trim()).join(', ') || document.querySelector('meta[name="keywords"]')?.getAttribute('content') || '';
        return { title, desc, tags };
    };

    // ==========================================
    // 🚀 主执行程序
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

        const allowedCats = getAllowedCategories();
        const visaCfg = getVisaConfig();

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

            let isVisaApproved = allowedCats.includes(category) || category === 'APPROVED_BY_APPEAL';

            if (category === 'MUSIC') {
                let now = Date.now();
                let lastTime = GM_getValue('ai_focus_music_last_time', 0);
                let expiry = lastTime + visaCfg.duration * 60 * 1000;
                
                if (now < expiry) {
                    isVisaApproved = true;
                    let remaining = expiry - now;
                    console.log(`[哔哩哔哩审判庭] 音乐签证生效中，还剩 ${Math.floor(remaining/1000)} 秒`);
                    
                    if (window.musicTimer) clearTimeout(window.musicTimer);
                    window.musicTimer = setTimeout(() => {
                        showToast("🎵 音乐签证已到期，注意劳逸结合，恢复拦截！", "error");
                        if (!window.pauseInterval) window.pauseInterval = setInterval(forcePauseVideo, 100);
                        showBlocker('MUSIC', title, desc, tags, currentVideoId);
                    }, remaining);
                }
            }

            if (isVisaApproved) {
                if (window.pauseInterval) { clearInterval(window.pauseInterval); window.pauseInterval = null; }
                showToast(`允许通行`, "success");
                const mask = document.getElementById('ai-focus-mask');
                if (mask) { mask.classList.remove('show'); setTimeout(() => mask.remove(), 300); }
                tryPlayVideo();
            } else {
                if (!window.pauseInterval) { 
                    window.pauseInterval = setInterval(forcePauseVideo, 100); 
                }
                showBlocker(category, title, desc, tags, currentVideoId);
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
            if (window.musicTimer) { clearTimeout(window.musicTimer); window.musicTimer = null; } 
            
            triggerMainDebounced();
        }
    }).observe(document, {subtree: true, childList: true});

    window.addEventListener('load', () => { if (extractVideoId(location.href)) triggerMainDebounced(); });
})();