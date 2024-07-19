const HTMLToCache = '/';
const version = 'v0.1.0';

// Enable caching for offline
self.addEventListener('install', async event => {
  event.waitUntil(async function() {
    const cache = await caches.open(version);
    await cache.add(HTMLToCache);
    self.skipWaiting();
  }());
});

self.addEventListener('activate', async event => {
  event.waitUntil(async function() {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames.map(async (cacheName) => {
        if (version !== cacheName) {
          await caches.delete(cacheName);
        }
      })
    );
    self.clients.claim(); // activates sw immediately for all pages without requiring the user to refresh
  }());
});

self.addEventListener('fetch', async event => {
  if (event.request.url.startsWith('http') && event.request.method === 'GET') {
    const requestToFetch = event.request.clone();

    event.respondWith(async function() {
      const cached = await caches.match(event.request.clone());

      if (cached) {
        const resourceType = cached.headers.get('content-type');
        if (!hasHash(event.request.url) && !/text\/html/.test(resourceType)) {
          return cached;
        }

        if (hasHash(event.request.url) && hasSameHash(event.request.url, cached.url)) {
          return cached;
        }
      }

      try {
        const response = await fetch(requestToFetch);
        const clonedResponse = response.clone();
        const contentType = clonedResponse.headers.get('content-type');

        if (!clonedResponse || clonedResponse.status !== 200 || clonedResponse.type !== 'basic'
          || /\/sockjs\//.test(event.request.url)) {
          return response;
        }

        if (/html/.test(contentType)) {
          const cache = await caches.open(version);
          await cache.put(HTMLToCache, clonedResponse);
        } else {
          if (hasHash(event.request.url)) {
            const cache = await caches.open(version);
            const keys = await cache.keys();
            await Promise.all(
              keys.map(async (asset) => {
                if (new RegExp(removeHash(event.request.url)).test(removeHash(asset.url))) {
                  await cache.delete(asset);
                }
              })
            );
          }

          const cache = await caches.open(version);
          await cache.put(event.request, clonedResponse);
        }
        return response;
      } catch {
        if (hasHash(event.request.url)) return caches.match(event.request.url);
        if (!/\/sockjs\//.test(event.request.url)) return caches.match(HTMLToCache);
        return new Response('No connection to the server', {
          status: 503,
          statusText: 'No connection to the server',
          headers: new Headers({ 'Content-Type': 'text/plain' }),
        });
      }
    }());
  }
});

function removeHash(element) {
  if (typeof element === 'string') return element.split('?hash=')[0];
}

function hasHash(element) {
  if (typeof element === 'string') return /\?hash=.*/.test(element);
}

function hasSameHash(firstUrl, secondUrl) {
  if (typeof firstUrl === 'string' && typeof secondUrl === 'string') {
    const hash1 = firstUrl.match(/\?hash=(.*)/)?.[1];
    const hash2 = secondUrl.match(/\?hash=(.*)/)?.[1];
    return hash1 === hash2;
  }
}

// Web push notifications
self.addEventListener('push', async event => {
  try {
    const notificationData = await event.data.json();
    await self.registration.showNotification(notificationData.title, {
      body: notificationData.body,
      icon: '/icons/apple-touch-icon.png', // TODO: you'll probably need to update this depending on where your app's icon is located in your /public folder
      data: {
        url: notificationData.url
      }
    });
  } catch (error) {
    console.error('Failed to show notification:', error);
  }
});

self.addEventListener('notificationclick', async event => {
  const notification = event.notification;

  notification.close();

  event.waitUntil(async () => {
    try {
      const clientList = await self.clients.matchAll();

      if (clientList.length > 0) {
        const existingClient = clientList[0];
        await existingClient.navigate(notification.data.url);
        await existingClient.focus();
      } else {
        const newClient = await self.clients.openWindow(notification.data.url);
        await newClient.focus();
      }
    } catch (error) {
      console.error('Failed to handle notification click:', error);
    }
  });
});
