const $ = (selector) => document.querySelector(selector);

let remainingSeconds = 25 * 60;
let timerInterval = null;
let cameraStream = null;
let timerRunning = false;
let timerPaused = false;

function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.style.display = "block";
    clearTimeout(showToast.timeout);
    showToast.timeout = setTimeout(() => {
        toast.style.display = "none";
    }, 3000);
}

function showSection(sectionId) {
    document.querySelectorAll(".section").forEach(section => {
        section.classList.toggle("hidden", section.id !== sectionId);
    });

    document.querySelectorAll(".nav-item").forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.section === sectionId
        );
    });

    const titles = {
        dashboard: "Make today count.",
        chores: "Every chore counts.",
        study: "Focus on your goals.",
        questions: "Show what you've learned."
    };

    $("#page-title").textContent = titles[sectionId] || "TaskBucks";
    window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll(".nav-item").forEach(button => {
    button.addEventListener("click", () => {
        showSection(button.dataset.section);
    });
});

async function loadDashboard() {
    try {
        const response = await fetch("/api/dashboard");
        const data = await response.json();

        $("#points").textContent = data.points ?? 0;
        updateRedemption(Number(data.points) || 0);

        const activity = $("#activity");
        activity.innerHTML = "";

        if (!data.submissions || data.submissions.length === 0) {
            activity.innerHTML =
                '<p class="empty-state">Your completed tasks will appear here.</p>';
            return;
        }

        data.submissions.forEach(item => {
            const row = document.createElement("div");
            row.className = "activity-item";

            const details = document.createElement("div");
            const name = document.createElement("strong");
            const description = document.createElement("small");

            name.textContent = item.type;
            description.textContent =
                `${item.description} · ${item.approved ? "Approved" : "Not approved"}`;

            details.append(name, description);

            const points = document.createElement("span");
            points.className = "activity-points";
            points.textContent = item.approved ? `+${item.points} pts` : "0 pts";

            row.append(details, points);
            activity.appendChild(row);
        });
    } catch {
        showToast("Couldn't load your dashboard.");
    }
}

async function submitForm(form, endpoint, resultSelector) {
    const resultBox = $(resultSelector);
    const button = form.querySelector('button[type="submit"]');
    const formData = new FormData(form);

    button.disabled = true;
    button.textContent = "Checking...";

    resultBox.className = "result";
    resultBox.textContent = "AI is reviewing your submission. This may take a moment.";

    try {
        const response = await fetch(endpoint, {
            method: "POST",
            body: formData
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Submission failed.");
        }

        resultBox.className = `result ${data.approved ? "success" : "failure"}`;
        resultBox.textContent = data.approved
            ? `✓ Approved! You earned ${data.points} points. ${data.reason || ""}`
            : `Not approved yet. ${data.reason || "Please review your submission."}`;

        if (data.approved) {
            form.reset();
        }

        await loadDashboard();
    } catch (error) {
        resultBox.className = "result failure";
        resultBox.textContent = error.message;
    } finally {
        button.disabled = false;
        button.textContent = endpoint.includes("chore")
            ? "Verify my chore"
            : "Check my work";
    }
}

$("#chore-form").addEventListener("submit", event => {
    event.preventDefault();
    submitForm(event.currentTarget, "/api/verify/chore", "#chore-result");
});

$("#questions-form").addEventListener("submit", event => {
    event.preventDefault();
    submitForm(event.currentTarget, "/api/verify/questions", "#questions-result");
});

// Study timer
function updateTimerDisplay() {
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;

    $("#timer").textContent =
        `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    timerRunning = false;
}

$("#start-timer").addEventListener("click", () => {
    if (timerRunning) return;

    if (remainingSeconds <= 0) {
        showToast("Reset the timer to start another session.");
        return;
    }

    timerRunning = true;
    timerPaused = false;
    $("#timer-status").textContent = "Focus time. You've got this!";

    timerInterval = setInterval(async () => {
        remainingSeconds--;
        updateTimerDisplay();

        if (remainingSeconds <= 0) {
            stopTimer();
            $("#timer-status").textContent = "Session finished!";

            // This is a demo reward, not proof of studying.
            const task = $("#study-task").value.trim() || "Study session";

            try {
                const response = await fetch("/api/study/complete", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ minutes: 25, task })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || "Couldn't save the session.");
                }

                showToast(`Session complete! +${data.points} points`);
                await loadDashboard();
            } catch (error) {
                showToast(error.message);
            }
        }
    }, 1000);
});

$("#pause-timer").addEventListener("click", () => {
    if (!timerRunning) return;

    clearInterval(timerInterval);
    timerInterval = null;
    timerRunning = false;
    timerPaused = true;
    $("#timer-status").textContent = "Paused. Resume when ready.";
});

$("#reset-timer").addEventListener("click", () => {
    stopTimer();
    timerPaused = false;
    remainingSeconds = 25 * 60;
    updateTimerDisplay();
    $("#timer-status").textContent = "Ready when you are.";
});

// Optional camera preview. It does not upload or verify attention.
$("#camera-button").addEventListener("click", async () => {
    const video = $("#camera-preview");
    const button = $("#camera-button");

    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
        video.srcObject = null;
        video.classList.remove("visible");
        button.textContent = "Turn camera on";
        return;
    }

    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false
        });

        video.srcObject = cameraStream;
        video.classList.add("visible");
        button.textContent = "Turn camera off";
    } catch {
        showToast("Camera unavailable. Check browser permissions.");
    }
});

window.addEventListener("beforeunload", () => {
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
    }
});

updateTimerDisplay();
loadDashboard();
// Light and dark mode
const themeToggle = $("#theme-toggle");

function applyTheme(theme) {
    document.body.classList.toggle("dark-mode", theme === "dark");

    $("#theme-icon").textContent =
        theme === "dark" ? "☀️" : "🌙";

    $("#theme-label").textContent =
        theme === "dark" ? "Light mode" : "Dark mode";
}

applyTheme(localStorage.getItem("taskbucks-theme") || "light");

themeToggle.addEventListener("click", () => {
    const isDark = document.body.classList.contains("dark-mode");
    const newTheme = isDark ? "light" : "dark";

    localStorage.setItem("taskbucks-theme", newTheme);
    applyTheme(newTheme);
});

// Points redemption menu
function updateRedemption(points) {
    const unlocked = points >= 150;

    $("#redeem-points").textContent = points;

    $("#redeem-hint").innerHTML = unlocked
        ? "<strong>Redemption unlocked!</strong>"
        : "<strong>Available only at 150 points</strong>";

    $("#redeem-status").textContent = unlocked
        ? "You've reached the minimum points!"
        : `You need ${150 - points} more points to unlock.`;

    $("#redeem-button").disabled = !unlocked;

    $("#redeem-button").textContent = unlocked
        ? "Preview money redemption"
        : "Unlock at 150 points";
}

$("#redeem-button").addEventListener("click", () => {
    const points = Number($("#points").textContent);

    if (points < 150) {
        showToast("You need at least 150 points.");
        return;
    }

    $("#redeem-result").className = "result success";
    $("#redeem-result").textContent =
        "You're eligible! Real-money conversion will be available after the payout system is implemented.";
});