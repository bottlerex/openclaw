// OpenClaw proxy bootstrap — routes HTTP/HTTPS through squid proxy
// Loaded via NODE_OPTIONS=--require
// Respects NO_PROXY for localhost and internal network
'use strict';

const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (!proxyUrl) return;

const noProxy = (process.env.NO_PROXY || process.env.no_proxy || '').split(',').map(s => s.trim());

function shouldBypass(hostname) {
  if (!hostname) return true;
  return noProxy.some(entry => {
    if (!entry) return false;
    if (entry === '*') return true;
    if (hostname === entry) return true;
    if (hostname.endsWith('.' + entry)) return true;
    if (entry.includes('/')) {
      const base = entry.split('/')[0].replace(/\.0$/, '.');
      if (hostname.startsWith(base)) return true;
    }
    return false;
  });
}

try {
  const appRequire = require('module').createRequire('/app/');

  // 1. Patch https module with https-proxy-agent
  const { HttpsProxyAgent } = appRequire('https-proxy-agent');
  const https = require('https');

  const httpsAgent = new HttpsProxyAgent(proxyUrl);
  const origHttpsRequest = https.request;

  https.request = function(urlOrOpts, optsOrCb, cb) {
    let opts, callback;
    if (typeof urlOrOpts === 'string' || urlOrOpts instanceof URL) {
      const u = typeof urlOrOpts === 'string' ? new URL(urlOrOpts) : urlOrOpts;
      opts = typeof optsOrCb === 'object' ? optsOrCb : {};
      callback = typeof optsOrCb === 'function' ? optsOrCb : cb;
      if (!opts.agent && !shouldBypass(u.hostname)) {
        opts.agent = httpsAgent;
      }
      return origHttpsRequest.call(https, urlOrOpts, opts, callback);
    }
    opts = urlOrOpts || {};
    callback = optsOrCb;
    if (!opts.agent && !shouldBypass(opts.hostname || opts.host || '')) {
      opts.agent = httpsAgent;
    }
    return origHttpsRequest.call(https, opts, callback);
  };

  https.get = function(urlOrOpts, optsOrCb, cb) {
    const req = https.request(urlOrOpts, optsOrCb, cb);
    req.end();
    return req;
  };

  // 2. Patch globalThis.fetch to use proxy with NO_PROXY support
  const { ProxyAgent, Agent } = appRequire('undici');
  const proxyAgent = new ProxyAgent({ uri: proxyUrl });
  const directAgent = new Agent();

  const origFetch = globalThis.fetch;
  if (origFetch) {
    globalThis.fetch = function(input, init = {}) {
      // Don't override if caller already set a dispatcher
      if (init.dispatcher) return origFetch(input, init);

      try {
        let hostname;
        if (typeof input === 'string') {
          hostname = new URL(input).hostname;
        } else if (input instanceof URL) {
          hostname = input.hostname;
        } else if (input && input.url) {
          hostname = new URL(input.url).hostname;
        }

        if (shouldBypass(hostname)) {
          return origFetch(input, { ...init, dispatcher: directAgent });
        }
        return origFetch(input, { ...init, dispatcher: proxyAgent });
      } catch {
        return origFetch(input, init);
      }
    };
  }

  // Do NOT setGlobalDispatcher — it would break NO_PROXY logic
  // The fetch override above handles it per-request

} catch (e) {
  if (process.env.OPENCLAW_LOG_LEVEL === 'debug') {
    console.error('[proxy-bootstrap] Setup error:', e.message);
  }
}
