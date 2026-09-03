/* ————————————————————————————————————————————————
   Fasset Prime — Settings (J6 config + profile). Built in wave 2.
   Ported from prime-v2.standalone.html per ARCHITECTURE.md:
   · profile: entity details read-only, contact-us path to change
   · security: authenticator status, rotate, view recovery codes,
     change password — every one behind UI.stepUp; active sessions
     with revoke (step-up)
   · notification preferences (personal, all roles)
   · agreements
   All quiet: open typography and def-rows, no boxed numbers, no lines.
   Recovery codes render in a drawer, mono, once-only language kept.
   Data API: Data.state.user, UI.stepUp, UI.recoveryCodes.
   States: loading (one skeleton pass) · stale session feed note ·
   step-up failure handled by UI.stepUp · entity change = quiet
   permission story (read-only + contact path) · sessions empty.

   Wave-3 composition fix: the page used to be four 620px sections in a
   1040px column with the right 420px permanently empty and nothing
   top-right. Security now runs two columns, the actions left and the
   active sessions right, and the head carries the support path, so the
   page resolves instead of reading as a left-hand strip. Revoking a
   session repaints the session list only (UI.repaint), never the page.
   ———————————————————————————————————————————————— */
(function () {
  "use strict";

  var loadedOnce = false;

  // screen-local, survives re-renders (renders must be idempotent)
  var sessions = [
    { label: "This device · Chrome on macOS · Dubai", current: true },
    { label: "iPhone · Safari · Dubai · 2 h ago", current: false }
  ];
  var prefs = [
    { k: "dep", label: "Deposits · every state change", on: true },
    { k: "wd", label: "Withdrawals · every state change", on: true },
    { k: "tr", label: "Trades · booked confirmations", on: true },
    { k: "team", label: "Team · joins and role changes", on: false }
  ];
  var agreements = [
    { label: "Prime client agreement · v3.2" },
    { label: "Risk disclosure · v2.0" }
  ];

  // a local region swap, so nothing else on the page re-animates.
  // UI.repaint is the shared 200ms fade; the fallback keeps the swap honest
  // if it hasn't landed yet.
  function repaint(el, html) {
    if (!el) return;
    if (UI.repaint) UI.repaint(el, html);
    else el.innerHTML = html;
  }

  function sessionsHtml() {
    if (!sessions.length) {
      return '<div class="subhead">Active sessions</div>' +
        '<p class="hint">No active sessions.</p>';
    }
    return '<div class="subhead">Active sessions</div>' +
      sessions.map(function (s, i) {
        return '<div class="session-row"><span class="sr-label">' + UI.esc(s.label) + "</span>" +
          (s.current ? '<span class="freshline">current</span>'
            : '<button class="link" data-revoke="' + i + '" type="button">Revoke</button>') +
          "</div>";
      }).join("") +
      (Data.state.stale ? '<p class="freshline mt-8">Session feed interrupted · showing last-known sessions.</p>' : "");
  }

  function wireSessions(host) {
    if (!host) return;
    host.querySelectorAll("[data-revoke]").forEach(function (b) {
      b.addEventListener("click", function () {
        var i = +b.getAttribute("data-revoke");
        UI.stepUp("Revoking a session is a security change.", function () {
          sessions.splice(i, 1);
          repaint(host, sessionsHtml());
          wireSessions(host);
          UI.toast("Session revoked.", "done");
        });
      });
    });
  }

  // one destination for both support paths: the head action and the
  // entity-is-read-only line
  function openSupport() {
    UI.toast("Support thread opened (simulated).");
  }

  function openCodes(title) {
    var h = UI.drawer(title,
      '<div class="codes-grid">' + UI.recoveryCodes.map(function (c) {
        return "<code>" + UI.esc(c) + "</code>";
      }).join("") + "</div>" +
      '<p class="hint">Each code works once.</p>',
      {
        width: 440,
        foot: '<button class="btn btn-secondary" type="button" data-copy="' + UI.esc(UI.recoveryCodes.join(" ")) + '">Copy all</button>' +
              '<button class="btn btn-primary" id="cdDone" type="button">Done</button>'
      });
    h.el.querySelector("#cdDone").addEventListener("click", h.close);
  }

  // shaped like what lands: a narrow definition column, then the two-column
  // security block
  function skeletonHtml() {
    return '<div class="section">' +
      '<div class="settings-body">' +
        '<div>' + UI.skel("120px", "14px") + "</div>" +
        '<div class="mt-16">' + UI.skel("100%", "20px") + "</div>" +
        '<div class="mt-8">' + UI.skel("100%", "20px") + "</div>" +
        '<div class="mt-8">' + UI.skel("100%", "20px") + "</div>" +
      "</div>" +
      '<div class="settings-cols mt-32">' +
        '<div>' + UI.skel("120px", "14px") + '<div class="mt-16">' + UI.skel("100%", "34px") + "</div></div>" +
        '<div>' + UI.skel("100px", "14px") + '<div class="mt-16">' + UI.skel("100%", "20px") + "</div>" +
          '<div class="mt-8">' + UI.skel("70%", "20px") + "</div></div>" +
      "</div></div>";
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

  function renderBody(el) {
    var u = Data.state.user;
    var h = "";

    // — profile: def-rows, entity read-only with a contact-us path —
    h += '<div class="section"><div class="section-head"><h2>Profile</h2></div>' +
      '<div class="settings-body"><div class="def-group">' +
        '<div class="def-row"><span class="def-label">Name</span><span class="def-value strong">' + UI.esc(u.name) + "</span></div>" +
        '<div class="def-row"><span class="def-label">Email</span><span class="def-value">' + UI.esc(u.email) + "</span></div>" +
        '<div class="def-row"><span class="def-label">Entity</span><span class="def-value">' + UI.esc(u.entity) + "</span></div>" +
        '<div class="def-row"><span class="def-label">KYC standing</span><span class="def-value">' +
          UI.statusDot("positive", "Approved") + ' <span class="faint small">since 18 Jun 2026</span></span></div>' +
      "</div>" +
      '<p class="hint mt-8">Entity details are read-only. <button class="link" id="stEntity" type="button">Contact us to change them</button>.</p>' +
      "</div></div>";

    // — security: everything here is step-up gated. Two columns, so the
    //   right side of the page carries the sessions instead of nothing. —
    h += '<div class="section"><div class="section-head"><h2>Security</h2></div>' +
      '<div class="settings-cols">' +
      '<div class="settings-body">' +
        '<div class="def-row"><span class="def-label">Authenticator</span><span class="def-value">' +
          UI.statusDot("positive", "Enrolled") + ' <span class="faint small">since 18 Jun 2026</span></span></div>' +
        '<div class="flex mt-12 st-actions">' +
          '<button class="btn btn-secondary" id="stRotate" type="button">Rotate authenticator</button>' +
          '<button class="btn btn-secondary" id="stCodes" type="button">View recovery codes</button>' +
          '<button class="btn btn-secondary" id="stPass" type="button">Change password</button>' +
        "</div>" +
      "</div>" +
      '<div class="settings-aside" id="stSessions">' + sessionsHtml() + "</div>" +
      "</div></div>";

    // — notification preferences —
    h += '<div class="section"><div class="section-head"><h2>Notification preferences</h2></div>' +
      '<div class="settings-body">' +
        prefs.map(function (p, i) {
          return '<button class="pref-row pressable" data-pref="' + i + '" type="button">' +
            '<span class="switch' + (p.on ? " on" : "") + '"><span class="knob"></span></span>' +
            '<span class="pref-label">' + UI.esc(p.label) + "</span></button>";
        }).join("") +
      "</div></div>";

    // — agreements —
    h += '<div class="section"><div class="section-head"><h2>Agreements</h2></div>' +
      '<div class="settings-body">' +
        agreements.map(function (a, i) {
          return '<div class="session-row"><span class="sr-label">' + UI.esc(a.label) + "</span>" +
            '<button class="link" data-agree="' + i + '" type="button">Open</button></div>';
        }).join("") +
      "</div></div>";

    el.insertAdjacentHTML("beforeend", h);

    // — wiring —

    var support = el.querySelector("#stSupport"); // lives in the page head
    if (support) support.addEventListener("click", openSupport);

    el.querySelector("#stEntity").addEventListener("click", openSupport);

    el.querySelector("#stRotate").addEventListener("click", function () {
      UI.stepUp("Rotating your authenticator is a security change.", function () {
        openCodes("New authenticator enrolled · fresh recovery codes");
        UI.toast("Authenticator rotated. Your old recovery codes no longer work.", "done");
      });
    });

    el.querySelector("#stCodes").addEventListener("click", function () {
      UI.stepUp("Viewing recovery codes is a security change.", function () {
        openCodes("Recovery codes");
      });
    });

    el.querySelector("#stPass").addEventListener("click", function () {
      UI.stepUp("Changing your password is a security change.", function () {
        UI.toast("Password change started. Check your email for a one-time code.");
      });
    });

    wireSessions(el.querySelector("#stSessions"));

    // toggle in place — no re-render needed, state survives re-renders anyway
    el.querySelectorAll("[data-pref]").forEach(function (b) {
      b.addEventListener("click", function () {
        var p = prefs[+b.getAttribute("data-pref")];
        p.on = !p.on;
        b.querySelector(".switch").classList.toggle("on", p.on);
      });
    });

    el.querySelectorAll("[data-agree]").forEach(function (b) {
      b.addEventListener("click", function () {
        UI.toast("Agreement opened (simulated).");
      });
    });
  }

  App.registerScreen("settings", {
    title: "Settings",
    subtitle: "Profile, security and notification preferences",
    // the head's right slot was empty on this screen; support is the one
    // thing a client actually needs from here that isn't on the page
    actions: function () {
      return '<button class="btn btn-secondary" id="stSupport" type="button">Contact support</button>';
    },
    zone: "app",
    render: render
  });
})();
