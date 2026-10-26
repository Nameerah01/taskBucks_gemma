require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});

let dbConnected = false;
let demoPoints = 0;
let demoSubmissions = [];

const Submission = mongoose.model(
    "Submission",
    new mongoose.Schema({
        type: String,
        description: String,
        points: Number,
        approved: Boolean,
        createdAt: { type: Date, default: Date.now }
    })
);

async function saveSubmission(data) {
    if (dbConnected) {
        await Submission.create(data);
    } else {
        demoSubmissions.unshift({
            ...data,
            createdAt: new Date()
        });
        demoSubmissions = demoSubmissions.slice(0, 50);
    }

    if (data.approved) {
        demoPoints += data.points;
    }
}


async function askGemma(prompt, images = []) {
    const ollamaUrl =
        process.env.OLLAMA_URL || "http://127.0.0.1:11434";

    const model =
        process.env.GEMMA_MODEL || "gemma3:1b";

    let response;

    try {
        response = await fetch(`${ollamaUrl}/api/generate`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model,
                prompt,
                images,
                stream: false,
                format: "json",
                options: { temperature: 0.1 }
            })
        });
    } catch (error) {
        throw new Error(`Cannot connect to Ollama: ${error.message}`);
    }

    const responseText = await response.text();

    if (!response.ok) {
        throw new Error(
            `Ollama HTTP ${response.status}: ${responseText}`
        );
    }

    const data = JSON.parse(responseText);

    try {
        return JSON.parse(data.response);
    } catch {
        throw new Error(`Gemma response: ${data.response}`);
    }
}

app.get("/api/health", (req, res) => {
    res.json({
        status: "ok",
        database: dbConnected ? "connected" : "demo memory",
        ai: "Ollama/Gemma"
    });
});

app.get("/api/dashboard", (req, res) => {
    res.json({
        points: demoPoints,
        submissions: demoSubmissions
    });
});


app.get("/api/health", (req, res) => {
    res.json({
        status: "ok",
        database: dbConnected ? "connected" : "demo memory",
        ai: "Ollama/Gemma"
    });
});

app.get("/api/dashboard", (req, res) => {
    res.json({
        points: demoPoints,
        submissions: demoSubmissions
    });
});

// Verify a chore using before-and-after photos.
app.post(
    "/api/verify/chore",
    upload.fields([
        { name: "before", maxCount: 1 },
        { name: "after", maxCount: 1 }
    ]),
    async (req, res) => {
        try {
            const before = req.files?.before?.[0];
            const after = req.files?.after?.[0];
            const task = (req.body.task || "").trim();

            if (!before || !after || !task) {
                return res.status(400).json({
                    error: "Add a task description and both photos."
                });
            }

            const result = await askGemma(
                `You verify household chores using two images.
The first image is BEFORE and the second is AFTER.
Task: "${task}"

Compare the images. Approve only if the images provide reasonable
visual evidence that the task was completed. Do not assume things
that are not visible. If uncertain, reject it.

Return JSON only:
{"approved":true,"reason":"short explanation"}`,
                [
                    before.buffer.toString("base64"),
                    after.buffer.toString("base64")
                ]
            );

            const approved = result.approved === true;
            const points = approved ? 25 : 0;

            await saveSubmission({
                type: "Chore",
                description: task,
                points,
                approved
            });

            res.json({
                approved,
                points,
                reason: String(result.reason || "Review completed.")
                    .slice(0, 300)
            });
        }
        catch (error) {
    console.error("FULL GEMMA ERROR:", error);

    res.status(502).json({
        error: "Could not verify photos.",
        details: error.message
    });
}
    }
);

// Check a photo of completed questions or work.
app.post(
    "/api/verify/questions",
    upload.single("work"),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    error: "Upload a photo or screenshot of your work."
                });
            }

            const task = (req.body.task || "").trim();

            if (!task) {
                return res.status(400).json({
                    error: "Describe the questions or work you completed."
                });
            }

            const result = await askGemma(
                `You are checking whether submitted work is relevant
to a claimed task. Task: "${task}"

Inspect the image for visible evidence of relevant completed work.
Do not claim you can reliably detect AI-generated images.
If evidence is unclear, do not approve.

Return JSON only:
{"approved":true,"reason":"short explanation"}`,
                [req.file.buffer.toString("base64")]
            );

            const approved = result.approved === true;
            const points = approved ? 15 : 0;

            await saveSubmission({
                type: "Questions",
                description: task,
                points,
                approved
            });

            res.json({
                approved,
                points,
                reason: String(result.reason || "Review completed.")
                    .slice(0, 300)
            });
        } catch (error) {
            console.error(error.message);
            res.status(502).json({
                error: "Could not check the work. Check Ollama and Gemma."
            });
        }
    }
);

// Demo study completion endpoint.
app.post("/api/study/complete", async (req, res) => {
    const minutes = Number(req.body.minutes);

    if (!Number.isFinite(minutes) || minutes < 25 || minutes > 180) {
        return res.status(400).json({
            error: "Study sessions must be between 25 and 180 minutes."
        });
    }

    const points = Math.floor(minutes / 25) * 20;

    try {
        await saveSubmission({
            type: "Study",
            description: `${minutes}-minute study session`,
            points,
            approved: true
        });

        res.json({ points });
    } catch (error) {
        res.status(500).json({ error: "Could not save study session." });
    }
});

async function startServer() {
    if (process.env.MONGODB_URI) {
        try {
            await mongoose.connect(process.env.MONGODB_URI);
            dbConnected = true;
            console.log("MongoDB connected.");
        } catch (error) {
            console.error("MongoDB connection failed:", error.message);
        }
    } else {
        console.log("MongoDB not configured. Using demo memory.");
    }

    app.listen(PORT, () => {
        console.log(`TaskBucks running at http://localhost:${PORT}`);
    });
}

startServer();