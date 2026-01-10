import { useCallback, useEffect, useRef } from 'react';
import { useDrawingClassifier } from './useDrawingClassifier';

function useDrawing({ drawCanvasRef, landmarks, gesture, htr_on}) {
  const ENABLE_HAND_TRACKING = false;

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

  // ✅ MOUSE DRAWING (FIXED)
  useEffect(() => {
    const canvas = drawCanvasRef.current;
    if (!canvas) {
      console.warn("⚠ drawCanvasRef is null");
      return;
    }

    if (canvas.id !== "draw-canvas") {
      console.error("✗ Ref is not pointing to #draw-canvas:", canvas);
      return;
    }

    console.log("✓ Drawing canvas confirmed:", canvas);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // Set drawing context properties ONCE at setup
    const setupDrawingContext = () => {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
    };

    const handleMouseDown = (e) => {
      if (e.button === 0) {
        setupDrawingContext();
        lastGuessRef.current = 0;
        isDrawingRef.current = true;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        prevPosRef.current = { x, y };
        smoothingBufferRef.current = [{ x, y }];
        
        // Start path at first point
        ctx.beginPath();
        ctx.moveTo(x, y);
      } else if (e.button === 2) {
        isErasingRef.current = true;
      }
    };

    const handleMouseUp = (e) => {
      if (e.button === 0) {
        ctx.stroke();  // Finalize the path
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
        setupDrawingContext();

        const now = Date.now();
        if (isModelReady && now - lastGuessRef.current > GUESS_EVERY_MS) {
          lastGuessRef.current = now;
          updateGuess(canvas);
        }

        // Add to smoothing buffer
        smoothingBufferRef.current.push({ x, y });
        if (smoothingBufferRef.current.length > SMOOTHING_BUFFER_SIZE) {
          smoothingBufferRef.current.shift();
        }

        // Get smoothed point
        const smoothedPoint = getAveragePoint(smoothingBufferRef.current);
        if (!smoothedPoint) return;

        // Only draw if we've moved far enough
        if (prevPosRef.current.x === -1) {
          // First point - already moved with beginPath/moveTo in mouseDown
          prevPosRef.current = smoothedPoint;
        } else {
          const distance = getDistance(prevPosRef.current, smoothedPoint);
          if (distance >= MIN_DISTANCE) {
            // Draw line and continue path
            ctx.lineTo(smoothedPoint.x, smoothedPoint.y);
            ctx.stroke();
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

  // ✅ HAND TRACKING DRAWING (minimal changes for consistency)
  useEffect(() => {
    // ✅ Disable hand tracking if toggle is off
    if (!ENABLE_HAND_TRACKING) return;

    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    if (!landmarks || gesture === "Idle") {
      prevPosRef.current = { x: -1, y: -1 };
      smoothingBufferRef.current = [];
      return;
    }

    let x, y;

    if (gesture === "PointerUp" && htr_on) {
      const rawTip = landmarks[8];
      x = canvas.width - rawTip[0];
      y = rawTip[1];

      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

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
          ctx.beginPath();
          ctx.moveTo(prevPosRef.current.x, prevPosRef.current.y);
          ctx.lineTo(smoothedPoint.x, smoothedPoint.y);
          ctx.stroke();
          prevPosRef.current = smoothedPoint;
        }
      }

      const now = Date.now();
      if (isModelReady && now - lastGuessRef.current > GUESS_EVERY_MS) {
        lastGuessRef.current = now;
        updateGuess(canvas);
      }
    } else {
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