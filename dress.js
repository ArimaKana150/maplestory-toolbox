"use strict";

/* =========================================================
 * 新楓之谷 工具箱 — 角色穿搭預覽器
 * 資料來源：maplestory.io 公開 API（地區 TWMS 台服 / 版本 256）
 *
 * 版面：左=已穿戴(中文名+代碼)、中=角色預覽+染色、右=衣櫃(滾動)
 * 道具來源：item list 全量快取（含髮型/臉，皆有中文名、isCash、性別）
 * 染色：單品 {"itemId":id,"hue":0-360}；現金裝近似為「可染色」並標圖示
 * ========================================================= */

/* ---------------------------------------------------------
 * API 常數與基底角色
 * --------------------------------------------------------- */
const REGION = "TWMS";
const VERSION = "256";
const API = "https://maplestory.io/api/" + REGION + "/" + VERSION;
const CACHE_KEY = "equipCacheV2_" + REGION + "_" + VERSION; // 含 cash/gender 欄位的快取

// 角色狀態
const state = {
    skin: 2000,
    head: 12000,
    items: { face: 20000, hair: 30030, hat: null, top: null, bottom: null, overall: null, shoes: null, weapon: null },
    names: { face: "", hair: "" },
    dyes: {},
    selectedSlot: null
};

// 可選膚色（實測 TWMS 可用的基底身體 id）
const SKINS = [
    { id: 2000, name: "淺色" },
    { id: 2001, name: "紅潤" },
    { id: 2002, name: "蒼白" },
    { id: 2003, name: "古銅" },
    { id: 2004, name: "黝黑" }
];

/* ---------------------------------------------------------
 * 分類定義（全部從 item list 快取過濾，皆有中文名）
 *   match(x) : 以快取精簡道具 {id,name,sub,cat,cash,gender} 判斷
 * --------------------------------------------------------- */
const CATEGORIES = [
    { key: "hair",    name: "髮型", slot: "hair",    match: function (x) { return x.sub === "Hair"; } },
    { key: "face",    name: "臉型", slot: "face",    match: function (x) { return x.sub === "Face"; } },
    { key: "hat",     name: "帽子", slot: "hat",     match: function (x) { return x.sub === "Hat"; } },
    { key: "top",     name: "上衣", slot: "top",     match: function (x) { return x.sub === "Top"; } },
    { key: "overall", name: "套服", slot: "overall", match: function (x) { return x.sub === "Overall"; } },
    { key: "bottom",  name: "下身", slot: "bottom",  match: function (x) { return x.sub === "Bottom"; } },
    { key: "shoes",   name: "鞋子", slot: "shoes",   match: function (x) { return x.sub === "Shoes"; } },
    { key: "weapon",  name: "武器", slot: "weapon",  match: function (x) { return (x.cat || "").includes("Weapon"); } }
];

// 已穿清單顯示用的分類中文對照
const SLOT_LABEL = {
    face: "臉型", hair: "髮型", hat: "帽子", top: "上衣",
    bottom: "下身", overall: "套服", shoes: "鞋子", weapon: "武器"
};

// 裝備庫快取；目前分類、目前清單、篩選狀態
let EQUIP_CACHE = null;
let currentCat = CATEGORIES[0];
let currentList = [];
let filterCash = "all";   // all | cash | normal
let filterGender = "all"; // all | male | female

// DOM 參照（init 時設定）
let elGrid, elScroll, elSearchBox;

/* =========================================================
 * 工具函式
 * ========================================================= */

// 取得分類物件
function getCat(key) {
    return CATEGORIES.find(function (c) { return c.key === key; });
}

// 道具縮圖 URL
function iconUrl(id) {
    return API + "/item/" + id + "/icon";
}

// HTML 轉義
function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
}

// 將單一部件轉為合成 URL 片段：有染色則用 JSON {itemId,hue}，否則純 id
function partToken(id, slot) {
    const hue = state.dyes[slot];
    if (hue) {
        return encodeURIComponent(JSON.stringify({ itemId: id, hue: hue }));
    }
    return String(id);
}

// 由目前狀態組出角色合成圖 URL（套服取代上下身，套用各部件染色）
function buildCharacterUrl() {
    const it = state.items;
    const parts = [String(state.head)];
    if (it.face) parts.push(partToken(it.face, "face"));
    if (it.hair) parts.push(partToken(it.hair, "hair"));
    if (it.hat) parts.push(partToken(it.hat, "hat"));
    if (it.overall) {
        parts.push(partToken(it.overall, "overall"));
    } else {
        if (it.top) parts.push(partToken(it.top, "top"));
        if (it.bottom) parts.push(partToken(it.bottom, "bottom"));
    }
    if (it.shoes) parts.push(partToken(it.shoes, "shoes"));
    if (it.weapon) parts.push(partToken(it.weapon, "weapon"));
    return API + "/character/" + state.skin + "/" + parts.join(",") + "/stand1/0?resize=2";
}

/* =========================================================
 * 裝備庫快取載入（item list 並行全量抓取，含髮型/臉）
 * ========================================================= */

// 確保快取已載入：優先讀本機快取，否則並行抓完整個 item list
function ensureEquipCache(progressCb) {
    if (EQUIP_CACHE) {
        return Promise.resolve(EQUIP_CACHE);
    }
    try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
            EQUIP_CACHE = JSON.parse(cached);
            return Promise.resolve(EQUIP_CACHE);
        }
    } catch {
        return loadEquipFromApi(progressCb);
    }
    return loadEquipFromApi(progressCb);
}

// 並行抓完整個 item list，收集所有 Equip（含髮型/臉，皆有中文名）
function loadEquipFromApi(progressCb) {
    const STEP = 2000;
    const BATCHES = 25; // 涵蓋整個 item list
    const all = [];
    let done = 0;

    const tasks = [];
    for (let b = 0; b < BATCHES; b++) {
        const url = API + "/item?count=" + STEP + "&startPosition=" + (b * STEP);
        tasks.push(
            fetch(url).then(function (r) { return r.json(); }).then(function (list) {
                list.forEach(function (it) {
                    const ti = it.typeInfo || {};
                    if (ti.overallCategory === "Equip") {
                        all.push({
                            id: it.id, name: it.name, sub: ti.subCategory,
                            cat: ti.category || "", cash: !!it.isCash, gender: it.requiredGender
                        });
                    }
                });
            }).catch(function () {
                return null;
            }).then(function () {
                done++;
                if (progressCb) progressCb(done, BATCHES);
            })
        );
    }

    return Promise.all(tasks).then(function () {
        all.sort(function (a, b) { return a.id - b.id; });
        const dedup = all.filter(function (x, i) { return i === 0 || x.id !== all[i - 1].id; });
        EQUIP_CACHE = dedup;
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(dedup));
        } catch {
            return dedup; // 超出配額則僅用記憶體快取
        }
        return dedup;
    });
}

/* =========================================================
 * 預覽
 * ========================================================= */

// 重新載入角色預覽圖
function renderPreview() {
    document.getElementById("charPreview").src = buildCharacterUrl();
}

/* =========================================================
 * 已穿戴清單（左欄，中文名 + 代碼，可點選染色）
 * ========================================================= */

// 渲染已穿戴清單
function renderWornList() {
    const box = document.getElementById("wornList");
    let html = '<div class="worn-item worn-base">' +
        '<span class="worn-thumb worn-thumb-base"></span>' +
        '<div class="worn-meta"><span class="worn-label">基底</span>' +
        '<span class="worn-sub">膚色 ' + state.skin + " · 頭 " + state.head + "</span></div></div>";

    Object.keys(SLOT_LABEL).forEach(function (slot) {
        const id = state.items[slot];
        if (!id) {
            return;
        }
        const name = state.names[slot];
        const sel = state.selectedSlot === slot ? " selected" : "";
        const dyed = state.dyes[slot] ? '<span class="worn-dyed">染 ' + state.dyes[slot] + "°</span>" : "";
        html += '<div class="worn-item worn-pick' + sel + '" data-slot="' + slot + '">' +
            '<img class="worn-thumb" src="' + iconUrl(id) + '" alt="" onerror="this.style.visibility=\'hidden\'">' +
            '<div class="worn-meta"><span class="worn-label">' + (name ? esc(name) : SLOT_LABEL[slot]) + "</span>" +
            '<span class="worn-sub">' + SLOT_LABEL[slot] + " · 代碼 " + id + dyed + "</span></div>" +
            '<button type="button" class="worn-remove" data-slot="' + slot + '">移除</button></div>';
    });
    box.innerHTML = html;

    box.querySelectorAll(".worn-pick").forEach(function (row) {
        row.addEventListener("click", function () {
            state.selectedSlot = row.dataset.slot;
            renderWornList();
            renderDyePanel();
        });
    });
    box.querySelectorAll(".worn-remove").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
            e.stopPropagation();
            const slot = btn.dataset.slot;
            state.items[slot] = null;
            delete state.dyes[slot];
            delete state.names[slot];
            if (state.selectedSlot === slot) state.selectedSlot = null;
            renderPreview();
            renderWornList();
            renderDyePanel();
            syncGridSelection();
        });
    });
}

/* =========================================================
 * 染色 / 物品資訊（中欄角色下方）
 * ========================================================= */

// 渲染染色面板：顯示選取物品資訊與色相滑桿
function renderDyePanel() {
    const panel = document.getElementById("dyePanel");
    const slot = state.selectedSlot;
    const id = slot ? state.items[slot] : null;

    if (!id) {
        panel.innerHTML = '<p class="dye-empty">點選左側「已穿戴」中的物品，即可在此調整染色（色相）。</p>';
        return;
    }

    const name = state.names[slot];
    const hue = state.dyes[slot] || 0;
    panel.innerHTML =
        '<div class="dye-head">' +
            '<img class="dye-thumb" src="' + iconUrl(id) + '" alt="" onerror="this.style.visibility=\'hidden\'">' +
            '<div class="dye-info">' +
                '<span class="dye-name">' + (name ? esc(name) : SLOT_LABEL[slot]) + "</span>" +
                '<span class="dye-meta">' + SLOT_LABEL[slot] + " · 道具代碼 " + id + "</span>" +
            "</div>" +
        "</div>" +
        '<div class="dye-control">' +
            '<label class="dye-label">色相 <b id="hueVal">' + hue + "</b>°</label>" +
            '<input type="range" id="hueSlider" min="0" max="360" step="1" value="' + hue + '">' +
            '<button type="button" id="hueReset" class="dye-reset">重置</button>' +
        "</div>";

    let hueTimer = null;
    document.getElementById("hueSlider").addEventListener("input", function () {
        document.getElementById("hueVal").textContent = this.value;
        const v = Number(this.value);
        clearTimeout(hueTimer);
        hueTimer = setTimeout(function () {
            state.dyes[slot] = v;
            renderPreview();
        }, 200);
    });
    document.getElementById("hueReset").addEventListener("click", function () {
        delete state.dyes[slot];
        renderDyePanel();
        renderWornList();
        renderPreview();
    });
}

/* =========================================================
 * 道具卡片與選取（右欄衣櫃）
 * ========================================================= */

// 可染色圖示（現金裝近似為可染色）
const DYE_BADGE = '<span class="dye-badge" title="現金裝，多數可染色">' +
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3c3.2 4.2 6 7.2 6 11a6 6 0 0 1-12 0c0-3.8 2.8-6.8 6-11z"/></svg></span>';

// 產生道具卡片 HTML（縮圖 + 名稱 + 道具代碼，現金裝加可染色圖示）
function itemCardHtml(id, name, slot, cash) {
    const selected = state.items[slot] === id ? " selected" : "";
    const label = name ? '<span class="item-name">' + esc(name) + "</span>" : "";
    const badge = cash ? DYE_BADGE : "";
    return '<button type="button" class="item-card' + selected + '" data-id="' + id +
        '" data-slot="' + slot + '" data-name="' + esc(name || "") + '">' + badge +
        '<img class="item-thumb" src="' + iconUrl(id) + '" alt="" loading="lazy" ' +
        'onerror="this.closest(\'.item-card\').style.display=\'none\'">' +
        label + '<span class="item-id">' + id + "</span></button>";
}

// 同步衣櫃卡片的選取高亮
function syncGridSelection() {
    elGrid.querySelectorAll(".item-card").forEach(function (card) {
        card.classList.toggle("selected", state.items[card.dataset.slot] === Number(card.dataset.id));
    });
}

// 選取道具：套用到對應 slot 並處理套服/上下身互斥
function selectItem(id, slot, name) {
    if (slot === "overall") {
        state.items.top = null;
        state.items.bottom = null;
        delete state.dyes.top;
        delete state.dyes.bottom;
    } else if (slot === "top" || slot === "bottom") {
        state.items.overall = null;
        delete state.dyes.overall;
    }
    state.items[slot] = id;
    state.names[slot] = name || "";
    renderPreview();
    renderWornList();
    renderDyePanel();
    syncGridSelection();
}

/* =========================================================
 * 衣櫃瀏覽：篩選 + 搜尋 + 一次全載入
 * ========================================================= */

// 依目前分類、篩選、搜尋關鍵字，建立要顯示的道具清單
function buildList() {
    const cat = currentCat;
    const kw = (elSearchBox.value || "").trim();
    let arr = EQUIP_CACHE.filter(function (x) { return cat.match(x); });

    if (filterCash === "cash") {
        arr = arr.filter(function (x) { return x.cash; });
    } else if (filterCash === "normal") {
        arr = arr.filter(function (x) { return !x.cash; });
    }
    if (filterGender === "male") {
        arr = arr.filter(function (x) { return x.gender !== 1; });
    } else if (filterGender === "female") {
        arr = arr.filter(function (x) { return x.gender !== 0; });
    }
    if (kw) {
        arr = arr.filter(function (x) { return x.name?.includes(kw) || String(x.id).includes(kw); });
    }
    currentList = arr.map(function (x) { return { id: x.id, name: x.name, cash: x.cash }; });
}

// 更新底部提示文字（顯示總數）
function updateScrollHint() {
    const hint = document.getElementById("scrollHint");
    const n = currentList.length;
    hint.textContent = n === 0 ? "找不到符合的" + currentCat.name : "共 " + n + " 件";
}

// 重建並一次渲染目前分類的全部道具（圖片用 lazy 載入）
function showCategory() {
    buildList();
    const slot = currentCat.slot;
    elGrid.innerHTML = currentList.map(function (x) {
        return itemCardHtml(x.id, x.name, slot, x.cash);
    }).join("");
    elScroll.scrollTop = 0;
    updateScrollHint();
}

// 確保快取載入再顯示（載入中顯示進度）
function loadCatalogThenShow() {
    if (EQUIP_CACHE) {
        showCategory();
        return;
    }
    elGrid.innerHTML = '<p class="grid-hint">首次載入道具庫中…</p>';
    document.getElementById("scrollHint").textContent = "";
    ensureEquipCache(function (done, total) {
        elGrid.innerHTML = '<p class="grid-hint">首次載入道具庫中… ' + done + " / " + total + " 批</p>";
    }).then(showCategory).catch(function () {
        elGrid.innerHTML = '<p class="grid-hint">道具庫載入失敗，請重新整理頁面</p>';
    });
}

/* =========================================================
 * 分類 / 篩選切換與初始化
 * ========================================================= */

// 切換到指定分類
function selectCategory(key) {
    currentCat = getCat(key);
    document.querySelectorAll("#catTabs .cat-tab").forEach(function (tab) {
        tab.classList.toggle("active", tab.dataset.key === key);
    });
    elSearchBox.placeholder = "搜尋" + currentCat.name + "名稱或代碼";
    loadCatalogThenShow();
}

// 渲染分類 tabs
function renderTabs() {
    const box = document.getElementById("catTabs");
    box.innerHTML = CATEGORIES.map(function (c) {
        return '<button type="button" class="cat-tab" data-key="' + c.key + '">' + c.name + "</button>";
    }).join("");
    box.querySelectorAll(".cat-tab").forEach(function (tab) {
        tab.addEventListener("click", function () { selectCategory(tab.dataset.key); });
    });
}

// 綁定篩選按鈕（類型 / 性別）
function bindFilters() {
    document.querySelectorAll("#cashFilter .filter-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
            filterCash = btn.dataset.v;
            setFilterActive("cashFilter", btn);
            if (EQUIP_CACHE) showCategory();
        });
    });
    document.querySelectorAll("#genderFilter .filter-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
            filterGender = btn.dataset.v;
            setFilterActive("genderFilter", btn);
            if (EQUIP_CACHE) showCategory();
        });
    });
}

// 切換篩選按鈕的 active 高亮
function setFilterActive(groupId, btn) {
    document.querySelectorAll("#" + groupId + " .filter-btn").forEach(function (b) {
        b.classList.toggle("active", b === btn);
    });
}

// 渲染膚色選擇器並顯示當前名稱
function renderSkins() {
    const box = document.getElementById("skinTones");
    box.innerHTML = SKINS.map(function (s) {
        const active = s.id === state.skin ? " active" : "";
        return '<button type="button" class="skin-dot' + active + '" data-skin="' + s.id +
            '" data-name="' + esc(s.name) + '" title="' + esc(s.name) + '"><img src="' + API + "/character/" + s.id +
            '/12000/stand1/0" alt="' + esc(s.name) + '" onerror="this.style.opacity=0.3"></button>';
    }).join("");
    box.querySelectorAll(".skin-dot").forEach(function (btn) {
        btn.addEventListener("click", function () {
            state.skin = Number(btn.dataset.skin);
            box.querySelectorAll(".skin-dot").forEach(function (b) {
                b.classList.toggle("active", b === btn);
            });
            updateSkinName();
            renderPreview();
            renderWornList();
        });
    });
    updateSkinName();
}

// 更新目前膚色名稱顯示
function updateSkinName() {
    const cur = SKINS.find(function (s) { return s.id === state.skin; });
    document.getElementById("skinName").textContent = cur ? cur.name : "";
}

// 頁面載入後初始化
function init() {
    elGrid = document.getElementById("itemGrid");
    elScroll = document.getElementById("itemScroll");
    elSearchBox = document.getElementById("searchBox");

    renderTabs();
    renderSkins();
    bindFilters();

    elGrid.addEventListener("click", function (e) {
        const card = e.target.closest(".item-card");
        if (!card) return;
        selectItem(Number(card.dataset.id), card.dataset.slot, card.dataset.name);
    });

    elSearchBox.addEventListener("input", function () {
        if (EQUIP_CACHE) showCategory();
    });

    renderPreview();
    renderWornList();
    renderDyePanel();

    const wantCat = new URLSearchParams(location.search).get("cat");
    selectCategory(getCat(wantCat) ? wantCat : CATEGORIES[0].key);
}

document.addEventListener("DOMContentLoaded", init);
