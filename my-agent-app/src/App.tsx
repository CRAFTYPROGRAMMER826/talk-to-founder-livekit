
import { useEffect, useRef } from "react";
import {
  ControlBar,
  RoomAudioRenderer,
  useSession,
  SessionProvider,
  useAgent,
  BarVisualizer,
} from "@livekit/components-react";
import {
  TokenSource,
} from "livekit-client";
import "@livekit/components-styles";

const tokenSource = TokenSource.sandboxTokenServer("maneuver-qm1wle");

export default function App() {
  const session = useSession(tokenSource, { agentName: "maneuver" });

  // Connect to session
  useEffect(() => {
    session.start();
    return () => {
      session.end();
    };
  }, []);

  return (
    <SessionProvider session={session}>
      <div data-lk-theme="default" style={{ height: "100vh" }}>
        {/* Your custom component with basic video agent functionality. */}
        <MyAgentView />
        {/* Controls for the user to start/stop audio and disconnect from the session */}
        <ControlBar
          controls={{ microphone: true, camera: false, screenShare: false }}
        />
        {/* The RoomAudioRenderer takes care of room-wide audio for you. */}
        <RoomAudioRenderer />
      </div>
    </SessionProvider>
  );
}

function MyAgentView() {
  const agent = useAgent();
  return (
    <div style={{ height: "350px" }}>
      <p>Agent state: {agent.state}</p>
      {/* Renders a visualizer for the agent's audio track */}
      {agent.canListen && (
        <BarVisualizer
          track={agent.microphoneTrack}
          state={agent.state}
          barCount={5}
        />
      )}
    </div>
  );
}
