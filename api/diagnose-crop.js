import { GoogleGenAI } from "@google/genai";

const MODEL_NAME = "gemini-flash-latest";
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const DIAGNOSIS_PROMPT = `
افحص صورة المحصول كخبير زراعي مصري، ولا تستنتج أعراضاً غير ظاهرة. أعد JSON صالحاً فقط بهذه المفاتيح النصية:
{"diagnosis":"الآفة أو المرض المرجح ودرجة الثقة أو عدم كفاية الصورة","symptoms":"الأعراض المرئية فقط","treatment":"خطوات مكافحة عملية تبدأ بالخيارات الزراعية والأقل خطراً؛ لا تذكر مبيداً أو جرعة غير مؤكدة، وأحل إلى الملصق المحلي وفترة ما قبل الحصاد ومهندس زراعي عند اللزوم","prevention":"إرشادات الوقاية والمراقبة"}.
إذا لم تكن الصورة لمحصول أو لم تكفِ للتشخيص، وضح ذلك. هذا تقييم إرشادي أولي وليس بديلاً عن مهندس زراعي مختص.
`;

function sendError(res, status, message) {
	return res.status(status).json({ success: false, message });
}

function matchesImageType(buffer, mimeType) {
	if (mimeType === "image/jpeg") {
		return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
	}
	if (mimeType === "image/png") {
		return buffer.length >= 8
			&& buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
	}
	return mimeType === "image/webp"
		&& buffer.length >= 12
		&& buffer.toString("ascii", 0, 4) === "RIFF"
		&& buffer.toString("ascii", 8, 12) === "WEBP";
}

async function generateWith503Retries(ai, request) {
	for (let attempt = 1; ; attempt += 1) {
		try {
			return await ai.models.generateContent(request);
		} catch (error) {
			if (error.status !== 503 || attempt >= 3) throw error;
			await new Promise((resolve) => setTimeout(resolve, 2000));
		}
	}
}

export default async function handler(req, res) {
	if (req.method !== "POST") {
		res.setHeader("Allow", "POST");
		return sendError(res, 405, "طريقة الطلب غير مسموح بها. استخدم POST.");
	}

	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) {
		return sendError(res, 500, "مفتاح Gemini API غير مضبوط في بيئة الخادم.");
	}

	const { imageBase64, mimeType } = req.body || {};
	if (typeof imageBase64 !== "string" || !imageBase64.trim()) {
		return sendError(res, 400, "يرجى إرفاق صورة للمحصول.");
	}
	if (!ALLOWED_MIME_TYPES.has(mimeType)) {
		return sendError(res, 415, "نوع الصورة غير مدعوم. استخدم JPEG أو PNG أو WebP.");
	}

	const dataUrlMimeType = imageBase64.match(/^data:(image\/\w+);base64,/i)?.[1].toLowerCase();
	const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/i, "");
	if (dataUrlMimeType && dataUrlMimeType !== mimeType) {
		return sendError(res, 400, "نوع الصورة لا يطابق نوع البيانات المرسلة.");
	}
	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64Data) || base64Data.length % 4 !== 0) {
		return sendError(res, 400, "بيانات الصورة غير صالحة.");
	}

	const imageBuffer = Buffer.from(base64Data, "base64");
	if (imageBuffer.length === 0 || imageBuffer.length > MAX_IMAGE_BYTES) {
		return sendError(res, 413, "حجم الصورة يتجاوز الحد المسموح (3 ميغابايت).");
	}
	if (!matchesImageType(imageBuffer, mimeType)) {
		return sendError(res, 400, "محتوى الصورة لا يطابق نوع الملف المرسل.");
	}

	try {
		const ai = new GoogleGenAI({ apiKey });
		const response = await generateWith503Retries(ai, {
			model: MODEL_NAME,
			contents: [{
				role: "user",
				parts: [
					{ text: DIAGNOSIS_PROMPT },
					{ inlineData: { mimeType, data: imageBuffer.toString("base64") } },
				],
			}],
			config: { responseMimeType: "application/json", temperature: 0.2 },
		});

		const diagnosis = JSON.parse(response.text?.trim() || "null");
		if (!diagnosis || ["diagnosis", "symptoms", "treatment", "prevention"].some((key) => (
			typeof diagnosis[key] !== "string" || !diagnosis[key].trim()
		))) {
			throw new Error("Gemini returned incomplete diagnosis data");
		}

		return res.status(200).json({ success: true, diagnosis });
	} catch (error) {
		console.error("[api/diagnose-crop] Gemini diagnosis failed:", error);
		return sendError(res, 500, "تعذر تحليل الصورة حالياً. يرجى المحاولة مرة أخرى لاحقاً.");
	}
}
