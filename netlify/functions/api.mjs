// FBSS Newsletter Studio API
// Stores the shared draft and image list in Netlify Blobs, checks the staff
// password, and signs Cloudinary uploads so no one has to enter Cloudinary details.
//
// Environment variables (Netlify: Project configuration > Environment variables):
//   STUDIO_PASSWORD        shared staff password
//   CLOUDINARY_CLOUD_NAME  from the Cloudinary dashboard
//   CLOUDINARY_API_KEY     from Cloudinary: Settings > API Keys
//   CLOUDINARY_API_SECRET  from Cloudinary: Settings > API Keys
//   CLOUDINARY_FOLDER      optional, defaults to "newsletter"

import { getStore } from "@netlify/blobs";
import { createHash, timingSafeEqual } from "node:crypto";

const env = (k) => (globalThis.Netlify?.env?.get?.(k) ?? process.env[k] ?? "").trim();
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

function passwordOk(req) {
  const want = env("STUDIO_PASSWORD");
  const got = req.headers.get("x-studio-key") || "";
  if (!want) return false;
  const a = Buffer.from(want), b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function cloudinarySignature(params, secret) {
  const toSign = Object.keys(params).sort().filter((k) => params[k] !== "" && params[k] != null)
    .map((k) => k + "=" + params[k]).join("&");
  return createHash("sha1").update(toSign + secret).digest("hex");
}

/* ---------- Link preview (blog posts) ---------- */
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—" };
export function decode(t) {
  return String(t || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}
export function plain(html) {
  return decode(String(html || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim()
    .replace(/\s*(\[(…|\.\.\.)\]|Continue reading.*|Read more.*)$/i, "").trim();
}
function meta(html, names) {
  for (const n of names) {
    const re1 = new RegExp('<meta[^>]+(?:property|name)=["\']' + n + '["\'][^>]*content=["\']([^"\']*)["\']', "i");
    const re2 = new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']' + n + '["\']', "i");
    const m = html.match(re1) || html.match(re2);
    if (m && m[1].trim()) return decode(m[1].trim());
  }
  return "";
}
export function parsePage(html) {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const site = meta(html, ["og:site_name"]);
  let title = meta(html, ["og:title", "twitter:title"]) || (t ? plain(t[1]) : "");
  if (site) title = title.replace(new RegExp("\\s*[-–—|·:]\\s*" + site.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$"), "").trim() || title;
  return {
    title,
    excerpt: meta(html, ["og:description", "twitter:description", "description"]),
    image: meta(html, ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"]),
  };
}
async function getWithTimeout(url, ms = 8000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (compatible; FBSS-Newsletter-Studio/1.0)", accept: "text/html,application/json;q=0.9,*/*;q=0.8" } }); }
  finally { clearTimeout(t); }
}
export async function preview(link, get = getWithTimeout) {
  let u; try { u = new URL(link); } catch (e) { return { status: 400, body: { error: "That doesn't look like a full web address." } }; }
  if (!/^https?:$/.test(u.protocol)) return { status: 400, body: { error: "That doesn't look like a full web address." } };
  let out = { title: "", excerpt: "", image: "" };
  // 1) WordPress REST API, if the site has it
  try {
    const slug = u.pathname.split("/").filter(Boolean).pop() || "";
    if (slug) {
      const r = await get(u.origin + "/wp-json/wp/v2/posts?_embed=wp:featuredmedia&slug=" + encodeURIComponent(slug));
      if (r.ok && /json/.test(r.headers.get("content-type") || "")) {
        const arr = await r.json(), post = Array.isArray(arr) && arr[0];
        if (post) {
          const m = post._embedded?.["wp:featuredmedia"]?.[0];
          out = {
            title: plain(post.title?.rendered),
            excerpt: plain(post.excerpt?.rendered),
            image: m?.media_details?.sizes?.large?.source_url || m?.source_url || post.jetpack_featured_media_url || "",
          };
        }
      }
    }
  } catch (e) {}
  // 2) The page's own share tags (works for most websites)
  let pageStatus = 0;
  if (!out.title || !out.image || !out.excerpt) {
    try {
      const r = await get(link); pageStatus = r.status;
      if (r.ok) {
        const html = (await r.text()).slice(0, 600000);
        const pg = parsePage(html);
        out = { title: out.title || pg.title, excerpt: out.excerpt || pg.excerpt, image: out.image || pg.image };
        if (out.image && !/^https?:/i.test(out.image)) { try { out.image = new URL(out.image, link).href; } catch (e) {} }
      }
    } catch (e) {}
  }
  if (!out.title && !out.image) {
    return { status: 404, body: { error: pageStatus === 404 ? "That page wasn't found. Check that the post is published and the link is right." : "Couldn't read that page. Check the link, or fill in the title and upload the image yourself." } };
  }
  return { status: 200, body: out };
}

export async function handle(req, store) {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");

  if (route === "ping") {
    return json({ ok: true, passwordSet: !!env("STUDIO_PASSWORD"), cloudinary: !!(env("CLOUDINARY_CLOUD_NAME") && env("CLOUDINARY_API_KEY") && env("CLOUDINARY_API_SECRET")), cloudName: env("CLOUDINARY_CLOUD_NAME") || null });
  }
  if (!env("STUDIO_PASSWORD")) return json({ error: "The studio password hasn't been set up yet. Add STUDIO_PASSWORD in Netlify's environment variables, then redeploy." }, 503);
  if (!passwordOk(req)) return json({ error: "That password isn't right." }, 401);

  if (route === "state" && req.method === "GET") {
    const doc = (await store.get("draft", { type: "json" })) || { draft: null, version: 0, savedAt: null, savedBy: null };
    const images = (await store.get("images", { type: "json" })) || [];
    return json({ ...doc, images });
  }

  if (route === "draft" && req.method === "PUT") {
    let body; try { body = await req.json(); } catch (e) { return json({ error: "Bad request." }, 400); }
    const cur = (await store.get("draft", { type: "json" })) || { draft: null, version: 0 };
    if (!body.force && Number(body.baseVersion) !== Number(cur.version)) return json({ conflict: true, ...cur }, 409);
    const next = { draft: body.draft, version: Number(cur.version || 0) + 1, savedAt: new Date().toISOString(), savedBy: String(body.by || "").slice(0, 60) };
    await store.setJSON("draft", next);
    return json({ version: next.version, savedAt: next.savedAt });
  }

  if (route === "images" && req.method === "POST") {
    let body; try { body = await req.json(); } catch (e) { return json({ error: "Bad request." }, 400); }
    const list = (await store.get("images", { type: "json" })) || [];
    if (body && body.url) list.unshift({ name: String(body.name || "image").slice(0, 200), url: body.url, thumb: body.thumb || "", width: body.width || null, height: body.height || null, at: Date.now() });
    const trimmed = list.slice(0, 300);
    await store.setJSON("images", trimmed);
    return json({ images: trimmed });
  }
  if (route === "images" && req.method === "DELETE") {
    await store.setJSON("images", []);
    return json({ images: [] });
  }

  if (route === "preview" && req.method === "GET") {
    const r = await preview(url.searchParams.get("url") || "");
    return json(r.body, r.status);
  }

  if (route === "sign" && req.method === "POST") {
    const cloudName = env("CLOUDINARY_CLOUD_NAME"), apiKey = env("CLOUDINARY_API_KEY"), secret = env("CLOUDINARY_API_SECRET");
    if (!cloudName || !apiKey || !secret) return json({ error: "Cloudinary isn't connected yet. Add the Cloudinary environment variables in Netlify, then redeploy." }, 503);
    const params = { folder: env("CLOUDINARY_FOLDER") || "newsletter", timestamp: Math.floor(Date.now() / 1000) };
    return json({ cloudName, apiKey, ...params, signature: cloudinarySignature(params, secret) });
  }

  return json({ error: "Not found." }, 404);
}

export default async (req) => handle(req, getStore({ name: "newsletter-studio", consistency: "strong" }));

export const config = { path: "/api/*" };
