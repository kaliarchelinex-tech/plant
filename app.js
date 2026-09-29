(() => {
	"use strict";

	const cardsContainer = document.querySelector(".crop-cards-container, .price-grid");
	const searchInput = document.querySelector("#market-search");
	const refreshButton = document.querySelector(".refresh-btn");
	const categoryTabs = [...document.querySelectorAll(".category-tabs .tab")];
	const installButton = document.querySelector(".install-banner");
	const statusBadge = document.querySelector(".status-badge");
	const cropImageInput = document.querySelector("#crop-image-input, input[type='file']");
	const analyzeButton = document.querySelector(".analyze-btn");
	const diagnosisBox = document.querySelector(".result-box");
	const currencyFormatter = new Intl.NumberFormat("ar-EG", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});

	let crops = [];
	let activeCategory = "all";
	let installPrompt = null;
	let toastTimer;

	function normalizeCategory(category) {
		const value = String(category || "").toLowerCase();
		if (["vegetable", "vegetables"].includes(value)) return "vegetables";
		if (["fruit", "fruits"].includes(value)) return "fruits";
		if (["grain", "grains", "legumes"].includes(value)) return "grains";
		return value || "all";
	}

	function normalizeCropList(payload) {
		const list = Array.isArray(payload) ? payload : payload?.crops;
		if (!Array.isArray(list)) return null;

		return list
			.filter((crop) => crop && typeof crop.name === "string" && Number.isFinite(Number(crop.price)))
			.map((crop, index) => ({
				id: crop.id ?? index,
				name: crop.name,
				category: normalizeCategory(crop.category),
				price: Number(crop.price),
				unit: crop.unit || "ج.م / كغ",
				change: Number.isFinite(Number(crop.change)) ? Number(crop.change) : 0,
				icon: typeof crop.icon === "string" && crop.icon.length <= 8 ? crop.icon : "🌱",
			}));
	}

	function makeElement(tag, className, text) {
		const element = document.createElement(tag);
		if (className) element.className = className;
		if (text !== undefined) element.textContent = text;
		return element;
	}

	function renderDiagnosis(result, isError = false) {
		if (!diagnosisBox) return;

		[...diagnosisBox.children].forEach((child) => {
			if (child.tagName !== "H3") child.remove();
		});

		const content = makeElement("div", "diagnosis-content");
		content.classList.toggle("diagnosis-error", isError);
		if (result && typeof result === "object") {
			[
				["diagnosis", "الآفة / المرض"],
				["symptoms", "الأعراض الرئيسية"],
				["treatment", "خطة العلاج والمكافحة"],
				["prevention", "إرشادات وقائية"],
			].forEach(([key, title]) => {
				if (typeof result[key] !== "string") return;
				content.append(makeElement("h4", "", title));
				content.append(makeElement("p", "", result[key]));
			});
		} else {
			String(result).split(/\r?\n/).forEach((line) => {
				const paragraph = makeElement("p", "");
				line.split(/\*\*(.+?)\*\*/g).forEach((part, index) => {
					paragraph.append(index % 2 === 1
						? makeElement("strong", "", part)
						: document.createTextNode(part));
				});
				content.append(paragraph);
			});
		}
		diagnosisBox.append(content);
	}

	function readImageAsDataUrl(file) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.addEventListener("load", () => {
				if (typeof reader.result === "string") resolve(reader.result);
				else reject(new Error("تعذرت قراءة الصورة."));
			});
			reader.addEventListener("error", () => reject(new Error("تعذرت قراءة الصورة.")));
			reader.readAsDataURL(file);
		});
	}

	async function diagnoseCrop() {
		const file = cropImageInput?.files?.[0];
		if (!file) {
			renderDiagnosis("يرجى اختيار صورة للمحصول أولاً.", true);
			return;
		}
		if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
			renderDiagnosis("نوع الصورة غير مدعوم. اختر صورة بصيغة JPEG أو PNG أو WebP.", true);
			return;
		}
		if (file.size > 3 * 1024 * 1024) {
			renderDiagnosis("حجم الصورة يجب ألا يتجاوز 3 ميغابايت.", true);
			return;
		}
		if (!navigator.onLine) {
			renderDiagnosis("تشخيص الصور يحتاج إلى اتصال بالإنترنت. أعد المحاولة عند عودة الاتصال.", true);
			return;
		}

		const previousText = analyzeButton?.textContent || "🔍 تحليل المحصول واستخراج العلاج";
		if (analyzeButton) {
			analyzeButton.disabled = true;
			analyzeButton.setAttribute("aria-busy", "true");
			analyzeButton.textContent = "⏳ جاري تحليل الصورة بواسطة الذكاء الاصطناعي...";
		}
		renderDiagnosis("قد يستغرق التحليل بضع لحظات...");

		try {
			const dataUrl = await readImageAsDataUrl(file);
			const commaIndex = dataUrl.indexOf(",");
			if (commaIndex < 0 || !/^data:image\/(?:jpeg|png|webp);base64,/i.test(dataUrl.slice(0, commaIndex + 1))) {
				throw new Error("تعذر استخراج بيانات الصورة.");
			}
			const imageBase64 = dataUrl.slice(commaIndex + 1);
			if (!imageBase64) throw new Error("بيانات الصورة فارغة.");
			const response = await fetch("/api/diagnose-crop", {
				method: "POST",
				headers: { "Content-Type": "application/json", Accept: "application/json" },
				body: JSON.stringify({ imageBase64, mimeType: file.type }),
				cache: "no-store",
			});
			const payload = await response.json().catch(() => null);
			if (!response.ok || payload?.success !== true || !payload.diagnosis || typeof payload.diagnosis !== "object") {
				const message = payload?.message || (response.status === 404 || !payload
					? "خدمة التشخيص غير متاحة. شغّل المشروع عبر vercel dev أو npm start."
					: "تعذر الوصول إلى خدمة التشخيص.");
				throw new Error(message);
			}
			renderDiagnosis(payload.diagnosis);
		} catch (error) {
			const message = error instanceof TypeError
				? "تعذر الاتصال بخدمة التشخيص. شغّل المشروع عبر vercel dev أو npm start وتحقق من اتصال الإنترنت."
				: error.message || "حدث خطأ أثناء تحليل الصورة. حاول مرة أخرى.";
			renderDiagnosis(message, true);
		} finally {
			if (analyzeButton) {
				analyzeButton.disabled = false;
				analyzeButton.removeAttribute("aria-busy");
				analyzeButton.textContent = previousText;
			}
		}
	}

	function renderCrops() {
		if (!cardsContainer) return;

		const query = (searchInput?.value || "").trim().toLocaleLowerCase("ar");
		const visibleCrops = crops.filter((crop) => {
			const matchesCategory = activeCategory === "all" || crop.category === activeCategory;
			const matchesSearch = crop.name.toLocaleLowerCase("ar").includes(query);
			return matchesCategory && matchesSearch;
		});

		cardsContainer.replaceChildren();
		if (visibleCrops.length === 0) {
			cardsContainer.append(makeElement("p", "empty-state", "لا توجد محاصيل تطابق البحث."));
			return;
		}

		const fragment = document.createDocumentFragment();
		visibleCrops.forEach((crop) => {
			const direction = crop.change > 0 ? "up" : crop.change < 0 ? "down" : "flat";
			const arrow = crop.change > 0 ? "▲" : crop.change < 0 ? "▼" : "•";
			const card = makeElement("article", "price-card");
			card.dataset.category = crop.category;
			card.dataset.name = crop.name;

			const top = makeElement("div", "price-top");
			top.append(makeElement("h3", "", crop.name));
			top.append(makeElement("span", `trend ${direction}`, arrow));

			const icon = makeElement("span", "crop-icon", crop.icon);
			icon.setAttribute("aria-hidden", "true");

			const price = makeElement("p", "price", `${currencyFormatter.format(crop.price)} ${crop.unit}`);
			const signedChange = crop.change > 0 ? `+${crop.change}` : String(crop.change);
			const change = makeElement("small", "", `تغير: ${signedChange}%`);

			card.append(icon, top, price, change);
			fragment.append(card);
		});
		cardsContainer.append(fragment);
	}

	function showToast(message, isError = false) {
		let toast = document.querySelector(".app-toast");
		if (!toast) {
			toast = makeElement("div", "app-toast");
			toast.setAttribute("role", "status");
			toast.setAttribute("aria-live", "polite");
			Object.assign(toast.style, {
				position: "fixed",
				insetInline: "16px",
				bottom: "20px",
				zIndex: "1000",
				width: "fit-content",
				maxWidth: "calc(100% - 32px)",
				marginInline: "auto",
				padding: "12px 18px",
				borderRadius: "6px",
				color: "#fff",
				background: "#286b38",
				boxShadow: "0 4px 18px rgb(0 0 0 / 18%)",
				textAlign: "center",
			});
			document.body.append(toast);
		}
		toast.textContent = message;
		toast.style.background = isError ? "#a33131" : "#286b38";
		toast.hidden = false;
		window.clearTimeout(toastTimer);
		toastTimer = window.setTimeout(() => {
			toast.hidden = true;
		}, 3200);
	}

	function setNetworkStatus() {
		if (!statusBadge) return;
		const isOnline = navigator.onLine;
		const dot = statusBadge.querySelector(".status-dot");
		if (dot) {
			dot.classList.toggle("online", isOnline);
			dot.classList.toggle("offline", !isOnline);
		}
		const label = statusBadge.querySelector("span:last-child");
		if (label) label.textContent = isOnline ? "🟢 متصل" : "📶 أوفلاين";
		statusBadge.setAttribute("aria-label", isOnline ? "متصل بالإنترنت" : "غير متصل بالإنترنت");
	}

	function simulatePriceUpdate() {
		crops = crops.map((crop) => {
			const movement = (Math.random() * 0.012) - 0.006;
			return {
				...crop,
				price: Math.max(0, crop.price * (1 + movement)),
				change: Number((movement * 100).toFixed(1)),
			};
		});
		renderCrops();
	}

	async function refreshPrices() {
		if (!refreshButton || refreshButton.disabled) return;

		const previousText = refreshButton.textContent;
		refreshButton.disabled = true;
		refreshButton.setAttribute("aria-busy", "true");
		refreshButton.classList.add("loading");
		refreshButton.textContent = "جارٍ التحديث...";

		try {
			const response = await fetch("/api/refresh-prices", {
				headers: { Accept: "application/json" },
				cache: "no-store",
			});
			if (!response.ok) throw new Error(`Price refresh failed: ${response.status}`);

			const payload = await response.json();
			if (payload.success === false) throw new Error(payload.message || "Price refresh failed");
			const responseData = typeof payload.data === "string" ? JSON.parse(payload.data) : payload.data;
			const updatedCrops = normalizeCropList(responseData ?? payload);
			if (!updatedCrops?.length) throw new Error("Price refresh returned no crop data");
			crops = updatedCrops;
			renderCrops();
			showToast("تم تحديث الأسعار بنجاح 🌾");
		} catch (error) {
			const message = error instanceof TypeError
				? "تعذر الاتصال بالسيرفر. تحقق من اتصال الشبكة."
				: "تعذر تحديث الأسعار من الخدمة. حاول مرة أخرى لاحقاً.";
			showToast(message, true);
		} finally {
			refreshButton.disabled = false;
			refreshButton.removeAttribute("aria-busy");
			refreshButton.classList.remove("loading");
			refreshButton.textContent = previousText;
		}
	}

	function setupCategoryTabs() {
		const categoriesByPosition = ["all", "vegetables", "fruits", "grains"];
		categoryTabs.forEach((tab, index) => {
			const category = normalizeCategory(tab.dataset.category || categoriesByPosition[index] || "all");
			tab.dataset.category = category;
			tab.addEventListener("click", () => {
				activeCategory = category;
				categoryTabs.forEach((item) => {
					const selected = item === tab;
					item.classList.toggle("active", selected);
					item.setAttribute("aria-selected", String(selected));
				});
				renderCrops();
			});
		});
	}

	function setupInstallPrompt() {
		if (!installButton) return;
		const isInstalled = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
		if (isInstalled) installButton.hidden = true;

		window.addEventListener("beforeinstallprompt", (event) => {
			event.preventDefault();
			installPrompt = event;
			installButton.hidden = false;
		});

		window.addEventListener("appinstalled", () => {
			installPrompt = null;
			installButton.hidden = true;
			showToast("تم تثبيت التطبيق بنجاح.");
		});

		installButton.addEventListener("click", async () => {
			if (!installPrompt) {
				showToast("يمكنك تثبيت التطبيق من قائمة المتصفح.");
				return;
			}
			installPrompt.prompt();
			await installPrompt.userChoice;
			installPrompt = null;
		});
	}

	function setupInfoModal() {
		const modal = document.querySelector("#infoModal");
		const openButton = document.querySelector("#infoBtn");
		const closeButton = document.querySelector("#closeModal");
		if (!modal || !openButton || !closeButton) return;

		openButton.addEventListener("click", () => {
			if (typeof modal.showModal === "function") modal.showModal();
			else modal.hidden = false;
		});
		closeButton.addEventListener("click", () => {
			if (typeof modal.close === "function") modal.close();
			else modal.hidden = true;
		});
		modal.addEventListener("click", (event) => {
			if (event.target !== modal) return;
			if (typeof modal.close === "function") modal.close();
			else modal.hidden = true;
		});
	}

	async function loadInitialPrices() {
		try {
			const response = await fetch("./data/prices.json", { cache: "no-cache" });
			if (!response.ok) throw new Error(`Price data unavailable: ${response.status}`);
			const loadedCrops = normalizeCropList(await response.json());
			if (!loadedCrops?.length) throw new Error("Price data contains no crops");
			crops = loadedCrops;
			renderCrops();
		} catch (error) {
			if (cardsContainer) {
				cardsContainer.replaceChildren(makeElement("p", "empty-state", "تعذر تحميل أسعار المحاصيل. تحقق من الاتصال ثم أعد المحاولة."));
			}
		}
	}

	searchInput?.addEventListener("input", renderCrops);
	refreshButton?.addEventListener("click", refreshPrices);
	document.querySelector(".upload-actions button[aria-label='استخدم الكاميرا']")
		?.addEventListener("click", () => cropImageInput?.click());
	cropImageInput?.addEventListener("change", () => {
		if (cropImageInput.files?.[0]) renderDiagnosis(`تم اختيار الصورة: ${cropImageInput.files[0].name}`);
	});
	analyzeButton?.addEventListener("click", diagnoseCrop);
	setupCategoryTabs();
	setupInstallPrompt();
	setupInfoModal();
	setNetworkStatus();
	window.addEventListener("online", setNetworkStatus);
	window.addEventListener("offline", setNetworkStatus);
	if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
		window.addEventListener("load", () => {
			navigator.serviceWorker.register("./sw.js").catch((error) => {
				console.error("Service worker registration failed:", error);
			});
		});
	}
	loadInitialPrices();
})();
