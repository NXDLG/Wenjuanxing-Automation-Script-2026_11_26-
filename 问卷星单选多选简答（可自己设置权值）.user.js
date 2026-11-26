// ==UserScript==
// @name         问卷星自动随机答题
// @version      2.3
// @description  自动随机填写问卷星 vm 版单选问卷并自动提交，无需手动点击；每提交成功一份后自动刷新进入下一份，可无限循环；遇到阿里云安全验证会自动暂停并提示；提交后跳到 completemobile2 等完成页会自动跳回问卷继续
// @author       原版作者：ZainCheung；本版基于其项目修改
// @copyright    原版 2019-2020 ZainCheung，Apache License 2.0
// @license      Apache-2.0
// @homepageURL  https://github.com/ZainCheung/wenjuanxin
// @include      https://v.wjx.cn/vm/*.aspx*
// @include      https://www.wjx.cn/vm/*.aspx*
// @include      https://v.wjx.cn/wjx/join/*.aspx*
// @include      https://www.wjx.cn/wjx/join/*.aspx*
// @include      https://www.wjx.cn/jq/*.aspx
// @include      https://www.wjx.cn/m/*.aspx
// @include      https://www.wjx.cn/hj/*.aspx
// @grant        none
// @namespace    http://tampermonkey.net/
// ==/UserScript==

/*
 * ======================== 来源声明（务必保留） ========================
 * 本项目改自开源项目 ZainCheung/wenjuanxin：
 *     https://github.com/ZainCheung/wenjuanxin
 * 上游作者：ZainCheung（依据 Apache License 2.0 发布）
 * 上游 README 注明其更早来源为 tignioj 的开源项目：
 *     https://github.com/tignioj
 *
 * 本版本（v2.1）在上游基础上修改：适配 vm 版问卷、循环提交与去重计数、
 * 控制面板、completemobile2 等完成页自动跳回、阿里云智能验证处理、
 * 多选题随机勾选、填空/简答题按答案库随机填入，以及
 * 单选/多选/简答三种题型都支持按权重抽取（权重 0 = 永不选）。
 * 再分发或再修改时，请保留本段来源声明与上游的 Apache-2.0 许可说明。
 *
 * ⚠️ 本脚本为“每道题独立随机”作答，产出的是随机数据：存在前后矛盾、
 *    选项分布均匀、答题时长异常等明显问题，没有统计分析价值，也可能
 *    被问卷平台判定为无效答卷整批删除。请勿当作真实调研数据使用。
 * ==================================================================
 */

/*
 * ============================ 使用说明 ============================
 * 打开问卷链接（例如 https://v.wjx.cn/vm/OSVkDa2.aspx）后，脚本会自动：
 *   1. 随机填写页面上所有可见的题目（单选 / 多选 / 填空简答）；
 *   2. 自动点击「提交」按钮；
 *   3. 提交成功后等待 intervalMs 毫秒，自动刷新页面开始下一份；
 *   4. 一直循环，直到达到 maxRounds（0 表示不限次数）。
 *
 * 不再需要点任何按钮。右下角会显示控制面板（已提交份数 / 暂停 / 立即提交）。
 *
 * ======================= 各题型怎么填（都支持权重） =======================
 * 权重统一写在下面的 WEIGHTS 里（按题号），简答题的权重写在 TEXT_ANSWERS 里；
 * 不配 = 等概率；权重 0 = 永不选；权重可以写小数。
 *
 * 单选（radio）：按权重抽 1 个选项；
 * 多选（checkbox）：按权重「不放回」抽 N 个选项，N 由题目限制或 CONFIG 决定；
 *   题目里写了“最多选 N 项 / 至少选 N 项 / 选择 N 项”会按题目限制来；
 *   带输入框的选项（如“其他____”）会被跳过，避免触发额外校验；
 * 填空 / 简答（input 或 textarea）：从 TEXT_ANSWERS 里这道题配置的候选答案中
 *   按权重抽 1 条填入；没配置到的题用 DEFAULT_TEXT_ANSWERS 按权重抽 1 条；
 * 表格题 / 拉条 / 下拉：本版未处理，会跳过。
 *
 * 关于提交后被强制跳走：
 *   问卷星提交完经常直接把页面跳到 completemobile2.aspx / complete.aspx 这类完成页，
 *   脚本会把这个完成页当成“这一份已提交成功”：计数 +1，然后自动跳回原问卷链接，
 *   继续填写下一份，所以不会卡在完成页上。
 *   即使 sessionStorage 里没记录问卷地址，也会用地址里的 activityid 反推出问卷链接。
 *
 * 关于弹出「请完成安全验证」（阿里云智能验证）：
 *   提交太快、同一 IP 提交太多时问卷星会弹这个验证框，不通过就提交不上去。
 *   · 如果是“点一下就变绿”的无感验证：脚本会自动点那个小方块（最多 captchaRetry 次），
 *     变绿后这一份自动提交，接着进入下一份，全程不用你动手；
 *   · 如果点了没通过：脚本会**自动刷新页面重来**（最多 captchaReloadMax 次）——
 *     实测刷新之后这一份往往能直接提交成功，比一直点验证框有效；
 *     把 captchaReloadAfter 设成 0 就是一出现验证就刷新，连点都不点；
 *   · 如果变成要拖滑块/拼图：脚本立刻停手，面板提示你手动拖一下，通过后自动继续。
 *   想少被验证：把 intervalMs / clickCooldownMs 调大，或真换出口 IP（热点/宽带重拨）。
 *
 * ============================ 可调参数 ============================
 * CONFIG 里：
 *   autoStart         打开问卷后是否立刻开始循环（默认 true）
 *   intervalMs        每份提交成功后等多久刷新进入下一份（默认 5000 毫秒）
 *   intervalJitterMs  在上述时间上再加 0~该值 的随机等待，避免太规律（默认 3000）
 *   maxRounds         最多提交多少份，0 = 无限循环（默认 0）
 *   submitRetry       每份最多自动点击「提交」几次（默认 3）
 *   clickCooldownMs   两次自动点击之间的最小间隔（默认 5000 毫秒）
 *   captchaRetry      安全验证最多自动点几次（默认 6，之后转人工）
 *   captchaReloadAfter 验证点几次没通过就自动刷新页面重来（默认 2；0 = 一出现验证就刷新）
 *   captchaReloadMax  同一份最多自动刷新几次（默认 3，防止无限刷新）
 *   multiMin          多选最少勾几项（默认 1）
 *   multiMax          多选最多勾几项，0 = 自动取选项数的一半（默认 0）
 *   showPanel         是否显示右下角控制面板（默认 true）
 *
 * TEXT_ANSWERS / DEFAULT_TEXT_ANSWERS 在 CONFIG 下面，是填空题和简答题的答案库。
 * ==================================================================
 */

/* ==================== 一、vm 版问卷：循环提交 ==================== */

(function () {
    'use strict';

    /* ---------------------- 配置 ---------------------- */

    /*
     * ============ 怎么改参数（以 https://v.wjx.cn/vm/wUtwYP3.aspx 为例）============
     *
     * 那份问卷一共 6 题，真实结构如下（已按页面 HTML 核对）：
     *
     *   题号 1  单选测试1    type=3  4 个选项：选项1 / 选项2 / 选项5 / 选项6
     *   题号 2  多选测试1    type=4  6 个选项：选项1 / 选项2 / … / 选项6
     *   题号 3  简答测试1    type=2  textarea（input 的 id=q3、name=q3）
     *   题号 4  单选测试2    type=3  5 个选项：选项1 / 选项2 / 选项5 / 选项6 / 选项7
     *   题号 5  多选测试2    type=4  6 个选项：选项1 / 选项2 / … / 选项6
     *   题号 6  简答测试2    type=2  textarea（id=q6、name=q6）
     *
     * 改法（3 步）：
     *   ① 打开问卷页按 F12 → 元素，找到题目容器：
     *        <div class='field ui-field-contain' topic='1' id='div1' type='3'>
     *      topic 就是题号（对应页面上显示的“1.”）；
     *      type=3 单选、type=4 多选、type=1/2 填空简答。
     *   ② 单选 / 多选：在下面 WEIGHTS 里加一行
     *        1: [5, 3, 2, 1]                      按选项在页面上的顺序给权重
     *        2: { '选项1': 6, '选项5': 2, '选项6': 0 }   按选项文字给权重，0 = 永不选
     *   ③ 简答 / 填空：在下面 TEXT_ANSWERS 里加一条
     *        { id: 3, answer: ['第一条', { value: '第二条', weight: 3 }] }
     *      没单独配的题会从 DEFAULT_TEXT_ANSWERS 里按权重挑。
     *
     * 改完保存 → 刷新问卷页生效。没配到的题、没配到的选项都是等概率（权重 1）。
     *
     * 多选题选几项：
     *   题目里写了“最多选 N 项 / 至少选 N 项 / 选择 N 项”会自动遵守；
     *   没写就由 CONFIG 的 multiMin / multiMax 决定。
     *   本例第 2、5 题各有 6 个选项，multiMin:1 + multiMax:0 →
     *   每份在 1~3 项之间随机；想固定选 3 项就把两个都设成 3。
     * ==========================================================================
     */

    var CONFIG = {
        autoStart: true,
        intervalMs: 5000,
        intervalJitterMs: 3000,
        maxRounds: 0,
        submitRetry: 3,
        clickCooldownMs: 5000,
        // 安全验证（点一下就变绿那种）最多自动点几次，之后转人工
        captchaRetry: 6,
        // 验证点不过时自动刷新页面重来（实测：刷新之后这一份往往能直接提交成功）
        // captchaReloadAfter = 点几次没通过就刷新；设为 0 = 一出现验证就刷新，不点
        captchaReloadAfter: 2,
        // 同一份答卷最多自动刷新几次，防止无限刷新
        captchaReloadMax: 3,
        // 多选题勾选数量：最少 multiMin 项；multiMax 为 0 时“上限”取选项数的一半
        // 例：6 个选项的题，multiMin:1 + multiMax:0 → 每份随机勾选 1~3 项；
        //     multiMin:2, multiMax:4 → 随机 2~4 项；multiMin:3, multiMax:3 → 固定 3 项
        multiMin: 1,
        multiMax: 0,
        showPanel: true
    };

    /**
     * ===================== 选项权重（可选） =====================
     * 想让某些选项更容易被抽到 / 永远不抽到，就按题号配权重。
     * 没配的题、没配的选项一律按权重 1（等概率）处理；权重 0 = 永不选，可写小数。
     *
     * 两种写法，任选：
     *   1) 数组：按选项在页面上的先后顺序给权重
     *        1: [5, 3, 2]                     ← 第1个选项5份、第2个3份、第3个2份
     *   2) 对象：按选项文字给权重（写关键词即可，包含匹配，忽略空格）
     *        7: { '课程作业': 4, '论文': 3, '其他': 0 }
     *
     * 下面已经按 https://v.wjx.cn/vm/wUtwYP3.aspx 的 4 道选择题配好了示例，
     * 换成别的问卷时照着改题号和权重即可（题号数要和选项数对上）。
     * ===========================================================
     */
    var WEIGHTS = {
        // 第 1 题 · 单选测试1 → 4 个选项：选项1 / 选项2 / 选项5 / 选项6
        // 数组按顺序给权重：约 45% / 27% / 18% / 9%
        // 1: [5, 3, 2, 1],

        // 第 2 题 · 多选测试1【多选题】 → 6 个选项：选项1 ~ 选项6
        // 对象写法示例（改成对象形式就能按文字给权重，0 = 永不选）：
        // 2: { '选项1': 6, '选项2': 5, '选项3': 4, '选项4': 3, '选项5': 2, '选项6': 0 },
        // 2: [6, 5, 4, 3, 2, 1],

        // 第 4 题 · 单选测试2 → 5 个选项：选项1 / 选项2 / 选项5 / 选项6 / 选项7
        // 4: [5, 4, 3, 2, 1],

        // 第 5 题 · 多选测试2【多选题】 → 6 个选项：选项1 ~ 选项6
        // 5: [4, 3, 3, 2, 1, 1]
    };

    /**
     * 填空 / 简答题的答案库：每道题从自己的候选答案里**按权重随机挑一条**填入。
     *
     * id 支持这几种写法（任选一种，能对上这道题就行）：
     *   - 题号：{ id: 3 }             ← 页面上显示的“3.”（最常用）
     *   - 题目 qid：{ id: 20 }         ← 元素属性 qid="20"（有的问卷没有）
     *   - 输入框 id：{ id: 'q3' }      ← input/textarea 的 id
     *
     * answer 里的每一项可以是：
     *   - 字符串：'答案文字'                     （权重 1）
     *   - 对象：{ value: '答案文字', weight: 3 }  （权重 3，写 0 = 永不使用）
     *
     * 下面是 https://v.wjx.cn/vm/wUtwYP3.aspx 第 3、6 题（两道 textarea 简答题）的示例，
     * 换成自己的问卷时把答案文字改成你要的内容即可。
     */
    var TEXT_ANSWERS = [
        // {
        //     id: 3, // 第 3 题 · 简答测试1（textarea，id=q3）
        //     answer: [
        //         { value: '这是「简答测试1」的候选答案A（权重 3，出现概率最高）。', weight: 3 },
        //         { value: '这是「简答测试1」的候选答案B（权重 2）。', weight: 2 },
        //         '这是「简答测试1」的候选答案C（不写 weight 就是 1）。'
        //     ]
        // },
        // {
        //     id: 6, // 第 6 题 · 简答测试2（textarea，id=q6）
        //     answer: [
        //         { value: '这是「简答测试2」的候选答案A（权重 2）。', weight: 2 },
        //         { value: '这是「简答测试2」的候选答案B（权重 1）。', weight: 1 }
        //     ]
        // }
        // 再加题目就照上面格式继续写：
        // { id: 7, answer: ['第一条答案', { value: '第二条答案', weight: 2 }] },
    ];

    // 没有在 TEXT_ANSWERS 里单独配置的填空题 / 简答题，从下面随机挑一条
    // 注意：很多问卷对开放题有最少字数要求，太短（如“无”）可能提交不上去
    var DEFAULT_TEXT_ANSWERS = [
        '暂时没有别的建议。',
        '目前想到的就是这些，谢谢。',
        '暂无补充，问卷设计得比较全面。'
    ];

    var KEY = {
        url: 'wjxLoop.surveyUrl',
        count: 'wjxLoop.submitCount',
        // 提交时打的标记 + 已计过数的标记，用来保证“每一份只计一次”
        pending: 'wjxLoop.pendingRound',
        countedToken: 'wjxLoop.countedToken',
        // 同一份答卷为通过验证而刷新了几次
        captchaReloads: 'wjxLoop.captchaReloads'
    };

    var SUBMIT_SELECTORS = [
        '#SubmitBtnGroup #ctlNext',
        '#SubmitBtnGroup .submitbtn',
        '#ctlNext',
        '#submit_button',
        '.submitbtn'
    ];

    var DIALOG_SCOPE = '.layui-layer, .ui-dialog, .dialog, .modal, .popup, .jqPopup, ' +
        '[class*="dialog"], [class*="modal"], [class*="popup"], [id*="dialog"], [id*="Dialog"]';

    var CONFIRM_TEXTS = ['确定', '确认', '确认提交', '提交', '继续', '好'];

    var CAPTCHA_SELECTORS = [
        '#captcha', '#yzm', '.yzm', '.verifybox', '.verify-box', '#verifyBox',
        '.nc-container', '.nc_wrapper', 'iframe[src*="captcha"]', 'iframe[src*="verify"]',
        '[class*="captcha"]', '[id*="captcha"]',
        // 问卷星实际用的是阿里云「智能验证」，类名是大写 Captcha，需要单独列出来
        '#aliyunCaptcha-window-popup', '[id*="aliyunCaptcha"]', '[class*="aliyunCaptcha"]',
        '[id*="Captcha"]', '[class*="Captcha"]'
    ];

    // 出现这些说明要拖滑块/拼图了，脚本不再自动点，交给人工
    var CAPTCHA_SLIDER_SELECTORS = [
        '#aliyunCaptcha-sliding-body', '.aliyunCaptcha-sliding-body', '.aliyunCaptcha-slide',
        '#aliyunCaptcha-puzzle', '.aliyunCaptcha-puzzle', '.aliyunCaptcha-img-slide',
        '.nc_iconfont.btn_slide', '.nc_scale', '.verify-slider', '#aliyunCaptcha-slider'
    ];

    var state = {
        paused: false,
        started: false,
        finished: false,
        attempts: 0,
        lastClick: 0,
        clickedAt: 0,
        stalledAt: 0,
        captchaClicks: 0,
        lastCaptchaClick: 0,
        timer: null
    };

    var ui = { panel: null, status: null, count: null, toggle: null, force: null };

    /* ---------------------- 小工具 ---------------------- */
    function qsa(selector, root) {
        try {
            return Array.prototype.slice.call((root || document).querySelectorAll(selector));
        } catch (e) {
            return [];
        }
    }

    function isVisible(el) {
        if (!el || typeof el.getClientRects !== 'function') return false;
        if (el.getClientRects().length === 0) return false;
        var st = window.getComputedStyle(el);
        return st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
    }

    function isDisabled(el) {
        if (!el) return false;
        if (el.disabled === true) return true;
        if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return true;
        var cls = typeof el.className === 'string' ? el.className : '';
        return /(^|\s)(disabled|ui-disabled)(\s|$)/.test(cls);
    }

    function readNum(key, def) {
        try {
            var v = parseInt(window.sessionStorage.getItem(key), 10);
            return isNaN(v) ? def : v;
        } catch (e) {
            return def;
        }
    }

    function writeNum(key, value) {
        try {
            window.sessionStorage.setItem(key, String(value));
        } catch (e) {}
    }

    function readStr(key, def) {
        try {
            var v = window.sessionStorage.getItem(key);
            return v === null ? def : v;
        } catch (e) {
            return def;
        }
    }

    function writeStr(key, value) {
        try {
            window.sessionStorage.setItem(key, value);
        } catch (e) {}
    }

    /* ---------------------- 计数 ---------------------- */
    function currentCount() {
        return readNum(KEY.count, 0);
    }

    function bumpCount() {
        var n = currentCount() + 1;
        writeNum(KEY.count, n);
        updateCount();
        return n;
    }

    function newRoundToken(prefix) {
        return (prefix || 'r') + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    }

    /**
     * 每一份答卷只计一次。
     * 点「提交」时记下 pendingRound；问卷页或完成页只要认出了“提交成功”，
     * 就用这个标记去重——同一个标记不会计第二次，新一份会换成新标记。
     */
    function countRound() {
        var pending = readStr(KEY.pending, '');
        var counted = readStr(KEY.countedToken, '');
        if (pending && pending === counted) return false; // 这一份已经计过数
        var token = pending || newRoundToken('manual-');
        bumpCount();
        writeStr(KEY.countedToken, token);
        writeNum(KEY.captchaReloads, 0); // 这一份完成了，验证刷新次数清零
        return true;
    }

    /* ---------------------- 记录问卷地址（用于从提交完成页跳回） ---------------------- */
    function saveSurveyUrl() {
        try {
            window.sessionStorage.setItem(KEY.url, JSON.stringify({
                url: location.href.split('#')[0],
                at: Date.now()
            }));
        } catch (e) {}
    }

    // 调查页地址（vm/jq/m/hj 都认）
    function isSurveyUrl(url) {
        return !!url && /\/(vm|jq|m|hj)\/[\w.-]+\.aspx/i.test(url);
    }

    function savedSurveyUrl() {
        try {
            var raw = window.sessionStorage.getItem(KEY.url);
            if (!raw) return '';
            var obj = JSON.parse(raw);
            if (!obj || !isSurveyUrl(obj.url)) return '';
            if (Date.now() - (obj.at || 0) > 6 * 60 * 60 * 1000) return '';
            return obj.url;
        } catch (e) {
            return '';
        }
    }

    /**
     * 是不是「提交完成页」。
     * 问卷星有好几种：complete.aspx、completemobile.aspx、completemobile2.aspx ……
     * 都是提交后被强制跳过去的页面。
     */
    function onCompletePage() {
        return /completemobile|complete\d*\.aspx|\/join\/complete/i.test(location.pathname);
    }

    /**
     * 完成页地址里带着 activityid（如 activityid=OSVkDa2），
     * 拿它就能拼回问卷地址，防止 sessionStorage 里没记录时回不去。
     */
    function vmUrlFromActivityId() {
        var m = /[?&]activityid=([A-Za-z0-9_-]+)/i.exec(location.search);
        if (!m) return '';
        var id = m[1];
        if (!/[A-Za-z]/.test(id)) return ''; // 纯数字是 jq 老问卷，交给原有逻辑
        var host = /^v\.wjx\.cn$/i.test(location.hostname) ? 'https://v.wjx.cn' : 'https://www.wjx.cn';
        return host + '/vm/' + id + '.aspx';
    }

    // 完成页要跳回的问卷地址
    function backToSurveyUrl() {
        return savedSurveyUrl() || vmUrlFromActivityId();
    }

    /* ---------------------- 控制面板 ---------------------- */
    function buildPanel() {
        if (ui.panel || !CONFIG.showPanel) return;

        var panel = document.createElement('div');
        panel.id = 'wjx-loop-panel';
        panel.style.cssText = [
            'position:fixed', 'right:12px', 'top:72px', 'z-index:2147483600',
            'width:200px', 'padding:10px 12px', 'box-sizing:border-box',
            'background:rgba(255,255,255,0.96)', 'border:1px solid #d0d7de',
            'border-radius:8px', 'box-shadow:0 4px 16px rgba(0,0,0,0.15)',
            'font:12px/1.6 -apple-system,"Microsoft YaHei",sans-serif', 'color:#24292f',
            'text-align:left'
        ].join(';');

        panel.innerHTML =
            '<div style="font-weight:bold;font-size:13px;margin-bottom:4px">问卷星循环提交</div>' +
            '<div id="wjl-status" style="min-height:32px;color:#57606a">正在初始化…</div>' +
            '<div id="wjl-count" style="margin:4px 0 6px;color:#0969da;font-weight:bold">已提交：0 份</div>' +
            '<div style="display:flex;gap:6px">' +
            '<button id="wjl-toggle" type="button" style="flex:1;padding:4px 0;cursor:pointer;border:1px solid #d0d7de;border-radius:6px;background:#f6f8fa">暂停</button>' +
            '<button id="wjl-force" type="button" style="flex:1;padding:4px 0;cursor:pointer;border:1px solid #1f883d;border-radius:6px;background:#1f883d;color:#fff">立即提交</button>' +
            '</div>';

        (document.body || document.documentElement).appendChild(panel);

        ui.panel = panel;
        ui.status = panel.querySelector('#wjl-status');
        ui.count = panel.querySelector('#wjl-count');
        ui.toggle = panel.querySelector('#wjl-toggle');
        ui.force = panel.querySelector('#wjl-force');

        ui.toggle.addEventListener('click', function () {
            state.paused = !state.paused;
            ui.toggle.textContent = state.paused ? '继续' : '暂停';
            if (state.paused) {
                setStatus('已暂停，点「继续」恢复循环');
            } else {
                state.attempts = 0;
                state.lastClick = 0;
                setStatus('已恢复循环');
                startLoop();
            }
        });

        ui.force.addEventListener('click', function () {
            state.paused = false;
            state.finished = false;
            state.attempts = 0;
            state.lastClick = 0;
            if (ui.toggle) ui.toggle.textContent = '暂停';
            setStatus('手动触发一次提交…');
            startLoop();
        });
    }

    function setStatus(text) {
        if (ui.status) ui.status.textContent = text;
        console.log('[问卷星循环] ' + text);
    }

    function updateCount() {
        if (ui.count) ui.count.textContent = '已提交：' + currentCount() + ' 份';
    }

    /* ---------------------- 页面状态识别 ---------------------- */
    function findSubmit() {
        for (var i = 0; i < SUBMIT_SELECTORS.length; i++) {
            var list = qsa(SUBMIT_SELECTORS[i]);
            for (var j = 0; j < list.length; j++) {
                var el = list[j];
                if (ui.panel && (el === ui.panel || ui.panel.contains(el))) continue;
                if (!isVisible(el) || isDisabled(el)) continue;
                var text = (el.textContent || el.value || '').replace(/\s+/g, '');
                if (text.indexOf('提交') >= 0) return el;
            }
        }
        return null;
    }

    function isSuccessPage() {
        if (onCompletePage()) return true;
        if (findSubmit()) return false;

        var text = '';
        try {
            text = (document.body && document.body.innerText || '').replace(/\s+/g, '');
        } catch (e) {}

        if (/提交成功|答卷已提交|已提交成功|感谢您的参与|感谢您参与|感谢您的填写/.test(text)) return true;

        var done = document.querySelector('#divComplete, .divComplete, #completePage, .complete-page, #successPage');
        return !!done && isVisible(done);
    }

    function blockedReason() {
        if (findSubmit()) return '';
        var text = '';
        try {
            text = (document.body && document.body.innerText || '').replace(/\s+/g, '');
        } catch (e) {}
        if (/已提交过|不能重复提交|重复提交|问卷已停止|问卷已结束|人数已满|已关闭|不在活动时间内/.test(text)) {
            return text.slice(0, 60);
        }
        return '';
    }

    function captchaVisible() {
        for (var i = 0; i < CAPTCHA_SELECTORS.length; i++) {
            var list = qsa(CAPTCHA_SELECTORS[i]);
            for (var j = 0; j < list.length; j++) {
                var el = list[j];
                if (!isVisible(el)) continue;
                if (el.offsetWidth >= 30 && el.offsetHeight >= 20) return el;
            }
        }
        return null;
    }

    /**
     * 是不是问卷星用的阿里云「智能验证」框
     */
    function isAliyunCaptcha(el) {
        if (!el) return false;
        var sig = (el.id || '') + ' ' + (typeof el.className === 'string' ? el.className : '');
        return /aliyunCaptcha/i.test(sig);
    }

    /**
     * 验证框里是否已经变成要拖滑块/拼图的状态（这种只能人工）
     */
    function captchaSliderVisible() {
        for (var i = 0; i < CAPTCHA_SLIDER_SELECTORS.length; i++) {
            var list = qsa(CAPTCHA_SLIDER_SELECTORS[i]);
            for (var j = 0; j < list.length; j++) {
                if (isVisible(list[j])) return true;
            }
        }
        return false;
    }

    /**
     * 找到真正的「点击开始智能验证」框。
     * 注意：阿里云 DOM 里还有一个 #aliyunCaptcha-checkbox-element，
     * 那是标题栏里 112x20 的空占位 div，点了没反应，必须排除。
     */
    function captchaBoxElement() {
        var sels = [
            '#aliyunCaptcha-checkbox-wrapper',
            '#aliyunCaptcha-checkbox-body',
            '.aliyunCaptcha-checkbox-body',
            '#aliyunCaptcha-checkbox-text',
            '.aliyunCaptcha-checkbox'
        ];
        for (var i = 0; i < sels.length; i++) {
            var list = qsa(sels[i]);
            for (var j = 0; j < list.length; j++) {
                var el = list[j];
                if (!isVisible(el)) continue;
                if (el.offsetWidth >= 100 && el.offsetHeight >= 24) return el;
            }
        }
        return null;
    }

    function captchaLoading() {
        var list = qsa('#aliyunCaptcha-checkbox-loading, .aliyunCaptcha-checkbox-loading');
        for (var i = 0; i < list.length; i++) {
            if (isVisible(list[i])) return true;
        }
        return false;
    }

    /**
     * 点在哪里：默认点左边的小方块图标，下一次尝试点文字，
     * 这样不管阿里云把监听绑在图标、文字还是容器上，都能命中。
     */
    function captchaClickPoint(box, preferText) {
        var icon = box.querySelector('#aliyunCaptcha-checkbox-icon, .aliyunCaptcha-checkbox-icon');
        var text = box.querySelector('#aliyunCaptcha-checkbox-text, .aliyunCaptcha-checkbox-text');
        var el = preferText ? (text || icon) : (icon || text);
        var r = (el || box).getBoundingClientRect();
        if (!r || r.width === 0) r = box.getBoundingClientRect();
        return {
            x: Math.round(r.left + r.width / 2),
            y: Math.round(r.top + r.height / 2)
        };
    }

    /**
     * 像真人一样点在验证框上：先找到那个坐标上最上层的元素（图标/文字），
     * 依次发 mousemove → pointerdown → mousedown → pointerup → mouseup → click。
     * 事件会从内层一路冒泡到 wrapper，绑在哪一层的监听都能收到。
     */
    function clickCaptchaBox(preferText) {
        var box = captchaBoxElement();
        if (!box) return false;

        var pt = captchaClickPoint(box, preferText);
        var x = pt.x;
        var y = pt.y;

        var target = null;
        try {
            target = document.elementFromPoint(x, y);
        } catch (e) {}
        if (!target || !box.contains(target)) target = box;

        function mouse(type, buttons) {
            return new MouseEvent(type, {
                bubbles: true, cancelable: true, view: window, button: 0,
                clientX: x, clientY: y, buttons: buttons || 0
            });
        }
        function pointer(type, buttons) {
            try {
                return new PointerEvent(type, {
                    bubbles: true, cancelable: true, view: window, button: 0,
                    clientX: x, clientY: y, buttons: buttons || 0,
                    pointerId: 1, pointerType: 'mouse', isPrimary: true
                });
            } catch (e) {
                return null;
            }
        }

        try { target.dispatchEvent(mouse('mousemove', 0)); } catch (e) {}
        var pd = pointer('pointerdown', 1);
        if (pd) { try { target.dispatchEvent(pd); } catch (e) {} }
        try { target.dispatchEvent(mouse('mousedown', 1)); } catch (e) {}
        var pu = pointer('pointerup', 0);
        if (pu) { try { target.dispatchEvent(pu); } catch (e) {} }
        try { target.dispatchEvent(mouse('mouseup', 0)); } catch (e) {}
        try { target.dispatchEvent(mouse('click', 0)); } catch (e) {}
        return true;
    }

    /**
     * 自动通过「点击开始智能验证」（无感验证：点一下直接变绿的那种）。
     * 返回 'clicked' / 'waiting'（刚点过，等它转圈变绿）/ 'manual'（要拖滑块）/ 'exhausted'。
     */
    function tryPassCaptcha() {
        if (captchaSliderVisible()) return 'manual';
        if (captchaLoading()) return 'waiting'; // 正在验证中，别打断
        // 刚点过就等它反应，别连点（连点反而会被判异常）
        if (Date.now() - state.lastCaptchaClick < 1800) return 'waiting';

        if (state.captchaClicks >= CONFIG.captchaRetry) {
            // 一轮点完没通过：隔 20 秒再来一轮，而不是永远卡住
            if (Date.now() - state.lastCaptchaClick < 20000) return 'exhausted';
            state.captchaClicks = 0;
        }

        if (!clickCaptchaBox(state.captchaClicks % 2 === 1)) return 'waiting';
        state.captchaClicks++;
        state.lastCaptchaClick = Date.now();
        return 'clicked';
    }

    /**
     * 验证没过 → 刷新页面换一次会话重来。
     * 实测：验证卡住时刷新一次，这一份往往能直接提交成功，比一直点验证框有效得多。
     */
    function reloadToRetry(reloads) {
        writeNum(KEY.captchaReloads, reloads + 1);
        state.finished = true; // 刷新前别再点提交
        setStatus('安全验证没通过，自动刷新页面重试（' + (reloads + 1) + '/' + CONFIG.captchaReloadMax + '）…');
        setTimeout(function () {
            location.reload();
        }, 700);
    }

    /* ---------------------- 提交确认弹窗 ---------------------- */
    function findDialogConfirm() {
        var containers = qsa(DIALOG_SCOPE);
        for (var i = 0; i < containers.length; i++) {
            var c = containers[i];
            if (ui.panel && (c === ui.panel || ui.panel.contains(c) || c.contains(ui.panel))) continue;
            if (!isVisible(c)) continue;
            // 弹窗里如果包着整张问卷，说明不是确认弹窗，跳过
            if (c.querySelector('#divQuestion, #SubmitBtnGroup')) continue;

            var layuiBtn = c.querySelector('.layui-layer-btn0');
            if (isVisible(layuiBtn) && !isDisabled(layuiBtn)) return layuiBtn;

            var cands = qsa('a, button, input[type="button"], input[type="submit"], [role="button"], .ui-btn', c);
            for (var j = 0; j < cands.length; j++) {
                var b = cands[j];
                if (ui.panel && ui.panel.contains(b)) continue;
                if (!isVisible(b) || isDisabled(b)) continue;
                var text = (b.textContent || b.value || '').replace(/\s+/g, '');
                if (CONFIRM_TEXTS.indexOf(text) >= 0) return b;
            }
        }
        return null;
    }

    /* ---------------------- 填写题目（单选 / 多选 / 填空简答） ---------------------- */

    function randomItem(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    // 闭区间随机整数
    function randint(min, max) {
        return Math.floor(Math.random() * (max - min + 1) + min);
    }

    // 题目标题文字，用来解析“最多选 N 项”“至少选 N 项”这类限制
    function fieldTitleText(field) {
        var t = field.querySelector('.topichtml, .div_title_question, .field-label');
        return (t ? t.textContent : field.textContent || '').replace(/\s+/g, '');
    }

    function multiLimit(field) {
        var text = fieldTitleText(field);
        var limit = { min: 0, max: 0 };
        var mMax = /最多[^0-9]{0,4}(\d+)/.exec(text) || /限选[^0-9]{0,4}(\d+)/.exec(text);
        var mMin = /至少[^0-9]{0,4}(\d+)/.exec(text) || /最少[^0-9]{0,4}(\d+)/.exec(text);
        if (mMax) limit.max = parseInt(mMax[1], 10) || 0;
        if (mMin) limit.min = parseInt(mMin[1], 10) || 0;
        // 题目要求“选择 N 项”（既没写最多也没写至少）时，按固定条数选
        if (!limit.max && !limit.min) {
            var mExact = /(?:选择|勾选|选)(\d+)\s*[项个]/.exec(text);
            if (mExact) {
                limit.min = limit.max = parseInt(mExact[1], 10) || 0;
            }
        }
        return limit;
    }

    // 选项里带输入框（如“其他____”）的不选，免得触发额外校验
    function optionNeedsText(option) {
        var holder = option.closest ? option.closest('.ui-radio, .ui-checkbox') : null;
        var scope = holder || option;
        return !!scope.querySelector('input[type="text"], input:not([type]), textarea');
    }

    // 取一个选项真正该点的元素（优先文字标签，容器次之）
    function optionClickTarget(holder) {
        var label = holder.querySelector('.label, label');
        return label || holder;
    }

    function usableOptions(field, holderSelector) {
        var holders = qsa(holderSelector, field).filter(function (h) {
            return isVisible(h) && !isDisabled(h) &&
                !h.querySelector('input:disabled, [aria-disabled="true"]');
        });
        var options = [];
        for (var i = 0; i < holders.length; i++) {
            var target = optionClickTarget(holders[i]);
            if (!isVisible(target)) continue;
            if (optionNeedsText(target) || optionNeedsText(holders[i])) continue;
            options.push({ holder: holders[i], target: target, label: (target.textContent || '').replace(/\s+/g, '') });
        }
        return options;
    }

    /* ---------------------- 权重抽取 ---------------------- */

    // 这道题可以用哪些编号去 WEIGHTS / TEXT_ANSWERS 里找配置
    function questionKeys(field) {
        var keys = [];
        var topic = field.getAttribute('topic');
        var qid = field.getAttribute('qid');
        var divId = /^div(\d+)$/i.exec(field.id || '');
        if (topic) keys.push(topic, 'q' + topic);
        if (qid) keys.push(qid, 'q' + qid);
        if (divId) keys.push(divId[1], 'q' + divId[1]);
        return keys.map(function (k) { return String(k); });
    }

    function weightsFor(field) {
        var keys = questionKeys(field);
        for (var i = 0; i < keys.length; i++) {
            if (WEIGHTS && Object.prototype.hasOwnProperty.call(WEIGHTS, keys[i])) return WEIGHTS[keys[i]];
        }
        return null;
    }

    function normalizeWeight(w) {
        if (w === undefined || w === null || w === '') return 1;
        w = Number(w);
        if (!isFinite(w) || w < 0) return 1;
        return w;
    }

    /**
     * 取某个选项的权重：
     *  weights 是数组 → 按选项顺序；是对象 → 按选项文字（包含匹配，忽略空格）；
     *  没配到的一律 1，写 0 表示永不选。
     */
    function optionWeight(option, index, weights) {
        if (!weights) return 1;
        var w;
        if (Object.prototype.toString.call(weights) === '[object Array]') {
            w = weights[index];
        } else if (typeof weights === 'object') {
            var text = option.label || '';
            if (text) {
                for (var k in weights) {
                    if (!Object.prototype.hasOwnProperty.call(weights, k)) continue;
                    var key = String(k).replace(/\s+/g, '');
                    if (key && (text === key || text.indexOf(key) >= 0)) {
                        w = weights[k];
                        break;
                    }
                }
            }
        }
        return normalizeWeight(w);
    }

    /**
     * 按权重不放回抽取 count 个元素。
     * candidates: [{ value, weight }]
     * 全部权重为 0 时退化为等权，避免整道题答不上。
     */
    function weightedDraw(candidates, count) {
        var pool = candidates.filter(function (c) { return c && c.weight > 0; });
        if (!pool.length) pool = candidates.slice(0);
        var out = [];
        count = Math.max(1, Math.min(count || 1, pool.length));
        while (out.length < count && pool.length) {
            var total = 0;
            for (var i = 0; i < pool.length; i++) total += pool[i].weight;
            var r = Math.random() * total;
            var idx = pool.length - 1;
            for (var j = 0; j < pool.length; j++) {
                r -= pool[j].weight;
                if (r < 0) { idx = j; break; }
            }
            out.push(pool.splice(idx, 1)[0].value);
        }
        return out;
    }

    // 把 answer 配置（字符串或 {value, weight}）统一成 [{value, weight}]
    function textCandidates(list) {
        var out = [];
        if (!list) return out;
        for (var i = 0; i < list.length; i++) {
            var item = list[i];
            if (typeof item === 'string') {
                if (item) out.push({ value: item, weight: 1 });
            } else if (item && item.value != null) {
                out.push({ value: String(item.value), weight: normalizeWeight(item.weight) });
            }
        }
        return out.filter(function (c) { return c.value; });
    }

    function fillSingleChoice(field) {
        if (field.querySelector('.ui-radio.checked, input[type="radio"]:checked')) return 0;
        var options = usableOptions(field, '.ui-radio');
        if (!options.length) {
            // 兼容没有 .ui-radio 包裹的简单布局
            var labels = qsa('.label, label', field).filter(function (el) {
                return isVisible(el) && !optionNeedsText(el);
            });
            options = labels.map(function (el) {
                return { holder: el, target: el, label: (el.textContent || '').replace(/\s+/g, '') };
            });
        }
        if (!options.length) return 0;

        var weights = weightsFor(field);
        var candidates = options.map(function (option, index) {
            return { value: option, weight: optionWeight(option, index, weights) };
        });
        var picked = weightedDraw(candidates, 1)[0];
        if (!picked) return 0;
        try {
            picked.target.click();
        } catch (e) {}
        // 点了没生效的兜底：先点选项里的 <a class="jqradio">，再直接触发 radio
        if (!field.querySelector('input[type="radio"]:checked, .ui-radio.checked')) {
            var holder = picked.holder;
            var anchor = holder.querySelector('.jqradio, a');
            if (anchor) {
                try {
                    anchor.click();
                } catch (e) {}
            }
            var radio = holder.querySelector('input[type="radio"]');
            if (radio && !radio.checked) {
                try {
                    radio.click();
                } catch (e) {}
            }
        }
        return 1;
    }

    function fillMultiChoice(field) {
        if (field.querySelector('input[type="checkbox"]:checked')) return 0; // 已经选过就不动
        var options = usableOptions(field, '.ui-checkbox');
        if (!options.length) return 0;

        var weights = weightsFor(field);
        var candidates = options.map(function (option, index) {
            return { value: option, weight: optionWeight(option, index, weights) };
        });
        var positive = candidates.filter(function (c) { return c.weight > 0 });
        var all = (positive.length || candidates.length);

        var limit = multiLimit(field);
        var minCount = limit.min > 0 ? limit.min : CONFIG.multiMin;
        var maxCount = limit.max > 0 ? limit.max : (CONFIG.multiMax > 0 ? CONFIG.multiMax : Math.round(all / 2));
        minCount = Math.max(1, Math.min(minCount, all));
        maxCount = Math.max(minCount, Math.min(maxCount, all));

        var count = randint(minCount, maxCount);
        var picks = weightedDraw(candidates, count);

        var picked = 0;
        for (var k = 0; k < picks.length; k++) {
            try {
                picks[k].target.click();
                picked++;
            } catch (e) {}
        }

        // 点了没生效的兜底：先点选项里的 <a class="jqcheck">，再直接触发 checkbox
        if (!field.querySelector('input[type="checkbox"]:checked')) {
            for (var m = 0; m < picks.length; m++) {
                var holder = picks[m].holder;
                var anchor = holder.querySelector('.jqcheck, .jqcheckbox, a');
                if (anchor) {
                    try {
                        anchor.click();
                    } catch (e) {}
                }
                var input = holder.querySelector('input[type="checkbox"]');
                if (input && !input.checked) {
                    try {
                        input.click();
                    } catch (e) {}
                }
            }
        }
        return picked;
    }

    /**
     * 填空题 / 简答题：从 TEXT_ANSWERS 里给这道题配置的候选答案中随机挑一条。
     * 只填还空着的框；已有内容（含自己手打的）一律不动。
     */
    function fillTextQuestion(field) {
        var inputs = qsa('textarea, input[type="text"], input:not([type])', field).filter(function (el) {
            if (el.closest && (el.closest('.ui-radio') || el.closest('.ui-checkbox'))) return false;
            if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') return false;
            return isVisible(el) && !el.disabled && !el.readOnly;
        });

        var filled = 0;
        for (var i = 0; i < inputs.length; i++) {
            var el = inputs[i];
            if (el.value && String(el.value).trim()) continue;
            var answer = pickTextAnswer(field, el);
            if (!answer) continue;
            if (el.maxLength > 0 && answer.length > el.maxLength) answer = answer.slice(0, el.maxLength);
            if (setNativeValue(el, answer)) filled++;
        }
        return filled;
    }

    /**
     * 给填入过程补上 input/change 事件，让问卷星的校验逻辑认为“用户真的输入了”
     */
    function setNativeValue(el, value) {
        try {
            el.focus();
        } catch (e) {}
        try {
            var proto = (typeof HTMLTextAreaElement !== 'undefined' && el instanceof HTMLTextAreaElement)
                ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            var desc = Object.getOwnPropertyDescriptor(proto, 'value');
            if (desc && desc.set) desc.set.call(el, value);
            else el.value = value;
        } catch (e) {
            try {
                el.value = value;
            } catch (e2) {
                return false;
            }
        }
        try {
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        } catch (e) {}
        try {
            el.blur();
        } catch (e) {}
        return true;
    }

    // 这道题可以用哪些编号去 TEXT_ANSWERS 里找配置
    function textKeys(field, el) {
        var keys = questionKeys(field);
        if (el.id) keys.push(el.id);
        if (el.name) keys.push(el.name);
        return keys.map(function (k) { return String(k); });
    }

    function pickTextAnswer(field, el) {
        var keys = textKeys(field, el);
        for (var i = 0; i < TEXT_ANSWERS.length; i++) {
            var cfg = TEXT_ANSWERS[i];
            if (!cfg || !cfg.answer || !cfg.answer.length) continue;
            if (keys.indexOf(String(cfg.id)) < 0) continue;
            var picked = weightedDraw(textCandidates(cfg.answer), 1);
            if (picked.length) return picked[0];
        }
        var fallback = weightedDraw(textCandidates(DEFAULT_TEXT_ANSWERS), 1);
        return fallback.length ? fallback[0] : '';
    }

    // 判断题型：优先看 DOM 特征，不信 type 属性
    function fieldKind(field) {
        if (field.querySelector('table')) return 'matrix'; // 表格题本版不处理
        if (field.querySelector('.slider, .ruler')) return 'slider';
        if (field.querySelector('select')) return 'select';
        if (field.querySelector('input[type="radio"], .ui-radio')) return 'single';
        if (field.querySelector('input[type="checkbox"], .ui-checkbox')) return 'multi';
        if (field.querySelector('textarea, input[type="text"], input:not([type])')) return 'text';
        return '';
    }

    function fillAll() {
        var total = 0;
        var fields = qsa('#divQuestion .field.ui-field-contain, #divQuestion .div_question');
        if (!fields.length) fields = qsa('#divQuestion .ui-field-contain');

        for (var i = 0; i < fields.length; i++) {
            var field = fields[i];
            if (!isVisible(field)) continue;
            var kind = fieldKind(field);
            if (kind === 'single') total += fillSingleChoice(field);
            else if (kind === 'multi') total += fillMultiChoice(field);
            else if (kind === 'text') total += fillTextQuestion(field);
        }
        return total;
    }

    /* ---------------------- 点击提交 ---------------------- */
    function clickSubmit(btn) {
        try {
            btn.scrollIntoView({ block: 'center' });
        } catch (e) {}

        var rect = btn.getBoundingClientRect();
        var base = {
            bubbles: true,
            cancelable: true,
            view: window,
            button: 0,
            clientX: Math.round(rect.left + rect.width / 2),
            clientY: Math.round(rect.top + rect.height / 2)
        };

        try {
            btn.dispatchEvent(new MouseEvent('mousedown', base));
            btn.dispatchEvent(new MouseEvent('mouseup', base));
        } catch (e) {}

        try {
            btn.click();
        } catch (e) {}
    }

    /* ---------------------- 主循环 ---------------------- */
    function startLoop() {
        if (state.timer) return;
        state.started = true;
        state.timer = setInterval(loop, 800);
        loop();
    }

    function stopLoop() {
        if (state.timer) {
            clearInterval(state.timer);
            state.timer = null;
        }
    }

    function loop() {
        if (state.finished || state.paused) return;

        // 1) 已经提交成功 → 计数并准备下一份
        if (isSuccessPage()) {
            finishRound();
            return;
        }

        // 2) 问卷已经不能提交了 → 停止
        var blocked = blockedReason();
        if (blocked) {
            state.finished = true;
            stopLoop();
            setStatus('无法继续提交：' + blocked + '（本轮共提交 ' + currentCount() + ' 份）');
            return;
        }

        // 3) 出现人机验证 → 先尝试自动点掉；点不过就刷新页面重来（刷新后这份常能直接过）
        //    只有点过「提交」之后才把验证框当成拦截（问卷星是提交时才弹），
        //    阿里云验证框例外：它一出现就一定是拦截，直接处理。
        var cap = captchaVisible();
        if (cap && (state.attempts > 0 || isAliyunCaptcha(cap))) {
            state.lastClick = Date.now();
            var reloads = readNum(KEY.captchaReloads, 0);
            var canReload = reloads < CONFIG.captchaReloadMax;

            // 配成 0：一出现验证就刷新，不尝试点击
            if (CONFIG.captchaReloadAfter <= 0 && canReload) {
                reloadToRetry(reloads);
                return;
            }

            var pass = tryPassCaptcha();
            if (pass === 'clicked') {
                setStatus('正在自动通过安全验证…');
                return;
            }
            if (pass === 'manual') {
                setStatus('检测到安全验证：这次要拖滑块，请手动完成，脚本会自动继续');
                return;
            }

            // 点了没通过（还在转圈 / 已点满次数）→ 刷新页面换一次会话
            if (state.captchaClicks >= CONFIG.captchaReloadAfter) {
                if (canReload) {
                    reloadToRetry(reloads);
                } else {
                    setStatus('安全验证反复失败，请手动完成验证；换网络后点「暂停」再「继续」可重试');
                }
                return;
            }

            setStatus('正在等待安全验证结果…');
            return;
        }
        state.captchaClicks = 0;
        state.lastCaptchaClick = 0;

        // 4) 提交确认弹窗 → 点「确定」
        var dlg = findDialogConfirm();
        if (dlg) {
            if (Date.now() - state.lastClick < 1500) return;
            state.lastClick = Date.now();
            setStatus('已点击确认弹窗');
            try {
                dlg.click();
            } catch (e) {}
            return;
        }

        // 5) 找到「提交」按钮，先填答案再点提交
        var btn = findSubmit();
        if (!btn) {
            if (state.clickedAt && Date.now() - state.clickedAt < 20000) {
                setStatus('已点击提交，等待服务器返回结果…');
            } else {
                setStatus('找不到「提交」按钮，等待页面加载…');
            }
            return;
        }

        fillAll();

        if (Date.now() - state.lastClick < CONFIG.clickCooldownMs) return;

        // 自动点击多次无效：提示人工点一次，但循环不会停
        if (state.attempts >= CONFIG.submitRetry) {
            if (!state.stalledAt) state.stalledAt = Date.now();
            if (Date.now() - state.stalledAt > 60000) {
                state.stalledAt = Date.now();
                state.attempts = 0;
            } else {
                setStatus('自动点击未生效，请手动点一次页面上的「提交」；提交成功后循环会自动继续');
                return;
            }
        }

        state.attempts++;
        state.lastClick = Date.now();
        state.clickedAt = Date.now();
        // 记下这一份的标记，提交成功后（可能在完成页）靠它去重计数
        writeStr(KEY.pending, newRoundToken('r'));
        setStatus('正在提交第 ' + (currentCount() + 1) + ' 份（第 ' + state.attempts + ' 次尝试）');
        clickSubmit(btn);
    }

    function finishRound() {
        if (state.finished) return;
        state.finished = true;
        stopLoop();

        countRound();
        var n = currentCount();

        if (CONFIG.maxRounds > 0 && n >= CONFIG.maxRounds) {
            setStatus('第 ' + n + ' 份提交成功，已达到设定份数，停止循环');
            return;
        }

        // 间隔加一点随机抖动，别让每次间隔一模一样
        var delay = CONFIG.intervalMs + Math.floor(Math.random() * (CONFIG.intervalJitterMs + 1));

        setStatus('第 ' + n + ' 份提交成功，' + Math.round(delay / 1000) + ' 秒后自动进入下一份…');

        setTimeout(function () {
            goNextRound();
        }, delay);
    }

    function goNextRound() {
        if (/\/vm\//i.test(location.pathname)) {
            location.reload();
            return;
        }
        var url = backToSurveyUrl();
        if (url) {
            location.replace(url);
            return;
        }
        location.reload();
    }

    /* ---------------------- 启动 ---------------------- */
    function init() {
        // 提交完成页（complete.aspx / completemobile2.aspx 等）：计数后跳回问卷，接着下一份
        if (onCompletePage()) {
            var backUrl = backToSurveyUrl();
            if (!backUrl) {
                // 没有可跳回的问卷地址（比如 jq 老问卷），交回原有逻辑处理
                return;
            }
            buildPanel();
            // 这一份的计数如果还没在问卷页上记过，在这里补记一次（同一份不会重复计）
            countRound();
            updateCount();
            setStatus('第 ' + currentCount() + ' 份提交完成，正在跳回问卷继续下一份…');
            setTimeout(function () {
                location.replace(backUrl);
            }, 1200);
            return;
        }

        // 只在 vm 版问卷页上工作
        if (!/\/vm\//i.test(location.pathname)) return;

        buildPanel();
        updateCount();
        saveSurveyUrl();

        if (!CONFIG.autoStart) {
            setStatus('已就绪，点「立即提交」开始');
            return;
        }

        setStatus('正在自动填写答案…');
        setTimeout(function () {
            updateCount();
            startLoop();
        }, 500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

/* ==================== 二、其他旧版页面：原随机答题逻辑 ==================== */

// vm 版问卷及其提交完成页由上面的循环逻辑接管，其余页面仍走原来的随机答题逻辑
if (!(function () {
    if (/\/vm\//i.test(location.pathname)) return true;
    // 提交完成页：只要还能找回 vm 问卷地址（sessionStorage 记录或地址里的 activityid），就交给上面的循环逻辑
    if (!/completemobile|complete\d*\.aspx|\/join\/complete/i.test(location.pathname)) return false;
    try {
        var raw = window.sessionStorage.getItem('wjxLoop.surveyUrl');
        if (raw) {
            var obj = JSON.parse(raw);
            if (obj && /\/(vm|jq|m|hj)\/[\w.-]+\.aspx/i.test(obj.url || '') &&
                Date.now() - (obj.at || 0) < 6 * 60 * 60 * 1000) return true;
        }
    } catch (e) {}
    // 地址里 activityid 是字母数字混排（如 OSVkDa2）说明是 vm 版问卷；纯数字是老 jq 问卷，留给下面的旧逻辑
    var m = /[?&]activityid=([A-Za-z0-9_-]+)/i.exec(location.search);
    return !!(m && /[A-Za-z]/.test(m[1]));
})()) {
    (function() {
    'use strict';

    // 配置填空的答案项,如果不配置,默认填无
    var config = [
        {
            id: 3,//第三题:你每个月的生活费用是多少元？
            answer: [800,900,1000,1100,1500,2000]//随机选出一个答案
        },
        {
            id: 4,//第四题:你的生活费用来源是？
            answer: ["父母给","自己兼职","傍富婆"]
        },
        {
            id: 6,//第六题:你曾经或现在的恋爱时长是多长时间？（X日/X个月/X年）
            answer: ["三天","一个月","两个月","五个月","十个月","一年","两年","三年","五年","十年"]
        },
        {
            id: 7,//第七题:恋爱时的每月花费是多少元？
            answer: [100,200,300,400,500,600,700,800,900,1000,1500,2000]
        },
        {
            id: 16,//第七题:根据第15题，选择该地区的原因是？
            answer: ["个人喜好","没有原因"]
        },
        {
            id: 17,//第七题:你对另一半的身高要求具体是多少m？（数值）
            answer: [1.6,1.65,1.7,1.75,1.8,1.85,1.9]
        },
        {
            id: 18,//第七题:你能接受另一半的恋爱次数最多是多少次？（数值）
            answer: [0,1,2,3,4,5,6,7,8,9,10]
        },
        {
            id: 19,//第七题:你认为大学期间情侣每天在一起多长时间合适？（X个小时）
            answer: [0.5,1,1.5,2,2.5,3,3.5,4]
        }
    ];



    //答题结束，则打开新的问卷
    (function openNew() {
        var currentURL = window.location.href;
        var pat = /complete\.aspx\?activityid=(\d+)/;
        var obj = pat.exec(currentURL);
        if (obj) {
            window.location.href = "https://www.wjx.cn/jq/" + obj[1] + ".aspx";
        } else {
            console.log("not pat", obj);
        }
    })();


    var currentURL = window.location.href;
    //自动转为电脑网页版
    (function redirect() {
        try {
            var pat = /(https:\/\/www\.wjx\.cn\/)(jq|m)(.*)/g;
            var obj = pat.exec(currentURL);
            if (obj[2] == "m") {
                console.log("redirect now");
                window.location.href = obj[1] + "jq" + obj[3];
            } else {
                console.log("do!");
            }
        } catch (error) {}
    })();


    /**
     *
     *
     * @param {int} min The minimum value in the range
     * @param {int} max The maxmum value in the range
     * @return {int} Return Returns a random number within this range (both include)
     */
    function randint(min, max) {
        return Math.floor(Math.random() * (max - min + 1) + min);
    }

    function getRandomArrayElements(arr, count) {
        var shuffled = arr.slice(0), i = arr.length, min = i - count, temp, index;
        while (i-- > min) {
            index = Math.floor((i + 1) * Math.random());
            temp = shuffled[index];
            shuffled[index] = shuffled[i];
            shuffled[i] = temp;
        }
        return shuffled.slice(min);
    }


    /**
     * @description 该函数用于自动选择
     */
    function RandomChoose() {
        /**
         * @name 普通单选题随机选择
         * @param {object}  subject single subject
         */
        this.singleChoose = function(subject) {
            if (subject.querySelectorAll("img")[0]) { //带有图片的，无法直接click 标签<li>
                var img = subject.querySelectorAll("img");
                img[randint(0, img.length - 1)].click();
            } else {
                var list = subject.querySelectorAll("li");
                var no;
                for(var i = 0; i < list.length; i++){
                    if(list[i].querySelector(".underline") != null){
                        no = i;
                    }
                }
                var index = randint(0, list.length - 1);
                while(index == no){index = randint(0, list.length - 1);}
                list[index].click();

            }
        }

        /****
         * @name    普遍多选题随机选择
         * @param {object}  subject single subject
         *
         */
        this.multiChoose = function(subject) {
            var list = subject.querySelectorAll("li");
            var arr = new Array();
            for (var i = 0; i < list.length; i++) {
                if (list[i].querySelectorAll("input")[0].checked == true) {
                    list[i].click();
                }
                arr.push(list[i]);
            }
            var times = randint(3, arr.length - 1); // 多选题选择数量，一般不小于3
            var indexAry = getRandomArrayElements(arr, times);//准备选中的项
            var no;//禁止项
            for(var j = 0; j < indexAry.length; j++){
                if(indexAry[j].querySelector(".underline") != null){//去除多选框里需要填空的项
                    console.log(indexAry[j]);
                    no = j;
                }
            }
            for (i = 0; i < indexAry.length; i++) {
                if (indexAry[i].querySelectorAll("input")[0].checked == false && (i != no)) {
                    indexAry[i].click();
                }
            }
//             for (i = 0; i < times; i++) {
//                 var randomChoose = arr.splice(randint(0, arr.length - 1), 1)[0];
//                 if (randomChoose.querySelectorAll("input")[0].checked == false) {
//                     randomChoose.click();
//                 }
//             }
        }



        //随机排序题
        this.randomSort = function(subject) {
            var list = subject.querySelectorAll("li");
            var arr = new Array();
            for (var i = 0; i < list.length; i++) {
                list[i].querySelectorAll("input")[0].checked = false;
                list[i].querySelectorAll("span")[0].classList.remove("sortnum-sel"); //事实上这个只是一个样式，真正选择在于checkd = true || false
                arr.push(list[i]);
            }
            for (i = 0; i < list.length; i++) {
                var randomChoose = arr.splice(randint(0, arr.length - 1), 1)[0];
                randomChoose.querySelectorAll("input")[0].checked = true;
                randomChoose.querySelectorAll("span")[0].classList.add("sortnum-sel");
                randomChoose.querySelectorAll("span")[0].innerHTML = i + 1;
            }
        }

        //表格单选
        this.martixSingleChoose = function(subject) {
                var tr = subject.querySelectorAll("tbody > tr");
                for (var i = 0; i < tr.length; i++) {
                    var td = tr[i].querySelectorAll("td");
                    td[randint(0, td.length - 1)].click();
                }
            }
            //表格多选
        this.martixMultiChoose = function(subject) {
            var tr = subject.querySelectorAll("tbody > tr");
            for (var i = 0; i < tr.length; i++) {
                var td = tr[i].querySelectorAll("td");
                var arr = new Array();
                for (var j = 0; j < td.length; j++) {
                    td[j].querySelectorAll("input")[0].checked = false;
                    td[j].querySelectorAll("a")[0].classList.remove("jqChecked");
                    arr.push(td[j]);
                }

                var times = randint(3, arr.length - 1); // 多选题选择数量，一般不小于3
                for (var k = 0; k < times; k++) {
                    var randomChoose = arr.splice(randint(0, arr.length - 1), 1)[0];
                    randomChoose.querySelectorAll("input")[0].checked = true;
                    randomChoose.querySelectorAll("a")[0].classList.add("jqChecked");
                }
                console.log(times);
            }
        }
        this.martixStar = function(subject) {
            var tr = subject.querySelectorAll("tbody > tr");
            for (var i = 0; i < tr.length; i++) {
                var list = tr[i].querySelectorAll("li");
                var rnnum = randint(0, list.length - 1);
                list[rnnum].click();
                console.log(i, rnnum);
            }
        }

        this.dropdownSelect = function(subject) {
            var select = subject.querySelectorAll("select")[0];
            var rnnum = randint(1, select.length - 1);
            select.selectedIndex = rnnum;
        }

        this.singleSlider = function(subject) {

            /**
             *
             * @param {int} _value 随机值
             * @param {*} min 可选的最小值
             * @param {*} max 可选的最大值
             * @param {*} subject 题目
             * @description 里面的_coordsX, _Number, getElCoordinate, 方法不用管，这是根据网页的方法复制下来的， 用来反模拟出clientX的值（即鼠标的值）, 因为网页上没有提供js直接修改的value，因此只能模拟鼠标时间来点击拉条，需要参数clientX。
             *
             */
            function getClientX(_value, min, max, subject) {
                var _bar = subject.querySelectorAll(".imageBar1")[0];
                var _slider = subject.querySelectorAll(".imageSlider1")[0]

                function _coordsX(x) {
                    x = _Number(x);
                    x = x <= _slider.offsetLeft ? _slider.offsetLeft : x >= _slider.offsetLeft + _slider.offsetWidth - _bar.offsetWidth ? _slider.offsetLeft + _slider.offsetWidth - _bar.offsetWidth : x;
                    return x;
                }

                function _Number(b) {
                    return isNaN(b) ? 0 : b;
                }

                function getElCoordinate(h) {
                    var e = h.offsetLeft;
                    while (h = h.offsetParent) {
                        e += h.offsetLeft;
                    }
                    return {
                        left: e,
                    };
                }

                var x = (_value - min) * ((_slider.offsetWidth - _bar.offsetWidth) / (max - min));
                x = _coordsX(x);
                var clientX = x + getElCoordinate(_slider).left + (_bar.offsetWidth / 2);
                return Math.round(clientX);
            }

            var max = Number(subject.querySelectorAll(".slider")[0].getAttribute("maxvalue"));
            var min = Number(subject.querySelectorAll(".slider")[0].getAttribute("minvalue"));
            //模拟鼠标点击的事件, 关键参数ClientX
            var evt = new MouseEvent("click", {
                clientX: getClientX(randint(min, max), min, max, subject),
                type: "click",
                __proto__: MouseEvent,
            });
            subject.querySelectorAll(".ruler")[0].dispatchEvent(evt);
        }
        this.singleStar = function(subject) {
            var list = subject.querySelectorAll("li:not([class='notchoice'])");
            list[randint(0, list.length - 1)].click();
        }
    }


    /**
     * @name 智慧树题目类型判断，并随机选择
     */
    function judgeType() {
        //q = $$(".div_question");
        var q = document.getElementsByClassName("div_question");
        var rc = new RandomChoose();
        for (var i = 0; i < q.length; i++) {
            //普通单选 or 多选
            if ((q[i].querySelectorAll(".ulradiocheck")[0]) && (q[i].querySelectorAll("input")[0])) { // 非表格单选或者多选
                var input = q[i].querySelectorAll("input");
                if (input[0].type == 'radio') {
                    console.log("单选题", i);
                    rc.singleChoose(q[i]);
                } else if (input[0].type == 'checkbox') {
                    console.log("多选题", i);
                    rc.multiChoose(q[i]);
                }

                //表格
            } else if (q[i].querySelectorAll("table")[0]) {
                if (q[i].querySelectorAll("input")[0]) { // 表格题中包含有单选， 多选
                    input = q[i].querySelectorAll("input");
                    if (input[0].type == 'radio') {
                        console.log("表格单选", i);
                        rc.martixSingleChoose(q[i]);
                    } else if (input[0].type == 'checkbox') {
                        console.log("表格多选", i);
                        rc.martixMultiChoose(q[i]);
                    }
                } else if (!q[i].querySelectorAll("input")[0] && q[i].querySelectorAll("li")[0]) { // 表格中的星星题目，没有Input标签
                    console.log("Martix-Star", i);
                    rc.martixStar(q[i]);
                }
                // 填空题
            } else if (q[i].querySelectorAll("textarea")[0]) {
                for(var j = 0; j < config.length; j++){
                    if(q[i].querySelectorAll("textarea")[0].id == ("q" + config[j].id)){
                        q[i].querySelectorAll("textarea")[0].value = config[j].answer[Math.floor(Math.random()*config[j].answer.length)];
                    }
                }

                console.log("填空", i);
            } else if (q[i].querySelectorAll(".slider")[0]) {
                console.log("Slider-Single-line", i);
                rc.singleSlider(q[i]);
            } else if (q[i].querySelectorAll(".notchoice")[0]) {
                console.log("Star-Single-line", i);
                rc.singleStar(q[i]);
            } else if (q[i].querySelectorAll(".lisort")[0]) {
                console.log("li-Sort", i);
                rc.randomSort(q[i]);
            } else if (q[i].querySelectorAll("select")[0]) {
                console.log("Select", i);
                rc.dropdownSelect(q[i]);
            }
        }
        try{
            var textArea = document.getElementsByTagName('textarea');
            //textArea[0].value = "无";
            //textArea[1].value = "无";
        }catch(error){}
    }
    judgeType();

    //滚动到提交按钮处
    try {
        var scrollvalue = document.getElementById("submit_button").offsetParent.offsetParent.offsetTop;
        window.scrollTo({
            top: scrollvalue,
            behavior: "smooth"
        });
    } catch (error) {}

    })();
    window.alert = function(str) {
       location.reload();
       return ;
    }
    setTimeout(function(){
        // 延时两秒防止验证
        document.getElementById("submit_button").click();
        console.log("答题成功!");
    },2000);
    setTimeout(function(){
        // 5秒自动刷新,解决验证问题
        location.reload();
    },5000);
}
