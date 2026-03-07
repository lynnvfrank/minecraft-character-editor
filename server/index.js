#!/usr/bin/env node

/**
 * Production server: serves static files from dist/ and the API.
 * Run after: npm run build
 */

const express = require('express');
const path = require('path');
const { handleApi } = require('./api.js');

const PORT = parseInt(process.env.PORT || '5173', 10);
const ROOT = path.join(__dirname, '..');

const app = express();

app.use((req, res, next) => {
  handleApi(req, res, () => next());
});

app.use(express.static(path.join(ROOT, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(ROOT, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
