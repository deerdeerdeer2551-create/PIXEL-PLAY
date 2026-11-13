require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");
const dictionary = require("./dictionary.json");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "..")));

const rooms = new Map();
const validCategories = new Set(Object.keys(dictionary));

function normalizeThai(value) {
  return String(value || "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[่-๋์]/g, "")
    .replace(/^[เแโใไ]/, "");
}

function findSuggestedWord(category, letter, exclude = "") {
  const words = dictionary[category] || [];
  const target = normalizeThai(letter);
  const excluded = normalizeThai(exclude);
  return words.find(word =>
    normalizeThai(word).startsWith(target) &&
    normalizeThai(word) !== excluded
  ) || null;
}

function roomView(room) {
  return {
    code: room.code,
    players: [...room.players.values()].map(player => ({ name: player.name }))
  };
}
function makeCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

io.on("connection", socket => {
  socket.on("create-room", ({ name } = {}) => {
    const code = makeCode();
    const room = { code, players: new Map() };
    room.players.set(socket.id, { name: String(name || "ผู้เล่น").slice(0, 18) });
    rooms.set(code, room);
    socket.join(code);
    socket.data.room = code;
    socket.emit("room-created", roomView(room));
  });

  socket.on("join-room", ({ name, code } = {}) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room) return socket.emit("room-error", "ไม่พบห้องนี้");
    if (room.players.size >= 8) return socket.emit("room-error", "ห้องเต็มแล้ว");
    room.players.set(socket.id, { name: String(name || "ผู้เล่น").slice(0, 18) });
    socket.join(room.code);
    socket.data.room = room.code;
    socket.emit("room-joined", roomView(room));
    io.to(room.code).emit("room-update", roomView(room));
  });

  socket.on("disconnect", () => {
    const code = socket.data.room;
    const room = rooms.get(code);
    if (!room) return;
    room.players.delete(socket.id);
    if (!room.players.size) rooms.delete(code);
    else io.to(code).emit("room-update", roomView(room));
  });
});


app.get("/api/round/:letter", (req, res) => {
  const letter = String(req.params.letter || "").trim();
  const primary = [
    "ของใช้ภายในบ้าน",
    "ของกิน",
    "ของใช้ส่วนตัว",
    "สัตว์",
    "อาชีพ"
  ];
  const fallbackOrder = [
    "ของใช้ในชีวิตประจำวัน",
    "พืช",
    "สถานที่",
    "ธรรมชาติ",
    "คำทั่วไป"
  ];

  const hasWord = category =>
    (dictionary[category] || []).some(word =>
      normalizeThai(word).startsWith(normalizeThai(letter))
    );

  // Keep every original category that has a valid word for this letter.
  const availablePrimary = new Set(primary.filter(hasWord));
  const used = new Set();
  const usedWords = new Set();
  const selected = [];

  for (const preferred of primary) {
    let category = null;

    if (hasWord(preferred) && !used.has(preferred)) {
      category = preferred;
    } else {
      // First use dedicated backup categories, then any remaining dictionary category.
      const candidates = [
        ...fallbackOrder,
        ...Object.keys(dictionary)
      ];
      category = candidates.find(name =>
        !used.has(name) &&
        !availablePrimary.has(name) &&
        hasWord(name)
      ) || candidates.find(name => !used.has(name) && hasWord(name));
    }

    if (category) {
      const suggestion = (dictionary[category] || []).find(word =>
        normalizeThai(word).startsWith(normalizeThai(letter)) &&
        !usedWords.has(normalizeThai(word))
      ) || null;

      // If this category only contains an answer already used in this round,
      // select another unused category that has a distinct example answer.
      if (!suggestion) {
        const alternatives = [...fallbackOrder, ...Object.keys(dictionary)];
        const replacement = alternatives.find(name =>
          !used.has(name) &&
          (dictionary[name] || []).some(word =>
            normalizeThai(word).startsWith(normalizeThai(letter)) &&
            !usedWords.has(normalizeThai(word))
          )
        );
        if (replacement) {
          category = replacement;
          const replacementWord = dictionary[category].find(word =>
            normalizeThai(word).startsWith(normalizeThai(letter)) &&
            !usedWords.has(normalizeThai(word))
          );
          used.add(category);
          usedWords.add(normalizeThai(replacementWord));
          selected.push({ name: category, suggestion: replacementWord });
        }
      } else {
        used.add(category);
        usedWords.add(normalizeThai(suggestion));
        selected.push({ name: category, suggestion });
      }
    }
  }

  // A round is only issued when all five slots have a usable category and answer.
  if (selected.length !== 5 || selected.some(item => !item.suggestion)) {
    return res.status(422).json({
      letter,
      ready: false,
      message: "ตัวอักษรนี้ยังมีคำศัพท์สำรองไม่ครบ 5 หมวด"
    });
  }

  res.json({ letter, ready: true, categories: selected });
});

// Hybrid validation: dictionary first, AI fallback second.
// AI keys stay on the server and are never sent to the browser.
app.post("/api/validate", async (req, res) => {
  const { letter, category, answer } = req.body || {};
  if (!letter || !category || !answer) {
    return res.status(400).json({ valid: false, source: "input", reason: "กรุณากรอกข้อมูลให้ครบ" });
  }
  if (!validCategories.has(category)) {
    return res.status(400).json({ valid: false, source: "input", reason: "ไม่พบหมวดหมู่นี้" });
  }

  const cleanAnswer = String(answer).trim().slice(0, 80);
  const normalized = normalizeThai(cleanAnswer);
  const normalizedLetter = normalizeThai(letter);

  if (!normalized.startsWith(normalizedLetter)) {
    return res.json({ valid: false, source: "rule", reason: `คำตอบต้องขึ้นต้นด้วย ${letter}` });
  }

  const wordList = dictionary[category] || [];
  const found = wordList.find(word => normalizeThai(word) === normalized);
  if (found) {
    return res.json({
      valid: true,
      source: "dictionary",
      reason: "พบคำนี้ในฐานข้อมูลคำศัพท์ภาษาไทย"
    });
  }

  const apiKey = process.env.AI_API_KEY;
  const baseUrl = process.env.AI_BASE_URL;
  const model = process.env.AI_MODEL;

  if (!apiKey || !baseUrl || !model) {
    const suggestion = findSuggestedWord(category, letter, cleanAnswer);
    return res.json({
      valid: false,
      source: "dictionary",
      suggestion,
      reason: suggestion
        ? "คำตอบนี้ไม่ตรงกับฐานข้อมูล คำเฉลยตัวอย่างอยู่ด้านล่าง"
        : "ไม่พบคำตอบตัวอย่างในฐานข้อมูลสำหรับหมวดนี้และตัวอักษรนี้"
    });
  }

  try {
    const response = await fetch(baseUrl.replace(/\/+$/, "") + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: "คุณเป็นผู้ตรวจคำศัพท์ภาษาไทยเพื่อเกมการศึกษา ตรวจว่าคำตอบเป็นคำภาษาไทยที่มีความหมาย ใช้จริง และอยู่ในหมวดหมู่ที่กำหนดหรือไม่ โดยต้องขึ้นต้นด้วยพยัญชนะที่กำหนด ตอบเป็น JSON object เท่านั้น มี key valid (boolean) และ reason (string) หากไม่แน่ใจให้ valid=false ห้ามเดาความหมาย"
          },
          {
            role: "user",
            content: JSON.stringify({ initial: letter, category, answer: cleanAnswer })
          }
        ],
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      return res.json({
        valid: false,
        source: "ai-error",
        reason: "AI ตรวจสอบไม่สำเร็จ จึงนับเป็นคำตอบผิด"
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    const result = JSON.parse(content);
    const valid = result.valid === true;

    return res.json({
      valid,
      source: "ai",
      suggestion: valid ? null : findSuggestedWord(category, letter, cleanAnswer),
      reason: valid
        ? "AI ตรวจแล้วว่าเป็นคำที่ใช้ได้และตรงกับหมวดหมู่"
        : String(result.reason || "AI ไม่สามารถยืนยันคำตอบนี้ได้ จึงนับเป็นคำตอบผิด")
    });
  } catch (error) {
    return res.json({
      valid: false,
      source: "ai-error",
      reason: "เกิดข้อผิดพลาดระหว่างตรวจด้วย AI จึงนับเป็นคำตอบผิด"
    });
  }
});

app.get("/api/status", (_req, res) => {
  res.json({
    ok: true,
    dictionaryCategories: Object.keys(dictionary).length,
    dictionaryWords: Object.values(dictionary).reduce((total, words) => total + words.length, 0),
    aiConfigured: Boolean(process.env.AI_API_KEY && process.env.AI_BASE_URL && process.env.AI_MODEL)
  });
});

app.get("/health", (_req, res) => res.json({ ok: true, rooms: rooms.size }));

server.listen(PORT, () => {
  console.log(`PIXEL PLAY running at http://localhost:${PORT}`);
  console.log(`Dictionary ready: ${Object.values(dictionary).reduce((n, words) => n + words.length, 0)} words`);
  console.log(`AI fallback: ${process.env.AI_API_KEY && process.env.AI_BASE_URL && process.env.AI_MODEL ? "configured" : "not configured"}`);
});
