import { type NosanaClient, MonitorEventType } from "@nosana/kit";
import { JobProcessor } from "./job-processor";
import parentLogger from "../logger";

const logger = parentLogger.child({ module: "indexer" });

export class Indexer {
  readonly jobProcessor: JobProcessor;
  private nosanaClient: NosanaClient;
  private _isRunning: boolean = false;
  private _lastActivity: Date = new Date();
  private _startTime: Date | null = null;
  private _stopMonitor: (() => void) | null = null;

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

    const [eventStream, stop] = await this.nosanaClient.jobs.monitorDetailed();
    this._stopMonitor = stop;

    // Process events in background
    (async () => {
      for await (const event of eventStream) {
        this.updateActivity();

        if (event.type === MonitorEventType.JOB) {
          logger.debug({ address: event.data.address }, "JobAccount change");
          const updatedJob = await this.jobProcessor.handleJobUpdate(event.data);
          if (updatedJob) {
            logger.debug(
              { address: updatedJob.address },
              "WebSocket updated/inserted job account data",
            );
          }
        } else if (event.type === MonitorEventType.MARKET) {
          logger.debug({ address: event.data.address }, "MarketAccount change");
          await this.jobProcessor.handleMarketUpdate(event.data);
        } else if (event.type === MonitorEventType.RUN) {
          logger.debug({ address: event.data.address }, "RunAccount change");
          const updatedJob = await this.jobProcessor.handleRunUpdate(event.data);
          if (updatedJob) {
            logger.debug(
              { address: updatedJob.address },
              "WebSocket updated/inserted job account data",
            );
          }
        }
      }
    })().catch((error) => {
      logger.error({ err: error }, "Monitor event stream error");
    });
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
