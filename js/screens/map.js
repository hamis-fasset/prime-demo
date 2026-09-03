/* ————————————————————————————————————————————————
   Fasset Prime — Connection map (prototype-only internal page).
   Ported from prime-v2.standalone.html (spec §6 / OQ7) per
   ARCHITECTURE.md:
   · the two LOCKED furniture lines kept verbatim in meaning
     (delivery convention · HubSpot posture)
   · the Shipped / Specced / Build legend, restated with the fixed
     status vocabulary: shipped = positive, specced = info,
     build = neutral. No new hues, no capsule chips.
   · the full pillar-grouped table, every MAPROWS row carried over
     (address screening included; USD/EUR/BHD vIBANs assumed live for v2;
     no withdrawal-delay row)
   Internal furniture, so it keeps a denser treatment: 12px cells,
   44px rows. It still speaks the system: sentence case, warm
   surfaces, no row hairlines, ease-out physics.
   Zone is "bare": this screen owns its own header and back
   affordance (App.go("dashboard")).
   States: loading (one skeleton pass) · filtered-to-empty (one quiet
   sentence) · missing source rows (says so, and what to do) ·
   nothing here is role-gated because nothing here is client-facing,
   which the page states in the header.

   Wave-3: this is the one screen with a real categorical grouping and
   no money anywhere, so the four pillars carry the identity swatch
   (UI.ccy("p1".."p4"), the same 9px squarish component the currency
   rails use: four hues, exactly at the screen budget). The status
   dots stay --st-* and stay round: identity is a square, status is a
   dot, and they are never confusable. The filter now repaints the
   table only (UI.repaint) instead of App.rerender(), which used to
   replay the whole page entrance including the title.
   ———————————————————————————————————————————————— */
(function () {
  "use strict";

  var loadedOnce = false;   // skeleton runs once per app load
  var filter = "all";       // screen-local, re-applied on every render

  // status badge: a dot carries the hue, the word carries the meaning
  function bd(kind, label) {
    return '<span class="map-badge mb-' + kind + '" data-k="' + kind + '"><i></i>' + label + "</span>";
  }
  function sub(t) { return ' <span class="map-sub">' + t + "</span>"; }

  var SHIPPED = bd("shipped", "Shipped");
  var SPECCED = bd("specced", "Specced");
  var BUILD = bd("build", "Build");

  // ————— the §6 contract, row for row —————
  var MAPROWS = [
    { pillar: "Pillar 1 · Sign up without us" },
    { a: "Sign up (account created)", o: "Applicants triage queue (qualify, park, dismiss)", h: "Contact created; funnel event via the visibility feed", b: "Triage: " + BUILD + " · feed: " + BUILD },
    { a: "Qualify (or get parked)", o: "Same triage queue", h: "Funnel stage event; drop-off nudge emails (stay in HubSpot)", b: BUILD },
    { a: "Submit KYC", o: "KYC review queue with granular rejections", h: "KYC status writes (non-blocking, exist today)", b: SHIPPED },
    { a: "Sighted resubmit", o: "Reviewer comments that reach the client", h: "Status write", b: BUILD + sub("small · no comment field exists anywhere today") },
    { a: "Get approved (rails issued)", o: "Issue wallet and vIBAN at onboarding", h: "Activation email (stays in HubSpot)", b: SPECCED + sub("jobs 15, 24") },
    { a: "Enroll MFA / step-up", o: "None · portal auth stack, no §6 back-office row", h: "Nothing", b: BUILD + sub("portal-side") },
    { a: "Invite a teammate", o: "None yet · roles model desk-visible later", h: "Nothing", b: BUILD + sub("proposed 12.1, staged") },

    { pillar: "Pillar 2 · Trade on a firm price" },
    { a: "Get a firm quote", o: "Firm-quote engine (streamed LP quotes, quoteId redemption)", h: "Nothing pre-trade", b: SHIPPED + sub("desk-only by construction") },
    { a: "Quote as a client", o: "Client-authenticated quote path", h: "Funnel and trade events via feed", b: BUILD + sub("exists in no form") },
    { a: "See my tier / hit my limit", o: "Per-client spread and volume-tier layer, plus limits model", h: "Nothing", b: BUILD },
    { a: "Trade USD pairs at AED rates", o: "Cross-rate construction", h: "Nothing", b: BUILD },
    { a: "Execute, then booked", o: "QuoteId redemption and ledger posting", h: "Trade lifecycle emails keyed off the real event feed (replaces the Slack scraper)", b: "Engine: " + SHIPPED + " · feed: " + BUILD },
    { a: "Over-limit desk takeover", o: "Desk books via swap request (existing booking surface)", h: "Trade event via feed", b: "Booking: " + SHIPPED + " · feed: " + BUILD },
    { a: "Request rates (GTR, desk-priced account)", o: "Existing desk rate handling: the RM quotes and books on the desk's surface", h: "Nothing, or a funnel event via the feed", b: SHIPPED + sub("in spirit · v1 kept the desk conversation") },

    { pillar: "Pillar 3 · Move money without asking" },
    { a: "See my vIBAN (AED)", o: "On-ramp lifecycle and attribution (PRM-18)", h: "Deposit writes (exist today)", b: SHIPPED },
    { a: "See USD, EUR and BHD vIBANs", o: "Multicurrency vIBAN issuance", h: "Nothing yet", b: BUILD + sub("assumed live for v2: Optimus issues virtual accounts") },
    { a: "Watch a deposit arrive", o: "On-ramp lifecycle; unknown credits go to the unattributed queue", h: "Deposit event via feed", b: "Lifecycle: " + SHIPPED + " · CMA-2 watch and queue: " + SPECCED + " " + BUILD },
    { a: "Identify a held credit (confirm the sending account)", o: "Unattributed credits queue: the client's identification feeds candidate matching", h: "Nothing", b: SPECCED + " " + BUILD + sub("per OIA J8") },
    { a: "Deposit credited to balance", o: "Ledger posting discipline at boundary events", h: "Nothing", b: SPECCED + sub("posting today is a disconnected manual step") },
    { a: "Send an expected-deposit note (OQ1)", o: "Attribution hint on the on-ramp queue", h: "Nothing", b: BUILD + sub("optional, pending desk confirmation") },
    { a: "Submit a withdrawal", o: "Off-ramp lifecycle: four-account balances, LP registry, transfers, payout leg", h: "Withdrawal events via feed", b: SPECCED + sub("five slices with test trees, not built") },
    { a: "Whitelist a bank or wallet", o: "Review and approval of client-submitted destinations (shared registry)", h: "Nothing", b: SHIPPED },
    { a: "Screen a wallet address at entry", o: "Chain-analytics screening API", h: "Nothing", b: BUILD },
    { a: "Provide travel-rule data", o: "Travel-rule capture and storage", h: "Nothing (transmission stays open, risk 10.5)", b: BUILD },
    { a: "Register interest in a dark rail (OQ6)", o: "None · a demand counter", h: "Demand signal via the funnel feed", b: BUILD + sub("cheap either way") },

    { pillar: "Pillar 4 · Know where you stand" },
    { a: "See balances, history and statements", o: "Ledger core rebuild (money as money, immutable postings)", h: "Nothing", b: BUILD + sub("condemned-in-place today") },
    { a: "Get a push on any state change", o: "Real-time trade, deposit, withdrawal and funnel event feed", h: "The same feed is HubSpot's visibility source", b: BUILD }
  ];

  // ————— reads over the rows (honest counts, computed, never asserted) —————

  function actions() {
    return MAPROWS.filter(function (r) { return !r.pillar; });
  }
  function kindsOf(r) {
    var out = [], m, re = /data-k="([a-z]+)"/g;
    while ((m = re.exec(r.b))) if (out.indexOf(m[1]) < 0) out.push(m[1]);
    return out;
  }
  function countOf(kind) {
    return actions().filter(function (r) { return kindsOf(r).indexOf(kind) >= 0; }).length;
  }
  function passes(r) {
    return filter === "all" || kindsOf(r).indexOf(filter) >= 0;
  }

  // ————— render —————

  function skeletonHtml() {
    var h = '<div>' + UI.skel("300px", "26px") + "</div>" +
      '<div class="mt-16">' + UI.skel("100%", "14px") + "</div>" +
      '<div class="mt-8">' + UI.skel("72%", "14px") + "</div>" +
      '<div class="mt-32">' + UI.skel("100%", "36px") + "</div>";
    for (var i = 0; i < 7; i++) h += '<div class="mt-8">' + UI.skel("100%", "40px") + "</div>";
    return h;
  }

  function render(el) {
    if (!loadedOnce) {
      var body = document.createElement("div");
      body.innerHTML = skeletonHtml();
      el.appendChild(body);
      setTimeout(function () {
        loadedOnce = true;
        if (document.body.contains(el)) { body.remove(); renderBody(el); }
      }, 300);
      return;
    }
    renderBody(el);
  }

  function tableHtml() {
    var visible = 0, pillarNo = 0, h = "";
    h += '<div class="map-head">' +
      "<span>Client action in Prime</span>" +
      "<span>Optimus job servicing it</span>" +
      "<span>HubSpot sees</span>" +
      "<span>Status</span></div>";

    MAPROWS.forEach(function (r, i) {
      if (r.pillar) {
        pillarNo++;
        // a pillar head only earns its place if something under it survives the filter
        var any = false;
        for (var j = i + 1; j < MAPROWS.length && !MAPROWS[j].pillar; j++) if (passes(MAPROWS[j])) any = true;
        // the swatch is the grouping's identity: same component as the
        // currency rails, label rendered by us so it stays sentence case
        if (any) h += '<div class="map-pillar">' + UI.ccy("p" + pillarNo, { label: false }) +
          "<span>" + UI.esc(r.pillar) + "</span></div>";
        return;
      }
      if (!passes(r)) return;
      visible++;
      h += '<div class="map-row">' +
        '<span class="mr-a">' + UI.esc(r.a) + "</span>" +
        '<span class="mr-c">' + UI.esc(r.o) + "</span>" +
        '<span class="mr-c">' + UI.esc(r.h) + "</span>" +
        '<span class="mr-s">' + r.b + "</span>" +
        "</div>";
    });

    if (!visible) {
      h += '<div class="empty">Nothing carries that status.</div>';
    }
    return '<div class="map-table">' + h + "</div>";
  }

  function renderBody(el) {
    // blocks land as direct children of .screen so the 40ms entrance
    // stagger reads header → title → conventions → legend → table
    var h = "";

    // — header: quiet back affordance, then the title —
    h += '<div class="map-top">' +
      '<button class="link" id="mapBack" type="button">' + icon("chevronLeft", 12) + "Back to the portal</button>" +
      '<span class="freshline map-top-right">Internal page · not part of the client portal</span>' +
      "</div>";

    h += '<h1 class="map-title">Prime, Optimus and HubSpot</h1>' +
      '<p class="map-lede">Every client action in this prototype has a row here, with its back-office status today. ' +
      "Nothing in the portal demonstrates a capability that has no row.</p>";

    // — the two locked conventions: open typography, no boxes —
    h += '<div class="map-locked">' +
      '<div class="ml-row"><span class="ml-key">Delivery convention · locked</span>' +
      '<span class="ml-val">Capabilities ship to Optimus first, stabilise about a week, then reveal in Prime.</span></div>' +
      '<div class="ml-row"><span class="ml-key">HubSpot posture · locked</span>' +
      '<span class="ml-val">HubSpot sees, never masters. Pre-deal comms, nudge emails, chat and the AML archive stay there. Optimus is the system of record.</span></div>' +
      "</div>";

    // — legend + filter, one line, the only controls on the page —
    var total = actions().length;
    h += '<div class="map-legend">' +
      '<span class="ml-legend-item">' + SHIPPED + '<span class="map-sub">exists in production</span></span>' +
      '<span class="ml-legend-item">' + SPECCED + '<span class="map-sub">written with test trees, not built</span></span>' +
      '<span class="ml-legend-item">' + BUILD + '<span class="map-sub">exists in no form yet</span></span>' +
      "</div>";

    h += '<div class="map-bar">' +
      '<span class="freshline">' + total + " client actions · shipped " + countOf("shipped") +
        " · specced " + countOf("specced") + " · needs building " + countOf("build") +
        ". A row can carry more than one status, so these do not sum to " + total + ".</span>" +
      '<span class="seg map-seg">' +
        ["all", "shipped", "specced", "build"].map(function (k) {
          return '<button class="seg-btn' + (filter === k ? " active" : "") + '" data-f="' + k + '" type="button">' +
            (k === "all" ? "All" : k.charAt(0).toUpperCase() + k.slice(1)) + "</button>";
        }).join("") +
      "</span></div>";

    // the table lives in its own host so a filter click repaints the rows
    // and nothing else. The counts line above is computed over every row, so
    // it does not change with the filter and must not re-animate.
    h += '<div id="mapTableHost">' + tableHtml() + "</div>";

    h += '<p class="freshline map-foot">Source of truth for this table is the v2 brief §6 contract. Where a row says Build, the screen in the portal is a drawing, not a demonstration.</p>';

    el.insertAdjacentHTML("beforeend", h);

    // — wiring —
    el.querySelector("#mapBack").addEventListener("click", function () { App.go("dashboard"); });

    var host = el.querySelector("#mapTableHost");
    var segs = el.querySelectorAll("[data-f]");
    segs.forEach(function (b) {
      b.addEventListener("click", function () {
        var f = b.getAttribute("data-f");
        if (f === filter) return;              // nothing changed, so nothing moves
        filter = f;
        segs.forEach(function (x) { x.classList.toggle("active", x === b); });
        UI.repaint(host, tableHtml());
      });
    });
  }

  App.registerScreen("map", {
    title: "Connection map",
    zone: "bare",
    render: render
  });
})();
