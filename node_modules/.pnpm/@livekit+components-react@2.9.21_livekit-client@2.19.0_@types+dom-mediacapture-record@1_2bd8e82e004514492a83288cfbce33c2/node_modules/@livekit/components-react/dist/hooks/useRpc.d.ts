import { RpcInvocationData, PerformRpcParams, Serializer, SerializerInput, SerializerOutput } from 'livekit-client';
import { UseSessionReturn } from './useSession';
/** @beta */
export type RpcHandler<Input = any, Output = any> = (payload: Input, data: RpcInvocationData) => Promise<Output>;
/**
 * Base RPC call parameters with an arbitrary payload type (used when the payload
 * will be serialized by a serializer).
 *
 * @beta
 */
export type RpcCallParams<Payload> = Omit<PerformRpcParams, 'payload'> & {
    payload: Payload;
};
/**
 * Options for {@link (useRpc:1)}.
 * @beta
 */
export type UseRpcOptions<S extends Serializer<any, any> = Serializer<any, any>> = {
    /** Only accept RPCs from this participant. Others will receive UNSUPPORTED_METHOD. */
    fromIdentity?: string;
    /**
     * Serializer applied to the data coming in and leaving the handler. Defaults to `serializers.json()`
     */
    serializer?: S;
};
/** @beta */
export type RpcPerformFn = {
    /** Serializer-wrapped call: payload is serialized and response is parsed by the serializer. */
    <Output = string, Input = unknown>(params: RpcCallParams<Input>, serializer: Serializer<Output, Input>): Promise<Output>;
    /** Plain call: payload is already a string, response is returned as a string. */
    (params: PerformRpcParams): Promise<string>;
};
/** @beta */
export type UseRpcReturn = {
    perform: RpcPerformFn;
};
/**
 * Hook for declarative RPC method registration and outbound RPC calls.
 *
 * Registers a handler for an incoming RPC method and returns a `performRpc`
 * function for outbound calls. The handler is registered on mount and
 * unregistered on unmount. Handler identity does not matter (captured by ref),
 * so inline functions work without `useCallback`.
 *
 * @example
 * ```tsx
 * const { performRpc } = useRpc(session, "getUserLocation", async (payload: { highAccuracy: boolean }) => {
 *   const pos = await getPosition(payload.highAccuracy);
 *   return { lat: pos.coords.latitude, lng: pos.coords.longitude };
 * });
 * ```
 *
 * @beta
 */
export declare function useRpc<S extends Serializer<any, any>>(session: UseSessionReturn, methodName: string, handler: RpcHandler<SerializerInput<S>, SerializerOutput<S>>, options?: UseRpcOptions<S>): UseRpcReturn;
/** @beta */
export declare function useRpc<S extends Serializer<any, any>>(methodName: string, handler: RpcHandler<SerializerInput<S>, SerializerOutput<S>>, options?: UseRpcOptions<S>): UseRpcReturn;
/** @beta */
export declare function useRpc(session: UseSessionReturn): UseRpcReturn;
/** @beta */
export declare function useRpc(): UseRpcReturn;
//# sourceMappingURL=useRpc.d.ts.map