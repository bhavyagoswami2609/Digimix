// Classic Web Worker for MediaPipe HandLandmarker

let landmarker = null;
let isReady = false;

async function initLandmarker() {
  try {
    importScripts('/mediapipe/vision_bundle.js');
    const { FilesetResolver, HandLandmarker } = Vision;

    const visionFiles = await FilesetResolver.forVisionTasks('/mediapipe/wasm');

    const options = {
      baseOptions: {
        modelAssetPath: '/models/hand_landmarker.task',
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5
    };

    try {
      landmarker = await HandLandmarker.createFromOptions(visionFiles, options);
    } catch (gpuErr) {
      // GPU failed, retry with CPU as specified in Section 5
      options.baseOptions.delegate = 'CPU';
      landmarker = await HandLandmarker.createFromOptions(visionFiles, options);
    }

    isReady = true;
    postMessage({ type: 'ready' });
  } catch (err) {
    postMessage({ type: 'error', error: String(err) });
  }
}

initLandmarker();

self.onmessage = (e) => {
  const data = e.data;
  if (!data || !isReady || !landmarker) {
    if (data && data.bitmap) {
      data.bitmap.close();
    }
    return;
  }

  const { bitmap, timestamp, captureTime } = data;
  try {
    const result = landmarker.detectForVideo(bitmap, Math.round(timestamp));
    bitmap.close();

    postMessage({
      type: 'result',
      landmarks: result.landmarks, // Array of hands, each with 21 normalized landmarks
      timestamp,
      captureTime
    });
  } catch (detectErr) {
    bitmap.close();
    postMessage({
      type: 'result',
      landmarks: [],
      timestamp,
      captureTime
    });
  }
};
