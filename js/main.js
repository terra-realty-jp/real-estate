/**
 * main.js - メインJavaScript
 * ヘッダー制御 / ハンバーガーメニュー / ページトップ / フォームバリデーション / カウントアップ
 */

document.addEventListener("DOMContentLoaded", () => {

  /* --------------------------------------------------
     著作権表示の年を自動更新
  -------------------------------------------------- */
  const yearEl = document.getElementById("currentYear");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* --------------------------------------------------
     ヘッダー: スクロール時にシャドウ付与
  -------------------------------------------------- */
  const header = document.getElementById("header");
  function onScroll() {
    if (!header) return;
    header.classList.toggle("scrolled", window.scrollY > 20);
    pageTopBtn.classList.toggle("visible", window.scrollY > 400);
  }
  window.addEventListener("scroll", onScroll, { passive: true });

  /* --------------------------------------------------
     ハンバーガーメニュー
  -------------------------------------------------- */
  const hamburger = document.getElementById("hamburger");
  const navMobile = document.getElementById("navMobile");

  if (hamburger && navMobile) {
    hamburger.addEventListener("click", () => {
      const isOpen = navMobile.classList.toggle("open");
      hamburger.classList.toggle("open", isOpen);
      hamburger.setAttribute("aria-expanded", isOpen);
      document.body.style.overflow = isOpen ? "hidden" : "";
    });

    // モバイルメニュー内リンクをクリックで閉じる
    navMobile.querySelectorAll("a").forEach(link => {
      link.addEventListener("click", () => {
        navMobile.classList.remove("open");
        hamburger.classList.remove("open");
        hamburger.setAttribute("aria-expanded", "false");
        document.body.style.overflow = "";
      });
    });
  }

  /* --------------------------------------------------
     ページトップボタン
  -------------------------------------------------- */
  const pageTopBtn = document.getElementById("pageTop");
  if (pageTopBtn) {
    pageTopBtn.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  /* --------------------------------------------------
     検索タブ (購入 / 賃貸)
  -------------------------------------------------- */
  document.querySelectorAll(".search-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".search-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      // 賃貸タブ選択時の価格帯ラベルを変更する場合はここに処理を追加
    });
  });

  /* --------------------------------------------------
     実績カウントアップ アニメーション
     data-target 属性に目標値を設定してください
  -------------------------------------------------- */
  const statsNums = document.querySelectorAll(".stats-num[data-target]");

  function countUp(el) {
    const target = parseInt(el.dataset.target, 10);
    if (!target || target === 0) return;
    const duration = 1800;
    const start = performance.now();
    function update(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      el.textContent = Math.round(eased * target).toLocaleString("ja-JP");
      if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  }

  // IntersectionObserver で画面に入ったときに発火
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          countUp(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });

    statsNums.forEach(el => observer.observe(el));
  } else {
    statsNums.forEach(el => countUp(el));
  }

  /* --------------------------------------------------
     お問い合わせフォーム バリデーション
     ※ 実際の送信処理は別途バックエンド実装が必要です
  -------------------------------------------------- */
  const form = document.getElementById("contactForm");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      let valid = true;

      // バリデーションルール
      const rules = [
        { id: "name",    errorId: "nameError",    msg: "お名前を入力してください" },
        { id: "email",   errorId: "emailError",   msg: "メールアドレスを入力してください", type: "email" },
        { id: "subject", errorId: "subjectError", msg: "お問い合わせ種別を選択してください" },
        { id: "message", errorId: "messageError", msg: "ご相談内容を入力してください" },
      ];

      rules.forEach(rule => {
        const input = document.getElementById(rule.id);
        const errEl = document.getElementById(rule.errorId);
        if (!input || !errEl) return;

        let msg = "";
        if (!input.value.trim()) {
          msg = rule.msg;
        } else if (rule.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value)) {
          msg = "正しいメールアドレスを入力してください";
        }

        errEl.textContent = msg;
        input.classList.toggle("error", !!msg);
        if (msg) valid = false;
      });

      // 同意チェックボックス
      const agree = document.getElementById("agree");
      const agreeErr = document.getElementById("agreeError");
      if (agree && agreeErr) {
        if (!agree.checked) {
          agreeErr.textContent = "プライバシーポリシーへの同意が必要です";
          valid = false;
        } else {
          agreeErr.textContent = "";
        }
      }

      if (!valid) return;

      /* --- ここから送信処理 ---
         実際の送信は fetch() や FormData を使ってサーバーに送信してください。
         例:
           const data = new FormData(form);
           fetch("/api/contact", { method: "POST", body: data })
             .then(res => res.json())
             .then(json => { ... 成功処理 ... })
             .catch(err => { ... エラー処理 ... });
      ----------------------------------------- */

      // デモ用: 送信完了メッセージを表示
      const notice = document.getElementById("formNotice");
      if (notice) {
        notice.textContent = "お問い合わせを受け付けました。担当者よりご連絡いたします。";
        notice.className = "form-notice success";
      }
      form.reset();
    });

    // リアルタイムエラークリア
    form.querySelectorAll("input, select, textarea").forEach(input => {
      input.addEventListener("input", () => {
        const errEl = document.getElementById(input.id + "Error");
        if (errEl) errEl.textContent = "";
        input.classList.remove("error");
      });
    });
  }

  /* --------------------------------------------------
     スムーススクロール (href="#xxx" 形式のリンク)
  -------------------------------------------------- */
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener("click", (e) => {
      const target = document.querySelector(anchor.getAttribute("href"));
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth" });
    });
  });

});
