# Static assets

Served from the site root by Vite, in dev and in a production build alike.

## kpr-logo.png

The institute mark, used by `src/components/Logo.jsx` for the header and the
sign-in page, and by `index.html` as the favicon.

Save the logo here as **`kpr-logo.png`**. A square PNG with a transparent
background works best — it is drawn at 28px in the header and 72px on sign-in,
so anything from 256x256 up is plenty.

Until the file exists, `Logo.jsx` falls back to a plain "KPR" wordmark rather
than a broken image.
