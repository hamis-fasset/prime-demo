/* ————————————————————————————————————————————————
   Fasset Prime — shared UI renderers.
   Plain script (file:// safe) — exposes window.UI.
   Every screen renders through these; no screen invents
   its own money format, drawer, toast or table grammar.
   Contract: ../ARCHITECTURE.md
   ———————————————————————————————————————————————— */
(function () {
  "use strict";

  var UI = {};
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // ————— text & format helpers —————

  UI.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  };

  UI.fmtNum = function (n, dp) {
    if (dp === undefined) dp = 2;
    return Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  };

  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  UI.fmtTs = function (iso) {
    if (!iso) return "";
    var d = new Date(iso);
    var today = new Date();
    var sameDay = d.toDateString() === today.toDateString();
    var yd = new Date(Date.now() - 86400000);
    var time = pad(d.getHours()) + ":" + pad(d.getMinutes());
    if (sameDay) return "Today, " + time;
    if (d.toDateString() === yd.toDateString()) return "Yesterday, " + time;
    return d.getDate() + " " + MONTHS[d.getMonth()] + ", " + time;
  };

  UI.fmtDate = function (iso) {
    if (!iso) return "";
    var d = new Date(iso);
    return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
  };

  // Day bucket for table group labels — the same words the rest of the app
  // uses ("Today" · "Yesterday" · "29 Aug 2026"). One label per calendar day,
  // so a time-ordered table can group on a label change.
  UI.dayLabel = function (iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (d.toDateString() === new Date().toDateString()) return "Today";
    if (d.toDateString() === new Date(Date.now() - 86400000).toDateString()) return "Yesterday";
    return UI.fmtDate(iso);
  };

  UI.fmtTime = function (iso) {
    var d = iso ? new Date(iso) : new Date();
    return pad(d.getHours()) + ":" + pad(d.getMinutes());
  };

  // ————— money — art-directed, never a flat string —————
  // Fiat (AED/USD/EUR/BHD): full-strength code before the digits (the "symbol",
  //   identical to the digits so live updates never shift), dimmed cents.
  // USDT: digits first, dimmed suffix code (never ₮).
  // opts: { sign: "+"|"−"|"", dp: decimals (default 2) }

  var SUFFIX = { USDT: true };

  UI.money = function (cur, n, opts) {
    opts = opts || {};
    var dp = opts.dp === undefined ? 2 : opts.dp;
    var s = UI.fmtNum(Math.abs(Number(n || 0)), dp);
    var parts = s.split(".");
    var sign = opts.sign ? UI.esc(opts.sign) : "";
    var intH = '<span class="money-int">' + sign + parts[0] + "</span>";
    var decH = parts[1] ? '<span class="money-dec">.' + parts[1] + "</span>" : "";
    if (SUFFIX[cur]) {
      return '<span class="money">' + intH + decH + '<span class="money-ccy">' + UI.esc(cur) + "</span></span>";
    }
    return '<span class="money"><span class="money-sym">' + UI.esc(cur) + "</span>" + intH + decH + "</span>";
  };

  // ————— per-digit assembly — one implementation, two entry points —————
  // The signature of the motion lives in .dg (app.css): translateY(0.35em) → 0
  // over 240ms var(--ease). Here we only own the timing.
  //   stagger  ms between glyphs, default 22
  //   start    glyph index to count from, so a hero's decimals keep assembling
  //            on from its integer digits instead of restarting
  //   base     ms added to every glyph, so a group of figures can be sequenced
  //            after another one without the caller rewriting inline delays
  function assemble(str, stagger, start, base) {
    var st = (stagger === undefined || stagger === null) ? 22 : Number(stagger);
    var b = Number(base) || 0;
    var i = start || 0;
    return String(str).split("").map(function (ch) {
      return '<span class="dg" style="animation-delay:' + (b + (i++ * st)) + 'ms">' + UI.esc(ch) + "</span>";
    }).join("");
  }

  // Hero variant: per-digit assembly (translateY 0.35em → 0, 240ms, 22ms
  // stagger). Wrap in an element with class .bal-value for the 42px set.
  // opts: { dp, stagger, delay }
  //   stagger  default 22ms
  //   delay    ms before the first glyph. This is how you sequence a set of
  //            figures (the four per-currency balances landing after the hero)
  //            without hand-editing the inline delays this emits.
  // ALL MONEY GOES THROUGH HERE, never through UI.digits: only this function
  // emits .money-sym / .money-dec / .money-ccy, which is the protected money
  // typography (solid full-size code, dimmed cents, USDT's dimmed suffix).
  UI.moneyHero = function (cur, n, opts) {
    opts = opts || {};
    var dp = opts.dp === undefined ? 2 : opts.dp;
    var st = opts.stagger === undefined ? 22 : opts.stagger;
    var delay = Number(opts.delay) || 0;
    // { symbol: true } renders the proper currency symbol where a latin one
    // exists ($, €); the rest keep their code. Hero/tile use only.
    var label = opts.symbol && window.Data && Data.curSymbol ? Data.curSymbol(cur) : cur;
    var s = UI.fmtNum(Math.abs(Number(n || 0)), dp);
    var parts = s.split(".");
    var intH = '<span class="money-int">' + assemble(parts[0], st, 0, delay) + "</span>";
    var decH = parts[1] ? '<span class="money-dec">' + assemble("." + parts[1], st, parts[0].length, delay) + "</span>" : "";
    if (SUFFIX[cur]) {
      return '<span class="money">' + intH + decH + '<span class="money-ccy">' + UI.esc(label) + "</span></span>";
    }
    return '<span class="money"><span class="money-sym">' + UI.esc(label) + "</span>" + intH + decH + "</span>";
  };

  // UI.digits(el, text, opts) — per-digit assembly for a NON-MONEY figure: a
  // rate, a percentage, a count, a limit. Same curve and the same .dg class as
  // UI.moneyHero, because they share the implementation above.
  //   el    an element (its content is replaced) or null (the html is returned)
  //   opts  { stagger } default 22ms, { delay } default 0. Trade's 34px rate
  //         uses stagger 18: fewer, larger glyphs want a tighter cascade.
  // Never route money through this. It takes a plain string, so it would drop
  // .money-sym and .money-dec and lose the money typography: use UI.moneyHero.
  // Do not pair either with a count-up. A count-up on a static figure is
  // theatre; it belongs only to the chart's paired hero.
  UI.digits = function (el, text, opts) {
    // tolerated shorthand: UI.digits("3.6812", { stagger: 18 }) with no element
    if (typeof el === "string" || typeof el === "number") { opts = text; text = el; el = null; }
    opts = opts || {};
    var html = assemble(text, opts.stagger, 0, opts.delay);
    if (el && el.nodeType === 1) { el.innerHTML = html; return el; }
    return html;
  };

  // ————— currency & category identity —————
  // A solid swatch, neutral text. The hue is fixed per currency and means
  // nothing except "which rail". Never used for status: a 6px round dot is the
  // status vocabulary, a 9px squarish swatch is identity, and the two must
  // never be confusable.
  //   cur   "AED" | "USD" | "EUR" | "BHD" | "USDT", or a network ("TRON" | "Ethereum" |
  //         "Bitcoin") on the one table with no currency column, or "p1".."p4"
  //         for the connection map's pillars.
  //   opts  { chip: true } adds the 8% tint. Objects and hosted surfaces only,
  //         never a table row. { label: false } renders the swatch alone.
  UI.ccy = function (cur, opts) {
    opts = opts || {};
    var key = String(cur == null ? "" : cur).toLowerCase();
    return '<span class="cat cat-' + UI.esc(key) + (opts.chip ? " cat-chip" : "") +
      '"><i></i>' + (opts.label === false ? "" : UI.esc(cur)) + "</span>";
  };

  // ————— status — dot + neutral sentence-case text —————
  // kind ∈ positive | warning | error | info | neutral (fixed vocabulary:
  // positive=confirmed · warning=waiting on a human · error=failed/held ·
  // info=in process · neutral=inert). Never re-purpose.
  UI.statusDot = function (kind, label) {
    return '<span class="status status-' + UI.esc(kind) + '"><span class="dot"></span>' + UI.esc(label) + "</span>";
  };

  // ————— table — the no-lines grammar —————
  // Three devices do the separating work, and a table needs all three:
  // 56px rows · date group labels · alignment. Alignment means clustered,
  // not spread: the identity column is capped (minmax(0, 400px)) so a wide
  // panel never leaves a hole mid-row, one spacer track absorbs the surplus,
  // and the columns an operator compares (status, date, amount) sit adjacent
  // at the right edge. The header carries the one hairline the law permits.
  //
  // UI.table({ cols, rows, empty })
  //   cols: [{ label, w, right, spacer }]
  //     w       grid track: "minmax(0, 300px)" for identity columns,
  //             plain px for the right-hand cluster (content width, so the
  //             cluster stays tight and never redistributes).
  //     spacer  true = a structural gap track. No header label, no cell:
  //             callers pass cells for the data columns only and the blanks
  //             are spliced in here. Default track "minmax(24px, 1fr)", so
  //             it takes all the surplus and the row reads as two groups.
  //   rows: [{ cells: [html…], key, cls, selected, clickable }]
  //         or { group: "Today" } — a date group label. Time-ordered tables
  //         group by day, newest first, via UI.dayLabel.
  //   empty: one quiet sentence (headers still render)
  // Returns html. Rows carry data-key for delegation by the caller.
  var SPACER_TRACK = "minmax(24px, 1fr)";

  UI.table = function (spec) {
    var cols = spec.cols;
    var grid = cols.map(function (c) { return c.w || (c.spacer ? SPACER_TRACK : "1fr"); }).join(" ");
    var dataCols = cols.filter(function (c) { return !c.spacer; }).length;
    var hasSpacer = dataCols !== cols.length;

    // the table's real floor: fixed tracks at face value, 24px per spacer,
    // 140px for a flexible identity column. Below this the grid would crush
    // the identity track to 0 and columns would overprint, so header and rows
    // carry it as min-width and .table's overflow-x scrolls instead (the
    // 600px layer's flat 620px floor under-measured wide tables).
    var minW = 0;
    cols.forEach(function (c) {
      var m = /^(\d+(?:\.\d+)?)px$/.exec(c.w || "");
      minW += c.spacer ? 24 : m ? parseFloat(m[1]) : 140;
    });

    // A row that carries one cell per data column gets its blank spacer cells
    // spliced in; anything else (a full-width detail row spanning 1 / -1) is
    // passed through untouched.
    function cellsFor(cells) {
      if (!hasSpacer || cells.length !== dataCols) return cells;
      var i = 0;
      return cols.map(function (c) { return c.spacer ? "<span></span>" : cells[i++]; });
    }

    var h = '<div class="table">';
    h += '<div class="table-header" style="grid-template-columns:' + grid + ';min-width:' + minW + 'px">' +
      cols.map(function (c) {
        if (c.spacer) return "<span></span>";
        return '<span class="' + (c.right ? "h-right" : "") + '">' + UI.esc(c.label || "") + "</span>";
      }).join("") + "</div>";
    if (!spec.rows || !spec.rows.length) {
      h += '<div class="empty">' + UI.esc(spec.empty || "Nothing here yet.") + "</div></div>";
      return h;
    }
    h += spec.rows.map(function (r) {
      if (r.group) return '<div class="group-label">' + UI.esc(r.group) + "</div>";
      var cls = "row" + (r.cls ? " " + r.cls : "") + (r.selected ? " selected" : "") + (r.clickable ? " clickable" : "");
      var tag = r.clickable ? "button" : "div";
      return "<" + tag + ' class="' + cls + '" style="grid-template-columns:' + grid + ';min-width:' + minW + 'px"' +
        (r.key ? ' data-key="' + UI.esc(r.key) + '"' : "") + (r.clickable ? ' type="button"' : "") + ">" +
        cellsFor(r.cells).join("") + "</" + tag + ">";
    }).join("");
    return h + "</div>";
  };

  // ————— lifecycle timeline —————
  // items: [{ label, sub, time, state }]
  // state ∈ done (accent) | active (info — in process, the stage the money is
  //   in right now) | pending (warning — waiting on a human) | failed
  //   (negative) | todo (inert). Same fixed hue vocabulary as UI.statusDot:
  //   an in-flight lifecycle stage is "active", never "pending".
  UI.timeline = function (items) {
    return '<div class="timeline">' + items.map(function (it) {
      return '<div class="timeline-item ' + (it.state || "todo") + '"><span class="timeline-dot"></span>' +
        '<div style="flex:1;min-width:0"><div class="spread"><span class="timeline-label">' + UI.esc(it.label) + "</span>" +
        (it.time ? '<span class="timeline-time">' + UI.esc(it.time) + "</span>" : "") + "</div>" +
        (it.sub ? '<div class="timeline-sub">' + UI.esc(it.sub) + "</div>" : "") +
        "</div></div>";
    }).join("") + "</div>";
  };

  // ————— copy row — data ids in mono, quiet copy affordance —————
  UI.copyRow = function (label, value, opts) {
    opts = opts || {};
    return '<div class="copy-row"><span class="cr-label">' + UI.esc(label) + "</span>" +
      '<span class="cr-value' + (opts.mono ? " mono" : "") + '">' + UI.esc(value) + "</span>" +
      '<button class="link" type="button" data-copy="' + UI.esc(opts.copy || value) + '">Copy</button></div>';
  };

  // delegated: any [data-copy] anywhere copies + toasts
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-copy]");
    if (!b) return;
    try { navigator.clipboard.writeText(b.getAttribute("data-copy")); } catch (err) { /* prototype */ }
    UI.toast("Copied.");
  });

  // ————— skeleton — the waiting vocabulary (never a spinner) —————
  UI.skel = function (w, h, cls) {
    return '<span class="skeleton ' + (cls || "") + '" style="display:inline-block;width:' + (w || "80px") + ";height:" + (h || "14px") + '"></span>';
  };

  // ————— entrance choreography for containers rendered after load —————
  UI.stagger = function (el) {
    Array.prototype.forEach.call(el.children, function (child, i) {
      child.classList.add("rise");
      child.style.animationDelay = (i * 40) + "ms";
    });
  };

  // ————— toast — a pill, bottom-center, one sentence —————
  var toastEl = null, toastTimer = null;
  // kind: "done" (default, a confirmation) | "blocked" (a refusal: nothing
  // happened) | "info" (a statement of fact). A refusal must never wear the
  // confirmation tick, so the glyph is chosen by kind rather than fixed.
  // "note" is an accepted alias for "info": screens reach for both words for
  // the same thing, and a typo must never silently become a confirmation.
  var TOAST_ICON = { done: "check", blocked: "alert", info: "activity", note: "activity" };
  UI.toast = function (msg, kind) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.appendChild(document.createElement("span"));
      document.body.appendChild(toastEl);
    }
    kind = TOAST_ICON[kind] ? kind : "done";
    toastEl.className = "toast toast-" + kind;
    toastEl.innerHTML = (window.icon ? window.icon(TOAST_ICON[kind], 14) : "") + '<span>' + UI.esc(msg) + "</span>";
    // restart the entrance if a toast is already showing
    toastEl.classList.remove("show");
    void toastEl.offsetWidth;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 3200);
  };

  // ————— drawer — the only overlay. No modals anywhere. —————
  // UI.drawer(title, contentHtml, opts) → handle
  //   opts: { width (px, 420–560), foot (html), onClose(fn), subtitle }
  //   handle: { el, body, foot, close(), setFoot(html) }
  // Esc closes the topmost drawer; the scrim click closes too.
  var drawerStack = [];

  UI.drawer = function (title, contentHtml, opts) {
    opts = opts || {};
    var wrap = document.createElement("div");
    wrap.className = "panel-wrap";
    var width = Math.max(420, Math.min(560, opts.width || 480));
    wrap.innerHTML =
      '<div class="panel-scrim"></div>' +
      '<div class="panel" style="width:' + width + 'px" role="dialog" aria-label="' + UI.esc(title) + '">' +
      '<div class="panel-head"><h2>' + UI.esc(title) +
      (opts.subtitle ? ' <span class="faint" style="font-weight:var(--w-body)">· ' + UI.esc(opts.subtitle) + "</span>" : "") +
      '</h2><button class="panel-close" type="button" aria-label="Close">' + window.icon("close", 14) + "</button></div>" +
      '<div class="panel-body">' + contentHtml + "</div>" +
      (opts.foot ? '<div class="panel-foot">' + opts.foot + "</div>" : "") +
      "</div>";
    document.body.appendChild(wrap);
    requestAnimationFrame(function () { wrap.classList.add("open"); });

    var handle = {
      el: wrap,
      body: wrap.querySelector(".panel-body"),
      foot: wrap.querySelector(".panel-foot"),
      closed: false,
      close: function () {
        if (handle.closed) return;
        handle.closed = true;
        wrap.classList.remove("open");
        var i = drawerStack.indexOf(handle);
        if (i >= 0) drawerStack.splice(i, 1);
        // exit timer matched to the exit transition (~half the entrance)
        setTimeout(function () { wrap.remove(); }, 150);
        if (opts.onClose) opts.onClose();
      },
      setFoot: function (html) {
        if (!handle.foot) {
          handle.foot = document.createElement("div");
          handle.foot.className = "panel-foot";
          wrap.querySelector(".panel").appendChild(handle.foot);
        }
        handle.foot.innerHTML = html;
      }
    };
    wrap.querySelector(".panel-close").addEventListener("click", handle.close);
    wrap.querySelector(".panel-scrim").addEventListener("click", handle.close);
    drawerStack.push(handle);
    return handle;
  };

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && drawerStack.length) drawerStack[drawerStack.length - 1].close();
  });

  // ————— step-up MFA — a drawer, weighted by stakes —————
  // UI.stepUp(why, cb) — cb runs only after a correct code.
  // Demo authenticator code: 123456. Seeded recovery codes also work.
  var RECOVERY = ["9F3K-22LQ", "7TDM-90XE", "KQ2P-44RA", "M8VZ-13SN", "2WCH-76JL", "X5RB-08PT", "4NGF-59KD", "DY7U-31QW"];
  UI.recoveryCodes = RECOVERY.slice();

  UI.stepUp = function (why, cb) {
    var h = UI.drawer("Confirm with your authenticator",
      '<p class="muted" style="font-size:13px;line-height:1.55">' + UI.esc(why) + "</p>" +
      '<div class="field mt-16"><label for="suCode">6-digit code</label>' +
      '<input id="suCode" class="input input-code" inputmode="numeric" maxlength="6" placeholder="······" autocomplete="off">' +
      '<div class="hint err hide" id="suErr">That code isn’t right. Check the app and try again.</div>' +
      '<div class="hint">Demo authenticator code: 123456 · or <button class="link" id="suRecLink" type="button">use a recovery code</button></div></div>' +
      '<div class="field hide" id="suRecWrap"><label for="suRec">Recovery code</label>' +
      '<input id="suRec" class="input mono" placeholder="XXXX-XXXX" autocomplete="off">' +
      '<div class="hint">One of the single-use codes you saved at enrollment.</div></div>',
      {
        width: 440,
        foot: '<button class="btn btn-secondary" id="suCancel" type="button">Cancel</button>' +
              '<button class="btn btn-primary" id="suConfirm" type="button">Confirm</button>'
      });
    var code = h.el.querySelector("#suCode");
    code.focus();
    h.el.querySelector("#suRecLink").addEventListener("click", function () {
      h.el.querySelector("#suRecWrap").classList.remove("hide");
      h.el.querySelector("#suRec").focus();
    });
    code.addEventListener("input", function () { h.el.querySelector("#suErr").classList.add("hide"); });
    function confirm() {
      var rec = (h.el.querySelector("#suRec").value || "").trim().toUpperCase();
      var ok = code.value === "123456" || RECOVERY.indexOf(rec) >= 0;
      if (!ok) { h.el.querySelector("#suErr").classList.remove("hide"); return; }
      h.close();
      if (cb) cb();
    }
    h.el.querySelector("#suConfirm").addEventListener("click", confirm);
    code.addEventListener("keydown", function (e) { if (e.key === "Enter") confirm(); });
    h.el.querySelector("#suCancel").addEventListener("click", h.close);
    return h;
  };

  // ————— motion helpers shared by the primitives below —————

  function reduceMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  // opacity-only fade in, kept alive under reduced motion (movement is what the
  // law strips, not opacity — so under reduce we re-assert the duration with
  // !important, because tokens.css flattens every duration to 0.01ms there).
  function fadeIn(el, dur, delay, ease) {
    var reduce = reduceMotion();
    el.style.opacity = "0";
    var t = "opacity " + dur + "ms " + ease + " " + delay + "ms";
    if (reduce) el.style.setProperty("transition", t, "important");
    else el.style.transition = t;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { el.style.opacity = "1"; });
    });
    setTimeout(function () {
      el.style.removeProperty("transition");
      el.style.removeProperty("opacity");
    }, dur + delay + 80);
  }

  // ————— the balance chart — hand-built inline SVG, no library —————
  // UI.chart(host, series, opts) → handle
  //   host    an element with class .chart-host, already in the DOM
  //   series  [{ ts, v }] oldest first (Data.balSeries()). Only `v` is read
  //           here; the whole point object goes to onScrub, so the caller
  //           formats `ts` with UI.dayLabel / UI.fmtDate.
  //   opts:
  //     animate    run the draw-in. Gate it on a once-per-app-load flag: the
  //                draw-in is a first-impression, never a data-mutation replay.
  //     height     default 132
  //     label      aria-label for the figure (the chart is decorative on its
  //                own; the hero and the caption carry the numbers)
  //     onDraw     fn(durMs) on the frame the line starts drawing. Start a
  //                paired count-up here and run it for exactly durMs: that is
  //                how the number and the line land on the same frame without
  //                either side hardcoding 850.
  //     onDrawn    fn() when the line lands. Always fires, once, even when
  //                animate is false or reduced motion is on.
  //     onScrub    fn(point, index) as the pointer moves, so the caller can
  //                rewrite its hero and caption to that day
  //     onRelease  fn() on release, so the caller can return the hero to today
  //     returnEl   optional; gets .scrub-return (240ms var(--ease-out-soft)) on
  //                release, which is the "returns to today" settle
  //   handle: { el, drawMs, redraw(series), destroy() }
  // UI.chart.DRAW_MS is the same figure as a constant, for callers that need it
  // before they have a handle.
  //
  // No axes, no gridlines, no legend, no tooltip box. One 1.5px accent stroke,
  // a 2% accent area beneath it, a static dot on the last point. The stroke is
  // the host screen's one saturated moment, so nothing else there may be a fill.
  var DRAW_MS = 850;   // the reference's own figure for the line draw-in

  UI.chart = function (host, series, opts) {
    if (!host) return null;
    opts = opts || {};
    var pts = (series || []).filter(function (p) { return p && isFinite(Number(p.v)); });
    if (pts.length < 2) {
      // honest empty state: one quiet sentence, no illustration, no axes drawn
      // around nothing.
      host.innerHTML = '<div class="freshline">Not enough history to draw yet.</div>';
      return null;
    }

    var NS = "http://www.w3.org/2000/svg";
    var H = opts.height || 132;
    var PAD_T = 12, PAD_B = 10, PAD_L = 2, PAD_R = 6;   // room for the end dot
    var reduce = reduceMotion();
    // .chart-host owns height 132px in app.css so the host can never collapse
    // to zero before this runs. A caller asking for a different height gets it
    // pinned inline, so the two never disagree.
    if (H !== 132) host.style.height = H + "px";

    function node(name, cls, attrs) {
      var n = document.createElementNS(NS, name);
      if (cls) n.setAttribute("class", cls);
      Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      return n;
    }

    host.innerHTML = "";
    var svg = node("svg", null, { height: H, width: "100%", role: "img" });
    svg.setAttribute("aria-label", opts.label || ("Balance history, last " + pts.length + " days"));
    var area = node("path", "ac-area");
    var line = node("path", "ac-line");
    var end = node("g", null);
    var eGlow = node("circle", "ac-dot-glow", { r: 7 });
    var eDot = node("circle", "ac-dot", { r: 3.5 });
    end.appendChild(eGlow); end.appendChild(eDot);
    var hover = node("g", "ac-hover", { opacity: 0 });
    var cross = node("line", "ac-crosshair");
    var hGlow = node("circle", "ac-dot-glow", { r: 7 });
    var hDot = node("circle", "ac-dot", { r: 3.5 });
    hover.appendChild(cross); hover.appendChild(hGlow); hover.appendChild(hDot);
    var hit = node("rect", "ac-hit");
    svg.appendChild(area); svg.appendChild(line); svg.appendChild(end);
    svg.appendChild(hover); svg.appendChild(hit);
    host.appendChild(svg);

    var geo = { w: 0, step: 1, x: [], y: [] };

    function measure() {
      var w = host.clientWidth || svg.getBoundingClientRect().width || 640;
      var min = Infinity, max = -Infinity;
      pts.forEach(function (p) {
        var v = Number(p.v);
        if (v < min) min = v;
        if (v > max) max = v;
      });
      var range = max - min;
      if (!range) { min -= 1; max += 1; range = 2; }
      // 12% headroom top and bottom so the line never touches an edge
      min -= range * 0.12; max += range * 0.12; range = max - min;
      var innerW = Math.max(1, w - PAD_L - PAD_R);
      var innerH = Math.max(1, H - PAD_T - PAD_B);
      geo.w = w;
      geo.step = innerW / (pts.length - 1);
      geo.x = pts.map(function (p, i) { return PAD_L + i * geo.step; });
      geo.y = pts.map(function (p) { return PAD_T + (1 - (Number(p.v) - min) / range) * innerH; });
    }

    function draw() {
      measure();
      var last = pts.length - 1;
      var d = pts.map(function (p, i) {
        return (i ? "L" : "M") + geo.x[i].toFixed(2) + " " + geo.y[i].toFixed(2);
      }).join(" ");
      // straight segments, not a smoothed curve: these are end-of-day closes,
      // and the day a withdrawal confirmed must read as a step, not a swoop.
      line.setAttribute("d", d);
      area.setAttribute("d", d + " L" + geo.x[last].toFixed(2) + " " + H +
        " L" + geo.x[0].toFixed(2) + " " + H + " Z");
      eGlow.setAttribute("cx", geo.x[last]); eGlow.setAttribute("cy", geo.y[last]);
      eDot.setAttribute("cx", geo.x[last]); eDot.setAttribute("cy", geo.y[last]);
      cross.setAttribute("y1", 0); cross.setAttribute("y2", H);
      hit.setAttribute("x", 0); hit.setAttribute("y", 0);
      hit.setAttribute("width", geo.w); hit.setAttribute("height", H);
    }

    draw();

    var drawn = false;
    function signalDrawn() {
      if (drawn) return;
      drawn = true;
      if (opts.onDrawn) opts.onDrawn();
    }

    if (opts.animate && !reduce) {
      // area 600ms at 120ms, dot 200ms at 860ms so it lands as the line
      // finishes. Both are opacity, so both survive reduced motion.
      fadeIn(area, 600, 120, "var(--ease-out-soft)");
      fadeIn(end, 200, 860, "var(--ease-snappy)");
      var len = 0;
      try { len = line.getTotalLength(); } catch (e) { len = geo.w; }
      line.style.strokeDasharray = len + " " + len;
      line.style.strokeDashoffset = len;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          line.style.transition = "stroke-dashoffset " + DRAW_MS + "ms var(--ease-out-expo)";
          line.style.strokeDashoffset = "0";
          // the caller starts its paired count-up on this frame and runs it for
          // exactly this long, so the number and the line land together
          if (opts.onDraw) opts.onDraw(DRAW_MS);
          setTimeout(function () {
            line.style.removeProperty("transition");
            line.style.removeProperty("stroke-dasharray");
            line.style.removeProperty("stroke-dashoffset");
            signalDrawn();
          }, DRAW_MS);
        });
      });
    } else if (opts.animate) {
      // reduced motion: opacity is kept, movement is not. The line is simply
      // already there, at its final state, and the pairing signals still fire
      // so the caller's figure lands set rather than never landing at all.
      fadeIn(area, 600, 120, "var(--ease-out-soft)");
      fadeIn(end, 200, 860, "var(--ease-snappy)");
      requestAnimationFrame(function () {
        if (opts.onDraw) opts.onDraw(0);
        signalDrawn();
      });
    } else {
      // a data mutation is not a first impression: no draw-in, but onDrawn
      // still fires so a caller can rely on it unconditionally
      requestAnimationFrame(signalDrawn);
    }

    // ————— scrub: pointer and touch, anywhere over the host —————
    var scrubbing = false, curIdx = -1;

    function idxAt(clientX) {
      var r = svg.getBoundingClientRect();
      var i = Math.round((clientX - r.left - PAD_L) / geo.step);
      return Math.max(0, Math.min(pts.length - 1, i));
    }

    function showAt(i) {
      if (i === curIdx) return;
      curIdx = i;
      var x = geo.x[i], y = geo.y[i];
      cross.setAttribute("x1", x); cross.setAttribute("x2", x);
      hGlow.setAttribute("cx", x); hGlow.setAttribute("cy", y);
      hDot.setAttribute("cx", x); hDot.setAttribute("cy", y);
      hover.setAttribute("opacity", "1");
      if (opts.onScrub) opts.onScrub(pts[i], i);
    }

    function release() {
      if (!scrubbing && curIdx < 0) return;
      scrubbing = false; curIdx = -1;
      hover.setAttribute("opacity", "0");
      var r = opts.returnEl;
      if (r && r.classList) {
        r.classList.remove("scrub-return");
        void r.offsetWidth;
        r.classList.add("scrub-return");
        r.addEventListener("animationend", function off(e) {
          if (e.target !== r) return;
          r.classList.remove("scrub-return");
          r.removeEventListener("animationend", off);
        });
      }
      if (opts.onRelease) opts.onRelease();
    }

    host.addEventListener("pointerdown", function (e) { scrubbing = true; showAt(idxAt(e.clientX)); });
    host.addEventListener("pointermove", function (e) { showAt(idxAt(e.clientX)); });
    host.addEventListener("pointerup", release);
    host.addEventListener("pointercancel", release);
    host.addEventListener("pointerleave", release);

    function onResize() {
      if (!document.body.contains(host)) { destroy(); return; }
      draw();
    }
    function destroy() { window.removeEventListener("resize", onResize); }
    window.addEventListener("resize", onResize);

    return {
      el: svg,
      drawMs: DRAW_MS,
      // redraw with new data and no draw-in: a data mutation is not a
      // first impression.
      redraw: function (next) {
        if (next && next.length > 1) pts = next.filter(function (p) { return p && isFinite(Number(p.v)); });
        draw();
      },
      destroy: destroy
    };
  };
  UI.chart.DRAW_MS = DRAW_MS;

  // ————— the settle — the quiet completion mark —————
  // UI.settleFlash(el) appends a 1px accent hairline under `el`, sweeps it out
  // over 420ms var(--ease-out-expo), fades it over 240ms at 500ms, and removes
  // itself at 740ms. The shared "something completed" moment: a booked trade,
  // a credited deposit, an approved application, a tested wallet. One hairline,
  // never a badge, never a burst, never a sound.
  UI.settleFlash = function (el) {
    if (!el) return null;
    var s = document.createElement("span");
    s.className = "settle";
    el.appendChild(s);
    setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 740);
    return s;
  };

  // ————— generated identity art —————
  // UI.identityArt(seed, size, delayMs) → html
  // Two of the four safe categorical hues at 22% and 9% in a 135° gradient over
  // --surface-2, both picked by hashing the seed (an email, an entity id, a
  // wallet label). Replaces monogram initials, which all look alike at 20px and
  // carry no identity at all. The gradient is inline because the pair is
  // per-entity; every value in it is a token, so both themes hold.
  //   size    px, default 20 (table rows). 26 in the sidebar.
  //   delayMs optional; stagger 30ms down a table.
  var CAT_SAFE = ["--cat-7", "--cat-4", "--cat-1", "--cat-8"];

  function hashSeed(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  UI.identityArt = function (seed, size, delayMs) {
    var h = hashSeed(String(seed == null ? "" : seed));
    var n = CAT_SAFE.length;
    var a = h % n;
    var b = (a + 1 + ((h >> 3) % (n - 1))) % n;   // always a different hue
    var px = Math.max(14, Math.min(64, Number(size) || 20));
    return '<span class="ident-art" aria-hidden="true" style="width:' + px + "px;height:" + px + "px" +
      ";background:linear-gradient(135deg, color-mix(in srgb, var(" + CAT_SAFE[a] + ") 22%, transparent), " +
      "color-mix(in srgb, var(" + CAT_SAFE[b] + ") 9%, transparent)), var(--surface-2)" +
      (delayMs ? ";animation-delay:" + Math.max(0, Number(delayMs) || 0) + "ms" : "") + '"></span>';
  };

  // ————— local region repaint —————
  // UI.repaint(el, html, opts) swaps a region's content and animates only that
  // region (opacity 0 → 1, translateY(6px) → 0, 200ms var(--ease-snappy)).
  // Use this instead of App.rerender() for local state: a tab switch, a row
  // expanding, a filter click. App.rerender() rebuilds .screen and replays the
  // whole page entrance, so opening a row to read its lifecycle re-animates the
  // page title. Omit html to re-animate a region you already rebuilt.
  //   opts.dur  override the 200ms, for the one case that has its own figure:
  //             the chart's scrub release returns over 240ms.
  UI.repaint = function (el, html, opts) {
    if (!el) return null;
    opts = opts || {};
    if (html !== undefined && html !== null) el.innerHTML = html;
    el.classList.remove("repaint");
    el.style.removeProperty("animation-duration");
    void el.offsetWidth;                      // restart if one is mid-flight
    // inline + important, so it also beats the reduced-motion override
    if (opts.dur) el.style.setProperty("animation-duration", (Number(opts.dur) || 200) + "ms", "important");
    el.classList.add("repaint");
    el.addEventListener("animationend", function off(e) {
      if (e.target !== el) return;            // children's animations bubble
      el.classList.remove("repaint");
      el.style.removeProperty("animation-duration");
      el.removeEventListener("animationend", off);
    });
    return el;
  };

  window.UI = UI;
})();
