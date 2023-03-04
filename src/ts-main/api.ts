import idGenerator from "../ts-common/idGenerator";
import QueuedSourceBuffer from "../ts-common/QueuedSourceBuffer";
import {
  WorkerMessage,
  MediaSourceReadyState,
  EndOfStreamErrorCode,
  SourceBufferCreationErrorCode,
} from "../ts-common/types";
import { WarningCode } from "../wasm/wasp_hls";
import InitializationError from "./errors";
import EventEmitter from "./EventEmitter";
import observePlayback from "./observePlayback";
import postMessageToWorker from "./postMessageToWorker";

const generateContentId = idGenerator();

interface WaspHlsPlayerEvents {
  warning:  {
    code: WarningCode;
    message: string | undefined;
  };
}

export default class WaspHlsPlayer extends EventEmitter<WaspHlsPlayerEvents> {
  public initializationStatus: InitializationStatus;
  public videoElement: HTMLVideoElement;
  private _worker : Worker | null;
  private _currentContentMetadata : ContentMetadata | null;

  /**
   * Create a new WaspHlsPlayer, associating with a video element.
   *
   * Note that you will need to call `initialize` on it befor actually loading
   * the content and perform most other operations.
   *
   * @param {HTMLVideoElement} videoElement
   */
  constructor(videoElement: HTMLVideoElement) {
    super();
    this.videoElement = videoElement;
    this.initializationStatus = InitializationStatus.Uninitialized;
    this._worker = null;
    this._currentContentMetadata = null;
  }

  /**
   * Begin "initialization", that is, start loading the web Worker and
   * WebAssembly parts of the player so it can begin to load contents.
   *
   * The returned Promise:
   *   - Resolves once the initialization is finished with success.
   *     From that point on, you can begin to load contents.
   *
   *   - Rejects if the initialization failed, with a `InitializationError`
   *     describing the error encountered.
   * @param {Object} opts
   * @returns {Promise}
   */
  public initialize(opts: InitializationOptions) : Promise<void> {
    try {
      this.initializationStatus = InitializationStatus.Initializing;
      const { wasmUrl, workerUrl } = opts;
      let resolveProm = noop;
      let rejectProm = noop;
      const ret = new Promise<void>((resolve, reject) => {
        resolveProm = resolve;
        rejectProm = reject;
      });
      this._startWorker(workerUrl, wasmUrl, resolveProm, rejectProm);
      return ret;
    }
    catch (err) {
      this.initializationStatus = InitializationStatus.Errored;
      return Promise.reject(err);
    }
  }

  public loadContent(url: string): void {
    if (this._worker === null) {
      throw new Error("The Player is not initialized or disposed.");
    }
    const contentId = generateContentId();
    this._currentContentMetadata = {
      contentId,
      mediaSourceId: null,
      mediaSource: null,
      disposeMediaSource: null,
      sourceBuffers: [],
      stopPlaybackObservations: null,
      mediaOffset: undefined,
      minimumPosition: undefined,
      maximumPosition: undefined,
    };
    postMessageToWorker(this._worker, {
      type: "load",
      value: { contentId, url },
    });
  }

  public getPosition(): number {
    if (this._currentContentMetadata === null) {
      return 0;
    }
    const currentTime = this.videoElement.currentTime;
    return currentTime - (this._currentContentMetadata.mediaOffset ?? 0);
  }

  public seek(position: number): void {
    if (this._currentContentMetadata === null) {
      throw new Error("Cannot seek: no content loaded.");
    }
    this.videoElement.currentTime = position +
      (this._currentContentMetadata.mediaOffset ?? 0);
  }

  public getMediaOffset(): number | undefined {
    return this._currentContentMetadata?.mediaOffset ?? undefined;
  }

  public setVolume(volume: number): void {
    this.videoElement.volume = volume;
  }

  public mute(): void {
    this.videoElement.muted = true;
  }

  public unmute(): void {
    this.videoElement.muted = false;
  }

  public isPaused(): boolean {
    return this.videoElement.paused;
  }

  public pause(): void {
    this.videoElement.pause();
  }

  public resume(): void {
    this.videoElement.play()
      .catch(() => { /* noop */});
  }

  public stop(): void {
    if (this._worker === null) {
      throw new Error("The Player is not initialized or disposed.");
    }
    if (
      this._currentContentMetadata !== null &&
      this._currentContentMetadata.stopPlaybackObservations !== null
    ) {
      this._currentContentMetadata.stopPlaybackObservations();
      this._currentContentMetadata.stopPlaybackObservations = null;
    }
    if (this._currentContentMetadata !== null) {
      postMessageToWorker(this._worker, {
        type: "stop",
        value: { contentId: this._currentContentMetadata.contentId },
      });
    }
  }

  public setSpeed(speed: number): void {
    // TODO playbackRate  may be used to implement force rebuffering in the
    // future, in which case another solution will need to be found.
    this.videoElement.playbackRate = speed;
  }

  public getSpeed(): number {
    return this.videoElement.playbackRate;
  }

  public getMinimumPosition() : number | undefined {
    return this._currentContentMetadata?.minimumPosition;
  }

  public getMaximumPosition() : number | undefined {
    return this._currentContentMetadata?.maximumPosition;
  }

  public dispose() {
    if (this._worker === null) {
      return;
    }
    if (
      this._currentContentMetadata !== null &&
      this._currentContentMetadata.stopPlaybackObservations !== null
    ) {
      this._currentContentMetadata.stopPlaybackObservations();
      this._currentContentMetadata.stopPlaybackObservations = null;
    }
    // TODO needed? What about GC once it is set to `null`?
    postMessageToWorker(this._worker, { type: "dispose", value: null });
    this._worker = null;
  }

  private _startWorker(
    workerUrl: string,
    wasmUrl: string,
    resolveProm: () => void,
    rejectProm: (err: unknown) => void
  ) {
    let mayStillReject = true;
    const worker = new Worker(workerUrl);
    this._worker = worker;
    postMessageToWorker(worker, {
      type: "init",
      value: {
        hasWorkerMse: typeof MediaSource === "function" &&
          /* eslint-disable-next-line */
          (MediaSource as any).canConstructInDedicatedWorker === true,
        wasmUrl,
      },
    });

    worker.onmessage = (evt: MessageEvent<WorkerMessage>) => {
      const { data } = evt;
      if (typeof data !== "object" || data === null || typeof data.type !== "string") {
        console.error("unexpected Worker message");
        return;
      }

      switch (data.type) {
        case "initialized":
          this.initializationStatus = InitializationStatus.Initialized;
          mayStillReject = false;
          resolveProm();
          break;

        case "initialization-error":
          if (mayStillReject) {
            const error = new InitializationError(
              data.value.code,
              data.value.wasmHttpStatus,
              data.value.message ?? "Error while initializing the WaspHlsPlayer"
            );
            mayStillReject = false;
            rejectProm(error);
          }
          break;

        case "seek":
          if (
            this._currentContentMetadata === null ||
            this._currentContentMetadata.mediaSourceId !== data.value.mediaSourceId
          ) {
            console.info("API: Ignoring seek due to wrong `mediaSourceId`");
            return;
          }
          try {
            this.videoElement.currentTime = data.value.position;
          } catch (err) {
            console.error("Unexpected error while seeking:", err);
          }
          break;

        case "attach-media-source":
          if (
            this._currentContentMetadata === null ||
            this._currentContentMetadata.contentId !== data.value.contentId
          ) {
            console.info(
              "API: Ignoring MediaSource attachment due to wrong `contentId`"
            );
            return;
          }

          if (this._currentContentMetadata.stopPlaybackObservations !== null) {
            this._currentContentMetadata.stopPlaybackObservations();
            this._currentContentMetadata.stopPlaybackObservations = null;
          }

          if (data.value.handle !== undefined) {
            this.videoElement.srcObject = data.value.handle;
          } else if (data.value.src !== undefined) {
            this.videoElement.src = data.value.src;
          } else {
            throw new Error(
              "Unexpected \"attach-media-source\" message: missing source"
            );
          }
          this._currentContentMetadata.mediaSourceId = data.value.mediaSourceId;
          this._currentContentMetadata.mediaSource = null;
          this._currentContentMetadata.disposeMediaSource = () => {
            if (data.value.src !== undefined) {
              URL.revokeObjectURL(data.value.src);
            }
          };
          this._currentContentMetadata.sourceBuffers = [];
          this._currentContentMetadata.stopPlaybackObservations = null;
          break;

        case "create-media-source": {
          if (
            this._currentContentMetadata === null ||
            this._currentContentMetadata.contentId !== data.value.contentId
          ) {
            console.info(
              "API: Ignoring MediaSource attachment due to wrong `contentId`"
            );
            return;
          }
          const { mediaSourceId } = data.value;

          let mediaSource : MediaSource;
          try {
            mediaSource = new MediaSource();
          } catch (err) {
            const { name, message } = getErrorInformation(
              err,
              "Unknown error when creating the MediaSource"
            );
            postMessageToWorker(worker, {
              type: "create-media-source-error",
              value: { mediaSourceId, message, name },
            });
            return;
          }

          const disposeMediaSource =
            bindMediaSource(worker, mediaSource, this.videoElement, mediaSourceId);
          this._currentContentMetadata.mediaSourceId = data.value.mediaSourceId;
          this._currentContentMetadata.mediaSource = mediaSource;
          this._currentContentMetadata.disposeMediaSource = disposeMediaSource;
          this._currentContentMetadata.sourceBuffers = [];
          this._currentContentMetadata.stopPlaybackObservations = null;
          break;
        }

        case "update-media-source-duration": {
          const { mediaSourceId } = data.value;
          if (
            this._currentContentMetadata?.mediaSourceId !== mediaSourceId ||
            this._currentContentMetadata.mediaSource === null
          ) {
            return;
          }
          try {
            this._currentContentMetadata.mediaSource.duration = data.value.duration;
          } catch (err) {
            const { name, message } = getErrorInformation(
              err,
              "Unknown error when updating the MediaSource's duration"
            );
            postMessageToWorker(worker, {
              type: "update-media-source-duration-error",
              value: { mediaSourceId, message, name },
            });
            return;
          }
          break;
        }

        case "clear-media-source": {
          if (this._currentContentMetadata?.mediaSourceId !== data.value.mediaSourceId) {
            return;
          }
          try {
            this._currentContentMetadata.disposeMediaSource?.();
            clearElementSrc(this.videoElement);
          } catch (err) {
            console.warn("API: Error when clearing current MediaSource:", err);
          }
          break;
        }

        case "create-source-buffer": {
          if (this._currentContentMetadata?.mediaSourceId !== data.value.mediaSourceId) {
            return;
          }
          if (this._currentContentMetadata.mediaSource === null) {
            postMessageToWorker(worker, {
              type: "create-source-buffer-error",
              value: {
                mediaSourceId: data.value.mediaSourceId,
                sourceBufferId: data.value.sourceBufferId,
                code: SourceBufferCreationErrorCode.NoMediaSource,
                message: "No MediaSource created on the main thread.",
                name: undefined,
              },
            });
            return;
          }
          try {
            const sourceBuffer = this._currentContentMetadata.mediaSource
              .addSourceBuffer(data.value.contentType);
            const queuedSourceBuffer = new QueuedSourceBuffer(sourceBuffer);
            this._currentContentMetadata.sourceBuffers.push({
              sourceBufferId: data.value.sourceBufferId,
              queuedSourceBuffer,
            });
          } catch (err) {
            const { name, message } = getErrorInformation(
              err,
              "Unknown error when adding the SourceBuffer to the MediaSource"
            );
            postMessageToWorker(worker, {
              type: "create-source-buffer-error",
              value: {
                mediaSourceId: data.value.mediaSourceId,
                sourceBufferId: data.value.sourceBufferId,
                code: SourceBufferCreationErrorCode.AddSourceBufferError,
                message,
                name,
              },
            });
          }
          break;
        }

        case "append-buffer": {
          if (this._currentContentMetadata?.mediaSourceId !== data.value.mediaSourceId) {
            return;
          }
          const sbObject = this._currentContentMetadata.sourceBuffers
            .find(({ sourceBufferId }) => sourceBufferId === data.value.sourceBufferId);
          if (sbObject === undefined) {
            return;
          }
          const { mediaSourceId, sourceBufferId } = data.value;
          try {
            sbObject.queuedSourceBuffer.push(data.value.data)
              .then(() => {
                postMessageToWorker(worker, {
                  type: "source-buffer-updated",
                  value: { mediaSourceId, sourceBufferId },
                });
              })
              .catch(handleAppendBufferError);
          } catch (err) {
            handleAppendBufferError(err);
          }
          function handleAppendBufferError(err: unknown): void {
            const { name, message } = getErrorInformation(
              err,
              "Unknown error when appending data to the SourceBuffer"
            );
            postMessageToWorker(worker, {
              type: "source-buffer-error",
              value: { sourceBufferId, message, name },
            });
          }
          break;
        }

        case "remove-buffer": {
          if (this._currentContentMetadata?.mediaSourceId !== data.value.mediaSourceId) {
            return;
          }
          const sbObject = this._currentContentMetadata.sourceBuffers
            .find(({ sourceBufferId }) => sourceBufferId === data.value.sourceBufferId);
          if (sbObject === undefined) {
            return;
          }
          const { mediaSourceId, sourceBufferId } = data.value;
          try {
            sbObject.queuedSourceBuffer.removeBuffer(data.value.start, data.value.end)
              .then(() => {
                postMessageToWorker(worker, {
                  type: "source-buffer-updated",
                  value: { mediaSourceId, sourceBufferId },
                });
              })
              .catch(handleRemoveBufferError);
          } catch (err) {
            handleRemoveBufferError(err);
          }
          function handleRemoveBufferError(err: unknown): void {
            const { name, message } = getErrorInformation(
              err,
              "Unknown error when removing data to the SourceBuffer"
            );
            postMessageToWorker(worker, {
              type: "source-buffer-error",
              value: { sourceBufferId, message, name },
            });
          }
          break;
        }

        case "start-playback-observation": {
          if (this._currentContentMetadata?.mediaSourceId !== data.value.mediaSourceId) {
            return;
          }
          if (this._currentContentMetadata.stopPlaybackObservations !== null) {
            this._currentContentMetadata.stopPlaybackObservations();
            this._currentContentMetadata.stopPlaybackObservations = null;
          }
          this._currentContentMetadata.stopPlaybackObservations = observePlayback(
            this.videoElement,
            data.value.mediaSourceId,
            (value) => postMessageToWorker(worker, { type: "observation", value })
          );
          break;
        }

        case "stop-playback-observation": {
          if (this._currentContentMetadata?.mediaSourceId !== data.value.mediaSourceId) {
            return;
          }
          if (this._currentContentMetadata.stopPlaybackObservations !== null) {
            this._currentContentMetadata.stopPlaybackObservations();
            this._currentContentMetadata.stopPlaybackObservations = null;
          }
          break;
        }

        case "end-of-stream":
          if (this._currentContentMetadata?.mediaSourceId !== data.value.mediaSourceId) {
            return;
          }
          const { mediaSourceId } = data.value;
          if (this._currentContentMetadata.mediaSource === null) {
            postMessageToWorker(worker, {
              type: "end-of-stream-error",
              value: {
                mediaSourceId,
                code: EndOfStreamErrorCode.NoMediaSource,
                message: "No MediaSource created on the main thread.",
                name: undefined,
              },
            });
            return;
          }
          try {
            // TODO Maybe the best here would be a more complex logic to
            // call `endOfStream` at the right time.
            this._currentContentMetadata.mediaSource.endOfStream();
          } catch (err) {
            const { name, message } = getErrorInformation(
              err,
              "Unknown error when calling MediaSource.endOfStream()"
            );
            postMessageToWorker(worker, {
              type: "end-of-stream-error",
              value: {
                mediaSourceId,
                code: EndOfStreamErrorCode.EndOfStreamError,
                message,
                name,
              },
            });
          }
          break;

        case "media-offset-update":
          if (
            this._currentContentMetadata === null ||
            this._currentContentMetadata.contentId !== data.value.contentId
          ) {
            console.info(
              "API: Ignoring media offset update due to wrong `contentId`"
            );
            return;
          }
          this._currentContentMetadata.mediaOffset = data.value.offset;
          break;

        case "content-warning":
          if (
            this._currentContentMetadata === null ||
            this._currentContentMetadata.contentId !== data.value.contentId
          ) {
            console.info("API: Ignoring warning due to wrong `contentId`");
            return;
          }
          console.warn("Warning received", data.value.code);
          // this.trigger("warning", {
          //   code: data.value.code,
          //   // TODO
          //   message: undefined,
          // });
          break;

        case "content-info-update":
          if (
            this._currentContentMetadata === null ||
            this._currentContentMetadata.contentId !== data.value.contentId
          ) {
            console.info("API: Ignoring warning due to wrong `contentId`");
            return;
          }
          this._currentContentMetadata.minimumPosition = data.value.minimumPosition;
          this._currentContentMetadata.maximumPosition = data.value.minimumPosition;
          break;
      }
    };

    // TODO check on which case this is triggered
    worker.onerror = (ev: ErrorEvent) => {
      console.error("API: Worker Error encountered", ev.error);
      if (mayStillReject) {
        rejectProm(ev.error);
      }
    };
  }

}

function bindMediaSource(
  worker: Worker,
  mediaSource: MediaSource,
  videoElement: HTMLVideoElement,
  mediaSourceId: string
) : () => void {
  mediaSource.addEventListener("sourceclose", onMediaSourceClose);
  mediaSource.addEventListener("sourceended", onMediaSourceEnded);
  mediaSource.addEventListener("sourceopen", onMediaSourceOpen);

  const objectURL = URL.createObjectURL(mediaSource);
  videoElement.src = objectURL;

  function onMediaSourceEnded() {
    postMessageToWorker(worker, {
      type: "media-source-state-changed",
      value: { mediaSourceId, state: MediaSourceReadyState.Ended },
    });
  }
  function onMediaSourceOpen() {
    postMessageToWorker(worker, {
      type: "media-source-state-changed",
      value: { mediaSourceId, state: MediaSourceReadyState.Open },
    });
  }
  function onMediaSourceClose() {
    postMessageToWorker(worker, {
      type: "media-source-state-changed",
      value: { mediaSourceId, state: MediaSourceReadyState.Closed },
    });
  }

  return () => {
    mediaSource.removeEventListener("sourceclose", onMediaSourceClose);
    mediaSource.removeEventListener("sourceended", onMediaSourceEnded);
    mediaSource.removeEventListener("sourceopen", onMediaSourceOpen);
    URL.revokeObjectURL(objectURL);

    if (mediaSource.readyState !== "closed") {
      // TODO should probably wait until updates finish and whatnot
      const { readyState, sourceBuffers } = mediaSource;
      for (let i = sourceBuffers.length - 1; i >= 0; i--) {
        const sourceBuffer = sourceBuffers[i];

        // TODO what if not? Is the current code useful at all?
        if (!sourceBuffer.updating) {
          try {
            if (readyState === "open") {
              sourceBuffer.abort();
            }
            mediaSource.removeSourceBuffer(sourceBuffer);
          }
          catch (_e) {
            // TODO
          }
        }
      }
    }

    // TODO copy logic and comment of RxPlayer for proper stop
    videoElement.src = "";
    videoElement.removeAttribute("src");
  };
}

const enum InitializationStatus {
  Uninitialized = "Uninitialized",
  Initializing = "Initializing",
  Initialized = "Initialized",
  Errored = "errorred",
  Disposed = "disposed",
}

export interface InitializationOptions {
  workerUrl: string;
  wasmUrl: string;
}

function noop() {
  /* do nothing! */
}

/**
 * Clear element's src attribute.
 * @param {HTMLMediaElement} element
 */
function clearElementSrc(element: HTMLMediaElement): void {
  // On some browsers, we first have to make sure the textTracks elements are
  // both disabled and removed from the DOM.
  // If we do not do that, we may be left with displayed text tracks on the
  // screen, even if the track elements are properly removed, due to browser
  // issues.
  // Bug seen on Firefox (I forgot which version) and Chrome 96.
  const { textTracks } = element;
  if (textTracks != null) {
    for (let i = 0; i < textTracks.length; i++) {
      textTracks[i].mode = "disabled";
    }
    if (element.hasChildNodes()) {
      const { childNodes } = element;
      for (let j = childNodes.length - 1; j >= 0; j--) {
        if (childNodes[j].nodeName === "track") {
          try {
            element.removeChild(childNodes[j]);
          } catch (err) {
            // TODO
          }
        }
      }
    }
  }
  element.src = "";

  // On IE11, element.src = "" is not sufficient as it
  // does not clear properly the current MediaKey Session.
  // Microsoft recommended to use element.removeAttr("src").
  element.removeAttribute("src");
}

function getErrorInformation(err: unknown, defaultMsg: string) : {
  name: string | undefined;
  message: string;
} {
  if (err instanceof Error) {
    return { message: err.message, name: err.name };
  } else {
    return { message: defaultMsg, name: undefined };
  }
}

/**
 * Structure storing metadata associated to a content being played by a
 * `WaspHlsPlayer`.
 */
interface ContentMetadata {
  /**
   * Unique identifier identifying the loaded content.
   *
   * This identifier should be unique for any instances of `WaspHlsPlayer`
   * created in the current JavaScript realm.
   *
   * Identifying a loaded content this way allows to ensure that messages
   * exchanged with a Worker concern the same content, mostly in cases of race
   * conditions.
   */
  contentId: string;

  /**
   * Unique identifier identifying a MediaSource attached to the
   * HTMLVideoElement.
   *
   * This identifier should be unique for the worker in question.
   *
   * Identifying a MediaSource this way allows to ensure that messages
   * exchanged with a Worker concern the same MediaSource instance.
   *
   * `null` when no `MediaSource` is created now.
   */
  mediaSourceId: string | null;

  /**
   * `MediaSource` instance linked to the current content being played.
   *
   * `null` when either:
   *   - no `MediaSource` instance is active for now
   *   - the `MediaSource` has been created on the Worker side.
   *
   * You can know whether a `MediaSource` is currently created at all by
   * refering to `mediaSourceId` instead.
   */
  mediaSource: MediaSource | null;

  /**
   * Callback that should be called when the `MediaSource` linked to the current
   * content becomes unattached - whether the `MediaSource` has been created in
   * this realm or in the worker.
   */
  disposeMediaSource: (() => void) | null;

  /**
   * Describe `SourceBuffer` instances currently associated to the current
   * `MediaSource` that have been created in this realm (and not in the Worker).
   */
  sourceBuffers: Array<{
    /**
     * Id uniquely identifying this SourceBuffer.
     * It is generated from the Worker and it is unique for all SourceBuffers
     * created after associated with the linked `mediaSourceId`.
     */
    sourceBufferId: number;
    /**
     * QueuedSourceBuffer associated to this SourceBuffers.
     * This is the abstraction used to push and remove data to the SourceBuffer.
     */
    queuedSourceBuffer: QueuedSourceBuffer;
  }>;

  /**
   * Callback allowing to stop playback observations currently pending.
   * `null` if no "playback observation" is currently pending.
   */
  stopPlaybackObservations: null | (() => void);

  /**
   * Offset allowing to convert from the position as announced by the media
   * element's `currentTime` property, to the actual content's position.
   *
   * To obtain the content's position from the `currentTime` property, just
   * remove `mediaOffset` (seconds) from the latter.
   *
   * To obtain the media element's time from a content's time, just add
   * `mediaOffset` to the latter.
   */
  mediaOffset: number | undefined;

  minimumPosition : number | undefined;

  maximumPosition : number | undefined;
}

export { WarningCode };
