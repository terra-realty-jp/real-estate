/**
 * testimonials.js - お客様の声データ管理
 *
 * TESTIMONIALS_DATA 配列にお客様の声を追加してください。
 *
 * フィールド説明:
 *   stars  : 評価 (1〜5)
 *   text   : 口コミ文
 *   author : 投稿者 (イニシャルや "〇〇様" など, 個人特定されない表記)
 *   detail : 購入種別・エリア等の補足 例: "東京都 / マンション購入"
 */

const TESTIMONIALS_DATA = [
  /* ---- お客様の声をここに追加してください ----

  {
    stars: 5,
    text: "[お客様のご感想をここに入力]",
    author: "〇〇様",
    detail: "[エリア] / [サービス種別]"
  },

  ---------------------------------------- */
];

/* ============================================================
   以下は表示ロジックです。通常は変更不要です。
   ============================================================ */

function renderTestimonials() {
  const grid = document.getElementById("testimonialGrid");
  if (!grid) return;

  if (TESTIMONIALS_DATA.length === 0) {
    return; // index.html のプレースホルダーテキストをそのまま表示
  }

  grid.innerHTML = "";

  TESTIMONIALS_DATA.forEach(item => {
    const stars = "★".repeat(item.stars) + "☆".repeat(5 - item.stars);
    const card = document.createElement("div");
    card.className = "testimonial-card";
    card.innerHTML = `
      <div class="testimonial-stars">${stars}</div>
      <p class="testimonial-text">${item.text}</p>
      <div class="testimonial-author">
        <span class="author-name">${item.author}</span>
        <span class="author-detail">${item.detail}</span>
      </div>
    `;
    grid.appendChild(card);
  });
}

document.addEventListener("DOMContentLoaded", renderTestimonials);
