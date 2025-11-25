const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const cors = require('cors');

const app = express();
const PORT = 3003;

// Store active ffmpeg processes
const activeProcesses = new Map();

// Helper function to find ffmpeg executable
const findFfmpeg = () => {
  // Check if ffmpeg is in the project directory
  const localFfmpegPaths = [
    path.join(__dirname, 'ffmpeg', 'bin', 'ffmpeg'),
    path.join(__dirname, 'ffmpeg', 'bin', 'ffmpeg.exe'),
    path.join(__dirname, 'bin', 'ffmpeg'),
    path.join(__dirname, 'bin', 'ffmpeg.exe')
  ];

  for (const ffmpegPath of localFfmpegPaths) {
    if (fs.existsSync(ffmpegPath)) {
      return ffmpegPath;
    }
  }

  // If not found in project directory, return default 'ffmpeg'
  return 'ffmpeg';
};

// Set ffmpeg path
const ffmpegPath = findFfmpeg();
ffmpeg.setFfmpegPath(ffmpegPath);
console.log(`Using ffmpeg path: ${ffmpegPath}`);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Ensure directories exist
const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

// Configure multer for file uploads to memory
const upload = multer({ storage: multer.memoryStorage() });

// Helper function to get image files with proper sorting
const getImageFiles = (folderPath) => {
  const files = fs.readdirSync(folderPath);
  let imageFiles = files.filter(file => {
    const ext = path.extname(file).toLowerCase();
    return ['.png', '.jpg', '.jpeg', '.bmp', '.tiff'].includes(ext);
  });

  // Sort naturally - handle cases like A, A(1), A(2), etc.
  imageFiles.sort((a, b) => {
    // Extract base name and number from filename
    const aMatch = a.match(/^(.+?)\s*\((\d+)\)(\..+)$/);
    const bMatch = b.match(/^(.+?)\s*\((\d+)\)(\..+)$/);
    
    // For files like "LimitReview.png"
    const aBase = aMatch ? aMatch[1] : a.replace(/\..*$/, '');
    const aNum = aMatch ? parseInt(aMatch[2]) : null; // null for files without number
    
    // For files like "LimitReview.png" 
    const bBase = bMatch ? bMatch[1] : b.replace(/\..*$/, '');
    const bNum = bMatch ? parseInt(bMatch[2]) : null; // null for files without number
    
    // First compare base names
    if (aBase !== bBase) {
      return aBase.localeCompare(bBase);
    }
    
    // If base names are the same:
    // 1. Files without numbers come first
    // 2. Files with numbers come after, sorted numerically
    if (aNum === null && bNum === null) return 0;
    if (aNum === null) return -1;  // a has no number, b has number, a comes first
    if (bNum === null) return 1;   // b has no number, a has number, b comes first
    return aNum - bNum;            // both have numbers, sort numerically
  });

  return imageFiles;
};

// Create video from images using ffmpeg
const createVideoFromImages = (imageFolder, outputVideoPath, options) => {
  return new Promise((resolve, reject) => {
    const {
      durationPerImage = 5,
      fps = 30,
      width = null,
      height = null,
      performanceMode = 'normal'
    } = options;

    // Get all image files from the folder with proper sorting
    const imageFiles = getImageFiles(imageFolder);

    if (imageFiles.length === 0) {
      reject(new Error('No image files found'));
      return;
    }

    console.log('Processing images in this order:', imageFiles);
    console.log(`Duration per image: ${durationPerImage}s, FPS: ${fps}, Performance Mode: ${performanceMode}`);

    // Get first image path
    const firstImagePath = path.join(imageFolder, imageFiles[0]);
    
    // Get image dimensions if not specified
    ffmpeg.ffprobe(firstImagePath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }

      const stream = metadata.streams.find(s => s.codec_type === 'video');
      const imgWidth = width || stream.width;
      const imgHeight = height || stream.height;

      // Adjust settings based on performance mode
      let crf = 23;  // Default CRF
      let preset = 'fast';  // Default preset
      let videoCodec = 'libx264';
      
      if (performanceMode === 'low') {
        crf = 28;  // Higher compression, lower quality
        preset = 'ultrafast';  // Fastest encoding
        console.log('Performance mode: Low - Using higher compression and faster encoding');
      } else {
        console.log('Performance mode: Normal');
      }

      // Calculate expected total duration
      const expectedDuration = imageFiles.length * durationPerImage;
      console.log(`Expected video duration: ${expectedDuration} seconds (${imageFiles.length} images × ${durationPerImage}s each)`);

      // Create individual video segments for each image
      const segmentPaths = [];
      let completedSegments = 0;
      
      // Function to process next segment
      const processNextSegment = () => {
        if (completedSegments >= imageFiles.length) {
          // All segments processed, now concatenate them
          concatenateSegments();
          return;
        }
        
        const index = completedSegments;
        const file = imageFiles[index];
        const filePath = path.join(imageFolder, file);
        const segmentPath = path.join(__dirname, 'temp', `segment_${index.toString().padStart(3, '0')}.mp4`);
        segmentPaths.push(segmentPath);
        
        ffmpeg()
          .input(filePath)
          .inputOptions([`-loop 1`, `-t ${durationPerImage}`])
          .videoCodec(videoCodec)
          .size(`${imgWidth}x${imgHeight}`)
          .fps(fps)
          .outputOptions('-crf', crf.toString())
          .outputOptions('-preset', preset)
          .outputOptions('-pix_fmt', 'yuv420p')
          .outputOptions('-colorspace', 'bt709')
          .outputOptions('-color_trc', 'iec61966-2-1')  // sRGB transfer characteristic
          .outputOptions('-color_primaries', 'bt709')
          .outputOptions('-color_range', 'pc')
          .on('end', () => {
            console.log(`Segment ${index} created: ${segmentPath}`);
            completedSegments++;
            processNextSegment(); // Process next segment
          })
          .on('error', (err) => {
            console.error(`Error creating segment ${index}:`, err);
            reject(err);
          })
          .save(segmentPath);
      };
      
      // Function to concatenate all segments
      const concatenateSegments = () => {
        console.log('All segments created, concatenating...');
        
        // Create a temporary file list for ffmpeg concatenation
        const fileListPath = path.join(__dirname, 'temp', 'segments_list.txt');
        const fileListContent = segmentPaths.map(segmentPath => {
          return `file '${segmentPath.replace(/\\/g, '\\\\')}'`;
        }).join('\n');
        fs.writeFileSync(fileListPath, fileListContent);
        
        // Concatenate all segments
        ffmpeg()
          .input(fileListPath)
          .inputOptions(['-f concat', '-safe 0'])
          .videoCodec('copy')
          .on('start', (cmd) => {
            console.log('Started ffmpeg concatenation with command: ' + cmd);
          })
          .on('end', () => {
            console.log('Video concatenation completed successfully');
            // Clean up temporary files
            cleanupTempFiles(fileListPath, segmentPaths);
            resolve(outputVideoPath);
          })
          .on('error', (err) => {
            console.error('Error concatenating video:', err);
            cleanupTempFiles(fileListPath, segmentPaths);
            reject(err);
          })
          .save(outputVideoPath);
      };
      
      // Start processing segments one by one to avoid memory issues
      processNextSegment();
    });
  });
};

// Helper function to clean up temporary files
function cleanupTempFiles(fileListPath, segmentPaths) {
  try {
    // Remove file list
    if (fs.existsSync(fileListPath)) {
      fs.unlinkSync(fileListPath);
    }
    
    // Remove segment files
    segmentPaths.forEach(segmentPath => {
      if (fs.existsSync(segmentPath)) {
        fs.unlinkSync(segmentPath);
      }
    });
  } catch (err) {
    console.error('Error cleaning up temporary files:', err);
  }
}

// API endpoint to create video from uploaded images
app.post('/create-video', upload.array('images'), async (req, res) => {
  try {
    const {
      durationPerImage = 5,
      fps = 30,
      width,
      height,
      selectedMusic,
      performanceMode = 'normal'
    } = req.body;

    // Save uploaded images to temporary folder
    const tempImageFolder = path.join(__dirname, 'temp', 'images');
    ensureDir(tempImageFolder);
    
    // Clean up previous images
    const oldFiles = fs.readdirSync(tempImageFolder);
    oldFiles.forEach(file => {
      fs.unlinkSync(path.join(tempImageFolder, file));
    });

    // Sort files on the server side as well to ensure correct order
    const sortedFiles = [...req.files].sort((a, b) => {
      // Extract base name and number from filename
      const aMatch = a.originalname.match(/^(.+?)\s*\((\d+)\)(\..+)$/);
      const bMatch = b.originalname.match(/^(.+?)\s*\((\d+)\)(\..+)$/);
      
      // For files like "LimitReview.png"
      const aBase = aMatch ? aMatch[1] : a.originalname.replace(/\..*$/, '');
      const aNum = aMatch ? parseInt(aMatch[2]) : null; // null for files without number
      
      // For files like "LimitReview.png" 
      const bBase = bMatch ? bMatch[1] : b.originalname.replace(/\..*$/, '');
      const bNum = bMatch ? parseInt(bMatch[2]) : null; // null for files without number
      
      // First compare base names
      if (aBase !== bBase) {
        return aBase.localeCompare(bBase);
      }
      
      // If base names are the same:
      // 1. Files without numbers come first
      // 2. Files with numbers come after, sorted numerically
      if (aNum === null && bNum === null) return 0;
      if (aNum === null) return -1;  // a has no number, b has number, a comes first
      if (bNum === null) return 1;   // b has no number, a has number, b comes first
      return aNum - bNum;            // both have numbers, sort numerically
    });

    // Save new images with proper numbering
    const imageFiles = [];
    for (let i = 0; i < sortedFiles.length; i++) {
      const file = sortedFiles[i];
      const fileName = `${i.toString().padStart(3, '0')}_${file.originalname}`;
      const filePath = path.join(tempImageFolder, fileName);
      fs.writeFileSync(filePath, file.buffer);
      imageFiles.push(fileName);
    }

    // Create output folder
    const outputFolder = path.join(__dirname, 'output');
    ensureDir(outputFolder);

    // Generate output filename with timestamp
    const timestamp = new Date().toISOString().slice(5, 10).replace('-', '');
    const outputVideoFilename = `output_video_${timestamp}.mp4`;
    const outputVideoPath = path.join(outputFolder, outputVideoFilename);
    
    // Path for video with music
    const finalOutputPath = path.join(outputFolder, `output_video_${timestamp}_with_music.mp4`);

    // Create video from images
    await createVideoFromImages(tempImageFolder, outputVideoPath, {
      durationPerImage: parseInt(durationPerImage),
      fps: parseInt(fps),
      width: width ? parseInt(width) : null,
      height: height ? parseInt(height) : null,
      performanceMode: performanceMode
    });

    // If music is specified, add it to the video
    if (selectedMusic) {
      const musicPath = path.join(__dirname, 'music', selectedMusic);
      if (fs.existsSync(musicPath)) {
        await addBackgroundMusicToVideo(outputVideoPath, musicPath, finalOutputPath);
        
        // Return the video file with music
        res.sendFile(finalOutputPath);
        return;
      }
    }

    // Return the video file
    res.sendFile(outputVideoPath);
  } catch (error) {
    console.error('Error creating video:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error creating video', 
      error: error.message 
    });
  }
});

// API endpoint to get music files
app.get('/music-files', (req, res) => {
  try {
    const musicFolder = path.join(__dirname, 'music');
    ensureDir(musicFolder);
    
    const musicFiles = fs.readdirSync(musicFolder).filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ['.mp3', '.wav', '.aac', '.flac', '.m4a', '.ogg'].includes(ext);
    });

    res.json({ 
      success: true, 
      musicFiles: musicFiles 
    });
  } catch (error) {
    console.error('Error getting music files:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error getting music files', 
      error: error.message 
    });
  }
});

// API endpoint to get image prefixes
app.get('/image-prefixes', (req, res) => {
  try {
    const { imageFolder } = req.query;
    
    if (!fs.existsSync(imageFolder)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Image folder does not exist' 
      });
    }

    const files = fs.readdirSync(imageFolder);
    const imageFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ['.png', '.jpg', '.jpeg', '.bmp', '.tiff'].includes(ext);
    });

    const prefixes = new Set();
    const regex = /^(.*?)((\s*\(\d+\))?)\.(png|jpg|jpeg|bmp|tiff)$/i;
    
    imageFiles.forEach(file => {
      const match = file.match(regex);
      if (match) {
        prefixes.add(match[1]);
      }
    });

    const sortedPrefixes = Array.from(prefixes).sort();
    res.json({ 
      success: true, 
      prefixes: ['全部', ...sortedPrefixes] 
    });
  } catch (error) {
    console.error('Error getting image prefixes:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error getting image prefixes', 
      error: error.message 
    });
  }
});

// Add background music to video
const addBackgroundMusicToVideo = (videoPath, musicPath, outputPath) => {
  return new Promise((resolve, reject) => {
    const command = ffmpeg()
      .input(videoPath)
      .input(musicPath)
      .outputOptions([
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ar', '44100',
        '-ac', '2',
        '-shortest'
      ])
      .on('start', (cmd) => {
        console.log('Started ffmpeg process with command: ' + cmd);
      })
      .on('end', () => {
        console.log('Music added to video successfully');
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('Error adding music to video:', err);
        reject(err);
      });
    
    // Store process reference for potential cleanup
    const processId = 'music_' + Date.now().toString();
    activeProcesses.set(processId, command);
    
    // Remove process from tracking when it completes
    const cleanup = () => {
      activeProcesses.delete(processId);
    };
    
    command.on('end', cleanup);
    command.on('error', cleanup);
    
    command.save(outputPath);
  });
};

// Graceful shutdown handler
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  cleanupAllProcesses();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  cleanupAllProcesses();
  process.exit(0);
});

// Cleanup all active ffmpeg processes
function cleanupAllProcesses() {
  console.log(`Cleaning up ${activeProcesses.size} active processes...`);
  for (const [id, process] of activeProcesses) {
    try {
      if (process.ffmpegProc) {
        console.log(`Killing process ${id}...`);
        process.kill();
      }
    } catch (err) {
      console.error(`Error killing process ${id}:`, err);
    }
  }
  activeProcesses.clear();
}

// Periodic cleanup of zombie processes (runs every 5 minutes)
setInterval(() => {
  console.log(`Active processes count: ${activeProcesses.size}`);
  // In a real implementation, you might want to check if processes are still alive
}, 5 * 60 * 1000); // 5 minutes

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});