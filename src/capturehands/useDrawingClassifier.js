import { useState, useRef, useEffect, useCallback } from "react";
import * as tf from "@tensorflow/tfjs";

const CATEGORIES = [
  "apple", "banana", "bicycle", "butterfly", "cake",
  "camera", "car", "chair", "crown", "donut",
  "door", "flower", "house", "ice cream", "key",
  "lightning", "mountain", "pizza", "star"
];

const LABELS_URL = `/model_js/labels.json?v=${Date.now()}`;
const MODEL_URL = `/model_js/model.json?v=${Date.now()}`;

const EMA_ALPHA = 0.3;
const SHOW_MODEL_VIEW = false;

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

  const STREAK_TO_SCORE = 2;
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
    let minX = W, minY = H, maxX = -1, maxY = -1;
    let hasInk = false;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
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

    const bW = maxX - minX + 1;
    const bH = maxY - minY + 1;
    const maxDim = Math.max(bW, bH);
    const padding = maxDim * 0.2;
    const size = maxDim + padding;

    const tmpC = document.createElement("canvas");
    tmpC.width = 28;
    tmpC.height = 28;
    const tmpCtx = tmpC.getContext("2d");

    tmpCtx.fillStyle = "white";
    tmpCtx.fillRect(0, 0, 28, 28);

    
    const scale = 28 / size;
    const dW = bW * scale;
    const dH = bH * scale;
    const dX = (28 - dW) / 2;
    const dY = (28 - dH) / 2;

    tmpCtx.imageSmoothingEnabled = false;
    tmpCtx.drawImage(canvasEl, minX, minY, bW, bH, dX, dY, dW, dH);

    
    const imgData = tmpCtx.getImageData(0, 0, 28, 28).data;
    const floatArr = new Float32Array(28 * 28);
    let inkPixels = 0;

    for (let i = 0; i < 28 * 28; i++) {
      
      const gray = imgData[i * 4]; 

      
      let val = 1.0 - (gray / 255.0);

      
      if (val > 0.0) {
        val = Math.min(1.0, val * 1.2);
      }

      floatArr[i] = val;
      if (val > 0.05) inkPixels++;
    }

    
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
        const p = floatArr[i] * 255;
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

        if (inkRatio < 0.008) {
          setCurrentGuess("AI GUESSES: …");
          return;
        }

        out = model.predict(xImg);
        const probsFlat = await out.data();
        const probs = Array.from(probsFlat);

        if (!emaRef.current || emaRef.current.length !== probs.length) {
          emaRef.current = new Float32Array(probs);
        } else {
          const maxProb = Math.max(...probs);
          const adaptiveAlpha = maxProb > 0.75 ? 0.5 : EMA_ALPHA;

          const ema = emaRef.current;
          for (let i = 0; i < probs.length; i++) {
            ema[i] = adaptiveAlpha * ema[i] + (1 - adaptiveAlpha) * probs[i];
          }
        }

        const ema = emaRef.current;
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

        setCurrentGuess(`AI GUESSES: ${guessedWord}`);

        const guessIsTarget = norm(guessedWord) === norm(targetWordRef.current);

        if (guessIsTarget) {
          correctStreakRef.current += 1;
        } else {
          correctStreakRef.current = 0;
          if (margin < 0.2) emaRef.current = null;
        }
        const shouldScore =
          !hasScoredRef.current && (
            correctStreakRef.current >= 2 ||
            (guessIsTarget && topProb > 0.85 && margin > 0.3)
          );

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