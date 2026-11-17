# FBSS Newsletter Studio

Builds the First Baptist Sulphur Springs weekly email. Everyone on staff shares one draft,
and image uploads go to the church's Cloudinary account.

## Files
- `public/index.html` – the studio page
- `netlify/functions/api.mjs` – saves the shared draft, signs Cloudinary uploads, and accepts items from the Communication Calendar
- `package.json`, `netlify.toml` – tell Netlify how to run it

## Netlify environment variables
| Name | Value |
|---|---|
| STUDIO_PASSWORD | the staff password |
| CLOUDINARY_CLOUD_NAME | Cloudinary dashboard |
| CLOUDINARY_API_KEY | Cloudinary → Settings → API Keys |
| CLOUDINARY_API_SECRET | Cloudinary → Settings → API Keys (mark as secret) |
| CLOUDINARY_FOLDER | optional, defaults to `newsletter` |
| IMPORT_KEY | a long random password shared with the Communication Calendar (its `NEWSLETTER_IMPORT_KEY`). Mark as secret. |

After changing a variable, redeploy (Deploys → Trigger deploy).

## Items from the Communication Calendar
Every hour (or when someone clicks **Send to newsletter now** in the calendar), the FBSS Communication Calendar sends
each Weekly Update email destination going out in the next week. Each one becomes an announcement section tagged
**From the calendar**: the subject line becomes the title, the event date, time and place become the small line above it,
and the copy, first photo and campaign link are added.

- New items fill blank announcement sections first (the ones left after **New week**), then go at the end.
- Sections nobody has edited stay in step with the calendar, and drop off when the item leaves the week.
- Once anyone edits a section here, the calendar never changes or removes it.
