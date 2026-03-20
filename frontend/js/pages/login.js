document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('loginError');
  errEl.style.display = 'none';

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  try {
    const data = await Api.post('/api/auth/login', { username, password });
    Api.setToken(data.token);
    Api.setUser(data.user);

    if (data.user.mustChangePassword) {
      window.location.href = '/pages/change-password.html';
    } else {
      window.location.href = '/';
    }
  } catch (err) {
    errEl.textContent = err.message || 'Login failed';
    errEl.style.display = 'block';
  }
});

// Init i18n for login page
I18n.init();
