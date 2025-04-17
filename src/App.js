import React, { useState, useRef, useEffect, useCallback } from 'react';
import './App.css';

// Helper function to format time (MM:SS)
const formatTime = (timeInSeconds) => {
  if (timeInSeconds === null || isNaN(timeInSeconds)) return "00:00";
  const totalSeconds = Math.floor(timeInSeconds);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

// Helper function to get audio duration (returns promise)
const getAudioDuration = (audioUrl) => {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    audio.onloadedmetadata = () => {
      const duration = isFinite(audio.duration) ? audio.duration : 0;
      resolve(duration);
    };
    audio.onerror = (e) => {
      console.error("Error loading audio metadata:", e);
      resolve(0);
    };
    audio.src = audioUrl;
  });
};

function App() {
  const [permission, setPermission] = useState(false);
  const [stream, setStream] = useState(null);
  const [recordingStatus, setRecordingStatus] = useState('inactive'); // inactive, recording, paused
  const [audioChunks, setAudioChunks] = useState([]);
  const [audioRecordings, setAudioRecordings] = useState([]); // Stores { id, name, url, duration }
  const [playbackUrl, setPlaybackUrl] = useState(null);
  const [currentRecordingDuration, setCurrentRecordingDuration] = useState(0);

  const mediaRecorder = useRef(null);
  const timerIntervalRef = useRef(null);
  const audioPlayerRef = useRef(null);
  const isProcessedRef = useRef(false); // Flag to avoid duplicate processing

  const mimeType = 'audio/webm';

  // --- Utility Functions ---
  const startTimer = useCallback(() => {
    clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = setInterval(() => {
      setCurrentRecordingDuration((prevDuration) => prevDuration + 1);
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = null;
  }, []);

  const resetTimer = useCallback(() => {
    stopTimer();
    setCurrentRecordingDuration(0);
  }, [stopTimer]);

  // --- Effects ---
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      stopTimer();
      // Revoke object URLs to prevent memory leaks
      audioRecordings.forEach(rec => {
        if (rec.url && typeof rec.url === 'string' && rec.url.startsWith('blob:')) {
          URL.revokeObjectURL(rec.url);
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream, stopTimer]);

  // --- Permission ---
  // Modified to return the stream for immediate use
  const getMicrophonePermission = async () => {
    if ('MediaRecorder' in window) {
      try {
        const streamData = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        setPermission(true);
        setStream(streamData);
        console.log("Microphone permission granted.");
        return streamData;
      } catch (err) {
        alert("Microphone permission denied: " + err.message);
        console.error("Microphone permission error:", err);
        setPermission(false);
        return null;
      }
    } else {
      alert('The MediaRecorder API is not supported in your browser.');
      return null;
    }
  };

  // --- Recording Control ---
  const startRecording = async () => {
    let currentStream = stream;
    if (!currentStream) {
      currentStream = await getMicrophonePermission();
      if (!currentStream) {
        alert("Could not get microphone stream. Please try again.");
        return;
      }
    }
    if (!permission) {
      alert("Microphone permission is required to record.");
      return;
    }

    // Reset the processing flag for the new recording
    isProcessedRef.current = false;
    setRecordingStatus('recording');
    setAudioChunks([]); // Clear previous chunks

    const media = new MediaRecorder(currentStream, { mimeType });
    mediaRecorder.current = media;

    mediaRecorder.current.ondataavailable = (event) => {
      if (typeof event.data === 'undefined' || event.data.size === 0) return;
      setAudioChunks((prev) => [...prev, event.data]);
    };

    mediaRecorder.current.onstop = () => {
      console.log("MediaRecorder stopped.");
      stopTimer();
    };

    mediaRecorder.current.onerror = (event) => {
      console.error("MediaRecorder error:", event.error);
      alert("Recording error: " + event.error.message);
      setRecordingStatus("inactive");
      resetTimer();
    };

    mediaRecorder.current.onpause = () => {
      console.log("MediaRecorder paused.");
      stopTimer();
    };

    mediaRecorder.current.onresume = () => {
      console.log("MediaRecorder resumed.");
      startTimer();
    };

    mediaRecorder.current.start(100); // Collect chunks every 100ms
    console.log("Recording started.");
    resetTimer();
    startTimer();
  };

  const pauseRecording = () => {
    if (!mediaRecorder.current || recordingStatus !== 'recording') return;
    mediaRecorder.current.pause();
    setRecordingStatus('paused');
  };

  const resumeRecording = () => {
    if (!mediaRecorder.current || recordingStatus !== 'paused') return;
    mediaRecorder.current.resume();
    setRecordingStatus('recording');
  };

  const stopRecording = () => {
    if (!mediaRecorder.current || (recordingStatus !== 'recording' && recordingStatus !== 'paused')) return;
    mediaRecorder.current.stop();
    setRecordingStatus('inactive');
    resetTimer();
    // Note: The final data may still come in via ondataavailable
  };

  // --- Process Recorded Audio ---
  useEffect(() => {
    const processAudio = async () => {
      // Process only once when recording is inactive and there are chunks available
      if (recordingStatus === 'inactive' && audioChunks.length > 0 && !isProcessedRef.current) {
        isProcessedRef.current = true; // Prevent duplicate processing
        console.log("Processing audio chunks...");
        const audioBlob = new Blob(audioChunks, { type: mimeType });
        const audioUrl = URL.createObjectURL(audioBlob);

        const durationInSeconds = await getAudioDuration(audioUrl);
        const formattedDuration = formatTime(durationInSeconds);
        console.log(`Calculated duration: ${formattedDuration} (${durationInSeconds}s)`);

        const recordingName = `Recording-${new Date().toLocaleString()}.webm`;
        const newRecording = {
          id: Date.now(),
          name: recordingName,
          url: audioUrl,
          blob: audioBlob,
          duration: formattedDuration,
        };

        setAudioRecordings((prev) => [newRecording, ...prev]);
        setAudioChunks([]); // Clear chunks after processing
        setPlaybackUrl(audioUrl);
        console.log("Audio saved:", newRecording.name, audioUrl);
        resetTimer();
      }
    };

    processAudio().catch(e => console.error("Error processing audio:", e));
  }, [audioChunks, recordingStatus, resetTimer]);

  // --- Playback & Deletion ---
  const playRecording = (url) => {
    setPlaybackUrl(url);
  };

  const deleteRecording = (idToDelete) => {
    setAudioRecordings((prev) =>
      prev.filter((rec) => {
        if (rec.id === idToDelete) {
          if (rec.url && typeof rec.url === 'string' && rec.url.startsWith('blob:')) {
            URL.revokeObjectURL(rec.url);
            console.log("Revoked Object URL:", rec.url);
          }
          return false;
        }
        return true;
      })
    );
    const deletedRec = audioRecordings.find(rec => rec.id === idToDelete);
    if (playbackUrl === deletedRec?.url) {
      setPlaybackUrl(null);
    }
  };

  const clearAllRecordings = () => {
    if (window.confirm("Are you sure you want to delete ALL recordings? This cannot be undone.")) {
      audioRecordings.forEach(rec => {
        if (rec.url && typeof rec.url === 'string' && rec.url.startsWith('blob:')) {
          URL.revokeObjectURL(rec.url);
        }
      });
      console.log("Revoked all recording Object URLs.");
      setAudioRecordings([]);
      setPlaybackUrl(null);
      setAudioChunks([]);
    }
  };

  return (
    <div className="App">
      <h1>React Voice Recorder++</h1>

      {/* --- Controls --- */}
      <div className="controls">
        {!permission ? (
          <button onClick={getMicrophonePermission} type="button" className="button">
            Get Mic Permission
          </button>
        ) : (
          <>
            {(recordingStatus === 'inactive') && (
              <button onClick={startRecording} type="button" className="button record-button">
                Record <span className="icon">●</span>
              </button>
            )}
            {(recordingStatus === 'recording') && (
              <>
                <button onClick={pauseRecording} type="button" className="button pause-button">
                  Pause <span className="icon">❚❚</span>
                </button>
                <button onClick={stopRecording} type="button" className="button stop-button">
                  Stop <span className="icon">■</span>
                </button>
              </>
            )}
            {(recordingStatus === 'paused') && (
              <>
                <button onClick={resumeRecording} type="button" className="button resume-button">
                  Resume <span className="icon">▶</span>
                </button>
                <button onClick={stopRecording} type="button" className="button stop-button">
                  Stop <span className="icon">■</span>
                </button>
              </>
            )}
          </>
        )}
      </div>

      {/* --- Status & Timer --- */}
      <div className="status-timer">
        {recordingStatus === 'recording' && (
          <p className="status status-recording">
            Recording... <span>{formatTime(currentRecordingDuration)}</span>
          </p>
        )}
        {recordingStatus === 'paused' && (
          <p className="status status-paused">
            Paused <span>{formatTime(currentRecordingDuration)}</span>
          </p>
        )}
      </div>

      {/* --- Main Audio Player --- */}
      {playbackUrl && (
        <div className="audio-player-main">
          <h3>Preview / Playback</h3>
          <audio ref={audioPlayerRef} src={playbackUrl} controls controlsList="nodownload" />
          {(() => {
            const currentRec = audioRecordings.find(r => r.url === playbackUrl);
            if (currentRec) {
              return (
                <a href={currentRec.url} download={currentRec.name} className="download-link">
                  Download This Recording
                </a>
              );
            }
            return null;
          })()}
        </div>
      )}

      {/* --- Recordings List --- */}
      <div className="recordings-list">
        <div className="list-header">
          <h2>Stored Recordings ({audioRecordings.length})</h2>
          {audioRecordings.length > 0 && (
            <button onClick={clearAllRecordings} className="button clear-all-button">
              Clear All
            </button>
          )}
        </div>

        {audioRecordings.length === 0 && recordingStatus === 'inactive' && <p>No recordings yet. Click 'Record' to start!</p>}
        <ul>
          {audioRecordings.map((rec) => (
            <li key={rec.id} className={playbackUrl === rec.url ? 'playing' : ''}>
              <span className="rec-name">{rec.name}</span>
              <span className="rec-duration">({rec.duration || '...'})</span>
              <div className="rec-controls">
                <button onClick={() => playRecording(rec.url)} className="button play-button" title="Play">▶</button>
                <a href={rec.url} download={rec.name} className="button download-button" title="Download">⬇</a>
                <button onClick={() => deleteRecording(rec.id)} className="button delete-button" title="Delete">🗑</button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default App;
