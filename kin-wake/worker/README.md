# KIN Wake — One-time Cloudflare setup

This is a **staged migration**. Keep the existing GitHub Pages site on main unchanged until the new Cloudflare Worker is deployed and tested. It does NOT change the KIN / ShiroGin runtime repository.

## Why
The existing GitHub Pages client stores MacroDroid Webhook URL and PIN in browser-local storage. Browser-local storage cannot be shared across devices. Never commit the webhook to this public repository.

## One-time owner setup
1. Sign in to the Cloudflare account owning shirokinstudio.com. Install Node.js if necessary for Wrangler.
2. In this directory run `npx wrangler login`, then `npx wrangler deploy`. Check that the custom domain `wake-api.shirokinstudio.com` is active. If this name is occupied, choose another subdomain in wrangler.toml and change the API constant in ../index.html.
3. Set the following THREE encrypted Worker Secrets (not plaintext variables), one by one:
   - `npx wrangler secret put KIN_WAKE_WEBHOOK` — paste the full *private* MacroDroid trigger URL; never put it in GitHub.
   - `npx wrangler secret put KIN_WAKE_PIN` — choose a shared, strong owner PIN/passphrase (prefer 10+ unpredictable characters). You may choose the old PIN if strong; browser PIN data does not auto-transfer.
   - `npx wrangler secret put KIN_WAKE_SESSION_KEY` — use a random 32+ byte string; generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
4. Verify Worker: `https://wake-api.shirokinstudio.com/api/health` responds with service state. Test the login, invalid PIN rate limit, webhook, and MacroDroid log; finally test Wake-on-LAN while sleeping, with screen off, and from outside the home Wi-Fi.
5. Only after tests pass, merge this branch's `kin-wake/index.html` into main. Visitors on any device then enter owner PIN, not the trigger URL. Their short-lived signed session remains per-tab in sessionStorage.

## Security and operations
- No secret in public Github Pages HTML. Worker secrets are not copied to GitHub.
- Strict browser origin allowlist: https://shirokinstudio.github.io; adjust both client and Worker if the origin changes.
- Two Worker rate limiting bindings: 5 login attempts per minute per IP, 3 wake attempts per minute per IP. Extra Cloudflare WAF protection and a sufficiently strong PIN are recommended against distributed guesses.
- The Worker accepts only secure trigger.macrodroid.com URLs and refuses redirect.
- Session token is HMAC-signed, expires after 30 minutes; only stored in sessionStorage (not localStorage); PIN is never stored in browser.
- Successful API response means webhook endpoint accepted a request, **NOT that the Android phone sent UDP or the PC woke up**.
- Never delete the prior working webhook/pairing info until the new system has been tested end-to-end.
