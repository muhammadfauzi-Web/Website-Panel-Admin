const CACHE_NAME = "admin-spbu-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./admin-style.css",
  "./admin-script.js",
  "./logo.png",
  "./manifest.json"
];

// Install Service Worker dan simpan cache
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// Gunakan cache jika ada, jika tidak ambil dari jaringan (network)
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});

// Hapus cache lama jika ada pembaruan versi
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
});
