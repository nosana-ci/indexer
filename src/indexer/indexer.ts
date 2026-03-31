import { type NosanaClient, MonitorEventType } from "@nosana/kit";
import { JobProcessor } from "./job-processor";
import parentLogger from "../logger";

const logger = parentLogger.child({ module: "indexer" });

const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 60_000;

export class Indexer {
  readonly jobProcessor: JobProcessor;
  private nosanaClient: NosanaClient;
  private _isRunning: boolean = false;
  private _lastActivity: Date = new Date();
  private _startTime: Date | null = null;
  private _stopMonitor: (() => void) | null = null;
  private _reconnectAttempts: number = 0;

  constructor(nosanaClient: NosanaClient) {
    this.nosanaClient = nosanaClient;
    this.jobProcessor = new JobProcessor(nosanaClient);
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
      this._reconnectAttempts = 0;

      logger.info("WebSocket monitor connected");

      for await (const event of eventStream) {
        this.updateActivity();

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
          } else if (event.type === MonitorEventType.MARKET) {
            logger.info({ address: event.data.address }, "MarketAccount change");
            await this.jobProcessor.handleMarketUpdate(event.data);
          } else if (event.type === MonitorEventType.RUN) {
            logger.info({ address: event.data.address }, "RunAccount change");
            const updatedJob = await this.jobProcessor.handleRunUpdate(event.data);
            if (updatedJob) {
              logger.info(
                { address: updatedJob.address, state: updatedJob.state },
                "WebSocket updated/inserted job account data",
              );
            }
          }
        } catch (error) {
          logger.error(
            { err: error, eventType: event.type, address: event.data?.address },
            "Failed to handle monitor event",
          );
        }
      }

      // Stream ended without error — WebSocket closed silently
      logger.warn("WebSocket event stream ended unexpectedly");
      this.reconnect();
    } catch (error) {
      logger.error({ err: error }, "Monitor event stream error");
      this.reconnect();
    }
  }

  private reconnect() {
    if (!this._isRunning) return;

    this._reconnectAttempts++;
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
