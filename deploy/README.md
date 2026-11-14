# AegisPR V2 online workspace

Run the V2 API and its fixture and GPU workers with `compose.v2.yaml`. Build a second frontend with `docker build --build-arg NEXT_PUBLIC_API_URL= -t aegispr-v2-online-frontend:local frontend` and publish its port 3000 on host loopback port 13200. The empty build argument makes browser API requests same-origin.

Run Nginx with `v2-online.nginx.conf` on the same host network as the loopback listeners. Connect the HTTPS tunnel to `127.0.0.1:18201`. The gateway serves the existing V2 UI and API. The V2 API enforces the production owner access code for reviews, settings, and benchmarks. Public execution uses the committed fixture catalog. V1 API routes and GitHub webhook ingress require separate deployment configuration.

The live Dell deployment uses containers named `aegispr-v2-online-frontend`, `aegispr-v2-online-gateway`, and `aegispr-v2-online-tunnel`. The current Quick Tunnel hostname is available in the tunnel container logs and changes when a new tunnel starts.

The published entry point is [aegispr-v2.snap-hub.workers.dev](https://aegispr-v2.snap-hub.workers.dev). `edge.mjs` forwards to the explicit HTTPS origin configured at deployment. Deploy with `npx wrangler deploy --config deploy/wrangler.aegispr.toml --var AEGISPR_ORIGIN:<https-origin>`. The current origin is a Dell Quick Tunnel. After a tunnel restart creates a new hostname, redeploy the Worker with the new origin. For durable origin service, connect a named tunnel on a DNS zone you control.

Set `V2_RUNTIME_LABEL` on the API to identify the deployment in the resource panel. `MAX_DIFF_CHARACTERS` sets the owner review cap, while the GitHub adapter also requires complete file coverage and valid SHAs. Deployments should preserve the V2 evidence and signing-key volumes during upgrades.
