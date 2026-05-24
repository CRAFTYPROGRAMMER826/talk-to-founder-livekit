import { default as TypedEventEmitter } from 'typed-emitter';
import { Room, ConnectionState, TrackPublishOptions, TokenSourceConfigurable, TokenSourceFixed, TokenSourceFetchOptions, RoomConnectOptions, BaseKeyProvider, BaseE2EEManager } from 'livekit-client';
import { AgentState } from './useAgent';
import { TrackReference } from '@livekit/components-core';
/** @beta */
export declare enum SessionEvent {
    ConnectionStateChanged = "connectionStateChanged",
    /**
     * Emits when an error is encountered while attempting to create a track.
     * Use MediaDeviceFailure.getFailure(error) to get the reason of failure.
     * args: (error: Error, kind: MediaDeviceKind)
     */
    MediaDevicesError = "mediaDevicesError",
    /**
     * Emits when an error is received while decrypting frame received frame information.
     * args: (error: Error)
     */
    EncryptionError = "encryptionError"
}
/** @beta */
export type SessionCallbacks = {
    [SessionEvent.ConnectionStateChanged]: (newAgentConnectionState: ConnectionState) => void;
    [SessionEvent.MediaDevicesError]: (error: Error) => void;
    [SessionEvent.EncryptionError]: (error: Error) => void;
};
/** @beta */
export type SessionConnectOptions = {
    /** Optional abort signal which if triggered will terminate connecting even if it isn't complete */
    signal?: AbortSignal;
    tracks?: {
        microphone?: {
            enabled?: boolean;
            publishOptions?: TrackPublishOptions;
        };
        camera?: {
            enabled?: boolean;
            publishOptions?: TrackPublishOptions;
        };
        screenShare?: {
            enabled?: boolean;
            publishOptions?: TrackPublishOptions;
        };
    };
    /** Options for Room.connect(.., .., opts) */
    roomConnectOptions?: RoomConnectOptions;
};
/** @beta */
export type SwitchActiveDeviceOptions = {
    /**
     *  If true, adds an `exact` constraint to the getUserMedia request.
     *  The request will fail if this option is true and the device specified is not actually available
     */
    exact?: boolean;
};
type SessionStateCommon = {
    room: Room;
    internal: {
        emitter: TypedEventEmitter<SessionCallbacks>;
        tokenSource: TokenSourceConfigurable | TokenSourceFixed;
        agentConnectTimeoutMilliseconds?: number;
        agentTimeoutFailureReason: string | null;
        startAgentTimeout: (agentConnectTimeoutMilliseconds?: number) => void;
        clearAgentTimeout: () => void;
        clearAgentTimeoutFailureReason: () => void;
        updateAgentTimeoutState: (agentState: AgentState) => void;
        updateAgentTimeoutParticipantExists: (agentParticipantExists: boolean) => void;
    };
};
type SessionStateConnecting = SessionStateCommon & {
    connectionState: ConnectionState.Connecting;
    isConnected: false;
    local: {
        cameraTrack: undefined;
        microphoneTrack: undefined;
        screenShareTrack: undefined;
    };
};
type SessionStateConnected = SessionStateCommon & {
    connectionState: ConnectionState.Connected | ConnectionState.Reconnecting | ConnectionState.SignalReconnecting;
    isConnected: true;
    local: {
        cameraTrack?: TrackReference;
        microphoneTrack?: TrackReference;
        screenShareTrack?: TrackReference;
    };
};
type SessionStateDisconnected = SessionStateCommon & {
    connectionState: ConnectionState.Disconnected;
    isConnected: false;
    local: {
        cameraTrack: undefined;
        microphoneTrack: undefined;
        screenShareTrack: undefined;
    };
};
type SessionActions = {
    /** Returns a promise that resolves once the room connects. */
    waitUntilConnected: (signal?: AbortSignal) => Promise<void>;
    /** Returns a promise that resolves once the room disconnects */
    waitUntilDisconnected: (signal?: AbortSignal) => Promise<void>;
    prepareConnection: () => Promise<void>;
    /** Connect to the underlying room and dispatch any agents */
    start: (options?: SessionConnectOptions) => Promise<void>;
    /** Disconnect from the underlying room */
    end: () => Promise<void>;
    /** Enable or disable E2EE. */
    setEncryptionEnabled: (enabled: boolean) => Promise<void>;
};
/** @beta */
export type UseSessionReturn = (SessionStateConnecting | SessionStateConnected | SessionStateDisconnected) & SessionActions;
/** @internal */
export declare function isUseSessionReturn(value: unknown): value is UseSessionReturn;
type UseSessionCommonOptions = {
    /**
     * Amount of time in milliseonds the system will wait for an agent to join the room, before
     * transitioning to the "failure" state.
     */
    agentConnectTimeoutMilliseconds?: number;
};
type UseSessionWithRoomOptions = {
    room: Room;
    encryption?: never;
};
type UseSessionEncryptionOptions = {
    /**
     * Accepts a passphrase that's used to create the crypto keys.
     * When passing in a string, PBKDF2 is used. (recommended for maximum compatibility across SDKs)
     * When passing in an ArrayBuffer of cryptographically random numbers, HKDF is used.
     *
     * Note: Not all client SDKs support HKDF.
     */
    key: string | ArrayBuffer | BaseKeyProvider;
    /** An instance of the E2EE webworker, which must be constructed using your js build tool's
     * webworker construction mechanism. */
    worker: Worker;
    e2eeManager?: undefined;
} | {
    key?: undefined;
    worker?: undefined;
    /**
     * For React Native usage: Pass the e2eeManager obtained from the `useRNE2EEManager()` hook
     * in the `\@livekit/react-native` package.
     */
    e2eeManager: BaseE2EEManager;
} | {
    key?: undefined;
    worker?: undefined;
    e2eeManager?: undefined;
};
type UseSessionWithoutRoomOptions = {
    room?: never;
    /** Configuration for room-level E2EE */
    encryption?: UseSessionEncryptionOptions;
};
type UseSessionRoomOptions = UseSessionWithRoomOptions | UseSessionWithoutRoomOptions;
type UseSessionConfigurableOptions = UseSessionCommonOptions & UseSessionRoomOptions & TokenSourceFetchOptions;
type UseSessionFixedOptions = UseSessionCommonOptions & UseSessionRoomOptions;
/**
 * A Session represents a managed connection to a Room which can contain Agents.
 * @beta
 */
export declare function useSession(tokenSource: TokenSourceConfigurable, options?: UseSessionConfigurableOptions): UseSessionReturn;
/**
 * A Session represents a managed connection to a Room which can contain Agents.
 * @beta
 */
export declare function useSession(tokenSource: TokenSourceFixed, options?: UseSessionFixedOptions): UseSessionReturn;
export {};
//# sourceMappingURL=useSession.d.ts.map