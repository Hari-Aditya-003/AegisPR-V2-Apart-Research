export default {
  async fetch(request, env) {
    const target = new URL(env.AEGISPR_ORIGIN);
    const incoming = new URL(request.url);
    target.pathname = incoming.pathname;
    target.search = incoming.search;

    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('cookie');
    headers.delete('x-forwarded-host');
    headers.delete('x-forwarded-for');
    headers.delete('x-forwarded-proto');
    try {
      return await fetch(target, {
        method: request.method,
        headers,
        body: request.body,
        redirect: 'manual',
        cache: 'no-store',
      });
    } catch {
      return new Response('The AegisPR workspace is temporarily unavailable.', { status: 502 });
    }
  },
};
