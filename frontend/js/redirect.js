(function () {
  'use strict';
  var token = localStorage.getItem('token');
  var user = localStorage.getItem('user');
  if (!token || !user) {
    window.location.href = '/login.html';
    return;
  }
  var u = JSON.parse(user);
  var map = {
    COLLABORATOR: '/pages/dashboard-collab.html',
    SUPER_COLLABORATOR: '/pages/dashboard-super-collab.html',
    SUPERVISOR: '/pages/dashboard-supervisor.html',
    DEPUTY: '/pages/dashboard-deputy.html',
    ADMIN: '/pages/admin.html',
    PROTOCOL: '/pages/calendar.html',
    ANALYST: '/pages/statistics.html',
  };
  window.location.href = map[u.role] || '/pages/dashboard-collab.html';
})();
