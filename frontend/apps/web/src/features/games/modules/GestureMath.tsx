import { useEffect, useRef, useState } from "react";
import * as tf from "@tensorflow/tfjs";
import * as handpose from "@tensorflow-models/handpose";
import { Video, Calculator, Trophy, Hand, Brain, CameraOff, RefreshCw, ArrowLeft, PartyPopper, Star } from "lucide-react";

interface Equation {
  question: string;
  answer: number;
}

interface ConfettiParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  rotation: number;
  rotationSpeed: number;
}

export default function GestureMath() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  
  const [model, setModel] = useState<handpose.HandPose | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [equation, setEquation] = useState<Equation>({ question: "٣ + ٤ = ؟", answer: 7 });
  const [currentScore, setCurrentScore] = useState<number>(0);
  const [detectedFingers, setDetectedFingers] = useState<number>(0);
  const [feedback, setFeedback] = useState<string>("أرنا أصابعك للكاميرا (استخدم يدك أو اليدين معاً)");
  const [isSuccess, setIsSuccess] = useState<boolean>(false);
  const [webcamAllowed, setWebcamAllowed] = useState<boolean>(true);

  const confettiParticlesRef = useRef<ConfettiParticle[]>([]);

  // Sound Synth for educational rewards
  const playSoundEffect = (type: "correct" | "click") => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === "correct") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
        osc.frequency.exponentialRampToValueAtTime(880.00, ctx.currentTime + 0.15); // A5
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      } else {
        osc.type = "triangle";
        osc.frequency.setValueAtTime(250, ctx.currentTime);
        gain.gain.setValueAtTime(0.05, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.08);
        osc.start();
        osc.stop(ctx.currentTime + 0.08);
      }
    } catch (e) {
      console.warn("Audio Context blocked or unsupported:", e);
    }
  };

  // Generate math equations up to sum of 10
  const generateNewQuestion = () => {
    const num1 = Math.floor(Math.random() * 5) + 1; // 1 to 5
    const num2 = Math.floor(Math.random() * 5) + 1; // 1 to 5
    const sum = num1 + num2;
    
    const toArabicDigits = (num: number) => 
      num.toString().replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[parseInt(d)]);

    setEquation({
      question: `${toArabicDigits(num1)} + ${toArabicDigits(num2)} = ؟`,
      answer: sum,
    });
    setIsSuccess(false);
    setFeedback("حل المسألة الحسابية الجديدة بحركات أصابعك أمام الكاميرا");
  };

  // Fire Canvas Confetti blast on correct answers
  const triggerConfettiBlast = (width: number, height: number) => {
    const colors = ["#FF6B6B", "#FFE66D", "#AA96DA", "#4ECDC4", "#95E1D3", "#FCBAD3"];
    const particles: ConfettiParticle[] = [];
    for (let i = 0; i < 55; i++) {
      particles.push({
        x: width / 2,
        y: height / 2,
        vx: Math.random() * 10 - 5,
        vy: Math.random() * -12 - 4, // Upward thrust
        color: colors[Math.floor(Math.random() * colors.length)],
        size: Math.random() * 8 + 6,
        rotation: Math.random() * 360,
        rotationSpeed: Math.random() * 12 - 6
      });
    }
    confettiParticlesRef.current = particles;
  };

  // Check webcam permissions and load TFJS model
  useEffect(() => {
    async function loadModels() {
      try {
        setLoading(true);
        await tf.ready();
        const loadedModel = await handpose.load();
        setModel(loadedModel);
        setLoading(false);
        startCamera();
      } catch (err) {
        console.error("TFJS Handpose loading error:", err);
        setFeedback("فشل تحميل نظام تتبع الحركة. الرجاء التحقق من الاتصال بالإنترنت.");
        setLoading(false);
      }
    }
    loadModels();

    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const startCamera = async () => {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: "user" },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
        setWebcamAllowed(true);
      } else {
        setWebcamAllowed(false);
        setFeedback("الكاميرا غير مدعومة على هذا الجهاز.");
      }
    } catch (err) {
      console.error("Webcam access denied:", err);
      setWebcamAllowed(false);
      setFeedback("يرجى تفعيل إذن الكاميرا للعب اللعبة!");
    }
  };

  // Perform detection loop when webcam and model are ready
  useEffect(() => {
    let animationFrameId: number;

    const runDetection = async () => {
      if (
        model &&
        videoRef.current &&
        videoRef.current.readyState >= 2 &&
        videoRef.current.videoWidth > 0 &&
        canvasRef.current
      ) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        
        if (ctx) {
          // Sync canvas size
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          // Estimate hands
          const predictions = await model.estimateHands(video);

          let totalFingers = 0;
          if (predictions.length > 0) {
            // Draw skeleton and count fingers for all detected hands
            predictions.forEach((prediction) => {
              const landmarks = prediction.landmarks;
              drawHandSkeleton(ctx, landmarks);
              totalFingers += countFingers(landmarks);
            });
            setDetectedFingers(totalFingers);

            // Verify if user matches equation answer
            if (totalFingers === equation.answer && !isSuccess) {
              handleCorrectAnswer(canvas.width, canvas.height);
            }
          }

          // Update and draw confetti particles
          const confettiParticles = confettiParticlesRef.current;
          for (let i = confettiParticles.length - 1; i >= 0; i--) {
            const p = confettiParticles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.3; // gravity
            p.rotation += p.rotationSpeed;

            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate((p.rotation * Math.PI) / 180);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
            ctx.restore();

            if (p.y > canvas.height) {
              confettiParticles.splice(i, 1);
            }
          }
        }
      }
      animationFrameId = requestAnimationFrame(runDetection);
    };

    if (!loading && model && webcamAllowed) {
      animationFrameId = requestAnimationFrame(runDetection);
    }

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [model, equation, isSuccess, loading, webcamAllowed]);

  const handleCorrectAnswer = (width: number, height: number) => {
    setIsSuccess(true);
    setCurrentScore((prev) => prev + 10);
    playSoundEffect("correct");
    triggerConfettiBlast(width, height);
    setFeedback("إجابة صحيحة وممتازة! خمس نجوم لك");
    
    // Auto-advance
    setTimeout(() => {
      generateNewQuestion();
    }, 2800);
  };

  const countFingers = (landmarks: number[][]): number => {
    let count = 0;
    
    const tipIndices = [8, 12, 16, 20];
    const pipIndices = [6, 10, 14, 18];

    // Four fingers
    for (let i = 0; i < tipIndices.length; i++) {
      if (landmarks[tipIndices[i]][1] < landmarks[pipIndices[i]][1]) {
        count++;
      }
    }

    // Thumb check
    const thumbTip = landmarks[4];
    const thumbIp = landmarks[3];
    const thumbMcp = landmarks[2];
    
    const isThumbExtended = Math.abs(thumbTip[0] - thumbMcp[0]) > Math.abs(thumbIp[0] - thumbMcp[0]);
    if (isThumbExtended) {
      count++;
    }

    return count;
  };

  // Draw glowing joints feedback skeleton
  const drawHandSkeleton = (ctx: CanvasRenderingContext2D, landmarks: number[][]) => {
    ctx.strokeStyle = "#4ECDC4";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.fillStyle = "#FF6B6B";
    ctx.shadowBlur = 10;
    ctx.shadowColor = "#4ECDC4";

    const connections = [
      [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
      [0, 5], [5, 6], [6, 7], [7, 8], // Index
      [5, 9], [9, 10], [10, 11], [11, 12], // Middle
      [9, 13], [13, 14], [14, 15], [15, 16], // Ring
      [13, 17], [17, 18], [18, 19], [19, 20], // Pinky
      [0, 17]
    ];

    connections.forEach(([from, to]) => {
      const fx = landmarks[from][0];
      const fy = landmarks[from][1];
      const tx = landmarks[to][0];
      const ty = landmarks[to][1];
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    });

    ctx.shadowBlur = 0; // reset shadow
    landmarks.forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, 2 * Math.PI);
      ctx.fill();
    });
  };

  return (
    <div
      dir="rtl"
      className="flex flex-col items-center justify-center p-4 sm:p-6"
    >
      {/* ─── Main Card ─── */}
      <div
        className="max-w-4xl w-full rounded-[28px] overflow-hidden flex flex-col"
        style={{
          background: "linear-gradient(160deg, #0a0a1a 0%, #12122e 50%, #080810 100%)",
          boxShadow: "0 40px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(78,205,196,0.3), inset 0 1px 0 rgba(255,255,255,0.04)",
        }}
      >
        {/* ─── Header ─── */}
        <div
          className="px-6 py-4 flex items-center justify-between"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center text-white"
              style={{
                background: "linear-gradient(135deg, #4ECDC4, #26d0c4)",
                boxShadow: "0 4px 16px rgba(78,205,196,0.5)",
              }}
            >
              <Calculator size={22} />
            </div>
            <div>
              <h1 className="text-sm font-black text-white leading-tight">Gesture Math 2.0</h1>
              <p className="text-[10px] font-semibold" style={{ color: "#4ECDC4" }}>رياضيات بإشارات يديك</p>
            </div>
          </div>

          {/* Age badge */}
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-black"
            style={{
              background: "rgba(78,205,196,0.12)",
              border: "1px solid rgba(78,205,196,0.3)",
              color: "#4ECDC4",
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-ping" />
            أعمار 4–12 سنة
          </div>
        </div>

        {/* ─── Stats Row ─── */}
        <div
          className="px-5 py-3 grid grid-cols-2 gap-3"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
        >
          {/* Score */}
          <div
            className="flex items-center gap-3 px-4 py-3 rounded-2xl"
            style={{
              background: "rgba(255,230,109,0.08)",
              border: "1px solid rgba(255,230,109,0.2)",
            }}
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(255,230,109,0.2)", border: "1px solid rgba(255,230,109,0.3)", color: "#FFE66D" }}
            >
              <Trophy size={18} />
            </div>
            <div>
              <div className="text-xl font-black" style={{ color: "#FFE66D" }}>{currentScore}</div>
              <div className="text-[9px] text-slate-500 font-bold">النقاط المكتسبة</div>
            </div>
          </div>

          {/* Fingers */}
          <div
            className="flex items-center gap-3 px-4 py-3 rounded-2xl"
            style={{
              background: "rgba(78,205,196,0.08)",
              border: "1px solid rgba(78,205,196,0.2)",
            }}
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(78,205,196,0.2)", border: "1px solid rgba(78,205,196,0.3)", color: "#4ECDC4" }}
            >
              <Hand size={18} />
            </div>
            <div>
              <div className="text-xl font-black" style={{ color: "#4ECDC4" }}>{detectedFingers}</div>
              <div className="text-[9px] text-slate-500 font-bold">أصابع مكتشفة</div>
            </div>
          </div>
        </div>

        {/* ─── Camera Display ─── */}
        <div className="relative w-full" style={{ aspectRatio: "16/9" }}>
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover"
            style={{ transform: "scaleX(-1)" }}
            playsInline
            muted
            autoPlay
          />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full object-cover pointer-events-none z-10"
            style={{ transform: "scaleX(-1)" }}
          />

          {/* Corner decorations */}
          {!loading && webcamAllowed && !isSuccess && (
            <>
              <div className="absolute top-3 left-3 w-6 h-6 border-t-2 border-l-2 border-teal-400/50 rounded-tl-lg z-20" />
              <div className="absolute top-3 right-3 w-6 h-6 border-t-2 border-r-2 border-teal-400/50 rounded-tr-lg z-20" />
              <div className="absolute bottom-3 left-3 w-6 h-6 border-b-2 border-l-2 border-teal-400/50 rounded-bl-lg z-20" />
              <div className="absolute bottom-3 right-3 w-6 h-6 border-b-2 border-r-2 border-teal-400/50 rounded-br-lg z-20" />
            </>
          )}

          {/* Loading overlay */}
          {loading && (
            <div
              className="absolute inset-0 z-20 flex flex-col items-center justify-center p-4 text-center"
              style={{ background: "radial-gradient(ellipse at center, rgba(15,15,30,0.95) 0%, rgba(5,5,10,0.98) 100%)" }}
            >
              <div className="relative mb-6">
                <div
                  className="w-20 h-20 rounded-full border-4 border-transparent animate-spin"
                  style={{ borderTopColor: "#4ECDC4", borderRightColor: "rgba(78,205,196,0.3)" }}
                />
                <div className="absolute inset-0 flex items-center justify-center text-teal-400"><Brain size={28} /></div>
              </div>
              <p className="text-white font-black text-base mb-2">جاري تحميل نموذج الذكاء الاصطناعي...</p>
              <p className="text-[11px] text-slate-400 font-semibold max-w-xs leading-relaxed">
                يرجى السماح بالوصول للكاميرا عند ظهور الطلب. سيتم تحميل نموذج Handpose.
              </p>
              <div className="mt-4 flex gap-1.5">
                {[0,1,2].map(i => (
                  <div key={i} className="w-2 h-2 rounded-full bg-teal-400 animate-bounce"
                    style={{ animationDelay: `${i * 150}ms` }} />
                ))}
              </div>
            </div>
          )}

          {/* Camera denied */}
          {!webcamAllowed && !loading && (
            <div
              className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 text-center"
              style={{ background: "radial-gradient(ellipse at center, rgba(20,10,10,0.96) 0%, rgba(5,5,10,0.98) 100%)" }}
            >
              <div
                className="w-20 h-20 rounded-3xl flex items-center justify-center mb-5"
                style={{
                  background: "rgba(248,113,113,0.15)",
                  border: "2px solid rgba(248,113,113,0.3)",
                  boxShadow: "0 0 30px rgba(248,113,113,0.2)",
                  color: "#f87171",
                }}
              >
                <CameraOff size={36} />
              </div>
              <p className="text-white font-black text-lg mb-2">تعذّر تشغيل الكاميرا</p>
              <p className="text-xs text-slate-400 font-semibold max-w-sm leading-relaxed mb-6">
                تحتاج اللعبة للوصول للكاميرا لقراءة إشارات أصابعك. يرجى تفعيل الإذن ثم تحديث الصفحة.
              </p>
              <button
                onClick={startCamera}
                className="btn-primary btn-shimmer text-xs px-8 py-3 flex items-center gap-2"
                style={{ background: "linear-gradient(135deg,#4ECDC4,#26d0c4)", borderBottomColor: "#2a9d8f", boxShadow: "0 8px 25px rgba(78,205,196,0.4)" }}
              >
                <RefreshCw size={14} /> إعادة المحاولة
              </button>
            </div>
          )}

          {/* Success overlay */}
          {isSuccess && (
            <div
              className="absolute inset-0 z-20 flex flex-col items-center justify-center animate-bounce-in"
              style={{
                background: "radial-gradient(ellipse at center, rgba(52,211,153,0.25) 0%, rgba(0,0,0,0.85) 100%)",
                backdropFilter: "blur(4px)",
              }}
            >
              <div
                className="mb-3 p-5 rounded-3xl text-emerald-400"
                style={{
                  background: "rgba(52,211,153,0.15)",
                  border: "2px solid rgba(52,211,153,0.4)",
                  boxShadow: "0 0 50px rgba(52,211,153,0.4)",
                }}
              >
                <PartyPopper size={40} />
              </div>
              <p className="text-white font-black text-xl mb-1">إجابة صحيحة وممتازة!</p>
              <div className="flex items-center gap-1.5">
                <div className="flex gap-0.5" aria-hidden="true">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <Star key={i} size={16} className="text-emerald-400" fill="currentColor" />
                  ))}
                </div>
                <p className="text-emerald-400 font-black text-sm">خمس نجوم لك!</p>
              </div>
            </div>
          )}
        </div>

        {/* ─── Equation Panel ─── */}
        <div
          className="px-5 py-5 flex flex-col items-center"
          style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}
        >
          <span className="text-[9px] font-black text-slate-600 tracking-widest uppercase mb-3">
            المسألة الحالية
          </span>

          <div
            className="text-5xl font-black mb-4 select-none tracking-widest"
            style={{
              color: "#FF6B6B",
              textShadow: "0 0 20px rgba(255,107,107,0.5)",
            }}
          >
            {equation.question}
          </div>

          <div
            className={`px-5 py-2.5 rounded-xl text-xs font-black text-center max-w-xs leading-relaxed transition-all ${
              isSuccess
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "bg-blue-500/10 text-blue-300 border border-blue-500/20"
            }`}
          >
            {feedback}
          </div>
        </div>

        {/* ─── Action Buttons ─── */}
        <div
          className="px-5 pb-5 flex gap-3"
        >
          <button
            onClick={() => { playSoundEffect("click"); generateNewQuestion(); }}
            className="flex-1 py-3 rounded-2xl text-xs font-black transition-all btn-shimmer flex items-center justify-center gap-1.5"
            style={{
              background: "linear-gradient(135deg, #FFE66D, #ffd740)",
              color: "#78350f",
              borderBottom: "3px solid #b45309",
              boxShadow: "0 6px 20px rgba(255,230,109,0.3)",
            }}
          >
            تخطي المسألة <ArrowLeft size={14} />
          </button>
          <button
            onClick={() => { playSoundEffect("click"); startCamera(); }}
            className="px-5 py-3 rounded-2xl text-xs font-black transition-all flex items-center gap-2"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "#94a3b8",
            }}
          >
            <Video className="w-4 h-4" />
            الكاميرا
          </button>
        </div>
      </div>
    </div>
  );
}
