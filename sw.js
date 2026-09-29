const CACHE_NAME = "smart-agri-shell-v1";
const APP_SHELL = [
	"./",
	"./index.html",
	"./style.css",
	"./app.js",
	"./manifest.json",
	"./data/prices.json",
	"./icons/icon-192.png",
	"./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME)
			.then((cache) => cache.addAll(APP_SHELL))
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches.keys()
			.then((cacheNames) => Promise.all(
				cacheNames
					.filter((cacheName) => cacheName !== CACHE_NAME)
					.map((cacheName) => caches.delete(cacheName)),
			))
			.then(() => self.clients.claim()),
	);
});

self.addEventListener("fetch", (event) => {
	const request = event.request;
	const requestUrl = new URL(request.url);
	if (request.method !== "GET" || requestUrl.origin !== self.location.origin) return;
	if (requestUrl.pathname.includes("/api/")) return;

	if (request.mode === "navigate") {
		event.respondWith(
			fetch(request)
				.then((response) => {
					if (response.ok) {
						const copy = response.clone();
						caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
					}
					return response;
				})
				.catch(async () => (await caches.match("./index.html")) || Response.error()),
		);
		return;
	}

	const isPriceData = requestUrl.pathname.endsWith("/data/prices.json");
	event.respondWith((async () => {
		const cache = await caches.open(CACHE_NAME);
		const cachedResponse = await cache.match(request);

		if (!isPriceData && cachedResponse) return cachedResponse;

		try {
			const response = await fetch(request);
			if (response.ok && response.type === "basic") {
				await cache.put(request, response.clone());
			}
			return response;
		} catch (error) {
			return cachedResponse || Response.error();
		}
	})());
});