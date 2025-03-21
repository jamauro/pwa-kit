/// CONFIG ///
const version = 1; // IMPORTANT: when you change assets in /public, bump this version number

const preCache = [
  // add the path of any static files in your /public folder that you want precached, e.g. '/images/something.png'
];

const notificationConfig = { // push notification defaults - see https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification
  body: 'You have a new notification',
  icon: '/icons/apple-touch-icon.png',
  badge: '',
  data: { url: self.location.origin },
  renotify: true,
  vibrate: [100, 50, 100]
  // these are the other optional configs
  /*
  actions: [],
  requireInteraction: false,
  silent: false,
  tag: '',
  timestamp: Date.now(),
  priority: 'normal'
  */
};
/// END ///


const APP = 'app'; // the cache for these will be auto busted and cleaned up using the hash Meteor provides
const STATIC_ASSETS = `static-assets_v${version}`; // these will only change when the version number changes
const DYNAMIC_IMPORTS = 'dynamic-imports'; // only used in development for testing purposes, see handleDynamicImportRequest
const CACHE_NAMES = [APP, STATIC_ASSETS, DYNAMIC_IMPORTS];
const HTML_KEY = '/';
const REGEX = {
  websocket: /\/sockjs\//,
  html: /html/,
  texthtml: /text\/html/
};

// utils
const isMeteorResource = query => /[?&](meteor_css_resource|meteor_js_resource)=/.test(query);
const getPath = element => typeof element === 'string' ? element.split('?')[0] : '';
const getExtension = url => {
  const base = url.split('?')[0];
  return base.includes('.') ? base.split('.').pop() : '';
};
const hasSameExtension = (first, second) => getExtension(first) === getExtension(second);
const hasHash = element => typeof element === 'string' && /[?&](hash|meteor_css_resource|meteor_js_resource)=/.test(element);
const getHash = query => {
  if (typeof query !== 'string') return null;
  const match = query.match(/[?&]hash=([^&]*)/);
  return match ? match[1] : null;
};
const hasSameHash = (first, second) => {
  if (typeof first !== 'string' || typeof second !== 'string') return false;

  const [ firstPath, firstQuery ] = first.split('?');
  const [ secondPath, secondQuery ] = second.split('?');

  if (isMeteorResource(firstQuery)) { // prod will use meteor resource
    return firstPath === secondPath;
  }

  return getHash(firstQuery) === getHash(secondQuery);
};


// initialize cache
self.addEventListener('install', async (event) => {
  event.waitUntil(async function() {
    await Promise.all([
      caches.open(APP).then(cache => cache.add(HTML_KEY)),
      ...(preCache.length ? [caches.open(STATIC_ASSETS).then(cache => cache.addAll(preCache))] : [])
    ]);
  }());
  self.skipWaiting(); // Immediately activate the new service worker
});

// clean up any caches that we shouldn't keep anymore
self.addEventListener('activate', async event => {
  event.waitUntil(async function() {
    const cacheNames = await caches.keys();

    await Promise.all(
      cacheNames.map(async name => {
        if (!CACHE_NAMES.includes(name)) {
          await caches.delete(name);
        }
      })
    );

    self.clients.claim(); // activates sw immediately for all pages without requiring the user to refresh
  }());
});

// intercept fetch so that we can return cached data when available
self.addEventListener('fetch', async event => {
  const { request } = event;

  if (!request.url.startsWith('http')) {
    return;
  }

  if (request.method === 'GET') {
    return event.respondWith(handleRequest(request));
  }

  if (request.method === 'POST' && request.url.includes('/__meteor__/dynamic-import/fetch')) { // only used when in development, in prod meteor handles this
    return event.respondWith(handleDynamicImportRequest(request));
  }

  return;
});

// web push notifications
self.addEventListener('push', async event => {
  try {
    const { title = 'Notification', body, icon, badge, actions, ...data } = event.data?.json() || {};
    const options = { ...notificationConfig, body, icon, badge, actions, data };

    await self.registration.showNotification(title, options);
  } catch (error) {
    console.error('Failed to show notification:', error);
  }
});

self.addEventListener('notificationclick', async event => {
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

// use cache if nothing has changed or we're offline
async function handleRequest(request) {
  const cached = await caches.match(request.clone());
  const isHashed = hasHash(request.url);

  if (cached) {
    if (isHashed && hasSameHash(request.url, cached.url)) {
      return cached;
    }

    const contentType = cached.headers.get('content-type');
    if (!isHashed && !REGEX.texthtml.test(contentType)) {
      return cached;
    }
  }

  try {
    const response = await fetch(request);
    const contentType = response.headers.get('content-type');

    if (!response || response.status !== 200 || response.type !== 'basic' || REGEX.websocket.test(request.url)) {
      return response;
    }

    const clonedResponse = response.clone();

    if (REGEX.html.test(contentType)) {
      const cache = await caches.open(APP);
      await cache.put(HTML_KEY, clonedResponse);
    } else {
      if (isHashed) {
        // automatically clean up old cached urls
        const cache = await caches.open(APP);
        const keys = await cache.keys();

        const asset = keys
          .find(k => isMeteorResource(request.url) ? hasSameExtension(request.url, k.url) : getPath(request.url) === getPath(k.url));

        if (asset) {
          await cache.delete(asset);
        }
      }

      const cache = await caches.open(isHashed ? APP : STATIC_ASSETS);
      await cache.put(request, clonedResponse);
    }

    return response;
  } catch (error) {
    if (isHashed) return caches.match(request.url);
    if (!REGEX.websocket.test(request.url)) return caches.match(HTML_KEY);
    return new Response('No connection to the server', {
      status: 503,
      statusText: 'No connection to the server',
      headers: new Headers({ 'Content-Type': 'text/plain' }),
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
    const response = await fetch(request.clone());
    const clonedResponse = response.clone();
    const responseData = await clonedResponse.json();

    await cache.put(key, new Response(JSON.stringify(responseData), {
      headers: { 'Content-Type': 'application/json' }
    }));

    return response;
  } catch (error) {
    // When the fetch fails, e.g. when offline, return the cached version if available
    const cachedResponse = await cache.match(key);
    return cachedResponse || new Response('No cached dynamic import available', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}
