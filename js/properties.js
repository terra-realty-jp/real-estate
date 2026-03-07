/**
 * properties.js - 物件データ管理
 *
 * ここに物件情報を追加していくことで、ページに自動的に反映されます。
 * PROPERTIES_DATA 配列にオブジェクトを追加してください。
 *
 * フィールド説明:
 *   id       : 一意のID (数値)
 *   type     : 物件種別 "mansion" | "house" | "land" | "invest"
 *   badge    : バッジテキスト (任意) 例: "新着" | "おすすめ" | "価格改定"
 *   badgeType: バッジ色 "new" | "recommended" | "" (任意)
 *   image    : 画像パス (任意) 例: "images/property-001.jpg"
 *   title    : 物件名称
 *   location : 所在地
 *   details  : 詳細情報の配列 例: ["3LDK", "72.5m²", "4階/12階"]
 *   price    : 価格 (数値, 万円単位)
 *   contact  : 問い合わせリンク (省略時は "#contact")
 */

const PROPERTIES_DATA = [
  /* ---- 物件をここに追加してください ----

  {
    id: 1,
    type: "mansion",
    badge: "新着",
    badgeType: "new",
    image: "images/property-001.jpg",
    title: "物件名称をここに入力",
    location: "所在地をここに入力",
    details: ["3LDK", "00.0m²", "0階/0階"],
    price: 0000,
    contact: "#contact"
  },

  ---------------------------------------- */
];

/* ============================================================
   以下は表示ロジックです。通常は変更不要です。
   ============================================================ */

const TYPE_LABELS = {
  mansion: "マンション",
  house:   "一戸建て",
  land:    "土地",
  invest:  "収益物件"
};

function renderProperties(filter = "all") {
  const grid = document.getElementById("propertyGrid");
  const noMsg = document.getElementById("noPropertyMsg");
  if (!grid) return;

  const filtered = filter === "all"
    ? PROPERTIES_DATA
    : PROPERTIES_DATA.filter(p => p.type === filter);

  // 既存のカードを削除 (メッセージは残す)
  grid.querySelectorAll(".property-card").forEach(el => el.remove());

  if (filtered.length === 0) {
    if (noMsg) noMsg.style.display = "block";
    return;
  }
  if (noMsg) noMsg.style.display = "none";

  filtered.forEach(prop => {
    const card = document.createElement("div");
    card.className = "property-card";
    card.dataset.type = prop.type;

    const imageHtml = prop.image
      ? `<img src="${prop.image}" alt="${prop.title}" loading="lazy">`
      : `<div class="card-img-placeholder">${TYPE_LABELS[prop.type]?.[0] ?? "?"}</div>`;

    const badgeHtml = prop.badge
      ? `<span class="card-badge ${prop.badgeType ?? ""}">${prop.badge}</span>`
      : "";

    const detailsHtml = (prop.details ?? [])
      .map(d => `<span>${d}</span>`)
      .join("");

    const priceFormatted = prop.price.toLocaleString("ja-JP");

    card.innerHTML = `
      <div class="card-image">
        ${imageHtml}
        ${badgeHtml}
        <span class="card-type-badge">${TYPE_LABELS[prop.type] ?? prop.type}</span>
      </div>
      <div class="card-body">
        <h3 class="card-title">${prop.title}</h3>
        <p class="card-location">${prop.location}</p>
        <div class="card-details">${detailsHtml}</div>
        <div class="card-price-row">
          <span class="card-price">${priceFormatted}<small>万円</small></span>
        </div>
        <a href="${prop.contact ?? "#contact"}" class="card-btn">詳細・お問い合わせ</a>
      </div>
    `;
    grid.appendChild(card);
  });
}

// フィルタータブの初期化
document.addEventListener("DOMContentLoaded", () => {
  renderProperties("all");

  document.querySelectorAll(".filter-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".filter-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      renderProperties(tab.dataset.filter);
    });
  });
});
