import { useState, useRef, useEffect, useCallback } from "react";
import * as tf from "@tensorflow/tfjs";

const CATEGORIES = [
  "apple", "banana", "bicycle", "butterfly", "cactus", "cake",
  "camera", "car", "chair", "cloud", "crab", "crown", "donut",
  "door", "eye", "flower", "house", "ice cream", "key",
  "lightning", "mountain", "pizza", "star"
];

const LABELS_URL = `/model_js/labels.json?v=${Date.now()}`;
const MODEL_URL = `/model_js/model.json?v=${Date.now()}`;

const EMA_ALPHA = 0.8;
const SHOW_MODEL_VIEW = true;

export function useDrawingClassifier({ onCorrect } = {}) {
  const modelRef = useRef(null);
  const labelsRef = useRef(CATEGORIES);
  const initializedRef = useRef(false);
  const isPredictingRef = useRef(false);
  const predictTimeoutRef = useRef(null);
  const targetWordRef = useRef("");
  const hasScoredRef = useRef(false);
  const correctStreakRef = useRef(0);
  const emaRef = useRef(null);

  const STREAK_TO_SCORE = 1;
  const norm = (s) => (s ?? "").toLowerCase().trim();

  const onCorrectRef = useRef(null);
  useEffect(() => {
    onCorrectRef.current = typeof onCorrect === "function" ? onCorrect : null;
  }, [onCorrect]);

  const [isModelReady, setIsModelReady] = useState(false);
  const [currentGuess, setCurrentGuess] = useState("AI GUESSES: …");
  const [targetWord, setTargetWord] = useState("");
  const [score, setScore] = useState(0);
  const [correctGuess, setCorrectGuess] = useState(false);

  const randomWord = useCallback(() => {
    const idx = Math.floor(Math.random() * CATEGORIES.length);
    const picked = CATEGORIES[idx];
    targetWordRef.current = picked;
    hasScoredRef.current = false;
    setTargetWord(picked);
    return picked;
  }, []);

  const startRound = useCallback(() => {
    emaRef.current = null;
    correctStreakRef.current = 0;
    hasScoredRef.current = false;
    setCorrectGuess(false);
    setCurrentGuess("AI GUESSES: …");
    randomWord();
  }, [randomWord]);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    let cancelled = false;

    (async () => {
      console.log("Loading model...");

      await tf.setBackend("webgl");
      await tf.ready();
      console.log("TensorFlow backend:", tf.getBackend());

      const model = await tf.loadLayersModel(MODEL_URL);
      if (cancelled) return;

      try {
        const res = await fetch(LABELS_URL);
        const labels = await res.json();
        if (Array.isArray(labels) && labels.length > 0) {
          labelsRef.current = labels;
          console.log("Loaded labels.json:", labels.length, "categories");
        } else {
          console.warn("labels.json invalid; using fallback CATEGORIES");
        }
      } catch (e) {
        console.warn("Could not load labels.json; using fallback CATEGORIES");
      }

      modelRef.current = model;
      setIsModelReady(true);

      tf.tidy(() => {
        const img = tf.zeros([1, 28, 28, 1], "float32");
        const out = model.predict(img);
        out.dispose?.();
      });

      startRound();

      console.log("Model loaded successfully");
    })().catch((e) => console.error("Model initialization failed:", e));

    return () => {
      cancelled = true;
    };
  }, [startRound]);

  function preprocessInput(canvasEl) {
    const W = canvasEl.width;
    const H = canvasEl.height;
    const ctx = canvasEl.getContext("2d", { willReadFrequently: true });
    const data = ctx.getImageData(0, 0, W, H).data;

    // 1. TIGHT CROP: Find boundaries of the ink
    let minX = W, minY = H, maxX = -1, maxY = -1;
    let hasInk = false;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // Look at alpha channel (index 3) or darkness
        const alpha = data[(y * W + x) * 4 + 3];
        if (alpha > 20) { 
          hasInk = true;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (!hasInk) {
      return { xImg: tf.zeros([1, 28, 28, 1], "float32"), inkRatio: 0 };
    }

    // 2. LETTERBOXING: Preserve Aspect Ratio (Fixes "Banana" / "Squashed House")
    const bW = maxX - minX + 1;
    const bH = maxY - minY + 1;
    
    // Use the largest dimension for the square box, plus padding
    const maxDim = Math.max(bW, bH);
    const padding = maxDim * 0.2; // 20% padding
    const size = maxDim + padding;

    // Create intermediate canvas
    const tmpC = document.createElement("canvas");
    tmpC.width = 28;
    tmpC.height = 28;
    const tmpCtx = tmpC.getContext("2d");

    // Fill with WHITE (255) - we will invert mathematically later
    tmpCtx.fillStyle = "white";
    tmpCtx.fillRect(0, 0, 28, 28);

    // Center the drawing in the 28x28 box
    const scale = 28 / size;
    const dW = bW * scale;
    const dH = bH * scale;
    const dX = (28 - dW) / 2;
    const dY = (28 - dH) / 2;

    tmpCtx.imageSmoothingEnabled = true;
    tmpCtx.imageSmoothingQuality = "high";
    tmpCtx.drawImage(canvasEl, minX, minY, bW, bH, dX, dY, dW, dH);

    // 3. TENSOR CONVERSION: Exact Training Match (Fixes "Pizza")
    const imgData = tmpCtx.getImageData(0, 0, 28, 28).data;
    const floatArr = new Float32Array(28 * 28);
    let inkPixels = 0;

    for (let i = 0; i < 28 * 28; i++) {
      // Input is Black ink (0) on White bg (255)
      const gray = imgData[i * 4]; // r=g=b

      // NORMALIZE & INVERT: 
      // Background (255) becomes 0.0
      // Ink (0) becomes 1.0
      let val = 1.0 - (gray / 255.0);

      // CONTRAST BOOST: 
      // Force faint gray edges (canvas anti-aliasing) to be solid ink
      // This matches the "binary" nature of QuickDraw training data
      if (val < 0.05) val = 0.0; // Clean noise
      else val = Math.min(1.0, val * 1.5); // Boost ink

      floatArr[i] = val;
      if (val > 0.1) inkPixels++;
    }

    // 4. DEBUG PREVIEW: Invert BACK for human eyes
    // (Model sees White-on-Black, Human sees Black-on-White)
    if (SHOW_MODEL_VIEW) {
      let debugC = document.getElementById("model-debug-preview");
      if (!debugC) {
        debugC = document.createElement("canvas");
        debugC.id = "model-debug-preview";
        debugC.width = 28;
        debugC.height = 28;
        debugC.style.cssText = "position:fixed;right:10px;bottom:10px;width:140px;height:140px;z-index:9999;border:2px solid lime;background:#fff;image-rendering:pixelated;";
        document.body.appendChild(debugC);
      }
      const dCtx = debugC.getContext("2d");
      const dImg = dCtx.createImageData(28, 28);
      for (let i = 0; i < 28 * 28; i++) {
        // Convert 1.0 (ink) -> 0 (black)
        // Convert 0.0 (bg) -> 255 (white)
        const p = (1.0 - floatArr[i]) * 255; 
        dImg.data[i * 4] = p;
        dImg.data[i * 4 + 1] = p;
        dImg.data[i * 4 + 2] = p;
        dImg.data[i * 4 + 3] = 255;
      }
      dCtx.putImageData(dImg, 0, 0);
    }

    return {
      xImg: tf.tensor4d(floatArr, [1, 28, 28, 1], "float32"),
      inkRatio: inkPixels / (28 * 28),
    };
  }

  const updateGuess = useCallback((canvasEl) => {
    const model = modelRef.current;
    if (!model || !canvasEl) return;

    if (predictTimeoutRef.current) clearTimeout(predictTimeoutRef.current);

    predictTimeoutRef.current = setTimeout(async () => {
      if (isPredictingRef.current) return;
      isPredictingRef.current = true;

      let xImg, out;

      try {
        const pre = preprocessInput(canvasEl);
        xImg = pre.xImg;
        const inkRatio = pre.inkRatio;

        if (inkRatio < 0.010) {
          setCurrentGuess("AI GUESSES: …");
          return;
        }

        out = model.predict(xImg);
        const probsFlat = await out.data();
        const probs = Array.from(probsFlat);

        if (!emaRef.current || emaRef.current.length !== probs.length) {
          emaRef.current = new Float32Array(probs.length);
        }

        const ema = emaRef.current;
        for (let i = 0; i < probs.length; i++) {
          ema[i] = EMA_ALPHA * ema[i] + (1 - EMA_ALPHA) * probs[i];
        }

        let bestIdx = 0;
        for (let i = 1; i < ema.length; i++) {
          if (ema[i] > ema[bestIdx]) bestIdx = i;
        }

        let secondIdx = bestIdx === 0 ? 1 : 0;
        for (let i = 0; i < ema.length; i++) {
          if (i !== bestIdx && ema[i] > ema[secondIdx]) secondIdx = i;
        }

        const labels = labelsRef.current;
        const guessedWord = labels[bestIdx] ?? "…";
        const topProb = ema[bestIdx];
        const margin = topProb - ema[secondIdx];

        const rawTop3 = probs
          .map((p, i) => ({ i, p }))
          .sort((a, b) => b.p - a.p)
          .slice(0, 3)
          .map((t) => `${labels[t.i]}:${t.p.toFixed(2)}`);

        setCurrentGuess(`AI GUESSES: ${guessedWord}`);

        const guessIsTarget = norm(guessedWord) === norm(targetWordRef.current);

        if (guessIsTarget) {
          correctStreakRef.current += 1;
        } else {
          correctStreakRef.current = 0;
        }

        const shouldScore =
          !hasScoredRef.current &&
          correctStreakRef.current >= STREAK_TO_SCORE;

        if (shouldScore) {
          hasScoredRef.current = true;

          if (predictTimeoutRef.current) {
            clearTimeout(predictTimeoutRef.current);
            predictTimeoutRef.current = null;
          }

          setScore((s) => s + 1);
          setCorrectGuess(true);
          onCorrectRef.current?.();

          setTimeout(() => startRound(), 800);

          return;
        }

        console.log("Prediction:", {
          top: guessedWord,
          prob: topProb.toFixed(3),
          margin: margin.toFixed(3),
          inkRatio: inkRatio.toFixed(4),
          rawTop3,
          streak: correctStreakRef.current,
        });

      } catch (e) {
        console.error("Prediction failed:", e);
        setCurrentGuess("AI GUESSES: …");
      } finally {
        xImg?.dispose();
        out?.dispose?.();
        isPredictingRef.current = false;
      }
    }, 250);
  }, [startRound]);

  return {
    isModelReady,
    currentGuess,
    updateGuess,
    targetWord,
    score,
    correctGuess,
    startRound,
  };
}