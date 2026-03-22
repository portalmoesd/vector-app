/**
 * App shell — sidebar, language toggle, auth guard.
 */
const App = {
  async init() {
    // Auth guard
    const token = Api.getToken();
    const user = Api.getUser();
    if (!token || !user) {
      window.location.href = '/login.html';
      return;
    }

    // Check must_change_password — force redirect
    if (user.mustChangePassword && !window.location.pathname.includes('change-password')) {
      window.location.href = '/pages/change-password.html';
      return;
    }

    await I18n.init();
    this.renderSidebar(user);
  },

  renderSidebar(user) {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;

    document.body.classList.add('gp-shell-ready');
    sidebar.classList.add('gp-sidebar');

    const currentPath = window.location.pathname;
    const dashUrl = dashboardUrl(user.role);
    const displayName = user.fullName || user.username || 'User';
    const initials = displayName.trim().split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase() || '').join('') || 'U';

    const ICO = {
      menu: '<svg viewBox="0 0 24 24"><path d="M4 7a1 1 0 0 1 1-1h14a1 1 0 1 1 0 2H5A1 1 0 0 1 4 7Zm0 5a1 1 0 0 1 1-1h14a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1Zm1 4a1 1 0 1 0 0 2h14a1 1 0 1 0 0-2H5Z"/></svg>',
      close: '<svg viewBox="0 0 24 24"><path d="M6.7 5.3a1 1 0 0 0-1.4 1.4L10.6 12l-5.3 5.3a1 1 0 0 0 1.4 1.4l5.3-5.3 5.3 5.3a1 1 0 0 0 1.4-1.4L13.4 12l5.3-5.3a1 1 0 0 0-1.4-1.4L12 10.6 6.7 5.3Z"/></svg>',
      dashboard: '<svg viewBox="0 0 24 24"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>',
      calendar: '<svg viewBox="0 0 24 24"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM9 10H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2z"/></svg>',
      library: '<svg viewBox="0 0 24 24"><path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/></svg>',
      admin: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>',
      logout: '<svg viewBox="0 0 24 24"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>',
    };

    function navIcon(label) {
      const l = (label || '').toLowerCase();
      if (l.includes('calendar')) return ICO.calendar;
      if (l.includes('library')) return ICO.library;
      if (l.includes('admin')) return ICO.admin;
      return ICO.dashboard;
    }

    const navItems = [
      { href: dashUrl, label: 'Dashboard', i18n: 'nav.dashboard', match: 'dashboard' },
      { href: '/pages/calendar.html', label: 'Calendar', i18n: 'nav.calendar', match: 'calendar' },
      { href: '/pages/library.html', label: 'Library', i18n: 'nav.library', match: 'library' },
    ];
    if (user.role === 'ADMIN') {
      navItems.push({ href: '/pages/admin.html', label: 'Admin Panel', i18n: 'nav.admin', match: 'admin' });
    }

    const navHtml = navItems.map(it => {
      const active = currentPath.includes(it.match) ? ' active' : '';
      return `<a href="${it.href}" class="gp-nav__link${active}"><span class="gp-nav__icon">${navIcon(it.label)}</span><span class="gp-nav__label" data-i18n="${it.i18n}">${escapeHtml(it.label)}</span></a>`;
    }).join('');

    sidebar.innerHTML = `
      <button class="gp-mobile-toggle" type="button" aria-label="Open menu">
        <span class="gp-mobile-toggle__icon">${ICO.menu}</span>
      </button>
      <div class="gp-sidebar__scrim"></div>
      <div class="gp-sidebar__panel">
        <div class="gp-sidebar__top">
          <div class="gp-brand">
            <div class="gp-brand__mark gp-brand__mark--logo">
              <img src="/assets/portal-logo-new.svg" alt="Vector" class="gp-brand__logo-img" />
            </div>
            <div class="gp-brand__text">
              <div class="gp-brand__title"><span class="gp-brand__title-main">Vector</span><span class="gp-brand__title-sub">by MOESD</span></div>
            </div>
          </div>
          <button class="gp-mobile-close" type="button" aria-label="Close menu">${ICO.close}</button>
        </div>

        <div class="gp-profile gp-profile--top">
          <div class="gp-profile__avatar">${escapeHtml(initials)}</div>
          <div class="gp-profile__text">
            <div class="gp-profile__name">${escapeHtml(displayName)}</div>
            <div class="gp-profile__role">${escapeHtml(roleLabel(user.role))}</div>
          </div>
        </div>

        <nav class="gp-nav">${navHtml}</nav>

        <div class="gp-sidebar__spacer"></div>

        <div class="gp-sidebar__footer">
          <button class="gp-nav__link" id="langToggle" type="button">
            <span class="gp-nav__icon"><span class="lang-label" style="font-size:12px;font-weight:700;letter-spacing:.5px">${I18n.getLocale() === 'ka' ? 'EN' : 'KA'}</span></span>
            <span class="gp-nav__label">Language</span>
          </button>
          <button class="gp-logout" id="logoutBtn" type="button">
            <span class="gp-nav__icon">${ICO.logout}</span>
            <span class="gp-nav__label">Logout</span>
          </button>
        </div>
      </div>
    `;

    // ── Expand / collapse (desktop hover) ──────────────────────────────────
    const body = document.body;
    const isDesktop = () => window.innerWidth > 980;
    const expand = () => body.classList.add('gp-sidebar-expanded');
    const collapse = () => body.classList.remove('gp-sidebar-expanded');
    const openMenu = () => body.classList.add('gp-menu-open');
    const closeMenu = () => body.classList.remove('gp-menu-open');

    sidebar.addEventListener('mouseenter', () => { if (isDesktop()) expand(); });
    sidebar.addEventListener('mouseleave', () => { if (isDesktop()) collapse(); });
    sidebar.addEventListener('focusin', () => { if (isDesktop()) expand(); });
    sidebar.addEventListener('focusout', (e) => { if (isDesktop() && !sidebar.contains(e.relatedTarget)) collapse(); });

    // ── Mobile toggle ──────────────────────────────────────────────────────
    sidebar.querySelector('.gp-mobile-toggle')?.addEventListener('click', () => { collapse(); openMenu(); });
    sidebar.querySelector('.gp-mobile-close')?.addEventListener('click', closeMenu);
    sidebar.querySelector('.gp-sidebar__scrim')?.addEventListener('click', closeMenu);
    sidebar.querySelectorAll('.gp-nav__link').forEach(link => link.addEventListener('click', () => { if (!isDesktop()) closeMenu(); }));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
    window.addEventListener('resize', () => { if (isDesktop()) closeMenu(); else collapse(); });

    // ── Language & logout ──────────────────────────────────────────────────
    document.getElementById('langToggle')?.addEventListener('click', () => this.toggleLang());
    document.getElementById('logoutBtn')?.addEventListener('click', () => this.logout());
  },

  async toggleLang() {
    const next = I18n.getLocale() === 'ka' ? 'en' : 'ka';
    await I18n.setLocale(next);
    const btn = document.getElementById('langToggle');
    if (btn) btn.querySelector('.lang-label').textContent = next === 'ka' ? 'EN' : 'KA';
  },

  logout() {
    Api.clearToken();
    window.location.href = '/login.html';
  },
};
