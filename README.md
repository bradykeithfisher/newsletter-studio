# FBSS Newsletter Studio

Builds the First Baptist Sulphur Springs weekly email. Everyone on staff shares one draft,
and image uploads go to the church's Cloudinary account.

## Files
- `public/index.html` – the studio page
- `netlify/functions/api.mjs` – saves the shared draft and signs Cloudinary uploads
- `package.json`, `netlify.toml` – tell Netlify how to run it

## Netlify environment variables
| Name | Value |
|---|---|
| STUDIO_PASSWORD | the staff password |
| CLOUDINARY_CLOUD_NAME | Cloudinary dashboard |
| CLOUDINARY_API_KEY | Cloudinary → Settings → API Keys |
| CLOUDINARY_API_SECRET | Cloudinary → Settings → API Keys (mark as secret) |
| CLOUDINARY_FOLDER | optional, defaults to `newsletter` |

After changing a variable, redeploy (Deploys → Trigger deploy).
