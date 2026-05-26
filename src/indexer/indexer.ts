import { type NosanaClient, MonitorEventType } from "@nosana/kit";
import { JobProcessor } from "./job-processor";
import parentLogger from "../logger";
import type { IndexerMetrics } from "../metrics/indexer";

const logger = parentLogger.child({ module: "indexer" });

const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 60_000;
const MAX_RECONNECT_ATTEMPTS = 10;

export class Indexer {
  readonly jobProcessor: JobProcessor;
  private nosanaClient: NosanaClient;
  private _isRunning: boolean = false;
  private _lastActivity: Date = new Date();
  private _startTime: Date | null = null;
  private _stopMonitor: (() => void) | null = null;
  private _reconnectAttempts: number = 0;
  private _onFatalError?: () => void;
  private _metrics?: IndexerMetrics;

  constructor(nosanaClient: NosanaClient, metrics?: IndexerMetrics) {
    this.nosanaClient = nosanaClient;
    this.jobProcessor = new JobProcessor(nosanaClient);
    this._metrics = metrics;
  }

  set onFatalError(callback: () => void) {
    this._onFatalError = callback;
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  get lastActivity(): Date {
    return this._lastActivity;
  }

  get startTime(): Date | null {
    return this._startTime;
  }

  get healthStatus() {
    return {
      isRunning: this._isRunning,
      lastActivity: this._lastActivity,
      startTime: this._startTime,
      uptime: this._startTime ? Date.now() - this._startTime.getTime() : 0,
    };
  }

  private updateActivity() {
    this._lastActivity = new Date();
  }

  async start() {
    this._startTime = new Date();
    this._isRunning = true;
    this.updateActivity();

    await this.jobProcessor.jobsGPA();
    await this.jobProcessor.marketsGPA();

    this.startMonitor();
  }

  private async startMonitor() {
    try {
      const [eventStream, stop] = await this.nosanaClient.jobs.monitorDetailed();
      this._stopMonitor = stop;

      logger.info("WebSocket monitor connected");
      this._metrics?.setWebsocketConnected(true);

      for await (const event of eventStream) {
        this.updateActivity();
        this._metrics?.markActivity();
        this._reconnectAttempts = 0;

        const eventStart = Date.now();
        try {
          if (event.type === MonitorEventType.JOB) {
            logger.info({ address: event.data.address }, "JobAccount change");
            const updatedJob = await this.jobProcessor.handleJobUpdate(event.data);
            if (updatedJob) {
              logger.info(
                { address: updatedJob.address, state: updatedJob.state },
                "WebSocket updated/inserted job account data",
              );
            }
            this._metrics?.recordIndexerEvent("JOB", (Date.now() - eventStart) / 1000, true);
          } else if (event.type === MonitorEventType.MARKET) {
            logger.info({ address: event.data.address }, "MarketAccount change");
            await this.jobProcessor.handleMarketUpdate(event.data);
            this._metrics?.recordIndexerEvent("MARKET", (Date.now() - eventStart) / 1000, true);
          } else if (event.type === MonitorEventType.RUN) {
            logger.info({ address: event.data.address }, "RunAccount change");
            const updatedJob = await this.jobProcessor.handleRunUpdate(event.data);
            if (updatedJob) {
              logger.info(
                { address: updatedJob.address, state: updatedJob.state },
                "WebSocket updated/inserted job account data",
              );
            }
            this._metrics?.recordIndexerEvent("RUN", (Date.now() - eventStart) / 1000, true);
          }
        } catch (error) {
          logger.error(
            { err: error, eventType: event.type, address: event.data?.address },
            "Failed to handle monitor event",
          );
          this._metrics?.recordIndexerEvent(
            event.type as "JOB" | "MARKET" | "RUN",
            (Date.now() - eventStart) / 1000,
            false,
          );
        }
      }

      // Stream ended without error — WebSocket closed silently
      logger.warn("WebSocket event stream ended unexpectedly");
      this._metrics?.setWebsocketConnected(false);
      this.reconnect("stream_ended");
    } catch (error) {
      logger.error({ err: error }, "Monitor event stream error");
      this._metrics?.setWebsocketConnected(false);
      this.reconnect("error");
    }
  }

  private reconnect(reason: string = "error") {
    if (!this._isRunning) return;

    this._reconnectAttempts++;

    if (this._reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      logger.fatal(
        { attempts: this._reconnectAttempts - 1 },
        "Max reconnect attempts exceeded, shutting down",
      );
      this._metrics?.recordReconnect("max_attempts", this._reconnectAttempts);
      this._isRunning = false;
      if (this._onFatalError) {
        this._onFatalError();
      } else {
        process.exit(1);
      }
      return;
    }

    this._metrics?.recordReconnect(reason, this._reconnectAttempts);

    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** (this._reconnectAttempts - 1),
      RECONNECT_MAX_DELAY_MS,
    );
    logger.info(
      { attempt: this._reconnectAttempts, delayMs: delay },
      "Reconnecting WebSocket monitor",
    );

    setTimeout(() => {
      if (!this._isRunning) return;
      this.startMonitor();
    }, delay);
  }

  stop() {
    this._isRunning = false;
    this._startTime = null;
    if (this._stopMonitor) {
      this._stopMonitor();
      this._stopMonitor = null;
    }
  }
}
