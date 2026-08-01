# Solitaire Finz Mart — Website Bundle

## Files in this bundle
```
index.html            ← YOUR MAIN APP (add this — see "Adding your main app" below)
technical.html         ← Technical Evaluation Report (nav added, ready to deploy)
legal.html              ← Privacy Policy & Terms (drafted, ready to deploy)
js/supabase-config.js   ← Shared Supabase client (URL + publishable key already set)
README.md
```

## 1. Adding your main app
This bundle does not yet contain your main app file. To finish the setup:

1. Save your main app's HTML as `index.html` in this folder (replacing any placeholder).
2. Paste this nav snippet into its topbar/header, right after your brand block, so it links to the other two pages:
```html
<nav style="display:flex;gap:6px;overflow-x:auto;padding-top:10px;">
    <a href="index.html" style="flex:0 0 auto;padding:6px 13px;border-radius:100px;border:1px solid var(--gold);background:var(--panel);font-size:11.5px;color:var(--gold);text-decoration:none;white-space:nowrap;">Home</a>
    <a href="technical.html" style="flex:0 0 auto;padding:6px 13px;border-radius:100px;border:1px solid var(--border);background:var(--panel);font-size:11.5px;color:var(--ink-dim);text-decoration:none;white-space:nowrap;">Technical Evaluation</a>
    <a href="legal.html" style="flex:0 0 auto;padding:6px 13px;border-radius:100px;border:1px solid var(--border);background:var(--panel);font-size:11.5px;color:var(--ink-dim);text-decoration:none;white-space:nowrap;">Legal</a>
</nav>
```
   (If your app doesn't use the `--gold` / `--panel` / `--ink-dim` CSS variables, swap in your own colors — any link works.)

3. If your main app already has its own Supabase client set up inline, you don't need `js/supabase-config.js` at all — it's only here in case you want one shared config file instead of hardcoding keys in multiple places.

`technical.html` and `legal.html` are **static — no backend calls, no Supabase needed on those pages.** Only your main app talks to Supabase.

## 2. Supabase (already configured)
- Project URL: `https://nbpvamrwzqrgoiwpadwc.supabase.co`
- Publishable key: `sb_publishable_GrJ_9z_y903WFMGjoAg82Q_cG3N2_Jx`

These are already in `js/supabase-config.js`. If your main app's `index.html` already has its own `<script>` block with these values hardcoded, that's fine — leave it as is.

⚠️ The publishable/anon key is safe to expose in frontend code (that's what it's for), **provided your Supabase Row Level Security (RLS) policies are correctly configured** on every table. If you haven't set up RLS policies yet, do that before going live — otherwise anyone with this key can read/write your tables directly.

## 3. Deploying to GitHub

### Option A — GitHub Pages (simplest, free, no server needed)
```bash
git init
git add .
git commit -m "Initial deploy: main app + legal + technical pages"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```
Then in your GitHub repo:
1. Go to **Settings → Pages**
2. Source: **Deploy from a branch** → Branch: `main` → folder: `/ (root)`
3. Save. Your site will be live at `https://<your-username>.github.io/<your-repo>/`

Your pages will be reachable at:
- `https://<your-username>.github.io/<your-repo>/` (index.html)
- `https://<your-username>.github.io/<your-repo>/technical.html`
- `https://<your-username>.github.io/<your-repo>/legal.html`

### Option B — Push to GitHub, host elsewhere (Netlify/Vercel/Wix)
Same `git push` as above, then connect the repo in Netlify/Vercel dashboard (auto-detects static HTML, no build step needed since there's no framework/bundler here).

## 4. Before going live — checklist
- [ ] Add your real `index.html` (main app) to this folder
- [ ] Confirm RLS policies are set on all Supabase tables
- [ ] Update the "Last updated" date in `legal.html` if you edit the legal text
- [ ] Update contact details in `legal.html` (WhatsApp/phone/email) if needed
- [ ] Test all three nav links (Home / Technical Evaluation / Legal) after deploy
