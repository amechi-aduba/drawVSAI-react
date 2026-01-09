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

const EMA_ALPHA = 0.5;
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

    let minX = W, minY = H, maxX = -1, maxY = -1;
    let inkPixels = 0;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (data[i + 3] > 10) {
          inkPixels++;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (inkPixels < 10 || maxX < 0) {
      return { xImg: tf.zeros([1, 28, 28, 1], "float32"), inkRatio: 0 };
    }

    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const size = Math.max(bw, bh);
    const pad = Math.max(10, Math.round(size * 0.25));
    let cropSize = Math.min(Math.max(60, size + 2 * pad), W, H);

    const cx = minX + bw / 2;
    const cy = minY + bh / 2;

    let cropX = Math.round(cx - cropSize / 2);
    let cropY = Math.round(cy - cropSize / 2);

    cropX = Math.max(0, Math.min(W - cropSize, cropX));
    cropY = Math.max(0, Math.min(H - cropSize, cropY));

    const mid = document.createElement("canvas");
    mid.width = 112;
    mid.height = 112;
    const midCtx = mid.getContext("2d", { willReadFrequently: true });

    midCtx.imageSmoothingEnabled = true;
    midCtx.fillStyle = "#fff";
    midCtx.fillRect(0, 0, 112, 112);
    midCtx.drawImage(canvasEl, cropX, cropY, cropSize, cropSize, 0, 0, 112, 112);

    const midData = midCtx.getImageData(0, 0, 112, 112).data;
    const binaryArr = new Uint8ClampedArray(112 * 112);

    for (let i = 0; i < 112 * 112; i++) {
      const j = i * 4;
      const gray = (midData[j] + midData[j + 1] + midData[j + 2]) / 3;
      binaryArr[i] = gray < 128 ? 0 : 255;
    }

    const binCanvas = document.createElement("canvas");
    binCanvas.width = 112;
    binCanvas.height = 112;
    const binCtx = binCanvas.getContext("2d");
    const binImageData = binCtx.createImageData(112, 112);

    for (let i = 0; i < 112 * 112; i++) {
      const val = binaryArr[i];
      binImageData.data[i * 4] = val;
      binImageData.data[i * 4 + 1] = val;
      binImageData.data[i * 4 + 2] = val;
      binImageData.data[i * 4 + 3] = 255;
    }
    binCtx.putImageData(binImageData, 0, 0);

    const dilC = document.createElement("canvas");
    dilC.width = 112;
    dilC.height = 112;
    const dilCtx = dilC.getContext("2d");
    dilCtx.imageSmoothingEnabled = false;
    dilCtx.fillStyle = "#fff";
    dilCtx.fillRect(0, 0, 112, 112);

    let currentCanvas = binCanvas;

    for (let pass = 0; pass < 2; pass++) {
      const passC = document.createElement("canvas");
      passC.width = 112;
      passC.height = 112;
      const passCtx = passC.getContext("2d");
      passCtx.imageSmoothingEnabled = false;
      passCtx.fillStyle = "#fff";
      passCtx.fillRect(0, 0, 112, 112);

      const R = 1;
      passCtx.globalAlpha = 0.65;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dy * dy <= R * R) {
            passCtx.drawImage(currentCanvas, dx, dy);
          }
        }
      }
      passCtx.globalAlpha = 1.0;

      currentCanvas = passC;
    }

    dilCtx.drawImage(currentCanvas, 0, 0);

    const outC = document.createElement("canvas");
    outC.width = 28;
    outC.height = 28;
    const outCtx = outC.getContext("2d");

    outCtx.imageSmoothingEnabled = true;
    outCtx.fillStyle = "#fff";
    outCtx.fillRect(0, 0, 28, 28);
    outCtx.drawImage(dilC, 0, 0, 28, 28);

    const img28 = outCtx.getImageData(0, 0, 28, 28).data;
    const arr = new Float32Array(28 * 28);
    let inkSum = 0;

    for (let i = 0; i < 28 * 28; i++) {
      const j = i * 4;
      const gray = (img28[j] + img28[j + 1] + img28[j + 2]) / 3;
      const binary = gray < 128 ? 1.0 : 0.0;
      arr[i] = binary;
      if (binary > 0.5) inkSum += 1;
    }

    if (inkSum > 5) {
      const temp = new Float32Array(arr);
      for (let y = 0; y < 28; y++) {
        for (let x = 0; x < 28; x++) {
          const idx = y * 28 + x;
          if (temp[idx] > 0.5) {
            const neighbors = [
              [y - 1, x], [y + 1, x],
              [y, x - 1], [y, x + 1]
            ];
            for (const [ny, nx] of neighbors) {
              if (ny >= 0 && ny < 28 && nx >= 0 && nx < 28) {
                arr[ny * 28 + nx] = 1.0;
              }
            }
          }
        }
      }
      inkSum = arr.reduce((a, b) => a + b);
    }

    for (let i = 0; i < arr.length; i++) {
      arr[i] = 1.0 - arr[i];
    }

    // if (SHOW_MODEL_VIEW) {
    //   const previewData = outCtx.createImageData(28, 28);
    //   for (let i = 0; i < 28 * 28; i++) {
    //     const px = arr[i] * 255;
    //     previewData.data[i * 4] = px;
    //     previewData.data[i * 4 + 1] = px;
    //     previewData.data[i * 4 + 2] = px;
    //     previewData.data[i * 4 + 3] = 255;
    //   }
    //   outCtx.putImageData(previewData, 0, 0);
    //   outC.style.cssText = "position:fixed;right:10px;bottom:10px;width:140px;height:140px;z-index:9999;border:2px solid lime;background:#fff;image-rendering:pixelated;";
    //   document.body.appendChild(outC);
    //   setTimeout(() => outC.remove(), 200);
    // }

    return {
      xImg: tf.tensor4d(arr, [1, 28, 28, 1], "float32"),
      inkRatio: inkSum / (28 * 28),
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