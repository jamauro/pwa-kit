const config = {
  cache: { // Note: html, js, and css caching is handled automatically
    version: 1, // bump to bust cache for all assets
    include: ['/app.webmanifest'], // paths to static files in /public that you want precached. add a version with ?v= to clean up old ones, the actual file name can remain the same.
    exclude: [], // paths that should always hit the network, aka Network Only, and will not be used offline, e.g. '/healthcheck'
  },
  notification: { // push notification defaults. if you don't want to support push notifications, feel free to delete this from the config
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
const PAGES = 'pages';
const BUNDLES = 'bundles'; // the cache for these will be auto busted and cleaned up using the hash Meteor provides
const PRE_CACHES = `precaches_v${config.cache.version}`
const ASSETS = `assets_v${config.cache.version}`;
const DYNAMIC_IMPORTS = 'dynamic-imports'; // only used in development for testing purposes, see handleDynamicImportRequest
const CACHE_NAMES = [PAGES, BUNDLES, PRE_CACHES, ASSETS, DYNAMIC_IMPORTS];
const HTML_KEY = '/';
const REGEX = {
  html: /html/,
  texthtml: /text\/html/
};

// initialize cache
self.addEventListener('install', async (event) => {
  event.waitUntil(async function() {

    await Promise.all([
      caches.open(PAGES).then(cache => cache.add(HTML_KEY)),
      caches.open(PRE_CACHES).then(cache => cache.addAll(
        config.cache.include.map(p => getVersion(p) ? p : `${p}?v=${config.cache.version}`)
      ))
    ]);
  }());
  self.skipWaiting(); // Immediately activate the new service worker
});

// clean up any caches that we shouldn't keep anymore
self.addEventListener('activate', async event => {
  event.waitUntil(async function() {
    const cacheNames = await caches.keys();

    // clean up old caches
    await Promise.all(
      cacheNames.map(async name => {
        if (!CACHE_NAMES.includes(name)) {
          await caches.delete(name);
        }
      })
    );

    // clean up old precached assets
    const cache = await caches.open(PRE_CACHES);
    const keys = await cache.keys();

    await Promise.all(
      keys.map(async cached => {
        const pathname = new URL(cached.url).pathname;
        const asset = config.cache.include.find(
          key => stripQuery(key) === pathname && (getVersion(key) || String(config.cache.version)) !== getVersion(cached.url)
        );

        if (asset) {
          await cache.delete(cached);
        }
      })
    );

    self.clients.claim(); // activates sw immediately for all pages without requiring the user to refresh
  }());
});

// intercept fetch so that we can return cached data when available
self.addEventListener('fetch', event => {
  const { request } = event;

  if (!request.url.startsWith('http') || [...config.cache.exclude, METEOR_WEBSOCKET].some(path => new URL(request.url).pathname.startsWith(path))) {
    return;
  }

  if (request.method === 'GET') {
    return event.respondWith(handleRequest(request));
  }

  const dev = ['localhost', '127.0.0.1'].includes(self.location.hostname);

  if (dev && request.method === 'POST' && request.url.includes('/__meteor__/dynamic-import/fetch')) { // only used when in development, in prod meteor handles this
    return event.respondWith(handleDynamicImportRequest(request));
  }
});

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

async function handleRequest(request) {
  const isHashed = hasHash(request.url);
  const { origin, pathname } = new URL(request.url);
  const precache = pathname !== HTML_KEY && config.cache.include.find(item => item.includes(pathname));
  const version = precache ? getVersion(precache) || String(config.cache.version) : !isHashed && getVersion(request.url);

  if (precache) {
    const cache = await caches.open(PRE_CACHES);
    const key = `${request.url}${version ? `?v=${version}` : ''}`;
    const precached = await cache.match(key);
    if (precached) {
      return precached;
    }
  }

  const cached = await caches.match(request);

  if (cached) {
    const sameHash = isHashed && hasSameHash(request.url, cached.url);
    const sameVersion = version && version === getVersion(cached.url);
    const notTextHtml = !isHashed && !REGEX.texthtml.test(cached.headers.get('content-type'));

    if (sameHash || sameVersion || notTextHtml) {
      return cached;
    }
  }

  try {
    const isExternal = origin !== self.location.origin;
    const response = await fetch(request, isExternal ? { mode: 'cors' } : {}); // set CORS for use with external CDN

    if (!response || response.status !== 200 || response.type !== 'basic') {
      return response;
    }

    const contentType = response.headers.get('content-type');
    const clonedResponse = response.clone();

    const cacheName = REGEX.html.test(contentType) ? PAGES : isHashed ? BUNDLES : ASSETS;
    const cache = await caches.open(cacheName);

    // automatically clean up old cached urls
    if (isHashed || version) {
      const keys = await cache.keys();
      const asset = keys.find(cached => isSame(request.url, cached.url));
      if (asset) await cache.delete(asset);
    }
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

// only executed in development environment - you can safely delete this if you want but it is handy when testing
// in production, meteor automatically handles caching dynamic imports in indexeddb
// use network first strategy for dynamic imports and make it available for offline use
async function handleDynamicImportRequest(request) {
  const cache = await caches.open(DYNAMIC_IMPORTS);
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
    // When the fetch fails, e.g. when offline, return the cached version if available
    const cached = await cache.match(key);

    return cached || new Response('No cached dynamic import available', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}
