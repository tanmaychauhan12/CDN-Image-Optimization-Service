const express = require('express');
const healthRoutes = require('./routes/health');
const uploadRoutes = require('./routes/upload');
const imagesRoutes = require('./routes/images');
const errorHandler = require('./middleware/errorHandler');
const logger = require('./utils/logger');

// Initialize express application
const app = express();

// Basic middleware configurations
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware (simple console logs for developer experience)
app.use((req, res, next) => {
  logger.http(`${req.method} ${req.originalUrl}`);
  next();
});

// Register api v1 routes
app.use('/api/v1/health', healthRoutes);
app.use('/api/v1/upload', uploadRoutes);
app.use('/api/v1/images', imagesRoutes);

// Catch-all 404 handler for unmatched routes
app.use((req, res, next) => {
  const err = new Error(`Cannot find requested route ${req.method} ${req.originalUrl}`);
  err.status = 404;
  next(err);
});

// Mount errorHandler middleware last
app.use(errorHandler);

module.exports = app;
