// src/capturehands/useDrawing.js

import { useEffect, useRef, useState } from 'react';

/**
 * useDrawing
 *
 * @param {object} args
 * @param {React.RefObject<HTMLCanvasElement>} args.drawCanvasRef – ref to overlay <canvas>
 * @param {Array|null} args.landmarks                               – array of 21 landmarks or null
 * @param {string|null} args.gesture                                – detected gesture from useHandTracking
 */
function useDrawing({ drawCanvasRef, landmarks, gesture }) {
  const prevPosRef = useRef({ x: -1, y: -1 });
  const guessTimerRef = useRef(0);
  const [currentGuess, setCurrentGuess] = useState('AI GUESSES: ...');
  const smoothingBufferRef = useRef([]);
  const SMOOTHING_BUFFER_SIZE = 3;
  const MIN_DISTANCE = 2; // Minimum distance between points to draw
  const isErasingRef = useRef(false);

  const mockPredictions = [
    'CAT','DOG','HOUSE','CAR','TREE','FLOWER',
    'BIRD','FISH','SUN','STAR','HEART','CIRCLE',
    'SQUARE','TRIANGLE','FACE','APPLE'
  ];
  const getRandomPrediction = () =>
    mockPredictions[Math.floor(Math.random() * mockPredictions.length)];

  // Helper function to calculate average point from buffer
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

  // Helper function to calculate distance between points
  const getDistance = (p1, p2) => {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
  };

  // Mouse event handlers for erasing
  useEffect(() => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;

    const handleMouseDown = (e) => {
      if (e.button === 0) { // Left click
        isErasingRef.current = true;
      }
    };

    const handleMouseUp = (e) => {
      if (e.button === 0) { // Left click
        isErasingRef.current = false;
      }
    };

    const handleMouseMove = (e) => {
      if (!isErasingRef.current) return;
      
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const ctx = canvas.getContext('2d');
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(x, y, 25, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    };

    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mousemove', handleMouseMove);

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mousemove', handleMouseMove);
    };
  }, [drawCanvasRef]);

  useEffect(() => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!landmarks || gesture === "Idle") {
      prevPosRef.current = { x: -1, y: -1 };
      smoothingBufferRef.current = [];
      return;
    }

    let rawTip, x, y;

    if (gesture === "PointerUp") {
      // Use index tip for drawing
      rawTip = landmarks[8]; // [xPx, yPx, z]
      x = canvas.width - rawTip[0];
      y = rawTip[1];

      // Add point to smoothing buffer
      smoothingBufferRef.current.push({ x, y });
      if (smoothingBufferRef.current.length > SMOOTHING_BUFFER_SIZE) {
        smoothingBufferRef.current.shift();
      }

      // Get smoothed point
      const smoothedPoint = getAveragePoint(smoothingBufferRef.current);
      if (!smoothedPoint) return;

      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (prevPosRef.current.x === -1) {
        prevPosRef.current = smoothedPoint;
        ctx.beginPath();
        ctx.moveTo(smoothedPoint.x, smoothedPoint.y);
        ctx.lineTo(smoothedPoint.x + 0.1, smoothedPoint.y + 0.1);
        ctx.stroke();
      } else {
        // Only draw if distance is significant enough
        const distance = getDistance(prevPosRef.current, smoothedPoint);
        if (distance >= MIN_DISTANCE) {
          ctx.beginPath();
          ctx.moveTo(prevPosRef.current.x, prevPosRef.current.y);
          ctx.lineTo(smoothedPoint.x, smoothedPoint.y);
          ctx.stroke();
          prevPosRef.current = smoothedPoint;
        }
      }

      guessTimerRef.current++;
      if (guessTimerRef.current % 45 === 0) {
        setCurrentGuess(`AI GUESSES: ${getRandomPrediction()}`);
      }
    }
  }, [drawCanvasRef, landmarks, gesture]);

  const clearOverlay = () => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    
    // Use requestAnimationFrame to prevent blocking
    requestAnimationFrame(() => {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setCurrentGuess('Canvas cleared!');
      setTimeout(() => {
        setCurrentGuess('AI GUESSES: ...');
      }, 2000);
      prevPosRef.current = { x: -1, y: -1 };
      guessTimerRef.current = 0;
      smoothingBufferRef.current = [];
    });
  };

  return {
    currentGuess,
    clearOverlay,
  };
}

export default useDrawing;
