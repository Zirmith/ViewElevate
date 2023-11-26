const express = require('express');
const axios = require('axios');
const multer = require('multer');
const morgan = require('morgan');
const winston = require('winston');
const fs = require('fs');
const path = require('path');
const getmac = require('getmac');

const MAC_ADDRESS = getmac.default();
const app = express();
const port = 3000;

// Create a directory for file uploads
const uploadDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

// Create a directory for downloaded files
const downloadDir = path.join(__dirname, 'view-gens');
fs.mkdirSync(downloadDir, { recursive: true });

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
app.use(morgan('combined', { stream: { write: (message) => logger.info(message) } }));


// Serve static files from the public folder
app.use(express.static(path.join(__dirname, 'public')));

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




// Apply rate limiting only to the /download endpoint
app.post('/download/:packageName/:count', async (req, res) => {
    const { packageName, count } = req.params;
  
    try {
      // Validate input
      if (!isValidPackageName(packageName) || !isValidCount(count)) {
        return res.status(400).json({ error: 'Invalid input. Please provide a valid package name and count.' });
      }
  
      // Get MAC address dynamically for each request
      const dynamicMACAddress = getmac.default();
  
      // Retrieve package information
      const infoResponse = await axios.get(`https://registry.npmjs.org/${packageName}`);
      const packageInfo = infoResponse.data;
  
      // Create the 'view-gens' directory if it doesn't exist
      const downloadDir = path.join(__dirname, 'view-gens');
      fs.mkdirSync(downloadDir, { recursive: true });
  
      // Use concurrency for faster downloads
      const downloadPromises = Array.from({ length: parseInt(count) }, (_, i) =>
        downloadPackage(packageInfo, downloadDir, packageName, i + 1)
      );
  
      // Wait for all downloads to complete
      await Promise.all(downloadPromises);

       // Schedule cleanup after 10 seconds
    setTimeout(() => {
        // Remove downloaded files
        cleanupDownloadedFiles(downloadDir, packageName, parseInt(count));
      }, 10000);
  
      res.json({ message: `🚀 Boosted views for ${packageName}! Successfully simulated ${count} views. Changes can we seen after 24 hours` });
    } catch (error) {
      logger.error(`Failed to boost views for ${packageName}: ${error.message}`);
      res.status(500).json({ error: 'Failed to boost views for the package. Please try again.' });
    }
  });

  // Function to remove downloaded files
function cleanupDownloadedFiles(downloadDir, packageName, count) {
    for (let i = 1; i <= count; i++) {
      const filePath = path.join(downloadDir, `${packageName}-download-${i}.tgz`);
      fs.unlinkSync(filePath);
      logger.info(`Deleted ${filePath}`);
    }
  }
  
  async function downloadPackage(packageInfo, downloadDir, packageName, attempt) {
    const downloadResponse = await axios.get(packageInfo.versions[packageInfo['dist-tags'].latest].dist.tarball, {
      responseType: 'stream',
    });
  
    const filePath = path.join(downloadDir, `${packageName}-download-${attempt}.tgz`);
    const fileStream = fs.createWriteStream(filePath);
  
    // Log progress
    logger.info(`Downloading ${packageName} - Attempt ${attempt}`);
  
    return new Promise((resolve, reject) => {
      downloadResponse.data.pipe(fileStream);
  
      fileStream.on('finish', () => {
        logger.info(`Downloaded ${packageName} - Attempt ${attempt} - Saved locally at ${filePath}`);
        resolve();
      });
  
      fileStream.on('error', (err) => {
        logger.error(`Error saving ${packageName} - Attempt ${attempt}: ${err.message}`);
        reject(err);
      });
    });
  }
  
  function isValidPackageName(name) {
    // Add your package name validation logic here
    return /^[a-zA-Z0-9-_]+$/.test(name);
  }
  
  function isValidCount(count) {
    const parsedCount = parseInt(count, 10);
    return !isNaN(parsedCount) && parsedCount > 0;
  }

// Endpoint to handle file uploads
app.post('/upload', upload.single('file'), (req, res) => {
  // Access the uploaded file using req.file
  if (req.file) {
    const uploadedFilePath = path.join(uploadDir, req.file.filename);
    logger.info(`File uploaded: ${req.file.originalname}, Path: ${uploadedFilePath}`);
    res.json({ message: 'File uploaded successfully' });
  } else {
    logger.error('No file uploaded');
    res.status(400).json({ error: 'No file uploaded' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
