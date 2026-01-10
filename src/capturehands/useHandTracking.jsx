// src/capturehands/useHandTracking.jsx

import React, { useState, useEffect } from "react";
import * as tf from "@tensorflow/tfjs";
import * as handpose from "@tensorflow-models/handpose";

/**
 * Returns true if the tip (tipIdx) is above (smaller y) the MCP joint (mcpIdx).
 */
function isFingerExtended(landmarks, tipIdx, mcpIdx) {
  return landmarks[tipIdx][1] < landmarks[mcpIdx][1];
}

/**
 * Validate that detected landmarks are actually a real hand
 */
function isValidHand(landmarks, videoWidth, videoHeight) {
  if (!landmarks || landmarks.length < 21) return false;

  // Get bounding box
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let landmark of landmarks) {
    minX = Math.min(minX, landmark[0]);
    maxX = Math.max(maxX, landmark[0]);
    minY = Math.min(minY, landmark[1]);
    maxY = Math.max(maxY, landmark[1]);
  }

  const width = maxX - minX;
  const height = maxY - minY;

  // Check 1: Hand should be at least 2% of video size (not tiny)
  if (width < videoWidth * 0.02 || height < videoHeight * 0.02) {
    console.log("❌ Hand too small:", (width/videoWidth).toFixed(2), "x", (height/videoHeight).toFixed(2));
    return false;
  }

  // Check 2: Hand should be no more than 90% of video (not filling entire screen)
  if (width > videoWidth * 0.9 || height > videoHeight * 0.9) {
    console.log("❌ Hand too large");
    return false;
  }

  // Check 3: Hand should be mostly on-screen
  if (minX < -videoWidth * 0.3 || maxX > videoWidth * 1.3 || 
      minY < -videoHeight * 0.3 || maxY > videoHeight * 1.3) {
    console.log("❌ Hand cut off screen");
    return false;
  }

  // That's it! Trust the handpose model's detection
  return true;
}

/**
 * Smooth landmarks across frames to reduce jitter
 */
class LandmarkSmoother {
  constructor(smoothingFactor = 0.5) {
    this.smoothingFactor = smoothingFactor; // 0-1, higher = more smoothing
    this.smoothedLandmarks = null;
  }

  smooth(landmarks) {
    if (!landmarks) return null;

    if (!this.smoothedLandmarks) {
      // First frame - initialize with raw landmarks
      this.smoothedLandmarks = landmarks.map(lm => [...lm]);
      return landmarks;
    }

    // Exponential moving average for each landmark
    const smoothed = landmarks.map((lm, idx) => {
      const prev = this.smoothedLandmarks[idx];
      return [
        prev[0] * (1 - this.smoothingFactor) + lm[0] * this.smoothingFactor,
        prev[1] * (1 - this.smoothingFactor) + lm[1] * this.smoothingFactor,
        prev[2] * (1 - this.smoothingFactor) + lm[2] * this.smoothingFactor,
      ];
    });

    this.smoothedLandmarks = smoothed;
    return smoothed;
  }

  reset() {
    this.smoothedLandmarks = null;
  }
}

/**
 * Prevent gesture flickering - once detected, stay with that gesture for a few frames
 */
class GestureHysteresis {
  constructor(stayFrames = 3) {
    this.currentGesture = null;
    this.framesInGesture = 0;
    this.stayFrames = stayFrames; // Frames to stay in current gesture even if it changes
  }

  update(newGesture) {
    if (newGesture === this.currentGesture) {
      // Same gesture, reset counter
      this.framesInGesture = 0;
      return this.currentGesture;
    }

    // Different gesture detected
    if (this.framesInGesture < this.stayFrames) {
      // Still in hysteresis window, ignore the new gesture
      this.framesInGesture++;
      return this.currentGesture;
    }

    // Hysteresis window passed, accept new gesture
    this.currentGesture = newGesture;
    this.framesInGesture = 0;
    return this.currentGesture;
  }

  reset() {
    this.currentGesture = null;
    this.framesInGesture = 0;
  }
}

/**
 * Track hand detection state with hysteresis
 * Once detected, stay detected even if confidence drops slightly
 */
class HandDetectionHysteresis {
  constructor(detectionThreshold = 0.6, dropThreshold = 0.4) {
    this.isTracking = false;
    this.detectionThreshold = detectionThreshold;
    this.dropThreshold = dropThreshold;
    this.framesWithoutDetection = 0;
    this.maxMissedFrames = 5; // Allow 5 missed frames before dropping
  }

  update(isHandDetected) {
    if (isHandDetected) {
      this.isTracking = true;
      this.framesWithoutDetection = 0;
    } else {
      this.framesWithoutDetection++;
      if (this.framesWithoutDetection > this.maxMissedFrames) {
        this.isTracking = false;
      }
    }

    return this.isTracking;
  }

  reset() {
    this.isTracking = false;
    this.framesWithoutDetection = 0;
  }
}

function useHandTracking() {
  const [net, setNet] = useState(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState(null);
  const [smoother] = useState(() => new LandmarkSmoother(0.5));
  const [hysteresis] = useState(() => new HandDetectionHysteresis());
  const [gestureHysteresis] = useState(() => new GestureHysteresis(3));

  // ✅ Load the Handpose model with better settings
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await tf.ready();
        console.log("🤖 [useHandTracking] TensorFlow backend ready");

        // ✅ Load with balanced settings (not too strict, not too loose)
        const handposeModel = await handpose.load({
          maxContinuousChecks: 3,    // ← Reduced from 5 for faster detection
          detectionConfidence: 0.6,  // ← Relaxed from 0.7
          scoreThreshold: 0.65,      // ← Relaxed from 0.75
          iouThreshold: 0.3,
        });

        if (!cancelled) {
          setNet(handposeModel);
          console.log("🤖 [useHandTracking] handpose model loaded with strict settings");
          setIsReady(true);
        }
      } catch (err) {
        if (!cancelled) {
          console.error(
            "❌ [useHandTracking] Failed to load handpose model:",
            err
          );
          setError("Failed to load handpose model: " + err.message);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * detect:
   *   - Expects an HTMLVideoElement (webcamRef.current.video).
   *   - Returns { landmarks: [[x,y,z], ...], gesture: "PointerUp"|"PinchClose"|"OpenHand" }
   *     or null if no valid hand is found.
   */
const detect = async (videoEl) => {
  if (!net || !videoEl) return null;
  if (videoEl.readyState !== 4) return null;

  try {
    const hands = await net.estimateHands(videoEl, false);
    const hasDetection = hands.length > 0;

    const shouldContinueTracking = hysteresis.update(hasDetection);

    if (!shouldContinueTracking || !hasDetection) {
      if (!hasDetection) {
        smoother.reset();
      }
      return null;
    }

    let landmarks = hands[0].landmarks;

    const videoWidth = videoEl.videoWidth;
    const videoHeight = videoEl.videoHeight;

    if (!isValidHand(landmarks, videoWidth, videoHeight)) {
      console.log("❌ [useHandTracking] Invalid hand detected, ignoring");
      hysteresis.reset();
      smoother.reset();
      return null;
    }

    landmarks = smoother.smooth(landmarks);

    // Detect which fingers are extended
    const indexUp = isFingerExtended(landmarks, 8, 5);
    const middleUp = isFingerExtended(landmarks, 12, 9);
    const ringUp = isFingerExtended(landmarks, 16, 13);
    const pinkyUp = isFingerExtended(landmarks, 20, 17);
    const thumbUp = isFingerExtended(landmarks, 4, 2);

    const upCount = [indexUp, middleUp, ringUp, pinkyUp].filter(Boolean).length;

    // ✅ THIS IS WHERE YOU PUT IT (replacing the old gesture detection):
    let rawGesture = "Idle";

    if (indexUp && !middleUp && !ringUp && !pinkyUp) {
      rawGesture = "PointerUp";
    } else if (thumbUp && indexUp && !middleUp && !ringUp && !pinkyUp) {
      const thumbTip = landmarks[4];
      const indexTip = landmarks[8];
      const distance = Math.sqrt(
        Math.pow(indexTip[0] - thumbTip[0], 2) +
          Math.pow(indexTip[1] - thumbTip[1], 2)
      );
      if (distance < 50) {
        rawGesture = "PinchClose";
      } else {
        rawGesture = "PointerUp";
      }
    } else if (indexUp && middleUp && ringUp && pinkyUp) {
      rawGesture = "OpenHand";
    } else if (upCount > 1) {
      rawGesture = "MultipleFingersUp";
    }

    // ✅ Apply gesture hysteresis to prevent flickering
    const gesture = gestureHysteresis.update(rawGesture);

    return { landmarks, gesture };
  } catch (err) {
    console.error("❌ [useHandTracking] Error during hand detection:", err);
    return null;
  }
};

  return { isReady, error, detect };
}

export default useHandTracking;