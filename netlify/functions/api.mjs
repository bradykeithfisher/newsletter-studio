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
