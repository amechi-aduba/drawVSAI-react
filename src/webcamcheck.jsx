// src/components/SanityCheckWebcam.jsx

import React, { useRef, useState, useEffect } from "react";
import Webcam from "react-webcam";

export default function SanityCheckWebcam() {
  const webcamRef = useRef(null);
  const [videoReady, setVideoReady] = useState(false);
  const [error, setError] = useState(null);

  const handleUserMedia = () => {
    // This will fire as soon as the video stream is active
    console.log("📷 onUserMedia fired – camera is streaming!");
    const vidEl = webcamRef.current?.video;
    console.log("   → video element:", vidEl);
    if (vidEl) {
      console.log(
        "   → video dimensions:",
        vidEl.videoWidth,
        "×",
        vidEl.videoHeight
      );
    }
    setVideoReady(true);
  };

  return (
    <div
      style={{
        background: "#111827",
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        color: "#fff",
      }}
    >
      <div
        style={{
          position: "relative",
          width: 640,
          height: 480,
          border: "3px solid cyan",
          borderRadius: "8px",
          overflow: "hidden",
        }}
      >
        <Webcam
          ref={webcamRef}
          onUserMedia={handleUserMedia}
          onUserMediaError={(err) => {
            console.error("❌ onUserMediaError:", err);
            setError("Camera access was blocked or unavailable.");
          }}
          audio={false}
          mirrored={true}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />

        {error && (
          <div
            style={{
              position: "absolute",
              bottom: 8,
              left: 8,
              background: "rgba(255, 0, 0, 0.8)",
              padding: "6px 10px",
              borderRadius: "4px",
            }}
          >
            {error}
          </div>
        )}

        {!videoReady && !error && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0, 0, 0, 0.75)",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                border: "4px solid #00bcd4",
                borderTopColor: "transparent",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
                marginBottom: 12,
              }}
            />
            <p>Waiting for camera…</p>
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
    </div>
  );
}
