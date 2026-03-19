/**
 * App shell — sidebar, theme toggle, language toggle, auth guard.
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

    // Check must_change_password
    if (user.mustChangePassword && !window.location.pathname.includes('change-password')) {
      // TODO: redirect to change-password page
    }

    await I18n.init();
    this.renderSidebar(user);
    this.initTheme();
  },

  renderSidebar(user) {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;

    const currentPath = window.location.pathname;
    const dashUrl = dashboardUrl(user.role);

    sidebar.innerHTML = `
      <div class="sidebar-header">
        <img src="/assets/portal-logo-new.svg" alt="Logo" class="sidebar-logo" />
        <span class="sidebar-title">Vector Portal</span>
      </div>
      <nav class="sidebar-nav">
        <a href="${dashUrl}" class="sidebar-link ${currentPath.includes('dashboard') ? 'active' : ''}">
          <svg class="sidebar-icon" viewBox="0 0 24 24"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" fill="currentColor"/></svg>
          <span data-i18n="nav.dashboard">Dashboard</span>
        </a>
        <a href="/pages/calendar.html" class="sidebar-link ${currentPath.includes('calendar') ? 'active' : ''}">
          <svg class="sidebar-icon" viewBox="0 0 24 24"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM9 10H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2z" fill="currentColor"/></svg>
          <span data-i18n="nav.calendar">Calendar</span>
        </a>
        <a href="/pages/library.html" class="sidebar-link ${currentPath.includes('library') ? 'active' : ''}">
          <svg class="sidebar-icon" viewBox="0 0 24 24"><path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z" fill="currentColor"/></svg>
          <span data-i18n="nav.library">Library</span>
        </a>
        ${user.role === 'ADMIN' ? `
        <a href="/pages/admin.html" class="sidebar-link ${currentPath.includes('admin') ? 'active' : ''}">
          <svg class="sidebar-icon" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="currentColor"/></svg>
          <span data-i18n="nav.admin">Admin Panel</span>
        </a>` : ''}
      </nav>
      <div class="sidebar-footer">
        <div class="sidebar-user">
          <div class="sidebar-user-avatar">${user.fullName ? user.fullName[0].toUpperCase() : 'U'}</div>
          <div class="sidebar-user-info">
            <div class="sidebar-user-name">${escapeHtml(user.fullName)}</div>
            <div class="sidebar-user-role">${roleLabel(user.role)}</div>
          </div>
        </div>
        <div class="sidebar-controls">
          <button class="sidebar-btn" id="themeToggle" title="Toggle theme">
            <svg class="sidebar-icon" viewBox="0 0 24 24"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z" fill="currentColor"/></svg>
          </button>
          <button class="sidebar-btn" id="langToggle" title="Toggle language">
            <span class="lang-label">${I18n.getLocale() === 'ka' ? 'EN' : 'KA'}</span>
          </button>
          <button class="sidebar-btn" id="logoutBtn" title="Logout">
            <svg class="sidebar-icon" viewBox="0 0 24 24"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" fill="currentColor"/></svg>
          </button>
        </div>
      </div>
    `;

    document.getElementById('themeToggle')?.addEventListener('click', () => this.toggleTheme());
    document.getElementById('langToggle')?.addEventListener('click', () => this.toggleLang());
    document.getElementById('logoutBtn')?.addEventListener('click', () => this.logout());
  },

  initTheme() {
    const saved = localStorage.getItem('theme');
    if (saved) {
      document.body.setAttribute('data-theme', saved);
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.body.setAttribute('data-theme', 'dark');
    }
  },

  toggleTheme() {
    const current = document.body.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
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
