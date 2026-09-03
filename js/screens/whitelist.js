/* ————————————————————————————————————————————————
   Fasset Prime — Whitelist (J18). Built in wave 2.
   Ported from prime-v2.standalone.html per ARCHITECTURE.md.
   This is the compliance backbone and it is deliberately the slow
   path: nothing here is one click, and every state is legible.
   Audit pass 2026-09-01: status-hue misuse (twice), network identity,
   13px reason sentences, M4 (the settle on a tested wallet),
   M7 (no page-entrance replay on a tab switch).

   Wallets:
   · add flow in a drawer. The address is screened at ENTRY against
     chain analytics, before any review queue. A screened-out address
     is refused in the form, finally, with a support path.
   · custody choice, then travel-rule capture. Saving with incomplete
     travel-rule info is allowed and lands in a visible blocking
     state ("needs travel-rule info"), never a silent pending.
   · pipeline: needs travel-rule info → pending review → verified →
     test sent → tested. Only tested wallets reach the withdrawal
     picker (Data.eligibleDests).
   · the test transfer is client-run: request it, Fasset sends a small
     amount, the client types the amount received. Wrong amount is a
     plain retry error, not a failure state.
   Banks:
   · the entity-legal-name rule is stated up front, IBAN format is
     validated, a supporting document is required, submit takes a
     step-up.
   Both registries: desk verify/reject demos, desk-direct additions
   appearing in the same registry with the same states, and client
   remove on any entry (step-up gated, immediate).

   Colour: no money appears on this screen, so the one categorical
   dimension is NETWORK, not currency (colour plan, rule 1). Bank
   currency stays neutral text.

   States per element: loading (one skeleton pass) · empty (both
   registries) · error/failed (screening rejection, review rejection
   with reason, wrong test amount, invalid address, invalid IBAN,
   missing document) · stale/degraded (feed note) · permission-denied
   (only admins add or remove destinations).
   ———————————————————————————————————————————————— */
(function () {
  "use strict";

  var loadedOnce = false;
  var TAB = "wallets";        // wallets | banks
  var armScreen = false;      // demo: next submitted address fails screening
  var screened = [];          // addresses already refused by screening
  var testIn = {};            // wallet id → typed test amount (transient)
  var testMsg = {};           // wallet id → inline nudge when nothing was typed
  var TESTED = null;          // wallet ids already marked as tested
  var ROOT = null;            // the live .screen element

  var NET_NAME = { TRON: "TRON", ETH: "Ethereum", BTC: "Bitcoin" };
  var NET_RE = {
    TRON: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
    ETH: /^0x[0-9a-fA-F]{40}$/,
    BTC: /^bc1[0-9a-z]{20,60}$/
  };

  // ————— foundation API (js/ui.js) —————
  // The fallbacks exist only so a load-order accident can't blank the screen.
  function ccy(v, opts) { return UI.ccy ? UI.ccy(v, opts) : UI.esc(v); }
  function swap(node, html) { if (UI.repaint) UI.repaint(node, html); else node.innerHTML = html; }
  function settle(node) { if (node && UI.settleFlash) UI.settleFlash(node); }

  function isAdmin() { return Data.state.role === "admin"; }
  function entity() { return Data.state.user.entity; }
  function wallet(id) { return Data.state.wallets.filter(function (x) { return x.id === id; })[0]; }
  function parseAmt(s) { var a = parseFloat(String(s || "").replace(/,/g, "")); return a > 0 ? a : 0; }
  function region(id) { return ROOT ? ROOT.querySelector('[data-wlsec="' + id + '"]') : null; }

  // ————— status vocabulary (dots + plain sentences, never colour alone) —————
  // The fixed vocabulary, applied honestly: nothing here failed, so nothing
  // here is an error. A wallet missing travel-rule info and a verified wallet
  // awaiting the client's own test transfer are both waiting on a human.

  function wlStatus(state) {
    if (state === "needs_tr") return UI.statusDot("warning", "Needs travel-rule info");
    if (state === "pending") return UI.statusDot("warning", "Pending review");
    if (state === "verified") return UI.statusDot("warning", "Verified · test transfer next");
    if (state === "test_sent") return UI.statusDot("warning", "Test sent · confirm amount");
    if (state === "tested") return UI.statusDot("positive", "Tested");
    if (state === "rejected") return UI.statusDot("error", "Rejected");
    return UI.statusDot("neutral", state);
  }

  // Banks share three of those state names and none of the meaning: there is
  // no test transfer on a bank account, so a verified account is finished and
  // eligible, not waiting on anyone. One vocabulary, two honest mappings.
  function bankStatus(state) {
    if (state === "pending") return UI.statusDot("warning", "Pending review");
    if (state === "verified") return UI.statusDot("positive", "Verified");
    if (state === "rejected") return UI.statusDot("error", "Rejected");
    return UI.statusDot("neutral", state);
  }

  function walletSub(w) {
    if (w.state === "needs_tr") return { err: true, txt: "Missing " + w.missing.join(", ") + "." };
    if (w.state === "rejected") return { err: true, txt: w.reason };
    if (w.state === "test_sent" && testMsg[w.id]) return { err: true, txt: testMsg[w.id] };
    if (w.state === "test_sent" && w.testErr) return { err: true, txt: "That amount doesn’t match what we sent. Check the receiving wallet and try again." };
    if (w.state === "test_sent") return { err: false, txt: "Enter the exact amount received to finish." };
    if (w.state === "verified") return { err: false, txt: "One test transfer away from being a destination." };
    if (w.state === "tested") return { err: false, txt: "Eligible as a withdrawal destination." };
    if (w.state === "pending") return { err: false, txt: "Screening passed. With the review team now." };
    return null;
  }

  // ————— simulated document upload (a filling bar, never a spinner) —————
  // Duplicated verbatim in move.js. The audit's fix is one component in
  // ui.js + app.css, which this owner cannot write; flagged, not forked.

  function uploaderHtml(id, label) {
    return '<div class="wl-up" id="' + id + '">' +
      '<span class="wl-up-meta">' + UI.esc(label) + "</span>" +
      '<span class="wl-up-bar"><i></i></span>' +
      '<label class="link" for="' + id + '-f">Attach</label>' +
      '<input type="file" id="' + id + '-f" class="hide"></div>';
  }

  function wireUploader(box) {
    var st = { done: false };
    if (!box) return { isDone: function () { return false; } };
    box.querySelector("input[type=file]").addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      box.querySelector(".wl-up-meta").textContent = f.name + " · attaching";
      box.querySelector(".wl-up-bar").classList.add("run");
      setTimeout(function () {
        box.classList.add("done");
        box.querySelector(".wl-up-meta").textContent = f.name + " · attached";
        st.done = true;
      }, 760);
    });
    return { isDone: function () { return st.done; } };
  }

  // ————— screening at entry —————
  // Every submitted address is checked against chain analytics before
  // it reaches the review queue. A refusal is final for that address.

  function screeningFails(addr) {
    if (screened.indexOf(addr) >= 0) return true;
    if (!armScreen) return false;
    armScreen = false;
    screened.push(addr);
    var btn = document.getElementById("wlArm");
    if (btn) btn.classList.remove("armed");
    return true;
  }

  // ————— add wallet (a drawer, never a modal) —————

  function openAddWallet() {
    // one submit, one visible path. The controls behind it (screening, desk
    // review, the test transfer) all stay; the client just sees them as one
    // line here and one status line on the row (2026-09-03: "same steps,
    // feels like one").
    var h = UI.drawer("Add a wallet",
      '<div class="steps" style="margin-bottom:16px"><span class="step active">Details</span><span class="sep">·</span>' +
        '<span class="step">Desk review</span><span class="sep">·</span>' +
        '<span class="step">Test transfer</span><span class="sep">·</span>' +
        '<span class="step">Ready</span></div>' +
      '<div class="note note-error hide" id="awScreen">This address failed screening and can’t be whitelisted. Use a different address, or email support@fasset.com if that looks wrong.</div>' +
      '<div class="field mt-16"><label for="awLabel">Label</label>' +
        '<input id="awLabel" class="input" placeholder="Treasury cold wallet" autocomplete="off"></div>' +
      '<div class="field-row">' +
        '<div class="field mv-narrow"><label for="awNet">Network</label>' +
          '<select id="awNet" class="select"><option value="TRON">TRON</option><option value="ETH">Ethereum</option><option value="BTC">Bitcoin</option></select></div>' +
        '<div class="field"><label for="awAddr">Address</label>' +
          '<input id="awAddr" class="input mono" placeholder="Paste the address" autocomplete="off">' +
          '<div class="hint err hide" id="awAddrErr"></div></div>' +
      "</div>" +
      '<div class="field"><label>Custody</label><div class="seg">' +
        '<button class="seg-btn active" data-cust="hosted" type="button">Hosted · an exchange or VASP</button>' +
        '<button class="seg-btn" data-cust="self" type="button">Self-hosted</button>' +
      "</div></div>" +
      '<div class="wl-tr">' +
        '<div class="wl-tr-title">Travel-rule information · required for review</div>' +
        '<div id="awHosted">' +
          '<div class="field"><label for="awVasp">VASP or exchange name</label>' +
            '<input id="awVasp" class="input" placeholder="Binance" autocomplete="off"></div>' +
          '<div class="field"><label for="awBenName">Beneficiary legal name</label>' +
            '<input id="awBenName" class="input" placeholder="Legal name on the receiving account" autocomplete="off"></div>' +
          '<div class="field"><label for="awBenCountry">Beneficiary country</label>' +
            '<select id="awBenCountry" class="select"><option value="">Select a country</option>' +
            '<option>United Arab Emirates</option><option>United Kingdom</option><option>Singapore</option><option>Other</option></select></div>' +
        "</div>" +
        '<div id="awSelf" class="hide">' +
          '<label class="wl-ack"><input type="checkbox" id="awAck">' +
          '<span>I declare that this self-hosted wallet is owned and controlled by ' + UI.esc(entity()) + ".</span></label>" +
        "</div>" +
        '<div class="hint err hide" id="awMsg"></div>' +
      "</div>",
      {
        width: 560,
        foot: '<button class="btn btn-secondary" id="awCancel" type="button">Cancel</button>' +
              '<button class="btn btn-primary" id="awSubmit" type="button">Submit</button>'
      });

    var hosted = true;
    var q = function (sel) { return h.el.querySelector(sel); };
    q("#awLabel").focus();

    h.el.querySelectorAll("[data-cust]").forEach(function (b) {
      b.addEventListener("click", function () {
        hosted = b.getAttribute("data-cust") === "hosted";
        h.el.querySelectorAll("[data-cust]").forEach(function (x) { x.classList.toggle("active", x === b); });
        q("#awHosted").classList.toggle("hide", !hosted);
        q("#awSelf").classList.toggle("hide", hosted);
        q("#awMsg").classList.add("hide");
      });
    });
    q("#awAddr").addEventListener("input", function () {
      q("#awAddrErr").classList.add("hide");
      q("#awAddr").classList.remove("invalid");
      q("#awScreen").classList.add("hide");
    });

    function addrOk() {
      var net = q("#awNet").value, a = q("#awAddr").value.trim();
      if (!a) {
        q("#awAddrErr").textContent = "Paste the destination address.";
        q("#awAddrErr").classList.remove("hide");
        q("#awAddr").classList.add("invalid");
        return false;
      }
      if (!NET_RE[net].test(a)) {
        q("#awAddrErr").textContent = "That doesn’t look like a valid " + NET_NAME[net] + " address. Check the format and try again.";
        q("#awAddrErr").classList.remove("hide");
        q("#awAddr").classList.add("invalid");
        return false;
      }
      return true;
    }
    function refusedByScreening() {
      if (!screeningFails(q("#awAddr").value.trim())) return false;
      q("#awScreen").classList.remove("hide");
      q("#awAddr").classList.add("invalid");
      h.body.scrollTop = 0;
      return true;
    }
    function missingTr() {
      if (!hosted) return q("#awAck").checked ? [] : ["ownership declaration"];
      return [
        q("#awVasp").value.trim() ? null : "VASP name",
        q("#awBenName").value.trim() ? null : "beneficiary legal name",
        q("#awBenCountry").value ? null : "beneficiary country"
      ].filter(Boolean);
    }
    function newWallet(state, missing) {
      return {
        label: q("#awLabel").value.trim() || "Unnamed wallet",
        net: NET_NAME[q("#awNet").value],
        addr: q("#awAddr").value.trim(),
        state: state,
        missing: missing
      };
    }
    function msg(text) {
      q("#awMsg").textContent = text;
      q("#awMsg").classList.remove("hide");
    }

    q("#awCancel").addEventListener("click", h.close);
    q("#awSubmit").addEventListener("click", function () {
      if (!addrOk() || refusedByScreening()) return;
      var missing = missingTr();
      if (missing.length) {
        msg("Missing: " + missing.join(", ") + ".");
        return;
      }
      UI.stepUp("Adding a withdrawal destination changes where money can leave Fasset.", function () {
        Data.addWallet(newWallet("pending", []));
        h.close();
      });
    });
  }

  // ————— complete travel-rule info on a blocked wallet —————

  function openTravelRule(w) {
    var need = w.missing.slice();
    function fieldFor(m) {
      if (m === "VASP name") return '<div class="field"><label for="trVasp">VASP or exchange name</label><input id="trVasp" class="input" placeholder="Binance" autocomplete="off"></div>';
      if (m === "beneficiary legal name") return '<div class="field"><label for="trName">Beneficiary legal name</label><input id="trName" class="input" placeholder="Legal name on the receiving account" autocomplete="off"></div>';
      if (m === "beneficiary country") return '<div class="field"><label for="trCountry">Beneficiary country</label><select id="trCountry" class="select"><option value="">Select a country</option><option>United Arab Emirates</option><option>United Kingdom</option><option>Singapore</option><option>Other</option></select></div>';
      return '<label class="wl-ack"><input type="checkbox" id="trAck"><span>I declare that this self-hosted wallet is owned and controlled by ' + UI.esc(entity()) + ".</span></label>";
    }
    var h = UI.drawer("Provide travel-rule information",
      '<div class="note note-warning">This wallet is blocked until the details below are provided.</div>' +
      '<div class="mv-sum mt-16">' +
        '<div class="def-row"><span class="def-label">Wallet</span><span class="def-value">' + UI.esc(w.label) + "</span></div>" +
        '<div class="def-row"><span class="def-label">Network</span><span class="def-value">' + UI.esc(w.net) + "</span></div>" +
        '<div class="def-row"><span class="def-label">Address</span><span class="def-value mono">' + UI.esc(w.addr) + "</span></div>" +
      "</div>" +
      need.map(fieldFor).join("") +
      '<div class="hint err hide" id="trErr">Fill in everything above.</div>',
      {
        width: 480,
        foot: '<button class="btn btn-secondary" id="trCancel" type="button">Cancel</button>' +
              '<button class="btn btn-primary" id="trSubmit" type="button">Submit for review</button>'
      });
    h.el.querySelector("#trCancel").addEventListener("click", h.close);
    h.el.querySelector("#trSubmit").addEventListener("click", function () {
      var ok = need.every(function (m) {
        if (m === "VASP name") return !!h.el.querySelector("#trVasp").value.trim();
        if (m === "beneficiary legal name") return !!h.el.querySelector("#trName").value.trim();
        if (m === "beneficiary country") return !!h.el.querySelector("#trCountry").value;
        return h.el.querySelector("#trAck").checked;
      });
      if (!ok) { h.el.querySelector("#trErr").classList.remove("hide"); return; }
      UI.stepUp("Completing a whitelist entry affects where money can leave Fasset.", function () {
        Data.completeTravelRule(w.id);
        h.close();
      });
    });
  }

  // ————— add bank account —————

  function openAddBank() {
    var h = UI.drawer("Add a bank account",
      '<div class="steps" style="margin-bottom:16px"><span class="step active">Details</span><span class="sep">·</span>' +
        '<span class="step">Desk review</span><span class="sep">·</span>' +
        '<span class="step">Linked and ready</span></div>' +
      '<div class="note note-warning">The account must be in your entity’s legal name: ' + UI.esc(entity()) +
        ". Any other name is rejected at review.</div>" +
      '<div class="field mt-16"><label for="abIban">IBAN</label>' +
        '<input id="abIban" class="input mono" placeholder="AE00 0000 0000 0000 0000 000" autocomplete="off">' +
        '<div class="hint err hide" id="abIbanErr"></div></div>' +
      '<div class="field-row">' +
        '<div class="field"><label for="abBank">Bank</label><input id="abBank" class="input" placeholder="Emirates NBD" autocomplete="off"></div>' +
        '<div class="field mv-narrow"><label for="abCur">Currency</label>' +
          '<select id="abCur" class="select"><option>AED</option><option>USD</option><option>GBP</option></select></div>' +
      "</div>" +
      '<div class="field"><label for="abTitle">Account title · legal name</label>' +
        '<input id="abTitle" class="input" value="' + UI.esc(entity()) + '" autocomplete="off">' +
        '<div class="hint">Prefilled from your entity. Change it only if the bank holds a different legal name.</div></div>' +
      '<div class="field"><label>Supporting document · IBAN letter or statement header</label>' +
        uploaderHtml("abUp", "No document attached yet.") +
        '<div class="hint err hide" id="abDocErr">Attach the IBAN letter or a statement header before submitting.</div></div>' +
      '<div class="hint err hide" id="abBankErr">Name the bank.</div>',
      {
        width: 520,
        foot: '<button class="btn btn-secondary" id="abCancel" type="button">Cancel</button>' +
              '<button class="btn btn-primary" id="abSubmit" type="button">Submit for review</button>'
      });

    var up = wireUploader(h.el.querySelector("#abUp"));
    var q = function (s) { return h.el.querySelector(s); };
    q("#abIban").focus();
    q("#abIban").addEventListener("input", function () {
      q("#abIbanErr").classList.add("hide");
      q("#abIban").classList.remove("invalid");
    });
    q("#abBank").addEventListener("input", function () { q("#abBankErr").classList.add("hide"); });
    q("#abCancel").addEventListener("click", h.close);

    q("#abSubmit").addEventListener("click", function () {
      var raw = q("#abIban").value.replace(/\s/g, "").toUpperCase();
      var bad = /^AE/.test(raw)
        ? (!/^AE\d{21}$/.test(raw) && "A UAE IBAN is AE followed by 21 digits. Check for typos and try again.")
        : (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(raw) && "That doesn’t look like an IBAN. It starts with a two-letter country code, then two check digits.");
      if (bad) {
        q("#abIbanErr").textContent = bad;
        q("#abIbanErr").classList.remove("hide");
        q("#abIban").classList.add("invalid");
        return;
      }
      if (!q("#abBank").value.trim()) { q("#abBankErr").classList.remove("hide"); return; }
      if (!up.isDone()) { q("#abDocErr").classList.remove("hide"); return; }
      UI.stepUp("Adding a withdrawal destination changes where money can leave Fasset.", function () {
        Data.addBank({
          bank: q("#abBank").value.trim(),
          iban: q("#abIban").value.trim(),
          title: q("#abTitle").value.trim() || entity(),
          cur: q("#abCur").value
        });
        h.close();
      });
    });
  }

  // ————— registries —————

  function walletActions(w) {
    if (!isAdmin()) return '<span class="wl-actions"></span>';   // stated once, above the table
    var rm = '<button class="link wl-rm" data-wrm="' + UI.esc(w.id) + '" type="button">Remove</button>';
    var lead = "";
    if (w.state === "needs_tr") lead = '<button class="link" data-wtr="' + UI.esc(w.id) + '" type="button">Provide travel-rule info</button>';
    if (w.state === "verified") lead = '<button class="link" data-wtest="' + UI.esc(w.id) + '" type="button">Send me a test transfer</button>';
    if (w.state === "test_sent") {
      lead = '<span class="wl-test"><input class="input' + (w.testErr ? " invalid" : "") + '" data-wamt="' + UI.esc(w.id) +
        '" inputmode="decimal" placeholder="Amount received" value="' + UI.esc(testIn[w.id] || "") + '" aria-label="Amount received">' +
        '<button class="link" data-wconfirm="' + UI.esc(w.id) + '" type="button">Confirm</button></span>';
    }
    return '<span class="wl-actions">' + lead + rm + "</span>";
  }

  function walletsTable() {
    return '<div class="wl-table">' + UI.table({
      // a registry, not a time-ordered list, so no day groups. No spacer
      // either: with the trailing columns cut to their content width there is
      // no surplus to absorb, and the identity column (mono address plus a
      // wrapping sub-line) puts every freed pixel to work.
      cols: [
        { label: "Wallet", w: "minmax(0, 1fr)" },
        { label: "Network", w: "110px" },
        { label: "Status", w: "210px" },
        { label: "Added", w: "105px" },
        { label: "", w: "250px", right: true }
      ],
      rows: Data.state.wallets.map(function (w) {
        var sub = walletSub(w);
        return {
          key: w.id,
          cls: "wlrow",
          cells: [
            '<span class="cell-main"><span class="mv-idcell">' +
              '<span class="name">' + UI.esc(w.label) + "</span>" +
              '<span class="wl-addr">' + UI.esc(w.addr) + "</span>" +
              (sub ? '<span class="wl-sub' + (sub.err ? " err" : "") + '">' + UI.esc(sub.txt) + "</span>" : "") +
              "</span></span>",
            // network is this screen's only categorical dimension: a 9px
            // squarish swatch and neutral text, never a dot, never a tint
            '<span class="wl-net">' + ccy(w.net) + "</span>",
            wlStatus(w.state),
            '<span class="date">' + UI.esc(UI.fmtDate(w.added)) + "</span>",
            walletActions(w)
          ]
        };
      }),
      empty: "No wallets yet."
    }) + "</div>";
  }

  function banksTable() {
    return '<div class="wl-table">' + UI.table({
      // same registry treatment: Bank stops being a second flexible track,
      // so the right-hand columns cluster and Account keeps the width its
      // wrapping sub-line needs.
      cols: [
        { label: "Account", w: "minmax(0, 1fr)" },
        { label: "Bank", w: "170px" },
        { label: "Status", w: "210px" },
        { label: "Added", w: "105px" },
        { label: "", w: "140px", right: true }
      ],
      rows: Data.state.banks.map(function (b) {
        // approval auto-links the account: withdrawals to it are ready and
        // transfers from it match your vIBAN automatically (2026-09-02 call)
        var sub = b.state === "rejected" ? { err: true, txt: b.reason }
          : b.byDesk ? { err: false, txt: "Added by the desk, linked and ready." }
          : b.state === "verified" ? { err: false, txt: "Linked to your account. Withdraw to it, and deposits from it are recognised automatically." }
          : { err: false, txt: "With the review team." };
        return {
          key: b.id,
          cls: "wlrow",
          cells: [
            '<span class="cell-main"><span class="mv-idcell">' +
              '<span class="name">' + UI.esc(b.title) + "</span>" +
              '<span class="wl-addr">' + UI.esc(b.iban) + "</span>" +
              '<span class="wl-sub' + (sub.err ? " err" : "") + '">' + UI.esc(sub.txt) + "</span>" +
              "</span></span>",
            // no swatch here: this tab has no network column, and currency
            // does not own colour on a screen where no money appears
            '<span class="desc">' + UI.esc(b.bank + " · " + b.cur) + "</span>",
            bankStatus(b.state),
            '<span class="date">' + UI.esc(UI.fmtDate(b.added)) + "</span>",
            isAdmin()
              ? '<span class="wl-actions"><button class="link wl-rm" data-brm="' + UI.esc(b.id) + '" type="button">Remove</button></span>'
              : '<span class="wl-actions"></span>'
          ]
        };
      }),
      empty: "No bank accounts yet."
    }) + "</div>";
  }

  // ————— region painting (M7) —————

  function tabsHtml() {
    return '<div class="seg">' +
      '<button class="seg-btn' + (TAB === "wallets" ? " active" : "") + '" data-wl="wallets" type="button">Wallets</button>' +
      '<button class="seg-btn' + (TAB === "banks" ? " active" : "") + '" data-wl="banks" type="button">Bank accounts</button>' +
      "</div>";
  }

  function registryHtml() {
    if (TAB === "wallets") {
      return '<div class="note note-info">Only tested wallets appear in the withdrawal picker.</div>' +
        (isAdmin() ? "" : '<p class="freshline mt-8">Adding and removing destinations is an admin action.</p>') +
        '<div class="section-head mt-32"><h2>Wallets</h2>' +
        '<span class="link">' + Data.state.wallets.filter(function (w) { return w.state === "tested"; }).length + " tested</span></div>" +
        walletsTable() +
        (Data.state.stale ? '<p class="freshline mt-8">Registry feed interrupted · last-known states, re-syncing automatically.</p>' : "");
    }
    return '<div class="note note-info">Bank accounts must be in your entity’s legal name: ' + UI.esc(entity()) +
      ". Any other name is rejected at review.</div>" +
      (isAdmin() ? "" : '<p class="freshline mt-8">Adding and removing destinations is an admin action.</p>') +
      '<div class="section-head mt-32"><h2>Bank accounts</h2>' +
      '<span class="link">' + Data.state.banks.filter(function (b) { return b.state === "verified"; }).length + " verified</span></div>" +
      banksTable() +
      (Data.state.stale ? '<p class="freshline mt-8">Registry feed interrupted · last-known states, re-syncing automatically.</p>' : "");
  }

  function demoHtml() {
    return '<span class="freshline">Demo · the desk side. WL-5 is the seeded screened-out example.</span>' +
      '<div class="demo-strip">' +
        '<button class="db-btn' + (armScreen ? " armed" : "") + '" id="wlArm" type="button">Arm: the next address fails screening</button>' +
        '<button class="db-btn" id="wlVerify" type="button">Desk: verify the oldest pending entry</button>' +
        '<button class="db-btn" id="wlReject" type="button">Desk: reject the oldest pending entry, with reason</button>' +
        '<button class="db-btn" id="wlDesk" type="button">Desk whitelists a bank directly</button>' +
      "</div>" +
      '<span class="freshline">The test amount here is always ' +
        UI.fmtNum(Data.TEST_AMT) + " USDT; in production it is random per test.</span>";
  }

  function paint(id, fade) {
    var node = region(id);
    if (!node) return;
    var html = id === "tabs" ? tabsHtml() : id === "registry" ? registryHtml() : demoHtml();
    if (fade) swap(node, html); else node.innerHTML = html;
    if (id === "registry") markTested(node);
  }

  function setTab(t) {
    if (TAB === t) return;
    TAB = t;
    paint("tabs", false);
    paint("registry", true);
    // the page-head action names the thing it adds, and the head is not
    // rebuilt on a local state change, so it is updated in place
    var add = ROOT && ROOT.querySelector("#wlAdd");
    if (add) add.textContent = TAB === "wallets" ? "Add wallet" : "Add bank account";
  }

  // ————— the completion moment (M4) —————
  // A wallet becoming tested is the client typing back the exact amount
  // Fasset sent. That is the one genuine completion on this screen, and it
  // is marked once, on the row, with the shared settle hairline.

  function testedNow() {
    var m = {};
    Data.state.wallets.forEach(function (w) { if (w.state === "tested") m[w.id] = 1; });
    return m;
  }

  function markTested(node) {
    var now = testedNow();
    if (TESTED === null) { TESTED = now; return; }   // seeded wallets never celebrate
    var fresh = Object.keys(now).filter(function (id) { return !TESTED[id]; });
    TESTED = now;
    if (!fresh.length) return;
    // one frame later, so the mark lands on the painted row whatever order
    // the region swap runs in
    requestAnimationFrame(function () {
      fresh.forEach(function (id) {
        settle(node.querySelector('.row[data-key="' + id + '"] .mv-idcell'));
      });
    });
  }

  // ————— wiring —————
  // One delegated listener set per region, attached once: the region shells
  // outlive every repaint, so nothing is ever double-bound.

  function wireOnce(node, id) {
    if (!node || node.getAttribute("data-wired")) return;
    node.setAttribute("data-wired", "1");

    if (id === "tabs") {
      node.addEventListener("click", function (e) {
        var b = e.target.closest && e.target.closest("[data-wl]");
        if (b) setTab(b.getAttribute("data-wl"));
      });
      return;
    }

    if (id === "registry") {
      node.addEventListener("input", function (e) {
        var id2 = e.target.getAttribute && e.target.getAttribute("data-wamt");
        if (!id2) return;
        testIn[id2] = e.target.value;
        delete testMsg[id2];
      });
      node.addEventListener("keydown", function (e) {
        if (e.key !== "Enter") return;
        var id2 = e.target.getAttribute && e.target.getAttribute("data-wamt");
        if (id2) confirmTest(id2);
      });
      node.addEventListener("click", function (e) {
        var b = e.target.closest && e.target.closest("button");
        if (!b) return;
        var v;
        if ((v = b.getAttribute("data-wtr"))) {
          var w = wallet(v);
          if (w) openTravelRule(w);
        } else if ((v = b.getAttribute("data-wtest"))) {
          Data.requestTest(v);
        } else if ((v = b.getAttribute("data-wconfirm"))) {
          confirmTest(v);
        } else if ((v = b.getAttribute("data-wrm"))) {
          removeWallet(v);
        } else if ((v = b.getAttribute("data-brm"))) {
          removeBank(v);
        }
      });
      return;
    }

    if (id === "demo") {
      node.addEventListener("click", function (e) {
        var b = e.target.closest && e.target.closest("button");
        if (!b) return;
        // second argument is the toast kind: a refusal never gets a green tick
        // (UI.toast(msg, "done" | "note" | "blocked"))
        if (b.id === "wlArm") {
          armScreen = !armScreen;
          b.classList.toggle("armed", armScreen);
          UI.toast(armScreen ? "Armed. The next address you submit fails chain analytics screening." : "Disarmed.", "note");
        } else if (b.id === "wlVerify") {
          if (!Data.verifyOldestPending()) UI.toast("Nothing is pending review.", "blocked");
        } else if (b.id === "wlReject") {
          if (!Data.rejectOldestPending()) UI.toast("Nothing is pending review.", "blocked");
        } else if (b.id === "wlDesk") {
          setTab("banks");
          Data.deskAddsBank();
        }
      });
    }
  }

  function removeWallet(id) {
    UI.stepUp("Removing a withdrawal destination is a security change. It takes effect immediately.", function () {
      delete testIn[id];
      Data.removeWallet(id);
    });
  }

  function removeBank(id) {
    UI.stepUp("Removing a withdrawal destination is a security change. It takes effect immediately.", function () {
      Data.removeBank(id);
    });
  }

  function confirmTest(id) {
    if (!wallet(id)) return;
    var v = parseAmt(testIn[id]);
    if (!v) {
      testMsg[id] = "Enter the exact amount you received, decimals included.";
      paint("registry", true);
      return;
    }
    delete testMsg[id];
    // the ledger decides: a wrong amount comes back as a plain retry error.
    // Data.confirmTest emits, so the repaint (and the settle) happen inside
    // this call.
    if (Data.confirmTest(id, v)) delete testIn[id];
  }

  // ————— render —————

  function skeletonHtml() {
    return '<div class="section">' +
      "<div>" + UI.skel("180px", "28px") + "</div>" +
      '<div class="mt-24">' + UI.skel("100%", "44px") + "</div>" +
      '<div class="mt-24">' + UI.skel("100%", "56px") + "</div>" +
      '<div class="mt-8">' + UI.skel("100%", "56px") + "</div>" +
      '<div class="mt-8">' + UI.skel("100%", "56px") + "</div>" +
      "</div>";
  }

  function render(el) {
    var add = el.querySelector("#wlAdd");
    if (add) add.addEventListener("click", function () {
      if (TAB === "wallets") openAddWallet(); else openAddBank();
    });

    if (!loadedOnce) {
      var body = document.createElement("div");
      body.innerHTML = skeletonHtml();
      el.appendChild(body);
      setTimeout(function () {
        loadedOnce = true;
        if (document.body.contains(el)) { body.remove(); renderBody(el); }
      }, 340);
      return;
    }
    renderBody(el);
  }

  // the shells are direct children of .screen, so the page entrance
  // choreography still owns the first paint
  function renderBody(el) {
    ROOT = el;
    el.insertAdjacentHTML("beforeend",
      '<div class="wl-tabs" data-wlsec="tabs"></div>' +
      '<div class="section" data-wlsec="registry"></div>' +
      '<div class="section mv-demo" data-wlsec="demo"></div>');
    ["tabs", "registry", "demo"].forEach(function (id) { wireOnce(region(id), id); });
    paint("tabs", false);
    paint("registry", false);
    paint("demo", false);
  }

  App.registerScreen("whitelist", {
    title: "Whitelist",
    subtitle: "Where money can leave Fasset. Deliberately a careful path",
    actions: function () {
      if (Data.state.role !== "admin") return "";
      return '<button class="btn btn-primary" id="wlAdd" type="button">' +
        (TAB === "wallets" ? "Add wallet" : "Add bank account") + "</button>";
    },
    zone: "app",
    // Move money links here when a destination is missing
    openTab: function (t) { TAB = t === "banks" ? "banks" : "wallets"; },
    render: render,
    // patch in place instead of rebuilding the screen
    onData: function (scope) {
      if (!ROOT || !document.body.contains(ROOT) || !region("registry")) return false;
      // the shell already refreshed the bell; nothing here renders notifications
      if (scope === "notifs") return true;
      if (scope === "whitelist") { paint("registry", true); return true; }
      return false;
    }
  });
})();
