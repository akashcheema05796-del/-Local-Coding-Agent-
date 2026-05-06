import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // --- API Routes for Local Simulation ---

  // 1. System Status Simulation (Dynamic hardware stats)
  app.get("/api/system/status", (req, res) => {
    res.json({
      vram: "16.4GB / 24GB",
      load: Math.floor(Math.random() * 15) + 10 + "%", 
      latency: (Math.floor(Math.random() * 20) + 30) + "ms",
      provider: process.env.LLM_PROVIDER || "gemini"
    });
  });

  // 2. Local LLM Proxy (Ollama / OpenAI compatible)
  app.post("/api/chat/local", async (req, res) => {
    const { messages, model = "gemma2", endpoint = "http://localhost:11434/v1/chat/completions" } = req.body;
    
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: messages.map((m: any) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content
          })),
          stream: true
        })
      });

      if (!response.ok) throw new Error(`Local LLM Error: ${response.statusText}`);

      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          // Standard OpenAI/Ollama stream format parsing
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") break;
              try {
                const json = JSON.parse(data);
                const content = json.choices[0]?.delta?.content || "";
                res.write(content);
              } catch (e) {}
            }
          }
        }
      }
      res.end();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 3. Mock Workspace indexing
  app.get("/api/workspace/info", (req, res) => {
    res.json({
      root: "/usr/local/gemma/work",
      fileCount: 42,
      lastScan: new Date().toISOString()
    });
  });

  // --- Real Workspace Tools ---

  // 1. List Files
  app.get("/api/tools/ls", (req, res) => {
    try {
      const { dir = "." } = req.query;
      const absolutePath = path.resolve(process.cwd(), dir as string);
      const fs = require('fs');
      const files = fs.readdirSync(absolutePath);
      res.json({ files });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 2. Read File
  app.post("/api/tools/read", (req, res) => {
    const { filePath } = req.body;
    try {
      const fs = require('fs');
      const content = fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf-8');
      res.json({ content });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 3. Write File
  app.post("/api/tools/write", (req, res) => {
    const { filePath, content } = req.body;
    try {
      const fs = require('fs');
      fs.writeFileSync(path.resolve(process.cwd(), filePath), content);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Gemma Agent Backend active at http://0.0.0.0:${PORT}`);
  });
}

startServer();
