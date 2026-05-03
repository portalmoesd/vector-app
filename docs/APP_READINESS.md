# App readiness

Vector Portal is currently delivered as a browser application backed by JSON API routes. The codebase is organized so a future mobile or desktop app can reuse the backend instead of rebuilding workflow logic.

## Current shape

- The Node.js API owns authentication, authorization, workflow state, files, comments, templates, library access, and statistics endpoints.
- The browser frontend is static HTML, CSS, and JavaScript served by the same Node process by default.
- Frontend API calls use the shared `API_BASE` value from `frontend/js/core/config.js`.
- The default `API_BASE` is the current browser origin, so the standard deployment works without extra frontend configuration.

## Separate frontend or app shell

If the frontend is hosted separately from the API, define `window.VECTOR_PORTAL_CONFIG.apiBase` before loading the app scripts:

```html
<script>
  window.VECTOR_PORTAL_CONFIG = {
    apiBase: 'https://api.example.gov.ge'
  };
</script>
```

The configured value may include a trailing slash; the frontend normalizes it before making requests.

## Future native app notes

- Reuse the API authentication flow first, then replace it with the buyer's single sign-on only if required.
- Keep file upload/download API behavior stable so native clients can share the same workflow storage.
- Add push notifications as a separate capability; the current event notification flow intentionally opens a local email draft only.
- Avoid offline editing until conflict handling is designed for section content, comments, and workflow state.
