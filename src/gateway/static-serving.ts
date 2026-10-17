import express, { Express, Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { servePlatformHomepage } from './platform-homepage.js';

const DIST_PATHS = {
  jurexio-citizen: path.resolve(process.cwd(), 'jurexio-citizen-citizen/dist'),
  professional: path.resolve(process.cwd(), 'nyayasiddhi-professional/dist'),
  console: path.resolve(process.cwd(), 'dist/public'),
};

function createSPAHandler(distDir: string) {
  const staticMiddleware = express.static(distDir, {
    index: false,
    redirect: false,
    setHeaders: (res, filePath) => {
      const ext = path.extname(filePath);
      if (ext === '.html') {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else if (ext === '.js' || ext === '.css' || ext === '.woff2' || ext === '.woff') {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  });

  return (req: Request, res: Response, next: NextFunction) => {
    staticMiddleware(req, res, () => {
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        return res.sendFile(indexPath);
      }
      return next();
    });
  };
}

export function mountStaticFrontends(app: Express) {
  const consoleDist = DIST_PATHS.console;

  if (fs.existsSync(consoleDist)) {
    const consoleHandler = createSPAHandler(consoleDist);

    // Serve root-level public static files (images, icons, logos) from dist/public
    app.use(express.static(consoleDist, {
      index: false,
      redirect: false,
      setHeaders: (res, filePath) => {
        const ext = path.extname(filePath);
        if (['.png', '.jpg', '.jpeg', '.svg', '.ico', '.webp'].includes(ext)) {
          res.setHeader('Cache-Control', 'public, max-age=86400');
        }
      }
    }));

    app.use('/console', consoleHandler);
    app.use('/assets', express.static(path.join(consoleDist, 'assets'), {
      maxAge: '1y',
      immutable: true,
    }));
    app.get('/sw.js', (req, res) => {
      res.sendFile(path.join(consoleDist, 'sw.js'));
    });
    app.get('/', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(consoleDist, 'index.html'));
    });
    app.get('*', (req: Request, res: Response, next: NextFunction) => {
      const reqPath = req.path;
      if (reqPath.startsWith('/api') || reqPath.startsWith('/health') || reqPath.startsWith('/nys') || reqPath.startsWith('/nyv') || reqPath.startsWith('/professional') || reqPath.startsWith('/jurexio-citizen') || reqPath.startsWith('/institutional') || reqPath.startsWith('/governance') || reqPath.startsWith('/academy')) {
        return next();
      }
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(consoleDist, 'index.html'));
    });
  } else {
    app.get('/', (req, res) => {
      servePlatformHomepage(req, res);
    });
  }

  for (const [name, distDir] of Object.entries(DIST_PATHS)) {
    if (name !== 'console' && fs.existsSync(distDir)) {
      const handler = createSPAHandler(distDir);
      app.use(`/${name}`, handler);
    }
  }

  app.get('/institutional', placeholderPage('Jurexio Institutional™', 'Enterprise Legal Governance Platform', '#059669', '/api/jrx/ins'));
  app.get('/governance', placeholderPage('Jurexio Ministry™', 'Sovereign Regulatory Infrastructure', '#DC2626', '/api/jrx/gov'));
  app.get('/academy', placeholderPage('Jurexio Academy™', 'Legal Intelligence Training Platform', '#D97706', '/api/jrx/ace'));
}

function placeholderPage(name: string, subtitle: string, color: string, apiPrefix: string) {
  return (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${name}™</title>
<style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:Inter,sans-serif;background:#0A1628;color:#E2E8F0;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;text-align:center;padding:24px;}.icon{width:80px;height:80px;border-radius:20px;background:${color}22;display:flex;align-items:center;justify-content:center;font-size:2.5rem;margin-bottom:24px;}h1{font-size:2rem;margin-bottom:8px;}h2{color:${color};font-size:1rem;font-weight:500;margin-bottom:24px;}.info{background:#111B2E;border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:24px;max-width:400px;margin-bottom:24px;}.info p{color:#94A3B8;font-size:0.9rem;line-height:1.6;margin-bottom:12px;}.info code{background:rgba(212,160,23,0.1);color:#D4A017;padding:2px 6px;border-radius:4px;font-size:0.8rem;}a{color:#2563EB;text-decoration:none;font-weight:500;}</style></head>
<body><div class="icon">&#127963;</div><h1>${name}™</h1><h2>${subtitle}</h2><div class="info"><p>This platform's frontend is planned for Phase 2. The backend API is ready and operational.</p><p>API Prefix: <code>${apiPrefix}/*</code></p><p>Test the API at <code>${apiPrefix}/health</code></p></div><a href="/">&larr; Back to Platform Home</a></body></html>`);
  };
}
