"use strict";

/* =========================================================
 * 新楓之谷 VIP 階級計算機
 * 規則來源：官方公告（台幣 : 樂豆點 = 1 : 1）
 * 核心：以「VIP 點數」為門檻基準，皇家黑不列入計算
 *
 * 功能：目標試算
 *   輸入目前累積 VIP 點數 + 選擇目標階級
 *   → 還差多少 VIP 點數 / 換算還需消費
 * ========================================================= */

/* ---------------------------------------------------------
 * 階級資料（單一資料來源，所有計算與表格共用）
 *   points   : 達成該階級需累積的 VIP 點數門檻
 *   buyRate  : 達成該階級時所處等級的「購買」倍率（點數↔金額換算用）
 *   giftRate : 達成該階級時所處等級的「送禮」倍率
 *   img      : 徽章圖檔路徑（非VIP 無圖，由 CSS 色塊 fallback）
 *
 *   倍率對應官方達成路徑：
 *     銀牌 from 非VIP(20/16)、金牌 from 銀牌(20/16)、
 *     鑽石 from 金牌(30/24)、皇家 from 鑽石(40/32)
 * --------------------------------------------------------- */
const TIERS = [
    { key: "none",    name: "非VIP", points: 0,       buyRate: 20, giftRate: 16, img: null },
    { key: "silver",  name: "銀牌",  points: 50000,   buyRate: 20, giftRate: 16, img: "image/銀牌.png" },
    { key: "gold",    name: "金牌",  points: 150000,  buyRate: 20, giftRate: 16, img: "image/金牌.png" },
    { key: "diamond", name: "鑽石",  points: 675000,  buyRate: 30, giftRate: 24, img: "image/鑽石.png" },
    { key: "royal",   name: "皇家",  points: 3675000, buyRate: 40, giftRate: 32, img: "image/皇家.png" }
];

// 目前選定的目標階級 key（徽章選擇器狀態）
let goalKey = "diamond";

/* =========================================================
 * 工具函式
 * ========================================================= */

// 依 key 取得階級物件
function getTier(key) {
    return TIERS.find(function (t) {
        return t.key === key;
    });
}

// 取得階級在指定消費類型（buy / gift）下的達成倍率
function tierRate(tier, type) {
    return type === "gift" ? tier.giftRate : tier.buyRate;
}

// 達成某階級所需消費金額（VIP 點數門檻 ÷ 達成倍率，無條件進位）
function achieveAmount(tier, type) {
    if (tier.points === 0) {
        return 0;
    }
    return Math.ceil(tier.points / tierRate(tier, type));
}

// 由目前累積點數到目標階級，換算還需消費金額（以目標階級達成倍率計算，無條件進位）
function costToReach(currentPoints, target, type) {
    if (currentPoints >= target.points) {
        return 0;
    }
    return Math.ceil((target.points - currentPoints) / tierRate(target, type));
}

// 千分位整數格式化
function fmt(n) {
    return Math.round(n).toLocaleString("zh-TW");
}

// 取得元素值
function valById(id) {
    return document.getElementById(id).value;
}

/* =========================================================
 * 徽章與色點 HTML
 * ========================================================= */

// 產生階級徽章 HTML（有圖檔則顯示圖，載入失敗時 onerror 隱藏並露出 CSS 色塊與文字）
function badgeHtml(tier) {
    let inner = '<span class="badge-text">' + tier.name + "</span>";
    if (tier.img) {
        inner = '<img class="badge-img" src="' + tier.img + '" alt="' + tier.name +
            '" onerror="this.style.display=\'none\'">' + inner;
    }
    return '<div class="badge lv-' + tier.key + '">' + inner + "</div>";
}

// 產生表格用的小色點 HTML
function miniDot(key) {
    return '<span class="mini-dot lv-' + key + '"></span>';
}

/* =========================================================
 * 目標試算：目前累積點數 + 目標階級 → 還差多少 / 還需消費
 * ========================================================= */

// 依目前累積點數與選定的目標階級，計算還差的 VIP 點數與換算消費
function calcGoal() {
    const current = Number.parseInt(valById("cPoints"), 10) || 0;
    const goal = getTier(goalKey);

    let html = badgeHtml(goal) + '<div class="res-info">';
    html += '<div class="res-tier">目標：' + goal.name + "</div>";

    if (current >= goal.points) {
        html += '<div class="res-sub">已達成（目前 ' + fmt(current) + " 點已足夠）</div>";
    } else {
        const gap = goal.points - current;
        html += '<div class="res-sub">距「' + goal.name + '」還差 <b>' +
            fmt(gap) + "</b> VIP 點數</div>";
        html += '<div class="res-cost"><span class="res-cost-title">換算消費</span>' +
            '<span>購買：約 <b>' + fmt(costToReach(current, goal, "buy")) + "</b> 元</span>" +
            '<span>送禮：約 <b>' + fmt(costToReach(current, goal, "gift")) + "</b> 元</span></div>";
    }

    html += "</div>";
    document.getElementById("goalResult").innerHTML = html;
}

// 渲染目標階級的徽章選擇器（點圖示即可選擇任意階級）
function renderTierPicker() {
    const box = document.getElementById("tierPicker");
    let html = "";
    TIERS.filter(function (t) {
        return t.key !== "none";
    }).forEach(function (t) {
        html += '<button type="button" class="tier-opt' + (t.key === goalKey ? " selected" : "") +
            '" data-key="' + t.key + '">' + badgeHtml(t) +
            '<span class="tier-opt-name">' + t.name + "</span></button>";
    });
    box.innerHTML = html;

    // 綁定點擊：更新選定階級、刷新高亮並重算
    box.querySelectorAll(".tier-opt").forEach(function (btn) {
        btn.addEventListener("click", function () {
            goalKey = btn.dataset.key;
            updatePickerSelected();
            calcGoal();
        });
    });
}

// 依目前選定的目標階級，更新徽章選擇器的高亮狀態
function updatePickerSelected() {
    document.querySelectorAll("#tierPicker .tier-opt").forEach(function (btn) {
        btn.classList.toggle("selected", btn.dataset.key === goalKey);
    });
}

/* =========================================================
 * 階級門檻一覽表
 * ========================================================= */

// 渲染底部「階級門檻一覽」表（點數門檻 + 購買 / 送禮換算金額）
function renderThresholdTable() {
    const tbody = document.querySelector("#thresholdTable tbody");
    let html = "";
    TIERS.filter(function (t) {
        return t.key !== "none";
    }).forEach(function (t) {
        html += "<tr>";
        html += '<td class="tier-cell">' + miniDot(t.key) + t.name + "</td>";
        html += "<td>" + fmt(t.points) + "</td>";
        html += "<td>" + fmt(achieveAmount(t, "buy")) + "</td>";
        html += "<td>" + fmt(achieveAmount(t, "gift")) + "</td>";
        html += "</tr>";
    });
    tbody.innerHTML = html;
}

/* =========================================================
 * 初始化
 * ========================================================= */

// 綁定單一輸入元素的即時計算事件
function bind(id, fn) {
    const el = document.getElementById(id);
    el.addEventListener("input", fn);
    el.addEventListener("change", fn);
}

// 頁面載入後渲染選擇器與表格、綁定事件並執行首次計算
function init() {
    renderTierPicker();
    renderThresholdTable();

    bind("cPoints", calcGoal);

    calcGoal();
}

document.addEventListener("DOMContentLoaded", init);
