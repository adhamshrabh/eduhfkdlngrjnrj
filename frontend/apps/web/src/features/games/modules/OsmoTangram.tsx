import React, { useEffect, useRef, useState } from "react";
import {
  Camera,
  CameraOff,
  RotateCw,
  RotateCcw,
  Award,
  Sparkles,
  Check,
  HelpCircle as HelpIcon,
  ArrowRight,
  ArrowLeft,
  MousePointer,
  Puzzle as PuzzleIcon,
  RefreshCw,
  X,
  Home,
  Sailboat,
  PawPrint,
  type LucideIcon,
} from "lucide-react";

// Canvas Resolution
const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 480;
const GRID_COLS = 80;
const GRID_ROWS = 60;

interface TangramPiece {
  id: string;
  name: string;
  type: "triangle-lg" | "square" | "triangle-sm" | "parallelogram";
  color: string; // Tailwind color code or hex
  targetColorName: "red" | "yellow" | "blue" | "purple";
  // Current screen position
  x: number;
  y: number;
  rotation: number; // in degrees (0, 45, 90, 135, 180, 225, 270, 315)
  // Target position inside silhouette
  targetX: number;
  targetY: number;
  targetRotation: number;
  isLocked: boolean;
  // Bounding box size for drag representation
  width: number;
  height: number;
}

interface Puzzle {
  id: string;
  name: string;
  icon: LucideIcon;
  pieces: Omit<TangramPiece, "x" | "y" | "rotation" | "isLocked">[];
}

export default function OsmoTangram({ onBack }: { onBack: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const smallCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Puzzle Database
  const puzzles: Puzzle[] = [
    {
      id: "house",
      name: "المنزل الصغير",
      icon: Home,
      pieces: [
        { id: "roof", name: "مظلة السقف", type: "triangle-lg", color: "#FF6B6B", targetColorName: "red", targetX: 320, targetY: 170, targetRotation: 0, width: 140, height: 70 },
        { id: "base", name: "الجدران", type: "square", color: "#FFE66D", targetColorName: "yellow", targetX: 320, targetY: 260, targetRotation: 0, width: 80, height: 80 },
        { id: "chimney", name: "المدخنة الصغير", type: "triangle-sm", color: "#4ECDC4", targetColorName: "blue", targetX: 250, targetY: 210, targetRotation: 180, width: 60, height: 30 },
        { id: "ground", name: "العشب المائل", type: "parallelogram", color: "#AA96DA", targetColorName: "purple", targetX: 340, targetY: 320, targetRotation: 0, width: 100, height: 40 }
      ]
    },
    {
      id: "boat",
      name: "القارب الشراعي",
      icon: Sailboat,
      pieces: [
        { id: "hull", name: "قاعدة السفينة", type: "parallelogram", color: "#AA96DA", targetColorName: "purple", targetX: 320, targetY: 300, targetRotation: 0, width: 120, height: 40 },
        { id: "mainsail", name: "الشراع الكبير", type: "triangle-lg", color: "#FF6B6B", targetColorName: "red", targetX: 300, targetY: 180, targetRotation: 90, width: 120, height: 90 },
        { id: "smallsail", name: "الشراع الصغير", type: "triangle-sm", color: "#4ECDC4", targetColorName: "blue", targetX: 360, targetY: 220, targetRotation: 270, width: 70, height: 50 },
        { id: "cabin", name: "مقصورة القارب", type: "square", color: "#FFE66D", targetColorName: "yellow", targetX: 320, targetY: 270, targetRotation: 45, width: 45, height: 45 }
      ]
    },
    {
      id: "fox",
      name: "الثعلب الذكي",
      icon: PawPrint,
      pieces: [
        { id: "body", name: "جسم الثعلب", type: "triangle-lg", color: "#FF6B6B", targetColorName: "red", targetX: 350, targetY: 250, targetRotation: 135, width: 120, height: 80 },
        { id: "head", name: "الرأس الصغير", type: "triangle-sm", color: "#4ECDC4", targetColorName: "blue", targetX: 250, targetY: 190, targetRotation: 45, width: 60, height: 40 },
        { id: "face", name: "وجه الثعلب", type: "square", color: "#FFE66D", targetColorName: "yellow", targetX: 280, targetY: 220, targetRotation: 0, width: 50, height: 50 },
        { id: "tail", name: "ذيل الثعلب", type: "parallelogram", color: "#AA96DA", targetColorName: "purple", targetX: 420, targetY: 290, targetRotation: 45, width: 90, height: 35 }
      ]
    }
  ];

  // Game States
  const [activePuzzleIndex, setActivePuzzleIndex] = useState<number>(0);
  const [pieces, setPieces] = useState<TangramPiece[]>([]);
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [webcamAllowed, setWebcamAllowed] = useState<boolean>(true);
  const [playMode, setPlayMode] = useState<"screen" | "camera">("screen");
  
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [score, setScore] = useState<number>(0);
  const [puzzleComplete, setPuzzleComplete] = useState<boolean>(false);
  const [showInstructions, setShowInstructions] = useState<boolean>(true);
  const [_calibrationDebug] = useState<boolean>(false);

  // Camera settings
  const [_colorTolerance] = useState<number>(45); // Color matching distance tolerance

  // Drag and drop coordinate states
  const isDraggingRef = useRef<boolean>(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  // Camera Color Blob Centers for preview
  const [detectedBlobs, setDetectedBlobs] = useState<{
    red: { x: number; y: number; count: number } | null;
    yellow: { x: number; y: number; count: number } | null;
    blue: { x: number; y: number; count: number } | null;
    purple: { x: number; y: number; count: number } | null;
  }>({ red: null, yellow: null, blue: null, purple: null });

  // Web Audio Sound FX
  const playSound = (type: "snap" | "win" | "rotate") => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === "snap") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(300, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.15);
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
      } else if (type === "rotate") {
        osc.type = "triangle";
        osc.frequency.setValueAtTime(220, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(260, ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.1);
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
      } else if (type === "win") {
        const chord = [261.63, 329.63, 392.00, 523.25, 659.25]; // C E G C E
        chord.forEach((freq, i) => {
          const oscN = ctx.createOscillator();
          const gainN = ctx.createGain();
          oscN.connect(gainN);
          gainN.connect(ctx.destination);
          oscN.type = "sine";
          oscN.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.08);
          gainN.gain.setValueAtTime(0.08, ctx.currentTime + i * 0.08);
          gainN.gain.linearRampToValueAtTime(0.005, ctx.currentTime + i * 0.08 + 0.3);
          oscN.start(ctx.currentTime + i * 0.08);
          oscN.stop(ctx.currentTime + i * 0.08 + 0.3);
        });
      }
    } catch (e) {
      console.warn("Audio Context blocked:", e);
    }
  };

  // Load selected puzzle details
  const setupPuzzle = (index: number) => {
    const pz = puzzles[index];
    setSelectedPieceId(null);
    setPuzzleComplete(false);
    
    // Distribute shapes randomly on left and right sides
    const initializedPieces = pz.pieces.map((p, i) => {
      const isLeftSide = i % 2 === 0;
      return {
        ...p,
        // side padding placement
        x: isLeftSide ? 70 + Math.random() * 40 : CANVAS_WIDTH - 110 - Math.random() * 40,
        y: 100 + i * 90 + Math.random() * 20,
        rotation: Math.floor(Math.random() * 4) * 90, // starts at 0, 90, 180, or 270
        isLocked: false
      };
    });
    setPieces(initializedPieces);
  };

  useEffect(() => {
    setupPuzzle(activePuzzleIndex);
  }, [activePuzzleIndex]);

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
      console.error("Camera access blocked:", err);
      setWebcamAllowed(false);
    }
  };

  // Stop Camera
  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    if (playMode === "camera") {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [playMode]);

  // Webcam Processing Loop (Runs in background)
  useEffect(() => {
    let frameId: number;

    const processFrame = () => {
      if (playMode !== "camera" || !cameraActive) {
        frameId = requestAnimationFrame(processFrame);
        return;
      }

      const video = videoRef.current;
      const smallCanvas = smallCanvasRef.current;

      if (video && video.readyState >= 2 && smallCanvas) {
        const sCtx = smallCanvas.getContext("2d");
        if (sCtx) {
          // Mirror and downscale frame to 80x60
          sCtx.save();
          sCtx.translate(GRID_COLS, 0);
          sCtx.scale(-1, 1);
          sCtx.drawImage(video, 0, 0, GRID_COLS, GRID_ROWS);
          sCtx.restore();

          const imgData = sCtx.getImageData(0, 0, GRID_COLS, GRID_ROWS);
          const pixels = imgData.data;

          // Color tracking accumulators
          const colorsToTrack = {
            red: { sumX: 0, sumY: 0, count: 0 },
            yellow: { sumX: 0, sumY: 0, count: 0 },
            blue: { sumX: 0, sumY: 0, count: 0 },
            purple: { sumX: 0, sumY: 0, count: 0 }
          };

          // Loop through grid cells
          for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
              const idx = (r * GRID_COLS + c) * 4;
              const rVal = pixels[idx];
              const gVal = pixels[idx + 1];
              const bVal = pixels[idx + 2];

              // Normalizing helps eliminate variations in room lighting
              const total = rVal + gVal + bVal + 1;
              const rn = rVal / total;
              const gn = gVal / total;
              const bn = bVal / total;

              // Color Classifiers:
              // 1. Red Block: high red component
              const isRed = (rVal > 115 && gVal < 80 && bVal < 80) || (rn > 0.48 && rVal > 80);
              
              // 2. Blue Block: high blue component
              const isBlue = (bVal > 115 && rVal < 90 && gVal < 100) || (bn > 0.44 && bVal > 80);
              
              // 3. Yellow Block: high red & green, low blue
              const isYellow = (rVal > 130 && gVal > 120 && bVal < 90) || (rn > 0.38 && gn > 0.36 && bVal < 100);

              // 4. Purple/Pink Block: high red & blue, low green
              const isPurple = (rVal > 110 && bVal > 100 && gVal < 80) || (rn > 0.38 && bn > 0.36 && gVal < 90);

              if (isRed) {
                colorsToTrack.red.sumX += c;
                colorsToTrack.red.sumY += r;
                colorsToTrack.red.count++;
              } else if (isYellow) {
                colorsToTrack.yellow.sumX += c;
                colorsToTrack.yellow.sumY += r;
                colorsToTrack.yellow.count++;
              } else if (isBlue) {
                colorsToTrack.blue.sumX += c;
                colorsToTrack.blue.sumY += r;
                colorsToTrack.blue.count++;
              } else if (isPurple) {
                colorsToTrack.purple.sumX += c;
                colorsToTrack.purple.sumY += r;
                colorsToTrack.purple.count++;
              }
            }
          }

          // Compute Centroids (scaled back to 640x480 screen resolution)
          const newBlobs: typeof detectedBlobs = { red: null, yellow: null, blue: null, purple: null };
          const minBlobSize = 10; // minimum pixels count to avoid noise

          Object.keys(colorsToTrack).forEach((colorKey) => {
            const data = colorsToTrack[colorKey as keyof typeof colorsToTrack];
            if (data.count >= minBlobSize) {
              const gridCenterX = data.sumX / data.count;
              const gridCenterY = data.sumY / data.count;
              
              // Map 80x60 grid back to 640x480 canvas size
              const screenX = Math.round(gridCenterX * (CANVAS_WIDTH / GRID_COLS));
              const screenY = Math.round(gridCenterY * (CANVAS_HEIGHT / GRID_ROWS));

              newBlobs[colorKey as keyof typeof newBlobs] = {
                x: screenX,
                y: screenY,
                count: data.count
              };

              // Automatically move virtual block matching this color to the tracked screen location
              setPieces((prevPieces) => {
                let updated = false;
                const next = prevPieces.map((p) => {
                  if (p.targetColorName === colorKey && !p.isLocked) {
                    updated = true;
                    
                    // Simple smoothing (LERP) to make shapes float gracefully
                    const smoothedX = p.x + (screenX - p.x) * 0.25;
                    const smoothedY = p.y + (screenY - p.y) * 0.25;

                    // Automatically snap if close to target position
                    const distToTarget = Math.sqrt((smoothedX - p.targetX) ** 2 + (smoothedY - p.targetY) ** 2);
                    // (منطق ميت في الأصل: angleMatches كان يُحسب ولا يُستخدم —
                    //  وضع الكاميرا يطابق الدوران تلقائياً كما يشرح السطر التالي)
                    
                    // In camera mode, we automatically match rotation when shape is close to simplify gameplay
                    let rot = p.rotation;
                    if (distToTarget < 40) {
                      rot = p.targetRotation;
                    }

                    if (distToTarget < 20 && rot === p.targetRotation) {
                      playSound("snap");
                      return { ...p, x: p.targetX, y: p.targetY, rotation: p.targetRotation, isLocked: true };
                    }

                    return { ...p, x: smoothedX, y: smoothedY, rotation: rot };
                  }
                  return p;
                });

                if (updated) {
                  // check puzzle complete inside the state loop
                  const unlockedCount = next.filter((p) => !p.isLocked).length;
                  if (unlockedCount === 0 && !puzzleComplete) {
                    setPuzzleComplete(true);
                    setScore((s) => s + 50);
                    playSound("win");
                  }
                }
                return updated ? next : prevPieces;
              });
            }
          });

          setDetectedBlobs(newBlobs);
        }
      }

      frameId = requestAnimationFrame(processFrame);
    };

    frameId = requestAnimationFrame(processFrame);
    return () => cancelAnimationFrame(frameId);
  }, [cameraActive, playMode, puzzleComplete]);

  // Drag-and-drop Mouse event handlers (For screen play mode)
  const handlePieceMouseDown = (e: React.MouseEvent, piece: TangramPiece) => {
    if (playMode !== "screen" || piece.isLocked || puzzleComplete) return;
    
    setSelectedPieceId(piece.id);
    isDraggingRef.current = true;

    // Get offset relative to piece center
    const rect = e.currentTarget.parentElement?.getBoundingClientRect();
    if (rect) {
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;
      dragOffsetRef.current = {
        x: clickX - piece.x,
        y: clickY - piece.y
      };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (playMode !== "screen" || !isDraggingRef.current || !selectedPieceId || puzzleComplete) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;

    const newX = Math.max(20, Math.min(CANVAS_WIDTH - 20, cursorX - dragOffsetRef.current.x));
    const newY = Math.max(20, Math.min(CANVAS_HEIGHT - 20, cursorY - dragOffsetRef.current.y));

    setPieces((prev) =>
      prev.map((p) => {
        if (p.id === selectedPieceId) {
          return { ...p, x: newX, y: newY };
        }
        return p;
      })
    );
  };

  const handleMouseUp = () => {
    if (playMode !== "screen" || !isDraggingRef.current || !selectedPieceId || puzzleComplete) return;
    isDraggingRef.current = false;

    // Snap piece to target check
    setPieces((prev) => {
      const next = prev.map((p) => {
        if (p.id === selectedPieceId) {
          // Check distance to target socket position
          const dist = Math.sqrt((p.x - p.targetX) ** 2 + (p.y - p.targetY) ** 2);
          const rotationMatch = (p.rotation % 360) === (p.targetRotation % 360);

          if (dist < 25 && rotationMatch) {
            playSound("snap");
            return { ...p, x: p.targetX, y: p.targetY, isLocked: true };
          }
        }
        return p;
      });

      // Check level win
      const remaining = next.filter((p) => !p.isLocked).length;
      if (remaining === 0) {
        setPuzzleComplete(true);
        setScore((s) => s + 50);
        playSound("win");
      }

      return next;
    });
  };

  // Rotate selected block by 45 degrees
  const rotateSelectedPiece = (direction: "cw" | "ccw") => {
    if (!selectedPieceId) return;
    playSound("rotate");
    
    setPieces((prev) =>
      prev.map((p) => {
        if (p.id === selectedPieceId && !p.isLocked) {
          const delta = direction === "cw" ? 45 : -45;
          const nextRotation = (p.rotation + delta + 360) % 360;
          
          // Check if snap happens after rotation
          const dist = Math.sqrt((p.x - p.targetX) ** 2 + (p.y - p.targetY) ** 2);
          const rotMatches = nextRotation === p.targetRotation;
          
          if (dist < 25 && rotMatches) {
            playSound("snap");
            return { ...p, rotation: p.targetRotation, x: p.targetX, y: p.targetY, isLocked: true };
          }
          
          return { ...p, rotation: nextRotation };
        }
        return p;
      })
    );
  };

  // Skip or go to next level puzzle
  const nextPuzzle = () => {
    const nextIdx = (activePuzzleIndex + 1) % puzzles.length;
    setActivePuzzleIndex(nextIdx);
  };

  // Draw Tangram shape in SVG depending on type
  const renderPieceSvg = (piece: TangramPiece, isGhost = false) => {
    const { type, width, height, color } = piece;
    const fillColor = isGhost ? "rgba(200, 200, 200, 0.25)" : color;
    const strokeColor = isGhost ? "rgba(100, 100, 100, 0.4)" : "#FFFFFF";
    const strokeWidth = isGhost ? 2 : 3;

    if (type === "triangle-lg") {
      // Large Right Triangle: points at (0, height), (width, height), (width/2, 0)
      return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
          <polygon
            points={`0,${height} ${width},${height} ${width/2},0`}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
          />
        </svg>
      );
    }
    if (type === "triangle-sm") {
      // Small Triangle
      return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
          <polygon
            points={`0,${height} ${width},${height} ${width/2},0`}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
          />
        </svg>
      );
    }
    if (type === "square") {
      return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
          <rect
            x={1.5}
            y={1.5}
            width={width - 3}
            height={height - 3}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            rx={4}
          />
        </svg>
      );
    }
    if (type === "parallelogram") {
      // Parallelogram: skew top points rightward
      const skew = 25;
      return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
          <polygon
            points={`${skew},0 ${width},0 ${width - skew},${height} 0,${height}`}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
          />
        </svg>
      );
    }
    return null;
  };

  return (
    <div 
      dir="rtl" 
      className="flex flex-col items-center justify-center p-6 min-h-screen text-slate-800 font-sans bg-cover bg-center w-full rounded-[40px] shadow-lg border-4 border-white/60"
      style={{ backgroundImage: "linear-gradient(rgba(255, 255, 255, 0.45), rgba(255, 255, 255, 0.45)), url('/backgrounds/art-bg.jpg')" }}
    >
      {/* Hidden processing canvas */}
      <canvas ref={smallCanvasRef} width={GRID_COLS} height={GRID_ROWS} className="hidden" />

      <div className="max-w-4xl w-full bg-white/95 backdrop-blur-md rounded-3xl shadow-xl border-4 border-[#FF6B6B] overflow-hidden p-6 flex flex-col items-center">
        
        {/* Game Title header */}
        <div className="w-full flex justify-between items-center mb-4 pb-2 border-b-2 border-slate-100">
          <div>
            <h2 className="text-2xl font-black text-[#FF6B6B] flex items-center gap-2 font-arabic">
              <PuzzleIcon size={26} /> تركيب الأشكال الهندسي (Tangram Blocks)
            </h2>
            <p className="text-xs text-slate-500 font-semibold mt-0.5">
              رتب الأشكال الملونة لتطابق خيال الرسمة وتكشف الصورة المخفية!
            </p>
          </div>

          <button
            onClick={onBack}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-all border-b-2 border-slate-300"
          >
            <ArrowRight size={14} /> العودة للألعاب
          </button>
        </div>

        {/* Dash Information panel */}
        <div className="w-full grid grid-cols-3 md:grid-cols-4 gap-4 mb-4">
          <div className="bg-[#FFE66D]/30 border border-amber-300 rounded-2xl px-4 py-2 flex flex-col items-center justify-center">
            <span className="text-[10px] font-bold text-amber-800 flex items-center gap-1"><Award size={10} /> النقاط الكلية</span>
            <span className="text-xl font-black text-amber-900">{score}</span>
          </div>

          <div className="bg-[#4ECDC4]/20 border border-teal-300 rounded-2xl px-4 py-2 flex flex-col items-center justify-center">
            <span className="text-[10px] font-bold text-teal-800">الشكل الحالي</span>
            <span className="text-sm font-black text-teal-900 flex items-center gap-1">
              {puzzles[activePuzzleIndex].name}
            </span>
          </div>

          <div className="bg-[#FF6B6B]/20 border border-rose-300 rounded-2xl px-4 py-2 flex flex-col items-center justify-center">
            <span className="text-[10px] font-bold text-rose-800">حالة القطع الهندسية</span>
            <span className="text-xs font-black text-rose-900">
              مكتمل: {pieces.filter((p) => p.isLocked).length} / {pieces.length}
            </span>
          </div>

          <button
            onClick={() => setPlayMode(playMode === "screen" ? "camera" : "screen")}
            className="col-span-3 md:col-span-1 bg-slate-800 border-b-4 border-slate-950 text-white hover:bg-slate-900 rounded-2xl px-4 py-2 flex items-center justify-center gap-1.5 font-bold text-xs transition-all"
          >
            {playMode === "screen" ? (
              <>
                <Camera size={14} /> تفعيل وضع الكاميرا
              </>
            ) : (
              <>
                <MousePointer size={14} /> العودة للعب بالماوس
              </>
            )}
          </button>
        </div>

        {/* Instructions */}
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
              <HelpIcon size={15} /> كيف أركب الأشكال الهندسية؟
            </h4>
            <ul className="text-xs text-yellow-900 space-y-1 pr-4 list-disc font-medium">
              <li>
                <strong>وضع الشاشة (بالماوس):</strong> اسحب القطع الملونة بالفأرة وضعها في مكانها الرمادي المطابق. اضغط على القطعة ثم انقر على أزرار التدوير لتغيير زاويتها لتتطابق مع الاتجاه الصحيح.
              </li>
              <li>
                <strong>وضع الكاميرا الذكي (طريقة أوسمو):</strong> أحضر 4 بطاقات ورقية ملونة (أحمر، أصفر، أزرق، بنفسجي/أرجواني).
              </li>
              <li>
                اعرض البطاقة للكاميرا، وسيقوم الذكاء الاصطناعي بتتبعها وتحريك القطعة المطابقة لها على الشاشة تلقائياً! حرك يدك لتوجه القطع إلى مكانها الصحيح.
              </li>
            </ul>
          </div>
        )}

        {/* Live video capture feed element */}
        {playMode === "camera" && (
          <video
            ref={videoRef}
            className="hidden"
            playsInline
            muted
            autoPlay
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
          />
        )}

        {/* Primary Puzzle Canvas Display Board */}
        <div 
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className="relative rounded-2xl border-4 border-[#AA96DA] overflow-hidden bg-slate-900 shadow-inner w-full max-w-3xl select-none"
          style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
        >
          
          {/* Background Grid Layer */}
          <div className="absolute inset-0 grid grid-cols-12 gap-0 pointer-events-none opacity-5">
            {Array(144).fill(0).map((_, i) => (
              <div key={i} className="border border-white aspect-square" />
            ))}
          </div>

          {/* Miniature Camera overlay on top-right in Camera Mode */}
          {playMode === "camera" && cameraActive && (
            <div className="absolute top-3 left-3 bg-slate-950 border-2 border-white/20 rounded-xl overflow-hidden shadow-lg z-20 w-32 aspect-video flex flex-col">
              <video
                ref={(el) => {
                  if (el && videoRef.current && el.srcObject !== videoRef.current.srcObject) {
                    el.srcObject = videoRef.current.srcObject;
                    el.play().catch(() => {});
                  }
                }}
                className="w-full h-full object-cover transform -scale-x-100 opacity-60"
                playsInline
                muted
                autoPlay
              />
              <div className="absolute inset-0 pointer-events-none">
                {/* Draw crosshair coordinates for tracked blobs */}
                {Object.keys(detectedBlobs).map((colorKey) => {
                  const blob = detectedBlobs[colorKey as keyof typeof detectedBlobs];
                  if (blob) {
                    const mappedX = (blob.x / CANVAS_WIDTH) * 128;
                    const mappedY = (blob.y / CANVAS_HEIGHT) * 72; // aspect-video height relative to width 128
                    const colorHex = colorKey === "red" ? "#FF6B6B" : colorKey === "yellow" ? "#FFE66D" : colorKey === "blue" ? "#4ECDC4" : "#AA96DA";
                    return (
                      <div 
                        key={colorKey}
                        className="absolute w-2 h-2 rounded-full border-2 transform -translate-x-1/2 -translate-y-1/2 animate-ping"
                        style={{ left: `${mappedX}px`, top: `${mappedY}px`, borderColor: colorHex }}
                      />
                    );
                  }
                  return null;
                })}
              </div>
              <div className="bg-slate-900 text-[8px] text-gray-400 font-bold py-0.5 flex items-center justify-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                تتبع الألوان نشط
              </div>
            </div>
          )}

          {/* Camera Permission Denied alert */}
          {playMode === "camera" && !webcamAllowed && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 z-20 p-6 text-center text-white">
              <CameraOff size={48} className="mb-4 text-slate-400" />
              <p className="font-bold text-lg mb-2">تعذر تفعيل الكاميرا</p>
              <p className="text-sm text-gray-300 max-w-sm">تحتاج اللعبة لإذن الكاميرا لقراءة الأشكال الورقية الملونة.</p>
              <button 
                onClick={startCamera} 
                className="mt-6 px-6 py-2 bg-[#FF6B6B] hover:bg-[#F38181] text-white font-bold rounded-full transition-all border-b-4 border-red-700 active:translate-y-1"
              >
                إعادة المحاولة
              </button>
            </div>
          )}

          {/* 1. DRAW SILHOUETTE (Grey target sockets) */}
          <div className="absolute inset-0 pointer-events-none">
            {pieces.map((piece) => (
              <div
                key={`target-${piece.id}`}
                className="absolute transform -translate-x-1/2 -translate-y-1/2"
                style={{
                  left: piece.targetX,
                  top: piece.targetY,
                  transform: `translate(-50%, -50%) rotate(${piece.targetRotation}deg)`
                }}
              >
                {renderPieceSvg(piece, true)}
              </div>
            ))}
          </div>

          {/* 2. DRAW DRAGGABLE / TRACKED PIECES */}
          {pieces.map((piece) => {
            const isSelected = selectedPieceId === piece.id;
            return (
              <div
                key={piece.id}
                onMouseDown={(e) => handlePieceMouseDown(e, piece)}
                className={`absolute transform -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing transition-shadow ${
                  piece.isLocked 
                    ? "pointer-events-none drop-shadow-md" 
                    : isSelected 
                      ? "drop-shadow-[0_8px_16px_rgba(255,255,255,0.4)] z-30 scale-105" 
                      : "hover:drop-shadow-[0_4px_8px_rgba(255,255,255,0.2)] z-10"
                }`}
                style={{
                  left: piece.x,
                  top: piece.y,
                  transform: `translate(-50%, -50%) rotate(${piece.rotation}deg)`,
                  transition: isDraggingRef.current && isSelected ? "none" : "transform 0.15s ease-out, left 0.15s ease-out, top 0.15s ease-out"
                }}
              >
                {renderPieceSvg(piece, false)}
                
                {/* Glow ring around selected piece */}
                {isSelected && !piece.isLocked && (
                  <div className="absolute inset-0 border-2 border-dashed border-white/80 rounded-xl animate-pulse pointer-events-none" style={{ margin: "-12px" }} />
                )}
                
                {/* Snap Lock confirmation check indicator */}
                {piece.isLocked && (
                  <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-emerald-500 text-white rounded-full p-1 shadow-md z-40 border border-white">
                    <Check size={14} strokeWidth={4} />
                  </div>
                )}
              </div>
            );
          })}

          {/* Level Complete Board Overlay */}
          {puzzleComplete && (
            <div className="absolute inset-0 bg-emerald-950/90 z-20 backdrop-blur-md flex flex-col items-center justify-center text-white text-center p-6 animate-fade-in">
              {(() => {
                const PuzzleGlyph = puzzles[activePuzzleIndex].icon;
                return <PuzzleGlyph size={72} className="mb-2 animate-bounce text-white" />;
              })()}
              <Sparkles size={50} className="text-[#FFE66D] mb-4 animate-spin" />
              <h3 className="text-3xl font-black text-[#95E1D3] mb-2">رائع! شكل مكتمل ومطابق!</h3>
              <p className="text-sm text-gray-300 max-w-sm mb-6 font-medium">
                لقد طابقت جميع قطع التانجرام الهندسية بنجاح واكتشفت سر شكل <strong className="text-white">{puzzles[activePuzzleIndex].name}</strong>!
              </p>
              
              <div className="flex gap-4">
                <button
                  onClick={() => setupPuzzle(activePuzzleIndex)}
                  className="px-6 py-2.5 bg-slate-800 border-b-4 border-slate-950 hover:bg-slate-700 text-white font-bold rounded-xl transition-all flex items-center gap-1.5"
                >
                  <RefreshCw size={16} /> إعادة التركيب
                </button>

                <button
                  onClick={nextPuzzle}
                  className="px-6 py-2.5 bg-[#FF6B6B] hover:bg-[#ff7e7e] text-white font-black rounded-xl border-b-4 border-red-700 active:translate-y-0.5 transition-all flex items-center gap-1.5"
                >
                  اللغز التالي <ArrowLeft size={16} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Shape control actions (For rotating selected shapes on screen) */}
        {playMode === "screen" && selectedPieceId && (
          <div className="w-full mt-4 bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col md:flex-row justify-between items-center gap-4 animate-fade-in">
            <div className="flex items-center gap-2">
              <div 
                className="w-5 h-5 rounded-full border border-white"
                style={{ backgroundColor: pieces.find(p => p.id === selectedPieceId)?.color }} 
              />
              <span className="text-xs font-black text-slate-700 font-arabic">
                القطعة المحددة: {pieces.find(p => p.id === selectedPieceId)?.name}
              </span>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => rotateSelectedPiece("ccw")}
                className="px-4 py-2 bg-[#AA96DA] border-b-4 border-purple-700 text-white hover:bg-purple-500 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all active:translate-y-0.5 active:border-b-0"
              >
                <RotateCcw size={14} /> تدوير لليمين
              </button>

              <button
                onClick={() => rotateSelectedPiece("cw")}
                className="px-4 py-2 bg-[#4ECDC4] border-b-4 border-teal-700 text-white hover:bg-teal-500 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all active:translate-y-0.5 active:border-b-0"
              >
                تدوير لليسار <RotateCw size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Puzzle Selector menu */}
        <div className="w-full mt-6">
          <h4 className="text-sm font-extrabold text-slate-600 mb-3 font-arabic">اختر اللغز المطلوب تركيب أشكاله:</h4>
          <div className="grid grid-cols-3 gap-4">
            {puzzles.map((pz, idx) => (
              <button
                key={pz.id}
                onClick={() => setActivePuzzleIndex(idx)}
                className={`p-3 rounded-2xl border-2 flex flex-col items-center gap-1 transition-all duration-200 ease-spring active:scale-95 ${
                  activePuzzleIndex === idx
                    ? "bg-[#FF6B6B]/10 border-[#FF6B6B] text-[#FF6B6B] scale-105"
                    : "bg-white border-slate-200 hover:border-slate-300 text-slate-600"
                }`}
              >
                <pz.icon size={26} />
                <span className="text-xs font-bold font-arabic">{pz.name}</span>
              </button>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
