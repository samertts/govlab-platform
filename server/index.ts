import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);
app.disable("x-powered-by");
app.set("trust proxy", 1);

const inMemoryRateWindowMs = 60_000;
const inMemoryRateLimit = 300;
const ipRateCounter = new Map<string, { count: number; windowStart: number }>();

const stateChangingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isTrustedOrigin(req: Request): boolean {
  const origin = req.get("origin");
  if (!origin) return true;
  const trustedOrigins = (process.env.GULA_TRUSTED_ORIGINS || "")
    .split(",")
    .map(v => v.trim())
    .filter(Boolean);
  if (trustedOrigins.includes(origin)) return true;
  const host = req.get("host");
  if (!host) return false;
  try {
    const parsed = new URL(origin);
    return parsed.host === host;
  } catch {
    return false;
  }
}


declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "1mb" }));

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https: wss:;");
  next();
});


app.use((req, res, next) => {
  if (!req.path.startsWith("/api")) return next();
  if (!stateChangingMethods.has(req.method)) return next();
  if (!isTrustedOrigin(req)) {
    return res.status(403).json({ message: "Invalid request origin" });
  }
  return next();
});

app.use((req, res, next) => {
  if (!req.path.startsWith("/api")) return next();

  const now = Date.now();
  const key = req.ip || "unknown";
  const current = ipRateCounter.get(key);
  if (!current || now - current.windowStart > inMemoryRateWindowMs) {
    ipRateCounter.set(key, { count: 1, windowStart: now });
    return next();
  }

  current.count += 1;
  if (current.count > inMemoryRateLimit) {
    res.setHeader("Retry-After", String(Math.ceil((inMemoryRateWindowMs - (now - current.windowStart)) / 1000)));
    return res.status(429).json({ message: "Too many requests" });
  }

  next();
});

setInterval(() => {
  const now = Date.now();
  ipRateCounter.forEach((record, ip) => {
    if (now - record.windowStart > inMemoryRateWindowMs * 2) {
      ipRateCounter.delete(ip);
    }
  });
}, inMemoryRateWindowMs).unref();

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
