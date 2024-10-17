const express = require('express');
const axios = require('axios');
const multer = require('multer');
const morgan = require('morgan');
const winston = require('winston');
const fs = require('fs');
const { createWriteStream, promises: fsPromises } = require('fs');
const path = require('path');
const getmac = require('getmac');
const { promisify } = require('util');
const { pipeline } = require('stream');

const app = express();
const port = 3000;

// Create a directory for file uploads
const uploadDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

// Create a directory for downloaded files
const downloadDir = path.join(__dirname, 'view-gens');
fs.mkdirSync(downloadDir, { recursive: true });

// Log file for generation statuses
const logFilePath = path.join(__dirname, 'generation.log');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  },
});
const upload = multer({ storage: storage });

// Configure Winston for logging
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

// Use Morgan for HTTP request logging
app.use(morgan('dev', { stream: { write: (message) => logger.info(message) } }));

// Serve static files from the public folder
app.use(express.static(path.join(__dirname, 'public')));

// Serve the log file
app.get('/logs/global', (req, res) => {
  fs.readFile(logFilePath, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading generation log:', err.message);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
    res.send(data);
  });
});

// Serve the dashboard.html file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html')); // Adjust the path as necessary
});

// Serve the dashboard.html file
app.get('/global-logs', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'global-logs.html')); // Adjust the path as necessary
});


// Function to log generation status
function logGenerationStatus(message) {
  const timestamp = new Date().toISOString();
  const macAddress = getmac.default(); // Get MAC address
  const logEntry = `${timestamp} - MAC: ${macAddress} - ${message}\n`;
  fs.appendFileSync(logFilePath, logEntry);
}

// Endpoint to get package info
app.get('/package-info/:packageName', async (req, res) => {
  const { packageName } = req.params;

  try {
    const response = await axios.get(`https://registry.npmjs.org/${packageName}`);
    const packageInfo = response.data;

    const responseData = {
      packageName: packageInfo.name,
      latestVersion: packageInfo['dist-tags'].latest,
      packageURL: packageInfo.versions[packageInfo['dist-tags'].latest].dist.tarball,
    };

    res.json(responseData);
  } catch (error) {
    logger.error(`Error fetching package information: ${error.message}`);
    res.status(500).json({ error: 'Error fetching package information' });
  }
});

// Rate-limited download endpoint
app.post('/download/:packageName/:count', async (req, res) => {
  const { packageName, count } = req.params;

  try {
    // Validate input
    if (!isValidPackageName(packageName) || !isValidCount(count)) {
      return res.status(400).json({ error: 'Invalid input. Please provide a valid package name and count.' });
    }

    // Retrieve package information
    const infoResponse = await axios.get(`https://registry.npmjs.org/${packageName}`);
    const packageInfo = infoResponse.data;

    // Use streaming for faster and more memory-efficient downloads
    await downloadPackageStream(packageInfo, downloadDir, packageName, count);

    // Log success message
    logGenerationStatus(`Successfully boosted views for ${packageName} with count: ${count}`);

    // Schedule cleanup after 10 seconds
    setTimeout(() => {
      // Remove downloaded files
      cleanupDownloadedFiles(downloadDir, packageName);
    }, 10000);

    res.json({ message: `🚀 Boosted views for ${packageName}! Successfully simulated ${count} views. Changes can be seen after 24 hours` });
  } catch (error) {
    const errorMessage = `Failed to boost views for ${packageName}: ${error.message}`;
    logger.error(errorMessage);
    logGenerationStatus(errorMessage);
    res.status(500).json({ error: `Failed to boost views for the package: ${packageName} Reason: ${error.message}` });
  }
});

// Cleanup downloaded files
async function cleanupDownloadedFiles(downloadDir, packageName) {
  try {
    const files = await fsPromises.readdir(downloadDir);
    const packageFiles = files.filter(file => file.startsWith(packageName));
    const deletePromises = packageFiles.map(file => fsPromises.unlink(path.join(downloadDir, file)));
    await Promise.all(deletePromises);
    console.log(`Cleaned up downloaded files for ${packageName}.`);
  } catch (error) {
    console.error(`Error cleaning up downloaded files: ${error.message}`);
  }
}

// Download package using streaming
async function downloadPackageStream(packageInfo, downloadDir, packageName, count) {
  const downloadPromises = Array.from({ length: parseInt(count) }, (_, i) =>
    downloadPackageStreamSingle(packageInfo, downloadDir, packageName, i + 1)
  );

  // Wait for all streaming downloads to complete
  await Promise.all(downloadPromises);
}

// Download a single package using streaming
async function downloadPackageStreamSingle(packageInfo, downloadDir, packageName, index) {
  const maxDownloadAttempts = 5;
  let attempts = 0;

  while (attempts < maxDownloadAttempts) {
    try {
      const latestVersion = packageInfo['dist-tags'].latest;
      const versionInfo = packageInfo.versions[latestVersion];

      if (!versionInfo || !versionInfo.dist || !versionInfo.dist.tarball) {
        throw new Error(`Tarball URL not found for ${packageName}`);
      }

      const downloadUrl = versionInfo.dist.tarball;
      const filePath = path.join(downloadDir, `${packageName}_${index}.tgz`);

      const response = await axios.get(downloadUrl, { responseType: 'stream' });

      await new Promise((resolve, reject) => {
        const writer = createWriteStream(filePath);
        let downloadedBytes = 0;
        let totalBytes = 0;

        response.data.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (totalBytes === 0) {
            totalBytes = parseInt(response.headers['content-length'], 10);
          }
        });

        pipeline(response.data, writer, (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });

      return; // Download succeeded, exit the loop
    } catch (error) {
      attempts++;
      const errorMessage = `Failed to download the package '${packageName}' during attempt #${index}, retrying (${attempts}/${maxDownloadAttempts}): ${error.message}.`;
      console.error(errorMessage);
      logGenerationStatus(errorMessage); // Log the download error
      await new Promise(resolve => setTimeout(resolve, 1000)); // Adjust retry delay as needed
    }
  }

  throw new Error(`Exceeded maximum download attempts for ${packageName}`);
}

// Validation functions
function isValidPackageName(name) {
  return /^[a-zA-Z0-9-_]+$/.test(name);
}

function isValidCount(count) {
  const parsedCount = parseInt(count, 10);
  return !isNaN(parsedCount) && parsedCount > 0;
}

// Middleware to log additional information in colored JSON format
app.use((req, res, next) => {
  const logInfo = {
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url,
    body: req.body,
    headers: req.headers,
  };
  console.log('\x1b[34m%s\x1b[0m', 'Request Log:', JSON.stringify(logInfo, null, 2));
  next();
});

// Endpoint to handle file uploads
app.post('/upload', upload.single('file'), (req, res) => {
  if (req.file) {
    const uploadedFilePath = path.join(uploadDir, req.file.filename);
    logger.info(`File uploaded: ${req.file.originalname}, Path: ${uploadedFilePath}`);
    res.json({ message: 'File uploaded successfully' });
  } else {
    logger.error('No file uploaded');
    res.status(400).json({ error: 'No file uploaded' });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
