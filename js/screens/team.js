/* ————————————————————————————————————————————————
   Fasset Prime — Team (J7, admin only). Built in wave 2.
   Ported from prime-v2.standalone.html per ARCHITECTURE.md:
   · what each role can do, stated plainly (open typography)
   · member table in the no-lines grammar (56px rows, status dots)
   · invite in a drawer with a role choice — invites carry a role,
     so sending one is step-up gated
   · role change (step-up) that visually reverts until confirmed
   · remove with arm-to-confirm + step-up
   · invited with expiry · expired with resend · joined-but-MFA-not-
     enrolled blocked from activation with a remind action
   · demo affordance: time passes, the pending invite expires
   Data API: Data.invite · changeRole · removeMember · resendInvite ·
   expireInvite. States: loading (one skeleton pass) · stale feed note ·
   permission-denied (non-admin) · every membership state seeded.

   Wave-3 (magic plan M5): each member row carries generated identity
   art instead of monogram initials, hashed from the email so the same
   person is the same square everywhere, staggered 30ms down the table.
   ———————————————————————————————————————————————— */
(function () {
  "use strict";

  var loadedOnce = false; // skeleton runs once per app load
  var ARM_MS = 4000;      // an armed Remove disarms itself, it never traps you

  var ROLE_CAPS = [
    { name: "Admin", desc: "Everything, including the whitelist and this team page." },
    { name: "Trader", desc: "Trades and moves money to existing whitelisted destinations. Can’t add or remove destinations." },
    { name: "Viewer", desc: "Sees everything, acts on nothing." }
  ];

  function daysLeft(iso) {
    return Math.max(1, 7 - Math.round((Date.now() - new Date(iso)) / 86400000));
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function memberStatus(m) {
    if (m.state === "invited") return UI.statusDot("warning", "Invited " + UI.fmtDate(m.invitedIso) + " · expires in " + daysLeft(m.invitedIso) + "d");
    if (m.state === "expired") return UI.statusDot("error", "Invite expired · they never joined");
    if (m.state === "blocked") return UI.statusDot("warning", "Joined, MFA not enrolled · activation blocked");
    return UI.statusDot("positive", "Active");
  }

  function roleCell(m) {
    if (m.you) return '<span class="small">Admin <span class="faint">· you</span></span>';
    if (m.state === "active") {
      return '<select class="select select-inline" data-role-sel="' + UI.esc(m.email) + '" aria-label="Role">' +
        ["viewer", "trader", "admin"].map(function (r) {
          return '<option value="' + r + '"' + (m.role === r ? " selected" : "") + ">" + cap(r) + "</option>";
        }).join("") + "</select>";
    }
    return '<span class="small muted">' + UI.esc(cap(m.role)) + "</span>";
  }

  function actionCell(m) {
    var a = [];
    if (m.state === "active" && !m.you) a.push('<button class="link link-danger" data-rm="' + UI.esc(m.email) + '" type="button">Remove</button>');
    if (m.state === "invited") a.push('<button class="link" data-resend="' + UI.esc(m.email) + '" type="button">Resend</button>');
    if (m.state === "expired") a.push('<button class="link" data-resend="' + UI.esc(m.email) + '" type="button">Resend invite</button>');
    if (m.state === "blocked") a.push('<button class="link" data-remind="' + UI.esc(m.email) + '" type="button">Remind to enroll MFA</button>');
    return '<span class="row-actions">' + a.join("") + "</span>";
  }

  function member(email) {
    return Data.state.team.filter(function (x) { return x.email === email; })[0];
  }

  // ————— invite drawer (one quiet step + step-up: invites carry a role) —————

  function openInvite() {
    var h = UI.drawer("Invite a teammate",
      '<div class="field"><label for="ivEmail">Work email</label>' +
      '<input id="ivEmail" class="input" placeholder="name@delos.ae" autocomplete="off">' +
      '<div class="hint err hide" id="ivErr">Enter a valid work email.</div></div>' +
      '<div class="field"><label for="ivRole">Role</label>' +
      '<select id="ivRole" class="select">' +
        '<option value="viewer">Viewer · sees everything, acts on nothing</option>' +
        '<option value="trader">Trader · trades and moves money, existing destinations only</option>' +
        '<option value="admin">Admin · everything, including team and whitelist</option>' +
      "</select>" +
      '<div class="hint">They set up their own login and MFA before they can act.</div></div>',
      {
        width: 460,
        foot: '<button class="btn btn-secondary" id="ivCancel" type="button">Cancel</button>' +
              '<button class="btn btn-primary" id="ivSend" type="button">Send invite</button>'
      });
    var email = h.el.querySelector("#ivEmail");
    email.focus();
    email.addEventListener("input", function () {
      h.el.querySelector("#ivErr").classList.add("hide");
      email.classList.remove("invalid");
    });
    h.el.querySelector("#ivCancel").addEventListener("click", h.close);
    h.el.querySelector("#ivSend").addEventListener("click", function () {
      var em = (email.value || "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) {
        email.classList.add("invalid");
        h.el.querySelector("#ivErr").classList.remove("hide");
        return;
      }
      var role = h.el.querySelector("#ivRole").value;
      UI.stepUp("This invite grants " + role + " access to the entity’s account.", function () {
        Data.invite(em, role);
        h.close();
      });
    });
  }

  // ————— render —————

  function skeletonHtml() {
    return '<div class="section">' +
      '<div>' + UI.skel("220px", "14px") + "</div>" +
      // the role-caps grid itself, so the wait is shaped like what lands
      '<div class="role-caps mt-16">' + UI.skel("100%", "44px") + UI.skel("100%", "44px") + UI.skel("100%", "44px") + "</div>" +
      '<div class="mt-32">' + UI.skel("100%", "56px") + "</div>" +
      '<div class="mt-8">' + UI.skel("100%", "56px") + "</div>" +
      '<div class="mt-8">' + UI.skel("100%", "56px") + "</div>" +
      "</div>";
  }

  function render(el) {
    // permission-denied: nav gates this screen, but render defensively
    if (Data.state.role !== "admin") {
      el.insertAdjacentHTML("beforeend", '<div class="section"><div class="empty">Team management is for admins.</div></div>');
      return;
    }
    var inviteBtn = el.querySelector("#teamInvite");
    if (inviteBtn) inviteBtn.addEventListener("click", openInvite);

    if (!loadedOnce) {
      var body = document.createElement("div");
      body.innerHTML = skeletonHtml();
      el.appendChild(body);
      setTimeout(function () {
        loadedOnce = true;
        if (document.body.contains(el)) { body.remove(); renderBody(el); }
      }, 320);
      return;
    }
    renderBody(el);
  }

  function renderBody(el) {
    var team = Data.state.team;
    var h = "";

    // — what each role can do: open typography, no boxes —
    h += '<div class="section"><div class="section-head"><h2>What each role can do</h2></div>' +
      '<div class="role-caps">' + ROLE_CAPS.map(function (r) {
        return '<div><div class="rc-name">' + UI.esc(r.name) + '</div><div class="rc-desc">' + UI.esc(r.desc) + "</div></div>";
      }).join("") + "</div></div>";

    // — members: the no-lines table —
    h += '<div class="section"><div class="section-head"><h2>Members</h2>' +
      '<span class="link">' + team.length + (team.length === 1 ? " member" : " members") + "</span></div>" +
      UI.table({
        // not chronological, so no day groups. Every column after Member is
        // content-width and adjacent: Status used to be a 1.3fr track, which
        // both spread the cluster and let "activation blocked" collide with
        // the MFA column. Member takes the remainder and shrinks first.
        cols: [
          { label: "Member", w: "minmax(0, 1fr)" },
          { label: "Role", w: "112px" },
          { label: "Status", w: "295px" },
          { label: "MFA", w: "100px" },
          { label: "Last active", w: "85px" },
          { label: "", w: "165px", right: true }
        ],
        // the identity square is seeded off the email, so the same person is
        // the same square everywhere, and staggered 30ms down the table
        rows: team.map(function (m, i) {
          return {
            key: m.email,
            cells: [
              '<span class="cell-main">' + UI.identityArt(m.email, 20, i * 30) +
                '<span class="cell-stack"><span class="name">' + UI.esc(m.name === "—" ? m.email : m.name) + "</span>" +
                '<span class="desc">' + UI.esc(m.name === "—" ? "invited as " + m.role : m.email) + "</span></span></span>",
              roleCell(m),
              memberStatus(m),
              m.mfa ? UI.statusDot("positive", "Enrolled") : UI.statusDot("neutral", "Not enrolled"),
              '<span class="date">' + UI.esc(m.last) + "</span>",
              actionCell(m)
            ]
          };
        }),
        empty: "No members yet."
      }) +
      (Data.state.stale ? '<p class="freshline mt-8">Presence feed interrupted · last-known values, re-syncing automatically.</p>' : "") +
      "</div>";

    // — demo affordance: simulated time passing (contract §11) —
    h += '<div class="section"><div class="demo-strip">' +
      '<span class="freshline">Demo · membership states. Role preview lives in the demo bar.</span>' +
      '<button class="db-btn" id="tmExpire" type="button">Time passes: the pending invite expires</button>' +
      "</div></div>";

    el.insertAdjacentHTML("beforeend", h);

    // — wiring —

    // role change: the select visually reverts until the step-up confirms
    el.querySelectorAll("[data-role-sel]").forEach(function (sel) {
      sel.addEventListener("change", function () {
        var m = member(sel.getAttribute("data-role-sel"));
        if (!m) return;
        var newRole = sel.value;
        sel.value = m.role; // revert; only a confirmed step-up changes it
        UI.stepUp("Changing a role changes what " + m.name + " can do with the entity’s money.", function () {
          Data.changeRole(m.email, newRole);
        });
      });
    });

    // remove: arm on first click, step-up on the second. The armed state
    // is visible (underlined, medium), says what the second click does, and
    // disarms itself after 4s. An armed destructive control that looks
    // identical to a resting one is a trap.
    el.querySelectorAll("[data-rm]").forEach(function (b) {
      var timer = null;
      function disarm() {
        clearTimeout(timer);
        timer = null;
        b.classList.remove("armed");
        b.textContent = "Remove";
      }
      b.addEventListener("click", function () {
        var email = b.getAttribute("data-rm");
        if (!b.classList.contains("armed")) {
          b.classList.add("armed");
          b.textContent = "Click again to confirm";
          timer = setTimeout(disarm, ARM_MS);
          return;
        }
        disarm();
        UI.stepUp("Removing a member revokes their access to the entity’s money. Their sessions end immediately.", function () {
          Data.removeMember(email);
        });
      });
    });

    el.querySelectorAll("[data-resend]").forEach(function (b) {
      b.addEventListener("click", function () {
        var email = b.getAttribute("data-resend");
        Data.resendInvite(email);
        UI.toast("Invite re-sent to " + email + ".", "done");
      });
    });

    el.querySelectorAll("[data-remind]").forEach(function (b) {
      b.addEventListener("click", function () {
        UI.toast("Reminder sent.", "done");
      });
    });

    var expire = el.querySelector("#tmExpire");
    if (expire) expire.addEventListener("click", function () {
      var m = Data.expireInvite();
      if (!m) UI.toast("No pending invite to expire.", "blocked");
      else UI.toast("The invite to " + m.email + " expired.");
    });
  }

  App.registerScreen("team", {
    title: "Team",
    subtitle: "Who can see and move the entity’s money",
    actions: function () {
      if (Data.state.role !== "admin") return "";
      return '<button class="btn btn-primary" id="teamInvite" type="button">Invite teammate</button>';
    },
    zone: "app",
    render: render
  });
})();
