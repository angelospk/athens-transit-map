import { handle, type Env } from "./token";

export default {
  fetch: (req: Request, env: Env) => handle(req, env),
};
