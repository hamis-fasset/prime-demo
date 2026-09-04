/* ————————————————————————————————————————————————
   Fasset Prime — Manage. The phone's fifth tab (Hamis 2026-09-04:
   "for phone we can combine Team and Settings into one").

   Six items in a tab bar is one too many, and Team and Settings are
   the same errand: the account and who may act on it. On the phone
   they become ONE place — identity, a Team row that pushes to the
   members screen, then Settings' own body inline (profile, security,
   notifications, agreements) rendered by settings.js itself, never
   copied here. On desktop the sidebar keeps both as separate items
   and this screen is unreachable; the tab bar stays lit on Manage
   while you are inside Team or Settings (app.js MOBILE_NAV owns).
   ———————————————————————————————————————————————— */
(function () {
  "use strict";

  function row(label, value, attrs) {
    return '<button class="mg-row" ' + attrs + ' type="button">' +
      '<span class="mg-label">' + UI.esc(label) + "</span>" +
      '<span class="mg-value">' + (value || "") + "</span>" +
      icon("chevronRight", 14, "chev") + "</button>";
  }

  function identityHtml() {
    var u = Data.state.user;
    return '<div class="mg-id">' + UI.identityArt(u.email || u.name, 44) +
      '<span class="mg-id-meta"><span class="mg-id-name">' + UI.esc(u.name) + "</span>" +
      '<span class="mg-id-sub">' + UI.esc(u.entity) + "</span></span></div>";
  }

  function render(el) {
    var isAdmin = Data.state.role === "admin";
    var members = Data.state.team.length;

    var h = '<div class="section">' + identityHtml();
    if (isAdmin) {
      h += '<div class="manage-list mt-16">' +
        row("Team", members + (members === 1 ? " member" : " members"), 'data-go="team"') +
        "</div>";
    }
    h += "</div>";
    el.insertAdjacentHTML("beforeend", h);

    el.querySelectorAll("[data-go]").forEach(function (b) {
      b.addEventListener("click", function () { App.go(b.getAttribute("data-go")); });
    });

    // the rest of this screen IS Settings, rendered by its own screen file so
    // the two can never drift
    var st = App.screen("settings");
    if (st && st.renderInto) st.renderInto(el);
  }

  App.registerScreen("manage", {
    title: "Manage",
    zone: "app",
    actions: function () {
      return '<button class="btn btn-secondary" id="mgSupport" type="button">Contact support</button>';
    },
    render: function (el) {
      render(el);
      var sup = el.querySelector("#mgSupport");
      if (sup) sup.addEventListener("click", function () { UI.toast("Support thread opened (simulated)."); });
    },
    onData: function (scope) { return scope === "notifs"; }
  });
})();
