const CACHE_NAME = "fasting-tracker-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./calorie-tips.yaml",
  "./site.webmanifest",
  "./assets/favicon/android-chrome-192x192.png",
  "./assets/favicon/android-chrome-512x512.png",
  "./assets/favicon/apple-touch-icon.png",
  "./assets/favicon/favicon-16x16.png",
  "./assets/favicon/favicon-32x32.png",
  "./assets/favicon/favicon.ico",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      ),
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
