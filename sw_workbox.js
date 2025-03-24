importScripts('https://storage.googleapis.com/workbox-cdn/releases/7.3.0/workbox-sw.js');

const config = {
  cache: { // Note: html, js, and css caching is handled automatically
    version: 1, // bump to bust cache for all assets in include
    include: ['/app.webmanifest'], // paths to static files that you want precached. to update cache for a particular asset, add a version number with ?v=, the actual file name can remain the same
    exclude: [], // paths that should always hit the network and will not be needed offline, e.g. '/healthcheck'
    content: { // content types other than script, style, and worker (which are handled automatically) - see https://developer.mozilla.org/en-US/docs/Web/API/Request/destination
      images: { maxEntries: 50 }, // can be maxEntries, maxAgeSeconds, etc. - see https://developer.chrome.com/docs/workbox/modules/workbox-expiration
      fonts: { maxEntries: 5 },
      // add other content types here if you'd like
    }
  },
  notification: { // push notification defaults. if you don't want to support push notifications, delete this from the config
    body: 'You have a new notification',
    icon: '/icons/apple-touch-icon.png',
    badge: '',
    data: { url: self.location.origin },
    // add more defaults here if you'd like - see https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification
  }
};

/*
  ************************************************************
   * No need to change the below but feel free if you want to
  ************************************************************
*/

const METEOR_WEBSOCKET = '/sockjs';
const { registerRoute } = workbox.routing;
const { cleanupOutdatedCaches, precacheAndRoute } = workbox.precaching;
const { CacheFirst, NetworkFirst, NetworkOnly, StaleWhileRevalidate } = workbox.strategies;
const { ExpirationPlugin } = workbox.expiration;

cleanupOutdatedCaches();
precacheAndRoute(config.cache.include.map(p => {
  const version = getVersion(p);
  return {
    url: version ? stripQuery(p) : p,
    revision: `${version || config.cache.version}`
  };
}));

registerRoute(
  ({ url }) => [...config.cache.exclude, METEOR_WEBSOCKET].some(path => url.pathname.startsWith(path)),
  new NetworkOnly()
);

registerRoute(
  ({ request }) => request.mode === 'navigate',
  new NetworkFirst({
    cacheName: 'pages',
    matchOptions: { ignoreVary: true }
  })
);

// the cache for these will be auto busted and cleaned up using the hash Meteor provides
registerRoute(
  ({ request }) => hasHash(request.url),
  async ({ request }) => handleRequest({ request, cacheName: 'bundles' })
);

registerRoute(
  ({ request }) => request.destination === 'worker',
  new StaleWhileRevalidate({
    cacheName: 'assets',
    cacheableResponse: { statuses: [200] },
    matchOptions: { ignoreVary: true }
  })
);

for (const [type, settings] of Object.entries(config.cache.content)) {
  const destination = type.replace(/s$/, "");
  const hasSettings = Object.keys(settings).length !== 0;

  registerRoute(
    ({ request }) => request.destination === destination,
    new CacheFirst({
      cacheName: type,
      matchOptions: { ignoreVary: true },
      ...(hasSettings && { plugins: [new ExpirationPlugin(settings)] }),
    })
  );
}

// CDN usage
registerRoute(
  ({ url }) => url.origin !== self.location.origin,
  new NetworkFirst({
    cacheName: 'external-assets',
  })
);

// Force update to the latest service worker version
self.addEventListener('install', event => {
  self.skipWaiting();
});

// Activate sw immediately for all pages without requiring the user to refresh
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// only useful in development environment. in prod, Meteor handles caching dynamic imports automatically.
// you can safely delete this and handleDynamicImportRequest if you want but it is handy when testing
const dev = ['localhost', '127.0.0.1'].includes(self.location.hostname);
if (dev) {
  self.addEventListener('fetch', event => {
    const { request } = event;

    if (!request.url.startsWith('http')) {
      return;
    }

    if (request.method === 'POST' && request.url.includes('/__meteor__/dynamic-import/fetch')) {
      return event.respondWith(handleDynamicImportRequest({ request, cacheName: 'dynamic-imports' }));
    }
  });
}

// web push notifications
if (config.notification) {
  self.addEventListener('push', event => {
    try {
      const { title = 'Notification', body, icon, badge, actions, ...data } = event.data?.json() || {};
      const options = { ...config.notification, body, icon, badge, actions, data };

      event.waitUntil(self.registration.showNotification(title, options));
    } catch (error) {
      console.error('Failed to show notification:', error);
    }
  });

  self.addEventListener('notificationclick', event => {
    const { notification } = event;

    notification.close();

    event.waitUntil(async function() {
      try {
        const clientList = await self.clients.matchAll();

        if (clientList.length > 0) {
          const [ existingClient ] = clientList;
          await existingClient.navigate(notification.data.url);
          await existingClient.focus();

          return;
        }

        const newClient = await self.clients.openWindow(notification.data.url);
        await newClient.focus();

        return;
      } catch (error) {
        console.error('Failed to handle notification click:', error);
      }
    }());
  });
}

// utils
function hasHash(element) { return typeof element === 'string' && /[?&](hash|meteor_css_resource|meteor_js_resource)=/.test(element); }
function isMeteorResource(query) { return /[?&](meteor_css_resource|meteor_js_resource)=/.test(query); }
function stripQuery(element) { return typeof element === 'string' ? element.split('?')[0] : ''; }

function getExtension(url) {
  const base = url.split('?')[0];
  return base.includes('.') ? base.split('.').pop() : '';
}

function getQueryParam(query, param) {
  if (typeof query !== 'string') return null;
  const match = query.match(`[?&]${param}=([^&]*)`);
  return match ? match[1] : null;
}

function getVersion(url) { return getQueryParam(url, 'v'); }

function hasSameHash(first, second) {
  if (typeof first !== 'string' || typeof second !== 'string') return false;

  const [ firstPath, firstQuery ] = first.split('?');
  const [ secondPath, secondQuery ] = second.split('?');

  if (isMeteorResource(firstQuery)) { // prod will use meteor resource
    return firstPath === secondPath;
  }

  return getQueryParam(firstQuery, 'hash') === getQueryParam(secondQuery, 'hash');
}

function isSame(first, second) { return isMeteorResource(first) ? getExtension(first) === getExtension(second) : stripQuery(first) === stripQuery(second); }
//


// only used for Meteor hashed bundles
async function handleRequest({ request, cacheName }) {
  const cached = await caches.match(request.clone());

  if (cached && hasSameHash(request.url, cached.url)) {
    return cached;
  }

  try {
    const response = await fetch(request);

    if (!response || response.status !== 200 || response.type !== 'basic') {
      return response;
    }

    const clonedResponse = response.clone();

    // automatically clean up old cached urls
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    const asset = keys.find(cached => isSame(request.url, cached.url));
    if (asset) await cache.delete(asset);
    //

    await cache.put(request, clonedResponse);

    return response;
  } catch (error) {
    const cached = await caches.match(request);

    return cached || new Response('No connection to the server', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

// only executed in development environment - you can delete this if you want but it is handy when testing
// in production, meteor automatically handles caching dynamic imports in indexeddb
// use network first strategy for dynamic imports and make it available for offline use
async function handleDynamicImportRequest({ request, cacheName }) {
  const cache = await caches.open(cacheName);
  const clonedRequest = request.clone();
  const requestBody = await clonedRequest.json();
  const key = `${request.url}-${JSON.stringify(requestBody)}`;

  try {
    const response = await fetch(request);
    const clonedResponse = response.clone();
    const responseData = await clonedResponse.json();

    await cache.put(key, new Response(JSON.stringify(responseData), {
      headers: { 'Content-Type': 'application/json' }
    }));

    return response;
  } catch (error) {
    const cached = await cache.match(key);

    return cached || new Response('No cached dynamic import available', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}
