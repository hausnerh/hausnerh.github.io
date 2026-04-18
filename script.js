/* =================================================================
   script.js — fetch publications from InspireHEP and cycle them.

   Strategy:
     1. Query the public InspireHEP literature API by author record id.
     2. Normalise each record into a flat {title, authors, journal,
        year, arxiv, doi, inspireUrl, recid} object.
     3. Render one card at a time with a fade transition.
     4. Auto-advance every AUTO_INTERVAL_MS (10s).
        Pausable by button, hover, or focus. Reduced-motion users get
        no auto-advance and instant transitions (CSS handles the latter).

   InspireHEP author: Harry Hausner — recid 1896968
   API docs: https://inspirehep.net/info/hep/api
   ================================================================= */

(function () {
  "use strict";

  // ---- Configuration ----------------------------------------------------
  const AUTHOR_RECID = 1896968;
  const AUTO_INTERVAL_MS = 10_000;
  const MAX_RESULTS = 40;

  // Fields we actually need — keeps the response small and fast.
  const FIELDS = [
    "titles",
    "authors",
    "publication_info",
    "arxiv_eprints",
    "dois",
    "earliest_date",
    "imprints",
    "collaborations",
    "document_type",
    "references",
  ].join(",");

  const API = (
    "https://inspirehep.net/api/literature" +
    "?sort=mostrecent" +
    "&size=" + MAX_RESULTS +
    "&fields=" + FIELDS +
    "&q=" + encodeURIComponent("authors.recid:" + AUTHOR_RECID)
  );

  // ---- DOM handles ------------------------------------------------------
  const carousel = document.getElementById("pub-carousel");
  const dotsList = document.getElementById("pub-dots");
  const prevBtn  = document.getElementById("pub-prev");
  const nextBtn  = document.getElementById("pub-next");
  const toggleBtn = document.getElementById("pub-toggle");

  // ---- State ------------------------------------------------------------
  let papers = [];
  let cards  = [];
  let dots   = [];
  let index  = 0;
  let timerId = null;
  let userPaused = false;
  let hoverPaused = false;
  const prefersReducedMotion = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // =======================================================================
  //  Normalization
  // =======================================================================

  /**
   * Turn an InspireHEP metadata record into a flat paper object.
   * Inspire's shape is deeply nested; this quietly defends against missing
   * fields so one weird record doesn't blow up the carousel.
   */
  function normalize(rec) {
    const m = (rec && rec.metadata) || {};
    const title = (m.titles && m.titles[0] && m.titles[0].title) || "Untitled";

    // Authors or collaboration
    let authorLine = "";
    if (m.collaborations && m.collaborations.length) {
      authorLine = m.collaborations.map(c => c.value).join(", ") + " Collaboration";
    } else if (m.authors && m.authors.length) {
      const names = m.authors.slice(0, 3).map(a => a.full_name || "");
      authorLine = names.join("; ");
      if (m.authors.length > 3) authorLine += " et al.";
    }

    // Journal / publication info
    let journal = "";
    const pi = (m.publication_info && m.publication_info[0]) || null;
    if (pi) {
      const parts = [];
      if (pi.journal_title) parts.push(pi.journal_title);
      if (pi.journal_volume) parts.push(pi.journal_volume);
      if (pi.year) parts.push("(" + pi.year + ")");
      if (pi.journal_issue) parts.push(pi.journal_issue);
      if (pi.artid) parts.push(pi.artid);
      else if (pi.page_start) parts.push(pi.page_start);
      journal = parts.join(" ");
    }

    // Year fallback
    let year = (pi && pi.year) || null;
    if (!year && m.earliest_date) {
      year = parseInt(m.earliest_date.slice(0, 4), 10) || null;
    }
    if (!year && m.imprints && m.imprints[0] && m.imprints[0].date) {
      year = parseInt(m.imprints[0].date.slice(0, 4), 10) || null;
    }

    // arXiv / DOI
    const arxiv = (m.arxiv_eprints && m.arxiv_eprints[0] && m.arxiv_eprints[0].value) || null;
    const doi   = (m.dois && m.dois[0] && m.dois[0].value) || null;

    const recid = (rec && rec.id) || null;
    const inspireUrl = recid ? ("https://inspirehep.net/literature/" + recid) : null;

    // document type: article / proceedings / thesis / conference paper / ...
    let docType = null;
    if (m.document_type && m.document_type.length) {
      docType = m.document_type[0].replace(/_/g, " ");
    }

    const citations = (m.references && m.references.length) || null; // proxy

    return {
      title, authorLine, journal, year, arxiv, doi, recid, inspireUrl, docType, citations
    };
  }

  // =======================================================================
  //  Fetch
  // =======================================================================

  async function fetchPapers() {
    const res = await fetch(API, {
      headers: { "Accept": "application/json" },
    });
    if (!res.ok) {
      throw new Error("InspireHEP responded with HTTP " + res.status);
    }
    const data = await res.json();
    const hits = (data && data.hits && data.hits.hits) || [];
    return hits.map(normalize).filter(p => p.title && p.title !== "Untitled");
  }

  // =======================================================================
  //  Rendering
  // =======================================================================

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function cardHtml(p, i, total) {
    const idBits = [];
    if (p.arxiv) {
      idBits.push(
        '<a href="https://arxiv.org/abs/' + escapeHtml(p.arxiv) + '" rel="noopener">arXiv:' +
        escapeHtml(p.arxiv) + "</a>"
      );
    }
    if (p.doi) {
      idBits.push(
        '<a href="https://doi.org/' + escapeHtml(p.doi) + '" rel="noopener">doi:' +
        escapeHtml(p.doi) + "</a>"
      );
    }
    if (p.inspireUrl) {
      idBits.push(
        '<a href="' + escapeHtml(p.inspireUrl) + '" rel="noopener">InspireHEP</a>'
      );
    }

    const metaBits = [];
    metaBits.push('<span class="pub-index">' + (i + 1) + " / " + total + "</span>");
    if (p.year) metaBits.push('<span>' + escapeHtml(p.year) + '</span>');
    if (p.docType) metaBits.push('<span>' + escapeHtml(p.docType) + '</span>');

    const titleEl = p.inspireUrl
      ? '<a href="' + escapeHtml(p.inspireUrl) + '" rel="noopener">' + escapeHtml(p.title) + "</a>"
      : escapeHtml(p.title);

    return (
      '<div class="pub-meta">' + metaBits.join("") + "</div>" +
      '<h3 class="pub-title">' + titleEl + "</h3>" +
      (p.authorLine ? '<p class="pub-authors">' + escapeHtml(p.authorLine) + "</p>" : "") +
      (p.journal    ? '<p class="pub-journal">' + escapeHtml(p.journal)    + "</p>" : "") +
      (idBits.length ? '<p class="pub-ids">' + idBits.join("") + "</p>" : "")
    );
  }

  function renderCards() {
    carousel.innerHTML = "";
    dotsList.innerHTML = "";
    cards = [];
    dots  = [];

    papers.forEach((p, i) => {
      const card = document.createElement("article");
      card.className = "pub-card";
      card.setAttribute("aria-hidden", "true");
      card.setAttribute("aria-roledescription", "slide");
      card.setAttribute("aria-label", (i + 1) + " of " + papers.length);
      card.innerHTML = cardHtml(p, i, papers.length);
      carousel.appendChild(card);
      cards.push(card);

      const li = document.createElement("li");
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "pub-dot";
      dot.setAttribute("aria-label", "Show publication " + (i + 1));
      dot.addEventListener("click", () => { userPaused = true; reflectToggle(); show(i); });
      li.appendChild(dot);
      dotsList.appendChild(li);
      dots.push(dot);
    });

    if (cards.length) show(0);
  }

  function show(next) {
    if (!cards.length) return;
    const wrapped = ((next % cards.length) + cards.length) % cards.length;
    cards.forEach((c, i) => {
      const active = i === wrapped;
      c.classList.toggle("is-active", active);
      c.setAttribute("aria-hidden", active ? "false" : "true");
    });
    dots.forEach((d, i) => d.classList.toggle("is-active", i === wrapped));
    index = wrapped;
  }

  function next() { show(index + 1); }
  function prev() { show(index - 1); }

  // =======================================================================
  //  Auto-cycle
  // =======================================================================

  function shouldRun() {
    return !userPaused && !hoverPaused && !prefersReducedMotion && papers.length > 1;
  }

  function startTimer() {
    stopTimer();
    if (!shouldRun()) return;
    timerId = window.setInterval(next, AUTO_INTERVAL_MS);
  }
  function stopTimer() {
    if (timerId !== null) { window.clearInterval(timerId); timerId = null; }
  }
  function restartTimer() { stopTimer(); startTimer(); }

  function reflectToggle() {
    toggleBtn.setAttribute("aria-pressed", userPaused ? "true" : "false");
    toggleBtn.setAttribute(
      "aria-label",
      userPaused ? "Resume auto-cycle" : "Pause auto-cycle"
    );
    toggleBtn.textContent = userPaused ? "Play" : "Pause";
    if (userPaused) stopTimer(); else startTimer();
  }

  // =======================================================================
  //  Wiring
  // =======================================================================

  prevBtn.addEventListener("click", () => {
    userPaused = true; reflectToggle();
    prev();
  });
  nextBtn.addEventListener("click", () => {
    userPaused = true; reflectToggle();
    next();
  });
  toggleBtn.addEventListener("click", () => {
    userPaused = !userPaused;
    reflectToggle();
  });

  // Pause when the reader hovers or focuses the carousel — lets them read
  // without it cycling out from under them.
  ["mouseenter", "focusin"].forEach(evt =>
    carousel.addEventListener(evt, () => { hoverPaused = true; stopTimer(); })
  );
  ["mouseleave", "focusout"].forEach(evt =>
    carousel.addEventListener(evt, () => { hoverPaused = false; if (!userPaused) startTimer(); })
  );

  // Pause when tab is backgrounded.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopTimer();
    else if (!userPaused && !hoverPaused) startTimer();
  });

  // Keyboard: left/right arrows when carousel is focused
  carousel.tabIndex = 0;
  carousel.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); userPaused = true; reflectToggle(); next(); }
    if (e.key === "ArrowLeft")  { e.preventDefault(); userPaused = true; reflectToggle(); prev(); }
  });

  // =======================================================================
  //  Bootstrap
  // =======================================================================

  function renderError(msg) {
    carousel.innerHTML =
      '<div class="pub-card is-loading is-active" aria-busy="false">' +
      '<p class="pub-error">' + escapeHtml(msg) + " " +
      'You can browse them directly on ' +
      '<a href="https://inspirehep.net/authors/1896968" rel="noopener">InspireHEP</a>.' +
      "</p></div>";
  }

  fetchPapers()
    .then(list => {
      if (!list.length) {
        renderError("No publications found.");
        return;
      }
      papers = list;
      renderCards();
      reflectToggle();  // syncs play/pause label + starts timer
    })
    .catch(err => {
      // eslint-disable-next-line no-console
      console.error("[publications] fetch failed:", err);
      renderError("Couldn't load publications from InspireHEP right now.");
    });
})();
