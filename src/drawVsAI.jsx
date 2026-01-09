// src/drawVsAI.jsx

import React, { useRef, useState, useEffect } from "react";
import Webcam from "react-webcam";
import useHandTracking from "./capturehands/useHandTracking";
import useDrawing from "./capturehands/useDrawing";
import { useDrawingClassifier } from "./capturehands/useDrawingClassifier";

export default function DrawVsAI() {
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const drawCanvasRef = useRef(null);

  // ─── State ───
  const [videoReady, setVideoReady] = useState(false);
  const [handDetected, setHandDetected] = useState(false);
  const [currentMode, setCurrentMode] = useState("Idle"); // Idle / PointerUp / Erase
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);


  // Holds the "committed" landmarks + gesture after stability buffer
  const [handData, setHandData] = useState({
    landmarks: null,
    gesture: "Idle",
  });

  // ─── Load model ───
  const {
    isReady: handModelReady,
    error: handError,
    detect,
  } = useHandTracking();

  // ─── Drawing hook ───
  const { currentGuess, clearOverlay, targetWord, score, correctGuess } = useDrawing({
    drawCanvasRef,
    landmarks: handData.landmarks,
    gesture: handData.gesture,
    htr_on: false
  });


  const guessText = typeof currentGuess === "string" ? currentGuess : "AI GUESSES: …";

  // ─── Called once permission granted ───
  const handleUserMedia = () => {
    console.log("📷 onUserMedia – permission granted");
    // Will wait for 'loadeddata' to mark videoReady.
  };

  // ─── Wait for first video frame (loadeddata) ───
  useEffect(() => {
    const videoEl = webcamRef.current?.video;
    if (!videoEl) return;

    const onLoadedData = () => {
      console.log(
        "📷 video loadeddata – dimensions:",
        videoEl.videoWidth,
        "×",
        videoEl.videoHeight
      );
      if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
        setVideoReady(true);
      }
    };

    videoEl.addEventListener("loadeddata", onLoadedData);
    return () => {
      videoEl.removeEventListener("loadeddata", onLoadedData);
    };
  }, [webcamRef.current]);

  // ~~~ Game Classifier ~~~


  // ─── Stability buffer refs ───
  const lastRawGestureRef = useRef(null);
  const stableCountRef = useRef(0);
  const lastPointRef = useRef(null);
  const smoothingBufferRef = useRef([]);
  const SMOOTHING_BUFFER_SIZE = 3;
  const STABILITY_THRESHOLD = 5; // Increased from 2 to 5 for more stability

  // ─── Main detect loop ───
  useEffect(() => {
    let rafId = null;

    const detectHands = async () => {
      // 1) Wait until both video & model are ready
      if (!videoReady || !handModelReady) {
        rafId = requestAnimationFrame(detectHands);
        return;
      }

      const videoEl = webcamRef.current?.video;
      if (!videoEl) {
        rafId = requestAnimationFrame(detectHands);
        return;
      }

      // 2) Sync canvas sizes to actual video resolution
      if (
        videoEl.videoWidth > 0 &&
        videoEl.videoHeight > 0 &&
        canvasRef.current &&
        drawCanvasRef.current
      ) {
        const w = videoEl.videoWidth;
        const h = videoEl.videoHeight;
        if (canvasRef.current.width !== w) {
          canvasRef.current.width = w;
          canvasRef.current.height = h;
          drawCanvasRef.current.width = w;
          drawCanvasRef.current.height = h;
        }
      }

      // 3) Hide loader once videoReady && handModelReady
      if (isLoading) {
        console.log("✅ isLoading→false");
        setIsLoading(false);
      }

      // 4) Run hand detection
      try {
        const result = await detect(videoEl);
        const rawGesture = result?.gesture ?? "Idle";
        const lm = result?.landmarks ?? null;

        // Draw hand landmarks and connections if detected
        if (lm && canvasRef.current) {
          const ctx = canvasRef.current.getContext('2d');
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
          
          // Draw connections
          ctx.strokeStyle = '#00FF00';
          ctx.lineWidth = 2;
          
          // Palm connections
          const palmConnections = [
            [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
            [0, 5], [5, 6], [6, 7], [7, 8], // Index
            [0, 9], [9, 10], [10, 11], [11, 12], // Middle
            [0, 13], [13, 14], [14, 15], [15, 16], // Ring
            [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
            [5, 9], [9, 13], [13, 17] // Palm
          ];

          palmConnections.forEach(([start, end]) => {
            ctx.beginPath();
            ctx.moveTo(canvasRef.current.width - lm[start][0], lm[start][1]);
            ctx.lineTo(canvasRef.current.width - lm[end][0], lm[end][1]);
            ctx.stroke();
          });

          // Draw landmarks
          ctx.fillStyle = '#FF0000';
          lm.forEach(([x, y]) => {
            ctx.beginPath();
            ctx.arc(canvasRef.current.width - x, y, 3, 0, 2 * Math.PI);
            ctx.fill();
          });

          // Highlight active finger based on gesture
          if (rawGesture === "PointerUp") {
            // Highlight index finger
            ctx.fillStyle = '#FFFF00';
            for (let i = 5; i <= 8; i++) {
              ctx.beginPath();
              ctx.arc(canvasRef.current.width - lm[i][0], lm[i][1], 5, 0, 2 * Math.PI);
              ctx.fill();
            }
          }
        } else if (canvasRef.current) {
          // Clear canvas if no hand detected
          const ctx = canvasRef.current.getContext('2d');
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }

        // ── Stability buffer logic (threshold = 5) ──
        if (rawGesture !== lastRawGestureRef.current) {
          lastRawGestureRef.current = rawGesture;
          stableCountRef.current = 1;
        } else {
          stableCountRef.current++;
        }

        // Commit once seen ≥ 5 frames in a row
        if (stableCountRef.current >= STABILITY_THRESHOLD) {
          // ✅ Only update if gesture changed or landmarks existence changed
          const hadLandmarks = handData.landmarks !== null;
          const hasLandmarks = lm !== null;
          const gestureChanged = rawGesture !== handData.gesture;
          const landmarksStatusChanged = hadLandmarks !== hasLandmarks;
          
          if (gestureChanged || landmarksStatusChanged) {
            setHandData({ landmarks: lm, gesture: rawGesture });
          }
        }

      } catch (e) {
        console.error("❌ detect error:", e);
        setError("Hand tracking failed. Reload & allow camera.");
      }

      rafId = requestAnimationFrame(detectHands);
    };

    detectHands();
    return () => cancelAnimationFrame(rafId);
  }, [videoReady, handModelReady, detect]); // ✅ NO handData here!

// ─── Separate effect to update UI state based on handData ───
useEffect(() => {
  if (handData.landmarks) {
    setHandDetected(true);
  } else {
    setHandDetected(false);
  }

  if (handData.gesture === "PointerUp") {
    setCurrentMode("PointerUp");
  } else if (handData.gesture === "Erase") {
    setCurrentMode("Erase");
  } else {
    setCurrentMode("Idle");
  }
}, [handData]); // ✅ This effect watches handData separately

  // ─── Clear only once per key press ───
  useEffect(() => {
    let clearing = false;
    const onKey = (e) => {
      if (e.key.toLowerCase() === "c" && !clearing) {
        clearing = true;
        clearOverlay();
        setTimeout(() => {
          clearing = false;
        }, 200);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearOverlay]);

  // ─── Model load error UI ───
  if (handError) {
    return (
      <div
        style={{
          padding: 16,
          background: "#b91c1c",
          color: "white",
          borderRadius: 8,
          maxWidth: 400,
          margin: "40px auto",
        }}
      >
        <p style={{ fontWeight: "bold" }}>Model Error:</p>
        <p style={{ marginTop: 8 }}>{handError}</p>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: 12,
            background: "#991b1b",
            color: "#fff",
            padding: "8px 12px",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        background: "#1f2937",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        color: "#f9fafb",
      }}
    >
      <h1
        style={{
          fontSize: 32,
          fontWeight: "bold",
          color: "#fbbf24",
          marginBottom: 24,
        }}
      >
        DRAW vs AI
      </h1>

      {/* Video + Canvases Container */}
      <div
        style={{
          position: "relative",
          width: 640,
          height: 480,
          borderRadius: 8,
          overflow: "hidden",
          background: "#000",
        }}
      >
        {/* 1) Raw webcam feed */}
        <Webcam
          ref={webcamRef}
          onUserMedia={handleUserMedia}
          onUserMediaError={(err) => {
            console.error("onUserMediaError:", err);
            setError("Camera blocked or unavailable.");
          }}
          audio={false}
          mirrored={true}
          videoConstraints={{
            width: 640,
            height: 480,
            facingMode: "user",
          }}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            zIndex: 1,
          }}
        />

        {/* 2) (Optional) landmark-drawing canvas */}
        <canvas
          id="landmark-canvas"
          ref={canvasRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            zIndex: 2,
          }}
        />

        {/* 3) drawing/erasing canvas */}
        <canvas
          id="draw-canvas"
          ref={drawCanvasRef}
          width={640}    // ✅ set actual internal resolution
          height={480}   // ✅ set actual internal resolution
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",   // style scaling
            height: "100%",
            zIndex: 3,
            cursor: "crosshair",
          }}
        />


        {/* 4) Overlays: hand status, mode, guess */}
        {!isLoading && (
          <>
            <div
              style={{
                position: "absolute",
                top: 12,
                left: 12,
                display: "flex",
                flexDirection: "column",
                gap: 8,
                zIndex: 4,
              }}
            >
              <div
                style={{
                  background: "rgba(0,0,0,0.7)",
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: "1px solid #4b5563",
                }}
              >
                <p style={{ color: "#fff", fontSize: 12 }}>
                  HAND:{" "}
                  <span style={{ color: handDetected ? "#22c55e" : "#ef4444" }}>
                    {handDetected ? "DETECTED" : "NOT DETECTED"}
                  </span>
                </p>
              </div>
              <div
                style={{
                  background: "rgba(0,0,0,0.7)",
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: "1px solid #4b5563",
                }}
              >
                <p
                  style={{
                    fontFamily: "monospace",
                    fontWeight: "bold",
                    fontSize: 12,
                    color:
                      currentMode === "PointerUp"
                        ? "#22c55e"
                        : currentMode === "Erase"
                        ? "#facc15"
                        : "#fff",
                  }}
                >
                  MODE: {currentMode.toUpperCase()}
                </p>
              </div>
              <div
                style={{
                  background: "rgba(0,0,0,0.7)",
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: "1px solid #4b5563",
                }}
              >
                <p style={{
                    fontFamily: "monospace",
                    fontWeight: "bold",
                    fontSize: 12,
                    color: guessText.includes("…") ? "#9ca3af" : "#22c55e",
                  }}>
                    Draw: {targetWord}</p>
                <p style={{
                    fontFamily: "monospace",
                    fontWeight: "bold",
                    fontSize: 12,
                    color: guessText.includes("…") ? "#9ca3af" : "#22c55e",
                  }}>
                    Score: {score}</p>
                {correctGuess && <p>✅ Correct!</p>}

                <p
                  style={{
                    fontFamily: "monospace",
                    fontWeight: "bold",
                    fontSize: 12,
                    color: guessText.includes("…") ? "#9ca3af" : "#22c55e",
                  }}
                >
                  {guessText}
                </p>
              </div>
            </div>

            <div
              style={{
                position: "absolute",
                top: 12,
                right: 12,
                background: "rgba(0,0,0,0.7)",
                padding: "8px 12px",
                borderRadius: 6,
                border: "1px solid #4b5563",
                fontSize: 10,
                color: "#d1d5db",
                zIndex: 4,
              }}
            >
              <h3 style={{ fontWeight: "bold", marginBottom: 4 }}>GESTURES</h3>
              <p style={{ margin: 0 }}>
                👆 Left Click or Index Only = <span style={{ color: "#22c55e" }}>DRAW</span>
              </p>
              <p style={{ margin: 0 }}>
                🖱️ Right Click = <span style={{ color: "#facc15" }}>ERASE</span>
              </p>
              <p style={{ margin: 0 }}>
                ✋ Otherwise = <span style={{ color: "#fff" }}>IDLE</span>
              </p>
              <p style={{ margin: 0 }}>⌨️ Press "C" to Clear</p>
            </div>
          </>
        )}
      </div>

      {/* Clear Canvas button */}
      {!isLoading && (
        <button
          onClick={() => clearOverlay()}
          style={{
            marginTop: 24,
            background: "#dc2626",
            color: "#fff",
            fontWeight: "bold",
            padding: "10px 20px",
            borderRadius: 6,
            border: "none",
            cursor: "pointer",
          }}
        >
          Clear Canvas
        </button>
      )}

      {/* Loading overlay */}
      {isLoading && !error && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.9)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 5,
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              border: "4px solid #06b6d4",
              borderTopColor: "transparent",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
              marginBottom: 16,
            }}
          />
          <p
            style={{
              color: "#fff",
              fontSize: 18,
              fontWeight: "600",
              marginBottom: 8,
            }}
          >
            Loading Draw vs AI…
          </p>
          <p style={{ color: "#9ca3af", fontSize: 12 }}>
            Initializing camera & model…
          </p>
        </div>
      )}

      {/* If camera access was blocked or another error occurred */}
      {error && (
        <div
          style={{
            position: "absolute",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#dc2626",
            color: "#fff",
            padding: "8px 16px",
            borderRadius: 6,
          }}
        >
          <p style={{ margin: 0 }}>{error}</p>
        </div>
      )}

      {/* Spinner keyframes */}
      <style>
        {`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}
      </style>
    </div>
  );
}
