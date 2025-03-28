# PWA Kit

PWA Kit is a starter kit designed to help Meteor developers make their apps offline capable and convert them into Progressive Web Apps (PWAs). This repository includes the essential files and instructions to get started. There are two service workers included in this kit that are made specifically for Meteor apps.

1. `sw.js` - dependency free, vanilla js
2. `sw_workbox.js` - uses [Google Workbox](https://developer.chrome.com/docs/workbox). Includes an extra feature – expiration rules by content type (optional).

Pick one based on your preferences. :) Check the `config` in the file for more info.

Both of them have these benefits:

* Zero config with sensible defaults but can make changes easily
* Optimized caching for Meteor's bundles
* Automatically remove old caches without you needing to think about it
* Precache specific assets and an easy way to version them if needed with `include`
* Ignore paths from being cached with `exclude`
* Web push notification support (optional)
* Support for external CDN usage (optional)
* Dynamic import support when testing in dev (Meteor automatically handles this in prod)

## Add a service worker
Inside the `/public` folder of your Meteor app, add either the `sw.js` or `sw_workbox.js` file included as part of this repo. Feel free to rename the file. Make tweaks to it as needed.

On the client, for example in `/client/main.js`, register the service worker:

```js
Meteor.startup(async () => {
  try {
    await navigator.serviceWorker.register('/sw.js'); // must match the name given to your service work file
  } catch (error) {
    console.error('Service Worker registration failed:', error);
  }
});
```

## Add a webmanifest
Inside the `/public` folder of your Meteor app, add the `app.webmanifest` file included as part of this repo. Make tweaks to it as needed. The `src` for the icons should point to wherever the icons are located in your `/public` folder.

Update the `head` in your `/client/main.html` to point to the `app.webmanifest` and your app icons:
```html
<head>
  <title>your app name</title>
  <meta charset='utf-8'>
  <meta name='apple-mobile-web-app-capable' content='yes'>
  <meta name='viewport' content='width=device-width, initial-scale=1.0, user-scalable=no, viewport-fit=cover'>
  <link rel='apple-touch-icon' href='/icons/apple-touch-icon.png' /> <!-- TODO: you'll likely want to update this based on where your icons are located in your /public folder -->
  <link rel='icon' type='image/png' sizes='32x32' href='/icons/favicon-32x32.png'> <!-- TODO: you'll likely want to update this based on where your icons are located in your /public folder -->
  <link rel='icon' type='image/png' sizes='16x16' href='/icons/favicon-16x16.png'> <!-- TODO: you'll likely want to update this based on where your icons are located in your /public folder  -->
  <link rel='mask-icon' href='/icons/safari-pinned-tab.svg' color='#0096FF'> <!-- TODO: you'll likely want to update this based on where your icons are located in your /public folder and what your app's theme color is -->
  <link rel='manifest' href='/app.webmanifest'>
  <meta name='msapplication-TileColor' content='#0096FF'> <!-- TODO: you'll likely want to update this basedwhat your app's theme color is -->
  <meta name='theme-color' content='#0096FF'> <!-- TODO: you'll likely want to update this based on what your app's theme color is -->
  <noscript>
    <style>
      body:before { content: 'Sorry, your browser does not support JavaScript!'; }
    </style>
   </noscript>
</head>
```

## Enable SSL
You’ll need to enable SSL for your app in production. If you’re not sure how to do that, take a look at [this section in the Meteor Guide](https://guide.meteor.com/security#ssl).
