import { Hono } from "hono";

// Kept as an empty route module while the API aggregation is shared with
// generic media and public-file endpoints. The built-in playback session API
// was retired with the Media Player feature.
export default new Hono();
