/**
 * Fetch wrapper with JWT authentication.
 */
const Api = {
  getToken() {
    return localStorage.getItem('token');
  },

  setToken(token) {
    localStorage.setItem('token', token);
  },

  clearToken() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  },

  getUser() {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  },

  setUser(user) {
    localStorage.setItem('user', JSON.stringify(user));
  },

  async request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = this.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const opts = { method, headers };
    if (body && method !== 'GET') {
      opts.body = JSON.stringify(body);
    }

    let res;
    try {
      res = await fetch(`${API_BASE}${path}`, opts);
    } catch (err) {
      throw new Error('Network request failed. Check your connection and try again.');
    }

    if (res.status === 401) {
      this.clearToken();
      window.location.href = '/login.html';
      throw new Error('Unauthorized');
    }

    const contentType = res.headers.get('content-type') || '';
    let data = null;
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      const text = await res.text();
      data = text ? { error: text } : {};
    }
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },

  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  put(path, body) { return this.request('PUT', path, body); },
  patch(path, body) { return this.request('PATCH', path, body); },
  delete(path) { return this.request('DELETE', path); },
};

async function readDownloadError(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await response.json().catch(() => null);
    return data && data.error ? data.error : 'Download failed';
  }

  const text = await response.text().catch(() => '');
  return text || 'Download failed';
}

function notifyDownloadError(message) {
  if (typeof toast !== 'undefined' && toast && typeof toast.error === 'function') {
    toast.error(message);
    return;
  }
  console.error(message);
}

function downloadFileAuth(fileId, fileName) {
  fetch('/api/workflow/files/download?id=' + encodeURIComponent(fileId), {
    headers: { 'Authorization': 'Bearer ' + Api.getToken() },
  })
    .then(r => {
      if (!r.ok) return readDownloadError(r).then(message => { throw new Error(message); });
      return r.blob();
    })
    .then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    })
    .catch(err => notifyDownloadError(err.message));
}
