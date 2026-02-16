import { Elysia, t } from "elysia";
import { createDbPlugin } from "../../plugins/db";
import { getByAddressParams, jobResponse } from "./model";
import { JobsService } from "./service";

export const jobs = new Elysia({ prefix: "/jobs" })
  .use(createDbPlugin())
  .derive(({ db }) => ({
    jobsService: new JobsService(db),
  }))
  .get(
    "/:address",
    async ({ params: { address }, jobsService }) => {
      return await jobsService.getByAddress(address);
    },
    {
      params: getByAddressParams,
      response: {
        200: jobResponse,
        404: t.Object({
          message: t.String(),
        }),
      },
      detail: {
        summary: "Get job by address",
        description: "Retrieve a job account by its address",
        tags: ["Jobs"],
      },
    }
  );
