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
const MAC_ADDRESS = getmac.default();
const app = express();
const port = 3000;
const { pipeline } = require('stream');


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




const readdirAsync = promisify(fs.readdir);
const unlinkAsync = promisify(fs.unlink);

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

    // Use streaming for faster and more memory-efficient downloads
    await downloadPackageStream(packageInfo, downloadDir, packageName, count);

    // Schedule cleanup after 10 seconds
    setTimeout(() => {
      // Remove downloaded files
      cleanupDownloadedFiles(downloadDir, packageName);
    }, 10000);

    res.json({ message: `🚀 Boosted views for ${packageName}! Successfully simulated ${count} views. Changes can be seen after 24 hours` });
  } catch (error) {
    logger.error(`Failed to boost views for ${packageName}: ${error.message}`);
    console.log(error)
    res.status(500).json({ error: 'Failed to boost views for the package. Please try again.' });
  }
});

// Function to cleanup downloaded files
async function cleanupDownloadedFiles(downloadDir, packageName) {
  try {
    // Read all files in the directory
    const files = await readdirAsync(downloadDir);

    // Filter files related to the current package and delete them
    const packageFiles = files.filter(file => file.startsWith(packageName));
    const deletePromises = packageFiles.map(file => unlinkAsync(path.join(downloadDir, file)));

    // Wait for all delete operations to complete
    await Promise.all(deletePromises);

    console.log(`Cleaned up downloaded files for ${packageName}.`);
  } catch (error) {
    console.error(`Error cleaning up downloaded files: ${error.message}`);
  }
}

// Function to download using streaming
// Function to download a single package using streaming
const maxDownloadAttempts = 5; // Adjust as needed
const retryDelay = 3000; // 3 seconds delay between attempts, adjust as needed



async function downloadPackageStreamSingle(packageInfo, downloadDir, packageName, index) {
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

          const progress = Math.round((downloadedBytes / totalBytes) * 100);
          
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
      // Additional logging or handling can be added here

      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }

  throw new Error(`Exceeded maximum download attempts for ${packageName}`);
}

// Function to download using streaming
async function downloadPackageStream(packageInfo, downloadDir, packageName, count) {
  const downloadPromises = Array.from({ length: parseInt(count) }, (_, i) =>
    downloadPackageStreamSingle(packageInfo, downloadDir, packageName, i + 1)
  );

  // Wait for all streaming downloads to complete
  await Promise.all(downloadPromises);
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
