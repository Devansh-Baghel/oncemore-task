import { env } from "@oncemore/env/server";
import cors from "cors";
import express from "express";
import { handleResearch } from "./research";

const app = express();

app.use(
	cors({
		origin: env.CORS_ORIGIN,
		methods: ["GET", "POST", "OPTIONS"],
	}),
);

app.use(express.json());

app.get("/", (_req, res) => {
	res.status(200).send("OK");
});

app.post("/api/research", handleResearch);

app.listen(3000, () => {
	console.log("Server is running on http://localhost:3000");
});
