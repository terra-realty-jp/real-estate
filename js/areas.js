/**
 * areas.js - 対応エリアデータ管理
 *
 * AREAS_DATA 配列に対応エリアを追加してください。
 *
 * フィールド説明:
 *   name    : エリア名 例: "東京都"
 *   image   : エリア画像パス (任意) 例: "images/area-tokyo.jpg"
 *   color   : 画像なし時の背景グラデーション (CSSグラデーション文字列)
 *   count   : 掲載物件数 (任意, 省略すると非表示)
 *   link    : リンク先URL (省略時は "#contact")
 */

const AREAS_DATA = [
  /* ---- エリアをここに追加してください ----

  {
    name: "[エリア名]",
    image: "images/area-xxx.jpg",
    color: "linear-gradient(135deg, #1a4d8f, #0d3b6e)",
    count: 0,
    link: "#contact"
  },

  ---------------------------------------- */
];

/* ============================================================
   以下は表示ロジックです。通常は変更不要です。
   ============================================================ */

function renderAreas() {
  const grid = document.getElementById("areaGrid");
  if (!grid) return;

  if (AREAS_DATA.length === 0) {
    grid.innerHTML = `<p class="placeholder-text" style="grid-column:1/-1">対応エリアは随時追加いたします。</p>`;
    return;
  }

  AREAS_DATA.forEach(area => {
    const card = document.createElement("div");
    card.className = "area-card";

    const bgStyle = area.image
      ? `background-image: url('${area.image}'); background-size: cover; background-position: center;`
      : `background: ${area.color ?? "linear-gradient(135deg, #1a4d8f, #0d3b6e)"};`;

    const countHtml = area.count != null
      ? `<p class="area-count">掲載物件 <strong>${area.count}</strong> 件</p>`
      : `<p class="area-count">&nbsp;</p>`;

    card.innerHTML = `
      <div class="area-img" style="${bgStyle}">
        <span class="area-name">${area.name}</span>
      </div>
      <div class="area-info">
        ${countHtml}
        <a href="${area.link ?? "#contact"}" class="area-link">物件を見る</a>
      </div>
    `;
    grid.appendChild(card);
  });
}

document.addEventListener("DOMContentLoaded", renderAreas);
