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

function useHandTracking() {
  const [net, setNet] = useState(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState(null);

  // 1️⃣ Load the Handpose model once on mount
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await tf.ready();
        console.log("🤖 [useHandTracking] TensorFlow backend ready");
        const handposeModel = await handpose.load();
        if (!cancelled) {
          setNet(handposeModel);
          console.log("🤖 [useHandTracking] handpose model loaded");
          setIsReady(true);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("❌ [useHandTracking] Failed to load handpose model:", err);
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
   *   - Returns { landmarks: [[x,y,z], …], gesture: "PointerUp"|"PinkyUp"|"MultipleFingersUp" }
   *     or null if no hand is found or model/video isn't ready.
   */
  const detect = async (videoEl) => {
    if (!net || !videoEl) return null;
    if (videoEl.readyState !== 4) return null;

    try {
      const hands = await net.estimateHands(videoEl);
      if (hands.length === 0) return null;

      const landmarks = hands[0].landmarks; // array of 21 [x,y,z] coords

      // Compare tip vs MCP for each finger (ignore thumb)
      const indexUp  = isFingerExtended(landmarks, /*tipIdx=*/ 8,  /*mcpIdx=*/ 5);
      const middleUp = isFingerExtended(landmarks, /*tipIdx=*/12, /*mcpIdx=*/ 9);
      const ringUp   = isFingerExtended(landmarks, /*tipIdx=*/16, /*mcpIdx=*/13);
      const pinkyUp  = isFingerExtended(landmarks, /*tipIdx=*/20, /*mcpIdx=*/17);

      const upCount = [indexUp, middleUp, ringUp, pinkyUp].filter(Boolean).length;

      let gesture = null;
      if (indexUp && !middleUp && !ringUp && !pinkyUp) {
        gesture = "PointerUp";
      } else if (upCount > 1) {
        gesture = "MultipleFingersUp";
      }

      return { landmarks, gesture };
    } catch (err) {
      console.error("❌ [useHandTracking] Error during hand detection:", err);
      return null;
    };
  };

  return { isReady, error, detect };
}

export default useHandTracking;
