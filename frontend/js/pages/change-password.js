const user = Api.getUser();
if (!user || !Api.getToken()) {
  window.location.href = '/login.html';
}

document.getElementById('changePwBtn').addEventListener('click', async () => {
  const currentPassword = document.getElementById('currentPw').value;
  const newPassword = document.getElementById('newPw').value;
  const confirmPassword = document.getElementById('confirmPw').value;
  const errorEl = document.getElementById('errorMsg');
  const successEl = document.getElementById('successMsg');

  errorEl.style.display = 'none';
  successEl.style.display = 'none';

  if (!currentPassword || !newPassword) {
    errorEl.textContent = 'All fields are required';
    errorEl.style.display = '';
    return;
  }
  if (newPassword.length < 8) {
    errorEl.textContent = 'New password must be at least 8 characters';
    errorEl.style.display = '';
    return;
  }
  if (newPassword !== confirmPassword) {
    errorEl.textContent = 'Passwords do not match';
    errorEl.style.display = '';
    return;
  }

  try {
    await Api.post('/api/auth/change-password', { currentPassword, newPassword });
    const u = Api.getUser();
    u.mustChangePassword = false;
    Api.setUser(u);
    successEl.textContent = 'Password changed. Redirecting...';
    successEl.style.display = '';
    setTimeout(() => {
      window.location.href = '/';
    }, 1500);
  } catch (e) {
    errorEl.textContent = e.message;
    errorEl.style.display = '';
  }
});
