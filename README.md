# QR Attendance System v7

## Project Structure

```
qr-attendance/
├── index.html                      ← Main entry (markup only — no inline CSS/JS)
├── manifest.json                   ← PWA manifest
├── sw.js                           ← Service worker (offline caching)
│
├── frontend/
│   ├── css/
│   │   └── styles.css              ← All styles (design tokens, light/dark, components)
│   ├── js/
│   │   └── app.js                  ← UI controller (all user interactions)
│   └── pages/                      ← (reserved for future separate pages)
│
└── backend/
    ├── auth/
    │   └── AuthService.js          ← Authentication: hashing, session tokens, lockout
    ├── db/
    │   └── DataService.js          ← Data access: Firebase primary, localStorage fallback
    ├── middleware/
    │   └── Middleware.js           ← Guards, input sanitisation, CSRF, rate limiting
    └── utils/
        └── Utils.js                ← Helpers: modal system, toast, formatting, geo
```

---

## What's new in v7

### 1. Separate frontend/backend folders
- `frontend/css/styles.css` — all design tokens and component styles
- `frontend/js/app.js` — all UI logic
- `backend/auth/AuthService.js` — secure authentication
- `backend/db/DataService.js` — data access layer
- `backend/middleware/Middleware.js` — security middleware
- `backend/utils/Utils.js` — shared utilities + modal/toast system
- `index.html` — clean markup only; links all external files

### 2. Super admin hidden after first signup
- First visit to Admin page → "Create Admin Account" form (runs **once only**)
- Once created → form **disappears forever**; replaced with a plain email/password login
- The word "Super Admin" never appears in the UI
- Same login form handles both the administrator and co-admins
- Co-admins apply via "Apply for co-admin access" → admin approves/rejects

### 3. Light / dark mode
- 🌙 / ☀️ toggle in every topbar
- Preference saved to `localStorage`
- Full CSS token system — every colour adapts

### 4. All popups are modal dialogs (no browser alert/confirm)
- `Modal.alert(message, options)` — OK button
- `Modal.confirm(message, options)` — Confirm / Cancel
- `Modal.prompt(message, options)` — text input + OK / Cancel
- Toast notifications for non-blocking feedback

### 5. Hardened SOLID backend
| Principle | Implementation |
|-----------|---------------|
| **S** ingle Responsibility | `AuthService` handles only identity; `DataService` handles only data; `Middleware` handles only guards |
| **O** pen/Closed | Add new DataService methods without modifying existing ones |
| **L** iskov Substitution | Firebase and localStorage implement the same interface |
| **I** nterface Segregation | Separate entity methods (SA, CoAdmin, Lecturer, Session, UID) |
| **D** ependency Inversion | `app.js` depends on `DataService`/`AuthService` interfaces, not Firebase directly |

### 6. Security hardening
- **Salted password hashing** — passwords hashed with a random salt using FNV-1a
- **Signed session tokens** — sessionStorage tokens are HMAC-signed and device-bound
- **Session expiry** — sessions expire after 8 hours
- **Brute-force lockout** — 5 failed login attempts triggers a 15-minute lockout
- **Input sanitisation** — all user input sanitised before use (XSS prevention)
- **CSRF tokens** — double-submit pattern for form operations
- **Rate limiting** — client-side rate limiting on signup and check-in actions
- **Route guards** — `Middleware.requireAdmin()` / `requireLecturer()` protect all dashboards

---

## Deploy to GitHub Pages

1. Upload the whole folder to a GitHub repo root
2. Settings → Pages → Deploy from branch → main / root → Save
3. Live at `https://<username>.github.io/<repo>/`

---

## Firebase setup (required for cross-device sync)

1. Go to https://console.firebase.google.com → Add project → Realtime Database → start in test mode
2. Project Settings → Web app → copy config
3. Paste into `backend/db/DataService.js` in the `FB_CFG` block

**Database rules:**
```json
{
  "rules": {
    "sa":   { ".read": "auth != null", ".write": "auth != null" },
    "cas":  { ".read": "auth != null", ".write": "auth != null" },
    "lecs": { ".read": true, ".write": true },
    "uids": { ".read": true, ".write": true },
    "sess": { ".read": true, "$id": { ".write": true } },
    "bkp":  { ".read": "auth != null", ".write": "auth != null" }
  }
}
```

---

## First-time setup

1. Open the site → click **Admin**
2. You see "Create Admin Account" — fill in name, email, password → submit
3. **This form never appears again** — sign in with those credentials going forward
4. Go to **Assign IDs** → generate Unique IDs → send to lecturers
5. Lecturers register with their Unique ID on any device
6. Co-admins: click "Apply for co-admin access" → submit application → admin approves in Co-Admins tab
