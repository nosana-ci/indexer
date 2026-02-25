import { Elysia } from "elysia";
import { jobs } from "./modules/jobs";

export const createApp = () => {
  return new Elysia()
    .onError(({ error, status }) => {
      if (
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        "message" in error
      ) {
        const { status: errStatus, message } = error as {
          status: number;
          message: string;
        };
        return status(errStatus, { message });
      }
      console.error("Unhandled error:", error);
      return status(500, { message: "Internal server error" });
    })
    .get("/", () => "Hi")
    .use(jobs);
};
