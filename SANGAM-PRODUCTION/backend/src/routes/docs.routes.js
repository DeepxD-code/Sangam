'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');

/**
 * SANGAM API Docs Routes
 *
 *   GET /api/docs           → Swagger UI (HTML)
 *   GET /api/docs/openapi.json → Raw OpenAPI 3.0 spec
 *
 * No authentication required — intended for integrators and demo audiences.
 * In production, restrict this route to the classified network.
 */
function createDocsRoutes() {
  const router  = express.Router();
  const specPath = path.join(__dirname, '../../../docs/openapi.json');

  // Serve the raw OpenAPI JSON spec
  router.get('/openapi.json', (req, res) => {
    if (!fs.existsSync(specPath)) {
      return res.status(404).json({ error: 'Spec not found. Run: node backend/scripts/generate-openapi.js' });
    }
    res.setHeader('Content-Type', 'application/json');
    res.sendFile(specPath);
  });

  // Serve Swagger UI (CDN-hosted, no npm package needed)
  router.get('/', (req, res) => {
    const specUrl = `${req.protocol}://${req.get('host')}/api/docs/openapi.json`;
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SANGAM API Documentation</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.2/swagger-ui.css">
  <style>
    body { margin: 0; background: #fafafa; }
    .topbar { display: none !important; }
    .swagger-ui .info .title { font-size: 2em; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.2/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      SwaggerUIBundle({
        url:             '${specUrl}',
        dom_id:          '#swagger-ui',
        presets:         [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
        layout:          'BaseLayout',
        deepLinking:     true,
        tryItOutEnabled: true,
        persistAuthorization: true
      });
    };
  </script>
</body>
</html>`);
  });

  return router;
}

module.exports = createDocsRoutes;
