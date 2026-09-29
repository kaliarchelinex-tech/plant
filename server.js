import "dotenv/config";
import cors from "cors";
import express from "express";
import diagnoseCrop from "./api/diagnose-crop.js";
import refreshPrices from "./api/refresh-prices.js";

const app = express();
const port = Number.parseInt(process.env.PORT || "3000", 10);

app.use(cors());
app.use(express.json({ limit: "4.5mb" }));
app.all("/api/refresh-prices", refreshPrices);
app.all("/api/diagnose-crop", diagnoseCrop);
app.use(express.static(process.cwd(), { dotfiles: "ignore", index: "index.html" }));

app.listen(port, "127.0.0.1", () => {
	console.log(`Smart Agri local server listening at http://127.0.0.1:${port}`);
});