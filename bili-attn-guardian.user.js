// ==UserScript==
// @name         哔哩哔哩审判庭（Bilibili Attention Guardian）
// @namespace    http://tampermonkey.net/
// @version      1.3.5
// @description  抓取视频标题、简介和标签(TAG)通过AI判断。支持自定义放行分类，保护注意力。
// @author       Misaka Milobo(By Gemini and ChatGPT)
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
        model: GM_getValue('ai_focus_model', 'gpt-5.5'),
        backupKey: GM_getValue('ai_focus_backup_key', ''),
        backupEndpoint: GM_getValue('ai_focus_backup_endpoint', ''),
        backupModel: GM_getValue('ai_focus_backup_model', '')
    });

    const APPROVED_BY_APPEAL = 'APPROVED_BY_APPEAL';
    const CATEGORY_OPTIONS = [
        { value: 'LEARNING-COMMON', label: '通用学习', description: '学习性内容或者和学业有关的内容，例如网课、高中学习经验分享、语言学习技巧、高中心态调整教程、自然科学、留学申请等，非计算机类' },
        { value: 'LEARNING-CS', label: '计算机学习', description: '计算机科学学习性内容，例如编程、Godot/C++、算法、操作系统、网络、数据库、AI 原理等' },
        { value: 'GAME-GUIDE', label: '游戏干货', description: '属于游戏类且偏干货的内容，如攻略、机制分析、版本快照、配装路线等，再例如 Minecraft 更新介绍' },
        { value: 'GAME-ENTERTAINMENT', label: '游戏娱乐', description: '属于游戏类且偏娱乐的内容，如游戏实况、玩梗、剪辑、整活、主播切片、搞笑合集等' },
        { value: 'TECH-NEWS', label: '科技资讯', description: '科技新闻、AI 快报、产品发布、行业动态等非教程内容' },
        { value: 'MUSIC', label: '音乐放松', description: '音乐放松类内容，如音乐、MV、翻唱、演奏' },
        { value: 'LOW_VALUE', label: '低价值注意力劫持', description: '标题党、爽文解说、MEME、玩梗鬼畜视频、地缘政治、新闻、吃瓜等' },
        { value: 'UNKNOWN', label: '信息不足', description: '信息不足或难以可靠判断' }
    ];
    const DEFAULT_ALLOWED_CATEGORIES = ['LEARNING-COMMON', 'LEARNING-CS', 'GAME-GUIDE', 'TECH-NEWS'];
    const VALID_CATEGORIES = CATEGORY_OPTIONS.map(option => option.value);
    const CATEGORY_MAP = CATEGORY_OPTIONS.reduce((map, option) => {
        map[option.value] = option.label;
        return map;
    }, { [APPROVED_BY_APPEAL]: '申诉通过' });
    const CATEGORY_ALIAS_MAP = {
        'ACADEMIC': 'LEARNING-COMMON',
        'PRACTICAL': 'LEARNING-COMMON',
        'GAME_GUIDE': 'GAME-GUIDE',
        'GAME_ENTERTAINMENT': 'GAME-ENTERTAINMENT',
        'TECH_REVIEW': 'TECH-NEWS',
        'TECH_NEWS': 'TECH-NEWS',
        'HIJACKING': 'LOW_VALUE',
        'TOXIC': 'LOW_VALUE',
        'LEARNING_COMMON': 'LEARNING-COMMON',
        'LEARNING_CS': 'LEARNING-CS',
        'LOW-VALUE': 'LOW_VALUE'
    };
    const normalizeCategory = (category) => {
        const rawCategory = String(category || '').trim().toUpperCase();
        if (rawCategory === APPROVED_BY_APPEAL) return APPROVED_BY_APPEAL;
        if (VALID_CATEGORIES.includes(rawCategory)) return rawCategory;
        const compactCategory = rawCategory.replace(/\s+/g, '-');
        if (VALID_CATEGORIES.includes(compactCategory)) return compactCategory;
        return CATEGORY_ALIAS_MAP[rawCategory] || CATEGORY_ALIAS_MAP[compactCategory] || null;
    };
    const normalizeAllowedCategories = (categories) => {
        const normalized = (Array.isArray(categories) ? categories : DEFAULT_ALLOWED_CATEGORIES)
            .map(normalizeCategory)
            .filter(category => category && category !== APPROVED_BY_APPEAL);
        return Array.from(new Set(normalized));
    };
    const getAllowedCategories = () => normalizeAllowedCategories(GM_getValue('ai_focus_allowed_categories', DEFAULT_ALLOWED_CATEGORIES));

    const getVisaConfig = () => ({
        duration: GM_getValue('ai_focus_music_duration', 5),
        cooldown: GM_getValue('ai_focus_music_cooldown', 60)
    });

    const LOG_PREFIX = '[哔哩哔哩审判庭]';
    const logInfo = (...args) => console.log(LOG_PREFIX, ...args);
    const logWarn = (...args) => console.warn(LOG_PREFIX, ...args);
    const logError = (message, error) => {
        if (error !== undefined) console.error(LOG_PREFIX, message, error);
        else console.error(LOG_PREFIX, message);
    };
    const getErrorMessage = (error) => {
        if (!error) return '未知错误';
        if (typeof error === 'string') return error;
        return error.message || String(error);
    };
    const normalizeText = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const uniqueJoin = (items) => Array.from(new Set(items.map(normalizeText).filter(Boolean))).join(', ');
    const appendUiElement = (element) => (document.body || document.documentElement).appendChild(element);
    const escapeHtml = (text) => String(text ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const normalizeConfidence = (value) => {
        const confidence = parseFloat(String(value ?? '').replace('%', ''));
        if (!Number.isFinite(confidence)) return 0;
        const normalized = confidence > 1 ? confidence / 100 : confidence;
        return Math.min(1, Math.max(0, normalized));
    };
    const formatConfidence = (confidence) => confidence ? `${Math.round(normalizeConfidence(confidence) * 100)}%` : '未知';
    const createReviewResult = (category, confidence = 0, reason = '') => {
        const normalizedCategory = normalizeCategory(category) || 'UNKNOWN';
        const fallbackReason = normalizedCategory === 'UNKNOWN'
            ? '视频信息不足或模型无法可靠判断，已按保守策略处理。'
            : `AI 判断该视频属于「${CATEGORY_MAP[normalizedCategory] || normalizedCategory}」。`;
        return {
            category: normalizedCategory,
            confidence: normalizeConfidence(confidence),
            reason: normalizeText(reason) || fallbackReason
        };
    };
    const serializeReviewResult = (review) => JSON.stringify({
        category: review.category,
        confidence: normalizeConfidence(review.confidence),
        reason: normalizeText(review.reason)
    });
    const extractJsonObject = (content) => {
        const rawContent = String(content || '').trim();
        const fenced = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/i);
        const source = (fenced ? fenced[1] : rawContent).trim();
        const start = source.indexOf('{');
        const end = source.lastIndexOf('}');
        return start >= 0 && end > start ? source.slice(start, end + 1) : '';
    };
    const parseVideoReviewResult = (content, useUnknownFallback = true) => {
        const rawContent = String(content || '').trim();
        const jsonText = extractJsonObject(rawContent);
        if (jsonText) {
            try {
                const parsed = JSON.parse(jsonText);
                const result = Array.isArray(parsed) ? parsed[0] : parsed;
                const category = normalizeCategory(result?.category);
                if (category) return createReviewResult(category, result?.confidence, result?.reason);
            } catch (e) {
                logWarn('AI 分类 JSON 解析失败，尝试兼容旧格式', e);
            }
        }

        const match = rawContent.match(/LEARNING[-_]COMMON|LEARNING[-_]CS|GAME[-_]GUIDE|GAME[-_]ENTERTAINMENT|TECH[-_]NEWS|LOW[_-]VALUE|UNKNOWN|MUSIC|ACADEMIC|PRACTICAL|GAME_GUIDE|TECH_REVIEW|HIJACKING|TOXIC/i);
        if (match) return createReviewResult(match[0], 0.5, 'AI 返回了旧式分类结果，缺少详细理由。');
        return useUnknownFallback ? createReviewResult('UNKNOWN', 0, 'AI 未按预期 JSON 格式返回，已按信息不足处理。') : null;
    };
    const normalizeReviewResult = (value) => {
        if (!value) return null;
        if (typeof value === 'object') return createReviewResult(value.category, value.confidence, value.reason);
        const rawValue = String(value).trim();
        const category = normalizeCategory(rawValue);
        if (category) return createReviewResult(category, category === APPROVED_BY_APPEAL ? 1 : 0.5, category === APPROVED_BY_APPEAL ? '申诉已通过，允许观看。' : '来自旧版缓存的分类结果。');
        if (rawValue.startsWith('{') || rawValue.includes('"category"')) return parseVideoReviewResult(rawValue, false);
        return null;
    };
    const getReviewDetailHtml = (review) => `
                <div style="background: var(--md-sys-color-surface-variant); color: var(--md-sys-color-on-surface-variant); border-radius: 12px; padding: 12px 14px; margin: 0 0 20px 0; text-align: left; font-size: 13px; line-height: 1.55;">
                    <div><strong>AI 理由：</strong>${escapeHtml(review.reason || '未提供')}</div>
                    <div><strong>置信度：</strong>${escapeHtml(formatConfidence(review.confidence))}</div>
                </div>`;

    const VIDEO_REVIEW_SYSTEM_PROMPT = `你是一个社交媒体视频分类审查员，负责根据视频标题、简介和标签判断视频内容类型。你的目标是帮助用户保护学习和工作注意力，而不是评价视频质量、立场或道德价值。

请严格在以下分类中选择一个 category：

1. LEARNING-COMMON：通用学习类。包括课程、讲座、知识体系讲解、考试备考、语言学习、数学、物理、化学、生物、历史、哲学、经济学、人文社科、自然科学等系统学习内容。不包含编程、计算机科学、软件开发、AI 开发、游戏开发等计算机内容；不包含泛娱乐科普、猎奇科普、新闻资讯或碎片化谈资。

2. LEARNING-CS：计算机科学与软件开发学习类。包括 C/C++/Python/JavaScript 等编程教程，Godot/Unity/Unreal 游戏开发教程，算法与数据结构，计算机组成原理，操作系统，网络，数据库，软件工程，前后端开发，运维，信息安全，AI/机器学习原理或工程实践，项目实战与问题排查。必须具有明确学习、教程、原理解释或实操价值；不包含 AI 快报、产品发布、行业新闻、单纯工具资讯。

3. GAME-GUIDE：游戏干货类。包括游戏攻略、机制分析、版本更新/快照介绍、Minecraft 更新快照解析、红石/建筑教程、配装、路线、地图、技巧、数据分析、效率提升等有明确信息价值的游戏内容。不包含游戏实况、玩梗、整活、搞笑剪辑、主播切片、纯娱乐挑战。

4. GAME-ENTERTAINMENT：游戏娱乐类。包括游戏实况、主播切片、玩梗视频、整活、搞笑剪辑、挑战娱乐、Reaction、二创混剪、游戏剧情吐槽等以娱乐为主要目的的游戏内容。即使包含少量技巧，只要核心是娱乐消费，也归入此类。

5. TECH-NEWS：科技非学习类。包括科技新闻、AI 快报、产品发布、硬件/软件资讯、行业动态、公司新闻、发布会总结、趋势观察、工具推荐或泛泛评测。不等同于教程；如果核心是在教用户掌握原理或技能，应归入 LEARNING-CS。

6. MUSIC：音乐放松类。包括音乐、MV、翻唱、演奏、音乐会、歌单、白噪音、环境音等以聆听和放松为目的的内容。

7. LOW_VALUE：低价值注意力劫持类。包括标题党、爽文解说、短平快刺激、MEME 玩梗、地缘政治、争议新闻、吃瓜、情绪煽动、对立引战、猎奇、阴谋论、营销号、明显为了消耗注意力而设计的内容。若视频同时包含一点知识信息但主要依赖冲突、猎奇、愤怒或爽感吸引点击，归入此类。

8. UNKNOWN：信息不足或难以可靠判断。标题、简介和标签无法支持稳定判断时使用；不要为了凑分类而猜测。

判断优先级：
- 明确教程、课程、系统知识、可复用技能优先归入学习类。
- 计算机/编程/软件/AI/Godot/C++ 等学习内容优先归入 LEARNING-CS，而不是 LEARNING-COMMON。
- 游戏内容先区分是否有明确攻略/机制/版本信息价值；没有则归入 GAME-ENTERTAINMENT。
- 新闻、快报、争议、地缘政治、吃瓜和情绪消费通常不是学习内容；符合注意力劫持特征时归入 LOW_VALUE。
- 不确定时使用 UNKNOWN。

你必须只输出一个 JSON 对象，不要输出 Markdown，不要输出额外解释。格式：{"category":"LEARNING-CS","confidence":0.86,"reason":"一句中文理由"}。confidence 必须是 0 到 1 的数字；reason 必须是简短中文，说明主要依据。不要输出 decision 字段。`;

    const createVideoReviewPrompt = (title, desc, tags) => `请根据以下 B 站视频信息进行分类，并严格按 system prompt 要求输出 JSON。

标题：${title || '(空)'}
简介：${desc || '(空)'}
标签：${tags || '(空)'}`;

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
                playPromise.catch(e => logWarn("浏览器阻止了自动播放，需用户手动点击", e));
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
            .m3-checkbox-label { font-size: 14px; color: var(--md-sys-color-on-surface); display: flex; align-items: flex-start; gap: 8px; cursor: pointer; font-weight: 500;}
            .m3-checkbox-label input { width: 18px; height: 18px; accent-color: var(--md-sys-color-primary); cursor: pointer;}
            .m3-checkbox-main { display: flex; flex-direction: column; gap: 2px; line-height: 1.35; }
            .m3-checkbox-detail { color: var(--md-sys-color-on-surface-variant); font-size: 12px; font-weight: 400; }
            .m3-textarea { width: 100%; box-sizing: border-box; padding: 16px; border: 1px solid #79747E; border-radius: 12px; font-size: 14px; background: transparent; color: var(--md-sys-color-on-surface); outline: none; resize: vertical; min-height: 100px; font-family: inherit; margin-bottom: 16px; line-height: 1.5; }
            .m3-textarea:focus { border: 2px solid var(--md-sys-color-primary); padding: 15px; }
            #m3-toast { position: fixed; top: 24px; left: 50%; transform: translateX(-50%) translateY(-20px); padding: 14px 28px; border-radius: 100px; font-family: system-ui, sans-serif; font-size: 14px; font-weight: 500; box-shadow: var(--md-sys-elevation-3); display: flex; align-items: center; gap: 16px; z-index: 9999999; opacity: 0; pointer-events: none; transition: all 0.3s cubic-bezier(0.2, 0, 0, 1); }
            #m3-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); pointer-events: auto; }
            #m3-toast.error { background-color: var(--md-sys-color-error-container); color: var(--md-sys-color-on-error-container); }
            #m3-toast.success { background-color: var(--md-sys-color-success-container); color: var(--md-sys-color-on-success-container); }
            .m3-toast-close { cursor: pointer; font-weight: 600; font-size: 16px; opacity: 0.6; transition: opacity 0.2s; }
            .m3-toast-close:hover { opacity: 1; }
            #m3-api-config-fab { position: fixed; left: 16px; bottom: 16px; width: 44px; height: 44px; border: none; border-radius: 16px; background: var(--md-sys-color-primary); color: var(--md-sys-color-on-primary); font-size: 23px; line-height: 1; display: flex; align-items: center; justify-content: center; box-shadow: var(--md-sys-elevation-3); cursor: pointer; z-index: 999998; transition: transform 0.2s ease, background-color 0.2s ease, opacity 0.2s ease; }
            #m3-api-config-fab:hover { background-color: #553F88; transform: translateY(-1px); }
            #m3-api-config-fab:active { transform: scale(0.96); }
        `;
        (document.head || document.documentElement).appendChild(style);
    };

    const showToast = (message, type = 'error') => {
        injectM3Style();
        let toast = document.getElementById('m3-toast');
        if (!toast) { toast = document.createElement('div'); toast.id = 'm3-toast'; appendUiElement(toast); }
        toast.className = type;
        toast.innerHTML = `<span>${message}</span><span class="m3-toast-close" onclick="document.getElementById('m3-toast').classList.remove('show')">✕</span>`;
        void toast.offsetWidth; toast.classList.add('show');
        if (toast.hideTimer) clearTimeout(toast.hideTimer);
        toast.hideTimer = setTimeout(() => toast.classList.remove('show'), message.length > 20 ? 8000 : 5000);
    };

    const getModelsEndpoint = (endpoint) => {
        const trimmedEndpoint = String(endpoint || '').trim();
        if (!trimmedEndpoint) return '';
        return trimmedEndpoint.replace(/\/chat\/completions\/?(\?.*)?$/i, '/models$1');
    };

    const getApiConfigFieldsHtml = (currentApi, idPrefix = 'm3-cfg') => `
                <div class="m3-input-group" style="border-top: 1px solid #E7E0EC; padding-top: 12px; margin-bottom: 12px;">
                    <label class="group-title">API Key</label><input type="password" id="${idPrefix}-key" value="${escapeHtml(currentApi.key)}" placeholder="sk-...">
                </div>
                <div class="m3-input-group" style="margin-bottom: 12px;">
                    <label class="group-title">API Endpoint (如: https://api.openai.com/v1/chat/completions)</label><input type="text" id="${idPrefix}-endpoint" value="${escapeHtml(currentApi.endpoint)}">
                </div>

                <div class="m3-input-group" style="margin-bottom: 12px;">
                    <label class="group-title">Model (大语言模型)</label>
                    <div style="display: flex; gap: 8px;">
                        <input type="text" id="${idPrefix}-model" value="${escapeHtml(currentApi.model)}" list="${idPrefix}-model-list" style="flex: 1;" placeholder="手动输入或点击右侧拉取">
                        <button class="m3-button tonal" id="${idPrefix}-fetch-models" style="margin: 0; padding: 0 16px; flex-shrink: 0;">拉取列表</button>
                    </div>
                    <datalist id="${idPrefix}-model-list"></datalist>
                </div>

                <div class="m3-input-group" style="border-top: 1px solid #E7E0EC; padding-top: 12px; margin-bottom: 12px;">
                    <label class="group-title">备用 API Key（可选，仅主 API 失败时使用）</label><input type="password" id="${idPrefix}-backup-key" value="${escapeHtml(currentApi.backupKey)}" placeholder="sk-...">
                </div>
                <div class="m3-input-group" style="margin-bottom: 12px;">
                    <label class="group-title">备用 API Endpoint</label><input type="text" id="${idPrefix}-backup-endpoint" value="${escapeHtml(currentApi.backupEndpoint)}" placeholder="https://backup.example.com/v1/chat/completions">
                </div>
                <div class="m3-input-group" style="margin-bottom: 12px;">
                    <label class="group-title">备用 Model</label>
                    <div style="display: flex; gap: 8px;">
                        <input type="text" id="${idPrefix}-backup-model" value="${escapeHtml(currentApi.backupModel)}" list="${idPrefix}-backup-model-list" style="flex: 1;" placeholder="备用模型名称">
                        <button class="m3-button tonal" id="${idPrefix}-fetch-backup-models" style="margin: 0; padding: 0 16px; flex-shrink: 0;">拉取列表</button>
                    </div>
                    <datalist id="${idPrefix}-backup-model-list"></datalist>
                </div>`;

    const fetchModelsForConfig = ({ key, endpoint, button, datalist, modelInput, targetLabel }) => {
        if (!key || !endpoint) return showToast(`请先填写 ${targetLabel} API Key 和 Endpoint`, "error");

        const modelsUrl = getModelsEndpoint(endpoint);
        const defaultButtonText = button.innerText;
        button.innerText = "拉取中...";
        button.disabled = true;

        GM_xmlhttpRequest({
            method: "GET",
            url: modelsUrl,
            headers: {
                "Authorization": `Bearer ${key}`,
                "Content-Type": "application/json"
            },
            onload: function(response) {
                button.innerText = defaultButtonText;
                button.disabled = false;
                if (response.status === 200) {
                    try {
                        const resJson = JSON.parse(response.responseText);
                        const modelIds = (resJson.data || []).map(m => m?.id).filter(Boolean);
                        const uniqueModelIds = Array.from(new Set(modelIds)).sort();
                        if (uniqueModelIds.length === 0) return showToast(`${targetLabel} 拉取成功，但该供应商模型列表为空`, "error");

                        datalist.innerHTML = '';
                        uniqueModelIds.forEach(modelId => {
                            const option = document.createElement('option');
                            option.value = modelId;
                            datalist.appendChild(option);
                        });

                        showToast(`✅ ${targetLabel} 成功获取 ${uniqueModelIds.length} 个模型！请点击输入框下拉选择。`, "success");
                        modelInput.value = "";
                        modelInput.focus();
                        modelInput.click();
                    } catch (e) {
                        logError(`${targetLabel} 模型列表解析失败`, e);
                        showToast("解析数据失败，API 格式不兼容标准规范", "error");
                    }
                } else {
                    logError(`${targetLabel} 模型列表拉取失败，状态码: ${response.status}`, response.responseText);
                    showToast(`${targetLabel} 拉取失败，状态码: ${response.status}`, "error");
                }
            },
            onerror: function(error) {
                button.innerText = defaultButtonText;
                button.disabled = false;
                logError(`${targetLabel} 模型列表网络请求失败`, error);
                showToast(`${targetLabel} 网络请求失败，请检查网络或跨域限制`, "error");
            }
        });
    };

    const bindModelFetchButton = ({ idPrefix, backup = false, targetLabel }) => {
        const suffix = backup ? 'backup-' : '';
        const button = document.getElementById(`${idPrefix}-fetch-${suffix}models`);
        if (!button) return;
        button.onclick = () => {
            const keyInput = document.getElementById(`${idPrefix}-${suffix}key`);
            const endpointInput = document.getElementById(`${idPrefix}-${suffix}endpoint`);
            const modelInput = document.getElementById(`${idPrefix}-${suffix}model`);
            const datalist = document.getElementById(`${idPrefix}-${suffix}model-list`);
            if (!keyInput || !endpointInput || !modelInput || !datalist) return showToast("配置表单初始化失败", "error");
            fetchModelsForConfig({
                key: keyInput.value.trim(),
                endpoint: endpointInput.value.trim(),
                button,
                datalist,
                modelInput,
                targetLabel
            });
        };
    };

    const bindApiConfigModelFetchers = (idPrefix = 'm3-cfg') => {
        bindModelFetchButton({ idPrefix, targetLabel: '主 API' });
        bindModelFetchButton({ idPrefix, backup: true, targetLabel: '备用 API' });
    };

    const readApiConfigFromForm = (idPrefix = 'm3-cfg') => {
        const readInput = (suffix) => document.getElementById(`${idPrefix}-${suffix}`)?.value.trim() || '';
        return {
            key: readInput('key'),
            endpoint: readInput('endpoint'),
            model: readInput('model'),
            backupKey: readInput('backup-key'),
            backupEndpoint: readInput('backup-endpoint'),
            backupModel: readInput('backup-model')
        };
    };

    const validateAndSaveApiConfigFromForm = (idPrefix = 'm3-cfg') => {
        const api = readApiConfigFromForm(idPrefix);
        if (!api.key) { showToast("API Key 不能为空", "error"); return false; }
        if (!api.endpoint) { showToast("API Endpoint 不能为空", "error"); return false; }
        if (!api.model) { showToast("模型名称不能为空", "error"); return false; }
        const hasAnyBackupConfig = Boolean(api.backupKey || api.backupEndpoint || api.backupModel);
        if (hasAnyBackupConfig && (!api.backupKey || !api.backupEndpoint || !api.backupModel)) {
            showToast("备用 API 需同时填写 Key、Endpoint 和 Model", "error");
            return false;
        }

        GM_setValue('ai_focus_key', api.key);
        GM_setValue('ai_focus_endpoint', api.endpoint);
        GM_setValue('ai_focus_model', api.model);
        GM_setValue('ai_focus_backup_key', api.backupKey);
        GM_setValue('ai_focus_backup_endpoint', api.backupEndpoint);
        GM_setValue('ai_focus_backup_model', api.backupModel);
        return true;
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
        const categoryCheckboxHtml = CATEGORY_OPTIONS.map(option => `
                        <label class="m3-checkbox-label">
                            <input type="checkbox" value="${option.value}" class="m3-cat-cb" ${isChecked(option.value)}>
                            <span class="m3-checkbox-main"><span>${option.label}</span><span class="m3-checkbox-detail">${option.description}</span></span>
                        </label>`).join('');
        const mask = document.createElement('div'); mask.id = 'm3-settings-mask'; mask.className = 'm3-overlay';
        mask.innerHTML = `
            <div class="m3-card" style="max-height: 95vh;">
                <h2 class="m3-title">审判庭签证配置</h2>
                <div class="m3-input-group" style="margin-bottom: 12px;">
                    <label class="group-title">允许无条件通过的分类 (不限时)：</label>
                    <div class="m3-checkbox-group" style="padding: 12px;">
${categoryCheckboxHtml}
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
${getApiConfigFieldsHtml(currentApi, 'm3-cfg')}

                <div style="margin-top: 16px; display: flex; justify-content: center;"><button class="m3-button tonal" id="m3-cfg-cancel">取消</button><button class="m3-button primary" id="m3-cfg-save">保存配置</button></div>
            </div>
        `;
        appendUiElement(mask);
        setTimeout(() => mask.classList.add('show'), 10);

        document.getElementById('m3-cfg-cancel').onclick = () => { mask.classList.remove('show'); setTimeout(() => mask.remove(), 300); };
        bindApiConfigModelFetchers('m3-cfg');

        // --- 保存逻辑 ---
        document.getElementById('m3-cfg-save').onclick = () => {
            if (!validateAndSaveApiConfigFromForm('m3-cfg')) return;

            let nVal = parseInt(document.getElementById('m3-cfg-music-duration').value) || 5;
            if (nVal < 1) nVal = 1; if (nVal > 10) nVal = 10;
            let mVal = parseInt(document.getElementById('m3-cfg-music-cooldown').value) || 60;
            if (mVal < 1) mVal = 1;

            const newAllowed = Array.from(document.querySelectorAll('.m3-cat-cb')).filter(cb => cb.checked).map(cb => cb.value);

            GM_setValue('ai_focus_allowed_categories', newAllowed);
            GM_setValue('ai_focus_music_duration', nVal);
            GM_setValue('ai_focus_music_cooldown', mVal);

            mask.classList.remove('show'); setTimeout(() => mask.remove(), 300); showToast("配置已保存", "success");
        };
    };

    const openApiSettings = () => {
        injectM3Style();
        if (document.getElementById('m3-api-settings-mask')) return;
        const currentApi = getApiConfig();
        const mask = document.createElement('div'); mask.id = 'm3-api-settings-mask'; mask.className = 'm3-overlay';
        mask.innerHTML = `
            <div class="m3-card" style="max-height: 95vh;">
                <h2 class="m3-title">API 配置</h2>
                <p class="m3-desc" style="text-align: center; margin-bottom: 12px;">修改AI API相关设置</p>
${getApiConfigFieldsHtml(currentApi, 'm3-api-cfg')}
                <div style="margin-top: 16px; display: flex; justify-content: center;"><button class="m3-button tonal" id="m3-api-cfg-cancel">取消</button><button class="m3-button primary" id="m3-api-cfg-save">保存 API 配置</button></div>
            </div>
        `;
        appendUiElement(mask);
        setTimeout(() => mask.classList.add('show'), 10);
        document.getElementById('m3-api-cfg-cancel').onclick = () => { mask.classList.remove('show'); setTimeout(() => mask.remove(), 300); };
        bindApiConfigModelFetchers('m3-api-cfg');
        document.getElementById('m3-api-cfg-save').onclick = () => {
            if (!validateAndSaveApiConfigFromForm('m3-api-cfg')) return;
            mask.classList.remove('show'); setTimeout(() => mask.remove(), 300); showToast("API 配置已保存", "success");
        };
    };

    const ensureApiConfigFab = () => {
        injectM3Style();
        if (document.getElementById('m3-api-config-fab')) return;
        const fab = document.createElement('button');
        fab.id = 'm3-api-config-fab';
        fab.type = 'button';
        fab.title = '打开审判庭 API 配置';
        fab.setAttribute('aria-label', '打开审判庭 API 配置');
        fab.textContent = '⚖';
        fab.onclick = openApiSettings;
        appendUiElement(fab);
    };

    GM_registerMenuCommand("配置 AI 专注 API 与分类", openSettings);
    GM_registerMenuCommand("配置 AI API（仅 API）", openApiSettings);

    // ==========================================
    // 🧠 AI 判断逻辑
    // ==========================================
    const createPrimaryApiTarget = (api) => ({
        name: '主 API',
        key: api.key,
        endpoint: api.endpoint,
        model: api.model
    });

    const createBackupApiTarget = (api) => {
        if (!api.backupKey || !api.backupEndpoint || !api.backupModel) return null;
        return {
            name: '备用 API',
            key: api.backupKey,
            endpoint: api.backupEndpoint,
            model: api.backupModel
        };
    };

    const requestChatCompletionOnce = (target, messages, contextLabel, temperature = 0.1) => {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: target.endpoint,
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${target.key}` },
                data: JSON.stringify({ model: target.model, messages, temperature }),
                timeout: 30000,
                onload: function(response) {
                    if (response.status !== 200) {
                        reject(new Error(`${target.name} ${contextLabel}失败，状态码 ${response.status}: ${(response.responseText || '').slice(0, 300)}`));
                        return;
                    }
                    try {
                        const res = JSON.parse(response.responseText);
                        const content = res.choices?.[0]?.message?.content?.trim();
                        if (!content) throw new Error(`${target.name} ${contextLabel}响应缺少 choices[0].message.content`);
                        resolve(content);
                    } catch (e) {
                        reject(e);
                    }
                },
                onerror: function(error) {
                    const networkError = new Error(`${target.name} ${contextLabel}网络异常`);
                    networkError.detail = error;
                    reject(networkError);
                },
                ontimeout: function() {
                    reject(new Error(`${target.name} ${contextLabel}请求超时`));
                }
            });
        });
    };

    const requestChatCompletionWithRetry = (target, messages, contextLabel, retryCount = 1, temperature = 0.1) => {
        return new Promise((resolve, reject) => {
            const sendRequest = (retriesLeft) => {
                requestChatCompletionOnce(target, messages, contextLabel, temperature)
                    .then(resolve)
                    .catch(error => {
                        if (retriesLeft > 0) {
                            logWarn(`${target.name} ${contextLabel}失败，1 秒后重试`, error);
                            setTimeout(() => sendRequest(retriesLeft - 1), 1000);
                        } else {
                            reject(error);
                        }
                    });
            };
            sendRequest(retryCount);
        });
    };

    const notifyBackupApiUsage = (contextLabel, primaryError, backupTarget) => {
        const message = `主 API ${contextLabel}失败，已切换备用 API`;
        showToast(message, "error");
        logWarn(`${message}。备用 Endpoint: ${backupTarget.endpoint}，备用 Model: ${backupTarget.model}`, primaryError);
    };

    const requestChatCompletion = async (messages, contextLabel, retryCount = 1, temperature = 0.1) => {
        const api = getApiConfig();
        if (!api.key) {
            const error = new Error("未配置 API Key");
            logError(`${contextLabel}失败`, error);
            showToast("未配置 API Key", "error");
            openApiSettings();
            throw error;
        }
        if (!api.endpoint) {
            const error = new Error("未配置 API Endpoint");
            logError(`${contextLabel}失败`, error);
            openApiSettings();
            throw error;
        }
        if (!api.model) {
            const error = new Error("未配置模型名称");
            logError(`${contextLabel}失败`, error);
            openApiSettings();
            throw error;
        }

        const primaryTarget = createPrimaryApiTarget(api);
        const backupTarget = createBackupApiTarget(api);

        try {
            return await requestChatCompletionWithRetry(primaryTarget, messages, contextLabel, retryCount, temperature);
        } catch (primaryError) {
            logError(`${primaryTarget.name} ${contextLabel}最终失败`, primaryError);
            if (!backupTarget) throw primaryError;

            notifyBackupApiUsage(contextLabel, primaryError, backupTarget);
            try {
                return await requestChatCompletionWithRetry(backupTarget, messages, contextLabel, retryCount, temperature);
            } catch (backupError) {
                logError(`${backupTarget.name} ${contextLabel}也失败`, backupError);
                throw backupError;
            }
        }
    };

    const checkVideoWithAI = async (title, desc, tags, retryCount = 1) => {
        const prompt = createVideoReviewPrompt(title, desc, tags);
        const content = await requestChatCompletion([
            { role: "system", content: VIDEO_REVIEW_SYSTEM_PROMPT },
            { role: "user", content: prompt }
        ], "AI 初审", retryCount);
        const review = parseVideoReviewResult(content);
        logInfo(`AI 分类结果: ${review.category}，置信度 ${formatConfidence(review.confidence)}，理由：${review.reason}`);
        return review;
    };

    const appealVideoWithAI = async (title, desc, tags, reason, retryCount = 1) => {
        const prompt = `复审官。基于视频和用户理由判断。批准回复:APPROVED，驳回回复:REJECTED|理由。标题:${title} 简介:${desc} 标签:${tags} 理由:${reason}`;
        return requestChatCompletion([{ role: "user", content: prompt }], "AI 复审", retryCount);
    };

    // ==========================================
    // 🛡️ 遮罩 UI 逻辑 
    // ==========================================
    const showPendingMask = () => {
        injectM3Style();
        let mask = document.getElementById('ai-focus-mask');
        if (!mask) { mask = document.createElement('div'); mask.id = 'ai-focus-mask'; mask.className = 'm3-overlay'; appendUiElement(mask); }
        mask.innerHTML = `<div class="m3-card"><h2 class="m3-title">哔哩哔哩审判庭</h2><div class="m3-chip" style="background-color: var(--md-sys-color-surface-variant); color: var(--md-sys-color-on-surface-variant);">审查中...</div><p class="m3-desc" style="text-align: center;">AI 审判官正在查阅该视频的卷宗，请稍候...</p></div>`;
        setTimeout(() => mask.classList.add('show'), 10);
        if (!window.pauseInterval) window.pauseInterval = setInterval(forcePauseVideo, 100);
    };

    const showErrorMask = (message, error) => {
        logError(message, error);
        injectM3Style();
        let mask = document.getElementById('ai-focus-mask');
        if (!mask) { mask = document.createElement('div'); mask.id = 'ai-focus-mask'; mask.className = 'm3-overlay'; appendUiElement(mask); }
        mask.innerHTML = `
            <div class="m3-card">
                <h2 class="m3-title">哔哩哔哩审判庭</h2>
                <div class="m3-chip">审查异常</div>
                <p class="m3-desc" style="text-align: center;">${message}<br>为避免注意力防线失效，视频将继续保持屏蔽。</p>
                <div style="display: flex; justify-content: center; flex-wrap: wrap; gap: 8px;">
                    <button class="m3-button tonal" id="m3-error-settings">打开配置</button>
                    <button class="m3-button primary" id="m3-error-retry">重新审查</button>
                </div>
            </div>`;
        setTimeout(() => mask.classList.add('show'), 10);
        if (!window.pauseInterval) window.pauseInterval = setInterval(forcePauseVideo, 100);
        showToast(message, "error");
        document.getElementById('m3-error-settings').onclick = openApiSettings;
        document.getElementById('m3-error-retry').onclick = () => triggerMainDebounced(true);
    };

    const showBlocker = (reviewInput, title, desc, tags, currentVideoId) => {
        injectM3Style();
        let mask = document.getElementById('ai-focus-mask');
        if (!mask) { mask = document.createElement('div'); mask.id = 'ai-focus-mask'; mask.className = 'm3-overlay'; appendUiElement(mask); }

        const review = normalizeReviewResult(reviewInput) || createReviewResult('UNKNOWN', 0, '分类结果不可用，已按保守策略拦截。');
        const category = review.category;
        const reviewDetailHtml = getReviewDetailHtml(review);
        
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
                ${reviewDetailHtml}
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
                    showBlocker(review, title, desc, tags, currentVideoId);
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
                    GM_setValue(`ai_focus_cache_${currentVideoId}`, serializeReviewResult(createReviewResult(APPROVED_BY_APPEAL, 1, '申诉已通过，允许观看。')));
                    if (window.pauseInterval) { clearInterval(window.pauseInterval); window.pauseInterval = null; }
                    showToast("复议通过", "success"); mask.classList.remove('show'); setTimeout(() => mask.remove(), 300);
                    tryPlayVideo();
                } else {
                    showToast("驳回：" + (appealResult.split('|')[1] || "理由牵强"), "error");
                    btn.innerText = "重新提交"; btn.disabled = false; input.disabled = false;
                }
            } catch (e) { logError("申诉流程异常", e); showToast("网络异常，申诉未完成", "error"); btn.innerText = "提交"; btn.disabled = false; input.disabled = false; }
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
        } catch(e) { logError("解析视频 ID 失败", e); return null; }
    };
    
    const getVideoInfo = () => {
        let title = normalizeText(document.querySelector('h1.video-title')?.innerText || document.querySelector('.video-title')?.innerText || document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '');
        let desc = normalizeText(document.querySelector('.desc-info-text, .video-desc, .basic-desc-info')?.innerText || document.querySelector('meta[name="description"]')?.getAttribute('content') || '');
        const tagSelectors = '.tag-link, .tag-txt, .video-tag, .video-tag-container a, .video-tag-container .tag, .tag-panel a';
        const domTags = Array.from(document.querySelectorAll(tagSelectors)).map(e => e.innerText || e.textContent);
        const metaTags = (document.querySelector('meta[name="keywords"]')?.getAttribute('content') || '').split(/[,，]/);
        let tags = uniqueJoin(domTags) || uniqueJoin(metaTags);
        return { title, desc, tags };
    };

    const logVideoInfo = ({ title, desc, tags }) => {
        if (console.groupCollapsed) console.groupCollapsed(`${LOG_PREFIX} 视频信息抓取结果`);
        logInfo("标题:", title || "(空)");
        logInfo("简介:", desc || "(空)");
        logInfo("TAG:", tags || "(空)");
        if (!tags) logWarn("未抓取到 TAG，已继续使用标题和简介进行审查");
        if (console.groupEnd) console.groupEnd();
    };

    // ==========================================
    // 🚀 主执行程序
    // ==========================================
    let currentProcessId = 0;
    const main = async () => {
        const processId = ++currentProcessId;
        const currentVideoId = extractVideoId(location.href);
        if (!currentVideoId) return;

        try {
            let info = getVideoInfo();
            let titleReadyAt = -1;
            for(let i=0; i<80; i++) {
                if (processId !== currentProcessId) return;
                if (info.title && titleReadyAt < 0) titleReadyAt = i;
                if (info.title && (info.tags || i - titleReadyAt >= 20)) break;
                await new Promise(r => setTimeout(r, 150)); 
                info = getVideoInfo();
            }
            if (!info.title) throw new Error("无法抓取视频标题，页面可能仍未加载完成");
            if (processId !== currentProcessId) return;
            logVideoInfo(info);

            const { title, desc, tags } = info;
            const allowedCats = getAllowedCategories();
            const visaCfg = getVisaConfig();
            const cacheKey = `ai_focus_cache_${currentVideoId}`;
            const cachedValue = GM_getValue(cacheKey, null);
            let review = normalizeReviewResult(cachedValue);

            if (review) {
                logInfo(`⚡ 命中本地缓存，0延迟放行/拦截: ${review.category}`);
                if (typeof cachedValue === 'string' && !cachedValue.trim().startsWith('{')) {
                    GM_setValue(cacheKey, serializeReviewResult(review));
                }
            } else {
                logInfo("🔍 未命中缓存，呼叫AI审判官...");
                review = await checkVideoWithAI(title, desc, tags);
                if (processId !== currentProcessId) return;
                GM_setValue(cacheKey, serializeReviewResult(review)); 
            }

            const category = review.category;

            let isVisaApproved = allowedCats.includes(category) || category === APPROVED_BY_APPEAL;

            if (category === 'MUSIC') {
                let now = Date.now();
                let lastTime = GM_getValue('ai_focus_music_last_time', 0);
                let expiry = lastTime + visaCfg.duration * 60 * 1000;
                
                if (now < expiry) {
                    isVisaApproved = true;
                    let remaining = expiry - now;
                    logInfo(`音乐签证生效中，还剩 ${Math.floor(remaining/1000)} 秒`);
                    
                    if (window.musicTimer) clearTimeout(window.musicTimer);
                    window.musicTimer = setTimeout(() => {
                        showToast("🎵 音乐签证已到期，注意劳逸结合，恢复拦截！", "error");
                        if (!window.pauseInterval) window.pauseInterval = setInterval(forcePauseVideo, 100);
                        showBlocker(review, title, desc, tags, currentVideoId);
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
                showBlocker(review, title, desc, tags, currentVideoId);
            }

        } catch (error) {
            if (processId === currentProcessId) {
                showErrorMask(`审查失败：${getErrorMessage(error)}`, error);
            }
        }
    };

    let debounceTimer = null;
    let scheduledVideoId = null;
    const triggerMainDebounced = (force = false) => {
        const currentVideoId = extractVideoId(location.href);
        if (!currentVideoId) return;
        if (!force && scheduledVideoId === currentVideoId) return;
        scheduledVideoId = currentVideoId;
        showPendingMask();
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => main(), 50);
    };

    let lastVideoId = extractVideoId(location.href);
    const resetRuntimeForNavigation = () => {
        currentProcessId++;
        scheduledVideoId = null;
        const existingMask = document.getElementById('ai-focus-mask'); if (existingMask) existingMask.remove();
        if (window.pauseInterval) { clearInterval(window.pauseInterval); window.pauseInterval = null; }
        if (window.musicTimer) { clearTimeout(window.musicTimer); window.musicTimer = null; }
    };

    const handleVideoRouteChange = () => {
        ensureApiConfigFab();
        const currentVideoId = extractVideoId(location.href);
        if (currentVideoId && currentVideoId !== lastVideoId) {
            lastVideoId = currentVideoId;
            resetRuntimeForNavigation();
            triggerMainDebounced();
        }
    };

    new MutationObserver(handleVideoRouteChange).observe(document, {subtree: true, childList: true});

    ['pushState', 'replaceState'].forEach(methodName => {
        const original = history[methodName];
        history[methodName] = function(...args) {
            const result = original.apply(this, args);
            setTimeout(handleVideoRouteChange, 0);
            return result;
        };
    });

    const startGuardian = () => {
        ensureApiConfigFab();
        const currentVideoId = extractVideoId(location.href);
        if (!currentVideoId) return;
        lastVideoId = currentVideoId;
        triggerMainDebounced();
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startGuardian, { once: true });
    else setTimeout(startGuardian, 0);
    window.addEventListener('load', startGuardian);
    window.addEventListener('popstate', () => setTimeout(handleVideoRouteChange, 0));
    setTimeout(startGuardian, 1000);
    setTimeout(startGuardian, 3000);
})();