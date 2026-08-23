import { useEffect, useRef, useState } from "react";
import * as tf from "@tensorflow/tfjs";
import * as handpose from "@tensorflow-models/handpose";
import {
  RefreshCw,
  Play,
  Pause,
  RotateCcw,
  Sliders,
  HelpCircle,
  Award,
  Flame,
  Check,
  Smile,
  Sparkles,
  ArrowRight,
  CameraOff,
  X,
  Apple,
  CupSoda,
  Star,
} from "lucide-react";

// Game Constants
const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 480;
const GRID_COLS = 80;
const GRID_ROWS = 60;
const CELL_SIZE = 8; // 640 / 80 = 8, 480 / 60 = 8

interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
}

interface StarObjective {
  x: number;
  y: number;
  radius: number;
  caught: boolean;
}

type LevelType = 1 | 2 | 3;

export default function OsmoNewton({ onBack }: { onBack: () => void }) {
  // References
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const smallCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // States
  const [model, setModel] = useState<handpose.HandPose | null>(null);
  const [loadingModel, setLoadingModel] = useState<boolean>(false);
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [webcamAllowed, setWebcamAllowed] = useState<boolean>(true);
  
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [score, setScore] = useState<number>(0);
  const [currentLevel, setCurrentLevel] = useState<LevelType>(1);
  const [levelProgress, setLevelProgress] = useState<number>(0); // e.g. how many berries eaten, or stars caught
  const [levelComplete, setLevelComplete] = useState<boolean>(false);
  
  // Settings
  const [threshold, setThreshold] = useState<number>(95); // Luminance threshold for dark line detection
  const [opacity, setOpacity] = useState<number>(0.35); // Camera video feed opacity
  const [isHandTracking, setIsHandTracking] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showInstructions, setShowInstructions] = useState<boolean>(true);

  // Game Loop Refs to prevent re-triggering effects
  const particlesRef = useRef<Particle[]>([]);
  const nextParticleIdRef = useRef<number>(0);
  const levelProgressRef = useRef<number>(0);
  const scoreRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(false);
  const currentLevelRef = useRef<LevelType>(1);
  const isHandTrackingRef = useRef<boolean>(false);
  const thresholdRef = useRef<number>(95);
  const handLandmarksRef = useRef<number[][] | null>(null);

  // Level 2 Cup States
  const [cup1Fill, setCup1Fill] = useState<number>(0);
  const [cup2Fill, setCup2Fill] = useState<number>(0);
  const cup1FillRef = useRef<number>(0);
  const cup2FillRef = useRef<number>(0);

  // Level 3 Star States
  const [, setStars] = useState<StarObjective[]>([]);
  const starsRef = useRef<StarObjective[]>([]);

  // Sound Synth Helper (Standard Web Audio API to avoid external asset dependency)
  const playSound = (type: "eat" | "star" | "win" | "bounce") => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === "bounce") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(150, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.05, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.1);
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
      } else if (type === "eat") {
        osc.type = "triangle";
        osc.frequency.setValueAtTime(200, ctx.currentTime);
        osc.frequency.setValueAtTime(400, ctx.currentTime + 0.08);
        osc.frequency.setValueAtTime(600, ctx.currentTime + 0.16);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.25);
        osc.start();
        osc.stop(ctx.currentTime + 0.25);
      } else if (type === "star") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
        osc.frequency.exponentialRampToValueAtTime(1046.50, ctx.currentTime + 0.2); // C6
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.25);
        osc.start();
        osc.stop(ctx.currentTime + 0.25);
      } else if (type === "win") {
        const notes = [261.63, 329.63, 392.00, 523.25]; // C E G C
        notes.forEach((freq, i) => {
          const oscN = ctx.createOscillator();
          const gainN = ctx.createGain();
          oscN.connect(gainN);
          gainN.connect(ctx.destination);
          oscN.type = "triangle";
          oscN.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.1);
          gainN.gain.setValueAtTime(0.1, ctx.currentTime + i * 0.1);
          gainN.gain.linearRampToValueAtTime(0.01, ctx.currentTime + i * 0.1 + 0.25);
          oscN.start(ctx.currentTime + i * 0.1);
          oscN.stop(ctx.currentTime + i * 0.1 + 0.25);
        });
      }
    } catch (e) {
      console.warn("Audio Context blocked or unsupported:", e);
    }
  };

  // Sync ref variables
  useEffect(() => {
    isPlayingRef.current = isPlaying;
    currentLevelRef.current = currentLevel;
    isHandTrackingRef.current = isHandTracking;
    thresholdRef.current = threshold;
  }, [isPlaying, currentLevel, isHandTracking, threshold]);

  // Load level configuration
  const setupLevel = (lvl: LevelType) => {
    particlesRef.current = [];
    setLevelProgress(0);
    levelProgressRef.current = 0;
    setLevelComplete(false);
    
    if (lvl === 2) {
      cup1FillRef.current = 0;
      cup2FillRef.current = 0;
      setCup1Fill(0);
      setCup2Fill(0);
    } else if (lvl === 3) {
      const initialStars: StarObjective[] = [
        { x: 150, y: 180, radius: 18, caught: false },
        { x: 320, y: 260, radius: 18, caught: false },
        { x: 480, y: 160, radius: 18, caught: false },
        { x: 100, y: 340, radius: 18, caught: false },
        { x: 540, y: 320, radius: 18, caught: false }
      ];
      setStars(initialStars);
      starsRef.current = initialStars;
    }
  };

  useEffect(() => {
    setupLevel(currentLevel);
  }, [currentLevel]);

  // Load TensorFlow Handpose Model if Hand Tracking is toggled
  useEffect(() => {
    if (isHandTracking && !model && !loadingModel) {
      async function loadHandpose() {
        try {
          setLoadingModel(true);
          await tf.ready();
          const loadedModel = await handpose.load();
          setModel(loadedModel);
          setLoadingModel(false);
        } catch (err) {
          console.error("Error loading handpose model:", err);
          setLoadingModel(false);
          setIsHandTracking(false);
          alert("فشل تحميل ذكاء تتبع اليدين. يرجى التأكد من الاتصال بالإنترنت.");
        }
      }
      loadHandpose();
    }
  }, [isHandTracking, model, loadingModel]);

  // Start Camera
  const startCamera = async () => {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, facingMode: "user" },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
        setCameraActive(true);
        setWebcamAllowed(true);
      } else {
        setWebcamAllowed(false);
      }
    } catch (err) {
      console.error("Camera access denied:", err);
      setWebcamAllowed(false);
    }
  };

  // Close Camera
  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, []);

  // Main Processing & Animation Loop
  useEffect(() => {
    let animationFrameId: number;
    let frameCount = 0;
    
    // Collision grid map (GRID_ROWS x GRID_COLS)
    const collisionGrid = Array(GRID_ROWS).fill(null).map(() => Array(GRID_COLS).fill(false));

    const loop = async () => {
      if (!cameraActive) {
        animationFrameId = requestAnimationFrame(loop);
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const smallCanvas = smallCanvasRef.current;

      if (video && video.readyState >= 2 && canvas && smallCanvas) {
        const ctx = canvas.getContext("2d");
        const sCtx = smallCanvas.getContext("2d");

        if (ctx && sCtx) {
          // Clear Canvas
          ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

          // 1. Draw Mirror Video to hidden Downscaler Canvas
          sCtx.save();
          sCtx.translate(GRID_COLS, 0);
          sCtx.scale(-1, 1); // mirror horizontal
          sCtx.drawImage(video, 0, 0, GRID_COLS, GRID_ROWS);
          sCtx.restore();

          // 2. Mirror Video to main display canvas as background
          ctx.save();
          ctx.globalAlpha = opacity;
          ctx.translate(CANVAS_WIDTH, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(video, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
          ctx.restore();

          // 3. Reset collision grid
          for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
              collisionGrid[r][c] = false;
            }
          }

          // 4. Perform hand tracking if active
          if (isHandTrackingRef.current && model) {
            try {
              const predictions = await model.estimateHands(video);
              if (predictions.length > 0) {
                const landmarks = predictions[0].landmarks;
                handLandmarksRef.current = landmarks;
                
                // Draw hand bones in the collision grid (make cell coordinates around skeleton active)
                landmarks.forEach(([hx, hy]) => {
                  // Hand coordinates are based on video size, mirror hx
                  const mirroredHx = CANVAS_WIDTH - hx;
                  const c = Math.floor(mirroredHx / CELL_SIZE);
                  const r = Math.floor(hy / CELL_SIZE);
                  
                  // Mark a radius around joints as solid in grid
                  const radiusCells = 2;
                  for (let dr = -radiusCells; dr <= radiusCells; dr++) {
                    for (let dc = -radiusCells; dc <= radiusCells; dc++) {
                      const nr = r + dr;
                      const nc = c + dc;
                      if (nr >= 0 && nr < GRID_ROWS && nc >= 0 && nc < GRID_COLS) {
                        collisionGrid[nr][nc] = true;
                      }
                    }
                  }
                });
              } else {
                handLandmarksRef.current = null;
              }
            } catch (err) {
              console.error("Handpose prediction error", err);
            }
          } else {
            handLandmarksRef.current = null;
          }

          // 5. Read low-res pixels for dark line tracking
          // Reading 80x60 grid takes almost 0 time
          const imgData = sCtx.getImageData(0, 0, GRID_COLS, GRID_ROWS);
          const pixels = imgData.data;

          for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
              // In Handpose mode, we already marked hand cells. In normal mode we detect dark pixels:
              if (!collisionGrid[r][c]) {
                const idx = (r * GRID_COLS + c) * 4;
                const red = pixels[idx];
                const green = pixels[idx + 1];
                const blue = pixels[idx + 2];
                
                // Standard grayscale luminance formula
                const luma = 0.299 * red + 0.587 * green + 0.114 * blue;
                if (luma < thresholdRef.current) {
                  collisionGrid[r][c] = true;
                }
              }
            }
          }

          // 6. Draw the collision map overlay so the user sees detected lines (Neon Glow style)
          ctx.fillStyle = "rgba(149, 225, 211, 0.4)"; // Soft mint glow
          for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
              if (collisionGrid[r][c]) {
                ctx.fillRect(c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, CELL_SIZE);
                // Draw tiny border for technical look
                ctx.strokeStyle = "rgba(78, 205, 196, 0.2)";
                ctx.strokeRect(c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, CELL_SIZE);
              }
            }
          }

          // 7. Draw Hand Pose Skeleton in canvas overlay if detected
          if (isHandTrackingRef.current && handLandmarksRef.current) {
            ctx.fillStyle = "#FF6B6B";
            ctx.strokeStyle = "#4ECDC4";
            ctx.lineWidth = 4;
            
            const landmarks = handLandmarksRef.current;
            const connections = [
              [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
              [0, 5], [5, 6], [6, 7], [7, 8], // Index
              [5, 9], [9, 10], [10, 11], [11, 12], // Middle
              [9, 13], [13, 14], [14, 15], [15, 16], // Ring
              [13, 17], [17, 18], [18, 19], [19, 20], // Pinky
              [0, 17] // Palm wrap
            ];

            connections.forEach(([from, to]) => {
              const fx = CANVAS_WIDTH - landmarks[from][0]; // mirrored
              const fy = landmarks[from][1];
              const tx = CANVAS_WIDTH - landmarks[to][0]; // mirrored
              const ty = landmarks[to][1];
              ctx.beginPath();
              ctx.moveTo(fx, fy);
              ctx.lineTo(tx, ty);
              ctx.stroke();
            });

            landmarks.forEach(([x, y]) => {
              ctx.beginPath();
              ctx.arc(CANVAS_WIDTH - x, y, 6, 0, 2 * Math.PI);
              ctx.fill();
            });
          }

          // 8. Draw Level-Specific Static/Animated Assets
          const lvl = currentLevelRef.current;
          drawLevelAssets(ctx, lvl);

          // 9. Update & Draw Physics Particles
          if (isPlayingRef.current) {
            // Spawn new particle from level's spawner at interval
            frameCount++;
            if (frameCount % 6 === 0 && particlesRef.current.length < 50) {
              const spawner = getLevelSpawner(lvl);
              const colors = ["#FF6B6B", "#FFE66D", "#AA96DA", "#4ECDC4", "#FCBAD3"];
              particlesRef.current.push({
                id: nextParticleIdRef.current++,
                x: spawner.x + (Math.random() * 20 - 10),
                y: spawner.y,
                vx: spawner.vx + (Math.random() * 2 - 1),
                vy: spawner.vy + (Math.random() * 1),
                radius: 6 + Math.random() * 4,
                color: colors[Math.floor(Math.random() * colors.length)]
              });
            }

            // Update particle locations and perform collision checks
            const gravity = 0.18;
            const elasticity = 0.55;
            const particles = particlesRef.current;

            for (let i = particles.length - 1; i >= 0; i--) {
              const p = particles[i];

              // Apply physics
              p.vy += gravity;
              p.x += p.vx;
              p.y += p.vy;

              // Border bounds check
              if (p.x - p.radius < 0) {
                p.x = p.radius;
                p.vx = -p.vx * elasticity;
                playSound("bounce");
              } else if (p.x + p.radius > CANVAS_WIDTH) {
                p.x = CANVAS_WIDTH - p.radius;
                p.vx = -p.vx * elasticity;
                playSound("bounce");
              }

              // Check grid collision
              const col = Math.floor(p.x / CELL_SIZE);
              const row = Math.floor(p.y / CELL_SIZE);

              if (row >= 0 && row < GRID_ROWS && col >= 0 && col < GRID_COLS) {
                if (collisionGrid[row][col]) {
                  // Find reflection normal from surrounding cells
                  let sumDx = 0;
                  let sumDy = 0;
                  let count = 0;
                  const searchRad = 2;

                  for (let dr = -searchRad; dr <= searchRad; dr++) {
                    for (let dc = -searchRad; dc <= searchRad; dc++) {
                      const nr = row + dr;
                      const nc = col + dc;
                      if (nr >= 0 && nr < GRID_ROWS && nc >= 0 && nc < GRID_COLS && collisionGrid[nr][nc]) {
                        // Vector from solid cell to particle
                        const cellX = nc * CELL_SIZE + CELL_SIZE / 2;
                        const cellY = nr * CELL_SIZE + CELL_SIZE / 2;
                        const dx = p.x - cellX;
                        const dy = p.y - cellY;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist > 0) {
                          sumDx += dx / dist;
                          sumDy += dy / dist;
                          count++;
                        }
                      }
                    }
                  }

                  if (count > 0) {
                    let nx = sumDx / count;
                    let ny = sumDy / count;
                    const len = Math.sqrt(nx * nx + ny * ny);
                    if (len > 0) {
                      nx /= len;
                      ny /= len;
                    } else {
                      nx = 0;
                      ny = -1;
                    }

                    // Dot product
                    const dot = p.vx * nx + p.vy * ny;
                    if (dot < 0) { // moving towards obstacle
                      // Reflect velocity
                      p.vx = (p.vx - 2 * dot * nx) * elasticity;
                      p.vy = (p.vy - 2 * dot * ny) * elasticity;
                      
                      // Push particle out of obstacle to prevent sticking
                      p.x += nx * (p.radius / 2 + 1);
                      p.y += ny * (p.radius / 2 + 1);
                      
                      if (Math.abs(p.vy) > 0.8) {
                        playSound("bounce");
                      }
                    }
                  } else {
                    p.vy = -p.vy * elasticity;
                    p.y -= 4;
                  }
                }
              }

              // Draw particle
              ctx.beginPath();
              ctx.arc(p.x, p.y, p.radius, 0, 2 * Math.PI);
              ctx.fillStyle = p.color;
              ctx.fill();
              
              // Highlight on particle (3D glass feel)
              ctx.beginPath();
              ctx.arc(p.x - p.radius/3, p.y - p.radius/3, p.radius/4, 0, 2 * Math.PI);
              ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
              ctx.fill();

              // Level Objectives collision trigger
              let triggered = false;

              if (lvl === 1) {
                // Panda Eating Mouth Center (520, 380)
                const distToPandaMouth = Math.sqrt((p.x - 520) ** 2 + (p.y - 380) ** 2);
                if (distToPandaMouth < 45) {
                  triggered = true;
                  handleGoalTriggered(lvl);
                }
              } else if (lvl === 2) {
                // Cups boundaries
                // Cup 1: x: 170-230, y: 380-420
                if (p.x >= 170 && p.x <= 230 && p.y >= 370 && p.y <= 420) {
                  triggered = true;
                  if (cup1FillRef.current < 100) {
                    cup1FillRef.current = Math.min(cup1FillRef.current + 5, 100);
                    setCup1Fill(cup1FillRef.current);
                    playSound("eat");
                    scoreRef.current += 5;
                    setScore(scoreRef.current);
                    checkLevelTwoCompletion();
                  }
                }
                // Cup 2: x: 420-480, y: 330-370
                else if (p.x >= 420 && p.x <= 480 && p.y >= 320 && p.y <= 370) {
                  triggered = true;
                  if (cup2FillRef.current < 100) {
                    cup2FillRef.current = Math.min(cup2FillRef.current + 5, 100);
                    setCup2Fill(cup2FillRef.current);
                    playSound("eat");
                    scoreRef.current += 5;
                    setScore(scoreRef.current);
                    checkLevelTwoCompletion();
                  }
                }
              } else if (lvl === 3) {
                // Stars collection
                starsRef.current.forEach((star) => {
                  if (!star.caught) {
                    const distToStar = Math.sqrt((p.x - star.x) ** 2 + (p.y - star.y) ** 2);
                    if (distToStar < (star.radius + p.radius)) {
                      triggered = true;
                      star.caught = true;
                      playSound("star");
                      scoreRef.current += 20;
                      setScore(scoreRef.current);
                      
                      // Trigger state sync
                      const updatedStars = [...starsRef.current];
                      setStars(updatedStars);
                      
                      // Trigger sparkles burst on star location
                      triggerSparkles(ctx, star.x, star.y);
                      
                      // Check level completion
                      const uncaught = updatedStars.filter(s => !s.caught).length;
                      setLevelProgress(updatedStars.length - uncaught);
                      levelProgressRef.current = updatedStars.length - uncaught;
                      
                      if (uncaught === 0) {
                        handleLevelComplete();
                      }
                    }
                  }
                });
              }

              // Remove if triggered or fallen past bottom screen
              if (triggered || p.y - p.radius > CANVAS_HEIGHT) {
                particles.splice(i, 1);
              }
            }
          } else {
            // If paused, just draw static particles
            particlesRef.current.forEach((p) => {
              ctx.beginPath();
              ctx.arc(p.x, p.y, p.radius, 0, 2 * Math.PI);
              ctx.fillStyle = p.color;
              ctx.fill();
            });
          }
        }
      }

      animationFrameId = requestAnimationFrame(loop);
    };

    animationFrameId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [cameraActive, opacity]);

  // Level Spawner details
  const getLevelSpawner = (lvl: LevelType) => {
    if (lvl === 1) return { x: 120, y: 30, vx: 0.5, vy: 0 };
    if (lvl === 2) return { x: 320, y: 30, vx: 0, vy: 0 };
    return { x: 320, y: 30, vx: 0, vy: 0 }; // Level 3 spawner
  };

  // Sparkles drawing helper
  const triggerSparkles = (ctx: CanvasRenderingContext2D, sx: number, sy: number) => {
    for (let angle = 0; angle < 360; angle += 45) {
      const rad = (angle * Math.PI) / 180;
      const length = 15 + Math.random() * 15;
      const ex = sx + Math.cos(rad) * length;
      const ey = sy + Math.sin(rad) * length;

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.strokeStyle = "#FFE66D";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  };

  // Render game targets & illustrations
  const drawLevelAssets = (ctx: CanvasRenderingContext2D, lvl: LevelType) => {
    if (lvl === 1) {
      // Draw Spawner: clouds with berries dropping indicator
      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      ctx.beginPath();
      ctx.arc(100, 30, 25, 0, 2 * Math.PI);
      ctx.arc(125, 25, 30, 0, 2 * Math.PI);
      ctx.arc(150, 30, 25, 0, 2 * Math.PI);
      ctx.fill();
      
      // Spawner label/arrow
      ctx.fillStyle = "#FF6B6B";
      ctx.font = "bold 11px sans-serif";
      ctx.fillText("بوابة الثمار 🍓", 100, 75);

      // Draw Panda Face at bottom-right (520, 380)
      const px = 520;
      const py = 380;

      // Panda body/shoulders
      ctx.fillStyle = "#111111";
      ctx.beginPath();
      ctx.ellipse(px, py + 70, 70, 40, 0, 0, 2 * Math.PI);
      ctx.fill();

      // Ears
      ctx.fillStyle = "#111111";
      ctx.beginPath();
      ctx.arc(px - 45, py - 40, 20, 0, 2 * Math.PI); // Left
      ctx.arc(px + 45, py - 40, 20, 0, 2 * Math.PI); // Right
      ctx.fill();

      // Head
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.arc(px, py, 50, 0, 2 * Math.PI);
      ctx.fill();

      // Eyes patches (Black)
      ctx.fillStyle = "#111111";
      ctx.beginPath();
      ctx.ellipse(px - 20, py - 10, 16, 12, Math.PI/6, 0, 2 * Math.PI); // Left
      ctx.ellipse(px + 20, py - 10, 16, 12, -Math.PI/6, 0, 2 * Math.PI); // Right
      ctx.fill();

      // Pupils (White/Blue)
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.arc(px - 18, py - 10, 5, 0, 2 * Math.PI);
      ctx.arc(px + 18, py - 10, 5, 0, 2 * Math.PI);
      ctx.fill();

      // Nose
      ctx.fillStyle = "#111111";
      ctx.beginPath();
      ctx.ellipse(px, py + 10, 8, 5, 0, 0, 2 * Math.PI);
      ctx.fill();

      // Mouth (Eating target area)
      ctx.fillStyle = "#FFB6C1"; // Pink mouth interior
      ctx.beginPath();
      const mouthRadius = 18 + (isPlayingRef.current && frameCountSync() % 20 < 10 ? 4 : 0); // animation
      ctx.arc(px, py + 22, mouthRadius, 0, Math.PI);
      ctx.fill();
      
      ctx.strokeStyle = "#111111";
      ctx.lineWidth = 3;
      ctx.stroke();

      // Panda Label
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 13px Cairo";
      ctx.fillText("باندا جائع 🐼", px - 35, py - 65);
    } else if (lvl === 2) {
      // Water Spawner (Magic Faucet)
      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      ctx.beginPath();
      ctx.arc(320, 20, 20, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = "#4ECDC4";
      ctx.font = "bold 11px sans-serif";
      ctx.fillText("ينبوع السحر 💧", 290, 60);

      // Draw Cup 1 (x: 200, y: 400)
      drawCup(ctx, 200, 400, cup1FillRef.current, "#FF6B6B", "كوب الكرز 🍒");

      // Draw Cup 2 (x: 450, y: 350)
      drawCup(ctx, 450, 350, cup2FillRef.current, "#FFE66D", "كوب الموز 🍌");
    } else if (lvl === 3) {
      // Cosmic spawner
      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      ctx.beginPath();
      ctx.arc(320, 20, 18, 0, 2 * Math.PI);
      ctx.fill();

      // Draw active stars
      starsRef.current.forEach((star) => {
        if (!star.caught) {
          // Draw standard star shape using canvas paths
          drawStarShape(ctx, star.x, star.y, 5, star.radius, star.radius/2);
        }
      });
    }
  };

  const frameCountSync = () => {
    // Return mock ticks for animation
    return Math.floor(Date.now() / 50);
  };

  // Draw customized beaker/cup
  const drawCup = (ctx: CanvasRenderingContext2D, cx: number, cy: number, fillPct: number, color: string, label: string) => {
    // Cup shape coords: width 60, height 50
    const w = 60;
    const h = 50;
    const rx = cx - w/2;
    const ry = cy - h;

    // Draw Liquid inside cup based on percentage
    if (fillPct > 0) {
      ctx.fillStyle = color;
      const liquidHeight = (h - 6) * (fillPct / 100);
      ctx.beginPath();
      ctx.moveTo(rx + 4, cy - 3);
      ctx.lineTo(rx + w - 4, cy - 3);
      ctx.lineTo(rx + w - 4, cy - 3 - liquidHeight);
      ctx.lineTo(rx + 4, cy - 3 - liquidHeight);
      ctx.closePath();
      ctx.fill();
    }

    // Glass shell
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(rx, ry);
    ctx.lineTo(rx + 3, cy);
    ctx.lineTo(rx + w - 3, cy);
    ctx.lineTo(rx + w, ry);
    ctx.stroke();

    // Inner rim line
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, ry, w/2, 4, 0, 0, 2 * Math.PI);
    ctx.stroke();

    // Display Percentage text
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 10px sans-serif";
    ctx.fillText(`${fillPct}%`, cx - 10, cy - h/2 + 4);

    // Label
    ctx.fillStyle = "#FFE66D";
    ctx.font = "bold 11px Cairo";
    ctx.fillText(label, cx - 30, cy + 18);
  };

  // Draw vector star
  const drawStarShape = (ctx: CanvasRenderingContext2D, cx: number, cy: number, spikes: number, outerRadius: number, innerRadius: number) => {
    let rot = (Math.PI / 2) * 3;
    let x = cx;
    let y = cy;
    const step = Math.PI / spikes;

    ctx.beginPath();
    ctx.moveTo(cx, cy - outerRadius);
    for (let i = 0; i < spikes; i++) {
      x = cx + Math.cos(rot) * outerRadius;
      y = cy + Math.sin(rot) * outerRadius;
      ctx.lineTo(x, y);
      rot += step;

      x = cx + Math.cos(rot) * innerRadius;
      y = cy + Math.sin(rot) * innerRadius;
      ctx.lineTo(x, y);
      rot += step;
    }
    ctx.lineTo(cx, cy - outerRadius);
    ctx.closePath();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#FFE66D";
    ctx.stroke();
    ctx.fillStyle = "#FFE66D";
    ctx.fill();

    // Adding inner white core highlight
    ctx.beginPath();
    ctx.arc(cx, cy, innerRadius/2, 0, 2 * Math.PI);
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();
  };

  // Event handlers for level completion triggers
  const handleGoalTriggered = (lvl: LevelType) => {
    if (lvl === 1) {
      playSound("eat");
      scoreRef.current += 10;
      setScore(scoreRef.current);
      
      const newProgress = levelProgressRef.current + 1;
      setLevelProgress(newProgress);
      levelProgressRef.current = newProgress;
      
      const targetCount = 10; // feed 10 berries
      if (newProgress >= targetCount) {
        handleLevelComplete();
      }
    }
  };

  const checkLevelTwoCompletion = () => {
    if (cup1FillRef.current >= 100 && cup2FillRef.current >= 100) {
      handleLevelComplete();
    }
  };

  const handleLevelComplete = () => {
    setIsPlaying(false);
    setLevelComplete(true);
    playSound("win");
  };

  const handleNextLevel = () => {
    if (currentLevel < 3) {
      const nextLvl = (currentLevel + 1) as LevelType;
      setCurrentLevel(nextLvl);
    } else {
      // Completed all levels! Loop to level 1 and increment score bonuses
      setCurrentLevel(1);
    }
  };

  const toggleHandTracking = () => {
    setIsHandTracking((prev) => !prev);
  };

  return (
    <div 
      dir="rtl" 
      className="flex flex-col items-center justify-center p-6 min-h-screen text-slate-800 font-sans bg-cover bg-center w-full rounded-[40px] shadow-lg border-4 border-white/60"
      style={{ backgroundImage: "linear-gradient(rgba(255, 255, 255, 0.45), rgba(255, 255, 255, 0.45)), url('/backgrounds/art-bg.jpg')" }}
    >
      {/* Offscreen mini-canvas used to downscale frame to 80x60 for quick edge/color extraction */}
      <canvas 
        ref={smallCanvasRef} 
        width={GRID_COLS} 
        height={GRID_ROWS} 
        className="hidden" 
      />

      <div className="max-w-4xl w-full bg-white/95 backdrop-blur-md rounded-3xl shadow-xl border-4 border-[#AA96DA] overflow-hidden p-6 flex flex-col items-center">
        
        {/* Game Title & Controls */}
        <div className="w-full flex justify-between items-center mb-4 pb-2 border-b-2 border-slate-100">
          <div>
            <h2 className="text-2xl font-black text-[#AA96DA] flex items-center gap-2 font-arabic">
              <Sparkles size={24} /> نيوتن السحري (Magic Newton)
            </h2>
            <p className="text-xs text-slate-500 font-semibold mt-0.5">
              ارسم مسارات حقيقية على ورقة ومررها للكاميرا لتوجيه الكرات!
            </p>
          </div>

          <button
            onClick={onBack}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-all border-b-2 border-slate-300"
          >
            <ArrowRight size={14} /> العودة للألعاب
          </button>
        </div>

        {/* Dashboard Status Info */}
        <div className="w-full grid grid-cols-3 md:grid-cols-4 gap-4 mb-4">
          <div className="bg-[#FFE66D]/30 border border-amber-300 rounded-2xl px-4 py-2 flex flex-col items-center justify-center">
            <span className="text-[10px] font-bold text-amber-800 flex items-center gap-1"><Award size={10} /> النقاط الكلية</span>
            <span className="text-xl font-black text-amber-900">{score}</span>
          </div>

          <div className="bg-[#4ECDC4]/20 border border-teal-300 rounded-2xl px-4 py-2 flex flex-col items-center justify-center">
            <span className="text-[10px] font-bold text-teal-800 flex items-center gap-1"><Flame size={10} /> المستوى الحالي</span>
            <span className="text-sm font-black text-teal-900">
              {currentLevel === 1 ? "1. الباندا الجائع" : currentLevel === 2 ? "2. الكؤوس السحرية" : "3. صائد النجوم"}
            </span>
          </div>

          <div className="bg-[#FF6B6B]/20 border border-rose-300 rounded-2xl px-4 py-2 flex flex-col items-center justify-center">
            <span className="text-[10px] font-bold text-rose-800">الهدف المنجز</span>
            <span className="text-base font-black text-rose-900">
              {currentLevel === 1 && `${levelProgress} / 10`}
              {currentLevel === 2 && `الكوب (1): ${cup1Fill}% | (2): ${cup2Fill}%`}
              {currentLevel === 3 && `${levelProgress} / 5`}
            </span>
          </div>

          <button
            onClick={() => setShowSettings(!showSettings)}
            className="col-span-3 md:col-span-1 bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-2xl px-4 py-2 flex items-center justify-center gap-1.5 font-bold text-xs text-slate-700 transition-all"
          >
            <Sliders size={14} /> إعدادات الكاميرا
          </button>
        </div>

        {/* Instructions Alert panel */}
        {showInstructions && (
          <div className="w-full bg-[#FFE66D]/15 border-2 border-dashed border-[#FFE66D] rounded-2xl p-4 mb-4 relative">
            <button
              onClick={() => setShowInstructions(false)}
              aria-label="إغلاق"
              className="absolute top-2 left-2 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <X size={16} />
            </button>
            <h4 className="font-bold text-sm text-yellow-950 mb-1.5 flex items-center gap-1.5">
              <HelpCircle size={15} /> كيف ألعب هذه اللعبة الرائعة؟
            </h4>
            <ul className="text-xs text-yellow-900 space-y-1 pr-4 list-disc font-medium">
              <li>
                <strong>وضع الرسم الورقي:</strong> أحضر ورقة بيضاء وارسم عليها خطاً سميكاً أو شكلاً مائلاً بقلم غامق (أسود أو أزرق)، ثم اعرضها أمام الكاميرا.
              </li>
              <li>
                ستشاهد خطوط تصادم خضراء تظهر على الكاميرا متطابقة تماماً مع رسمتك، وستبدأ الكرات الافتراضية بالارتداد من عليها!
              </li>
              <li>
                <strong>وضع تتبع اليد:</strong> إن لم تملك قلماً، يمكنك تفعيل زر "تتبع أصابع اليد" لتصطدم الكرات بيدك الافتراضية مباشرة!
              </li>
            </ul>
          </div>
        )}

        {/* Dynamic settings panel */}
        {showSettings && (
          <div className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-4 grid grid-cols-1 md:grid-cols-3 gap-6 animate-fade-in text-xs font-bold">
            <div>
              <label className="block text-slate-500 mb-1.5">شفافية الكاميرا في الخلفية ({Math.round(opacity * 100)}%)</label>
              <input 
                type="range" 
                min="0.1" 
                max="0.9" 
                step="0.05" 
                value={opacity} 
                onChange={(e) => setOpacity(parseFloat(e.target.value))}
                className="w-full accent-[#AA96DA]"
              />
              <span className="text-[10px] text-gray-400 font-medium">تساعد الشفافية المنخفضة على رؤية الكرات الملونة بوضوح.</span>
            </div>

            <div>
              <label className="block text-slate-500 mb-1.5">حساسية التقاط الخطوط الداكنة ({threshold})</label>
              <input 
                type="range" 
                min="40" 
                max="160" 
                step="5" 
                value={threshold} 
                onChange={(e) => setThreshold(parseInt(e.target.value))}
                className="w-full accent-[#AA96DA]"
              />
              <span className="text-[10px] text-gray-400 font-medium">ارفع الرقم إذا كانت خطوطك خفيفة، وقلله إذا التقطت الكاميرا ظلالاً غير مرغوبة.</span>
            </div>

            <div className="flex flex-col justify-center">
              <label className="block text-slate-500 mb-1.5">خيار تتبع اليدين (TensorFlow)</label>
              <button
                onClick={toggleHandTracking}
                className={`py-2 px-4 rounded-xl flex items-center justify-center gap-1.5 transition-all ${
                  isHandTracking 
                    ? "bg-[#4ECDC4] text-white border-b-4 border-teal-600 font-black" 
                    : "bg-slate-200 text-slate-700 hover:bg-slate-300 font-bold"
                }`}
              >
                {loadingModel ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" /> جاري التحميل...
                  </>
                ) : (
                  <>
                    <Smile size={14} /> {isHandTracking ? "تتبع اليد: مفعل" : "تتبع اليد: معطل"}
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Video feed element for capturing frames (hidden visual aspect) */}
        <video
          ref={videoRef}
          className="hidden"
          playsInline
          muted
          autoPlay
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
        />

        {/* Primary Interactive Canvas Playboard */}
        <div className="relative rounded-2xl border-4 border-[#AA96DA] overflow-hidden aspect-video bg-black flex items-center justify-center shadow-inner w-full max-w-3xl">
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            className="w-full h-full object-cover"
          />

          {/* Camera Access Error Alert */}
          {!webcamAllowed && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/95 z-20 p-6 text-center text-white">
              <CameraOff size={48} className="mb-4 text-slate-400" />
              <p className="font-bold text-lg mb-2">تعذر تفعيل الكاميرا</p>
              <p className="text-sm text-gray-300 max-w-sm">تحتاج اللعبة لقراءة الرسم من الكاميرا. يرجى تفعيل إذن الوصول للكاميرا وتحديث المتصفح.</p>
              <button 
                onClick={startCamera} 
                className="mt-6 px-6 py-2 bg-[#FF6B6B] hover:bg-[#F38181] text-white font-bold rounded-full border-b-4 border-red-700 active:translate-y-1 active:border-b-0"
              >
                إعادة المحاولة
              </button>
            </div>
          )}

          {/* Intro Start Screen */}
          {!isPlaying && !levelComplete && webcamAllowed && (
            <div className="absolute inset-0 bg-slate-950/80 z-10 flex flex-col items-center justify-center p-6 text-white text-center">
              <Apple size={56} className="mb-4 text-rose-400 animate-bounce" />
              <h3 className="text-2xl font-black mb-2">لعبة نيوتن الفيزيائية السحرية</h3>
              <p className="text-sm text-gray-300 max-w-md mb-6 leading-relaxed">
                {currentLevel === 1 && "المستوى الأول: تسقط ثمار التوت من السحب، عليك توجيهها بالرسم أو بيدك إلى فم الباندا الجائع ليأكلها ويشبع!"}
                {currentLevel === 2 && "المستوى الثاني: تسقط قطرات الماء السحرية، ارسم خطوطاً لتقسيم السيل وملء الكأسيين في الأسفل!"}
                {currentLevel === 3 && "المستوى الثالث: النجوم مضيئة ومعلقة في الهواء. ارسم خطوط ارتداد لتصل الكرات إلى جميع النجوم وتجمعها!"}
              </p>

              <button
                onClick={() => setIsPlaying(true)}
                className="px-8 py-3 bg-[#4ECDC4] hover:bg-[#6be0d8] text-white font-black text-lg rounded-2xl border-b-4 border-teal-600 active:translate-y-0.5 transition-all flex items-center gap-2"
              >
                <Play size={18} fill="#fff" /> ابدأ اللعب الآن
              </button>
            </div>
          )}

          {/* Level Complete Overlay */}
          {levelComplete && (
            <div className="absolute inset-0 bg-[#95E1D3]/90 z-20 backdrop-blur-sm flex flex-col items-center justify-center text-emerald-950 text-center p-6 animate-bounce">
              <Sparkles size={60} className="text-amber-500 mb-2 animate-spin" />
              <h3 className="text-3xl font-black mb-2">أحسنت يا بطل! تم حل اللغز!</h3>
              <p className="text-sm font-semibold max-w-sm mb-2">
                لقد أنجزت مهمة المستوى بنجاح وحصلت على النقاط الإضافية! أنت رائع وذكي جداً.
              </p>
              <div className="flex gap-1 mb-4" aria-hidden="true">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Star key={i} size={20} className="text-amber-500" fill="currentColor" />
                ))}
              </div>
              
              <div className="flex gap-4">
                <button
                  onClick={() => setupLevel(currentLevel)}
                  className="px-6 py-2.5 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-xl flex items-center gap-1.5 transition-all"
                >
                  <RotateCcw size={16} /> إعادة المحاولة
                </button>
                
                <button
                  onClick={handleNextLevel}
                  className="px-6 py-2.5 bg-[#FF6B6B] hover:bg-[#f27b7b] text-white font-black rounded-xl border-b-4 border-red-700 active:translate-y-0.5 transition-all flex items-center gap-1.5"
                >
                  المستوى التالي <Check size={16} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Physics Control Actions */}
        <div className="mt-4 flex gap-4 w-full">
          {isPlaying ? (
            <button
              onClick={() => setIsPlaying(false)}
              className="flex-1 py-3 text-center bg-amber-400 hover:bg-amber-500 text-amber-950 font-bold rounded-2xl transition-all border-b-4 border-amber-600 active:translate-y-0.5 active:border-b-0 flex items-center justify-center gap-1.5"
            >
              <Pause size={16} fill="#422006" /> إيقاف مؤقت
            </button>
          ) : (
            !levelComplete && (
              <button
                onClick={() => setIsPlaying(true)}
                className="flex-1 py-3 text-center bg-[#4ECDC4] hover:bg-teal-500 text-white font-bold rounded-2xl transition-all border-b-4 border-teal-600 active:translate-y-0.5 active:border-b-0 flex items-center justify-center gap-1.5"
              >
                <Play size={16} fill="#fff" /> استمرار اللعب
              </button>
            )
          )}

          <button
            onClick={() => setupLevel(currentLevel)}
            className="px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-2xl transition-all flex items-center gap-1.5"
            title="إعادة ضبط المستوى"
          >
            <RotateCcw size={16} /> إعادة الضبط
          </button>
        </div>

        {/* Level Selector Cards (Child Safe icons) */}
        <div className="w-full mt-6">
          <h4 className="text-sm font-extrabold text-slate-600 mb-3 font-arabic">اختر مستوى اللعب:</h4>
          <div className="grid grid-cols-3 gap-4">
            <button
              onClick={() => { setCurrentLevel(1); }}
              className={`p-3 rounded-2xl border-2 flex flex-col items-center gap-1 transition-all ${
                currentLevel === 1 
                  ? "bg-[#FF6B6B]/10 border-[#FF6B6B] text-[#FF6B6B] scale-105" 
                  : "bg-white border-slate-200 hover:border-slate-300 text-slate-600"
              }`}
            >
              <Apple size={26} />
              <span className="text-xs font-bold font-arabic">1. الباندا الجائع</span>
            </button>

            <button
              onClick={() => { setCurrentLevel(2); }}
              className={`p-3 rounded-2xl border-2 flex flex-col items-center gap-1 transition-all ${
                currentLevel === 2 
                  ? "bg-[#FFE66D]/20 border-amber-400 text-amber-600 scale-105" 
                  : "bg-white border-slate-200 hover:border-slate-300 text-slate-600"
              }`}
            >
              <CupSoda size={26} />
              <span className="text-xs font-bold font-arabic">2. الكؤوس السحرية</span>
            </button>

            <button
              onClick={() => { setCurrentLevel(3); }}
              className={`p-3 rounded-2xl border-2 flex flex-col items-center gap-1 transition-all ${
                currentLevel === 3 
                  ? "bg-[#AA96DA]/10 border-[#AA96DA] text-[#AA96DA] scale-105" 
                  : "bg-white border-slate-200 hover:border-slate-300 text-slate-600"
              }`}
            >
              <Star size={26} />
              <span className="text-xs font-bold font-arabic">3. صائد النجوم</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
