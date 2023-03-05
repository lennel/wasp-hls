import {
  MediaSourceReadyState,
  PlaybackTickReason,
} from "../wasm/wasp_hls";

export {
  MediaSourceReadyState,
  PlaybackTickReason,
};

/** Message sent from the main thread to the worker. */
export type MainMessage =
  InitializationMainMessage |
  LoadContentMainMessage |
  StopContentMainMessage |
  DisposePlayerMainMessage |
  MediaSourceStateChangedMainMessage |
  CreateMediaSourceErrorMainMessage |
  SetMediaSourceDurationErrorMainMessage |
  CreateSourceBufferErrorMainMessage |
  MediaObservationMainMessage |
  SourceBufferOperationErrorMainMessage |
  SourceBufferOperationSuccessMainMessage |
  EndOfStreamErrorMainMessage;

/** Message sent from the worker to the main thread. */
export type WorkerMessage =
  InitializedWorkerMessage |
  InitializationErrorWorkerMessage |
  SeekWorkerMessage |
  ContentErrorWorkerMessage |
  ContentWarningWorkerMessage |
  AttachMediaSourceWorkerMessage |
  CreateMediaSourceWorkerMessage |
  SetMediaSourceDurationWorkerMessage |
  ClearMediaSourceWorkerMessage |
  CreateSourceBufferWorkerMessage |
  AppendBufferWorkerMessage |
  RemoveBufferWorkerMessage |
  EndOfStreamWorkerMessage |
  StartPlaybackObservationWorkerMessage |
  StopPlaybackObservationWorkerMessage |
  MediaOffsetUpdateWorkerMessage |
  ContentInfoUpdateWorkerMessage;

/**
 * Error codes generated for `InitializationErrorWorkerMessage` messages.
 */
export const enum InitializationErrorCode {
  /**
   * The corresponding worker received a `InitializationMainMessage` despite
   * already being initialized.
   */
  AlreadyInitializedError,
  /**
   * The corresponding worker did not succeed to load the WebAssembly part of
   * the WaspHlsPlayer due to the impossibility of requesting it.
   */
  WasmRequestError,
  // /**
  //  * The corresponding worker did not succeed to load the WebAssembly part of
  //  * the WaspHlsPlayer due to an HTTP response not in the 200s.
  //  */
  // WasmRequestBadStatus,
  /**
   * The corresponding worker did not succeed to load the WebAssembly part of
   * the WaspHlsPlayer due to a timeout during its HTTP request.
   */
  WasmRequestTimeout,
  /** Any other, uncategorized, error. */
  UnknownError,
}

export const enum ContentErrorCode {
  UnitializedError,
  // /**
  //  * A `LoadContentMainMessage` messaage was received on a non-initialized
  //  * worker.
  //  */
  // UnitializedLoadError,
  // /**
  //  * A `StopContentMainMessage` message was received on a non-initialized
  //  * worker.
  //  */
  // UnitializedStopError,
}

/**
 * Message sent when the Worker has loaded the WASM code and everything is ready
 * to begin loading content.
 */
export interface InitializedWorkerMessage {
  type: "initialized";
  value: null;
}

/**
 * Message sent when the Worker has encountered a global error and may
 * consequently not be able to operate anymore.
 */
export interface InitializationErrorWorkerMessage {
  type: "initialization-error";
  value: {
    /**
     * Code describing the error encountered.
     */
    code: InitializationErrorCode;
    /**
     * If set, human-readable string describing the error, for debugging
     * purposes.
     */
    message?: string | undefined;
    wasmHttpStatus?: number | undefined;
  };
}

/**
 * Message sent when the Worker has encountered a error linked to a specific
 * content which consequenly has been stopped and disposed.
 */
export interface ContentErrorWorkerMessage {
  type: "content-error";
  value: {
    /**
     * The identifier for the content on which an error was received.
     * This is the same `contentId` value that on the related
     * `LoadContentMainMessage`.
     */
    contentId: string;
    /**
     * Code describing the error encountered.
     */
    code: ContentErrorCode;
    /**
     * If set, human-readable string describing the error, for debugging
     * purposes.
     */
    message?: string | undefined;
  };
}

/**
 * Message sent when the Worker has encountered a minor error linked to a
 * specific content which did not interrupt playback;
 */
export interface ContentWarningWorkerMessage {
  type: "content-warning";
  value: {
    /**
     * The identifier for the content on which an error was received.
     * This is the same `contentId` value that on the related
     * `LoadContentMainMessage`.
     */
    contentId: string;
    /**
     * Code describing the error encountered.
     */
    // code: WarningCode;
    /**
     * If set, human-readable string describing the error, for debugging
     * purposes.
     */
    message?: string | undefined;
  };
}

/**
 * Message sent when the Worker has new information on the content being played.
 */
export interface ContentInfoUpdateWorkerMessage {
  type: "content-info-update";
  value: {
    /**
     * The identifier for the content on which an error was received.
     * This is the same `contentId` value that on the related
     * `LoadContentMainMessage`.
     */
    contentId: string;
    /**
     * Current minimum position, in playlist time and in seconds, for which
     * segments are declared in the playlist.
     */
    minimumPosition: number | undefined;
    /**
     * Current maximum position, in playlist time and in seconds, for which
     * segments are declared in the playlist.
     */
    maximumPosition: number | undefined;
  };
}

/** Message sent when the Worker want to seek in the content */
export interface SeekWorkerMessage {
  type: "seek";

  /** The position to seek to, in seconds. */
  value: {
    /**
     * Identify the MediaSource currently used by the worker.
     * The main thread should only seek if the same MediaSource is still being
     * used.
     */
    mediaSourceId: string;
    /**
     * The position in seconds at which the worker wants to seek to in seconds
     * to put on the HTMLMediaElement's `currentTime` property.
     */
    position: number;
  };
}

/**
 * Sent when the Worker created a MediaSource itself and want to attach it to
 * the HTMLVideoElement.
 *
 * A worker either send the `AttachMediaSourceWorkerMessage` or the
 * `CreateMediaSourceWorkerMessage` for MediaSource attachment, depending on if
 * a MediaSource instance is accessible from a Worker.
 */
export interface AttachMediaSourceWorkerMessage {
  type: "attach-media-source";
  value: {
    /**
     * The identifier for the content on which an error was received.
     * This is the same `contentId` value that on the related
     * `LoadContentMainMessage`.
     */
    contentId : string;
    /**
     * The `MediaSource`'s handle to attach to the HTMLMediaElement.
     * Can be `undefined` in wich case a `src is provided instead.
     */
    handle: MediaProvider | undefined;
    /**
     * The `MediaSource`'s local URL to link to the HTMLMediaElement.
     * Can be `undefined` in wich case a `handle is provided instead.
     */
    src: string | undefined;
    /**
     * Identify the corresponding MediaSource created by the WebWorker.
     * The main thread should keep that value for ensuring that future messages
     * do concern that MediaSource.
     */
    mediaSourceId: string;
  };
}

/**
 * Sent when the Worker wants to create a MediaSource on the main thread and
 * want it to be attached to the HTMLVideoElement.
 *
 * A worker either send the `AttachMediaSourceWorkerMessage` or the
 * `CreateMediaSourceWorkerMessage` for MediaSource attachment, depending on if
 * a MediaSource instance is accessible from a Worker.
 */
export interface CreateMediaSourceWorkerMessage {
  type: "create-media-source";
  value: {
    /**
     * The identifier for the content on which an error was received.
     * This is the same `contentId` value that on the related
     * `LoadContentMainMessage`.
     */
    contentId : string;
    /**
     * Identify the corresponding MediaSource to create.
     * The main thread should keep that value for ensuring that future messages
     * do concern that MediaSource.
     */
    mediaSourceId: string;
  };
}

/**
 * Sent when the Worker wants to update the `duration` property of the
 * MediaSource associated to the `mediaSourceId` given.
 */
export interface SetMediaSourceDurationWorkerMessage {
  type: "update-media-source-duration";
  value: {
    /**
     * Identify the MediaSource currently used by the worker.
     * The main thread should only change the duration if the same MediaSource
     * is still being used.
     */
    mediaSourceId: string;
    /** The new `duration` to set on the  `MediaSource`, in seconds. */ 
    duration: number;
  };
}

/**
 * Sent when the MediaSource linked to the given `mediaSourceId` should be
 * disposed from the HTMLVideoElement if it was, and all of its associated
 * resources disposed.
 */
export interface ClearMediaSourceWorkerMessage {
  type: "clear-media-source";
  value: {
    /**
     * Identify the MediaSource currently used by the worker.
     * The main thread should only clear the MediaSource if it is
     * still the one being used.
     */
    mediaSourceId: string;
  };
}

/**
 * Sent when the Worker wants to create a SourceBuffer on the main thread and
 * want it to be attached to the MediaSource linked to the given
 * `mediaSourceId`.
 */
export interface CreateSourceBufferWorkerMessage {
  type: "create-source-buffer";
  value: {
    /**
     * Identify the MediaSource currently used by the worker.
     * The main thread should only create a SourceBuffer if it is still the
     * MediaSource being used.
     */
    mediaSourceId: string;
    /**
     * Id uniquely identifying this SourceBuffer.
     * It is generated from the Worker and it is unique for all SourceBuffers
     * created after associated with the `mediaSourceId`.
     */
    sourceBufferId: number;
    /**
     * "Content-Type" associated to the SourceBuffer, that may have to be used
     * when initializing the latter.
     */
    contentType: string;
  };
}

/**
 * Sent when the Worker wants to append binary data on the SourceBuffer
 * corresponding to the `sourceBufferId` given.
 *
 * Note that the worker does not take into account the potential queue that
 * should be awaited to perform such operations.
 * As such, any queue mechanism associated to this message should be performed
 * in the main thread.
 */
export interface AppendBufferWorkerMessage {
  type: "append-buffer";
  value: {
    /**
     * Identify the MediaSource currently used by the worker.
     * The main thread should only push data if it is still the MediaSource
     * being used.
     */
    mediaSourceId: string;
    /**
     * Id uniquely identifying this SourceBuffer.
     * It should be the same `sourceBufferId` than the one on the
     * `CreateSourceBufferWorkerMessage`.
     */
    sourceBufferId: number;
    /** Raw data to append to the SourceBuffer. */
    data: BufferSource;
  };
}

/**
 * Sent when the Worker wants to remove data from the SourceBuffer
 * corresponding to the `sourceBufferId` given.
 *
 * Note that the worker does not take into account the potential queue that
 * should be awaited to perform such operations.
 * As such, any queue mechanism associated to this message should be performed
 * in the main thread.
 */
export interface RemoveBufferWorkerMessage {
  type: "remove-buffer";
  value: {
    /**
     * Identify the MediaSource currently used by the worker.
     * The main thread should only remove buffer if it is still the MediaSource
     * being used.
     */
    mediaSourceId: string;
    /**
     * Id uniquely identifying this SourceBuffer.
     * It should be the same `sourceBufferId` than the one on the
     * `CreateSourceBufferWorkerMessage`.
     */
    sourceBufferId: number;
    /** Range start, in seconds, of the data that should be removed. */
    start: number;
    /** Range end, in seconds, of the data that should be removed. */
    end: number;
  };
}

/**
 * Sent when the worker wants to start receiving regularly "playback
 * observations", which are key attributes associated to the HTMLVideoElement.
 */
export interface StartPlaybackObservationWorkerMessage {
  type: "start-playback-observation";
  value: {
    /**
     * Playback observations are linked to an unique MediaSource.
     *
     * This `mediaSourceId` should be the same `mediaSourceId` than the one on
     * the `CreateMediaSourceWorkerMessage` for it.
     *
     * Adding such identifier to this seemlingly unrelated event allows to
     * protect against potential race conditions.
     *
     * If `mediaSourceId` don't match, the message will be ignored.
     */
    mediaSourceId: string;
  };
}

/**
 * Sent when the worker wants to stop receiving regularly "playback
 * observations", previously started through a
 * `StartPlaybackObservationWorkerMessage`
 */
export interface StopPlaybackObservationWorkerMessage {
  type: "stop-playback-observation";
  value: {
    /**
     * Playback observations are linked to an unique MediaSource.
     *
     * This `mediaSourceId` should be the same `mediaSourceId` than the one on
     * the `CreateMediaSourceWorkerMessage` for it.
     *
     * Adding such identifier to this seemlingly unrelated event allows to
     * protect against potential race conditions.
     *
     * If `mediaSourceId` don't match, the message will be ignored.
     */
    mediaSourceId: string;
  };
}

/**
 * Sent when the worker wants to call the `endOfStream` method of the
 * `MediaSource`, thus ending the stream.
 */
export interface EndOfStreamWorkerMessage {
  type: "end-of-stream";
  value: {
    /**
     * This `mediaSourceId` should be the same `mediaSourceId` than the one on
     * the `CreateMediaSourceWorkerMessage` for it.
     *
     * Adding such identifier to this seemlingly unrelated event allows to
     * protect against potential race conditions.
     *
     * If `mediaSourceId` don't match, the message will be ignored.
     */
    mediaSourceId: string;
  };
}

/**
 * Message sent when the Worker has updated its offset to convert playlist time,
 * as anounced in the MediaPlaylist (and which should be preferred for a user
 * interface) into media time, which is the time actually present on the
 * HTMLMediaElement.
 */
export interface MediaOffsetUpdateWorkerMessage {
  type: "media-offset-update";
  value: {
    /**
     * A unique identifier for the content being loaded, that will have to be
     * present on the various events concerning that content.
     */
    contentId: string;
    /**
     * Offset that can be added to the playlist time to obtain the time on the
     * `HTMLMediaElement` and vice-versa, in seconds.
     */
    offset: number;
  };
}

/**
 * First message sent by the main thread to a worker, to initialize it.
 * Once a worker has been initialized, it should send back an
 * `InitializedWorkerMessage`.
 */
export interface InitializationMainMessage {
  type: "init";
  value: {
    /**
     * If `true` the current browser has the MSE-in-worker feature.
     * `false` otherwise.
     */
    hasWorkerMse: boolean;

    /** Url to the WASM part of the WaspHlsPlayer */
    wasmUrl: string;
  };
}

/**
 * Sent by the main thread to the worker when a new content should be loaded.
 */
export interface LoadContentMainMessage {
  type: "load";
  value: {
    /**
     * A unique identifier for the content being loaded, that will have to be
     * present on the various events concerning that content.
     */
    contentId: string;
    /** URL to the HLS MultiVariant Playlist. */
    url: string;
  };
}

/**
 * Sent by the main thread to the worker when the last loaded content (through
 * a `LoadContentMainMessage`) should be stopped and all its resources disposed.
 */
export interface StopContentMainMessage {
  type: "stop";
  value: {
    /**
     * The identifier for the content that should be stopped.
     * This is the same `contentId` value that on the related
     * `LoadContentMainMessage`.
     */
    contentId: string;
  };
}

/**
 * Sent by the main thread to a worker that will not be needed anymore.
 * It is expected that a Worker free all its resources when this message is
 * sent.
 */
export interface DisposePlayerMainMessage {
  type: "dispose";
  value: null;
}

/**
 * Sent by the main thread to a Worker when the MediaSource linked to the
 * `mediaSourceId` changed its readyState.
 *
 * This message is only sent if the MediaSource is created on the main thread.
 */
export interface MediaSourceStateChangedMainMessage {
  type: "media-source-state-changed";
  value: {
    /** Identify the MediaSource in question. */
    mediaSourceId: string;
    /** The new state of the MediaSource. */
    state: MediaSourceReadyState;
  };
}

/**
 * Sent by the main thread to a Worker when the creation of a MediaSource, due
 * to a previously-received `CreateMediaSourceWorkerMessage`, failed.
 */
export interface CreateMediaSourceErrorMainMessage {
  type: "create-media-source-error";
  value: {
    /** Identify the MediaSource in question. */
    mediaSourceId: string;
    /** The error's message. */
    message: string;
    /** The error's name. */
    name?: string | undefined;
  };
}

/** Codes that should be sent alongside a `CreateSourceBufferErrorMainMessage`. */
export enum SourceBufferCreationErrorCode {
  /**
   * The given `mediaSourceId` was right but there was no MediaSource on the
   * main thread.
   *
   * This looks like the MediaSource has been created on the worker but the
   * SourceBuffer is asked to be created on the main thread, which is an error.
   */
  NoMediaSource,
  /**
   * An error arised when creating the SourceBuffer through the MediaSource.
   */
  AddSourceBufferError,
}

/**
 * Sent by the main thread to a Worker when the creation of a SourceBuffer, due
 * to a previously-received `CreateSourceBufferWorkerMessage`, failed.
 */
export interface CreateSourceBufferErrorMainMessage {
  type: "create-source-buffer-error";
  value: {
    mediaSourceId: string;
    /** Identify the SourceBuffer in question. */
    sourceBufferId: number;
    /** Error code to better specify the error encountered. */
    code: SourceBufferCreationErrorCode;
    /** The error's message. */
    message: string;
    /** The error's name. */
    name?: string | undefined;
  };
}

/**
 * Sent by the main thread to a Worker when the update of a MediaSource's
 * duration, due to a previously-received `SetMediaSourceDurationWorkerMessage`,
 * failed.
 */
export interface SetMediaSourceDurationErrorMainMessage {
  type: "update-media-source-duration-error";
  value: {
    /** Identify the MediaSource in question. */
    mediaSourceId: string;
    /** The error's message. */
    message: string;
    /** The error's name. */
    name?: string | undefined;
  };
}

export interface MediaObservationMainMessage {
  type: "observation";
  value: MediaObservation;
}

export interface MediaObservation {
  /** Identify the MediaSource in question. */
  mediaSourceId: string;

  reason: PlaybackTickReason;
  currentTime: number;
  readyState: number;
  buffered: Float64Array;
  paused: boolean;
  seeking: boolean;
}

/**
 * Sent when the SourceBuffer linked to the given `mediaSourceId` and
 * `SourceBufferId`, running on the main thread, succeeded to perform the last
 * operation given to it (either through an `AppendBufferWorkerMessage` or a
 * `RemoveBufferWorkerMessage`).
 */
export interface SourceBufferOperationSuccessMainMessage {
  type: "source-buffer-updated";
  value: {
    /**
     * Identify the MediaSource which contains the SourceBuffer concerned by
     * this update.
     */
    mediaSourceId: string;
    /**
     * Id uniquely identifying this SourceBuffer.
     * It should be the same `sourceBufferId` than the one on the
     * `CreateSourceBufferWorkerMessage`.
     */
    sourceBufferId: number;
  };
}

/**
 * Sent by the main thread to a Worker when the last operation performed on a
 * SourceBuffer either an "append" operation, provoked by a
 * `AppendBufferWorkerMessage` or a "remove" operation, provoked by a
 * `RemoveBufferWorkerMessage`.
 */
export interface SourceBufferOperationErrorMainMessage {
  type: "source-buffer-error";
  value: {
    /** Identify the SourceBuffer in question. */
    sourceBufferId: number;
    /** The error's message. */
    message: string;
    /** The error's name. */
    name?: string | undefined;
  };
}

/** Codes that should be sent alongside a `EndOfStreamErrorMainMessage`. */
export enum EndOfStreamErrorCode {
  /**
   * The given `mediaSourceId` was right but there was no MediaSource on the
   * main thread.
   *
   * This looks like the MediaSource has been created on the worker but the
   * the worker wants to call `endOfStream` on the main thread, which is an
   * error.
   */
  NoMediaSource,
  /** An error arised when calling `endOfStream` on the MediaSource. */
  EndOfStreamError,
}

/**
 * Sent by the main thread to a Worker when the creation of a SourceBuffer, due
 * to a previously-received `CreateSourceBufferWorkerMessage`, failed.
 */
export interface EndOfStreamErrorMainMessage {
  type: "end-of-stream-error";
  value: {
    /** Identify the MediaSource in question. */
    mediaSourceId: string;
    /** Error code to better specify the error encountered. */
    code: EndOfStreamErrorCode;
    /** The error's message. */
    message: string;
    /** The error's name. */
    name?: string | undefined;
  };

