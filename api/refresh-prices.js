import { GoogleGenAI } from "@google/genai";

const MODEL_NAME = "gemini-flash-latest";

const PRICE_PROMPT = `
أنشئ أسعار جملة تقديرية في مصر لهذه المحاصيل: طماطم، بطاطس، بصل، خيار، ثوم، فلفل أخضر، ملفوف، جرجير، جزر، فجل، تفاح بلدي، تفاح مستورد، موز، برتقال، ليمون، عنب، مشمش، رمان، خوخ، كريز، أرز مصري، قمح، عدس، شعير، ذرة، فول، لوبيا، سمسم.
أعد JSON فقط بالشكل {"crops":[{"name":"","category":"vegetables|fruits|grains","price":0,"unit":"ج.م / كغ","change":0}]}. أدرج كل محصول مرة واحدة؛ price وchange رقمان. الأسعار تقديرية وليست عروضاً موثقة.
`;

async function generateWith503Retries(ai, request) {
	for (let retry = 0; ; retry += 1) {
		try {
			return await ai.models.generateContent(request);
		} catch (error) {
			if (error.status !== 503 || retry >= 3) throw error;
			await new Promise((resolve) => setTimeout(resolve, 1000 * (2 ** retry)));
		}
	}
}

function isValidPriceData(payload) {
	return payload
		&& Array.isArray(payload.crops)
		&& payload.crops.length > 0
		&& payload.crops.every((crop) => (
			crop
			&& typeof crop.name === "string"
			&& crop.name.trim().length > 0
			&& Number.isFinite(crop.price)
			&& crop.price >= 0
			&& Number.isFinite(crop.change)
		));
}

export default async function handler(req, res) {
	if (req.method !== "GET") {
		res.setHeader("Allow", "GET");
		return res.status(405).json({
			success: false,
			message: "طريقة الطلب غير مسموح بها. استخدم GET.",
		});
	}

	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) {
		return res.status(500).json({
			success: false,
			message: "مفتاح Gemini API غير مضبوط في متغيرات بيئة الخادم.",
		});
	}

	try {
		const ai = new GoogleGenAI({ apiKey });
		const response = await generateWith503Retries(ai, {
			model: MODEL_NAME,
			contents: PRICE_PROMPT,
			config: {
				responseMimeType: "application/json",
				temperature: 0.2,
			},
		});

		const responseText = response.text;
		const parsedData = JSON.parse(responseText);
		if (!isValidPriceData(parsedData)) {
			throw new Error("Gemini returned invalid crop price data");
		}

		return res.status(200).json({
			success: true,
			data: response.text,
		});
	} catch (error) {
		console.error("[api/refresh-prices] Gemini price refresh failed:", error);
		return res.status(500).json({
			success: false,
			message: "فشل تحديث الأسعار من السيرفر",
		});
	}
}
