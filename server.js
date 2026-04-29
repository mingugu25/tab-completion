const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, "public");
let hasRetriedAfterPortKill = false;

function generateCompletionWithLlm(_prefix, _language) {
  // Placeholder for real LLM call when API key is available.
  // Current fallback is empty completion.
  return "";
}

function countUnescapedChar(text, char) {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === char && text[i - 1] !== "\\") {
      count += 1;
    }
  }
  return count;
}

function isLikelyInStringOrComment(text) {
  const lines = text.split("\n");
  const lastLine = lines[lines.length - 1] || "";
  if (lastLine.includes("//")) {
    return true;
  }

  const singleCount = countUnescapedChar(text, "'");
  const doubleCount = countUnescapedChar(text, "\"");
  const backtickCount = countUnescapedChar(text, "`");
  return singleCount % 2 === 1 || doubleCount % 2 === 1 || backtickCount % 2 === 1;
}

function generateCompletion(prefix, language = "plaintext") {
  const trimmed = (prefix || "").trimEnd();
  if (!trimmed) {
    return "function hello() {\n  return \"hello\";\n}";
  }

  const lastLine = trimmed.split("\n").pop() || "";
  const lastLineTrimmed = lastLine.trim();
  const inStringOrComment = isLikelyInStringOrComment(trimmed);

  if (!inStringOrComment) {
    if (trimmed.endsWith("(")) {
      return ")";
    }

    if (trimmed.endsWith("[")) {
      return "]";
    }

    if (trimmed.endsWith("'")) {
      return "'";
    }

    if (trimmed.endsWith("\"")) {
      return "\"";
    }

    if (trimmed.endsWith("`")) {
      return "`";
    }
  }

  if (trimmed.endsWith(".")) {
    return "toString()";
  }

  if (trimmed.endsWith("console")) {
    return ".log()";
  }

  if (trimmed.endsWith("console.")) {
    return "log()";
  }

  if (trimmed.endsWith("req.")) {
    return "body";
  }

  if (trimmed.endsWith("res.")) {
    return "status(200).json({})";
  }

  if (lastLineTrimmed === "if" || trimmed.endsWith("if (")) {
    return " (condition) {\n  \n}";
  }

  if (lastLineTrimmed === "for" || trimmed.endsWith("for (")) {
    return " (let i = 0; i < ; i++) {\n  \n}";
  }

  if (lastLineTrimmed === "function" || trimmed.endsWith("function ")) {
    return "name() {\n  \n}";
  }

  if (lastLineTrimmed === "try") {
    return " {\n  \n} catch (error) {\n  \n}";
  }

  if (!inStringOrComment && trimmed.endsWith("{")) {
    return "\n  \n}";
  }
  
  // Rule does not match: fallback to LLM completion.
  return generateCompletionWithLlm(trimmed, language);
}

function removeOverlap(prefix, completion) {
  const maxOverlap = Math.min(prefix.length, completion.length);
  for (let i = maxOverlap; i > 0; i -= 1) {
    if (prefix.slice(-i) === completion.slice(0, i)) {
      return completion.slice(i);
    }
  }
  return completion;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    const typeMap = {
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
    };
    res.writeHead(200, { "Content-Type": typeMap[ext] || "text/plain; charset=utf-8" });
    res.end(data);
  });
}

function killProcessOnPort(port, callback) {
  exec(`lsof -ti tcp:${port} -sTCP:LISTEN`, (err, stdout) => {
    if (err || !stdout.trim()) {
      callback(false);
      return;
    }

    const pids = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => Number.parseInt(line, 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);

    if (!pids.length) {
      callback(false);
      return;
    }

    let killedAny = false;
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGTERM");
        killedAny = true;
      } catch (_killErr) {
        // Ignore kill failures and continue with other PIDs.
      }
    }
    callback(killedAny);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/v1/completions") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const { prefix = "", language = "plaintext" } = parsed;
        const safePrefix = String(prefix).slice(-100);
        const rawCompletion = generateCompletion(safePrefix, language);
        const completion = removeOverlap(safePrefix, String(rawCompletion)).slice(0, 300);

        sendJson(res, 200, {
          completion,
          meta: {
            usedPrefixLength: safePrefix.length,
            language,
          },
        });
      } catch (_err) {
        sendJson(res, 400, { error: "Invalid JSON body" });
      }
    });
    return;
  }

  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    serveFile(res, path.join(publicDir, "index.html"));
    return;
  }
  if (req.method === "GET" && req.url === "/main.js") {
    serveFile(res, path.join(publicDir, "main.js"));
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    if (hasRetriedAfterPortKill) {
      console.error(`Port ${PORT} is still in use after auto-kill. Try another port, e.g. PORT=3001 node server.js`);
      process.exit(1);
      return;
    }

    hasRetriedAfterPortKill = true;
    console.warn(`Port ${PORT} is already in use. Attempting to terminate the process on that port...`);
    killProcessOnPort(PORT, (killedAny) => {
      if (!killedAny) {
        console.error(`Could not auto-kill process on port ${PORT}. Try another port, e.g. PORT=3001 node server.js`);
        process.exit(1);
        return;
      }
      setTimeout(() => {
        server.listen(PORT);
      }, 300);
    });
    return;
  }

  if (err && err.code === "EACCES") {
    console.error(`Permission denied for port ${PORT}. Try a higher port, e.g. PORT=3001 node server.js`);
    process.exit(1);
    return;
  }
  console.error("Server failed to start:", err);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`tab-completion-mvp running at http://localhost:${PORT}`);
});
