"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  ChevronLeft,
  ChevronRight,
  Download,
} from "lucide-react";

export interface CustomVideoPlayerProps {
  src: string;
  poster?: string;
  className?: string;
  autoPlay?: boolean;
}

export function CustomVideoPlayer({
  src,
  poster,
  className = "",
  autoPlay = false,
}: CustomVideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scrubberRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [hoverPosition, setHoverPosition] = useState<number | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);

  const hideTimerRef = useRef<NodeJS.Timeout | null>(null);

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return "0:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const togglePlay = useCallback(() => {
    if (!videoRef.current) return;
    if (videoRef.current.paused || videoRef.current.ended) {
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  }, []);

  // Frame step (~0.05s)
  const stepFrame = useCallback((forward: boolean) => {
    if (!videoRef.current) return;
    videoRef.current.pause();
    setIsPlaying(false);
    const step = 0.05;
    const dur = isFinite(videoRef.current.duration) && videoRef.current.duration > 0
      ? videoRef.current.duration
      : 0;
    const next = forward
      ? (dur > 0 ? Math.min(dur, videoRef.current.currentTime + step) : videoRef.current.currentTime + step)
      : Math.max(0, videoRef.current.currentTime - step);
    videoRef.current.currentTime = next;
    setCurrentTime(next);
  }, []);

  const handleRestart = useCallback(() => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = 0;
    setCurrentTime(0);
    videoRef.current.play().catch(() => {});
    setIsPlaying(true);
  }, []);

  const cycleSpeed = () => {
    const speeds = [1, 1.5, 2, 0.5];
    const nextIndex = (speeds.indexOf(playbackRate) + 1) % speeds.length;
    const next = speeds[nextIndex];
    if (videoRef.current) videoRef.current.playbackRate = next;
    setPlaybackRate(next);
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    if (isMuted) {
      videoRef.current.muted = false;
      setIsMuted(false);
    } else {
      videoRef.current.muted = true;
      setIsMuted(true);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (!videoRef.current) return;
    videoRef.current.volume = val;
    setIsMuted(val === 0);
    videoRef.current.muted = val === 0;
  };

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      await containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      await document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const seekToRatio = (ratio: number) => {
    if (!videoRef.current || !duration) return;
    const clamped = Math.max(0, Math.min(1, ratio));
    const next = clamped * duration;
    videoRef.current.currentTime = next;
    setCurrentTime(next);
  };

  const handleScrubberClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!scrubberRef.current || !duration) return;
    const rect = scrubberRef.current.getBoundingClientRect();
    seekToRatio((e.clientX - rect.left) / rect.width);
  };

  const handleScrubberMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!scrubberRef.current || !duration) return;
    const rect = scrubberRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverPosition(ratio);
    setHoverTime(ratio * duration);
    if (isScrubbing) seekToRatio(ratio);
  };

  const resetHideTimer = () => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (isPlaying) {
      hideTimerRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 2000);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (!isHovered && !isFullscreen) return;

      if (e.key === " " || e.key === "k") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (e.shiftKey) stepFrame(false);
        else if (videoRef.current) videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 2);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (e.shiftKey) stepFrame(true);
        else if (videoRef.current) videoRef.current.currentTime = Math.min(duration, videoRef.current.currentTime + 2);
      } else if (e.key === "f") {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === "m") {
        e.preventDefault();
        toggleMute();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [togglePlay, stepFrame, isHovered, isFullscreen, duration]);

  useEffect(() => {
    const handleFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handleFs);
    return () => document.removeEventListener("fullscreenchange", handleFs);
  }, []);

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      onMouseEnter={() => {
        setIsHovered(true);
        resetHideTimer();
      }}
      onMouseLeave={() => {
        setIsHovered(false);
        if (isPlaying) setControlsVisible(false);
      }}
      onMouseMove={resetHideTimer}
      className={`group relative overflow-hidden rounded-lg bg-black font-sans select-none border border-slate-800 ${className}`}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        playsInline
        autoPlay={autoPlay}
        onTimeUpdate={() => {
          if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
        }}
        onLoadedMetadata={() => {
          if (videoRef.current) {
            setDuration(videoRef.current.duration);
            if (autoPlay) setIsPlaying(true);
          }
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          setControlsVisible(true);
        }}
        onClick={togglePlay}
        className="w-full h-full object-contain cursor-pointer aspect-video bg-black block"
      />

      {/* Minimal Play Overlay when paused */}
      {!isPlaying && (
        <button
          type="button"
          onClick={togglePlay}
          aria-label="Play video"
          className="absolute inset-0 m-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-900/80 hover:bg-slate-900 text-white backdrop-blur-sm border border-white/15 shadow-xl transition-transform hover:scale-105 active:scale-95"
        >
          <Play className="h-5 w-5 fill-current translate-x-0.5" />
        </button>
      )}

      {/* Bottom Controls Bar */}
      <div
        className={`absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-3 pb-2.5 pt-6 transition-opacity duration-200 ${
          controlsVisible || !isPlaying ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        {/* Scrubber */}
        <div
          ref={scrubberRef}
          onClick={handleScrubberClick}
          onMouseMove={handleScrubberMouseMove}
          onMouseLeave={() => {
            setHoverPosition(null);
            setHoverTime(null);
          }}
          onMouseDown={() => setIsScrubbing(true)}
          onMouseUp={() => setIsScrubbing(false)}
          className="group/scrub relative mb-2 flex h-3 w-full cursor-pointer items-center"
        >
          <div className="relative h-1 w-full rounded-full bg-white/25 transition-all group-hover/scrub:h-1.5">
            <div
              style={{ width: `${progressPercent}%` }}
              className="h-full rounded-full bg-white relative"
            >
              <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 h-2.5 w-2.5 rounded-full bg-white opacity-0 group-hover/scrub:opacity-100 transition-opacity" />
            </div>
          </div>

          {hoverPosition !== null && hoverTime !== null && (
            <div
              style={{ left: `${hoverPosition * 100}%` }}
              className="absolute -top-6 -translate-x-1/2 rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-mono text-slate-200 border border-slate-700 pointer-events-none"
            >
              {formatTime(hoverTime)}
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center justify-between text-slate-300">
          <div className="flex items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={togglePlay}
              className="rounded p-1 hover:text-white transition-colors"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
            </button>

            <button
              type="button"
              onClick={() => stepFrame(false)}
              title="Step back 1 frame (Shift+Left)"
              className="rounded p-1 hover:text-white transition-colors text-slate-400 hover:text-slate-200"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => stepFrame(true)}
              title="Step forward 1 frame (Shift+Right)"
              className="rounded p-1 hover:text-white transition-colors text-slate-400 hover:text-slate-200"
            >
              <ChevronRight className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={handleRestart}
              title="Restart"
              className="hidden sm:inline-flex rounded p-1 hover:text-white transition-colors text-slate-400 hover:text-slate-200"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>

            <span className="text-xs font-mono text-slate-400 ml-1">
              <span className="text-slate-200">{formatTime(currentTime)}</span>
              <span className="mx-1 text-slate-600">/</span>
              <span>{formatTime(duration)}</span>
            </span>
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            {/* Speed Toggle */}
            <button
              type="button"
              onClick={cycleSpeed}
              className="rounded px-1.5 py-0.5 text-xs font-mono text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              title="Click to cycle speed (0.5x, 1x, 1.5x, 2x)"
            >
              {playbackRate}x
            </button>

            {/* Volume */}
            <div className="group/vol relative flex items-center">
              <button
                type="button"
                onClick={toggleMute}
                className="rounded p-1 hover:text-white transition-colors"
                aria-label={isMuted ? "Unmute" : "Mute"}
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="h-4 w-4 text-slate-400" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="hidden group-hover/vol:inline-block w-14 h-1 accent-white bg-white/20 rounded cursor-pointer ml-1"
              />
            </div>

            {/* Download */}
            <a
              href={src}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="rounded p-1 text-slate-400 hover:text-white transition-colors"
              title="Download video"
            >
              <Download className="h-4 w-4" />
            </a>

            {/* Fullscreen */}
            <button
              type="button"
              onClick={toggleFullscreen}
              className="rounded p-1 hover:text-white transition-colors"
              aria-label={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
