// ==UserScript==
// @name         哔哩哔哩审判庭（Bilibili Attention Guardian）
// @namespace    http://tampermonkey.net/
// @version      1.1.0
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
        model: GM_getValue('ai_focus_model', 'gpt-3.5-turbo')
    };

    // 默认允许的签证分类
    let ALLOWED_CATEGORIES = GM_getValue('ai_focus_allowed_categories', ['ACADEMIC', 'PRACTICAL', 'GAME_GUIDE', 'TECH_REVIEW']);

    // 分类字典（用于UI显示）
    const CATEGORY_MAP = {
        'ACADEMIC': '学术类视频',
        'PRACTICAL': '实用类视频',
        'GAME_GUIDE': '有意义的游戏视频',
        'TECH_REVIEW': '科技评测',
        'HIJACKING': '无意义注意力劫持',
        'TOXIC': '煽动对立内容'
    };

    // ==========================================
    // 🎨 M3 样式注入
    // ==========================================
    const injectM3Style = () => {
        if (document.getElementById('m3-focus-styles')) return;
        const style = document.createElement('style');
        style.id = 'm3-focus-styles';
        style.textContent = `
            :root {
                --md-sys-color-surface: #FDFDFE;
                --md-sys-color-on-surface: #1A1C1E;
                --md-sys-color-primary: #6750A4;
                --md-sys-color-on-primary: #FFFFFF;
                --md-sys-color-error-container: #FFDAD6;
                --md-sys-color-on-error-container: #410002;
                --md-sys-color-success-container: #C4EED0;
                --md-sys-color-on-success-container: #00391C;
                --md-sys-color-surface-variant: #E7E0EC;
                --md-sys-color-on-surface-variant: #49454F;
                --md-sys-elevation-3: 0px 4px 8px 3px rgba(0, 0, 0, 0.15);
            }
            .m3-overlay {
                position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                background: rgba(0, 0, 0, 0.65); backdrop-filter: blur(16px);
                z-index: 999999; display: flex; align-items: center; justify-content: center;
                font-family: system-ui, -apple-system, sans-serif;
                opacity: 0; transition: opacity 0.3s ease; pointer-events: none;
            }
            .m3-overlay.show { opacity: 1; pointer-events: auto; }

            .m3-card {
                background-color: var(--md-sys-color-surface); color: var(--md-sys-color-on-surface);
                border-radius: 28px; padding: 40px 32px; max-width: 420px; width: 90%; max-height: 90vh; overflow-y: auto;
                text-align: center; box-shadow: var(--md-sys-elevation-3);
                transform: translateY(20px); transition: transform 0.3s cubic-bezier(0.2, 0, 0, 1);
            }
            .m3-overlay.show .m3-card { transform: translateY(0); }

            .m3-title { font-size: 24px; font-weight: 600; margin: 0 0 16px 0; letter-spacing: 0.5px;}
            .m3-desc { font-size: 14px; line-height: 1.6; color: #44474E; margin-bottom: 24px; text-align: left; }
            .m3-chip {
                display: inline-block; padding: 6px 16px; border-radius: 8px;
                font-size: 12px; font-weight: 600; margin-bottom: 24px; letter-spacing: 0.5px;
                background-color: var(--md-sys-color-error-container); color: var(--md-sys-color-on-error-container);
            }

            .m3-button {
                background-color: var(--md-sys-color-on-surface); color: var(--md-sys-color-surface);
                border: none; border-radius: 100px; padding: 10px 24px; font-size: 14px; font-weight: 500;
                cursor: pointer; transition: background-color 0.2s; margin: 0 4px; letter-spacing: 0.2px;
            }
            .m3-button:hover:not(:disabled) { background-color: #313033; }
            .m3-button:disabled { opacity: 0.6; cursor: not-allowed; }
            .m3-button.primary { background-color: var(--md-sys-color-primary); color: var(--md-sys-color-on-primary); }
            .m3-button.primary:hover:not(:disabled) { background-color: #553F88; }
            .m3-button.tonal { background-color: var(--md-sys-color-surface-variant); color: var(--md-sys-color-on-surface-variant); }
            .m3-button.tonal:hover:not(:disabled) { background-color: #D0C9D6; }

            .m3-input-group { margin-bottom: 20px; text-align: left; }
            .m3-input-group label.group-title { display: block; font-size: 12px; font-weight: 600; margin-bottom: 8px; color: var(--md-sys-color-on-surface-variant); }
            .m3-input-group input[type="text"], .m3-input-group input[type="password"] {
                width: 100%; box-sizing: border-box; padding: 12px 16px;
                border: 1px solid #79747E; border-radius: 8px; font-size: 14px;
                background: transparent; color: var(--md-sys-color-on-surface); outline: none; transition: border 0.2s;
            }
            .m3-input-group input:focus { border: 2px solid var(--md-sys-color-primary); padding: 11px 15px; }

            .m3-checkbox-group { display: flex; flex-direction: column; gap: 10px; background: var(--md-sys-color-surface-variant); padding: 16px; border-radius: 12px;}
            .m3-checkbox-label { font-size: 14px; color: var(--md-sys-color-on-surface); display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: 500;}
            .m3-checkbox-label input { width: 18px; height: 18px; accent-color: var(--md-sys-color-primary); cursor: pointer;}

            .m3-textarea {
                width: 100%; box-sizing: border-box; padding: 16px;
                border: 1px solid #79747E; border-radius: 12px; font-size: 14px;
                background: transparent; color: var(--md-sys-color-on-surface); outline: none;
                resize: vertical; min-height: 100px; font-family: inherit; margin-bottom: 16px; line-height: 1.5;
            }
            .m3-textarea:focus { border: 2px solid var(--md-sys-color-primary); padding: 15px; }

            #m3-toast {
                position: fixed; top: 24px; left: 50%; transform: translateX(-50%) translateY(-20px);
                padding: 14px 28px; border-radius: 100px; font-family: system-ui, sans-serif;
                font-size: 14px; font-weight: 500; box-shadow: var(--md-sys-elevation-3);
                display: flex; align-items: center; gap: 16px; z-index: 9999999;
                opacity: 0; pointer-events: none; transition: all 0.3s cubic-bezier(0.2, 0, 0, 1);
            }
            #m3-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); pointer-events: auto; }

            #m3-toast.error { background-color: var(--md-sys-color-error-container); color: var(--md-sys-color-on-error-container); }
            #m3-toast.success { background-color: var(--md-sys-color-success-container); color: var(--md-sys-color-on-success-container); }

            .m3-toast-close { cursor: pointer; font-weight: 600; font-size: 16px; opacity: 0.6; transition: opacity 0.2s; }
            .m3-toast-close:hover { opacity: 1; }
        `;
        document.head.appendChild(style);
    };

    // ==========================================
    // 🔔 弹窗提示逻辑
    // ==========================================
    const showToast = (message, type = 'error') => {
        injectM3Style();
        let toast = document.getElementById('m3-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'm3-toast';
            document.body.appendChild(toast);
        }

        toast.className = type;
        toast.innerHTML = `
            <span>${message}</span>
            <span class="m3-toast-close" onclick="document.getElementById('m3-toast').classList.remove('show')">✕</span>
        `;

        void toast.offsetWidth;
        toast.classList.add('show');

        if (toast.hideTimer) clearTimeout(toast.hideTimer);
        const duration = message.length > 20 ? 8000 : 5000;
        toast.hideTimer = setTimeout(() => toast.classList.remove('show'), duration);
    };

    // ==========================================
    // ⚙️ 设置面板 UI 逻辑
    // ==========================================
    const openSettings = () => {
        injectM3Style();
        if (document.getElementById('m3-settings-mask')) return;

        const isChecked = (val) => ALLOWED_CATEGORIES.includes(val) ? 'checked' : '';

        const mask = document.createElement('div');
        mask.id = 'm3-settings-mask';
        mask.className = 'm3-overlay';
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

                <div class="m3-input-group">
                    <label class="group-title">API Key</label>
                    <input type="password" id="m3-cfg-key" value="${API_CONFIG.key}" placeholder="sk-...">
                </div>
                <div class="m3-input-group">
                    <label class="group-title">API Endpoint</label>
                    <input type="text" id="m3-cfg-endpoint" value="${API_CONFIG.endpoint}">
                </div>
                <div class="m3-input-group">
                    <label class="group-title">Model</label>
                    <input type="text" id="m3-cfg-model" value="${API_CONFIG.model}">
                </div>

                <div style="margin-top: 24px; display: flex; justify-content: center;">
                    <button class="m3-button tonal" id="m3-cfg-cancel">取消</button>
                    <button class="m3-button primary" id="m3-cfg-save">保存配置</button>
                </div>
            </div>
        `;
        document.body.appendChild(mask);
        setTimeout(() => mask.classList.add('show'), 10);

        document.getElementById('m3-cfg-cancel').onclick = () => {
            mask.classList.remove('show');
            setTimeout(() => mask.remove(), 300);
        };

        document.getElementById('m3-cfg-save').onclick = () => {
            const newKey = document.getElementById('m3-cfg-key').value.trim();
            const newEndpoint = document.getElementById('m3-cfg-endpoint').value.trim();
            const newModel = document.getElementById('m3-cfg-model').value.trim();

            if (!newKey) return showToast("API Key 不能为空", "error");

            // 保存勾选的分类
            const checkboxes = document.querySelectorAll('.m3-cat-cb');
            const newAllowed = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);

            GM_setValue('ai_focus_allowed_categories', newAllowed);
            ALLOWED_CATEGORIES = newAllowed;

            GM_setValue('ai_focus_key', newKey);
            GM_setValue('ai_focus_endpoint', newEndpoint);
            GM_setValue('ai_focus_model', newModel);

            API_CONFIG = { key: newKey, endpoint: newEndpoint, model: newModel };

            mask.classList.remove('show');
            setTimeout(() => mask.remove(), 300);
            showToast("配置已保存，将对下一个视频生效", "success");
        };
    };

    GM_registerMenuCommand("配置 AI 专注 API 与分类", openSettings);

    // ==========================================
    // 🧠 AI 判断逻辑 (初审 - 签证官)
    // ==========================================
    const checkVideoWithAI = (title, desc, tags, retryCount = 1) => {
        return new Promise((resolve, reject) => {
            if (!API_CONFIG.key) {
                showToast("未配置 API Key，请点击油猴插件菜单进行配置", "error");
                openSettings();
                return reject("Missing API Key");
            }

            const prompt = `
            你是一个严格的社交媒体注意力签证官，旨在分析用户观看的视频以保护其注意力。请分析以下视频信息，将其准确分类为以下6种之一：
            1. 学术类视频 (如数学课、高中学习经验分享、物理相关讨论等) -> 请输出：ACADEMIC
            2. 实用类视频 (如家具维修、生活技巧等) -> 请输出：PRACTICAL
            3. 有意义的游戏视频 (如建筑教程、生存实况、配队指南等) -> 请输出：GAME_GUIDE
            4. 科技评测类视频 (如电脑硬件评测、装机评测等) -> 请输出：TECH_REVIEW
            5. 无意义注意力劫持视频 (包括各种meme、纯娱乐视频、游戏meme视频) -> 请输出：HIJACKING
            6. 煽动对立的视频 (包括不限于男女对立、种族歧视、网左键政) -> 请输出：TOXIC

            【视频信息】
            标题：${title}
            简介：${desc}
            标签：${tags}

            注意：请仔细甄别，只允许返回对应的一个英文大写单词：ACADEMIC、PRACTICAL、GAME_GUIDE、TECH_REVIEW、HIJACKING 或 TOXIC。不要输出其他任何解释字符。
            有些时候，学术类视频和实用类视频可能会出现“标题党”的情况，请结合视频简介和TAG综合分析，避免误判。
            `;

            const sendRequest = (retriesLeft) => {
                GM_xmlhttpRequest({
                    method: "POST",
                    url: API_CONFIG.endpoint,
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${API_CONFIG.key}`
                    },
                    data: JSON.stringify({
                        model: API_CONFIG.model,
                        messages: [{ role: "user", content: prompt }],
                        temperature: 0.1
                    }),
                    onload: function(response) {
                        if (response.status !== 200) {
                            if (retriesLeft > 0) return setTimeout(() => sendRequest(retriesLeft - 1), 1000);
                            showToast(`签证处报错 (状态码: ${response.status})，请检查密钥或接口是否正确`, "error");
                            return reject("API Error");
                        }
                        try {
                            const res = JSON.parse(response.responseText);
                            // 提取大写匹配词
                            const content = res.choices[0].message.content.trim().toUpperCase();
                            const match = content.match(/ACADEMIC|PRACTICAL|GAME_GUIDE|TECH_REVIEW|HIJACKING|TOXIC/);
                            const result = match ? match[0] : 'HIJACKING'; // 默认 fallback
                            resolve(result);
                        } catch (e) {
                            showToast("签证处返回数据解析失败，请检查模型配置", "error");
                            reject("Parse Error");
                        }
                    },
                    onerror: function(error) {
                        if (retriesLeft > 0) {
                            console.log("[哔哩哔哩审判庭] 网络波动，尝试重连...");
                            return setTimeout(() => sendRequest(retriesLeft - 1), 1000);
                        }
                        showToast("签证处网络异常，可能是跨域阻断或网络故障", "error");
                        reject("Network Error");
                    }
                });
            };

            sendRequest(retryCount);
        });
    };

    // ==========================================
    // ⚖️ AI 审判逻辑 (复议 - 审判官)
    // ==========================================
    const appealVideoWithAI = (title, desc, tags, reason) => {
        return new Promise((resolve, reject) => {
            const prompt = `
            你是一个严格且仔细的注意力复审官，旨在保护用户注意力不被快餐视频劫持。用户试图观看一个被AI初审拦截的视频，现在她提交了复议申请。

            【视频信息】
            标题：${title}
            简介：${desc}
            标签：${tags}

            【用户的复议辩词】
            ${reason}

            【你的任务】
            为了防止一些“干货”视频因标题起得吸引眼球被误拦截，请结合视频的【标题】【简介】【标签】，语境和用户的理由综合地按照以下标准判断：

            【批准标准】
            下视频予以放行：
            1. 学术类视频 (如数学课、高中学习经验分享、历史分享、科普、物理学讨论等)
            2. 实用类视频 (如家具维修、生活技巧等)
            3. 有意义的游戏视频 (如建筑教程、生存实况、配队指南等长视频)
            4. 科技评测类视频 (如电脑硬件评测、装机评测等)

            【驳回标准】

            1. 无意义注意力劫持视频 (包括各种meme、纯娱乐视频、游戏meme视频)
            2. 煽动对立、仇恨的视频 (包括不限于男女对立、种族歧视、网左键政)

            【输出格式（严格遵守）】
            通过复议，请仅返回：APPROVED
            驳回申请，请返回：REJECTED|书面化的驳回理由（用中文简短、犀利地输出简要信息，限30字以内）
            千万不要输出多余格式。
            `;

            GM_xmlhttpRequest({
                method: "POST",
                url: API_CONFIG.endpoint,
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${API_CONFIG.key}`
                },
                data: JSON.stringify({
                    model: API_CONFIG.model,
                    messages: [{ role: "user", content: prompt }],
                    temperature: 0.1
                }),
                onload: function(response) {
                    if (response.status !== 200) {
                        return reject("API Error");
                    }
                    try {
                        const res = JSON.parse(response.responseText);
                        const result = res.choices[0].message.content.trim();
                        resolve(result);
                    } catch (e) {
                        reject("Parse Error");
                    }
                },
                onerror: function(error) {
                    reject("Network Error");
                }
            });
        });
    };


    // ==========================================
    // 🛡️ 遮罩 UI 逻辑 (新增初审占位符)
    // ==========================================
    const showPendingMask = () => {
        injectM3Style();
        let mask = document.getElementById('ai-focus-mask');
        if (!mask) {
            mask = document.createElement('div');
            mask.id = 'ai-focus-mask';
            mask.className = 'm3-overlay';
            document.body.appendChild(mask);
        }

        // 使用你原生的 UI 框架，但填入等待状态的文案
        mask.innerHTML = `
            <div class="m3-card">
                <h2 class="m3-title">哔哩哔哩审判庭</h2>
                <div class="m3-chip" style="background-color: var(--md-sys-color-surface-variant); color: var(--md-sys-color-on-surface-variant);">审查中...</div>
                <p class="m3-desc" style="text-align: center;">AI 审判官正在查阅该视频的卷宗，请稍候...</p>
            </div>
        `;
        setTimeout(() => mask.classList.add('show'), 10);

        // 【核心】瞬发暴力暂停循环，防止B站异步视频在底层悄悄播放
        if (!window.pauseInterval) {
            window.pauseInterval = setInterval(() => {
                const videoEle = document.querySelector('video');
                if (videoEle && !videoEle.paused) videoEle.pause();
            }, 100); // 每秒锁10次，绝对插翅难飞
        }
    };

    const showBlocker = (category, title, desc, tags) => {
        injectM3Style();
        // 修复：不要直接 return，而是复用刚才弹出的等待遮罩，直接替换里面的内容
        let mask = document.getElementById('ai-focus-mask');
        if (!mask) {
            mask = document.createElement('div');
            mask.id = 'ai-focus-mask';
            mask.className = 'm3-overlay';
            document.body.appendChild(mask);
        }

        let reasonText = CATEGORY_MAP[category] || "未授权分类";

        mask.innerHTML = `
            <div class="m3-card">
                <h2 class="m3-title">哔哩哔哩审判庭</h2>
                <div class="m3-chip">${reasonText}拦截</div>
                <p class="m3-desc">此视频命中你设定的拦截规则。若你认为该视频确有当前必须观看的价值，请向审判官提交复议申请。</p>
                <p class="m3-desc">小贴士：如果没事干的话，就关掉B站，去尝试诸如写作、运动、阅读这类有助于培养注意力的事情吧。</p>

                <div id="m3-initial-actions" style="display: flex; justify-content: center; gap: 8px;">
                    <button class="m3-button tonal" id="m3-go-back">返回上一页</button>
                    <button class="m3-button primary" id="m3-appeal-btn">向审判官申诉</button>
                </div>

                <div id="m3-appeal-section" style="display: none; margin-top: 8px;">
                    <textarea id="m3-appeal-reason" class="m3-textarea" placeholder="请输入你的抗辩理由..."></textarea>
                    <div style="display: flex; justify-content: center; gap: 8px;">
                        <button class="m3-button tonal" id="m3-appeal-cancel">取消申诉</button>
                        <button class="m3-button primary" id="m3-appeal-submit">提交辩词</button>
                    </div>
                </div>
            </div>
        `;
        setTimeout(() => mask.classList.add('show'), 10);

        const btnGoBack = document.getElementById('m3-go-back');
        const actionsInitial = document.getElementById('m3-initial-actions');
        const btnAppeal = document.getElementById('m3-appeal-btn');
        const sectionAppeal = document.getElementById('m3-appeal-section');
        const btnCancel = document.getElementById('m3-appeal-cancel');
        const btnSubmit = document.getElementById('m3-appeal-submit');
        const inputReason = document.getElementById('m3-appeal-reason');

        btnGoBack.onclick = () => {
            if (window.history.length > 1) {
                window.history.back();
            } else {
                window.close();
                setTimeout(() => {
                    showToast("这是新建标签页，请手动关闭当前窗口。", "error");
                }, 300);
            }
        };

        btnAppeal.onclick = () => {
            actionsInitial.style.display = 'none';
            sectionAppeal.style.display = 'block';
            inputReason.focus();
        };

        btnCancel.onclick = () => {
            sectionAppeal.style.display = 'none';
            actionsInitial.style.display = 'flex';
            inputReason.value = '';
        };

        btnSubmit.onclick = async () => {
            const userReason = inputReason.value.trim();
            if (!userReason) {
                return showToast("审判官拒绝接收空白辩词，请输入理由。", "error");
            }

            btnSubmit.innerText = "裁判中...";
            btnSubmit.disabled = true;
            btnCancel.disabled = true;
            inputReason.disabled = true;

            try {
                const appealResult = await appealVideoWithAI(title, desc, tags, userReason);

                if (appealResult.toUpperCase().startsWith('APPROVED')) {
                    showToast("审判结束。您的复议请求已被通过", "success");
                    mask.classList.remove('show');
                    setTimeout(() => mask.remove(), 300);
                    // 点击复议通过后，恢复视频播放
                    const videoEle = document.querySelector('video');
                    if (videoEle) videoEle.play();
                } else {
                    let rejectMessage = appealResult.split('|')[1] || appealResult.replace(/REJECTED/i, '').trim();
                    if (!rejectMessage) rejectMessage = "理由太牵强，休想蒙混过关！";

                    showToast("复议请求被驳回：" + rejectMessage, "error");

                    btnSubmit.innerText = "重新提交审判";
                    btnSubmit.disabled = false;
                    btnCancel.disabled = false;
                    inputReason.disabled = false;
                }
            } catch (error) {
                showToast("审判庭网络异常，请重试。", "error");
                btnSubmit.innerText = "提交审判";
                btnSubmit.disabled = false;
                btnCancel.disabled = false;
                inputReason.disabled = false;
            }
        };
    };

    // ==========================================
    // 🔍 核心 ID 与信息提取器 (底层 Meta 抓取)
    // ==========================================
    const extractVideoId = (url) => {
        try {
            const urlObj = new URL(url);
            if (urlObj.hostname.includes('bilibili.com')) {
                const match = urlObj.pathname.match(/\/video\/(BV\w+|av\d+)/i);
                return match ? match[1] : null;
            }
        } catch(e) {}
        return null;
    };

    const getVideoInfo = () => {
        let title = '';
        let desc = '';
        let tags = '';
        const host = window.location.hostname;

        const metaKeywords = document.querySelector('meta[name="keywords"]') || document.querySelector('meta[itemprop="keywords"]');
        if (metaKeywords) tags = metaKeywords.getAttribute('content') || '';

        const metaDesc = document.querySelector('meta[name="description"]') || document.querySelector('meta[itemprop="description"]');
        if (metaDesc) desc = metaDesc.getAttribute('content') || '';

        if (host.includes('bilibili.com')) {
            title = document.querySelector('h1.video-title')?.innerText || document.querySelector('.video-title')?.innerText || '';
            if (!desc) desc = document.querySelector('.desc-info-text, .video-desc, .basic-desc-info')?.innerText || '';
            if (!tags) tags = Array.from(document.querySelectorAll('.tag-link, .tag-txt')).map(e => e.innerText.trim()).join(', ');
        }

        return { title, desc, tags };
    };

    // ==========================================
    // 🚀 主执行程序 (布尔值底层逻辑判断)
    // ==========================================
    let currentProcessId = 0;

    const main = async () => {
        const processId = ++currentProcessId;

        // 这里保留 1500ms 等待，是为了确保 B 站把标题等数据渲染出来
        await new Promise(r => setTimeout(r, 1500));
        if (processId !== currentProcessId) return;

        const { title, desc, tags } = getVideoInfo();
        if (!title) return; // 如果还没加载出标题，下一次 observer 会重新触发 main

        console.log(`[哔哩哔哩审判庭] 捕获视频: ${title}`);
        console.log(`[哔哩哔哩审判庭] 捕获简介: ${desc ? desc.substring(0, 50) + '...' : '无简介'}`);
        console.log(`[哔哩哔哩审判庭] 捕获标签: ${tags}`);

        try {
            const category = await checkVideoWithAI(title, desc, tags);
            if (processId !== currentProcessId) return;

            console.log(`[哔哩哔哩审判庭] 签证官判定分类：${category}`);

            // 核心布尔值验证逻辑
            const isVisaApproved = ALLOWED_CATEGORIES.includes(category);

            if (isVisaApproved) {
                // 如果通过审查，必须清除我们设置的“死循环暂停”
                if (window.pauseInterval) { clearInterval(window.pauseInterval); window.pauseInterval = null; }

                const cnName = CATEGORY_MAP[category] || category;
                showToast(`临时访问签注已通过 [${cnName}]`, "success");

                // 移除“审查中”遮罩，并恢复播放
                const mask = document.getElementById('ai-focus-mask');
                if (mask) {
                    mask.classList.remove('show');
                    setTimeout(() => mask.remove(), 300);
                }
                const videoEle = document.querySelector('video');
                if (videoEle) videoEle.play();

            } else {
                // 如果被驳回，清除循环（因为即将调用你的拦截界面）
                if (window.pauseInterval) { clearInterval(window.pauseInterval); window.pauseInterval = null; }
                showBlocker(category, title, desc, tags);
            }

        } catch (error) {
            if (processId === currentProcessId) {
                console.error("[哔哩哔哩审判庭] 流程终止:", error);
                // 出现网络错误时，也要清除暂停，移除遮罩，避免彻底卡死
                if (window.pauseInterval) { clearInterval(window.pauseInterval); window.pauseInterval = null; }
                const mask = document.getElementById('ai-focus-mask');
                if (mask) mask.remove();
            }
        }
    };

    let debounceTimer = null;
    const triggerMainDebounced = () => {
        showPendingMask(); // 【核心改动】抛弃延迟，任何风吹草动立马拉起遮罩和视频暂停！
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => main(), 1000);
    };

    let lastVideoId = extractVideoId(location.href);

    new MutationObserver(() => {
        const currentVideoId = extractVideoId(location.href);
        if (currentVideoId !== lastVideoId) {
            lastVideoId = currentVideoId;

            // 路由发生跳转时，清理上一个视频留下的烂摊子
            const existingMask = document.getElementById('ai-focus-mask');
            if (existingMask) existingMask.remove();
            if (window.pauseInterval) { clearInterval(window.pauseInterval); window.pauseInterval = null; }

            // 如果跳转到了新的视频页，重新触发审查
            if (currentVideoId) {
                triggerMainDebounced();
            }
        }
    }).observe(document, {subtree: true, childList: true});

    window.addEventListener('load', () => {
        if (extractVideoId(location.href)) {
            triggerMainDebounced();
        }
    });

})();