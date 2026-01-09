import { useCallback, useEffect, useRef } from 'react';
import { useDrawingClassifier } from './useDrawingClassifier';

function useDrawing({ drawCanvasRef, landmarks, gesture, htr_on}) {
  const clearOverlay = useCallback(() => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, [drawCanvasRef]);

  const { isModelReady, currentGuess, updateGuess, targetWord, score, correctGuess } = 
    useDrawingClassifier({ onCorrect: clearOverlay });

  const prevPosRef = useRef({ x: -1, y: -1 });
  const smoothingBufferRef = useRef([]);
  const SMOOTHING_BUFFER_SIZE = 3;
  const MIN_DISTANCE = 2;
  const isErasingRef = useRef(false);
  const isDrawingRef = useRef(false);
  const lastGuessRef = useRef(0);
  const GUESS_EVERY_MS = 350;

  const getAveragePoint = (points) => {
    if (points.length === 0) return null;
    const sum = points.reduce((acc, point) => ({
      x: acc.x + point.x,
      y: acc.y + point.y
    }), { x: 0, y: 0 });
    return {
      x: sum.x / points.length,
      y: sum.y / points.length
    };
  };

  const getDistance = (p1, p2) => {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
  };

  const drawLine = (ctx, fromPoint, toPoint) => {
    ctx.beginPath();
    ctx.moveTo(fromPoint.x, fromPoint.y);
    ctx.lineTo(toPoint.x, toPoint.y);
    ctx.stroke();
  };

  // ✅ MOUSE DRAWING (FALLBACK)
  useEffect(() => {
    const canvas = drawCanvasRef.current;
    if (!canvas) {
      console.warn("❗ drawCanvasRef is null");
      return;
    }

    if (canvas.id !== "draw-canvas") {
      console.error("❌ Ref is not pointing to #draw-canvas:", canvas);
      return;
    }

    console.log("✅ Drawing canvas confirmed:", canvas);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const handleMouseDown = (e) => {
      if (e.button === 0) {
        lastGuessRef.current = 0;
        isDrawingRef.current = true;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        prevPosRef.current = { x, y };
        smoothingBufferRef.current = [];
      } else if (e.button === 2) {
        isErasingRef.current = true;
      }
    };

    const handleMouseUp = (e) => {
      if (e.button === 0) {
        isDrawingRef.current = false;
        if (isModelReady) {
          updateGuess(canvas);
        }
      } else if (e.button === 2) {
        isErasingRef.current = false;
        if (isModelReady) updateGuess(canvas);
      }
    };

    const handleMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (isDrawingRef.current) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 10;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const now = Date.now();
        if (isModelReady && now - lastGuessRef.current > GUESS_EVERY_MS) {
          lastGuessRef.current = now;
          updateGuess(canvas);
        }

        smoothingBufferRef.current.push({ x, y });
        if (smoothingBufferRef.current.length > SMOOTHING_BUFFER_SIZE) {
          smoothingBufferRef.current.shift();
        }

        const smoothedPoint = getAveragePoint(smoothingBufferRef.current);
        if (!smoothedPoint) return;

        if (prevPosRef.current.x === -1) {
          prevPosRef.current = smoothedPoint;
          ctx.beginPath();
          ctx.moveTo(smoothedPoint.x, smoothedPoint.y);
          ctx.lineTo(smoothedPoint.x + 0.1, smoothedPoint.y + 0.1);
          ctx.stroke();
        } else {
          const distance = getDistance(prevPosRef.current, smoothedPoint);
          if (distance >= MIN_DISTANCE) {
            drawLine(ctx, prevPosRef.current, smoothedPoint);
            prevPosRef.current = smoothedPoint;
          }
        }
      } else if (isErasingRef.current) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(x, y, 25, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';

        const now = Date.now();
        if (isModelReady && now - lastGuessRef.current > GUESS_EVERY_MS) {
          lastGuessRef.current = now;
          updateGuess(canvas);
        }
      }
    };

    const handleContextMenu = (e) => {
      e.preventDefault();
    };

    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('contextmenu', handleContextMenu);

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [drawCanvasRef, isModelReady, updateGuess]);

  // ✅ HAND TRACKING DRAWING (PRIMARY)
  useEffect(() => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    // Reset when hand is idle or not detected
    if (!landmarks || gesture === "Idle") {
      prevPosRef.current = { x: -1, y: -1 };
      smoothingBufferRef.current = [];
      return;
    }

    let x, y;

    if (gesture === "PointerUp" && htr_on) {
      // Use index finger tip (landmark 8)
      const rawTip = landmarks[8]; // [xPx, yPx, z]
      x = canvas.width - rawTip[0];  // Mirror horizontally
      y = rawTip[1];

      // Setup drawing style
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 10;  // Match mouse lineWidth
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Add point to smoothing buffer
      smoothingBufferRef.current.push({ x, y });
      if (smoothingBufferRef.current.length > SMOOTHING_BUFFER_SIZE) {
        smoothingBufferRef.current.shift();
      }

      // Get smoothed point
      const smoothedPoint = getAveragePoint(smoothingBufferRef.current);
      if (!smoothedPoint) return;

      // Draw line
      if (prevPosRef.current.x === -1) {
        // First point
        prevPosRef.current = smoothedPoint;
        ctx.beginPath();
        ctx.moveTo(smoothedPoint.x, smoothedPoint.y);
        ctx.lineTo(smoothedPoint.x + 0.1, smoothedPoint.y + 0.1);
        ctx.stroke();
      } else {
        // Draw if distance is significant
        const distance = getDistance(prevPosRef.current, smoothedPoint);
        if (distance >= MIN_DISTANCE) {
          drawLine(ctx, prevPosRef.current, smoothedPoint);
          prevPosRef.current = smoothedPoint;
        }
      }

      // Update AI guess periodically
      const now = Date.now();
      if (isModelReady && now - lastGuessRef.current > GUESS_EVERY_MS) {
        lastGuessRef.current = now;
        updateGuess(canvas);
      }
    } else {
      // Non-PointerUp gestures: reset drawing state
        if (htr_on){
          prevPosRef.current = { x: -1, y: -1 };
          smoothingBufferRef.current = [];
        }
    }
  }, [drawCanvasRef, landmarks, gesture, isModelReady, updateGuess]);

  return {
    currentGuess,
    targetWord,
    score,
    correctGuess,
    clearOverlay,
  };
}

export default useDrawing;